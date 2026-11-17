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

  const recentVols = candles.slice(-21, -1).map((c) => c.volume).filter((v) => v > 0);
  const lastVol = candles[candles.length - 1]?.volume ?? 0;
  let volumeRatio: number | null = null;
  if (recentVols.length >= 5 && lastVol > 0) {
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    if (avgVol > 0) volumeRatio = Number((lastVol / avgVol).toFixed(2));
  }

  let trendBias: TechnicalSnapshot['trendBias'] = 'SIDEWAYS';
  if (ema9 !== null && ema20 !== null && ema50 !== null) {
    if (lastClose > ema9 && ema9 > ema20 && ema20 >= ema50 * 0.999) {
      trendBias = 'BULLISH';
    } else if (lastClose < ema9 && ema9 < ema20 && ema20 <= ema50 * 1.001) {
      trendBias = 'BEARISH';
    } else if (lastClose > ema20 && ema9 > ema20) {
      trendBias = 'BULLISH';
    } else if (lastClose < ema20 && ema9 < ema20) {
      trendBias = 'BEARISH';
    }
  }

  let momentumState: TechnicalSnapshot['momentumState'] = 'NEUTRAL';
  const hist = macd?.histogram ?? 0;
  if (trendBias === 'BULLISH' && (rsi ?? 50) >= 60 && hist > 0) {
    momentumState = 'STRONG_BULLISH';
  } else if (trendBias === 'BULLISH' && (rsi ?? 50) >= 52) {
    momentumState = 'BULLISH';
  } else if (trendBias === 'BEARISH' && (rsi ?? 50) <= 40 && hist < 0) {
    momentumState = 'STRONG_BEARISH';
  } else if (trendBias === 'BEARISH' && (rsi ?? 50) <= 48) {
    momentumState = 'BEARISH';
  }

  return {
    ema9,
    ema20,
    ema50,
    vwap,
    rsi,
    macd,
    atr,
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
  const noTradeZoneLow = Number((midBand - atr * 0.35).toFixed(2));
  const noTradeZoneHigh = Number((midBand + atr * 0.35).toFixed(2));

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
  // Prefer ATM or 1-step ITM/near-ATM for clean delta & theta discipline
  const recommendedStrike = direction === 'BUY' ? atmStrike : atmStrike;
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

  // Determine 15m Trend & 5m Entry alignment
  const bull15m = tTech.trendBias === 'BULLISH';
  const bear15m = tTech.trendBias === 'BEARISH';
  const bull5m =
    eTech.trendBias === 'BULLISH' ||
    (eTech.ema9 !== null && spotPrice > eTech.ema9 && (eTech.macd?.histogram ?? 0) > 0);
  const bear5m =
    eTech.trendBias === 'BEARISH' ||
    (eTech.ema9 !== null && spotPrice < eTech.ema9 && (eTech.macd?.histogram ?? 0) < 0);

  let candidateDirection: 'BUY' | 'SELL' | 'NO_TRADE' = 'NO_TRADE';
  if (bull15m && bull5m) candidateDirection = 'BUY';
  else if (bear15m && bear5m) candidateDirection = 'SELL';

  // Checklist evaluation (transparent 100-point rubric)
  const checklist: ChecklistItem[] = [];
  const reasonsFor: string[] = [];
  const reasonsAgainst: string[] = [];
  let score = 0;

  // 1. 15m Trend Alignment (25 pts)
  const trendAligned = (candidateDirection === 'BUY' && bull15m) || (candidateDirection === 'SELL' && bear15m);
  if (trendAligned) {
    score += 25;
    checklist.push({
      label: `${config.trendTimeframe} Primary Trend Alignment`,
      passed: true,
      detail: `${config.trendTimeframe} bias is ${tTech.trendBias} (EMA ${config.emaFast}/${config.emaMid}/${config.emaSlow})`,
    });
    reasonsFor.push(`${config.trendTimeframe} trend confirms ${tTech.trendBias.toLowerCase()} directional structure.`);
  } else {
    checklist.push({
      label: `${config.trendTimeframe} Primary Trend Alignment`,
      passed: false,
      detail: `${config.trendTimeframe} bias is ${tTech.trendBias}; lacks decisive multi-timeframe trend sync.`,
    });
    reasonsAgainst.push(`${config.trendTimeframe} trend (${tTech.trendBias}) does not cleanly align with ${config.entryTimeframe} entry.`);
  }

  // 2. 5m Entry Confirmation (20 pts)
  const entryConfirmed =
    (candidateDirection === 'BUY' && bull5m) || (candidateDirection === 'SELL' && bear5m);
  if (entryConfirmed) {
    score += 20;
    checklist.push({
      label: `${config.entryTimeframe} Entry & Price Action Trigger`,
      passed: true,
      detail: `Pattern: ${eTech.candlePattern} supporting ${candidateDirection}`,
    });
    reasonsFor.push(`${config.entryTimeframe} price action (${eTech.candlePattern}) supports entry.`);
  } else {
    checklist.push({
      label: `${config.entryTimeframe} Entry & Price Action Trigger`,
      passed: false,
      detail: `Pattern: ${eTech.candlePattern} — waiting for clear ${config.entryTimeframe} breakout/breakdown.`,
    });
    reasonsAgainst.push(`${config.entryTimeframe} trigger candle is not aligned with primary direction.`);
  }

  // 3. EMA Alignment & Crude EMA 9 Special Rule (15 pts)
  const emaAligned =
    candidateDirection === 'BUY'
      ? eTech.ema9 !== null &&
        eTech.ema20 !== null &&
        spotPrice > eTech.ema9 &&
        eTech.ema9 >= eTech.ema20
      : candidateDirection === 'SELL'
        ? eTech.ema9 !== null &&
          eTech.ema20 !== null &&
          spotPrice < eTech.ema9 &&
          eTech.ema9 <= eTech.ema20
        : false;
  if (emaAligned) {
    score += 15;
    checklist.push({
      label: isCrude ? `EMA ${config.emaFast} (Crude Oil Priority) & Stack` : `EMA ${config.emaFast}/${config.emaMid}/${config.emaSlow} Alignment`,
      passed: true,
      detail: `Price (${spotPrice}) cleanly respecting EMA ${config.emaFast} (${eTech.ema9}) & EMA ${config.emaMid} (${eTech.ema20}).`,
    });
    reasonsFor.push(
      isCrude
        ? `COMEX/WTI Crude Oil EMA 9 priority condition satisfied (${spotPrice} vs EMA 9 ${eTech.ema9}).`
        : `EMA ${config.emaFast}/${config.emaMid} stack confirms directional control.`
    );
  } else {
    checklist.push({
      label: isCrude ? `EMA ${config.emaFast} (Crude Oil Priority) & Stack` : `EMA ${config.emaFast}/${config.emaMid}/${config.emaSlow} Alignment`,
      passed: false,
      detail: `Price and EMA ${config.emaFast}/${config.emaMid} show compression or mean-reversion.`,
    });
    reasonsAgainst.push(
      isCrude
        ? `Crude Oil EMA 9 momentum filter not cleanly triggered.`
        : `EMA ${config.emaFast}/${config.emaMid} alignment is incomplete.`
    );
  }

  // 4. VWAP & Volume Confirmation (15 pts)
  const vwapPass =
    candidateDirection === 'BUY'
      ? eTech.vwap !== null && spotPrice >= eTech.vwap
      : candidateDirection === 'SELL'
        ? eTech.vwap !== null && spotPrice <= eTech.vwap
        : false;
  const volPass = eTech.volumeRatio === null ? true : eTech.volumeRatio >= 0.9;
  if (vwapPass && volPass) {
    score += 15;
    checklist.push({
      label: 'VWAP & Volume Confirmation',
      passed: true,
      detail: `Price vs VWAP (${eTech.vwap}) favorable${eTech.volumeRatio ? `, Volume ${eTech.volumeRatio}x avg` : ''}.`,
    });
    reasonsFor.push(`VWAP positioning supports ${candidateDirection} side.`);
  } else {
    if (vwapPass || volPass) score += 7;
    checklist.push({
      label: 'VWAP & Volume Confirmation',
      passed: false,
      detail: `VWAP=${eTech.vwap ?? 'N/A'}, Vol Ratio=${eTech.volumeRatio ?? 'N/A'}x.`,
    });
    reasonsAgainst.push(`Volume/VWAP confirmation is partial or muted.`);
  }

  // 5. RSI & MACD Momentum (15 pts)
  const rsiVal = eTech.rsi ?? 50;
  const macdHist = eTech.macd?.histogram ?? 0;
  const momentumPass =
    candidateDirection === 'BUY'
      ? rsiVal >= config.rsiBullishMin && rsiVal <= 76 && macdHist > 0
      : candidateDirection === 'SELL'
        ? rsiVal <= config.rsiBearishMax && rsiVal >= 24 && macdHist < 0
        : false;
  if (momentumPass) {
    score += 15;
    checklist.push({
      label: 'RSI & MACD Momentum',
      passed: true,
      detail: `RSI(${config.rsiPeriod})=${rsiVal}, MACD Hist=${macdHist}.`,
    });
    reasonsFor.push(`RSI (${rsiVal}) and MACD histogram (${macdHist}) confirm active momentum.`);
  } else {
    checklist.push({
      label: 'RSI & MACD Momentum',
      passed: false,
      detail: `RSI=${rsiVal} (target ${candidateDirection === 'BUY' ? `>=${config.rsiBullishMin}` : `<=${config.rsiBearishMax}`}), MACD Hist=${macdHist}.`,
    });
    reasonsAgainst.push(`RSI/MACD momentum lacks strong impulse or approaches exhaustion.`);
  }

  // 6. Support / Resistance & No-Trade Zone Positioning (10 pts)
  const inNoTradeZone = spotPrice >= eLevels.noTradeZoneLow && spotPrice <= eLevels.noTradeZoneHigh;
  if (!inNoTradeZone && candidateDirection !== 'NO_TRADE') {
    score += 10;
    checklist.push({
      label: 'Support/Resistance & No-Trade Zone',
      passed: true,
      detail: `Price outside No-Trade Zone (${eLevels.noTradeZoneLow} - ${eLevels.noTradeZoneHigh}).`,
    });
    reasonsFor.push(`Clean structural clearance outside the choppy No-Trade Zone.`);
  } else {
    checklist.push({
      label: 'Support/Resistance & No-Trade Zone',
      passed: false,
      detail: inNoTradeZone
        ? `Price (${spotPrice}) is inside No-Trade Zone (${eLevels.noTradeZoneLow} - ${eLevels.noTradeZoneHigh}).`
        : 'Awaiting directional break of S/R structure.',
    });
    reasonsAgainst.push(
      inNoTradeZone
        ? `Price is trapped inside the intraday No-Trade Zone (${eLevels.noTradeZoneLow}–${eLevels.noTradeZoneHigh}).`
        : `Insufficient clearance from nearby S/R structure.`
    );
  }

  // Compute structural Entry, SL, Targets
  const roundPrice = (v: number) => Number(v.toFixed(spotPrice > 500 ? 2 : 4));
  let entryPrice = roundPrice(spotPrice);
  let stopLoss = 0;
  let target1 = 0;
  let target2 = 0;
  let target3 = 0;
  let invalidationLevel = 0;

  if (candidateDirection === 'BUY') {
    entryPrice = roundPrice(Math.max(spotPrice, eLevels.breakoutLevel - atr * 0.1));
    const structuralSl = Math.min(eLevels.immediateSupport, eTech.ema20 ?? spotPrice - atr * 1.1);
    const risk = Math.max(atr * 1.1, Math.min(atr * 2.2, entryPrice - structuralSl));
    stopLoss = roundPrice(entryPrice - risk);
    invalidationLevel = roundPrice(stopLoss - atr * 0.25);
    target1 = roundPrice(entryPrice + risk * 1.5);
    target2 = roundPrice(entryPrice + risk * 2.2);
    target3 = roundPrice(entryPrice + risk * 3.0);
  } else if (candidateDirection === 'SELL') {
    entryPrice = roundPrice(Math.min(spotPrice, eLevels.breakdownLevel + atr * 0.1));
    const structuralSl = Math.max(eLevels.immediateResistance, eTech.ema20 ?? spotPrice + atr * 1.1);
    const risk = Math.max(atr * 1.1, Math.min(atr * 2.2, structuralSl - entryPrice));
    stopLoss = roundPrice(entryPrice + risk);
    invalidationLevel = roundPrice(stopLoss + atr * 0.25);
    target1 = roundPrice(entryPrice - risk * 1.5);
    target2 = roundPrice(entryPrice - risk * 2.2);
    target3 = roundPrice(entryPrice - risk * 3.0);
  }

  const riskDist = Math.abs(entryPrice - stopLoss);
  const reward2Dist = Math.abs(target2 - entryPrice);
  const numericRR = riskDist > 0 ? Number((reward2Dist / riskDist).toFixed(2)) : 0;
  const rrString = numericRR > 0 ? `1:${numericRR}` : 'N/A';

  const rrPass = numericRR >= config.minRiskReward;
  checklist.push({
    label: `Risk-to-Reward (>= 1:${config.minRiskReward})`,
    passed: rrPass && candidateDirection !== 'NO_TRADE',
    detail: rrPass ? `Calculated R:R is ${rrString} based on ATR & S/R structure.` : `Risk/Reward threshold not met.`,
  });

  // Final Discipline Gate -> NO TRADE if score < minSetupScore or timeframes conflict or inside No-Trade Zone
  const passesGate =
    candidateDirection !== 'NO_TRADE' &&
    score >= config.minSetupScore &&
    rrPass &&
    !inNoTradeZone;

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
