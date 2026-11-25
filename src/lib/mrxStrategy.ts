import type {
  CandleBar,
  GeneratedSignalPayload,
  InstrumentMeta,
  Timeframe,
} from '../types/trading';

export interface MrxSignalPoint {
  time: number;
  barIndex: number;
  direction: 'BUY' | 'SELL';
  price: number;
  ema9: number;
  ema15: number;
  ema200: number;
  isReversal: boolean;
}

export interface MrxEvaluationResult {
  ema9Series: { time: number; value: number }[];
  ema15Series: { time: number; value: number }[];
  ema200Series: { time: number; value: number }[];
  signals: MrxSignalPoint[];
  positionState: 'LONG' | 'SHORT' | 'FLAT';
  lastSignal: MrxSignalPoint | null;
  freshSignalOnLatestBar: MrxSignalPoint | null;
  latest: {
    close: number;
    ema9: number;
    ema15: number;
    ema200: number;
    aboveEma200: boolean;
    belowEma200: boolean;
    aboveFastEmas: boolean;
    belowFastEmas: boolean;
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
 * Exact implementation of the Pine Script v6 "MR_X EMA 9-15-200 Reversal" strategy:
 * - ema9 = ta.ema(close, 9), ema15 = ta.ema(close, 15), ema200 = ta.ema(close, 200)
 * - bullCross = ta.crossover(ema9, ema15), bearCross = ta.crossunder(ema9, ema15)
 * - buySignal  = close > ema200 && close > ema9 && close > ema15 && bullCross
 * - sellSignal = close < ema200 && close < ema9 && close < ema15 && bearCross
 * - Reversal state machine with pyramiding=0 (position_size <= 0 for BUY, >= 0 for SELL)
 */
export function evaluateMrxReversalStrategy(candles: CandleBar[]): MrxEvaluationResult {
  if (!candles || candles.length === 0) {
    return {
      ema9Series: [],
      ema15Series: [],
      ema200Series: [],
      signals: [],
      positionState: 'FLAT',
      lastSignal: null,
      freshSignalOnLatestBar: null,
      latest: null,
    };
  }

  const closes = candles.map((c) => c.close);
  const ema9Arr = calcEmaValues(closes, 9);
  const ema15Arr = calcEmaValues(closes, 15);
  const ema200Arr = calcEmaValues(closes, 200);

  const ema9Series: { time: number; value: number }[] = [];
  const ema15Series: { time: number; value: number }[] = [];
  const ema200Series: { time: number; value: number }[] = [];
  const signals: MrxSignalPoint[] = [];

  // 0 = flat, 1 = long, -1 = short (matches strategy.position_size with pyramiding=0)
  let positionSize = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const e9 = ema9Arr[i];
    const e15 = ema15Arr[i];
    const e200 = ema200Arr[i];

    ema9Series.push({ time: c.time, value: roundVal(e9, c.close) });
    ema15Series.push({ time: c.time, value: roundVal(e15, c.close) });
    ema200Series.push({ time: c.time, value: roundVal(e200, c.close) });

    if (i < 1) continue;

    const prevE9 = ema9Arr[i - 1];
    const prevE15 = ema15Arr[i - 1];

    const bullCross = prevE9 <= prevE15 && e9 > e15;
    const bearCross = prevE9 >= prevE15 && e9 < e15;

    const buySignal =
      c.close > e200 && c.close > e9 && c.close > e15 && bullCross;
    const sellSignal =
      c.close < e200 && c.close < e9 && c.close < e15 && bearCross;

    if (buySignal && positionSize <= 0) {
      const isReversal = positionSize < 0;
      positionSize = 1;
      signals.push({
        time: c.time,
        barIndex: i,
        direction: 'BUY',
        price: roundVal(c.close, c.close),
        ema9: roundVal(e9, c.close),
        ema15: roundVal(e15, c.close),
        ema200: roundVal(e200, c.close),
        isReversal,
      });
    } else if (sellSignal && positionSize >= 0) {
      const isReversal = positionSize > 0;
      positionSize = -1;
      signals.push({
        time: c.time,
        barIndex: i,
        direction: 'SELL',
        price: roundVal(c.close, c.close),
        ema9: roundVal(e9, c.close),
        ema15: roundVal(e15, c.close),
        ema200: roundVal(e200, c.close),
        isReversal,
      });
    }
  }

  const lastIdx = candles.length - 1;
  const lastCandle = candles[lastIdx];
  const lastE9 = ema9Arr[lastIdx];
  const lastE15 = ema15Arr[lastIdx];
  const lastE200 = ema200Arr[lastIdx];
  const lastSignal = signals.length > 0 ? signals[signals.length - 1] : null;
  const freshSignalOnLatestBar =
    lastSignal && lastSignal.barIndex >= lastIdx - 1 ? lastSignal : null;

  return {
    ema9Series,
    ema15Series,
    ema200Series,
    signals,
    positionState: positionSize > 0 ? 'LONG' : positionSize < 0 ? 'SHORT' : 'FLAT',
    lastSignal,
    freshSignalOnLatestBar,
    latest: {
      close: roundVal(lastCandle.close, lastCandle.close),
      ema9: roundVal(lastE9, lastCandle.close),
      ema15: roundVal(lastE15, lastCandle.close),
      ema200: roundVal(lastE200, lastCandle.close),
      aboveEma200: lastCandle.close > lastE200,
      belowEma200: lastCandle.close < lastE200,
      aboveFastEmas: lastCandle.close > lastE9 && lastCandle.close > lastE15,
      belowFastEmas: lastCandle.close < lastE9 && lastCandle.close < lastE15,
      bullishAlignment: lastE9 > lastE15 && lastCandle.close > lastE200,
      bearishAlignment: lastE9 < lastE15 && lastCandle.close < lastE200,
    },
  };
}

/**
 * Builds an executable GeneratedSignalPayload from the MR_X EMA 9-15-200 Reversal strategy
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
  const target1 =
    direction === 'BUY' ? r(entryPrice + riskDist * 1.5) : r(Math.max(0, entryPrice - riskDist * 1.5));
  const target2 =
    direction === 'BUY' ? r(entryPrice + riskDist * 2.5) : r(Math.max(0, entryPrice - riskDist * 2.5));
  const target3 =
    direction === 'BUY' ? r(entryPrice + riskDist * 3.5) : r(Math.max(0, entryPrice - riskDist * 3.5));

  const tfLabel = timeframe.toUpperCase();
  const c = instrument.currency;
  const emaSummary = latest
    ? `EMA 9: ${latest.ema9} | EMA 15: ${latest.ema15} | EMA 200: ${latest.ema200}`
    : 'EMA 9 / 15 / 200 Reversal';

  return {
    instrument: instrument.symbol,
    marketSegment: instrument.segment,
    contract: `${instrument.symbol} [MR_X 9-15-200 Reversal]`,
    direction,
    entryTrigger:
      direction === 'BUY'
        ? `MR_X BUY Reversal (EMA 9 > EMA 15 above EMA 200)`
        : `MR_X SELL Reversal (EMA 9 < EMA 15 below EMA 200)`,
    entryPrice,
    stopLoss,
    target1,
    target2,
    target3,
    riskReward: '1:2.5',
    entryTimeframe: tfLabel,
    trendTimeframe: tfLabel,
    horizon: timeframe === '1d' || timeframe === '4h' ? 'SWING' : 'INTRADAY',
    invalidationLevel: stopLoss,
    confirmationText: `MR_X EMA 9-15-200 Reversal (${tfLabel}) · ${emaSummary}`,
    status: 'ACTIVE',
    qualityScore: evaluation.freshSignalOnLatestBar ? 88 : 80,
    checklist: [
      {
        label: 'EMA 200 Macro Trend Filter',
        passed: direction === 'BUY' ? Boolean(latest?.aboveEma200) : Boolean(latest?.belowEma200),
        detail: latest ? `Close ${latest.close} vs EMA 200 ${latest.ema200}` : 'EMA 200 check',
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
        label: 'Reversal State (Pyramiding = 0)',
        passed: true,
        detail: `Strategy state: ${evaluation.positionState} (${evaluation.signals.length} reversals in chart history)`,
      },
    ],
    reasonsFor: [
      `MR_X ${direction} reversal confirmed on ${tfLabel} bar close.`,
      emaSummary,
    ],
    reasonsAgainst: [],
    formattedSignalText: `MR_X EMA 9-15-200 Reversal | ${direction} ${instrument.symbol} (${tfLabel})\nEntry: ${c}${entryPrice} | SL: ${c}${stopLoss}\nTP1: ${c}${target1} | TP2: ${c}${target2} | TP3: ${c}${target3}\n${emaSummary}`,
    telegramReadyText: `MR_X ${direction} Reversal · ${instrument.symbol} (${tfLabel})\nEntry: ${c}${entryPrice}\nSL: ${c}${stopLoss}\nTP1: ${c}${target1} | TP2: ${c}${target2} | TP3: ${c}${target3}\n${emaSummary}`,
  };
}
