import type { Timeframe } from '../types/trading';

export interface PineTemplatePreset {
  id: string;
  name: string;
  description: string;
  instrumentId: string;
  timeframe: Timeframe;
  quantity: number;
  initialCapital?: number;
  stopLossPct: number;
  takeProfitPct: number;
  riskPerTradePct: number;
  trailingStop: boolean;
  pineCode: string;
}

export const PINE_STRATEGY_TEMPLATES: PineTemplatePreset[] = [
  {
    id: 'sharan-ema-vwap-rsi',
    name: 'My Trade Pro: Pullback + EMA 50 Slope + VWAP + MACD',
    description:
      'High-win-rate trend continuation pullback strategy: trades EMA 9/20/50 trend alignment with rising EMA 50 slope, VWAP support/resistance, MACD histogram confirmation, and 1:3 R:R profit lock.',
    instrumentId: 'XAUUSD',
    timeframe: '5m',
    quantity: 2,
    stopLossPct: 0.55,
    takeProfitPct: 1.65,
    riskPerTradePct: 2.5,
    trailingStop: true,
    pineCode: `//@version=5
strategy("My Trade Pro: Pullback + EMA50 + VWAP + MACD", overlay=true)

ema9 = ta.ema(close, 9)
ema20 = ta.ema(close, 20)
ema50 = ta.ema(close, 50)
vwapVal = ta.vwap
rsiVal = ta.rsi(close, 14)
[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)

longCondition = ema9 > ema20 and ema20 > ema50 and ta.rising(ema50, 3) and close > vwapVal and low[1] <= ema9 and close > ema9 and close > close[1] and rsiVal >= 50 and rsiVal <= 68 and hist > 0
shortCondition = ema9 < ema20 and ema20 < ema50 and ta.falling(ema50, 3) and close < vwapVal and high[1] >= ema9 and close < ema9 and close < close[1] and rsiVal <= 50 and rsiVal >= 32 and hist < 0

if (longCondition)
    strategy.entry("PRO_LONG", strategy.long)

if (shortCondition)
    strategy.entry("PRO_SHORT", strategy.short)
`,
  },
  {
    id: 'crude-ema9-momentum',
    name: 'Crude & Gold: Supertrend + ADX(14) + EMA 9 Trend',
    description:
      'Filters sideways chop with ADX(14) >= 18 and Supertrend(2.5, 10) trend alignment, riding explosive commodity waves with EMA 9 momentum and trailing stop protection.',
    instrumentId: 'MCX_CRUDEOIL',
    timeframe: '5m',
    quantity: 10,
    stopLossPct: 0.65,
    takeProfitPct: 1.85,
    riskPerTradePct: 2.5,
    trailingStop: true,
    pineCode: `//@version=5
strategy("Crude & Gold Supertrend + ADX(14) + EMA9", overlay=true)

[stVal, stDir] = ta.supertrend(2.5, 10)
adxVal = ta.adx(14)
ema9 = ta.ema(close, 9)
ema20 = ta.ema(close, 20)
rsi14 = ta.rsi(close, 14)

longCondition = stDir > 0 and adxVal >= 18 and close > ema9 and ema9 > ema20 and close > close[1] and rsi14 >= 50 and rsi14 <= 70
shortCondition = stDir < 0 and adxVal >= 18 and close < ema9 and ema9 < ema20 and close < close[1] and rsi14 <= 50 and rsi14 >= 30

if (longCondition)
    strategy.entry("SUPER_LONG", strategy.long)

if (shortCondition)
    strategy.entry("SUPER_SHORT", strategy.short)
`,
  },
  {
    id: 'btc-macd-ema50-breakout',
    name: 'Crypto & Index: 1H Supertrend + EMA 50 Slope + ADX',
    description:
      'Captures major Crypto & US Index directional swings on 1H bars with Supertrend(2.8, 10), ADX >= 22 chop rejection, rising/falling EMA 50 slope, and trailing profit lock.',
    instrumentId: 'BTCUSDT',
    timeframe: '1h',
    quantity: 0.25,
    stopLossPct: 1.2,
    takeProfitPct: 3.2,
    riskPerTradePct: 2.5,
    trailingStop: true,
    pineCode: `//@version=5
strategy("Index & Crypto Supertrend + EMA50 + ADX", overlay=true)

[stVal, stDir] = ta.supertrend(2.8, 10)
ema20 = ta.ema(close, 20)
ema50 = ta.ema(close, 50)
adxVal = ta.adx(14)
rsi14 = ta.rsi(close, 14)

longCondition = stDir > 0 and close > ema50 and ta.rising(ema50, 3) and adxVal >= 22 and close > ema20 and close > close[1] and rsi14 >= 52 and rsi14 <= 68
shortCondition = stDir < 0 and close < ema50 and ta.falling(ema50, 3) and adxVal >= 22 and close < ema20 and close < close[1] and rsi14 <= 48 and rsi14 >= 32

if (longCondition)
    strategy.entry("IDX_LONG", strategy.long)

if (shortCondition)
    strategy.entry("IDX_SHORT", strategy.short)
`,
  },
  {
    id: 'mrx-ema-9-15-30-continuous',
    name: 'MRX - EMA 9/15/30 Continuous Strategy',
    description:
      'Pine Script v5 continuous EMA 9/15 crossover/crossunder strategy filtered by EMA 30 trend (close > ema30 for BUY, close < ema30 for SELL) with pyramiding=0 and automatic directional flips.',
    instrumentId: 'XAUUSD',
    timeframe: '5m',
    quantity: 1,
    initialCapital: 1000,
    stopLossPct: 0.55,
    takeProfitPct: 1.95,
    riskPerTradePct: 2.0,
    trailingStop: true,
    pineCode: `//@version=5
strategy("MRX - EMA 9/15/30 Continuous Strategy", overlay=true, pyramiding=0, process_orders_on_close=true)

// === INPUTS ===
ema9_len  = input.int(9, "EMA 9 Length")
ema15_len = input.int(15, "EMA 15 Length")
ema30_len = input.int(30, "EMA 30 Length")

// === CALCULATIONS ===
ema9  = ta.ema(close, ema9_len)
ema15 = ta.ema(close, ema15_len)
ema30 = ta.ema(close, ema30_len)

// === PLOTS ===
plot(ema9, color=color.lime, linewidth=2, title="EMA 9")
plot(ema15, color=color.orange, linewidth=2, title="EMA 15")
plot(ema30, color=color.red, linewidth=2, title="EMA 30")

// === SIGNAL CONDITIONS ===
buySignal = ta.crossover(ema9, ema15) and close > ema30
sellSignal = ta.crossunder(ema9, ema15) and close < ema30

// === CONTINUOUS TRADING ===
if buySignal
    strategy.entry("BUY", strategy.long)

if sellSignal
    strategy.entry("SELL", strategy.short)

// === SIGNAL ARROWS ===
plotshape(buySignal, title="BUY", location=location.belowbar,
     color=color.green, style=shape.triangleup, size=size.small,
     text="BUY", offset=-1)

plotshape(sellSignal, title="SELL", location=location.abovebar,
     color=color.red, style=shape.triangledown, size=size.small,
     text="SELL", offset=-1)

// === ALERTS ===
alertcondition(buySignal, title="BUY Alert", message="MRX BUY Signal")
alertcondition(sellSignal, title="SELL Alert", message="MRX SELL Signal")
`,
  },
];
