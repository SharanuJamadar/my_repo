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

export function calculateEMASeries(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function calculateVWAPSeries(candles: CandleBar[]): number[] {
  if (candles.length === 0) return [];
  let cumulativePV = 0;
  let cumulativeV = 0;
  const result: number[] = [];
  for (const bar of candles) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    const vol = bar.volume > 0 ? bar.volume : 1;
    cumulativePV += typical * vol;
    cumulativeV += vol;
    result.push(cumulativePV / cumulativeV);
  }
  return result;
}

export function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
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
  if (avgLoss === 0) return 100;
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
  return {
    macdLine: Number(macdLine.toFixed(4)),
    signalLine: Number(signalLine.toFixed(4)),
    histogram: Number((macdLine - signalLine).toFixed(4)),
  };
}

export function calculateATR(candles: CandleBar[], period = 14): number | null {
  if (candles.length <= period) return null;
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
  return Number((sum / recent.length).toFixed(4));
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

  const emaFastSeries = calculateEMASeries(closes, periods.fast);
  const emaMidSeries = calculateEMASeries(closes, periods.mid);
  const emaSlowSeries = calculateEMASeries(closes, periods.slow);
  const vwapSeries = calculateVWAPSeries(candles);

  const ema9 = emaFastSeries.length ? Number(emaFastSeries[emaFastSeries.length - 1].toFixed(4)) : null;
  const ema20 = emaMidSeries.length ? Number(emaMidSeries[emaMidSeries.length - 1].toFixed(4)) : null;
  const ema50 = emaSlowSeries.length ? Number(emaSlowSeries[emaSlowSeries.length - 1].toFixed(4)) : null;
  const vwap = vwapSeries.length ? Number(vwapSeries[vwapSeries.length - 1].toFixed(4)) : null;
  const rsi = calculateRSI(closes, periods.rsi);
  const macd = calculateMACD(closes);
  const atr = calculateATR(candles, 14);
  const adx = calculateADX(candles, 14);
  const bollingerSqueeze = detectBollingerSqueeze(candles, 20);

  const recentVols = candles.slice(-21, -1).map((c) => c.volume).filter((v) => v > 0);
  const lastVol = candles[candles.length - 1]?.volume ?? 0;
  let volumeRatio: number | null = null;
  if (recentVols.length >= 5 && lastVol > 0) {
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    if (avgVol > 0) volumeRatio = Number((lastVol / avgVol).toFixed(2));
  }

  let trendBias: TechnicalSnapshot['trendBias'] = 'SIDEWAYS';
  if (ema9 !== null && ema20 !== null && ema50 !== null) {
    const prevEma20 =
      emaMidSeries.length >= 4 ? emaMidSeries[emaMidSeries.length - 4] : ema20;
    const ema20Rising = ema20 > prevEma20;
    const ema20Falling = ema20 < prevEma20;
    const minSep = (atr ?? lastClose * 0.002) * 0.18;

    if (
      lastClose > ema9 &&
      ema9 > ema20 &&
      ema20 > ema50 &&
      ema20 - ema50 >= minSep &&
      ema20Rising
    ) {
      trendBias = 'BULLISH';
    } else if (
      lastClose < ema9 &&
      ema9 < ema20 &&
      ema20 < ema50 &&
      ema50 - ema20 >= minSep &&
      ema20Falling
    ) {
      trendBias = 'BEARISH';
    } else if (lastClose > ema20 && ema9 > ema20 && ema20 >= ema50 && ema20Rising) {
      trendBias = 'BULLISH';
    } else if (lastClose < ema20 && ema9 < ema20 && ema20 <= ema50 && ema20Falling) {
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
  const recent20 = candles.slice(-20);
  const recent60 = candles.slice(-60);

  const r20Highs = recent20.map((c) => c.high);
  const r20Lows = recent20.map((c) => c.low);
  const r60Highs = recent60.map((c) => c.high);
  const r60Lows = recent60.map((c) => c.low);

  const immResRaw = Math.max(...r20Highs);
  const immSupRaw = Math.min(...r20Lows);
  const strResRaw = Math.max(...r60Highs);
  const strSupRaw = Math.min(...r60Lows);

  const immediateResistance = Number(Math.max(immResRaw, currentPrice + atr * 0.45).toFixed(2));
  const immediateSupport = Number(Math.min(immSupRaw, currentPrice - atr * 0.45).toFixed(2));
  const strongResistance = Number(Math.max(strResRaw, immediateResistance + atr * 0.8).toFixed(2));
  const strongSupport = Number(Math.min(strSupRaw, immediateSupport - atr * 0.8).toFixed(2));

  const breakoutLevel = Number((immediateResistance + atr * 0.15).toFixed(2));
  const breakdownLevel = Number((immediateSupport - atr * 0.15).toFixed(2));

  const midBand = (immediateResistance + immediateSupport) / 2;
  const noTradeZoneLow = Number((midBand - atr * 0.25).toFixed(2));
  const noTradeZoneHigh = Number((midBand + atr * 0.25).toFixed(2));

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
}): GeneratedSignalPayload {
  const { instrument, trendQuote, entryQuote, config } = params;
  const c = instrument.currency;

  const tTech = trendQuote.technicals!;
  const eTech = entryQuote.technicals!;
  const eLevels = entryQuote.levels!;
  const spotPrice = entryQuote.price ?? 0;
  const atr = eTech.atr ?? spotPrice * 0.004;

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
      detail: `${config.trendTimeframe} bias is ${tTech.trendBias} with rising EMA ${config.emaFast}/${config.emaMid}/${config.emaSlow} separation`,
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
      detail: `${eTech.candlePattern} within value zone (${(distFromEma20 / Math.max(atr, 1e-6)).toFixed(2)}x ATR from EMA ${config.emaMid})`,
    });
    reasonsFor.push(`${config.entryTimeframe} entry is inside high-probability pullback/breakout zone (not overextended).`);
  } else {
    checklist.push({
      label: `${config.entryTimeframe} Entry & Anti-Exhaustion Filter`,
      passed: false,
      detail: isOverextended
        ? `Extended ${(distFromEma20 / Math.max(atr, 1e-6)).toFixed(2)}x ATR from EMA ${config.emaMid} / RSI ${rsiVal} — avoiding chase.`
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
      detail: `Price (${spotPrice}) aligned above/below EMA ${config.emaFast} (${eTech.ema9}) -> EMA ${config.emaMid} (${eTech.ema20}) -> EMA ${config.emaSlow} (${eTech.ema50}).`,
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

  // Compute structural Entry, SL (with breathing room to prevent stop-hunts), and asymmetric Targets
  const roundPrice = (v: number) => Number(v.toFixed(spotPrice > 500 ? 2 : 4));
  let entryPrice = roundPrice(spotPrice);
  let stopLoss = 0;
  let target1 = 0;
  let target2 = 0;
  let target3 = 0;
  let invalidationLevel = 0;

  if (candidateDirection === 'BUY') {
    entryPrice = roundPrice(spotPrice);
    const structuralFloor = Math.min(
      eLevels.immediateSupport,
      eTech.ema20 !== null ? eTech.ema20 - atr * 0.45 : spotPrice - atr * 1.6
    );
    const risk = Math.max(atr * 1.6, Math.min(atr * 2.5, entryPrice - structuralFloor));
    stopLoss = roundPrice(entryPrice - risk);
    invalidationLevel = roundPrice(stopLoss - atr * 0.3);
    target1 = roundPrice(entryPrice + risk * 1.5);
    target2 = roundPrice(entryPrice + risk * 2.4);
    target3 = roundPrice(entryPrice + risk * 3.4);
  } else if (candidateDirection === 'SELL') {
    entryPrice = roundPrice(spotPrice);
    const structuralCap = Math.max(
      eLevels.immediateResistance,
      eTech.ema20 !== null ? eTech.ema20 + atr * 0.45 : spotPrice + atr * 1.6
    );
    const risk = Math.max(atr * 1.6, Math.min(atr * 2.5, structuralCap - entryPrice));
    stopLoss = roundPrice(entryPrice + risk);
    invalidationLevel = roundPrice(stopLoss + atr * 0.3);
    target1 = roundPrice(entryPrice - risk * 1.5);
    target2 = roundPrice(entryPrice - risk * 2.4);
    target3 = roundPrice(entryPrice - risk * 3.4);
  }

  const riskDist = Math.abs(entryPrice - stopLoss);
  const reward2Dist = Math.abs(target2 - entryPrice);
  const numericRR = riskDist > 0 ? Number((reward2Dist / riskDist).toFixed(2)) : 0;
  const rrString = numericRR > 0 ? `1:${numericRR}` : 'N/A';

  const rrPass = numericRR >= config.minRiskReward;
  checklist.push({
    label: `Risk-to-Reward (>= 1:${config.minRiskReward})`,
    passed: rrPass && candidateDirection !== 'NO_TRADE',
    detail: rrPass ? `Calculated R:R is ${rrString} with 1.6x–2.5x ATR swing SL.` : `Risk/Reward threshold not met.`,
  });

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

  // 8. Active Liquidity Session Filter
  const sessionFilterEnabled = config.enableSessionFilter !== false;
  const sessionState = isLiquiditySessionActive(instrument.segment, instrument.id);
  checklist.push({
    label: 'Active Session Liquidity Window',
    passed: !sessionFilterEnabled || sessionState.active,
    detail: sessionState.label,
  });
  if (sessionFilterEnabled && !sessionState.active) {
    reasonsAgainst.push(`${sessionState.label} — lower institutional follow-through.`);
  }

  // Strict Discipline Gate -> NO TRADE if chop, low ADX (unless A+ score >= 88), overextended, low score, or weak R:R
  const passesGate =
    candidateDirection !== 'NO_TRADE' &&
    !isOverextended &&
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
