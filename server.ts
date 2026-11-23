import 'dotenv/config';
import crypto from 'crypto';
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
} from './server/geminiService.ts';
import { fetchFreeLiveMarketNews } from './server/newsService.ts';
import { getEconomicCalendarSnapshot } from './server/economicCalendarService.ts';
import {
  getGlobalMonitorStats,
  getMonitoredStatusForOwner,
  removeMonitoredPosition,
  startPositionMonitorWorker,
  syncMonitoredPositions,
} from './server/positionMonitorService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '15mb' }));

// Duplicate order guard cache (userId:signalId:side -> timestamp) with automatic TTL pruning
const recentOrderCache = new Map<string, number>();

function pruneRecentOrderCache(now = Date.now()) {
  for (const [k, ts] of recentOrderCache.entries()) {
    if (now - ts >= 60_000) {
      recentOrderCache.delete(k);
    }
  }
}

// Cryptographic Firebase Auth ID token verifier (uses Google's public X.509 certs, zero IAM needed)
interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
}

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedFirebaseProjectId: string | null = null;
let cachedFirebaseCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

function getFirebaseProjectId(): string {
  if (cachedFirebaseProjectId) return cachedFirebaseProjectId;
  try {
    const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
    cachedFirebaseProjectId = raw.projectId || process.env.FIREBASE_PROJECT_ID || '';
  } catch {
    cachedFirebaseProjectId = process.env.FIREBASE_PROJECT_ID || '';
  }
  return cachedFirebaseProjectId;
}

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedFirebaseCerts && cachedFirebaseCerts.expiresAt > now) {
    return cachedFirebaseCerts.certs;
  }
  const res = await fetch(FIREBASE_CERTS_URL, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase auth certificates (HTTP ${res.status})`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) * 1000 : 3600_000;
  const certs = (await res.json()) as Record<string, string>;
  cachedFirebaseCerts = { certs, expiresAt: now + ttlMs };
  return certs;
}

async function verifyFirebaseRequestUser(req: Request): Promise<VerifiedFirebaseUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const projectId = getFirebaseProjectId();
    if (!projectId) return null;

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean;
    };

    if (header.alg !== 'RS256' || !header.kid) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) return null;
    if (payload.aud !== projectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) return null;

    const certs = await getFirebasePublicCerts();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const signature = Buffer.from(parts[2], 'base64url');
    const signedData = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
    const verified = crypto.verify('RSA-SHA256', signedData, certPem, signature);
    if (!verified) return null;

    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      emailVerified: payload.email_verified === true,
    };
  } catch {
    return null;
  }
}

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
    adxMinThreshold: Math.max(
      10,
      Math.min(50, Number(raw?.adxMinThreshold ?? DEFAULT_STRATEGY_CONFIG.adxMinThreshold))
    ),
    enableSessionFilter:
      typeof raw?.enableSessionFilter === 'boolean'
        ? raw.enableSessionFilter
        : DEFAULT_STRATEGY_CONFIG.enableSessionFilter,
    pauseOnHighImpactNews:
      typeof raw?.pauseOnHighImpactNews === 'boolean'
        ? raw.pauseOnHighImpactNews
        : DEFAULT_STRATEGY_CONFIG.pauseOnHighImpactNews,
    enablePartialProfitBooking:
      typeof raw?.enablePartialProfitBooking === 'boolean'
        ? raw.enablePartialProfitBooking
        : DEFAULT_STRATEGY_CONFIG.enablePartialProfitBooking,
    dailyMaxLossPct: Math.max(
      0.5,
      Math.min(25, Number(raw?.dailyMaxLossPct ?? DEFAULT_STRATEGY_CONFIG.dailyMaxLossPct))
    ),
    dailyProfitTargetPct: Math.max(
      1,
      Math.min(50, Number(raw?.dailyProfitTargetPct ?? DEFAULT_STRATEGY_CONFIG.dailyProfitTargetPct))
    ),
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

app.get('/MyTrade.apk', (_req: Request, res: Response) => {
  const candidates = [
    path.resolve(__dirname, 'public', 'MyTrade.apk'),
    path.resolve(__dirname, 'dist', 'MyTrade.apk'),
  ];
  const apkPath = candidates.find((p) => fs.existsSync(p));
  if (!apkPath) {
    res.status(404).json({ error: 'MyTrade.apk package not found on server.' });
    return;
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="MyTrade.apk"');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(apkPath);
});

const liveNewsCache = new Map<string, { expiresAt: number; payload: LiveMarketNewsResponse }>();

app.get('/api/news/live', async (req: Request, res: Response) => {
  try {
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

    const news = await fetchFreeLiveMarketNews({ category, query });
    liveNewsCache.set(cacheKey, {
      expiresAt: Date.now() + 90_000, // 90-second cache for free feeds
      payload: news,
    });
    res.json({ ...news, cached: false });
  } catch (err: any) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch live market news feeds.',
    });
  }
});

app.get('/api/calendar/economic', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const snapshot = await getEconomicCalendarSnapshot(forceRefresh);
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load economic calendar.',
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

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:')
  ) {
    return true;
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return true;
    }
  }
  return false;
}

function validateExnessBridgeUrl(rawUrl?: string): URL | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (isBlockedHostname(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getBrokerReadinessMap(): Record<string, boolean> {
  const validExnessUrl = Boolean(validateExnessBridgeUrl(process.env.EXNESS_BRIDGE_URL));
  return {
    PAPER_ENGINE: true,
    GROWW: Boolean(process.env.GROWW_API_TOKEN),
    EXNESS: Boolean(validExnessUrl && process.env.EXNESS_API_TOKEN),
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

app.get('/api/brokers/exness/status', (_req: Request, res: Response) => {
  const parsedUrl = validateExnessBridgeUrl(process.env.EXNESS_BRIDGE_URL);
  const hasToken = Boolean(process.env.EXNESS_API_TOKEN);
  const rawAcc = process.env.EXNESS_ACCOUNT_ID?.trim() || '';
  const accountMasked =
    rawAcc.length >= 4 ? `${'*'.repeat(Math.max(2, rawAcc.length - 4))}${rawAcc.slice(-4)}` : null;

  res.json({
    configured: Boolean(parsedUrl && hasToken),
    bridgeUrlValid: Boolean(parsedUrl),
    bridgeHost: parsedUrl ? parsedUrl.hostname : null,
    serverName: process.env.EXNESS_SERVER?.trim() || null,
    accountMasked,
  });
});

app.post('/api/brokers/exness/test', async (req: Request, res: Response) => {
  const verifiedUser = await verifyFirebaseRequestUser(req);
  if (!verifiedUser || !verifiedUser.emailVerified) {
    res.status(401).json({
      connected: false,
      message: 'Sign in with your verified Google account to test the live Exness MT5 Bridge.',
    });
    return;
  }

  const parsedUrl = validateExnessBridgeUrl(process.env.EXNESS_BRIDGE_URL);
  const token = process.env.EXNESS_API_TOKEN?.trim();

  if (!parsedUrl || !token) {
    res.status(400).json({
      connected: false,
      message:
        'Exness MT5 Bridge is not configured yet. Add HTTPS EXNESS_BRIDGE_URL and EXNESS_API_TOKEN in server environment secrets.',
    });
    return;
  }

  try {
    const base = parsedUrl.toString().replace(/\/+$/, '');
    const healthRes = await fetch(`${base}/health`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!healthRes.ok) {
      res.status(502).json({
        connected: false,
        message: `Exness MT5 Bridge responded with HTTP ${healthRes.status}. Verify your token and bridge /health route.`,
      });
      return;
    }

    const payload = (await healthRes.json().catch(() => ({}))) as Record<string, unknown>;
    res.json({
      connected: true,
      bridgeHost: parsedUrl.hostname,
      serverName:
        (typeof payload.server === 'string' && payload.server) ||
        process.env.EXNESS_SERVER?.trim() ||
        'Exness MT5 Bridge',
      balance: typeof payload.balance === 'number' ? payload.balance : undefined,
      currency: typeof payload.currency === 'string' ? payload.currency : 'USD',
      message: 'Connected to Exness MT5 Execution Bridge successfully.',
    });
  } catch (err) {
    res.status(502).json({
      connected: false,
      message:
        err instanceof Error
          ? `Could not reach Exness MT5 Bridge: ${err.message}`
          : 'Exness MT5 Bridge connection timed out.',
    });
  }
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
    publicFeedsActive: [
      'Binance Live Spot API',
      'Bybit Live Spot API',
      'Yahoo Live Feed',
      'Yahoo News & Market RSS',
      'Swissquote Spot',
    ],
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
      riskPerTradePct,
      trailingStop,
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
      stopLossPct: Number(stopLossPct) || 0.55,
      takeProfitPct: Number(takeProfitPct) || 1.65,
      riskPerTradePct:
        riskPerTradePct !== undefined && Number.isFinite(Number(riskPerTradePct))
          ? Number(riskPerTradePct)
          : 2.5,
      trailingStop: trailingStop !== false,
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

app.get('/api/telegram/chats', async (req: Request, res: Response) => {
  const verifiedUser = await verifyFirebaseRequestUser(req);
  if (!verifiedUser || !verifiedUser.emailVerified) {
    res.status(401).json({ error: 'Sign in with Google to detect Telegram bot chats.' });
    return;
  }
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
    const verifiedUser = await verifyFirebaseRequestUser(req);
    if (!verifiedUser || !verifiedUser.emailVerified) {
      res.status(401).json({
        deliveryStatus: 'FAILED',
        statusDetail: 'Sign in with Google before broadcasting alerts via the server Telegram bot.',
      });
      return;
    }

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
      target2,
      target3,
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

    pruneRecentOrderCache();
    const verifiedUser = await verifyFirebaseRequestUser(req);
    const effectiveUserId = verifiedUser?.uid || (executionMode === 'LIVE' ? '' : String(userId || 'anon'));

    if (executionMode === 'LIVE') {
      if (!verifiedUser || !verifiedUser.emailVerified) {
        res.status(401).json({
          status: 'REJECTED',
          error: 'Verified Google Sign-In is required before submitting Actual Live broker orders.',
        });
        return;
      }
    }

    const dedupKey = `${effectiveUserId || 'anon'}:${signalId || contract}:${side}`;
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
            'No Live Broker / Exness MT5 Bridge credentials are configured on the server. Connect Exness MT5 Bridge via server secrets or switch to your Demo Account.',
        });
        return;
      }

      const exnessUrl = validateExnessBridgeUrl(process.env.EXNESS_BRIDGE_URL);
      const exnessToken = process.env.EXNESS_API_TOKEN?.trim();
      const brokerLabelStr = String(brokerName || 'Authorized Broker Adapter').slice(0, 80);
      const wantsExness =
        Boolean(exnessUrl && exnessToken) &&
        (brokerLabelStr.toLowerCase().includes('exness') ||
          !process.env.BROKER_API_KEY);

      if (wantsExness && exnessUrl && exnessToken) {
        const base = exnessUrl.toString().replace(/\/+$/, '');
        const bridgeRes = await fetch(`${base}/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${exnessToken}`,
          },
          body: JSON.stringify({
            symbol: String(instrument),
            contract: String(contract),
            side: side === 'SELL' ? 'SELL' : 'BUY',
            orderType: String(orderType || 'MARKET'),
            volume: Number(quantity),
            entryPrice: Number(entryPrice),
            stopLoss: Number(stopLoss),
            tp1: Number(targetPrice),
            tp2: target2 ? Number(target2) : undefined,
            tp3: target3 ? Number(target3) : undefined,
            accountId: process.env.EXNESS_ACCOUNT_ID?.trim() || undefined,
            server: process.env.EXNESS_SERVER?.trim() || undefined,
          }),
          signal: AbortSignal.timeout(8000),
        });

        const bridgeJson = (await bridgeRes.json().catch(() => ({}))) as Record<string, unknown>;
        if (!bridgeRes.ok) {
          res.status(502).json({
            status: 'REJECTED',
            error:
              (typeof bridgeJson.error === 'string' && bridgeJson.error) ||
              `Exness MT5 Bridge rejected live order (HTTP ${bridgeRes.status}).`,
          });
          return;
        }

        recentOrderCache.set(dedupKey, Date.now());
        const liveOrderId =
          (typeof bridgeJson.orderId === 'string' && bridgeJson.orderId) ||
          (typeof bridgeJson.ticket === 'number' && `EXN-${bridgeJson.ticket}`) ||
          `EXN-${Date.now().toString(36).toUpperCase()}`;

        res.json({
          status: 'SUBMITTED_LIVE',
          brokerOrderId: liveOrderId,
          brokerName: 'Exness MT5 Live Bridge',
          message: `Live order ${liveOrderId} transmitted to Exness MT5 (${side} ${quantity} ${contract}, SL ${stopLoss}, TP1 ${targetPrice}${target2 ? ` / TP2 ${target2}` : ''}${target3 ? ` / TP3 ${target3}` : ''}).`,
        });
        return;
      }

      res.status(501).json({
        status: 'REJECTED',
        error: `Direct automated live order transmission is currently enabled for the Exness MT5 Bridge. Configure EXNESS_BRIDGE_URL + EXNESS_API_TOKEN for live execution, or place ${brokerLabelStr} orders in Demo Paper mode.`,
      });
      return;
    }

    recentOrderCache.set(dedupKey, Date.now());
    const paperOrderId = `PAPER-${Date.now().toString(36).toUpperCase()}`;
    res.json({
      status: 'CONFIRMED_PAPER',
      brokerOrderId: paperOrderId,
      brokerName: String(brokerName || 'My Trade Paper Trading Engine').slice(0, 80),
      message: `Paper order ${paperOrderId} recorded for ${contract} (${side} ${quantity} qty, SL ${stopLoss}, TP1 ${targetPrice}${target2 ? ` · TP2 ${target2}` : ''}${target3 ? ` · TP3 ${target3}` : ''}${expiry ? `, Exp ${expiry}` : ''}).`,
    });
  } catch (err) {
    res.status(500).json({
      status: 'REJECTED',
      error: err instanceof Error ? err.message : 'Order execution error',
    });
  }
});

app.post('/api/orders/trail-sl', async (req: Request, res: Response) => {
  try {
    const verifiedUser = await verifyFirebaseRequestUser(req);
    if (!verifiedUser || !verifiedUser.emailVerified) {
      res.status(401).json({ ok: false, error: 'Verified Google Sign-In is required to modify live Stop-Loss orders.' });
      return;
    }

    const { brokerOrderId, instrument, newStopLoss, tpStage } = req.body ?? {};
    if (!brokerOrderId || !Number.isFinite(Number(newStopLoss))) {
      res.status(400).json({ ok: false, error: 'brokerOrderId and numeric newStopLoss are required.' });
      return;
    }

    const exnessUrl = validateExnessBridgeUrl(process.env.EXNESS_BRIDGE_URL);
    const exnessToken = process.env.EXNESS_API_TOKEN?.trim();
    if (!exnessUrl || !exnessToken) {
      res.json({ ok: false, skipped: true, reason: 'No live Exness MT5 bridge configured.' });
      return;
    }

    const base = exnessUrl.toString().replace(/\/+$/, '');
    const modRes = await fetch(`${base}/orders/modify-sl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${exnessToken}`,
      },
      body: JSON.stringify({
        orderId: String(brokerOrderId),
        symbol: String(instrument || ''),
        stopLoss: Number(newStopLoss),
        tpStage: Number(tpStage) || 1,
      }),
      signal: AbortSignal.timeout(8000),
    });

    res.json({ ok: modRes.ok, status: modRes.status });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to trail SL on Exness bridge.',
    });
  }
});

function sanitizeGuestSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(trimmed) ? `guest:${trimmed}` : null;
}

app.post('/api/monitor/positions/sync', async (req: Request, res: Response) => {
  try {
    const positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
    const hasLivePosition = positions.some((p: any) => p?.executionMode === 'LIVE');
    const verifiedUser = await verifyFirebaseRequestUser(req);

    if (hasLivePosition && (!verifiedUser || !verifiedUser.emailVerified)) {
      res.status(401).json({
        ok: false,
        error: 'Verified Google Sign-In is required to register LIVE positions on the 24/7 server monitor.',
      });
      return;
    }

    const ownerKey = verifiedUser?.uid
      ? `uid:${verifiedUser.uid}`
      : sanitizeGuestSessionId(req.body?.sessionId);

    if (!ownerKey) {
      res.status(400).json({
        ok: false,
        error: 'Sign in or provide a valid guest sessionId to sync positions.',
      });
      return;
    }

    const sanitized = positions
      .filter((p: any) => p && typeof p.tradeId === 'string' && typeof p.instrumentId === 'string')
      .slice(0, 30)
      .map((p: any) => ({
        tradeId: String(p.tradeId).slice(0, 128),
        instrumentId: String(p.instrumentId).slice(0, 40),
        symbol: String(p.symbol || p.instrumentId).slice(0, 40),
        contract: String(p.contract || p.instrumentId).slice(0, 80),
        direction: p.direction === 'SELL' ? ('SELL' as const) : ('BUY' as const),
        executionMode:
          p.executionMode === 'LIVE' && verifiedUser?.emailVerified
            ? ('LIVE' as const)
            : ('PAPER' as const),
        entryPrice: Number(p.entryPrice) || 0,
        stopLoss: Number(p.stopLoss) || 0,
        target1: Number(p.target1) || 0,
        target2: Number(p.target2) || 0,
        target3: Number(p.target3) || 0,
        tpStage: ([0, 1, 2].includes(Number(p.tpStage)) ? Number(p.tpStage) : 0) as 0 | 1 | 2,
        quantity: Math.max(0.0001, Number(p.quantity) || 1),
        remainingQuantity: Math.max(0, Number(p.remainingQuantity ?? p.quantity) || 0),
        partialRealizedPnl: Number(p.partialRealizedPnl) || 0,
        enablePartialProfitBooking: p.enablePartialProfitBooking !== false,
        brokerOrderId: typeof p.brokerOrderId === 'string' ? p.brokerOrderId.slice(0, 80) : undefined,
      }));

    const result = syncMonitoredPositions(ownerKey, sanitized);
    res.json({
      ok: true,
      ...result,
      worker: getGlobalMonitorStats(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Position monitor sync failed.',
    });
  }
});

app.get('/api/monitor/positions', async (req: Request, res: Response) => {
  try {
    const verifiedUser = await verifyFirebaseRequestUser(req);
    const ownerKey = verifiedUser?.uid
      ? `uid:${verifiedUser.uid}`
      : sanitizeGuestSessionId(req.query.sessionId);

    if (!ownerKey) {
      res.json({ ok: true, activeCount: 0, positions: [], pendingEvents: [], worker: getGlobalMonitorStats() });
      return;
    }

    const status = getMonitoredStatusForOwner(ownerKey);
    res.json({
      ok: true,
      ...status,
      worker: getGlobalMonitorStats(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to read monitored positions.',
    });
  }
});

app.delete('/api/monitor/positions/:tradeId', async (req: Request, res: Response) => {
  const verifiedUser = await verifyFirebaseRequestUser(req);
  const ownerKey = verifiedUser?.uid
    ? `uid:${verifiedUser.uid}`
    : sanitizeGuestSessionId(req.query.sessionId);

  if (!ownerKey) {
    res.status(401).json({ ok: false, error: 'Unauthorized monitor removal request.' });
    return;
  }

  const removed = removeMonitoredPosition(ownerKey, String(req.params.tradeId || '').slice(0, 128));
  res.json({ ok: true, removed });
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
  startPositionMonitorWorker();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`My Trade server + /ws/market + 24/7 SL Monitor listening on http://0.0.0.0:${PORT}`);
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
