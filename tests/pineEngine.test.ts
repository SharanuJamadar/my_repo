import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPineExecutionContext,
  computeThreeTpLevels,
  evalBooleanExpr,
} from '../server/pineEngine.ts';
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

test('MRX - EMA 9/15/30 Continuous Strategy Pine v5 template parses cleanly with exact colors and rules', () => {
  const mrx = PINE_STRATEGY_TEMPLATES.find((t) => t.id === 'mrx-ema-9-15-30-continuous');
  assert.ok(mrx, 'MRX 9/15/30 template must exist in PINE_STRATEGY_TEMPLATES');
  assert.equal(mrx.name, 'MRX - EMA 9/15/30 Continuous Strategy');
  assert.equal(mrx.initialCapital, 1000);

  // Build synthetic candles:
  // 1) Flat base at 100 so EMA30 settles at 100
  // 2) Rally above EMA30 -> shallow dip (EMA9 < EMA15) -> bullish rally triggering crossover(ema9, ema15) & close > ema30
  // 3) Breakdown below EMA30 -> brief bounce (EMA9 > EMA15) -> bearish drop triggering crossunder(ema9, ema15) & close < ema30
  const prices: number[] = [];
  for (let i = 0; i < 40; i++) prices.push(100);
  for (let i = 0; i < 12; i++) prices.push(115 + i * 0.6);
  for (let i = 0; i < 10; i++) prices.push(121 - i * 0.8);
  for (let i = 0; i < 14; i++) prices.push(114 + i * 2.4);

  for (let i = 0; i < 18; i++) prices.push(95 - i * 1.4);
  for (let i = 0; i < 10; i++) prices.push(71 + i * 1.1);
  for (let i = 0; i < 14; i++) prices.push(80 - i * 2.4);

  const candles = buildWaveCandles(prices);
  const { ctx, scalars, boolVars } = buildPineExecutionContext(mrx.pineCode, candles);

  assert.equal(ctx.summary.pineVersion, 'v5');
  assert.equal(ctx.summary.scriptTitle, 'MRX - EMA 9/15/30 Continuous Strategy');
  assert.equal(ctx.hasExplicitReversal, true);
  assert.ok(ctx.summary.indicatorsDetected.includes('EMA(9)'));
  assert.ok(ctx.summary.indicatorsDetected.includes('EMA(15)'));
  assert.ok(ctx.summary.indicatorsDetected.includes('EMA(30)'));
  assert.equal(ctx.summary.unsupportedConstructs.length, 0);

  // Verify explicit plot() colors & titles
  const ov9 = ctx.overlays.find((o) => o.seriesKey === 'ema9');
  const ov15 = ctx.overlays.find((o) => o.seriesKey === 'ema15');
  const ov30 = ctx.overlays.find((o) => o.seriesKey === 'ema30');
  assert.equal(ov9?.color, '#84CC16'); // color.lime
  assert.equal(ov15?.color, '#F97316'); // color.orange
  assert.equal(ov30?.color, '#EF4444'); // color.red
  assert.equal(ov9?.label, 'EMA 9');
  assert.equal(ov15?.label, 'EMA 15');
  assert.equal(ov30?.label, 'EMA 30');

  assert.ok(ctx.longExpr && ctx.longExpr.includes('buySignal'));
  assert.ok(ctx.shortExpr && ctx.shortExpr.includes('sellSignal'));

  const buyBars: number[] = [];
  const sellBars: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    if (evalBooleanExpr(ctx.longExpr!, i, ctx.series, scalars, boolVars)) {
      buyBars.push(i);
    }
    if (evalBooleanExpr(ctx.shortExpr!, i, ctx.series, scalars, boolVars)) {
      sellBars.push(i);
    }
  }

  assert.ok(buyBars.length >= 1, 'Expected at least one BUY crossover above EMA 30');
  assert.ok(sellBars.length >= 1, 'Expected at least one SELL crossunder below EMA 30');
});

test('Terminal MRX EMA 9/15/30 Continuous evaluator matches Pine v5 rules, offset=-1 arrows, and 3-TP spacing', () => {
  const prices: number[] = [];
  for (let i = 0; i < 40; i++) prices.push(100);
  for (let i = 0; i < 12; i++) prices.push(115 + i * 0.6);
  for (let i = 0; i < 10; i++) prices.push(121 - i * 0.8);
  for (let i = 0; i < 14; i++) prices.push(114 + i * 2.4);
  for (let i = 0; i < 18; i++) prices.push(95 - i * 1.4);
  for (let i = 0; i < 10; i++) prices.push(71 + i * 1.1);
  for (let i = 0; i < 14; i++) prices.push(80 - i * 2.4);

  const candles = buildWaveCandles(prices);
  const res = evaluateMrxReversalStrategy(candles);

  assert.equal(res.ema9Series.length, candles.length);
  assert.equal(res.ema15Series.length, candles.length);
  assert.equal(res.ema30Series.length, candles.length);
  assert.ok(res.signals.length >= 2, 'Expected both BUY and SELL continuous signals');

  // Verify strict pyramiding=0 alternation and offset=-1 markerTime
  for (let i = 0; i < res.signals.length; i++) {
    const s = res.signals[i];
    assert.equal(s.markerTime, candles[Math.max(0, s.barIndex - 1)].time);
    if (i > 0) {
      assert.notEqual(s.direction, res.signals[i - 1].direction);
      assert.equal(s.isReversal, true);
    }
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
  assert.match(payload.contract, /MRX 9\/15\/30 Continuous/);
  assert.ok(payload.stopLoss > payload.entryPrice);
  assert.ok(payload.target1 < payload.entryPrice);
  assert.ok(payload.target2 < payload.target1);
  assert.ok((payload.target3 ?? 0) < payload.target2);

  // Verify TP1 and TP2 stay near execution point (<= 0.85R and <= 1.5R) while TP3 runs long (>= 3.4R)
  const risk = Math.abs(payload.stopLoss - payload.entryPrice);
  const tp1R = Math.abs(payload.entryPrice - payload.target1) / risk;
  const tp2R = Math.abs(payload.entryPrice - payload.target2) / risk;
  const tp3R = Math.abs(payload.entryPrice - (payload.target3 ?? 0)) / risk;
  assert.ok(tp1R <= 0.85, `Expected TP1 near entry (<=0.85R), got ${tp1R.toFixed(2)}R`);
  assert.ok(tp2R <= 1.5, `Expected TP2 near entry (<=1.5R), got ${tp2R.toFixed(2)}R`);
  assert.ok(tp3R >= 3.4, `Expected TP3 long runner (>=3.4R), got ${tp3R.toFixed(2)}R`);
});

test('Pine computeThreeTpLevels keeps TP1 & TP2 near entry and TP3 long per strategy target', () => {
  const levels = computeThreeTpLevels('BUY', 1000, 1, 4.5);
  const risk = 1000 - levels.stopLoss; // 10
  const tp1R = (levels.tp1 - 1000) / risk;
  const tp2R = (levels.tp2 - 1000) / risk;
  const tp3R = (levels.tp3 - 1000) / risk;
  assert.ok(tp1R > 0.5 && tp1R <= 0.8, `Expected TP1 ~0.75R, got ${tp1R}`);
  assert.ok(tp2R > 1.2 && tp2R <= 1.5, `Expected TP2 ~1.4R, got ${tp2R}`);
  assert.ok(tp3R >= 4.4, `Expected TP3 to honor 4.5R strategy target, got ${tp3R}`);
});
