import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  GeneratedSignalPayload,
  GroundingSource,
  InstrumentMeta,
  LiveMarketNewsResponse,
  MarketNewsCategory,
  MarketNewsItem,
  MarketQuoteResponse,
  StrategyConfig,
} from '../src/types/trading.ts';
import { buildAtmOptionRecommendation, formatSignalBlock } from './strategyEngine.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildStrategySystemRules(config: StrategyConfig): string {
  return `You are the institutional quantitative analyst for My Trade — AI TRADING TERMINAL.
You MUST strictly enforce this customized trading strategy in every analysis:

1. MULTI-TIMEFRAME RULES:
- Primary Trend Timeframe: ${config.trendTimeframe} (determine overall directional bias).
- Entry Timeframe: ${config.entryTimeframe} (identify exact breakout/breakdown or reversal entry).
- NEVER generate an entry without verifying ${config.trendTimeframe} trend alignment.
- Prefer setups where both timeframes confirm the exact same direction.

2. TECHNICAL INDICATORS:
- EMA ${config.emaFast}, EMA ${config.emaMid}, EMA ${config.emaSlow}
- VWAP, RSI(${config.rsiPeriod}) [Bullish >= ${config.rsiBullishMin}, Bearish <= ${config.rsiBearishMax}], MACD
- Volume confirmation, Support & Resistance, Breakout/Breakdown, Candlestick patterns, Momentum.
- COMEX / WTI / MCX Crude Oil Rule: ${config.comexCrudeEma9Priority ? 'Give special high priority to EMA 9.' : 'Standard EMA stack.'}

3. OPTIONS & STRIKE DISCIPLINE:
- For Indian indices (NIFTY 50, BANK NIFTY, SENSEX), ${config.prioritizeAtmOptions ? 'STRICTLY prioritize ATM and near-ATM CE/PE strikes. Never suggest far OTM lottery strikes.' : 'Evaluate ATM/ITM options.'}

4. RISK MANAGEMENT & NO-TRADE DISCIPLINE:
- Minimum Setup Quality Score: ${config.minSetupScore}/100.
- Minimum Risk-to-Reward: 1:${config.minRiskReward}.
- Every valid trade must include Entry, Stop-Loss, Target 1, Target 2 (Target 3 only when structurally justified), Risk/Reward, Invalidation Level, and INTRADAY horizon.
- NEVER invent arbitrary targets or stop-losses. Derive from visible structure, swing highs/lows, S/R, and volatility.
- NEVER describe the setup quality score as a guaranteed probability or verified win rate.
- If confirmation is insufficient or timeframes conflict, output direction = "NO_TRADE" and status = "NO_TRADE".`;
}

export async function analyzeUploadedChartWithGemini(params: {
  imageBase64: string;
  mimeType: string;
  instrument: InstrumentMeta;
  timeframe: string;
  currentPrice?: number;
  optionType: 'SPOT_FUT' | 'CE' | 'PE';
  expiry?: string;
  config: StrategyConfig;
}): Promise<GeneratedSignalPayload> {
  const ai = getGeminiClient();
  const { imageBase64, mimeType, instrument, timeframe, currentPrice, optionType, expiry, config } = params;

  const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  const prompt = `Visually inspect this uploaded trading chart image carefully.
Context provided by the trader:
- Instrument: ${instrument.symbol} (${instrument.name}, Exchange: ${instrument.exchangeLabel}, Currency: ${instrument.currency})
- Chart Timeframe Shown: ${timeframe}
- User-Entered Current Market Price: ${currentPrice && currentPrice > 0 ? `${instrument.currency}${currentPrice}` : 'Not provided by user'}
- Contract Mode: ${optionType}${expiry ? ` | Expiry: ${expiry}` : ''}

STRICT HONESTY RULE:
- Do NOT pretend to read indicator numbers, exact prices, or volume bars that are NOT clearly legible in the screenshot.
- Separate everything into "verifiedFromChart" (directly visible in the image or user-provided) vs "estimatedOrNotVisible" (e.g., if EMAs, VWAP, RSI, or 15m higher-timeframe trend are not visible in a single 5m screenshot, explicitly state they are not visible and require multi-timeframe check before execution!).
- If the screenshot shows only 5m without 15m confirmation, either note that 15m confirmation is unverified in the screenshot or recommend WAIT / NO_TRADE unless structural alignment is clear and user-verified.
- Calculate Immediate/Strong Support & Resistance, Breakout/Breakdown levels, No-Trade Zone, Entry, Stop-Loss, Target 1, Target 2, optional Target 3, Invalidation Level, and a transparent 0-100 Setup Quality Score.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType || 'image/png',
            data: cleanBase64,
          },
        },
        { text: prompt },
      ],
    },
    config: {
      systemInstruction: buildStrategySystemRules(config),
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          direction: { type: Type.STRING, enum: ['BUY', 'SELL', 'NO_TRADE'] },
          status: { type: Type.STRING, enum: ['ACTIVE', 'WAIT', 'INVALIDATED', 'NO_TRADE'] },
          contract: { type: Type.STRING },
          entryTrigger: { type: Type.STRING },
          entryPrice: { type: Type.NUMBER },
          stopLoss: { type: Type.NUMBER },
          target1: { type: Type.NUMBER },
          target2: { type: Type.NUMBER },
          target3: { type: Type.NUMBER },
          invalidationLevel: { type: Type.NUMBER },
          riskReward: { type: Type.STRING },
          qualityScore: { type: Type.INTEGER },
          marketStructure: { type: Type.STRING },
          trendDirection: { type: Type.STRING },
          candlestickPatterns: { type: Type.STRING },
          confirmationText: { type: Type.STRING },
          verifiedFromChart: { type: Type.ARRAY, items: { type: Type.STRING } },
          estimatedOrNotVisible: { type: Type.ARRAY, items: { type: Type.STRING } },
          reasonsFor: { type: Type.ARRAY, items: { type: Type.STRING } },
          reasonsAgainst: { type: Type.ARRAY, items: { type: Type.STRING } },
          checklist: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                passed: { type: Type.BOOLEAN },
                detail: { type: Type.STRING },
              },
            },
          },
        },
        required: [
          'direction',
          'status',
          'contract',
          'entryPrice',
          'stopLoss',
          'target1',
          'target2',
          'riskReward',
          'qualityScore',
          'confirmationText',
          'verifiedFromChart',
          'estimatedOrNotVisible',
          'reasonsFor',
          'reasonsAgainst',
          'checklist',
        ],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText);

  const score = Math.max(0, Math.min(100, Number(parsed.qualityScore ?? 0)));
  const shouldForceNoTrade =
    parsed.direction === 'NO_TRADE' || score < config.minSetupScore;
  const finalDirection: 'BUY' | 'SELL' | 'NO_TRADE' = shouldForceNoTrade
    ? 'NO_TRADE'
    : parsed.direction;
  const finalStatus = shouldForceNoTrade ? 'NO_TRADE' : (parsed.status || 'WAIT');

  const refPrice = currentPrice && currentPrice > 0 ? currentPrice : Number(parsed.entryPrice || 0);
  const atmContext = refPrice > 0 ? buildAtmOptionRecommendation(instrument, refPrice, finalDirection) : undefined;
  const contractLabel =
    parsed.contract ||
    (optionType !== 'SPOT_FUT' && atmContext
      ? `${atmContext.recommendedStrike} ${optionType}${expiry ? ` (${expiry})` : ''}`
      : `${instrument.symbol} (${optionType})`);

  const formatted = formatSignalBlock({
    instrument: instrument.symbol,
    contract: contractLabel,
    direction: finalDirection,
    currency: instrument.currency,
    entryPrice: Number(parsed.entryPrice || 0),
    target1: Number(parsed.target1 || 0),
    target2: Number(parsed.target2 || 0),
    target3: parsed.target3 ? Number(parsed.target3) : undefined,
    stopLoss: Number(parsed.stopLoss || 0),
    entryTimeframe: timeframe,
    trendTimeframe: config.trendTimeframe,
    horizon: 'INTRADAY',
    riskReward: parsed.riskReward || 'N/A',
    confirmationText: parsed.confirmationText || 'Insufficient chart confirmation.',
    status: finalStatus,
  });

  return {
    instrument: instrument.symbol,
    marketSegment: instrument.segment,
    contract: contractLabel,
    direction: finalDirection,
    entryTrigger:
      parsed.entryTrigger ||
      (finalDirection === 'BUY' ? 'BUY ABOVE' : finalDirection === 'SELL' ? 'SELL BELOW' : 'NO TRADE'),
    entryPrice: finalDirection === 'NO_TRADE' ? 0 : Number(parsed.entryPrice || 0),
    stopLoss: finalDirection === 'NO_TRADE' ? 0 : Number(parsed.stopLoss || 0),
    target1: finalDirection === 'NO_TRADE' ? 0 : Number(parsed.target1 || 0),
    target2: finalDirection === 'NO_TRADE' ? 0 : Number(parsed.target2 || 0),
    target3: finalDirection === 'NO_TRADE' ? undefined : parsed.target3 ? Number(parsed.target3) : undefined,
    riskReward: parsed.riskReward || 'N/A',
    entryTimeframe: timeframe.toUpperCase(),
    trendTimeframe: config.trendTimeframe.toUpperCase(),
    horizon: 'INTRADAY',
    invalidationLevel: Number(parsed.invalidationLevel || parsed.stopLoss || 0),
    confirmationText: parsed.confirmationText || '',
    status: finalStatus,
    qualityScore: score,
    checklist: Array.isArray(parsed.checklist) ? parsed.checklist : [],
    reasonsFor: Array.isArray(parsed.reasonsFor) ? parsed.reasonsFor : [],
    reasonsAgainst: Array.isArray(parsed.reasonsAgainst) ? parsed.reasonsAgainst : [],
    formattedSignalText: formatted.formattedSignalText,
    telegramReadyText: formatted.telegramReadyText,
    atmOptionContext: atmContext,
    aiNarrative: [parsed.marketStructure, parsed.trendDirection, parsed.candlestickPatterns]
      .filter(Boolean)
      .join(' · '),
    verifiedVsEstimated: {
      verifiedFromDataOrChart: Array.isArray(parsed.verifiedFromChart) ? parsed.verifiedFromChart : [],
      estimatedOrNotVisible: Array.isArray(parsed.estimatedOrNotVisible) ? parsed.estimatedOrNotVisible : [],
    },
  };
}

export async function enhanceLiveAnalysisWithGemini(params: {
  instrument: InstrumentMeta;
  trendQuote: MarketQuoteResponse;
  entryQuote: MarketQuoteResponse;
  baseSignal: GeneratedSignalPayload;
  config: StrategyConfig;
}): Promise<string> {
  const ai = getGeminiClient();
  const { instrument, trendQuote, entryQuote, baseSignal, config } = params;

  const prompt = `Provide a crisp, institutional 3-sentence quantitative commentary on this LIVE market snapshot for ${instrument.symbol}:
- 15m Trend (${trendQuote.marketTimestamp}): Price=${trendQuote.price}, TrendBias=${trendQuote.technicals?.trendBias}, EMA9=${trendQuote.technicals?.ema9}, EMA20=${trendQuote.technicals?.ema20}, EMA50=${trendQuote.technicals?.ema50}, RSI=${trendQuote.technicals?.rsi}, MACD_Hist=${trendQuote.technicals?.macd?.histogram}
- 5m Entry (${entryQuote.marketTimestamp}): Price=${entryQuote.price}, Pattern=${entryQuote.technicals?.candlePattern}, VWAP=${entryQuote.technicals?.vwap}, VolRatio=${entryQuote.technicals?.volumeRatio}x
- S/R Levels: ImmSup=${entryQuote.levels?.immediateSupport}, StrongSup=${entryQuote.levels?.strongSupport}, ImmRes=${entryQuote.levels?.immediateResistance}, StrongRes=${entryQuote.levels?.strongResistance}, NoTradeZone=${entryQuote.levels?.noTradeZoneLow}-${entryQuote.levels?.noTradeZoneHigh}
- Deterministic Strategy Engine Decision: ${baseSignal.direction} (${baseSignal.status}), Score=${baseSignal.qualityScore}/100, Entry=${baseSignal.entryPrice}, SL=${baseSignal.stopLoss}, T1=${baseSignal.target1}, T2=${baseSignal.target2}.
Do not invent any new prices; explain the exact technical alignment or why NO TRADE is enforced.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction: buildStrategySystemRules(config),
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  return (response.text ?? '').trim();
}

export async function chatWithTradingAssistant(params: {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  instrument: InstrumentMeta;
  trendQuote?: MarketQuoteResponse | null;
  entryQuote?: MarketQuoteResponse | null;
  imageBase64?: string;
  mimeType?: string;
  config: StrategyConfig;
}): Promise<string> {
  const ai = getGeminiClient();
  const { message, history, instrument, trendQuote, entryQuote, imageBase64, mimeType, config } = params;

  const marketContextBlock =
    trendQuote?.available && entryQuote?.available
      ? `LIVE VERIFIED MARKET DATA FOR ${instrument.symbol} (${instrument.exchangeLabel}):
- 15m (${trendQuote.marketTimestamp}, Provider: ${trendQuote.provider}): Price=${instrument.currency}${trendQuote.price}, Change=${trendQuote.changePercent}%, Trend=${trendQuote.technicals?.trendBias}, EMA9=${trendQuote.technicals?.ema9}, EMA20=${trendQuote.technicals?.ema20}, EMA50=${trendQuote.technicals?.ema50}, RSI=${trendQuote.technicals?.rsi}, MACD_Hist=${trendQuote.technicals?.macd?.histogram}
- 5m (${entryQuote.marketTimestamp}): Price=${instrument.currency}${entryQuote.price}, Open=${entryQuote.open}, High=${entryQuote.high}, Low=${entryQuote.low}, PrevClose=${entryQuote.previousClose}, VWAP=${entryQuote.technicals?.vwap}, Pattern=${entryQuote.technicals?.candlePattern}, VolRatio=${entryQuote.technicals?.volumeRatio}x
- Levels: StrongSup=${entryQuote.levels?.strongSupport}, ImmSup=${entryQuote.levels?.immediateSupport}, ImmRes=${entryQuote.levels?.immediateResistance}, StrongRes=${entryQuote.levels?.strongResistance}, Breakout=${entryQuote.levels?.breakoutLevel}, Breakdown=${entryQuote.levels?.breakdownLevel}, NoTradeZone=${entryQuote.levels?.noTradeZoneLow}-${entryQuote.levels?.noTradeZoneHigh}`
      : `LIVE MARKET DATA STATUS FOR ${instrument.symbol}: DATA UNAVAILABLE. Do NOT fabricate live prices. State clearly if live prices are unavailable and base any structural guidance strictly on user-supplied values or an attached chart.`;

  const historyText = history
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'TRADER' : 'SHARAN_AI'}: ${m.content}`)
    .join('\n');

  const fullPrompt = `${marketContextBlock}

RECENT CONVERSATION:
${historyText || '(New session)'}

TRADER QUESTION:
${message}

Respond directly, cleanly, and concisely as the My Trade analyst. If generating a trade signal, use the exact My Trade format (or explicitly state NO TRADE if rules are not satisfied).`;

  const parts: any[] = [];
  if (imageBase64) {
    const clean = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    parts.push({
      inlineData: {
        mimeType: mimeType || 'image/png',
        data: clean,
      },
    });
  }
  parts.push({ text: fullPrompt });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction: buildStrategySystemRules(config),
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      tools: [{ googleSearch: {} }],
    },
  });

  const baseText = (response.text ?? 'Unable to generate analysis response.').trim();
  const groundingSources = extractGroundingSources(response);
  if (groundingSources.length === 0) {
    return baseText;
  }

  const sourcesFooter = groundingSources
    .slice(0, 4)
    .map((s) => `- ${s.title}: ${s.uri}`)
    .join('\n');
  return `${baseText}\n\nWeb Sources (Google Search):\n${sourcesFooter}`;
}

function extractGroundingSources(response: any): GroundingSource[] {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];
  for (const chunk of chunks) {
    const uri = typeof chunk?.web?.uri === 'string' ? chunk.web.uri.trim() : '';
    const title = typeof chunk?.web?.title === 'string' ? chunk.web.title.trim() : '';
    if (!uri || !/^https?:\/\//i.test(uri) || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({
      title: title || new URL(uri).hostname.replace(/^www\./, ''),
      uri,
    });
  }
  return sources;
}

function extractJsonObject(raw: string): any | null {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

export async function fetchLiveMarketNewsWithGemini(params: {
  category: MarketNewsCategory;
  query?: string;
}): Promise<LiveMarketNewsResponse> {
  const ai = getGeminiClient();
  const category = params.category || 'ALL';
  const customQuery = (params.query || '').trim().slice(0, 120);
  const nowIso = new Date().toISOString();

  const scopeDescription: Record<MarketNewsCategory, string> = {
    ALL: 'Indian equities & indices (NIFTY 50, BANK NIFTY, SENSEX, RBI, FII/DII), commodities (Gold XAUUSD, Silver XAGUSD, WTI/MCX Crude Oil), and major international/crypto macro drivers (US Fed, DXY, Treasury yields, NASDAQ, Bitcoin BTCUSDT)',
    INDIAN:
      'Indian stock markets right now: NIFTY 50, BANK NIFTY, SENSEX, RBI policy, India VIX, FII/DII institutional flows, INR/USD, and top Nifty heavyweights',
    MCX: 'Precious metals and energy commodities right now: Spot Gold (XAUUSD), Spot Silver (XAGUSD), MCX Gold/Silver, WTI Crude Oil, Brent Crude, OPEC+, US Dollar index impacting metals',
    INTERNATIONAL:
      'Global macro, US markets, forex, and crypto right now: Federal Reserve rates, US inflation/jobs data, NASDAQ/S&P 500, EURUSD, USDJPY, Bitcoin (BTCUSDT), Ethereum (ETHUSDT)',
  };

  const prompt = `Search the live web using Google Search right now (${nowIso}) for the latest breaking financial news and macro events currently moving markets.
Focus scope: ${scopeDescription[category]}${customQuery ? `\nAdditional trader topic filter: "${customQuery}"` : ''}.

Return 6 to 8 high-signal, verified current news updates that are genuinely affecting price action today or in the active trading session.
Respond ONLY with valid JSON (no commentary before or after) matching this exact shape:
{
  "marketBrief": "2 crisp sentences summarizing today's dominant market narrative and risk sentiment.",
  "items": [
    {
      "headline": "Clear factual news headline",
      "summary": "1 to 2 sentences explaining the direct market impact on price action or yields.",
      "impactDirection": "BULLISH" | "BEARISH" | "VOLATILE" | "NEUTRAL",
      "impactLevel": "HIGH" | "MEDIUM" | "LOW",
      "marketScope": "INDIAN" | "MCX" | "INTERNATIONAL",
      "affectedAssets": ["NIFTY50", "XAUUSD", "CRUDEOIL", "BTCUSDT"],
      "publishedTime": "Relative time or date from the news report, e.g. '2h ago' or 'Today'",
      "sourceName": "Publisher name, e.g. Reuters, Bloomberg, Mint, CNBC",
      "sourceUrl": "Direct https article URL if known"
    }
  ]
}
Use standard ticker labels in affectedAssets where relevant (NIFTY50, BANKNIFTY, SENSEX, XAUUSD, XAGUSD, CRUDEOIL, BTCUSDT, ETHUSDT, EURUSD, USDJPY, US100, US500).`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      tools: [{ googleSearch: {} }],
    },
  });

  const groundingSources = extractGroundingSources(response);
  const rawText = (response.text ?? '').trim();
  const parsed = extractJsonObject(rawText);

  const validDirections = new Set(['BULLISH', 'BEARISH', 'VOLATILE', 'NEUTRAL']);
  const validLevels = new Set(['HIGH', 'MEDIUM', 'LOW']);
  const validScopes = new Set(['INDIAN', 'MCX', 'INTERNATIONAL']);

  let items: MarketNewsItem[] = [];
  if (parsed && Array.isArray(parsed.items)) {
    items = parsed.items
      .filter((row: any) => row && typeof row.headline === 'string' && row.headline.trim().length > 0)
      .slice(0, 8)
      .map((row: any, idx: number): MarketNewsItem => {
        const dir = String(row.impactDirection || 'NEUTRAL').toUpperCase();
        const lvl = String(row.impactLevel || 'MEDIUM').toUpperCase();
        const scp = String(row.marketScope || (category === 'ALL' ? 'INTERNATIONAL' : category)).toUpperCase();
        const rawUrl = typeof row.sourceUrl === 'string' ? row.sourceUrl.trim() : '';
        const safeUrl = /^https?:\/\//i.test(rawUrl)
          ? rawUrl
          : groundingSources[idx]?.uri;

        return {
          headline: String(row.headline).trim(),
          summary: String(row.summary || '').trim(),
          impactDirection: (validDirections.has(dir) ? dir : 'NEUTRAL') as MarketNewsItem['impactDirection'],
          impactLevel: (validLevels.has(lvl) ? lvl : 'MEDIUM') as MarketNewsItem['impactLevel'],
          marketScope: (validScopes.has(scp) ? scp : 'INTERNATIONAL') as MarketNewsItem['marketScope'],
          affectedAssets: Array.isArray(row.affectedAssets)
            ? row.affectedAssets.map((a: unknown) => String(a).toUpperCase().trim()).filter(Boolean).slice(0, 5)
            : [],
          publishedTime: String(row.publishedTime || 'Latest').trim(),
          sourceName: String(row.sourceName || groundingSources[idx]?.title || 'Market Wire').trim(),
          sourceUrl: safeUrl,
        };
      });
  }

  const marketBrief =
    typeof parsed?.marketBrief === 'string' && parsed.marketBrief.trim()
      ? parsed.marketBrief.trim()
      : rawText.slice(0, 420) || 'Live market briefing retrieved via Google Search grounding.';

  return {
    category,
    query: customQuery,
    fetchedAt: nowIso,
    marketBrief,
    items,
    groundingSources,
  };
}
