import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  GeneratedSignalPayload,
  InstrumentMeta,
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
  return `You are the institutional quantitative analyst for SHARAN — AI TRADING TERMINAL.
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

Respond directly, cleanly, and concisely as the SHARAN analyst. If generating a trade signal, use the exact SHARAN format (or explicitly state NO TRADE if rules are not satisfied).`;

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
    },
  });

  return (response.text ?? 'Unable to generate analysis response.').trim();
}
