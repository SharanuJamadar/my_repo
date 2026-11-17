import type { Timeframe } from '../types/trading';

export interface PineTemplatePreset {
  id: string;
  name: string;
  description: string;
  instrumentId: string;
  timeframe: Timeframe;
  quantity: number;
  stopLossPct: number;
  takeProfitPct: number;
  pineCode: string;
}

export const PINE_STRATEGY_TEMPLATES: PineTemplatePreset[] = [
  {
    id: 'sharan-ema-vwap-rsi',
    name: 'SHARAN EMA 9/20 Crossover + VWAP + RSI',
    description:
      'Flagship intraday momentum strategy: EMA 9 crosses EMA 20 above/below VWAP with RSI filter.',
    instrumentId: 'XAUUSD',
    timeframe: '5m',
    quantity: 2,
    stopLossPct: 0.45,
    takeProfitPct: 0.9,
    pineCode: `//@version=5
strategy("SHARAN EMA 9/20 + VWAP + RSI", overlay=true)

fastLen = input.int(9, "Fast EMA")
midLen = input.int(20, "Mid EMA")
slowLen = input.int(50, "Slow EMA")
rsiLen = input.int(14, "RSI Length")

emaFast = ta.ema(close, fastLen)
emaMid = ta.ema(close, midLen)
emaSlow = ta.ema(close, slowLen)
vwapVal = ta.vwap
rsiVal = ta.rsi(close, rsiLen)

longCondition = ta.crossover(emaFast, emaMid) and close > vwapVal and rsiVal >= 52
shortCondition = ta.crossunder(emaFast, emaMid) and close < vwapVal and rsiVal <= 48

if (longCondition)
    strategy.entry("SHARAN_LONG", strategy.long)

if (shortCondition)
    strategy.entry("SHARAN_SHORT", strategy.short)
`,
  },
  {
    id: 'crude-ema9-momentum',
    name: 'Crude Oil / Gold EMA 9 Price Breakout',
    description:
      'Prioritizes EMA 9 price crossovers with EMA 20 trend alignment and RSI confirmation.',
    instrumentId: 'MCX_CRUDEOIL',
    timeframe: '5m',
    quantity: 10,
    stopLossPct: 0.65,
    takeProfitPct: 1.3,
    pineCode: `//@version=5
strategy("Crude Oil EMA 9 Momentum Scalp", overlay=true)

ema9 = ta.ema(close, 9)
ema20 = ta.ema(close, 20)
rsi14 = ta.rsi(close, 14)

longCondition = ta.crossover(close, ema9) and ema9 >= ema20 and rsi14 > 53
shortCondition = ta.crossunder(close, ema9) and ema9 <= ema20 and rsi14 < 47

if (longCondition)
    strategy.entry("CRUDE_BUY", strategy.long)

if (shortCondition)
    strategy.entry("CRUDE_SELL", strategy.short)
`,
  },
  {
    id: 'btc-macd-ema50-breakout',
    name: 'Crypto / Index MACD + EMA 50 Trend Bot',
    description:
      'Captures directional swings when MACD crosses signal line in direction of EMA 50 trend.',
    instrumentId: 'BTCUSDT',
    timeframe: '15m',
    quantity: 0.25,
    stopLossPct: 0.8,
    takeProfitPct: 1.8,
    pineCode: `//@version=5
strategy("MACD + EMA 50 Trend Bot", overlay=true)

ema50 = ta.ema(close, 50)
[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)
rsi14 = ta.rsi(close, 14)

longCondition = ta.crossover(macdLine, signalLine) and close > ema50 and rsi14 > 50
shortCondition = ta.crossunder(macdLine, signalLine) and close < ema50 and rsi14 < 50

if (longCondition)
    strategy.entry("MACD_LONG", strategy.long)

if (shortCondition)
    strategy.entry("MACD_SHORT", strategy.short)
`,
  },
];
