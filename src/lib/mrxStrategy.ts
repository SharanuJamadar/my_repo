import type {
  CandleBar,
  GeneratedSignalPayload,
  InstrumentMeta,
  Timeframe,
} from '../types/trading';

export interface MrxSignalPoint {
  time: number;
  /** Bar time where the signal arrow is plotted (matches Pine plotshape offset=-1). */
  markerTime: number;
  barIndex: number;
  direction: 'BUY' | 'SELL';
  price: number;
  ema9: number;
  ema15: number;
  ema30: number;
  isReversal: boolean;
}

export interface MrxEvaluationResult {
  ema9Series: { time: number; value: number }[];
  ema15Series: { time: number; value: number }[];
  ema30Series: { time: number; value: number }[];
  signals: MrxSignalPoint[];
  positionState: 'LONG' | 'SHORT' | 'FLAT';
  lastSignal: MrxSignalPoint | null;
  freshSignalOnLatestBar: MrxSignalPoint | null;
  latest: {
    close: number;
    ema9: number;
    ema15: number;
    ema30: number;
    aboveEma30: boolean;
    belowEma30: boolean;
    bullishAlignment: boolean;
    bearishAlignment: boolean;
  } | null;
}

function getDecimals(price: number): number {
  const abs = Math.abs(price);
  if (!Number.isFinite(abs) || abs === 0) return 2;
  if (abs >= 100) return 2;
  if (abs >= 1) return 4;
  return 6;
}

function roundVal(value: number, refPrice: number): number {
  const d = getDecimals(refPrice);
  return Number(value.toFixed(d));
}

function calcEmaValues(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = new Array(closes.length);
  let prev = closes[0];
  out[0] = prev;
  for (let i = 1; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Exact implementation of the Pine Script v5 "MRX - EMA 9/15/30 Continuous Strategy":
 * - ema9 = ta.ema(close, 9), ema15 = ta.ema(close, 15), ema30 = ta.ema(close, 30)
 * - buySignal  = ta.crossover(ema9, ema15) and close > ema30
 * - sellSignal = ta.crossunder(ema9, ema15) and close < ema30
 * - Continuous trading with pyramiding=0 (strategy.entry BUY / SELL flips opposite side automatically)
 * - plotshape arrow placed at offset=-1 (markerTime = previous bar time when available)
 */
export function evaluateMrxReversalStrategy(
  candles: CandleBar[],
  lengths: { ema9Len?: number; ema15Len?: number; ema30Len?: number } = {}
): MrxEvaluationResult {
  if (!candles || candles.length === 0) {
    return {
      ema9Series: [],
      ema15Series: [],
      ema30Series: [],
      signals: [],
      positionState: 'FLAT',
      lastSignal: null,
      freshSignalOnLatestBar: null,
      latest: null,
    };
  }

  const ema9Len = lengths.ema9Len ?? 9;
  const ema15Len = lengths.ema15Len ?? 15;
  const ema30Len = lengths.ema30Len ?? 30;

  const closes = candles.map((c) => c.close);
  const ema9Arr = calcEmaValues(closes, ema9Len);
  const ema15Arr = calcEmaValues(closes, ema15Len);
  const ema30Arr = calcEmaValues(closes, ema30Len);

  const ema9Series: { time: number; value: number }[] = [];
  const ema15Series: { time: number; value: number }[] = [];
  const ema30Series: { time: number; value: number }[] = [];
  const signals: MrxSignalPoint[] = [];

  // 0 = flat, 1 = long, -1 = short (matches pyramiding=0 continuous strategy.entry)
  let positionSize = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const e9 = ema9Arr[i];
    const e15 = ema15Arr[i];
    const e30 = ema30Arr[i];

    ema9Series.push({ time: c.time, value: roundVal(e9, c.close) });
    ema15Series.push({ time: c.time, value: roundVal(e15, c.close) });
    ema30Series.push({ time: c.time, value: roundVal(e30, c.close) });

    if (i < 1) continue;

    const prevE9 = ema9Arr[i - 1];
    const prevE15 = ema15Arr[i - 1];

    const bullCross = prevE9 <= prevE15 && e9 > e15;
    const bearCross = prevE9 >= prevE15 && e9 < e15;

    const buySignal = bullCross && c.close > e30;
    const sellSignal = bearCross && c.close < e30;
    const markerTime = candles[Math.max(0, i - 1)].time;

    if (buySignal && positionSize <= 0) {
      const isReversal = positionSize < 0;
      positionSize = 1;
      signals.push({
        time: c.time,
        markerTime,
        barIndex: i,
        direction: 'BUY',
        price: roundVal(c.close, c.close),
        ema9: roundVal(e9, c.close),
        ema15: roundVal(e15, c.close),
        ema30: roundVal(e30, c.close),
        isReversal,
      });
    } else if (sellSignal && positionSize >= 0) {
      const isReversal = positionSize > 0;
      positionSize = -1;
      signals.push({
        time: c.time,
        markerTime,
        barIndex: i,
        direction: 'SELL',
        price: roundVal(c.close, c.close),
        ema9: roundVal(e9, c.close),
        ema15: roundVal(e15, c.close),
        ema30: roundVal(e30, c.close),
        isReversal,
      });
    }
  }

  const lastIdx = candles.length - 1;
  const lastCandle = candles[lastIdx];
  const lastE9 = ema9Arr[lastIdx];
  const lastE15 = ema15Arr[lastIdx];
  const lastE30 = ema30Arr[lastIdx];
  const lastSignal = signals.length > 0 ? signals[signals.length - 1] : null;
  const freshSignalOnLatestBar =
    lastSignal && lastSignal.barIndex >= lastIdx - 1 ? lastSignal : null;

  return {
    ema9Series,
    ema15Series,
    ema30Series,
    signals,
    positionState: positionSize > 0 ? 'LONG' : positionSize < 0 ? 'SHORT' : 'FLAT',
    lastSignal,
    freshSignalOnLatestBar,
    latest: {
      close: roundVal(lastCandle.close, lastCandle.close),
      ema9: roundVal(lastE9, lastCandle.close),
      ema15: roundVal(lastE15, lastCandle.close),
      ema30: roundVal(lastE30, lastCandle.close),
      aboveEma30: lastCandle.close > lastE30,
      belowEma30: lastCandle.close < lastE30,
      bullishAlignment: lastE9 > lastE15 && lastCandle.close > lastE30,
      bearishAlignment: lastE9 < lastE15 && lastCandle.close < lastE30,
    },
  };
}

/**
 * Builds an executable GeneratedSignalPayload from the MRX - EMA 9/15/30 Continuous Strategy
 * for instant execution, paper logging, or Telegram broadcast from the main terminal.
 */
export function buildMrxSignalPayload(params: {
  instrument: InstrumentMeta;
  timeframe: Timeframe;
  direction: 'BUY' | 'SELL';
  spotPrice: number;
  atr?: number | null;
  evaluation: MrxEvaluationResult;
}): GeneratedSignalPayload {
  const { instrument, timeframe, direction, spotPrice, atr, evaluation } = params;
  const latest = evaluation.latest;
  const safeAtr =
    typeof atr === 'number' && Number.isFinite(atr) && atr > 0
      ? atr
      : Math.max(spotPrice * 0.004, 0.0005);

  const riskDist = safeAtr * 1.35;
  const r = (v: number) => roundVal(v, spotPrice);
  const entryPrice = r(spotPrice);
  const stopLoss =
    direction === 'BUY' ? r(Math.max(0, entryPrice - riskDist)) : r(entryPrice + riskDist);

  // Keep TP1 & TP2 near the execution point for fast partial booking & BE/TP1 SL protection,
  // and keep TP3 extended as the long trend runner per MRX EMA 9/15/30 continuous wave expansion.
  const tp1Dist = riskDist * 0.75;
  const tp2Dist = riskDist * 1.4;
  const ema30Spread = latest ? Math.abs(entryPrice - latest.ema30) : 0;
  const tp3Dist = Math.max(riskDist * 3.5, Math.min(riskDist * 5.0, ema30Spread * 2.2));

  const target1 =
    direction === 'BUY' ? r(entryPrice + tp1Dist) : r(Math.max(0, entryPrice - tp1Dist));
  const target2 =
    direction === 'BUY' ? r(entryPrice + tp2Dist) : r(Math.max(0, entryPrice - tp2Dist));
  const target3 =
    direction === 'BUY' ? r(entryPrice + tp3Dist) : r(Math.max(0, entryPrice - tp3Dist));
  const runnerRR = riskDist > 0 ? Number((Math.abs(target3 - entryPrice) / riskDist).toFixed(2)) : 3.5;

  const tfLabel = timeframe.toUpperCase();
  const c = instrument.currency;
  const emaSummary = latest
    ? `EMA 9: ${latest.ema9} | EMA 15: ${latest.ema15} | EMA 30: ${latest.ema30}`
    : 'EMA 9 / 15 / 30 Continuous';

  return {
    instrument: instrument.symbol,
    marketSegment: instrument.segment,
    contract: `${instrument.symbol} [MRX 9/15/30 Continuous]`,
    direction,
    entryTrigger:
      direction === 'BUY'
        ? `MRX BUY Signal (EMA 9 > EMA 15 & Close > EMA 30)`
        : `MRX SELL Signal (EMA 9 < EMA 15 & Close < EMA 30)`,
    entryPrice,
    stopLoss,
    target1,
    target2,
    target3,
    riskReward: `1:${runnerRR}`,
    entryTimeframe: tfLabel,
    trendTimeframe: tfLabel,
    horizon: timeframe === '1d' || timeframe === '4h' ? 'SWING' : 'INTRADAY',
    invalidationLevel: stopLoss,
    confirmationText: `MRX - EMA 9/15/30 Continuous Strategy (${tfLabel}) · ${emaSummary}`,
    status: 'ACTIVE',
    qualityScore: evaluation.freshSignalOnLatestBar ? 88 : 80,
    checklist: [
      {
        label: 'EMA 30 Trend Filter',
        passed: direction === 'BUY' ? Boolean(latest?.aboveEma30) : Boolean(latest?.belowEma30),
        detail: latest ? `Close ${latest.close} vs EMA 30 ${latest.ema30}` : 'EMA 30 check',
      },
      {
        label: 'EMA 9 / EMA 15 Crossover Alignment',
        passed:
          direction === 'BUY'
            ? Boolean(latest?.bullishAlignment)
            : Boolean(latest?.bearishAlignment),
        detail: latest ? `EMA 9=${latest.ema9}, EMA 15=${latest.ema15}` : 'EMA 9/15 crossover',
      },
      {
        label: 'Continuous Trading (Pyramiding = 0)',
        passed: true,
        detail: `Strategy state: ${evaluation.positionState} (${evaluation.signals.length} signals in chart history)`,
      },
    ],
    reasonsFor: [
      `MRX ${direction} signal confirmed on ${tfLabel} bar close.`,
      emaSummary,
    ],
    reasonsAgainst: [],
    formattedSignalText: `MRX - EMA 9/15/30 Continuous Strategy | ${direction} ${instrument.symbol} (${tfLabel})\nEntry: ${c}${entryPrice} | SL: ${c}${stopLoss}\nTP1: ${c}${target1} | TP2: ${c}${target2} | TP3: ${c}${target3}\n${emaSummary}`,
    telegramReadyText: `MRX ${direction} Signal · ${instrument.symbol} (${tfLabel})\nEntry: ${c}${entryPrice}\nSL: ${c}${stopLoss}\nTP1: ${c}${target1} | TP2: ${c}${target2} | TP3: ${c}${target3}\n${emaSummary}`,
  };
}
