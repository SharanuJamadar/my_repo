import {
  type CandleBar,
  type PineBacktestResult,
  type PineBacktestTrade,
  type PineBotEvaluationResult,
  type PineOverlaySeries,
  type PineParsedSummary,
  type Timeframe,
} from '../src/types/trading.ts';
import { fetchLiveMarketQuote, getInstrumentById } from './marketData.ts';

interface SeriesMap {
  [name: string]: number[];
}

function calcEmaArr(values: number[], period: number): number[] {
  const n = Math.max(1, Math.round(period));
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length === 0) return out;
  const k = 2 / (n + 1);
  let ema = values[0];
  out[0] = ema;
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function calcSmaArr(values: number[], period: number): number[] {
  const n = Math.max(1, Math.round(period));
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function calcRsiArr(values: number[], period: number): number[] {
  const n = Math.max(2, Math.round(period));
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length <= n) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= n; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / n;
  let avgLoss = losses / n;
  out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = n + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (n - 1) + gain) / n;
    avgLoss = (avgLoss * (n - 1) + loss) / n;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function calcVwapArr(candles: CandleBar[]): number[] {
  let cumPv = 0;
  let cumVol = 0;
  return candles.map((c) => {
    const typ = (c.high + c.low + c.close) / 3;
    const v = c.volume > 0 ? c.volume : 1;
    cumPv += typ * v;
    cumVol += v;
    return cumPv / cumVol;
  });
}

function calcAtrArr(candles: CandleBar[], period: number): number[] {
  const n = Math.max(2, Math.round(period));
  const trs: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
  });
  return calcSmaArr(trs, n);
}

function calcHighestArr(values: number[], period: number): number[] {
  const n = Math.max(1, Math.round(period));
  return values.map((_, i) => {
    const start = Math.max(0, i - n + 1);
    let m = -Infinity;
    for (let j = start; j <= i; j++) m = Math.max(m, values[j]);
    return m;
  });
}

function calcLowestArr(values: number[], period: number): number[] {
  const n = Math.max(1, Math.round(period));
  return values.map((_, i) => {
    const start = Math.max(0, i - n + 1);
    let m = Infinity;
    for (let j = start; j <= i; j++) m = Math.min(m, values[j]);
    return m;
  });
}

function calcMacdTuple(
  closes: number[],
  fastLen: number,
  slowLen: number,
  signalLen: number
): { macd: number[]; signal: number[]; hist: number[] } {
  const fast = calcEmaArr(closes, fastLen);
  const slow = calcEmaArr(closes, slowLen);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = calcEmaArr(macd, signalLen);
  const hist = macd.map((m, i) => m - signal[i]);
  return { macd, signal, hist };
}

function stripPineComments(code: string): string[] {
  return code
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
}

interface ParsedPineContext {
  summary: PineParsedSummary;
  series: SeriesMap;
  overlays: { label: string; color: string; seriesKey: string }[];
  longExpr: string | null;
  shortExpr: string | null;
}

const OVERLAY_PALETTE = ['#F59E0B', '#38BDF8', '#A855F7', '#E2E8F0', '#22D3EE', '#FB7185'];

function splitTopLevelArgs(argStr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < argStr.length; i++) {
    const ch = argStr[i];
    if (quote) {
      current += ch;
      if (ch === quote && argStr[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function evalNumericToken(
  rawExpr: string,
  barIdx: number,
  series: SeriesMap,
  scalars: Map<string, number>
): number {
  const expr = rawExpr.trim();
  if (!expr) return NaN;

  // Literal number
  if (/^-?\d+(\.\d+)?$/.test(expr)) {
    return Number(expr);
  }

  // Named scalar constant
  if (scalars.has(expr)) {
    return scalars.get(expr)!;
  }

  // Parentheses strip
  if (expr.startsWith('(') && expr.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') {
        depth--;
        if (depth === 0 && i < expr.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (wrapsAll) {
      return evalNumericToken(expr.slice(1, -1), barIdx, series, scalars);
    }
  }

  // Inline arithmetic + - * / at top level
  for (const ops of [
    ['+', '-'],
    ['*', '/'],
  ]) {
    let depth = 0;
    for (let i = expr.length - 1; i >= 1; i--) {
      const ch = expr[i];
      if (ch === ')' || ch === ']') depth++;
      else if (ch === '(' || ch === '[') depth--;
      else if (depth === 0 && ops.includes(ch)) {
        const left = evalNumericToken(expr.slice(0, i), barIdx, series, scalars);
        const right = evalNumericToken(expr.slice(i + 1), barIdx, series, scalars);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return NaN;
        if (ch === '+') return left + right;
        if (ch === '-') return left - right;
        if (ch === '*') return left * right;
        if (ch === '/') return right !== 0 ? left / right : NaN;
      }
    }
  }

  // Lookback syntax e.g. close[1] or ema9[2]
  const offsetMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/);
  if (offsetMatch) {
    const key = offsetMatch[1];
    const back = Number(offsetMatch[2]);
    const targetIdx = barIdx - back;
    if (targetIdx < 0) return NaN;
    if (series[key]) return series[key][targetIdx];
    return NaN;
  }

  // Plain series name
  if (series[expr]) {
    return series[expr][barIdx] ?? NaN;
  }

  // Built-in function call directly inside condition e.g. ta.ema(close, 9)
  const fnMatch = expr.match(/^(?:ta\.)?(ema|sma|rsi|atr|highest|lowest)\((.+)\)$/);
  if (fnMatch) {
    const fn = fnMatch[1];
    const args = splitTopLevelArgs(fnMatch[2]);
    const period = args.length >= 2 ? Number(scalars.get(args[1]) ?? args[1]) : Number(scalars.get(args[0]) ?? args[0]);
    const cacheKey = `__inline_${fn}_${args[0]}_${period}`;
    if (series[cacheKey]) {
      return series[cacheKey][barIdx] ?? NaN;
    }
  }

  if (expr === 'ta.vwap' || expr === 'vwap') {
    return series.vwap?.[barIdx] ?? NaN;
  }

  return NaN;
}

function splitBinaryTopLevel(expr: string, token: string): [string, string] | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i <= expr.length - token.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && expr.slice(i, i + token.length) === token) {
      return [expr.slice(0, i).trim(), expr.slice(i + token.length).trim()];
    }
  }
  return null;
}

function evalBooleanExpr(
  rawExpr: string,
  barIdx: number,
  series: SeriesMap,
  scalars: Map<string, number>,
  boolVars: Map<string, string>
): boolean {
  let expr = rawExpr.trim();
  if (!expr) return false;

  if (expr === 'true') return true;
  if (expr === 'false') return false;

  // Strip wrapping parentheses if balanced around entire expression
  while (expr.startsWith('(') && expr.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') {
        depth--;
        if (depth === 0 && i < expr.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (wrapsAll) expr = expr.slice(1, -1).trim();
    else break;
  }

  // Boolean variable expansion
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expr) && boolVars.has(expr)) {
    return evalBooleanExpr(boolVars.get(expr)!, barIdx, series, scalars, boolVars);
  }

  // Logical OR
  const orSplit = splitBinaryTopLevel(expr, ' or ');
  if (orSplit) {
    return (
      evalBooleanExpr(orSplit[0], barIdx, series, scalars, boolVars) ||
      evalBooleanExpr(orSplit[1], barIdx, series, scalars, boolVars)
    );
  }

  // Logical AND
  const andSplit = splitBinaryTopLevel(expr, ' and ');
  if (andSplit) {
    return (
      evalBooleanExpr(andSplit[0], barIdx, series, scalars, boolVars) &&
      evalBooleanExpr(andSplit[1], barIdx, series, scalars, boolVars)
    );
  }

  // Logical NOT
  if (expr.startsWith('not ')) {
    return !evalBooleanExpr(expr.slice(4), barIdx, series, scalars, boolVars);
  }

  // ta.crossover(a, b) & ta.crossunder(a, b)
  const crossMatch = expr.match(/^(?:ta\.)?(crossover|crossunder)\((.+)\)$/);
  if (crossMatch) {
    if (barIdx < 1) return false;
    const args = splitTopLevelArgs(crossMatch[2]);
    if (args.length < 2) return false;
    const aNow = evalNumericToken(args[0], barIdx, series, scalars);
    const bNow = evalNumericToken(args[1], barIdx, series, scalars);
    const aPrev = evalNumericToken(args[0], barIdx - 1, series, scalars);
    const bPrev = evalNumericToken(args[1], barIdx - 1, series, scalars);
    if (
      !Number.isFinite(aNow) ||
      !Number.isFinite(bNow) ||
      !Number.isFinite(aPrev) ||
      !Number.isFinite(bPrev)
    ) {
      return false;
    }
    if (crossMatch[1] === 'crossover') {
      return aPrev <= bPrev && aNow > bNow;
    }
    return aPrev >= bPrev && aNow < bNow;
  }

  // Comparison operators
  for (const op of ['>=', '<=', '==', '!=', '>', '<'] as const) {
    const cmpSplit = splitBinaryTopLevel(expr, op);
    if (cmpSplit) {
      const l = evalNumericToken(cmpSplit[0], barIdx, series, scalars);
      const r = evalNumericToken(cmpSplit[1], barIdx, series, scalars);
      if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
      switch (op) {
        case '>=':
          return l >= r;
        case '<=':
          return l <= r;
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '>':
          return l > r;
        case '<':
          return l < r;
      }
    }
  }

  return false;
}

function buildPineExecutionContext(
  pineCode: string,
  candles: CandleBar[]
): {
  ctx: ParsedPineContext;
  scalars: Map<string, number>;
  boolVars: Map<string, string>;
} {
  const lines = stripPineComments(pineCode);
  const closes = candles.map((c) => c.close);
  const opens = candles.map((c) => c.open);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const vwapArr = calcVwapArr(candles);

  const series: SeriesMap = {
    close: closes,
    open: opens,
    high: highs,
    low: lows,
    volume: volumes,
    vwap: vwapArr,
    'ta.vwap': vwapArr,
    hl2: candles.map((c) => (c.high + c.low) / 2),
    hlc3: candles.map((c) => (c.high + c.low + c.close) / 3),
    ohlc4: candles.map((c) => (c.open + c.high + c.low + c.close) / 4),
  };

  const scalars = new Map<string, number>();
  const boolVars = new Map<string, string>();
  const overlays: { label: string; color: string; seriesKey: string }[] = [];
  const indicatorsDetected: string[] = [];
  const unsupportedConstructs: string[] = [];

  let pineVersion = 'v5';
  let scriptTitle = 'Custom Pine Strategy';
  let longExpr: string | null = null;
  let shortExpr: string | null = null;

  // Check raw version comment first
  const verMatch = pineCode.match(/\/\/@version=(\d+)/);
  if (verMatch) pineVersion = `v${verMatch[1]}`;

  const resolveSrc = (arg?: string): number[] => {
    const clean = (arg || 'close').trim();
    return series[clean] || closes;
  };

  const resolveNum = (arg: string | undefined, fallback: number): number => {
    if (!arg) return fallback;
    const clean = arg.trim();
    if (scalars.has(clean)) return scalars.get(clean)!;
    const num = Number(clean);
    return Number.isFinite(num) ? num : fallback;
  };

  const registerInlineCalls = (expr: string) => {
    const regex = /(?:ta\.)?(ema|sma|rsi|atr|highest|lowest)\(([^()]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(expr)) !== null) {
      const fn = m[1];
      const args = splitTopLevelArgs(m[2]);
      const src = args.length >= 2 ? resolveSrc(args[0]) : closes;
      const period = args.length >= 2 ? resolveNum(args[1], 14) : resolveNum(args[0], 14);
      const cacheKey = `__inline_${fn}_${args[0]}_${period}`;
      if (!series[cacheKey]) {
        if (fn === 'ema') series[cacheKey] = calcEmaArr(src, period);
        else if (fn === 'sma') series[cacheKey] = calcSmaArr(src, period);
        else if (fn === 'rsi') series[cacheKey] = calcRsiArr(src, period);
        else if (fn === 'atr') series[cacheKey] = calcAtrArr(candles, period);
        else if (fn === 'highest') series[cacheKey] = calcHighestArr(highs, period);
        else if (fn === 'lowest') series[cacheKey] = calcLowestArr(lows, period);
        indicatorsDetected.push(`${fn.toUpperCase()}(${period})`);
      }
    }
  };

  let colorIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // strategy("Title", ...) or indicator("Title", ...)
    const headerMatch = line.match(/^(?:strategy|indicator|study)\(\s*["']([^"']+)["']/);
    if (headerMatch) {
      scriptTitle = headerMatch[1];
      continue;
    }

    // Tuple assignment e.g. [macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)
    const tupleMatch = line.match(/^\[([^\]]+)\]\s*=\s*(.+)$/);
    if (tupleMatch) {
      const names = tupleMatch[1].split(',').map((s) => s.trim());
      const rhs = tupleMatch[2].trim();
      const macdCall = rhs.match(/^(?:ta\.)?macd\((.+)\)$/);
      if (macdCall) {
        const args = splitTopLevelArgs(macdCall[1]);
        const src = resolveSrc(args[0]);
        const fastLen = resolveNum(args[1], 12);
        const slowLen = resolveNum(args[2], 26);
        const sigLen = resolveNum(args[3], 9);
        const { macd, signal, hist } = calcMacdTuple(src, fastLen, slowLen, sigLen);
        if (names[0] && names[0] !== '_') series[names[0]] = macd;
        if (names[1] && names[1] !== '_') series[names[1]] = signal;
        if (names[2] && names[2] !== '_') series[names[2]] = hist;
        indicatorsDetected.push(`MACD(${fastLen},${slowLen},${sigLen})`);
      } else {
        unsupportedConstructs.push(`Tuple assignment skipped: ${line.slice(0, 60)}`);
      }
      continue;
    }

    // Assignment varName = rhs
    const assignMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (assignMatch) {
      const varName = assignMatch[1];
      const rhs = assignMatch[2].trim();

      // input.int(9, ...) / input.float(55, ...) / input(9, ...)
      const inputMatch = rhs.match(/^input(?:\.(?:int|float))?\(([^,)]+)/);
      if (inputMatch) {
        const val = Number(inputMatch[1].trim());
        if (Number.isFinite(val)) scalars.set(varName, val);
        continue;
      }

      // Numeric literal
      if (/^-?\d+(\.\d+)?$/.test(rhs)) {
        scalars.set(varName, Number(rhs));
        continue;
      }

      // Built-in indicator assignment
      const fnMatch = rhs.match(/^(?:ta\.)?(ema|sma|rsi|atr|highest|lowest)\((.+)\)$/);
      if (fnMatch) {
        const fn = fnMatch[1];
        const args = splitTopLevelArgs(fnMatch[2]);
        const src = args.length >= 2 ? resolveSrc(args[0]) : closes;
        const period = args.length >= 2 ? resolveNum(args[1], 14) : resolveNum(args[0], 14);
        if (fn === 'ema') {
          series[varName] = calcEmaArr(src, period);
          overlays.push({
            label: `${varName.toUpperCase()} (${period})`,
            color: OVERLAY_PALETTE[colorIdx++ % OVERLAY_PALETTE.length],
            seriesKey: varName,
          });
          indicatorsDetected.push(`EMA(${period})`);
        } else if (fn === 'sma') {
          series[varName] = calcSmaArr(src, period);
          overlays.push({
            label: `${varName.toUpperCase()} (${period})`,
            color: OVERLAY_PALETTE[colorIdx++ % OVERLAY_PALETTE.length],
            seriesKey: varName,
          });
          indicatorsDetected.push(`SMA(${period})`);
        } else if (fn === 'rsi') {
          series[varName] = calcRsiArr(src, period);
          indicatorsDetected.push(`RSI(${period})`);
        } else if (fn === 'atr') {
          series[varName] = calcAtrArr(candles, period);
          indicatorsDetected.push(`ATR(${period})`);
        } else if (fn === 'highest') {
          series[varName] = calcHighestArr(highs, period);
          indicatorsDetected.push(`Highest(${period})`);
        } else if (fn === 'lowest') {
          series[varName] = calcLowestArr(lows, period);
          indicatorsDetected.push(`Lowest(${period})`);
        }
        continue;
      }

      if (rhs === 'ta.vwap' || rhs === 'vwap') {
        series[varName] = vwapArr;
        overlays.push({ label: 'VWAP', color: '#E2E8F0', seriesKey: varName });
        indicatorsDetected.push('VWAP');
        continue;
      }

      // Otherwise treat as boolean condition expression
      registerInlineCalls(rhs);
      boolVars.set(varName, rhs);
      const lowerName = varName.toLowerCase();
      if (!longExpr && (lowerName.includes('long') || lowerName.includes('buy'))) {
        longExpr = varName;
      } else if (!shortExpr && (lowerName.includes('short') || lowerName.includes('sell'))) {
        shortExpr = varName;
      }
      continue;
    }

    // Inline `if (cond)` followed by `strategy.entry(...)` on same line or next line
    const inlineIfMatch = line.match(/^if\s*\(?(.+?)\)?\s*(strategy\.entry\(.+\))?$/);
    if (inlineIfMatch) {
      const cond = inlineIfMatch[1].replace(/\)$/, '').trim();
      const sameLineCall = inlineIfMatch[2];
      const nextLine = lines[i + 1] || '';
      const entryLine = sameLineCall || (nextLine.startsWith('strategy.entry') ? nextLine : '');
      if (entryLine) {
        registerInlineCalls(cond);
        if (entryLine.includes('strategy.long')) {
          longExpr = cond;
        } else if (entryLine.includes('strategy.short')) {
          shortExpr = cond;
        }
        if (!sameLineCall) i++;
        continue;
      }
    }

    // `strategy.entry("Long", strategy.long, when = cond)`
    const whenMatch = line.match(/strategy\.entry\([^)]*strategy\.(long|short)[^)]*when\s*=\s*([^,)]+)/);
    if (whenMatch) {
      registerInlineCalls(whenMatch[2]);
      if (whenMatch[1] === 'long') longExpr = whenMatch[2].trim();
      else shortExpr = whenMatch[2].trim();
      continue;
    }

    if (line.includes('ta.vwap') || line.includes('vwap')) {
      if (!indicatorsDetected.includes('VWAP')) {
        indicatorsDetected.push('VWAP');
        overlays.push({ label: 'VWAP', color: '#E2E8F0', seriesKey: 'vwap' });
      }
    }

    if (line.includes('array.') || line.includes('matrix.') || line.includes('request.security')) {
      unsupportedConstructs.push(`Pine multi-timeframe/array call not executed verbatim: ${line.slice(0, 60)}`);
    }
  }

  // Fallback overlays from SHARAN core if user pasted an EMA-based strategy without explicit variable overlays
  if (overlays.length === 0) {
    series.ema9 = calcEmaArr(closes, 9);
    series.ema20 = calcEmaArr(closes, 20);
    overlays.push(
      { label: 'EMA 9', color: '#F59E0B', seriesKey: 'ema9' },
      { label: 'EMA 20', color: '#38BDF8', seriesKey: 'ema20' }
    );
  }

  // Register standard aliases if referenced implicitly in rules without variable declarations
  if (!series.ema9) series.ema9 = calcEmaArr(closes, 9);
  if (!series.ema20) series.ema20 = calcEmaArr(closes, 20);
  if (!series.ema50) series.ema50 = calcEmaArr(closes, 50);
  if (!series.rsi14) series.rsi14 = calcRsiArr(closes, 14);

  return {
    ctx: {
      summary: {
        scriptTitle,
        pineVersion,
        indicatorsDetected: Array.from(new Set(indicatorsDetected)),
        buyRuleSummary: longExpr ? `strategy.long when: ${boolVars.get(longExpr) || longExpr}` : 'No BUY/long entry expression detected',
        sellRuleSummary: shortExpr ? `strategy.short when: ${boolVars.get(shortExpr) || shortExpr}` : 'No SELL/short entry expression detected',
        unsupportedConstructs: Array.from(new Set(unsupportedConstructs)),
      },
      series,
      overlays,
      longExpr,
      shortExpr,
    },
    scalars,
    boolVars,
  };
}

export async function runPineBacktest(params: {
  strategyName?: string;
  instrumentId: string;
  timeframe: Timeframe;
  pineCode: string;
  quantity: number;
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
}): Promise<PineBacktestResult> {
  const instrument = getInstrumentById(params.instrumentId);
  const quote = await fetchLiveMarketQuote(instrument.id, params.timeframe);

  if (!quote.available || quote.candles.length < 25) {
    return {
      available: false,
      error: `Live market candles unavailable for ${instrument.symbol} (${params.timeframe}). Cannot run backtest without verified historical data.`,
      strategyName: params.strategyName || 'Custom Pine Strategy',
      instrument,
      timeframe: params.timeframe,
      provider: quote.provider,
      marketTimestamp: quote.marketTimestamp,
      candlesCount: 0,
      parsed: {
        scriptTitle: params.strategyName || 'Custom Pine Strategy',
        pineVersion: 'v5',
        indicatorsDetected: [],
        buyRuleSummary: 'Unavailable',
        sellRuleSummary: 'Unavailable',
        unsupportedConstructs: [],
      },
      candles: [],
      overlays: [],
      trades: [],
      equityCurve: [],
      metrics: {
        initialCapital: params.initialCapital,
        finalEquity: params.initialCapital,
        netProfit: 0,
        netProfitPct: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRatePct: 0,
        profitFactor: 0,
        maxDrawdownPct: 0,
        avgWin: 0,
        avgLoss: 0,
      },
    };
  }

  const candles = quote.candles;
  const { ctx, scalars, boolVars } = buildPineExecutionContext(params.pineCode, candles);
  const qty = Math.max(0.01, Number(params.quantity) || 1);
  const initialCap = Math.max(100, Number(params.initialCapital) || 100_000);
  const slPct = Math.max(0.05, Number(params.stopLossPct) || 0.6);
  const tpPct = Math.max(0.05, Number(params.takeProfitPct) || 1.2);

  let equity = initialCap;
  let peakEquity = initialCap;
  let maxDrawdownPct = 0;

  let openPos: {
    side: 'BUY' | 'SELL';
    entryTime: number;
    entryPrice: number;
    sl: number;
    tp: number;
  } | null = null;

  const trades: PineBacktestTrade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];

  const warmup = Math.min(20, Math.floor(candles.length * 0.2));

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];

    if (i >= warmup) {
      const longSig = ctx.longExpr
        ? evalBooleanExpr(ctx.longExpr, i, ctx.series, scalars, boolVars)
        : false;
      const shortSig = ctx.shortExpr
        ? evalBooleanExpr(ctx.shortExpr, i, ctx.series, scalars, boolVars)
        : false;

      // 1. Check stop-loss / take-profit / reversal on open position
      if (openPos) {
        let exitPrice: number | null = null;
        let exitReason: PineBacktestTrade['exitReason'] | null = null;

        if (openPos.side === 'BUY') {
          if (bar.low <= openPos.sl) {
            exitPrice = openPos.sl;
            exitReason = 'STOP_LOSS';
          } else if (bar.high >= openPos.tp) {
            exitPrice = openPos.tp;
            exitReason = 'TAKE_PROFIT';
          } else if (shortSig && !longSig) {
            exitPrice = bar.close;
            exitReason = 'SIGNAL_REVERSE';
          }
        } else {
          if (bar.high >= openPos.sl) {
            exitPrice = openPos.sl;
            exitReason = 'STOP_LOSS';
          } else if (bar.low <= openPos.tp) {
            exitPrice = openPos.tp;
            exitReason = 'TAKE_PROFIT';
          } else if (longSig && !shortSig) {
            exitPrice = bar.close;
            exitReason = 'SIGNAL_REVERSE';
          }
        }

        if (exitPrice !== null && exitReason) {
          const diff =
            openPos.side === 'BUY'
              ? exitPrice - openPos.entryPrice
              : openPos.entryPrice - exitPrice;
          const pnl = Number((diff * qty).toFixed(2));
          const returnPct = Number(((diff / Math.max(openPos.entryPrice, 1e-6)) * 100).toFixed(2));
          equity = Number((equity + pnl).toFixed(2));

          trades.push({
            id: `bt-${trades.length + 1}`,
            side: openPos.side,
            entryTime: openPos.entryTime,
            exitTime: bar.time,
            entryPrice: Number(openPos.entryPrice.toFixed(4)),
            exitPrice: Number(exitPrice.toFixed(4)),
            quantity: qty,
            pnl,
            returnPct,
            exitReason,
            note: `${exitReason.replace('_', ' ')} · Qty ${qty}`,
          });
          openPos = null;
        }
      }

      // 2. Open new position if flat and signal triggers
      if (!openPos) {
        if (longSig && !shortSig) {
          openPos = {
            side: 'BUY',
            entryTime: bar.time,
            entryPrice: bar.close,
            sl: bar.close * (1 - slPct / 100),
            tp: bar.close * (1 + tpPct / 100),
          };
        } else if (shortSig && !longSig) {
          openPos = {
            side: 'SELL',
            entryTime: bar.time,
            entryPrice: bar.close,
            sl: bar.close * (1 + slPct / 100),
            tp: bar.close * (1 - tpPct / 100),
          };
        }
      }
    }

    // Track equity curve & drawdown
    let markEquity = equity;
    if (openPos) {
      const unreal =
        openPos.side === 'BUY'
          ? (bar.close - openPos.entryPrice) * qty
          : (openPos.entryPrice - bar.close) * qty;
      markEquity = equity + unreal;
    }
    peakEquity = Math.max(peakEquity, markEquity);
    if (peakEquity > 0) {
      const dd = ((peakEquity - markEquity) / peakEquity) * 100;
      maxDrawdownPct = Math.max(maxDrawdownPct, dd);
    }
    equityCurve.push({ time: bar.time, equity: Number(markEquity.toFixed(2)) });
  }

  // Close open position cleanly at end of backtest series
  if (openPos) {
    const lastBar = candles[candles.length - 1];
    const diff =
      openPos.side === 'BUY'
        ? lastBar.close - openPos.entryPrice
        : openPos.entryPrice - lastBar.close;
    const pnl = Number((diff * qty).toFixed(2));
    const returnPct = Number(((diff / Math.max(openPos.entryPrice, 1e-6)) * 100).toFixed(2));
    equity = Number((equity + pnl).toFixed(2));
    trades.push({
      id: `bt-${trades.length + 1}`,
      side: openPos.side,
      entryTime: openPos.entryTime,
      exitTime: lastBar.time,
      entryPrice: Number(openPos.entryPrice.toFixed(4)),
      exitPrice: Number(lastBar.close.toFixed(4)),
      quantity: qty,
      pnl,
      returnPct,
      exitReason: 'END_OF_SERIES',
      note: `Marked at latest close · Qty ${qty}`,
    });
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const netProfit = Number((equity - initialCap).toFixed(2));
  const netProfitPct = Number(((netProfit / initialCap) * 100).toFixed(2));

  const overlaySeries: PineOverlaySeries[] = ctx.overlays
    .map((ov) => {
      const arr = ctx.series[ov.seriesKey] || [];
      return {
        label: ov.label,
        color: ov.color,
        points: candles
          .map((c, idx) => ({ time: c.time, value: arr[idx] }))
          .filter((p) => Number.isFinite(p.value)),
      };
    })
    .filter((o) => o.points.length > 0);

  return {
    available: true,
    strategyName: params.strategyName || ctx.summary.scriptTitle,
    instrument,
    timeframe: params.timeframe,
    provider: quote.provider,
    marketTimestamp: quote.marketTimestamp,
    candlesCount: candles.length,
    parsed: ctx.summary,
    candles,
    overlays: overlaySeries,
    trades,
    equityCurve,
    metrics: {
      initialCapital: initialCap,
      finalEquity: equity,
      netProfit,
      netProfitPct,
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRatePct: trades.length > 0 ? Number(((wins.length / trades.length) * 100).toFixed(1)) : 0,
      profitFactor:
        grossLoss > 0
          ? Number((grossWin / grossLoss).toFixed(2))
          : grossWin > 0
            ? 9.99
            : 0,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      avgWin: wins.length > 0 ? Number((grossWin / wins.length).toFixed(2)) : 0,
      avgLoss: losses.length > 0 ? Number((grossLoss / losses.length).toFixed(2)) : 0,
    },
  };
}

export async function evaluatePineStrategyLive(params: {
  strategyId: string;
  strategyName: string;
  instrumentId: string;
  timeframe: Timeframe;
  pineCode: string;
  stopLossPct: number;
  takeProfitPct: number;
}): Promise<PineBotEvaluationResult> {
  const instrument = getInstrumentById(params.instrumentId);
  const quote = await fetchLiveMarketQuote(instrument.id, params.timeframe);
  const nowIso = new Date().toISOString();

  if (!quote.available || quote.candles.length < 20 || !quote.price) {
    return {
      available: false,
      error: `Live market data unavailable for ${instrument.symbol} (${params.timeframe}).`,
      strategyId: params.strategyId,
      strategyName: params.strategyName,
      instrument,
      timeframe: params.timeframe,
      evaluatedAt: nowIso,
      barTime: Math.floor(Date.now() / 1000),
      price: 0,
      action: 'HOLD',
      stopLoss: 0,
      target1: 0,
      target2: 0,
      reason: 'Market feed unavailable.',
      indicatorSnapshot: {},
      parsed: {
        scriptTitle: params.strategyName,
        pineVersion: 'v5',
        indicatorsDetected: [],
        buyRuleSummary: 'Unavailable',
        sellRuleSummary: 'Unavailable',
        unsupportedConstructs: [],
      },
    };
  }

  const candles = quote.candles;
  const lastIdx = candles.length - 1;
  const { ctx, scalars, boolVars } = buildPineExecutionContext(params.pineCode, candles);

  const longNow = ctx.longExpr
    ? evalBooleanExpr(ctx.longExpr, lastIdx, ctx.series, scalars, boolVars)
    : false;
  const shortNow = ctx.shortExpr
    ? evalBooleanExpr(ctx.shortExpr, lastIdx, ctx.series, scalars, boolVars)
    : false;

  const action: 'BUY' | 'SELL' | 'HOLD' =
    longNow && !shortNow ? 'BUY' : shortNow && !longNow ? 'SELL' : 'HOLD';

  const price = quote.price;
  const slPct = Math.max(0.05, Number(params.stopLossPct) || 0.6);
  const tpPct = Math.max(0.05, Number(params.takeProfitPct) || 1.2);

  const stopLoss =
    action === 'BUY'
      ? Number((price * (1 - slPct / 100)).toFixed(4))
      : action === 'SELL'
        ? Number((price * (1 + slPct / 100)).toFixed(4))
        : Number((price * (1 - slPct / 100)).toFixed(4));
  const target1 =
    action === 'BUY'
      ? Number((price * (1 + tpPct / 100)).toFixed(4))
      : Number((price * (1 - tpPct / 100)).toFixed(4));
  const target2 =
    action === 'BUY'
      ? Number((price * (1 + (tpPct * 1.6) / 100)).toFixed(4))
      : Number((price * (1 - (tpPct * 1.6) / 100)).toFixed(4));

  const snapshot: Record<string, number | string> = {
    close: Number(price.toFixed(4)),
    vwap: Number((ctx.series.vwap?.[lastIdx] ?? price).toFixed(4)),
  };
  for (const ov of ctx.overlays) {
    const v = ctx.series[ov.seriesKey]?.[lastIdx];
    if (Number.isFinite(v)) snapshot[ov.label] = Number(v.toFixed(4));
  }
  if (Number.isFinite(ctx.series.rsi14?.[lastIdx])) {
    snapshot.RSI = Number(ctx.series.rsi14[lastIdx].toFixed(2));
  }

  return {
    available: true,
    strategyId: params.strategyId,
    strategyName: params.strategyName || ctx.summary.scriptTitle,
    instrument,
    timeframe: params.timeframe,
    evaluatedAt: nowIso,
    barTime: candles[lastIdx].time,
    price,
    action,
    stopLoss,
    target1,
    target2,
    reason:
      action === 'BUY'
        ? `Pine LONG entry triggered (${ctx.summary.buyRuleSummary})`
        : action === 'SELL'
          ? `Pine SHORT entry triggered (${ctx.summary.sellRuleSummary})`
          : 'No fresh Pine entry condition met on latest candle.',
    indicatorSnapshot: snapshot,
    parsed: ctx.summary,
  };
}
