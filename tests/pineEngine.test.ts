import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPineExecutionContext, evalBooleanExpr } from '../server/pineEngine.ts';
import { PINE_STRATEGY_TEMPLATES } from '../src/lib/pineTemplates.ts';
import { buildMrxSignalPayload, evaluateMrxReversalStrategy } from '../src/lib/mrxStrategy.ts';
import { INSTRUMENTS, type CandleBar } from '../src/types/trading.ts';

function buildWaveCandles(prices: number[]): CandleBar[] {
  return prices.map((close, idx) => {
    const open = idx > 0 ? prices[idx - 1] : close;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    return {
      time: 1700000000 + idx * 300,
      open,
      high,
      low,
      close,
      volume: 1000,
    };
  });
}

test('MR_X EMA 9-15-200 Reversal Pine v6 template parses cleanly with EMA 9/15/200 colors and reversal rules', () => {
  const mrX = PINE_STRATEGY_TEMPLATES.find((t) => t.id === 'mr-x-ema-9-15-200-reversal');
  assert.ok(mrX, 'MR_X template must exist in PINE_STRATEGY_TEMPLATES');
  assert.equal(mrX.name, 'MR_X EMA 9-15-200 Reversal');
  assert.equal(mrX.initialCapital, 1000);

  // Build synthetic candles:
  // 1) Long flat base at 100 so EMA200 stays near 100
  // 2) Rally above EMA200 -> dip -> sharp bullish rally triggering EMA9 crossing above EMA15 above EMA200
  // 3) Breakdown below EMA200 -> bounce -> sharp bearish drop triggering EMA9 crossing below EMA15 below EMA200
  const prices: number[] = [];
  for (let i = 0; i < 60; i++) prices.push(100);
  // Rise above EMA200, then pull back slightly so EMA9 dips below EMA15 while staying > EMA200
  for (let i = 0; i < 15; i++) prices.push(115 + i * 0.6);
  for (let i = 0; i < 12; i++) prices.push(124 - i * 1.1);
  // Sharp bullish surge so EMA9 crosses above EMA15 with close > ema200, ema9, ema15
  for (let i = 0; i < 15; i++) prices.push(112 + i * 2.5);

  // Collapse well below EMA200, bounce briefly so EMA9 rises above EMA15 while staying < EMA200
  for (let i = 0; i < 20; i++) prices.push(90 - i * 1.2);
  for (let i = 0; i < 12; i++) prices.push(68 + i * 1.3);
  // Sharp bearish plunge so EMA9 crosses under EMA15 with close < ema200, ema9, ema15
  for (let i = 0; i < 15; i++) prices.push(82 - i * 2.5);

  const candles = buildWaveCandles(prices);
  const { ctx, scalars, boolVars } = buildPineExecutionContext(mrX.pineCode, candles);

  assert.equal(ctx.summary.pineVersion, 'v6');
  assert.equal(ctx.summary.scriptTitle, 'MR_X EMA 9-15-200 Reversal');
  assert.equal(ctx.hasExplicitReversal, true);
  assert.ok(ctx.summary.indicatorsDetected.includes('EMA(9)'));
  assert.ok(ctx.summary.indicatorsDetected.includes('EMA(15)'));
  assert.ok(ctx.summary.indicatorsDetected.includes('EMA(200)'));
  assert.equal(ctx.summary.unsupportedConstructs.length, 0);

  // Verify explicit plot() colors & labels
  const ov9 = ctx.overlays.find((o) => o.seriesKey === 'ema9');
  const ov15 = ctx.overlays.find((o) => o.seriesKey === 'ema15');
  const ov200 = ctx.overlays.find((o) => o.seriesKey === 'ema200');
  assert.equal(ov9?.color, '#22C55E');
  assert.equal(ov15?.color, '#F97316');
  assert.equal(ov200?.color, '#EF4444');

  assert.ok(ctx.longExpr && ctx.longExpr.includes('buySignal'));
  assert.ok(ctx.shortExpr && ctx.shortExpr.includes('sellSignal'));

  // Scan bars for BUY and SELL triggers while verifying strategy.position_size guard
  const buyBarsWhenFlat: number[] = [];
  const sellBarsWhenFlat: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const buyFlat = evalBooleanExpr(ctx.longExpr!, i, ctx.series, scalars, boolVars, {
      positionSize: 0,
      isConfirmed: true,
    });
    const buyAlreadyLong = evalBooleanExpr(ctx.longExpr!, i, ctx.series, scalars, boolVars, {
      positionSize: 1,
      isConfirmed: true,
    });
    const buyUnconfirmed = evalBooleanExpr(ctx.longExpr!, i, ctx.series, scalars, boolVars, {
      positionSize: 0,
      isConfirmed: false,
    });

    // Must never fire when already long (pyramiding=0 via strategy.position_size <= 0) or unconfirmed
    assert.equal(buyAlreadyLong, false);
    assert.equal(buyUnconfirmed, false);
    if (buyFlat) buyBarsWhenFlat.push(i);

    const sellFlat = evalBooleanExpr(ctx.shortExpr!, i, ctx.series, scalars, boolVars, {
      positionSize: 0,
      isConfirmed: true,
    });
    const sellFromLong = evalBooleanExpr(ctx.shortExpr!, i, ctx.series, scalars, boolVars, {
      positionSize: 1,
      isConfirmed: true,
    });
    const sellAlreadyShort = evalBooleanExpr(ctx.shortExpr!, i, ctx.series, scalars, boolVars, {
      positionSize: -1,
      isConfirmed: true,
    });

    // Reversal from long must match flat trigger; already short must not re-fire
    assert.equal(sellFromLong, sellFlat);
    assert.equal(sellAlreadyShort, false);
    if (sellFlat) sellBarsWhenFlat.push(i);
  }

  assert.ok(buyBarsWhenFlat.length >= 1, 'Expected at least one confirmed BUY crossover above EMA 200');
  assert.ok(sellBarsWhenFlat.length >= 1, 'Expected at least one confirmed SELL crossunder below EMA 200');
});

test('Terminal MR_X EMA 9-15-200 Reversal evaluator matches Pine v6 reversal state machine', () => {
  const prices: number[] = [];
  for (let i = 0; i < 60; i++) prices.push(100);
  for (let i = 0; i < 15; i++) prices.push(115 + i * 0.6);
  for (let i = 0; i < 12; i++) prices.push(124 - i * 1.1);
  for (let i = 0; i < 15; i++) prices.push(112 + i * 2.5);
  for (let i = 0; i < 20; i++) prices.push(90 - i * 1.2);
  for (let i = 0; i < 12; i++) prices.push(68 + i * 1.3);
  for (let i = 0; i < 15; i++) prices.push(82 - i * 2.5);

  const candles = buildWaveCandles(prices);
  const res = evaluateMrxReversalStrategy(candles);

  assert.equal(res.ema9Series.length, candles.length);
  assert.equal(res.ema15Series.length, candles.length);
  assert.equal(res.ema200Series.length, candles.length);
  assert.ok(res.signals.length >= 2, 'Expected both BUY and SELL reversal markers');

  // Verify strict pyramiding=0 alternation (never two BUY or two SELL signals back-to-back)
  for (let i = 1; i < res.signals.length; i++) {
    assert.notEqual(res.signals[i].direction, res.signals[i - 1].direction);
    assert.equal(res.signals[i].isReversal, true);
  }
  assert.equal(res.signals[0].direction, 'BUY');
  assert.equal(res.lastSignal?.direction, 'SELL');
  assert.equal(res.positionState, 'SHORT');

  const xau = INSTRUMENTS.find((i) => i.id === 'XAUUSD')!;
  const payload = buildMrxSignalPayload({
    instrument: xau,
    timeframe: '5m',
    direction: 'SELL',
    spotPrice: candles[candles.length - 1].close,
    atr: 2,
    evaluation: res,
  });
  assert.equal(payload.direction, 'SELL');
  assert.ok(payload.stopLoss > payload.entryPrice);
  assert.ok(payload.target1 < payload.entryPrice);
});
