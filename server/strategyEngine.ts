import type {
  CandleBar,
  ChecklistItem,
  GeneratedSignalPayload,
  InstrumentMeta,
  MarketQuoteResponse,
  StrategyConfig,
  SupportResistanceLevels,
  TechnicalSnapshot,
} from '../src/types/trading.ts';
import { isLiquiditySessionActive } from './economicCalendarService.ts';

/**
 * Dynamic decimal precision based on instrument price scale so forex pairs
 * (e.g. EUR/USD 1.0945) and micro-cap crypto (e.g. 0.004215) are never
 * truncated to 2 decimal places.
 */
export function getPriceDecimals(referencePrice: number): number {
  const abs = Math.abs(referencePrice);
  if (!Number.isFinite(abs) || abs === 0) return 2;
  if (abs < 0.01) return 6;
  if (abs < 1) return 5;
  if (abs < 20) return 4;
  if (abs < 500) return 3;
  return 2;
}

export function roundPriceFor(value: number, referencePrice: number): number {
  if (!Number.isFinite(value)) return 0;
  const decimals = getPriceDecimals(referencePrice || value);
  return Number(value.toFixed(decimals));
}

export function getSafeAtr(atr: number | null | undefined, referencePrice: number): number {
  const safePrice = Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : 1;
  const floor = Math.max(safePrice * 0.001, 1e-6);
  if (typeof atr === 'number' && Number.isFinite(atr) && atr > 0) {
    return Math.max(atr, floor);
  }
  return Math.max(safePrice * 0.004, floor);
}

export function calculateEMASeries(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

/**
 * Session-anchored VWAP: resets cumulative price*volume and volume on each UTC
 * trading day boundary, and handles zero-volume candles cleanly without
 * fabricating synthetic volume=1 bars when real volume is present.
 */
export function calculateVWAPSeries(candles: CandleBar[]): number[] {
  if (candles.length === 0) return [];
  let cumulativePV = 0;
  let cumulativeV = 0;
  let currentSessionDay = -1;
  const result: number[] = [];

  for (const bar of candles) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    const barTimeSec = Number.isFinite(bar.time) ? bar.time : 0;
    const sessionDay = barTimeSec > 0 ? Math.floor(barTimeSec / 86_400) : currentSessionDay;

    if (currentSessionDay !== -1 && sessionDay !== currentSessionDay) {
      cumulativePV = 0;
      cumulativeV = 0;
    }
    currentSessionDay = sessionDay;

    const vol = Number.isFinite(bar.volume) && bar.volume > 0 ? bar.volume : 0;
    if (vol > 0) {
      cumulativePV += typical * vol;
      cumulativeV += vol;
      result.push(cumulativePV / cumulativeV);
    } else if (cumulativeV > 0) {
      // Carry forward previous session VWAP when a zero-volume tick occurs
      result.push(cumulativePV / cumulativeV);
    } else {
      // No volume reported in this session yet: anchor to typical price
      result.push(typical);
    }
  }
  return result;
}

export function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length <= period || period <= 0) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else if (diff < 0) losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  // Flat price series (zero gains and zero losses) is neutral (50), never overbought (100)
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function calculateMACD(closes: number[]): {
  macdLine: number;
  signalLine: number;
  histogram: number;
} | null {
  if (closes.length < 30) return null;
  const ema12 = calculateEMASeries(closes, 12);
  const ema26 = calculateEMASeries(closes, 26);
  const macdSeries = ema12.map((v, i) => v - ema26[i]);
  const signalSeries = calculateEMASeries(macdSeries, 9);
  const lastIdx = closes.length - 1;
  const macdLine = macdSeries[lastIdx];
  const signalLine = signalSeries[lastIdx];
  const ref = closes[lastIdx] || 1;
  const dec = Math.max(4, getPriceDecimals(ref));
  return {
    macdLine: Number(macdLine.toFixed(dec)),
    signalLine: Number(signalLine.toFixed(dec)),
    histogram: Number((macdLine - signalLine).toFixed(dec)),
  };
}

export function calculateATR(candles: CandleBar[], period = 14): number | null {
  if (candles.length <= period || period <= 0) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
  }
  const recent = trs.slice(-period);
  const sum = recent.reduce((acc, v) => acc + v, 0);
  const lastClose = candles[candles.length - 1]?.close ?? 1;
  const dec = Math.max(4, getPriceDecimals(lastClose) + 1);
  return Number((sum / recent.length).toFixed(dec));
}

export function calculateADX(candles: CandleBar[], period = 14): number | null {
  if (candles.length <= period * 2) return null;
  const n = Math.max(2, Math.round(period));
  const tr: number[] = new Array<number>(candles.length).fill(0);
  const plusDm: number[] = new Array<number>(candles.length).fill(0);
  const minusDm: number[] = new Array<number>(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  let smTr = 0;
  let smPlus = 0;
  let smMinus = 0;
  for (let i = 1; i <= n; i++) {
    smTr += tr[i];
    smPlus += plusDm[i];
    smMinus += minusDm[i];
  }

  const dxValues: number[] = [];
  for (let i = n; i < candles.length; i++) {
    if (i > n) {
      smTr = smTr - smTr / n + tr[i];
      smPlus = smPlus - smPlus / n + plusDm[i];
      smMinus = smMinus - smMinus / n + minusDm[i];
    }
    const pdi = smTr > 0 ? (100 * smPlus) / smTr : 0;
    const mdi = smTr > 0 ? (100 * smMinus) / smTr : 0;
    const denom = pdi + mdi;
    dxValues.push(denom > 0 ? (100 * Math.abs(pdi - mdi)) / denom : 0);
  }

  if (dxValues.length < n) return null;
  let adx = dxValues.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < dxValues.length; i++) {
    adx = (adx * (n - 1) + dxValues[i]) / n;
  }
  return Number(adx.toFixed(2));
}

export function detectBollingerSqueeze(candles: CandleBar[], period = 20): boolean {
  if (candles.length < period + 15) return false;
  const closes = candles.map((c) => c.close);
  const widths: number[] = [];
  for (let end = period; end <= closes.length; end++) {
    const slice = closes.slice(end - period, end);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    if (mean <= 0) continue;
    const variance = slice.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / period;
    const std = Math.sqrt(variance);
    widths.push((4 * std) / mean);
  }
  if (widths.length < 15) return false;
  const currentWidth = widths[widths.length - 1];
  const recentAvg = widths.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, widths.length);
  return currentWidth < recentAvg * 0.68;
}

export function detectCandlePattern(candles: CandleBar[]): string {
  if (candles.length < 3) return 'Insufficient Bars';
  const cur = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const body = Math.abs(cur.close - cur.open);
  const range = Math.max(cur.high - cur.low, 0.00001);
  const upperWick = cur.high - Math.max(cur.open, cur.close);
  const lowerWick = Math.min(cur.open, cur.close) - cur.low;
  const prevBody = Math.abs(prev.close - prev.open);

  const isBull = cur.close > cur.open;
  const isBear = cur.close < cur.open;
  const prevBull = prev.close > prev.open;
  const prevBear = prev.close < prev.open;

  if (isBull && prevBear && cur.close >= prev.open && cur.open <= prev.close && body > prevBody * 0.9) {
    return 'Bullish Engulfing';
  }
  if (isBear && prevBull && cur.close <= prev.open && cur.open >= prev.close && body > prevBody * 0.9) {
    return 'Bearish Engulfing';
  }
  if (lowerWick >= body * 2 && upperWick <= body * 0.6 && body / range < 0.38) {
    return 'Bullish Hammer / Rejection';
  }
  if (upperWick >= body * 2 && lowerWick <= body * 0.6 && body / range < 0.38) {
    return 'Bearish Shooting Star';
  }
  if (cur.high <= prev.high && cur.low >= prev.low) {
    return 'Inside Bar Consolidation';
  }
  if (isBull && body / range >= 0.7) {
    return 'Strong Bullish Momentum Bar';
  }
  if (isBear && body / range >= 0.7) {
    return 'Strong Bearish Momentum Bar';
  }
  if (body / range <= 0.15) {
    return 'Doji Indecision';
  }
  return isBull ? 'Bullish Continuation' : isBear ? 'Bearish Continuation' : 'Neutral Consolidation';
}

export function computeTechnicals(
  candles: CandleBar[],
  periods = { fast: 9, mid: 20, slow: 50, rsi: 14 }
): TechnicalSnapshot {
  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1] ?? 0;
  const indDecimals = Math.max(4, getPriceDecimals(lastClose));

  const emaFastSeries = calculateEMASeries(closes, periods.fast);
  const emaMidSeries = calculateEMASeries(closes, periods.mid);
  const emaSlowSeries = calculateEMASeries(closes, periods.slow);
  const vwapSeries = calculateVWAPSeries(candles);

  const ema9 = emaFastSeries.length
    ? Number(emaFastSeries[emaFastSeries.length - 1].toFixed(indDecimals))
    : null;
  const ema20 = emaMidSeries.length
    ? Number(emaMidSeries[emaMidSeries.length - 1].toFixed(indDecimals))
    : null;
  const ema50 = emaSlowSeries.length
    ? Number(emaSlowSeries[emaSlowSeries.length - 1].toFixed(indDecimals))
    : null;
  const vwap = vwapSeries.length
    ? Number(vwapSeries[vwapSeries.length - 1].toFixed(indDecimals))
    : null;
  const rsi = calculateRSI(closes, periods.rsi);
  const macd = calculateMACD(closes);
  const atr = calculateATR(candles, 14);
  const adx = calculateADX(candles, 14);
  const bollingerSqueeze = detectBollingerSqueeze(candles, 20);

  const recentVols = candles
    .slice(-21, -1)
    .map((c) => c.volume)
    .filter((v) => Number.isFinite(v) && v > 0);
  const lastVol = candles[candles.length - 1]?.volume ?? 0;
  let volumeRatio: number | null = null;
  if (recentVols.length >= 5 && lastVol > 0) {
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    if (avgVol > 0) volumeRatio = Number((lastVol / avgVol).toFixed(2));
  }

  // Trend bias strictly enforces minSep between EMA20 and EMA50 across all branches
  // so tangled/flat EMAs cannot bypass the separation filter.
  let trendBias: TechnicalSnapshot['trendBias'] = 'SIDEWAYS';
  if (ema9 !== null && ema20 !== null && ema50 !== null) {
    const prevEma20 =
      emaMidSeries.length >= 4 ? emaMidSeries[emaMidSeries.length - 4] : ema20;
    const ema20Rising = ema20 > prevEma20;
    const ema20Falling = ema20 < prevEma20;
    const safeAtr = getSafeAtr(atr, lastClose);
    const minSep = safeAtr * 0.18;

    const bullishSeparation = ema20 - ema50 >= minSep;
    const bearishSeparation = ema50 - ema20 >= minSep;

    if (lastClose > ema9 && ema9 > ema20 && bullishSeparation && ema20Rising) {
      trendBias = 'BULLISH';
    } else if (lastClose < ema9 && ema9 < ema20 && bearishSeparation && ema20Falling) {
      trendBias = 'BEARISH';
    } else if (lastClose > ema20 && ema9 >= ema20 && bullishSeparation && ema20Rising) {
      trendBias = 'BULLISH';
    } else if (lastClose < ema20 && ema9 <= ema20 && bearishSeparation && ema20Falling) {
      trendBias = 'BEARISH';
    }
  }

  let momentumState: TechnicalSnapshot['momentumState'] = 'NEUTRAL';
  const hist = macd?.histogram ?? 0;
  if (trendBias === 'BULLISH' && (rsi ?? 50) >= 58 && hist > 0) {
    momentumState = 'STRONG_BULLISH';
  } else if (trendBias === 'BULLISH' && (rsi ?? 50) >= 51) {
    momentumState = 'BULLISH';
  } else if (trendBias === 'BEARISH' && (rsi ?? 50) <= 42 && hist < 0) {
    momentumState = 'STRONG_BEARISH';
  } else if (trendBias === 'BEARISH' && (rsi ?? 50) <= 49) {
    momentumState = 'BEARISH';
  }

  const regime: TechnicalSnapshot['regime'] = bollingerSqueeze
    ? 'SQUEEZE'
    : (adx ?? 22) >= 20 && trendBias !== 'SIDEWAYS'
      ? 'TRENDING'
      : 'CHOPPY';

  return {
    ema9,
    ema20,
    ema50,
    vwap,
    rsi,
    macd,
    atr,
    adx,
    bollingerSqueeze,
    regime,
    volumeRatio,
    candlePattern: detectCandlePattern(candles),
    trendBias,
    momentumState,
  };
}

export function computeLevels(
  candles: CandleBar[],
  currentPrice: number,
  atr: number
): SupportResistanceLevels {
  const safePrice = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : 0;
  const safeAtr = getSafeAtr(atr, safePrice || 1);
  const r = (v: number) => roundPriceFor(v, safePrice || 1);

  if (candles.length === 0) {
    const immediateResistance = r(safePrice + safeAtr * 0.8);
    const immediateSupport = r(Math.max(0, safePrice - safeAtr * 0.8));
    const strongResistance = r(immediateResistance + safeAtr * 1.2);
    const strongSupport = r(Math.max(0, immediateSupport - safeAtr * 1.2));
    return {
      immediateSupport,
      strongSupport,
      immediateResistance,
      strongResistance,
      breakoutLevel: r(immediateResistance + safeAtr * 0.15),
      breakdownLevel: r(Math.max(0, immediateSupport - safeAtr * 0.15)),
      noTradeZoneLow: r(Math.max(0, safePrice - safeAtr * 0.25)),
      noTradeZoneHigh: r(safePrice + safeAtr * 0.25),
    };
  }

  const recent20 = candles.slice(-20);
  const recent60 = candles.slice(-60);

  let immResRaw = -Infinity;
  let immSupRaw = Infinity;
  for (const c of recent20) {
    if (Number.isFinite(c.high) && c.high > immResRaw) immResRaw = c.high;
    if (Number.isFinite(c.low) && c.low < immSupRaw) immSupRaw = c.low;
  }

  let strResRaw = -Infinity;
  let strSupRaw = Infinity;
  for (const c of recent60) {
    if (Number.isFinite(c.high) && c.high > strResRaw) strResRaw = c.high;
    if (Number.isFinite(c.low) && c.low < strSupRaw) strSupRaw = c.low;
  }

  if (!Number.isFinite(immResRaw)) immResRaw = safePrice + safeAtr * 0.45;
  if (!Number.isFinite(immSupRaw)) immSupRaw = Math.max(0, safePrice - safeAtr * 0.45);
  if (!Number.isFinite(strResRaw)) strResRaw = immResRaw + safeAtr * 0.8;
  if (!Number.isFinite(strSupRaw)) strSupRaw = Math.max(0, immSupRaw - safeAtr * 0.8);

  const immediateResistance = r(Math.max(immResRaw, safePrice + safeAtr * 0.45));
  const immediateSupport = r(Math.max(0, Math.min(immSupRaw, safePrice - safeAtr * 0.45)));
  const strongResistance = r(Math.max(strResRaw, immediateResistance + safeAtr * 0.8));
  const strongSupport = r(Math.max(0, Math.min(strSupRaw, immediateSupport - safeAtr * 0.8)));

  const breakoutLevel = r(immediateResistance + safeAtr * 0.15);
  const breakdownLevel = r(Math.max(0, immediateSupport - safeAtr * 0.15));

  const midBand = (immediateResistance + immediateSupport) / 2;
  const noTradeZoneLow = r(Math.max(0, midBand - safeAtr * 0.25));
  const noTradeZoneHigh = r(midBand + safeAtr * 0.25);

  return {
    immediateSupport,
    strongSupport,
    immediateResistance,
    strongResistance,
    breakoutLevel,
    breakdownLevel,
    noTradeZoneLow,
    noTradeZoneHigh,
  };
}

export function formatSignalBlock(payload: {
  instrument: string;
  contract: string;
  direction: 'BUY' | 'SELL' | 'NO_TRADE';
  currency: string;
  entryPrice: number;
  target1: number;
  target2: number;
  target3?: number;
  stopLoss: number;
  entryTimeframe: string;
  trendTimeframe: string;
  horizon: string;
  riskReward: string;
  confirmationText: string;
  status: string;
}): { formattedSignalText: string; telegramReadyText: string } {
  if (payload.direction === 'NO_TRADE' || payload.status === 'NO_TRADE') {
    const noTradeText = [
      'My Trade',
      '',
      `Instrument: ${payload.instrument}`,
      `Contract: ${payload.contract}`,
      'SIGNAL STATUS: NO TRADE',
      '',
      'CONFIRMATION:',
      payload.confirmationText,
      '',
      'TRADE SMART • STAY DISCIPLINED • FOLLOW THE CALL.',
    ].join('\n');
    return { formattedSignalText: noTradeText, telegramReadyText: noTradeText };
  }

  const actionLabel = payload.direction === 'BUY' ? 'BUY ABOVE' : 'SELL BELOW';
  const c = payload.currency;
  const lines = [
    'My Trade',
    '',
    `Instrument: ${payload.instrument}`,
    `Contract: ${payload.contract}`,
    '',
    `Direction: ${payload.direction}`,
    '',
    `${actionLabel}: ${c}${payload.entryPrice}`,
    '',
    'TARGETS:',
    `T1: ${c}${payload.target1}`,
    `T2: ${c}${payload.target2}`,
  ];
  if (payload.target3 && payload.target3 > 0) {
    lines.push(`T3: ${c}${payload.target3}`);
  }
  lines.push(
    '',
    `STOP LOSS: ${c}${payload.stopLoss}`,
    '',
    `TIMEFRAME: ${payload.entryTimeframe.toUpperCase()}`,
    `TREND CONFIRMATION: ${payload.trendTimeframe.toUpperCase()}`,
    `HORIZON: ${payload.horizon}`,
    '',
    `RISK/REWARD: ${payload.riskReward}`,
    '',
    'CONFIRMATION:',
    payload.confirmationText,
    '',
    `SIGNAL STATUS: ${payload.status}`,
    '',
    'TRADE SMART • STAY DISCIPLINED • FOLLOW THE CALL.'
  );

  const formatted = lines.join('\n');
  return {
    formattedSignalText: formatted,
    telegramReadyText: formatted,
  };
}

export function buildAtmOptionRecommendation(
  instrument: InstrumentMeta,
  spotPrice: number,
  direction: 'BUY' | 'SELL' | 'NO_TRADE'
): GeneratedSignalPayload['atmOptionContext'] | undefined {
  if (!instrument.supportsOptions || !instrument.strikeStep) return undefined;
  const step = instrument.strikeStep;
  const atmStrike = Math.round(spotPrice / step) * step;
  const nearAtmStrikes = [atmStrike - step, atmStrike, atmStrike + step];

  if (direction === 'NO_TRADE') {
    return {
      spotPrice,
      recommendedStrike: atmStrike,
      optionType: 'WAIT',
      nearAtmStrikes,
      note: 'Stand aside until 15m trend and 5m entry align. Focus strictly on ATM / near-ATM strikes when triggered.',
    };
  }

  const optionType = direction === 'BUY' ? 'CE' : 'PE';
  const recommendedStrike = atmStrike;
  return {
    spotPrice,
    recommendedStrike,
    optionType,
    nearAtmStrikes,
    note: `ATM ${recommendedStrike} ${optionType} prioritized over far OTM contracts. Trigger levels reflect underlying spot index structure unless live option-chain feed is attached.`,
  };
}

export function evaluateMultiTimeframeStrategy(params: {
  instrument: InstrumentMeta;
  trendQuote: MarketQuoteResponse; // 15m
  entryQuote: MarketQuoteResponse; // 5m
  config: StrategyConfig;
  now?: Date;
}): GeneratedSignalPayload {
  const { instrument, trendQuote, entryQuote, config, now } = params;
  const c = instrument.currency;

  const tTech = trendQuote.technicals!;
  const eTech = entryQuote.technicals!;
  const eLevels = entryQuote.levels!;
  const tLevels = trendQuote.levels ?? eLevels;
  const spotPrice = entryQuote.price ?? 0;
  const atr = getSafeAtr(eTech.atr, spotPrice);

  const isCrude = Boolean(instrument.ema9Priority && config.comexCrudeEma9Priority);

  // Strict higher-timeframe directional bias + 5m pullback/momentum sync
  const bull15m = tTech.trendBias === 'BULLISH';
  const bear15m = tTech.trendBias === 'BEARISH';
  const bull5m =
    eTech.trendBias === 'BULLISH' ||
    (eTech.ema9 !== null &&
      eTech.ema20 !== null &&
      spotPrice > eTech.ema9 &&
      eTech.ema9 >= eTech.ema20 &&
      (eTech.macd?.histogram ?? 0) > 0);
  const bear5m =
    eTech.trendBias === 'BEARISH' ||
    (eTech.ema9 !== null &&
      eTech.ema20 !== null &&
      spotPrice < eTech.ema9 &&
      eTech.ema9 <= eTech.ema20 &&
      (eTech.macd?.histogram ?? 0) < 0);

  let candidateDirection: 'BUY' | 'SELL' | 'NO_TRADE' = 'NO_TRADE';
  if (bull15m && bull5m) candidateDirection = 'BUY';
  else if (bear15m && bear5m) candidateDirection = 'SELL';

  // Anti-exhaustion check: avoid buying tops or selling bottoms
  const rsiVal = eTech.rsi ?? 50;
  const distFromEma20 = eTech.ema20 !== null ? Math.abs(spotPrice - eTech.ema20) : 0;
  const isOverextended =
    (candidateDirection === 'BUY' && (rsiVal > 72 || distFromEma20 > atr * 2.3)) ||
    (candidateDirection === 'SELL' && (rsiVal < 28 || distFromEma20 > atr * 2.3));

  const checklist: ChecklistItem[] = [];
  const reasonsFor: string[] = [];
  const reasonsAgainst: string[] = [];
  let score = 0;

  // 1. Higher-Timeframe Trend Alignment (25 pts)
  const trendAligned = (candidateDirection === 'BUY' && bull15m) || (candidateDirection === 'SELL' && bear15m);
  if (trendAligned) {
    score += 25;
    checklist.push({
      label: `${config.trendTimeframe} Trend Slope & Alignment`,
      passed: true,
      detail: `${config.trendTimeframe} bias is ${tTech.trendBias} with clean EMA ${config.emaFast}/${config.emaMid}/${config.emaSlow} separation`,
    });
    reasonsFor.push(`${config.trendTimeframe} trend confirms directional impulse with clean EMA separation.`);
  } else {
    checklist.push({
      label: `${config.trendTimeframe} Trend Slope & Alignment`,
      passed: false,
      detail: `${config.trendTimeframe} bias is ${tTech.trendBias}; choppy or unconfirmed higher-timeframe slope.`,
    });
    reasonsAgainst.push(`${config.trendTimeframe} structure (${tTech.trendBias}) lacks clean directional trend.`);
  }

  // 2. Entry Confirmation & Pullback Quality (20 pts)
  const entryConfirmed =
    ((candidateDirection === 'BUY' && bull5m) || (candidateDirection === 'SELL' && bear5m)) &&
    !isOverextended;
  if (entryConfirmed) {
    score += 20;
    checklist.push({
      label: `${config.entryTimeframe} Entry & Anti-Exhaustion Filter`,
      passed: true,
      detail: `${eTech.candlePattern} within value zone (${(distFromEma20 / atr).toFixed(2)}x ATR from EMA ${config.emaMid})`,
    });
    reasonsFor.push(`${config.entryTimeframe} entry is inside high-probability pullback/breakout zone (not overextended).`);
  } else {
    checklist.push({
      label: `${config.entryTimeframe} Entry & Anti-Exhaustion Filter`,
      passed: false,
      detail: isOverextended
        ? `Extended ${(distFromEma20 / atr).toFixed(2)}x ATR from EMA ${config.emaMid} / RSI ${rsiVal} — avoiding chase.`
        : `Pattern: ${eTech.candlePattern} — waiting for cleaner ${config.entryTimeframe} structure.`,
    });
    reasonsAgainst.push(
      isOverextended
        ? `Price is overextended from EMA ${config.emaMid}; chasing increases stop-loss risk.`
        : `${config.entryTimeframe} trigger is not aligned with primary trend.`
    );
  }

  // 3. EMA Stack & Crude EMA 9 Priority (15 pts)
  const emaAligned =
    candidateDirection === 'BUY'
      ? eTech.ema9 !== null &&
        eTech.ema20 !== null &&
        eTech.ema50 !== null &&
        spotPrice > eTech.ema9 &&
        eTech.ema9 > eTech.ema20 &&
        eTech.ema20 >= eTech.ema50 * 0.9995
      : candidateDirection === 'SELL'
        ? eTech.ema9 !== null &&
          eTech.ema20 !== null &&
          eTech.ema50 !== null &&
          spotPrice < eTech.ema9 &&
          eTech.ema9 < eTech.ema20 &&
          eTech.ema20 <= eTech.ema50 * 1.0005
        : false;
  if (emaAligned) {
    score += 15;
    checklist.push({
      label: isCrude ? `EMA ${config.emaFast} (Crude Oil Priority) & Stack` : `EMA ${config.emaFast}/${config.emaMid}/${config.emaSlow} Stack`,
      passed: true,
      detail: `Price (${spotPrice}) aligned with EMA ${config.emaFast} (${eTech.ema9}) -> EMA ${config.emaMid} (${eTech.ema20}) -> EMA ${config.emaSlow} (${eTech.ema50}).`,
    });
    reasonsFor.push(
      isCrude
        ? `Crude Oil EMA 9 momentum stack satisfied (${spotPrice} vs EMA 9 ${eTech.ema9}).`
        : `Full EMA ${config.emaFast}/${config.emaMid}/${config.emaSlow} directional stack aligned.`
    );
  } else {
    checklist.push({
      label: isCrude ? `EMA ${config.emaFast} (Crude Oil Priority) & Stack` : `EMA ${config.emaFast}/${config.emaMid}/${config.emaSlow} Stack`,
      passed: false,
      detail: `EMAs are tangled or counter-aligned on ${config.entryTimeframe}.`,
    });
    reasonsAgainst.push(`EMA ${config.emaFast}/${config.emaMid}/${config.emaSlow} stack lacks full trend alignment.`);
  }

  // 4. VWAP & Volume Participation (15 pts)
  const vwapPass =
    candidateDirection === 'BUY'
      ? eTech.vwap !== null && spotPrice >= eTech.vwap
      : candidateDirection === 'SELL'
        ? eTech.vwap !== null && spotPrice <= eTech.vwap
        : false;
  const volPass = eTech.volumeRatio === null ? true : eTech.volumeRatio >= 1.0;
  if (vwapPass && volPass) {
    score += 15;
    checklist.push({
      label: 'VWAP & Institutional Volume',
      passed: true,
      detail: `Favorable VWAP (${eTech.vwap}) control${eTech.volumeRatio ? `, Volume ${eTech.volumeRatio}x avg` : ''}.`,
    });
    reasonsFor.push(`Institutional VWAP positioning and volume support ${candidateDirection} side.`);
  } else {
    if (vwapPass) score += 6;
    checklist.push({
      label: 'VWAP & Institutional Volume',
      passed: false,
      detail: `VWAP=${eTech.vwap ?? 'N/A'}, Vol Ratio=${eTech.volumeRatio ?? 'N/A'}x (need >=1.0x).`,
    });
    reasonsAgainst.push(`Volume/VWAP confirmation is weak (<1.0x average or wrong side of VWAP).`);
  }

  // 5. RSI & MACD Momentum (15 pts)
  const macdHist = eTech.macd?.histogram ?? 0;
  const momentumPass =
    candidateDirection === 'BUY'
      ? rsiVal >= config.rsiBullishMin && rsiVal <= 70 && macdHist > 0
      : candidateDirection === 'SELL'
        ? rsiVal <= config.rsiBearishMax && rsiVal >= 30 && macdHist < 0
        : false;
  if (momentumPass) {
    score += 15;
    checklist.push({
      label: 'RSI & MACD Momentum',
      passed: true,
      detail: `RSI(${config.rsiPeriod})=${rsiVal} (sweet spot), MACD Hist=${macdHist}.`,
    });
    reasonsFor.push(`RSI (${rsiVal}) and MACD histogram (${macdHist}) confirm healthy trend momentum.`);
  } else {
    checklist.push({
      label: 'RSI & MACD Momentum',
      passed: false,
      detail: `RSI=${rsiVal}, MACD Hist=${macdHist}.`,
    });
    reasonsAgainst.push(`RSI/MACD momentum lacks impulse or is in exhaustion territory.`);
  }

  // 6. Structural Clearance (10 pts)
  const inNoTradeZone = spotPrice >= eLevels.noTradeZoneLow && spotPrice <= eLevels.noTradeZoneHigh;
  if (!inNoTradeZone && candidateDirection !== 'NO_TRADE') {
    score += 10;
    checklist.push({
      label: 'Structural S/R Clearance',
      passed: true,
      detail: `Price clear of chop band (${eLevels.noTradeZoneLow} - ${eLevels.noTradeZoneHigh}).`,
    });
    reasonsFor.push(`Clean structural clearance away from mid-range chop.`);
  } else {
    checklist.push({
      label: 'Structural S/R Clearance',
      passed: false,
      detail: inNoTradeZone
        ? `Price (${spotPrice}) inside chop band (${eLevels.noTradeZoneLow} - ${eLevels.noTradeZoneHigh}).`
        : 'Awaiting clear directional break.',
    });
    reasonsAgainst.push(
      inNoTradeZone
        ? `Price is trapped inside the intraday chop zone (${eLevels.noTradeZoneLow}–${eLevels.noTradeZoneHigh}).`
        : `Insufficient S/R structural clearance.`
    );
  }

  // Compute structural Trigger Entry (making WAIT state genuinely reachable when price has not yet
  // cleared breakout/breakdown structure), Stop-Loss, and structurally-anchored Targets (so R:R
  // reflects real S/R liquidity clearance instead of a fixed 2.4x multiplier).
  const roundPrice = (v: number) => roundPriceFor(v, spotPrice);
  let entryPrice = roundPrice(spotPrice);
  let stopLoss = 0;
  let target1 = 0;
  let target2 = 0;
  let target3 = 0;
  let invalidationLevel = 0;

  if (candidateDirection === 'BUY') {
    // If spot sits just beneath immediate resistance/breakout within 1.25x ATR (and > 0.35x ATR away),
    // stage a WAIT breakout trigger above resistance rather than chasing below resistance.
    const distToBreakout = eLevels.breakoutLevel - spotPrice;
    if (distToBreakout > atr * 0.35 && distToBreakout <= atr * 1.25) {
      entryPrice = roundPrice(eLevels.breakoutLevel);
    } else {
      entryPrice = roundPrice(spotPrice);
    }

    const structuralFloor = Math.min(
      eLevels.immediateSupport,
      eTech.ema20 !== null ? eTech.ema20 - atr * 0.45 : entryPrice - atr * 1.4
    );
    const rawRisk = entryPrice - structuralFloor;
    const risk = Math.max(atr * 1.1, Math.min(atr * 2.5, rawRisk > 0 ? rawRisk : atr * 1.5));
    stopLoss = roundPrice(Math.max(0, entryPrice - risk));
    invalidationLevel = roundPrice(Math.max(0, stopLoss - atr * 0.3));

    // Keep TP1 & TP2 near the execution point for fast partial booking & BE/TP1 lock,
    // while anchoring TP3 to the full structural liquidity/swing target above entry.
    const candidateRes = [
      eLevels.immediateResistance,
      eLevels.strongResistance,
      tLevels.immediateResistance,
      tLevels.strongResistance,
    ]
      .filter((lvl) => Number.isFinite(lvl) && lvl > entryPrice + atr * 0.4)
      .sort((a, b) => a - b);

    const swingRange = Math.max(
      tLevels.strongResistance - tLevels.strongSupport,
      eLevels.strongResistance - eLevels.strongSupport,
      atr * 2.0
    );

    const structuralRoom =
      candidateRes.length > 0
        ? Math.max(...candidateRes) - entryPrice
        : Math.max(swingRange * 1.15, risk * 3.5);

    const tp3Dist = Math.min(structuralRoom, Math.max(risk * 4.5, swingRange * 1.25));
    const tp1Dist = Math.min(risk * 0.75, Math.max(atr * 0.35, tp3Dist * 0.3));
    const tp2Dist = Math.max(
      tp1Dist + Math.min(atr * 0.35, Math.max(0, (tp3Dist - tp1Dist) * 0.4)),
      Math.min(risk * 1.4, tp3Dist * 0.55)
    );

    target1 = roundPrice(entryPrice + tp1Dist);
    target2 = roundPrice(entryPrice + Math.min(tp2Dist, tp3Dist * 0.75));
    target3 = roundPrice(entryPrice + Math.max(tp3Dist, tp2Dist));
  } else if (candidateDirection === 'SELL') {
    const distToBreakdown = spotPrice - eLevels.breakdownLevel;
    if (distToBreakdown > atr * 0.35 && distToBreakdown <= atr * 1.25) {
      entryPrice = roundPrice(eLevels.breakdownLevel);
    } else {
      entryPrice = roundPrice(spotPrice);
    }

    const structuralCap = Math.max(
      eLevels.immediateResistance,
      eTech.ema20 !== null ? eTech.ema20 + atr * 0.45 : entryPrice + atr * 1.4
    );
    const rawRisk = structuralCap - entryPrice;
    const risk = Math.max(atr * 1.1, Math.min(atr * 2.5, rawRisk > 0 ? rawRisk : atr * 1.5));
    stopLoss = roundPrice(entryPrice + risk);
    invalidationLevel = roundPrice(stopLoss + atr * 0.3);

    const candidateSup = [
      eLevels.immediateSupport,
      eLevels.strongSupport,
      tLevels.immediateSupport,
      tLevels.strongSupport,
    ]
      .filter((lvl) => Number.isFinite(lvl) && lvl > 0 && lvl < entryPrice - atr * 0.4)
      .sort((a, b) => b - a);

    const swingRange = Math.max(
      tLevels.strongResistance - tLevels.strongSupport,
      eLevels.strongResistance - eLevels.strongSupport,
      atr * 2.0
    );

    const structuralRoom =
      candidateSup.length > 0
        ? entryPrice - Math.min(...candidateSup)
        : Math.max(swingRange * 1.15, risk * 3.5);

    const tp3Dist = Math.min(structuralRoom, Math.max(risk * 4.5, swingRange * 1.25));
    const tp1Dist = Math.min(risk * 0.75, Math.max(atr * 0.35, tp3Dist * 0.3));
    const tp2Dist = Math.max(
      tp1Dist + Math.min(atr * 0.35, Math.max(0, (tp3Dist - tp1Dist) * 0.4)),
      Math.min(risk * 1.4, tp3Dist * 0.55)
    );

    target1 = roundPrice(Math.max(0, entryPrice - tp1Dist));
    target2 = roundPrice(Math.max(0, entryPrice - Math.min(tp2Dist, tp3Dist * 0.75)));
    target3 = roundPrice(Math.max(0, entryPrice - Math.max(tp3Dist, tp2Dist)));
  }

  const riskDist = Math.abs(entryPrice - stopLoss);
  const runnerRewardDist = Math.abs(target3 - entryPrice);
  const numericRR = riskDist > 0 ? Number((runnerRewardDist / riskDist).toFixed(2)) : 0;
  const rrString = numericRR > 0 ? `1:${numericRR}` : 'N/A';

  const rrPass = numericRR >= config.minRiskReward;
  checklist.push({
    label: `Risk-to-Reward (>= 1:${config.minRiskReward})`,
    passed: rrPass && candidateDirection !== 'NO_TRADE',
    detail: rrPass
      ? `Structural R:R is ${rrString} derived from swing S/R liquidity levels.`
      : `Structural R:R (${rrString}) is below required 1:${config.minRiskReward} threshold.`,
  });
  if (!rrPass && candidateDirection !== 'NO_TRADE') {
    reasonsAgainst.push(
      `Nearest structural S/R targets yield only ${rrString} R:R (minimum required 1:${config.minRiskReward}).`
    );
  }

  // 7. Market Regime & ADX(14) Chop Filter
  const adxThreshold = Math.max(10, Math.min(50, Number(config.adxMinThreshold ?? 18)));
  const entryAdx = eTech.adx ?? tTech.adx ?? null;
  const adxPass = entryAdx === null ? true : entryAdx >= adxThreshold;
  const regimeLabel = eTech.regime ?? 'TRENDING';
  checklist.push({
    label: `ADX(14) Regime Filter (>= ${adxThreshold})`,
    passed: adxPass && !eTech.bollingerSqueeze,
    detail:
      entryAdx !== null
        ? `ADX=${entryAdx} · Regime: ${regimeLabel}${eTech.bollingerSqueeze ? ' (Bollinger Squeeze compression — wait for expansion)' : ''}.`
        : `Regime: ${regimeLabel}.`,
  });
  if (!adxPass) {
    reasonsAgainst.push(`ADX(14) is ${entryAdx} (< ${adxThreshold}), indicating low-conviction sideways chop.`);
  } else if (eTech.bollingerSqueeze) {
    reasonsAgainst.push('Bollinger Squeeze detected; wait for directional volatility expansion.');
  } else if (entryAdx !== null) {
    reasonsFor.push(`ADX(14) at ${entryAdx} confirms active directional trend strength (${regimeLabel}).`);
  }

  // 8. Active Liquidity Session Filter (now strictly enforced in passesGate)
  const sessionFilterEnabled = config.enableSessionFilter !== false;
  const sessionState = isLiquiditySessionActive(instrument.segment, instrument.id, now);
  const sessionPass = !sessionFilterEnabled || sessionState.active;
  checklist.push({
    label: 'Active Session Liquidity Window',
    passed: sessionPass,
    detail: sessionState.label,
  });
  if (!sessionPass) {
    reasonsAgainst.push(`${sessionState.label} — active liquidity window required by session filter.`);
  }

  // Strict Discipline Gate -> NO TRADE if session closed, chop, low ADX (unless A+ score >= 88),
  // overextended, low score, or weak structural R:R
  const passesGate =
    candidateDirection !== 'NO_TRADE' &&
    !isOverextended &&
    sessionPass &&
    score >= config.minSetupScore &&
    rrPass &&
    (adxPass || score >= 88) &&
    (!inNoTradeZone || score >= 85);

  const finalDirection = passesGate ? candidateDirection : 'NO_TRADE';
  const finalStatus = passesGate
    ? Math.abs(spotPrice - entryPrice) <= atr * 0.35
      ? 'ACTIVE'
      : 'WAIT'
    : 'NO_TRADE';

  const atmContext = buildAtmOptionRecommendation(instrument, spotPrice, finalDirection);
  const contractLabel = atmContext
    ? atmContext.optionType === 'WAIT'
      ? `${atmContext.recommendedStrike} CE / PE (ATM Watch)`
      : `${atmContext.recommendedStrike} ${atmContext.optionType} (Spot Trigger)`
    : `${instrument.symbol} Intraday`;

  const confirmationText =
    finalDirection === 'NO_TRADE'
      ? `Conditions do not satisfy My Trade rules (Score ${score}/100, min ${config.minSetupScore}). ${reasonsAgainst[0] ?? 'Wait for clean 15m + 5m alignment.'}`
      : `${config.trendTimeframe} ${tTech.trendBias.toLowerCase()} trend + ${config.entryTimeframe} ${eTech.candlePattern.toLowerCase()} + EMA ${config.emaFast}/${config.emaMid} alignment${isCrude ? ' (EMA 9 Crude priority)' : ''}.`;

  const formatted = formatSignalBlock({
    instrument: instrument.symbol,
    contract: contractLabel,
    direction: finalDirection,
    currency: c,
    entryPrice,
    target1,
    target2,
    target3,
    stopLoss,
    entryTimeframe: config.entryTimeframe,
    trendTimeframe: config.trendTimeframe,
    horizon: 'INTRADAY',
    riskReward: rrString,
    confirmationText,
    status: finalStatus,
  });

  return {
    instrument: instrument.symbol,
    marketSegment: instrument.segment,
    contract: contractLabel,
    direction: finalDirection,
    entryTrigger: finalDirection === 'BUY' ? 'BUY ABOVE' : finalDirection === 'SELL' ? 'SELL BELOW' : 'STAND ASIDE',
    entryPrice: finalDirection === 'NO_TRADE' ? 0 : entryPrice,
    stopLoss: finalDirection === 'NO_TRADE' ? 0 : stopLoss,
    target1: finalDirection === 'NO_TRADE' ? 0 : target1,
    target2: finalDirection === 'NO_TRADE' ? 0 : target2,
    target3: finalDirection === 'NO_TRADE' ? undefined : target3,
    riskReward: rrString,
    entryTimeframe: config.entryTimeframe.toUpperCase(),
    trendTimeframe: config.trendTimeframe.toUpperCase(),
    horizon: 'INTRADAY',
    invalidationLevel: finalDirection === 'NO_TRADE' ? 0 : invalidationLevel,
    confirmationText,
    status: finalStatus,
    qualityScore: score,
    checklist,
    reasonsFor,
    reasonsAgainst,
    formattedSignalText: formatted.formattedSignalText,
    telegramReadyText: formatted.telegramReadyText,
    atmOptionContext: atmContext,
  };
}
