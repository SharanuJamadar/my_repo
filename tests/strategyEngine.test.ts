import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRSI,
  calculateVWAPSeries,
  computeLevels,
  computeTechnicals,
  evaluateMultiTimeframeStrategy,
  getPriceDecimals,
  getSafeAtr,
  roundPriceFor,
} from '../server/strategyEngine.ts';
import {
  DEFAULT_STRATEGY_CONFIG,
  INSTRUMENTS,
  type CandleBar,
  type MarketQuoteResponse,
  type StrategyConfig,
} from '../src/types/trading.ts';

function buildCandles(
  count: number,
  startPrice: number,
  step: number,
  startTimeSec = 1700000000,
  intervalSec = 300,
  volume = 1200
): CandleBar[] {
  const out: CandleBar[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price + step;
    const high = Math.max(open, close) + Math.abs(step) * 0.4 + startPrice * 0.0005;
    const low = Math.min(open, close) - Math.abs(step) * 0.4 - startPrice * 0.0005;
    out.push({
      time: startTimeSec + i * intervalSec,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }
  return out;
}

const TEST_CONFIG: StrategyConfig = {
  ...DEFAULT_STRATEGY_CONFIG,
  userId: 'test-user',
  minSetupScore: 70,
  minRiskReward: 1.5,
  enableSessionFilter: true,
};

const EURUSD_META = INSTRUMENTS.find((i) => i.id === 'EURUSD')!;
const NIFTY_META = INSTRUMENTS.find((i) => i.id === 'NIFTY50')!;

test('calculateRSI returns 50 on completely flat prices and extremes on pure trends', () => {
  const flat = Array.from({ length: 30 }, () => 100);
  assert.equal(calculateRSI(flat, 14), 50);

  const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(calculateRSI(rising, 14), 100);

  const falling = Array.from({ length: 30 }, (_, i) => 200 - i);
  assert.equal(calculateRSI(falling, 14), 0);
});

test('calculateVWAPSeries resets at UTC session boundaries and handles zero volume cleanly', () => {
  const day1Start = Date.UTC(2025, 0, 10, 23, 50) / 1000;
  const day2Start = Date.UTC(2025, 0, 11, 0, 5) / 1000;
  const candles: CandleBar[] = [
    { time: day1Start, open: 100, high: 100, low: 100, close: 100, volume: 1000 },
    { time: day1Start + 300, open: 102, high: 102, low: 102, close: 102, volume: 0 },
    // New UTC day should reset VWAP anchor to ~200 instead of dragging day 1's 100
    { time: day2Start, open: 200, high: 200, low: 200, close: 200, volume: 500 },
    { time: day2Start + 300, open: 204, high: 204, low: 204, close: 204, volume: 0 },
  ];

  const vwap = calculateVWAPSeries(candles);
  assert.equal(vwap.length, 4);
  assert.equal(vwap[0], 100);
  // Zero volume bar after positive volume preserves prior anchored VWAP rather than fabricating volume=1
  assert.equal(vwap[1], 100);
  // Day 2 resets cleanly to 200
  assert.equal(vwap[2], 200);
  assert.equal(vwap[3], 200);
});

test('computeLevels handles empty candles safely and preserves forex/micro-cap decimals', () => {
  const empty = computeLevels([], 1.0954, 0);
  assert.equal(Number.isFinite(empty.immediateResistance), true);
  assert.equal(Number.isFinite(empty.immediateSupport), true);
  assert.equal(Number.isFinite(empty.strongResistance), true);
  assert.equal(Number.isFinite(empty.strongSupport), true);
  assert.ok(empty.immediateResistance > 1.0954);
  assert.ok(empty.immediateSupport < 1.0954);

  assert.equal(getPriceDecimals(1.0954), 4);
  assert.equal(getPriceDecimals(0.004215), 6);
  assert.equal(getPriceDecimals(25349.65), 2);
  assert.equal(roundPriceFor(1.0954321, 1.0954), 1.0954);
  assert.equal(roundPriceFor(0.0042154, 0.004215), 0.004215);

  // Zero ATR fallback never returns 0 for positive price
  const safeAtr = getSafeAtr(0, 1.0954);
  assert.ok(safeAtr > 0 && Number.isFinite(safeAtr));

  const fxCandles = buildCandles(40, 1.091, 0.0002, 1700000000, 300, 1000);
  const lastPrice = fxCandles[fxCandles.length - 1].close;
  const fxLevels = computeLevels(fxCandles, lastPrice, 0.0008);
  assert.ok(fxLevels.immediateResistance > 1.09);
  // Ensure 4-decimal precision is preserved (not truncated to 1.09)
  assert.notEqual(fxLevels.immediateResistance, Number(fxLevels.immediateResistance.toFixed(2)));
});

test('computeTechnicals enforces minSep EMA separation filter without weaker else-if bypass', () => {
  // Nearly flat candles with tiny drift where EMA9 > EMA20 > EMA50 but separation < minSep
  const flatDrift = buildCandles(80, 1000, 0.005, 1700000000, 300, 500);
  const tech = computeTechnicals(flatDrift, { fast: 9, mid: 20, slow: 50, rsi: 14 });
  assert.equal(tech.trendBias, 'SIDEWAYS');
});

test('evaluateMultiTimeframeStrategy enforces session filter gate outside active liquidity hours', () => {
  const candles15m = buildCandles(80, 24000, 12, 1700000000, 900, 5000);
  const candles5m = buildCandles(80, 24800, 4, 1700000000, 300, 2500);
  const lastPrice = candles5m[candles5m.length - 1].close;
  const nowIso = new Date().toISOString();

  const tTech = computeTechnicals(candles15m);
  const eTech = computeTechnicals(candles5m);

  const trendQuote: MarketQuoteResponse = {
    available: true,
    statusText: 'LIVE',
    instrument: NIFTY_META,
    timeframe: '15m',
    provider: 'TEST',
    fetchedAt: nowIso,
    marketTimestamp: nowIso,
    price: lastPrice,
    candles: candles15m,
    technicals: tTech,
    levels: computeLevels(candles15m, lastPrice, tTech.atr ?? 40),
  };

  const entryQuote: MarketQuoteResponse = {
    available: true,
    statusText: 'LIVE',
    instrument: NIFTY_META,
    timeframe: '5m',
    provider: 'TEST',
    fetchedAt: nowIso,
    marketTimestamp: nowIso,
    price: lastPrice,
    candles: candles5m,
    technicals: eTech,
    levels: computeLevels(candles5m, lastPrice, eTech.atr ?? 20),
  };

  // Sunday 03:00 UTC -> NSE is closed
  const sundayOffHours = new Date(Date.UTC(2025, 0, 12, 3, 0, 0));
  const blocked = evaluateMultiTimeframeStrategy({
    instrument: NIFTY_META,
    trendQuote,
    entryQuote,
    config: { ...TEST_CONFIG, enableSessionFilter: true, minSetupScore: 40, minRiskReward: 1.0 },
    now: sundayOffHours,
  });

  assert.equal(blocked.direction, 'NO_TRADE');
  assert.equal(blocked.status, 'NO_TRADE');
  assert.ok(blocked.checklist.some((c) => c.label === 'Active Session Liquidity Window' && !c.passed));
});

test('evaluateMultiTimeframeStrategy computes real structural R:R and reachable WAIT state', () => {
  const candles15m = buildCandles(80, 1.08, 0.0005, 1700000000, 900, 5000);
  const candles5m = buildCandles(80, 1.105, 0.00025, 1700000000, 300, 3000);
  const spot = candles5m[candles5m.length - 1].close;
  const nowIso = new Date().toISOString();

  const tTech = computeTechnicals(candles15m);
  const eTech = computeTechnicals(candles5m);

  // 1) Tight structural resistance caps reward below 2.0 R:R (must NOT fake 1:2.4)
  const cappedLevels = {
    immediateSupport: Number((spot - 0.002).toFixed(4)),
    strongSupport: Number((spot - 0.0035).toFixed(4)),
    immediateResistance: Number((spot + 0.0014).toFixed(4)),
    strongResistance: Number((spot + 0.0022).toFixed(4)),
    breakoutLevel: Number((spot + 0.0016).toFixed(4)),
    breakdownLevel: Number((spot - 0.0022).toFixed(4)),
    noTradeZoneLow: Number((spot - 0.0003).toFixed(4)),
    noTradeZoneHigh: Number((spot + 0.0003).toFixed(4)),
  };

  const baseEntryQuote: MarketQuoteResponse = {
    available: true,
    statusText: 'LIVE',
    instrument: EURUSD_META,
    timeframe: '5m',
    provider: 'TEST',
    fetchedAt: nowIso,
    marketTimestamp: nowIso,
    price: spot,
    candles: candles5m,
    technicals: {
      ...eTech,
      trendBias: 'BULLISH',
      rsi: 58,
      adx: 30,
      volumeRatio: 1.6,
      vwap: spot - 0.001,
      atr: 0.001,
    },
    levels: cappedLevels,
  };

  const baseTrendQuote: MarketQuoteResponse = {
    available: true,
    statusText: 'LIVE',
    instrument: EURUSD_META,
    timeframe: '15m',
    provider: 'TEST',
    fetchedAt: nowIso,
    marketTimestamp: nowIso,
    price: spot,
    candles: candles15m,
    technicals: { ...tTech, trendBias: 'BULLISH' },
    levels: cappedLevels,
  };

  // Wednesday 14:00 UTC -> London/NY overlap active
  const londonNyOverlap = new Date(Date.UTC(2025, 0, 15, 14, 0, 0));

  const poorRR = evaluateMultiTimeframeStrategy({
    instrument: EURUSD_META,
    trendQuote: baseTrendQuote,
    entryQuote: baseEntryQuote,
    config: { ...TEST_CONFIG, minSetupScore: 55, minRiskReward: 2.0 },
    now: londonNyOverlap,
  });
  assert.notEqual(poorRR.riskReward, '1:2.4');
  assert.equal(poorRR.direction, 'NO_TRADE');

  // 2) Wide structural room with breakoutLevel within (0.35*ATR, 1.25*ATR] above spot -> status reaches WAIT
  const openRoomLevels = {
    immediateSupport: Number((spot - 0.0008).toFixed(4)),
    strongSupport: Number((spot - 0.0015).toFixed(4)),
    immediateResistance: Number((spot + 0.0065).toFixed(4)),
    strongResistance: Number((spot + 0.011).toFixed(4)),
    breakoutLevel: Number((spot + 0.0008).toFixed(4)),
    breakdownLevel: Number((spot - 0.001).toFixed(4)),
    noTradeZoneLow: Number((spot - 0.0006).toFixed(4)),
    noTradeZoneHigh: Number((spot - 0.0003).toFixed(4)),
  };

  const waitingSetup = evaluateMultiTimeframeStrategy({
    instrument: EURUSD_META,
    trendQuote: { ...baseTrendQuote, levels: openRoomLevels },
    entryQuote: {
      ...baseEntryQuote,
      technicals: { ...baseEntryQuote.technicals!, bollingerSqueeze: false },
      levels: openRoomLevels,
    },
    config: { ...TEST_CONFIG, minSetupScore: 55, minRiskReward: 1.5 },
    now: londonNyOverlap,
  });

  assert.equal(waitingSetup.direction, 'BUY');
  assert.equal(waitingSetup.status, 'WAIT');
  assert.ok(waitingSetup.entryPrice > spot);

  // Verify TP1 & TP2 sit near execution point while TP3 stretches long along structural resistance
  const risk = Math.abs(waitingSetup.entryPrice - waitingSetup.stopLoss);
  const tp1R = (waitingSetup.target1 - waitingSetup.entryPrice) / risk;
  const tp2R = (waitingSetup.target2 - waitingSetup.entryPrice) / risk;
  const tp3R = ((waitingSetup.target3 ?? 0) - waitingSetup.entryPrice) / risk;
  assert.ok(tp1R <= 0.85, `Expected TP1 near entry (<=0.85R), got ${tp1R.toFixed(2)}R`);
  assert.ok(tp2R <= 1.5, `Expected TP2 near entry (<=1.5R), got ${tp2R.toFixed(2)}R`);
  assert.ok(tp3R >= 3.5, `Expected TP3 long structural runner (>=3.5R), got ${tp3R.toFixed(2)}R`);
});
