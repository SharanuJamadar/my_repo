import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTpLadderMetrics } from '../src/lib/tpLadderProgress.ts';

test('Losing SELL trade shows 0% TP progress and accurate SL drawdown instead of sky-blue TP fill', () => {
  // Exact screenshot scenario: XAGUSD SELL @ 39.945, SL 40.33, LTP 40.135 (-0.49R)
  const m = computeTpLadderMetrics({
    direction: 'SELL',
    entryPrice: 39.945,
    currentSl: 40.33,
    livePrice: 40.135,
    target1: 39.37,
    target2: 39.213,
    target3: 37.527,
    tpStage: 0,
    riskReward: '1:1.9',
  });

  assert.equal(m.zone, 'DRAWDOWN');
  assert.equal(m.tpProgressPct, 0);
  assert.ok(m.slDrawdownPct > 48 && m.slDrawdownPct < 51, `Expected ~49.4% to SL, got ${m.slDrawdownPct}`);
  assert.equal(m.liveRMultiple, -0.49);
  assert.match(m.statusLabel, /to SL/);
});

test('BE-locked trade preserves realistic Live R and accurate 3-TP ladder position', () => {
  // Exact screenshot scenario: XAUUSD SELL @ 3531.49, SL trailed to BE Lock 3529.47, LTP 3514.775
  const m = computeTpLadderMetrics({
    direction: 'SELL',
    entryPrice: 3531.49,
    currentSl: 3529.47,
    livePrice: 3514.775,
    target1: 3511.33,
    target2: 3497.89,
    target3: 3484.45,
    tpStage: 1,
    riskReward: '1:2.5',
  });

  assert.equal(m.zone, 'ENTRY_TO_TP1');
  // 16.715 / 20.16 = 82.9% of leg 1 -> ~27.6% of total 3-TP ladder (NOT 81%!)
  assert.ok(m.tpProgressPct > 26 && m.tpProgressPct < 29, `Expected ~27.6%, got ${m.tpProgressPct}`);
  // Original risk ~13.44 -> +1.24R (NOT inflated +8.27R!)
  assert.ok(
    m.liveRMultiple !== null && m.liveRMultiple > 1.1 && m.liveRMultiple < 1.4,
    `Expected ~1.24R, got ${m.liveRMultiple}`
  );
});

test('3-TP ladder maps Entry (0%) -> TP1 (33.3%) -> TP2 (66.7%) -> TP3 (100%) accurately for BUY', () => {
  const base = {
    direction: 'BUY' as const,
    entryPrice: 100,
    currentSl: 98,
    initialSl: 98,
    target1: 101.5, // 0.75R
    target2: 102.8, // 1.4R
    target3: 107.0, // 3.5R
    riskReward: '1:3.5',
  };

  const atEntry = computeTpLadderMetrics({ ...base, livePrice: 100 });
  assert.equal(atEntry.zone, 'AT_ENTRY');
  assert.equal(atEntry.tpProgressPct, 0);

  const halfTp1 = computeTpLadderMetrics({ ...base, livePrice: 100.75 });
  assert.equal(halfTp1.zone, 'ENTRY_TO_TP1');
  assert.ok(Math.abs(halfTp1.tpProgressPct - 16.7) < 0.2);

  const atTp1 = computeTpLadderMetrics({ ...base, livePrice: 101.5 });
  assert.equal(atTp1.zone, 'TP1_TO_TP2');
  assert.ok(Math.abs(atTp1.tpProgressPct - 33.3) < 0.2);

  const atTp2 = computeTpLadderMetrics({ ...base, livePrice: 102.8 });
  assert.equal(atTp2.zone, 'TP2_TO_TP3');
  assert.ok(Math.abs(atTp2.tpProgressPct - 66.7) < 0.2);

  const atTp3 = computeTpLadderMetrics({ ...base, livePrice: 107.0 });
  assert.equal(atTp3.zone, 'BEYOND_TP3');
  assert.equal(atTp3.tpProgressPct, 100);
  assert.equal(atTp3.liveRMultiple, 3.5);
});
