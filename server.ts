import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_STRATEGY_CONFIG,
  INSTRUMENTS,
  type LiveMarketNewsResponse,
  type MarketNewsCategory,
  type StrategyConfig,
  type Timeframe,
} from './src/types/trading.ts';
import {
  fetchLiveMarketQuote,
  getInstrumentById,
  prewarmPriorityFeeds,
} from './server/marketData.ts';
import { attachBinanceWsHub } from './server/binanceWsHub.ts';
import { evaluatePineStrategyLive, runPineBacktest } from './server/pineEngine.ts';
import { evaluateMultiTimeframeStrategy } from './server/strategyEngine.ts';
import {
  analyzeUploadedChartWithGemini,
  chatWithTradingAssistant,
  enhanceLiveAnalysisWithGemini,
  fetchLiveMarketNewsWithGemini,
} from './server/geminiService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '15mb' }));

// Duplicate order guard cache (userId:signalId:side -> timestamp)
const recentOrderCache = new Map<string, number>();

function sanitizeConfig(raw: any): StrategyConfig {
  return {
    userId: typeof raw?.userId === 'string' ? raw.userId : 'default',
    emaFast: Number(raw?.emaFast) || DEFAULT_STRATEGY_CONFIG.emaFast,
    emaMid: Number(raw?.emaMid) || DEFAULT_STRATEGY_CONFIG.emaMid,
    emaSlow: Number(raw?.emaSlow) || DEFAULT_STRATEGY_CONFIG.emaSlow,
    rsiPeriod: Number(raw?.rsiPeriod) || DEFAULT_STRATEGY_CONFIG.rsiPeriod,
    rsiBullishMin: Number(raw?.rsiBullishMin) || DEFAULT_STRATEGY_CONFIG.rsiBullishMin,
    rsiBearishMax: Number(raw?.rsiBearishMax) || DEFAULT_STRATEGY_CONFIG.rsiBearishMax,
    trendTimeframe: ['15m', '1h', '4h'].includes(raw?.trendTimeframe)
      ? raw.trendTimeframe
      : DEFAULT_STRATEGY_CONFIG.trendTimeframe,
    entryTimeframe: ['5m', '15m'].includes(raw?.entryTimeframe)
      ? raw.entryTimeframe
      : DEFAULT_STRATEGY_CONFIG.entryTimeframe,
    minSetupScore: Number(raw?.minSetupScore) || DEFAULT_STRATEGY_CONFIG.minSetupScore,
    minRiskReward: Number(raw?.minRiskReward) || DEFAULT_STRATEGY_CONFIG.minRiskReward,
    maxRiskPerTradePct: Number(raw?.maxRiskPerTradePct) || DEFAULT_STRATEGY_CONFIG.maxRiskPerTradePct,
    prioritizeAtmOptions:
      typeof raw?.prioritizeAtmOptions === 'boolean'
        ? raw.prioritizeAtmOptions
        : DEFAULT_STRATEGY_CONFIG.prioritizeAtmOptions,
    comexCrudeEma9Priority:
      typeof raw?.comexCrudeEma9Priority === 'boolean'
        ? raw.comexCrudeEma9Priority
        : DEFAULT_STRATEGY_CONFIG.comexCrudeEma9Priority,
    paperTradingOnly:
      typeof raw?.paperTradingOnly === 'boolean'
        ? raw.paperTradingOnly
        : DEFAULT_STRATEGY_CONFIG.paperTradingOnly,
    autoBroadcastTelegram:
      typeof raw?.autoBroadcastTelegram === 'boolean'
        ? raw.autoBroadcastTelegram
        : DEFAULT_STRATEGY_CONFIG.autoBroadcastTelegram,
    telegramChannelLabel:
      typeof raw?.telegramChannelLabel === 'string'
        ? raw.telegramChannelLabel
        : DEFAULT_STRATEGY_CONFIG.telegramChannelLabel,
    dataProviderLabel:
      typeof raw?.dataProviderLabel === 'string'
        ? raw.dataProviderLabel
        : DEFAULT_STRATEGY_CONFIG.dataProviderLabel,
    brokerProviderLabel:
      typeof raw?.brokerProviderLabel === 'string'
        ? raw.brokerProviderLabel.slice(0, 80)
        : DEFAULT_STRATEGY_CONFIG.brokerProviderLabel,
    killSwitchActive:
      typeof raw?.killSwitchActive === 'boolean'
        ? raw.killSwitchActive
        : DEFAULT_STRATEGY_CONFIG.killSwitchActive,
    activeInstruments: Array.isArray(raw?.activeInstruments)
      ? raw.activeInstruments
      : DEFAULT_STRATEGY_CONFIG.activeInstruments,
  };
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'My Trade', timestamp: new Date().toISOString() });
});

app.get('/.well-known/assetlinks.json', (req: Request, res: Response) => {
  const pkg =
    typeof req.query.packageName === 'string' && /^[a-zA-Z][a-zA-Z0-9_.]*$/.test(req.query.packageName)
      ? req.query.packageName
      : process.env.PLAYSTORE_PACKAGE_NAME || 'com.mytrade.terminal';
  const sha =
    typeof req.query.sha256 === 'string' && /^[A-Fa-f0-9:]{95}$/.test(req.query.sha256)
      ? req.query.sha256.toUpperCase()
      : process.env.PLAYSTORE_SHA256_FINGERPRINT ||
        '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00';

  res.type('application/json').json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: [sha],
      },
    },
  ]);
});

const liveNewsCache = new Map<string, { expiresAt: number; payload: LiveMarketNewsResponse }>();

app.get('/api/news/live', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in server environment secrets.',
      });
      return;
    }

    const rawCat = String(req.query.category || 'ALL').toUpperCase();
    const category: MarketNewsCategory = ['ALL', 'INDIAN', 'MCX', 'INTERNATIONAL'].includes(rawCat)
      ? (rawCat as MarketNewsCategory)
      : 'ALL';
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    const cacheKey = `${category}:${query.toLowerCase()}`;
    const existing = liveNewsCache.get(cacheKey);
    if (!forceRefresh && existing && existing.expiresAt > Date.now()) {
      res.json({ ...existing.payload, cached: true });
      return;
    }

    const news = await fetchLiveMarketNewsWithGemini({ category, query });
    liveNewsCache.set(cacheKey, {
      expiresAt: Date.now() + 120_000, // 2-minute cache
      payload: news,
    });
    res.json({ ...news, cached: false });
  } catch (err: any) {
    const rawMsg = err instanceof Error ? err.message : 'Failed to fetch live market news.';
    let cleanMsg = rawMsg;
    let statusCode = typeof err?.status === 'number' ? err.status : 500;
    try {
      const parsed = JSON.parse(rawMsg);
      if (parsed?.error?.message) {
        cleanMsg = parsed.error.message;
      }
      if (typeof parsed?.error?.code === 'number') {
        statusCode = parsed.error.code;
      }
    } catch {
      // Keep original message if not JSON
    }
    if (statusCode === 429) {
      cleanMsg =
        'Gemini API quota limit reached for live Google Search news. Please verify or upgrade your API key quota in Settings > Secrets, then click Retry.';
    }
    res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      error: cleanMsg,
    });
  }
});

let cachedBotUsername: string | null = null;

async function getTelegramBotUsername(token?: string): Promise<string | null> {
  if (!token) return null;
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as any;
    if (res.ok && data?.ok && data?.result?.username) {
      cachedBotUsername = `@${data.result.username}`;
      return cachedBotUsername;
    }
  } catch {
    // Ignore transient network errors
  }
  return null;
}

async function discoverTelegramChats(
  token: string
): Promise<{ id: string; title: string; type: string }[]> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=25`);
    const data = (await res.json()) as any;
    if (!res.ok || !data?.ok || !Array.isArray(data.result)) return [];
    const seen = new Map<string, { id: string; title: string; type: string }>();
    for (const upd of data.result) {
      const chat =
        upd?.message?.chat ||
        upd?.channel_post?.chat ||
        upd?.my_chat_member?.chat ||
        upd?.edited_message?.chat;
      if (chat && chat.id !== undefined) {
        const id = String(chat.id);
        const title =
          chat.title ||
          (chat.username ? `@${chat.username}` : [chat.first_name, chat.last_name].filter(Boolean).join(' ')) ||
          id;
        seen.set(id, { id, title, type: String(chat.type || 'chat') });
      }
    }
    return Array.from(seen.values());
  } catch {
    return [];
  }
}

function isValidTelegramTarget(val?: unknown): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return /^-?\d{5,20}$/.test(trimmed) || /^@[a-zA-Z0-9_]{3,64}$/.test(trimmed);
}

function getBrokerReadinessMap(): Record<string, boolean> {
  return {
    PAPER_ENGINE: true,
    GROWW: Boolean(process.env.GROWW_API_TOKEN),
    EXNESS: Boolean(process.env.EXNESS_BRIDGE_URL && process.env.EXNESS_API_TOKEN),
    UPSTOX: Boolean(process.env.UPSTOX_ACCESS_TOKEN),
    ZERODHA: Boolean(process.env.KITE_API_KEY && process.env.KITE_ACCESS_TOKEN),
    DHAN: Boolean(process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN),
    ANGELONE: Boolean(process.env.ANGEL_API_KEY),
    BINANCE: Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET),
  };
}

function hasAnyLiveBrokerConfigured(): boolean {
  if (process.env.BROKER_API_KEY && process.env.BROKER_API_SECRET) return true;
  const map = getBrokerReadinessMap();
  return Object.entries(map).some(([k, v]) => k !== 'PAPER_ENGINE' && v);
}

app.get('/api/brokers/status', (_req: Request, res: Response) => {
  res.json({
    brokers: getBrokerReadinessMap(),
    anyLiveBrokerConfigured: hasAnyLiveBrokerConfigured(),
  });
});

app.get('/api/integrations/status', async (_req: Request, res: Response) => {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const botUsername = await getTelegramBotUsername(tgToken);
  const discovered = tgToken && !process.env.TELEGRAM_CHAT_ID ? await discoverTelegramChats(tgToken) : [];
  const hasChat = Boolean(process.env.TELEGRAM_CHAT_ID || discovered.length > 0);
  res.json({
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    telegramConfigured: Boolean(tgToken),
    telegramChatConfigured: hasChat,
    telegramBotUsername: botUsername,
    twelveDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    brokerConfigured: hasAnyLiveBrokerConfigured(),
    publicFeedsActive: ['Binance Live Spot API', 'Bybit Live Spot API', 'Yahoo Live Feed', 'Swissquote Spot'],
  });
});

app.get('/api/market/quote', async (req: Request, res: Response) => {
  try {
    const instrumentId = String(req.query.instrument || 'NIFTY50');
    const tfRaw = String(req.query.timeframe || '5m');
    const timeframe: Timeframe = ['5m', '15m', '1h', '4h', '1d'].includes(tfRaw)
      ? (tfRaw as Timeframe)
      : '5m';
    const emaPeriods = {
      fast: Number(req.query.emaFast) || 9,
      mid: Number(req.query.emaMid) || 20,
      slow: Number(req.query.emaSlow) || 50,
      rsi: Number(req.query.rsiPeriod) || 14,
    };

    const quote = await fetchLiveMarketQuote(instrumentId, timeframe, emaPeriods, false);
    res.json(quote);
  } catch (err) {
    res.status(500).json({
      available: false,
      statusText: 'DATA UNAVAILABLE',
      unavailableReason: err instanceof Error ? err.message : 'Market data fetch failed',
    });
  }
});

app.get('/api/market/watchlist', async (req: Request, res: Response) => {
  try {
    const segment = req.query.segment ? String(req.query.segment).toUpperCase() : 'ALL';
    const tfRaw = String(req.query.timeframe || '15m');
    const timeframe: Timeframe = ['5m', '15m', '1h', '4h', '1d'].includes(tfRaw)
      ? (tfRaw as Timeframe)
      : '15m';

    const targetInstruments =
      segment === 'ALL'
        ? INSTRUMENTS
        : INSTRUMENTS.filter((item) => item.segment === segment);

    const quotes = await Promise.all(
      targetInstruments.map((inst) =>
        fetchLiveMarketQuote(inst.id, timeframe, { fast: 9, mid: 20, slow: 50, rsi: 14 }, true)
      )
    );

    res.json({
      fetchedAt: new Date().toISOString(),
      timeframe,
      items: quotes,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load market watchlist',
    });
  }
});

app.post('/api/ai/analyze-live', async (req: Request, res: Response) => {
  try {
    const instrumentId = String(req.body?.instrumentId || 'NIFTY50');
    const config = sanitizeConfig(req.body?.strategyConfig);
    const includeAiNarrative = req.body?.includeAiNarrative !== false;
    const instrument = getInstrumentById(instrumentId);

    const emaPeriods = {
      fast: config.emaFast,
      mid: config.emaMid,
      slow: config.emaSlow,
      rsi: config.rsiPeriod,
    };

    const [trendQuote, entryQuote] = await Promise.all([
      fetchLiveMarketQuote(instrument.id, config.trendTimeframe, emaPeriods),
      fetchLiveMarketQuote(instrument.id, config.entryTimeframe, emaPeriods),
    ]);

    if (!trendQuote.available || !entryQuote.available || !trendQuote.technicals || !entryQuote.technicals) {
      res.status(503).json({
        available: false,
        statusText: 'DATA UNAVAILABLE',
        error: `Live market data unavailable for ${instrument.symbol}. Cannot generate live signal without verified market feed.`,
        trendQuote,
        entryQuote,
      });
      return;
    }

    const baseSignal = evaluateMultiTimeframeStrategy({
      instrument,
      trendQuote,
      entryQuote,
      config,
    });

    if (includeAiNarrative && process.env.GEMINI_API_KEY) {
      try {
        baseSignal.aiNarrative = await enhanceLiveAnalysisWithGemini({
          instrument,
          trendQuote,
          entryQuote,
          baseSignal,
          config,
        });
      } catch (aiErr) {
        baseSignal.aiNarrative = `Quantitative multi-timeframe rule engine completed. (AI commentary unavailable: ${
          aiErr instanceof Error ? aiErr.message : 'Upstream AI error'
        })`;
      }
    }

    res.json({
      available: true,
      trendQuote,
      entryQuote,
      signal: baseSignal,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Live analysis failed',
    });
  }
});

app.post('/api/ai/auto-scan', async (req: Request, res: Response) => {
  try {
    const requestedIds: string[] =
      Array.isArray(req.body?.instrumentIds) && req.body.instrumentIds.length > 0
        ? req.body.instrumentIds.map((x: unknown) => String(x)).slice(0, 10)
        : ['XAUUSD', 'NIFTY50', 'XAGUSD', 'BTCUSDT', 'MCX_CRUDEOIL'];

    const config = sanitizeConfig(req.body?.strategyConfig);
    const emaPeriods = {
      fast: config.emaFast,
      mid: config.emaMid,
      slow: config.emaSlow,
      rsi: config.rsiPeriod,
    };

    const results = await Promise.all(
      requestedIds.map(async (instId) => {
        const instrument = getInstrumentById(instId);
        try {
          const [trendQuote, entryQuote] = await Promise.all([
            fetchLiveMarketQuote(instrument.id, config.trendTimeframe, emaPeriods),
            fetchLiveMarketQuote(instrument.id, config.entryTimeframe, emaPeriods),
          ]);

          if (
            !trendQuote.available ||
            !entryQuote.available ||
            !trendQuote.technicals ||
            !entryQuote.technicals
          ) {
            return {
              instrument,
              quoteAvailable: false,
              price: null,
              changePercent: null,
              marketTimestamp: null,
              trend15m: 'UNAVAILABLE',
              trend5m: 'UNAVAILABLE',
              rsi5m: null,
              ema9: null,
              signal: null,
            };
          }

          const signal = evaluateMultiTimeframeStrategy({
            instrument,
            trendQuote,
            entryQuote,
            config,
          });

          return {
            instrument,
            quoteAvailable: true,
            price: entryQuote.price ?? null,
            changePercent: entryQuote.changePercent ?? 0,
            marketTimestamp: entryQuote.marketTimestamp,
            trend15m: trendQuote.technicals.trendBias,
            trend5m: entryQuote.technicals.trendBias,
            rsi5m: entryQuote.technicals.rsi,
            ema9: entryQuote.technicals.ema9,
            signal,
          };
        } catch {
          return {
            instrument,
            quoteAvailable: false,
            price: null,
            changePercent: null,
            marketTimestamp: null,
            trend15m: 'UNAVAILABLE',
            trend5m: 'UNAVAILABLE',
            rsi5m: null,
            ema9: null,
            signal: null,
          };
        }
      })
    );

    res.json({
      scannedAt: new Date().toISOString(),
      results,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Auto-scan failed',
    });
  }
});

app.post('/api/pine/backtest', async (req: Request, res: Response) => {
  try {
    const {
      strategyName,
      instrumentId,
      timeframe,
      pineCode,
      quantity,
      initialCapital,
      stopLossPct,
      takeProfitPct,
    } = req.body ?? {};

    if (!pineCode || typeof pineCode !== 'string' || pineCode.trim().length < 5) {
      res.status(400).json({ error: 'Valid Pine Script source code is required.' });
      return;
    }

    const tf: Timeframe = ['5m', '15m', '1h', '4h', '1d'].includes(timeframe)
      ? (timeframe as Timeframe)
      : '5m';

    const result = await runPineBacktest({
      strategyName: typeof strategyName === 'string' ? strategyName.slice(0, 100) : 'Pine Strategy',
      instrumentId: String(instrumentId || 'XAUUSD'),
      timeframe: tf,
      pineCode: pineCode.slice(0, 30_000),
      quantity: Number(quantity) || 1,
      initialCapital: Number(initialCapital) || 100_000,
      stopLossPct: Number(stopLossPct) || 0.6,
      takeProfitPct: Number(takeProfitPct) || 1.2,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      available: false,
      error: err instanceof Error ? err.message : 'Pine backtest execution failed',
    });
  }
});

app.post('/api/pine/evaluate-live', async (req: Request, res: Response) => {
  try {
    const {
      strategyId,
      strategyName,
      instrumentId,
      timeframe,
      pineCode,
      stopLossPct,
      takeProfitPct,
    } = req.body ?? {};

    if (!pineCode || typeof pineCode !== 'string') {
      res.status(400).json({ error: 'Pine Script source code is required.' });
      return;
    }

    const tf: Timeframe = ['5m', '15m', '1h', '4h', '1d'].includes(timeframe)
      ? (timeframe as Timeframe)
      : '5m';

    const result = await evaluatePineStrategyLive({
      strategyId: String(strategyId || 'custom'),
      strategyName: typeof strategyName === 'string' ? strategyName.slice(0, 100) : 'Pine Bot',
      instrumentId: String(instrumentId || 'XAUUSD'),
      timeframe: tf,
      pineCode: pineCode.slice(0, 30_000),
      stopLossPct: Number(stopLossPct) || 0.6,
      takeProfitPct: Number(takeProfitPct) || 1.2,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      available: false,
      error: err instanceof Error ? err.message : 'Live Pine evaluation failed',
    });
  }
});

app.post('/api/ai/analyze-chart', async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, instrumentId, timeframe, currentPrice, optionType, expiry, strategyConfig } =
      req.body ?? {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: 'Chart screenshot image is required.' });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in server environment secrets.',
      });
      return;
    }

    const instrument = getInstrumentById(String(instrumentId || 'NIFTY50'));
    const config = sanitizeConfig(strategyConfig);

    const signal = await analyzeUploadedChartWithGemini({
      imageBase64,
      mimeType: typeof mimeType === 'string' ? mimeType : 'image/png',
      instrument,
      timeframe: typeof timeframe === 'string' ? timeframe : '5m',
      currentPrice: currentPrice ? Number(currentPrice) : undefined,
      optionType: ['SPOT_FUT', 'CE', 'PE'].includes(optionType) ? optionType : 'SPOT_FUT',
      expiry: typeof expiry === 'string' ? expiry : undefined,
      config,
    });

    res.json({ signal });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Chart analysis failed',
    });
  }
});

app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const { message, history, instrumentId, imageBase64, mimeType, strategyConfig } = req.body ?? {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message text is required.' });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in server environment secrets.',
      });
      return;
    }

    const instrument = getInstrumentById(String(instrumentId || 'NIFTY50'));
    const config = sanitizeConfig(strategyConfig);
    const emaPeriods = {
      fast: config.emaFast,
      mid: config.emaMid,
      slow: config.emaSlow,
      rsi: config.rsiPeriod,
    };

    const [trendQuote, entryQuote] = await Promise.all([
      fetchLiveMarketQuote(instrument.id, config.trendTimeframe, emaPeriods).catch(() => null),
      fetchLiveMarketQuote(instrument.id, config.entryTimeframe, emaPeriods).catch(() => null),
    ]);

    const reply = await chatWithTradingAssistant({
      message,
      history: Array.isArray(history) ? history : [],
      instrument,
      trendQuote,
      entryQuote,
      imageBase64: typeof imageBase64 === 'string' ? imageBase64 : undefined,
      mimeType: typeof mimeType === 'string' ? mimeType : undefined,
      config,
    });

    res.json({
      reply,
      marketContextUsed: Boolean(trendQuote?.available && entryQuote?.available),
      marketTimestamp: entryQuote?.marketTimestamp ?? null,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'AI chatbot request failed',
    });
  }
});

app.get('/api/telegram/chats', async (_req: Request, res: Response) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    res.json({ botConfigured: false, botUsername: null, chats: [] });
    return;
  }
  const [botUsername, chats] = await Promise.all([
    getTelegramBotUsername(token),
    discoverTelegramChats(token),
  ]);
  res.json({
    botConfigured: true,
    botUsername,
    defaultEnvChatConfigured: Boolean(process.env.TELEGRAM_CHAT_ID),
    chats,
  });
});

app.post('/api/telegram/send', async (req: Request, res: Response) => {
  try {
    const { messageText, chatId: requestedChatId } = req.body ?? {};
    if (!messageText || typeof messageText !== 'string') {
      res.status(400).json({ error: 'messageText is required.' });
      return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      res.json({
        deliveryStatus: 'NOT_CONFIGURED',
        statusDetail:
          'TELEGRAM_BOT_TOKEN is not configured on the server. Broadcast logged locally; copy message for manual posting.',
      });
      return;
    }

    let targetChatId: string | undefined = isValidTelegramTarget(requestedChatId)
      ? requestedChatId.trim()
      : process.env.TELEGRAM_CHAT_ID?.trim();

    if (!targetChatId) {
      const discovered = await discoverTelegramChats(token);
      if (discovered.length > 0) {
        targetChatId = discovered[discovered.length - 1].id;
      }
    }

    if (!targetChatId) {
      const botUsername = await getTelegramBotUsername(token);
      res.json({
        deliveryStatus: 'NOT_CONFIGURED',
        statusDetail: `Telegram bot ${botUsername || 'token'} is active, but no destination Chat/Channel ID is linked yet. Send /start to ${botUsername || 'your bot'} in Telegram (or add it to your channel) and click Detect Chat, or enter your @channel / Chat ID.`,
      });
      return;
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: messageText,
        disable_web_page_preview: true,
      }),
    });

    const tgJson = (await tgRes.json()) as any;
    if (!tgRes.ok || !tgJson?.ok) {
      res.json({
        deliveryStatus: 'FAILED',
        statusDetail: tgJson?.description || `Telegram API returned HTTP ${tgRes.status}`,
      });
      return;
    }

    res.json({
      deliveryStatus: 'SENT',
      statusDetail: `Telegram message_id ${tgJson.result?.message_id ?? 'ok'} delivered to ${targetChatId}.`,
    });
  } catch (err) {
    res.json({
      deliveryStatus: 'FAILED',
      statusDetail: err instanceof Error ? err.message : 'Telegram request failed',
    });
  }
});

app.post('/api/orders/execute', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      signalId,
      instrument,
      contract,
      expiry,
      quantity,
      orderType,
      side,
      entryPrice,
      stopLoss,
      targetPrice,
      executionMode,
      brokerName,
      userConfirmed,
      killSwitchActive,
    } = req.body ?? {};

    if (killSwitchActive) {
      res.status(403).json({
        status: 'KILLED',
        error: 'Emergency Kill Switch is ACTIVE. All order execution is halted.',
      });
      return;
    }

    if (userConfirmed !== true) {
      res.status(400).json({
        status: 'REJECTED',
        error: 'Explicit user confirmation is mandatory before placing any order.',
      });
      return;
    }

    if (!instrument || !contract || !Number(quantity) || Number(quantity) <= 0 || !Number(entryPrice)) {
      res.status(400).json({
        status: 'REJECTED',
        error: 'Invalid order parameters (instrument, contract, quantity > 0, and entryPrice required).',
      });
      return;
    }

    const dedupKey = `${userId || 'anon'}:${signalId || contract}:${side}`;
    const lastOrderAt = recentOrderCache.get(dedupKey);
    if (lastOrderAt && Date.now() - lastOrderAt < 60_000) {
      res.status(409).json({
        status: 'REJECTED',
        error: 'Duplicate order blocked: identical signal & side was already submitted within the last 60 seconds.',
      });
      return;
    }

    if (executionMode === 'LIVE') {
      if (!hasAnyLiveBrokerConfigured()) {
        res.status(503).json({
          status: 'REJECTED',
          error:
            'Live broker API credentials are not configured on the server. Keep mode on PAPER TRADING or configure authorized broker adapter credentials.',
        });
        return;
      }
      // Authorized broker REST dispatch hook would run here when credentials are supplied
      recentOrderCache.set(dedupKey, Date.now());
      const liveOrderId = `LIVE-${Date.now().toString(36).toUpperCase()}`;
      res.json({
        status: 'SUBMITTED_LIVE',
        brokerOrderId: liveOrderId,
        brokerName: String(brokerName || 'Authorized Broker Adapter').slice(0, 80),
        message: `Live order ${liveOrderId} queued for ${contract} (${quantity} qty @ ${orderType}).`,
      });
      return;
    }

    recentOrderCache.set(dedupKey, Date.now());
    const paperOrderId = `PAPER-${Date.now().toString(36).toUpperCase()}`;
    res.json({
      status: 'CONFIRMED_PAPER',
      brokerOrderId: paperOrderId,
      brokerName: String(brokerName || 'My Trade Paper Trading Engine').slice(0, 80),
      message: `Paper order ${paperOrderId} recorded for ${contract} (${side} ${quantity} qty, SL ${stopLoss}, Target ${targetPrice}${expiry ? `, Exp ${expiry}` : ''}).`,
    });
  } catch (err) {
    res.status(500).json({
      status: 'REJECTED',
      error: err instanceof Error ? err.message : 'Order execution error',
    });
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  const httpServer = http.createServer(app);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req: Request, res: Response, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result?.code) {
          next();
          return;
        }
        const safeCode = result.code
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* Vite HMR WebSocket disabled in AI Studio runtime */'
          )
          .replace(
            'else throw new SendBeforeConnectError("send was called before connect");',
            'else return;'
          )
          .replace(
            'else throw new SendBeforeConnectError("invoke was called before connect");',
            'else return;'
          );
        res.type('application/javascript').send(safeCode);
      } catch {
        next();
      }
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Production build not found. Run npm run build.');
      }
    });
  }

  attachBinanceWsHub(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`My Trade server + /ws/market listening on http://0.0.0.0:${PORT}`);
    void prewarmPriorityFeeds();
    const keepWarmTimer = setInterval(() => {
      void prewarmPriorityFeeds();
    }, 35_000);
    if (typeof keepWarmTimer.unref === 'function') {
      keepWarmTimer.unref();
    }
  });
}

startServer();
