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
    id: 'mr-x-ema-9-15-200-reversal',
    name: 'MR_X EMA 9-15-200 Reversal',
    description:
      'Pine Script v6 EMA 9/15 crossover/crossunder reversal system filtered by EMA 200 macro trend and confirmed bar close, with automatic long/short position reversal.',
    instrumentId: 'XAUUSD',
    timeframe: '5m',
    quantity: 1,
    initialCapital: 1000,
    stopLossPct: 0.55,
    takeProfitPct: 1.65,
    riskPerTradePct: 2.0,
    trailingStop: true,
    pineCode: `//@version=6
strategy("MR_X EMA 9-15-200 Reversal",
     overlay=true,
     initial_capital=1000,
     pyramiding=0,
     process_orders_on_close=true,
     calc_on_order_fills=true)

// EMA CALCULATION
ema9   = ta.ema(close, 9)
ema15  = ta.ema(close, 15)
ema200 = ta.ema(close, 200)

// CROSSOVER
bullCross = ta.crossover(ema9, ema15)
bearCross = ta.crossunder(ema9, ema15)

// BUY CONDITION
buySignal = barstate.isconfirmed and
     close > ema200 and
     close > ema9 and
     close > ema15 and
     bullCross

// SELL CONDITION
sellSignal = barstate.isconfirmed and
     close < ema200 and
     close < ema9 and
     close < ema15 and
     bearCross

// TRADE REVERSAL
if buySignal and strategy.position_size <= 0
    strategy.close("SELL")
    strategy.entry("BUY", strategy.long)

if sellSignal and strategy.position_size >= 0
    strategy.close("BUY")
    strategy.entry("SELL", strategy.short)

// EMA PLOTS
plot(ema9, "EMA 9", color=color.green, linewidth=2)
plot(ema15, "EMA 15", color=color.orange, linewidth=2)
plot(ema200, "EMA 200", color=color.red, linewidth=2)

// ONLY NEW SIGNALS
plotshape(buySignal and strategy.position_size <= 0,
     title="BUY",
     style=shape.labelup,
     location=location.belowbar,
     color=color.green,
     text="BUY",
     textcolor=color.white)

plotshape(sellSignal and strategy.position_size >= 0,
     title="SELL",
     style=shape.labeldown,
     location=location.abovebar,
     color=color.red,
     text="SELL",
     textcolor=color.white)

// ALERTS
alertcondition(buySignal and strategy.position_size <= 0,
     "BUY Alert", "MR_X BUY Reversal")

alertcondition(sellSignal and strategy.position_size >= 0,
     "SELL Alert", "MR_X SELL Reversal")
`,
  },
];
