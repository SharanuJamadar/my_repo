import {
  type CandleBar,
  type PineBacktestResult,
  type PineBacktestTrade,
  type PineBotEvaluationResult,
  type PineOverlaySeries,
  type PineParsedSummary,
  type Timeframe,
} from '../src/types/trading.ts';
import {
  estimateSegmentSpreadBps,
  fetchLiveMarketQuote,
  getInstrumentById,
} from './marketData.ts';

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

function calcAdxArr(candles: CandleBar[], period: number): number[] {
  const n = Math.max(2, Math.round(period));
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length <= n * 2) return out;

  const tr: number[] = new Array<number>(candles.length).fill(0);
  const plusDm: number[] = new Array<number>(candles.length).fill(0);
  const minusDm: number[] = new Array<number>(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  let smTr = 0;
  let smPlus = 0;
  let smMinus = 0;
  for (let i = 1; i <= n; i++) {
    smTr += tr[i];
    smPlus += plusDm[i];
    smMinus += minusDm[i];
  }

  const dxArr = new Array<number>(candles.length).fill(NaN);
  for (let i = n; i < candles.length; i++) {
    if (i > n) {
      smTr = smTr - smTr / n + tr[i];
      smPlus = smPlus - smPlus / n + plusDm[i];
      smMinus = smMinus - smMinus / n + minusDm[i];
    }
    const pdi = smTr > 0 ? (100 * smPlus) / smTr : 0;
    const mdi = smTr > 0 ? (100 * smMinus) / smTr : 0;
    const denom = pdi + mdi;
    dxArr[i] = denom > 0 ? (100 * Math.abs(pdi - mdi)) / denom : 0;
  }

  let adxSum = 0;
  let count = 0;
  for (let i = n; i < candles.length; i++) {
    if (!Number.isFinite(dxArr[i])) continue;
    if (count < n) {
      adxSum += dxArr[i];
      count++;
      if (count === n) out[i] = adxSum / n;
    } else if (Number.isFinite(out[i - 1])) {
      out[i] = (out[i - 1] * (n - 1) + dxArr[i]) / n;
    }
  }
  return out;
}

function calcSupertrendTuple(
  candles: CandleBar[],
  factor: number,
  atrPeriod: number
): { supertrend: number[]; dir: number[] } {
  const atr = calcAtrArr(candles, atrPeriod);
  const mult = Math.max(0.5, factor || 2.5);
  const supertrend = new Array<number>(candles.length).fill(NaN);
  const dir = new Array<number>(candles.length).fill(1);
  if (candles.length === 0) return { supertrend, dir };

  let finalUpper = candles[0].high;
  let finalLower = candles[0].low;
  let prevDir = 1;

  for (let i = 0; i < candles.length; i++) {
    const a = Number.isFinite(atr[i]) ? atr[i] : candles[i].high - candles[i].low;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + mult * a;
    const basicLower = hl2 - mult * a;

    if (i === 0) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      dir[0] = 1;
      supertrend[0] = finalLower;
      continue;
    }

    const prevClose = candles[i - 1].close;
    finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
    finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

    let nextDir = prevDir;
    if (prevDir === -1 && candles[i].close > finalUpper) {
      nextDir = 1;
    } else if (prevDir === 1 && candles[i].close < finalLower) {
      nextDir = -1;
    }
    prevDir = nextDir;
    dir[i] = nextDir;
    supertrend[i] = nextDir === 1 ? finalLower : finalUpper;
  }

  return { supertrend, dir };
}

function calcBbTuple(
  values: number[],
  period: number,
  mult: number
): { middle: number[]; upper: number[]; lower: number[] } {
  const n = Math.max(2, Math.round(period));
  const m = Math.max(0.2, mult || 2);
  const middle = calcSmaArr(values, n);
  const upper = new Array<number>(values.length).fill(NaN);
  const lower = new Array<number>(values.length).fill(NaN);

  for (let i = n - 1; i < values.length; i++) {
    const mean = middle[i];
    if (!Number.isFinite(mean)) continue;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = values[j] - mean;
      sq += d * d;
    }
    const std = Math.sqrt(sq / n);
    upper[i] = mean + m * std;
    lower[i] = mean - m * std;
  }

  return { middle, upper, lower };
}

function calcRisingArr(values: number[], period: number): number[] {
  const n = Math.max(1, Math.round(period));
  return values.map((_, i) => {
    if (i < n) return 0;
    for (let j = i - n + 1; j <= i; j++) {
      if (!Number.isFinite(values[j]) || !Number.isFinite(values[j - 1]) || values[j] <= values[j - 1]) {
        return 0;
      }
    }
    return 1;
  });
}

function calcFallingArr(values: number[], period: number): number[] {
  const n = Math.max(1, Math.round(period));
  return values.map((_, i) => {
    if (i < n) return 0;
    for (let j = i - n + 1; j <= i; j++) {
      if (!Number.isFinite(values[j]) || !Number.isFinite(values[j - 1]) || values[j] >= values[j - 1]) {
        return 0;
      }
    }
    return 1;
  });
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

interface PineStatement {
  text: string;
  indented: boolean;
}

function parsePineStatements(code: string): PineStatement[] {
  const rawLines = code.split(/\r?\n/);
  const statements: PineStatement[] = [];

  let buffer = '';
  let bufferIndented = false;
  let parenDepth = 0;

  const updateDepth = (s: string, startDepth: number): number => {
    let d = startDepth;
    let quote: string | null = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === quote && s[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '(' || ch === '[') d++;
      else if (ch === ')' || ch === ']') d = Math.max(0, d - 1);
    }
    return d;
  };

  const endsWithContinuation = (s: string): boolean =>
    /(?:\band|\bor|,|\+|-|\*|\/|=|\?|:)$/i.test(s.trim());

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) {
      statements.push({ text: trimmed, indented: bufferIndented });
    }
    buffer = '';
    bufferIndented = false;
    parenDepth = 0;
  };

  for (const raw of rawLines) {
    // Strip // comments outside string literals
    let cleaned = '';
    let quote: string | null = null;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quote) {
        cleaned += ch;
        if (ch === quote && raw[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cleaned += ch;
        continue;
      }
      if (ch === '/' && raw[i + 1] === '/') break;
      cleaned += ch;
    }

    const trimmed = cleaned.trim();
    if (!trimmed) continue;

    const isIndented = /^[ \t]+/.test(cleaned);

    if (buffer) {
      const mustContinue = parenDepth > 0 || endsWithContinuation(buffer);
      if (mustContinue) {
        buffer = `${buffer} ${trimmed}`;
        parenDepth = updateDepth(trimmed, parenDepth);
        if (parenDepth === 0 && !endsWithContinuation(buffer)) {
          flush();
        }
        continue;
      }
      flush();
    }

    buffer = trimmed;
    bufferIndented = isIndented;
    parenDepth = updateDepth(trimmed, 0);
    if (parenDepth === 0 && !endsWithContinuation(buffer)) {
      flush();
    }
  }

  flush();
  return statements;
}

interface PineRuntimeState {
  positionSize: number;
  isConfirmed?: boolean;
}

interface ParsedPineContext {
  summary: PineParsedSummary;
  series: SeriesMap;
  overlays: { label: string; color: string; seriesKey: string }[];
  longExpr: string | null;
  shortExpr: string | null;
  hasExplicitReversal: boolean;
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
  scalars: Map<string, number>,
  runtimeState: PineRuntimeState = { positionSize: 0, isConfirmed: true }
): number {
  const expr = rawExpr.trim();
  if (!expr) return NaN;

  // Built-in strategy state
  if (expr === 'strategy.position_size') {
    return runtimeState.positionSize;
  }

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
      return evalNumericToken(expr.slice(1, -1), barIdx, series, scalars, runtimeState);
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
        const left = evalNumericToken(expr.slice(0, i), barIdx, series, scalars, runtimeState);
        const right = evalNumericToken(expr.slice(i + 1), barIdx, series, scalars, runtimeState);
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
  const fnMatch = expr.match(/^(?:ta\.)?(ema|sma|rsi|atr|adx|highest|lowest)\((.+)\)$/);
  if (fnMatch) {
    const fn = fnMatch[1];
    const args = splitTopLevelArgs(fnMatch[2]);
    const rawPeriod = args.length >= 2 ? args[1] : args[0];
    const period = Number(scalars.get(rawPeriod) ?? rawPeriod);
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

export function evalBooleanExpr(
  rawExpr: string,
  barIdx: number,
  series: SeriesMap,
  scalars: Map<string, number>,
  boolVars: Map<string, string>,
  runtimeState: PineRuntimeState = { positionSize: 0, isConfirmed: true }
): boolean {
  let expr = rawExpr.trim();
  if (!expr) return false;

  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'barstate.isconfirmed' || expr === 'barstate.ishistory') {
    return runtimeState.isConfirmed !== false;
  }
  if (expr === 'barstate.isrealtime') {
    return false;
  }

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
    return evalBooleanExpr(boolVars.get(expr)!, barIdx, series, scalars, boolVars, runtimeState);
  }

  // Logical OR
  const orSplit = splitBinaryTopLevel(expr, ' or ');
  if (orSplit) {
    return (
      evalBooleanExpr(orSplit[0], barIdx, series, scalars, boolVars, runtimeState) ||
      evalBooleanExpr(orSplit[1], barIdx, series, scalars, boolVars, runtimeState)
    );
  }

  // Logical AND
  const andSplit = splitBinaryTopLevel(expr, ' and ');
  if (andSplit) {
    return (
      evalBooleanExpr(andSplit[0], barIdx, series, scalars, boolVars, runtimeState) &&
      evalBooleanExpr(andSplit[1], barIdx, series, scalars, boolVars, runtimeState)
    );
  }

  // Logical NOT
  if (expr.startsWith('not ')) {
    return !evalBooleanExpr(expr.slice(4), barIdx, series, scalars, boolVars, runtimeState);
  }

  // ta.rising(src, len) & ta.falling(src, len)
  const trendMatch = expr.match(/^(?:ta\.)?(rising|falling)\((.+)\)$/);
  if (trendMatch) {
    const args = splitTopLevelArgs(trendMatch[2]);
    if (args.length >= 2) {
      const len = Math.max(1, Math.round(Number(scalars.get(args[1]) ?? args[1]) || 1));
      const cacheKey = `__inline_${trendMatch[1]}_${args[0]}_${len}`;
      if (series[cacheKey]) {
        return series[cacheKey][barIdx] === 1;
      }
      if (series[args[0]]) {
        if (barIdx < len) return false;
        const arr = series[args[0]];
        for (let j = barIdx - len + 1; j <= barIdx; j++) {
          if (!Number.isFinite(arr[j]) || !Number.isFinite(arr[j - 1])) return false;
          if (trendMatch[1] === 'rising' && arr[j] <= arr[j - 1]) return false;
          if (trendMatch[1] === 'falling' && arr[j] >= arr[j - 1]) return false;
        }
        return true;
      }
    }
    return false;
  }

  // ta.crossover(a, b) & ta.crossunder(a, b)
  const crossMatch = expr.match(/^(?:ta\.)?(crossover|crossunder)\((.+)\)$/);
  if (crossMatch) {
    if (barIdx < 1) return false;
    const args = splitTopLevelArgs(crossMatch[2]);
    if (args.length < 2) return false;
    const aNow = evalNumericToken(args[0], barIdx, series, scalars, runtimeState);
    const bNow = evalNumericToken(args[1], barIdx, series, scalars, runtimeState);
    const aPrev = evalNumericToken(args[0], barIdx - 1, series, scalars, runtimeState);
    const bPrev = evalNumericToken(args[1], barIdx - 1, series, scalars, runtimeState);
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
      const l = evalNumericToken(cmpSplit[0], barIdx, series, scalars, runtimeState);
      const r = evalNumericToken(cmpSplit[1], barIdx, series, scalars, runtimeState);
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

const PINE_COLOR_MAP: Record<string, string> = {
  'color.green': '#22C55E',
  'color.lime': '#84CC16',
  'color.orange': '#F97316',
  'color.red': '#EF4444',
  'color.blue': '#38BDF8',
  'color.aqua': '#22D3EE',
  'color.yellow': '#FACC15',
  'color.purple': '#A855F7',
  'color.white': '#E2E8F0',
};

export function buildPineExecutionContext(
  pineCode: string,
  candles: CandleBar[]
): {
  ctx: ParsedPineContext;
  scalars: Map<string, number>;
  boolVars: Map<string, string>;
} {
  const statements = parsePineStatements(pineCode);
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
  let hasExplicitReversal = false;

  const verMatch = pineCode.match(/\/\/@version=(\d+)/);
  if (verMatch) pineVersion = `v${verMatch[1]}`;

  const resolveSrc = (arg?: string, fallback: number[] = closes): number[] => {
    const clean = (arg || '').trim();
    if (!clean) return fallback;
    return series[clean] || fallback;
  };

  const resolveNum = (arg: string | undefined, fallback: number): number => {
    if (!arg) return fallback;
    const clean = arg.trim();
    if (scalars.has(clean)) return scalars.get(clean)!;
    const num = Number(clean);
    return Number.isFinite(num) ? num : fallback;
  };

  const registerInlineCalls = (expr: string) => {
    const regex = /(?:ta\.)?(ema|sma|rsi|atr|adx|highest|lowest|rising|falling)\(([^()]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(expr)) !== null) {
      const fn = m[1];
      const args = splitTopLevelArgs(m[2]);
      const src =
        args.length >= 2
          ? resolveSrc(args[0], fn === 'highest' ? highs : fn === 'lowest' ? lows : closes)
          : fn === 'highest'
            ? highs
            : fn === 'lowest'
              ? lows
              : closes;
      const period = args.length >= 2 ? resolveNum(args[1], 14) : resolveNum(args[0], 14);
      const cacheKey = `__inline_${fn}_${args[0]}_${period}`;
      if (!series[cacheKey]) {
        if (fn === 'ema') series[cacheKey] = calcEmaArr(src, period);
        else if (fn === 'sma') series[cacheKey] = calcSmaArr(src, period);
        else if (fn === 'rsi') series[cacheKey] = calcRsiArr(src, period);
        else if (fn === 'atr') series[cacheKey] = calcAtrArr(candles, period);
        else if (fn === 'adx') series[cacheKey] = calcAdxArr(candles, period);
        else if (fn === 'highest') series[cacheKey] = calcHighestArr(src, period);
        else if (fn === 'lowest') series[cacheKey] = calcLowestArr(src, period);
        else if (fn === 'rising') series[cacheKey] = calcRisingArr(src, period);
        else if (fn === 'falling') series[cacheKey] = calcFallingArr(src, period);
        indicatorsDetected.push(`${fn.toUpperCase()}(${period})`);
      }
    }
  };

  let colorIdx = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const line = stmt.text;

    const headerMatch = line.match(/^(?:strategy|indicator|study)\(\s*["']([^"']+)["']/);
    if (headerMatch) {
      scriptTitle = headerMatch[1];
      if (/pyramiding\s*=\s*0\b/.test(line)) {
        hasExplicitReversal = true;
      }
      continue;
    }

    // Apply explicit plot(...) colors and titles to matching series overlays
    const plotMatch = line.match(/^plot\((.+)\)$/);
    if (plotMatch) {
      const args = splitTopLevelArgs(plotMatch[1]);
      const seriesKey = args[0]?.trim();
      if (seriesKey && series[seriesKey]) {
        const titleArg = args
          .slice(1)
          .find((a) => /^["'][^"']+["']$/.test(a) || /^title\s*=/.test(a));
        const colorArg = args.find((a) => /^color\s*=/.test(a) || a.startsWith('color.'));
        const existing = overlays.find((o) => o.seriesKey === seriesKey);
        const resolvedColor = colorArg
          ? PINE_COLOR_MAP[colorArg.replace(/^color\s*=\s*/, '').trim()]
          : undefined;
        const resolvedLabel = titleArg
          ? titleArg.replace(/^title\s*=\s*/, '').replace(/^["']|["']$/g, '')
          : undefined;
        if (existing) {
          if (resolvedColor) existing.color = resolvedColor;
          if (resolvedLabel) existing.label = resolvedLabel;
        }
      }
      continue;
    }

    if (line.startsWith('plotshape(') || line.startsWith('alertcondition(')) {
      continue;
    }

    // Tuple assignments: ta.macd, ta.supertrend, ta.bb
    const tupleMatch = line.match(/^\[([^\]]+)\]\s*=\s*(.+)$/);
    if (tupleMatch) {
      const names = tupleMatch[1].split(',').map((s) => s.trim());
      const rhs = tupleMatch[2].trim();

      const macdCall = rhs.match(/^(?:ta\.)?macd\((.+)\)$/);
      const stCall = rhs.match(/^(?:ta\.)?supertrend\((.+)\)$/);
      const bbCall = rhs.match(/^(?:ta\.)?bb\((.+)\)$/);

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
      } else if (stCall) {
        const args = splitTopLevelArgs(stCall[1]);
        const factor = resolveNum(args[0], 2.5);
        const atrPeriod = resolveNum(args[1], 10);
        const { supertrend, dir } = calcSupertrendTuple(candles, factor, atrPeriod);
        if (names[0] && names[0] !== '_') {
          series[names[0]] = supertrend;
          overlays.push({
            label: `Supertrend (${factor}, ${atrPeriod})`,
            color: '#22D3EE',
            seriesKey: names[0],
          });
        }
        if (names[1] && names[1] !== '_') {
          series[names[1]] = dir;
        }
        indicatorsDetected.push(`Supertrend(${factor},${atrPeriod})`);
      } else if (bbCall) {
        const args = splitTopLevelArgs(bbCall[1]);
        const src = resolveSrc(args[0]);
        const len = resolveNum(args[1], 20);
        const mult = resolveNum(args[2], 2);
        const { middle, upper, lower } = calcBbTuple(src, len, mult);
        if (names[0] && names[0] !== '_') series[names[0]] = middle;
        if (names[1] && names[1] !== '_') {
          series[names[1]] = upper;
          overlays.push({ label: `BB Upper (${len})`, color: '#A855F7', seriesKey: names[1] });
        }
        if (names[2] && names[2] !== '_') {
          series[names[2]] = lower;
          overlays.push({ label: `BB Lower (${len})`, color: '#A855F7', seriesKey: names[2] });
        }
        indicatorsDetected.push(`BB(${len},${mult})`);
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

      const inputMatch = rhs.match(/^input(?:\.(?:int|float))?\(([^,)]+)/);
      if (inputMatch) {
        const val = Number(inputMatch[1].trim());
        if (Number.isFinite(val)) scalars.set(varName, val);
        continue;
      }

      if (/^-?\d+(\.\d+)?$/.test(rhs)) {
        scalars.set(varName, Number(rhs));
        continue;
      }

      const fnMatch = rhs.match(/^(?:ta\.)?(ema|sma|rsi|atr|adx|highest|lowest)\((.+)\)$/);
      if (fnMatch) {
        const fn = fnMatch[1];
        const args = splitTopLevelArgs(fnMatch[2]);
        const src =
          args.length >= 2
            ? resolveSrc(args[0], fn === 'highest' ? highs : fn === 'lowest' ? lows : closes)
            : fn === 'highest'
              ? highs
              : fn === 'lowest'
                ? lows
                : closes;
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
        } else if (fn === 'adx') {
          series[varName] = calcAdxArr(candles, period);
          indicatorsDetected.push(`ADX(${period})`);
        } else if (fn === 'highest') {
          series[varName] = calcHighestArr(src, period);
          indicatorsDetected.push(`Highest(${period})`);
        } else if (fn === 'lowest') {
          series[varName] = calcLowestArr(src, period);
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

      // Treat as boolean condition expression
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

    const inlineIfMatch = line.match(/^if\s+(.+?)(?:\s+(strategy\.(?:entry|close)\(.+\)))?$/);
    if (inlineIfMatch) {
      const cond = inlineIfMatch[1].trim();
      const sameLineCall = inlineIfMatch[2];
      const bodyLines: string[] = [];
      if (sameLineCall) {
        bodyLines.push(sameLineCall);
      } else {
        let j = i + 1;
        while (j < statements.length && statements[j].indented) {
          bodyLines.push(statements[j].text);
          j++;
        }
        if (bodyLines.length > 0) {
          i = j - 1;
        }
      }

      if (bodyLines.some((b) => b.startsWith('strategy.close('))) {
        hasExplicitReversal = true;
      }

      const entryLine = bodyLines.find((b) => b.startsWith('strategy.entry('));
      if (entryLine) {
        registerInlineCalls(cond);
        if (entryLine.includes('strategy.long')) {
          longExpr = cond;
        } else if (entryLine.includes('strategy.short')) {
          shortExpr = cond;
        }
        continue;
      }
    }

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

  if (overlays.length === 0) {
    series.ema9 = calcEmaArr(closes, 9);
    series.ema20 = calcEmaArr(closes, 20);
    overlays.push(
      { label: 'EMA 9', color: '#F59E0B', seriesKey: 'ema9' },
      { label: 'EMA 20', color: '#38BDF8', seriesKey: 'ema20' }
    );
  }

  if (!series.ema9) series.ema9 = calcEmaArr(closes, 9);
  if (!series.ema20) series.ema20 = calcEmaArr(closes, 20);
  if (!series.ema50) series.ema50 = calcEmaArr(closes, 50);
  if (!series.rsi14) series.rsi14 = calcRsiArr(closes, 14);
  if (!series.adx14) series.adx14 = calcAdxArr(candles, 14);

  return {
    ctx: {
      summary: {
        scriptTitle,
        pineVersion,
        indicatorsDetected: Array.from(new Set(indicatorsDetected)),
        buyRuleSummary: longExpr
          ? `strategy.long when: ${boolVars.get(longExpr) || longExpr}`
          : 'No BUY/long entry expression detected',
        sellRuleSummary: shortExpr
          ? `strategy.short when: ${boolVars.get(shortExpr) || shortExpr}`
          : 'No SELL/short entry expression detected',
        unsupportedConstructs: Array.from(new Set(unsupportedConstructs)),
      },
      series,
      overlays,
      longExpr,
      shortExpr,
      hasExplicitReversal,
    },
    scalars,
    boolVars,
  };
}

function computePositionQuantity(params: {
  equity: number;
  entryPrice: number;
  slDistance: number;
  fixedQuantity: number;
  riskPerTradePct?: number;
}): number {
  const riskPct = Number(params.riskPerTradePct ?? 0);
  if (!Number.isFinite(riskPct) || riskPct <= 0 || params.slDistance <= 0) {
    return Math.max(0.01, params.fixedQuantity);
  }
  const riskCapital = params.equity * (Math.min(riskPct, 10) / 100);
  const rawQty = riskCapital / Math.max(params.slDistance, params.entryPrice * 0.001);
  // Keep effective leverage capped realistically (6x max notional exposure per trade)
  const maxNotionalQty = (params.equity * 6) / Math.max(params.entryPrice, 1e-6);
  const bounded = Math.max(0.01, Math.min(rawQty, maxNotionalQty));
  return bounded >= 10 ? Math.round(bounded) : Number(bounded.toFixed(2));
}

export function computeThreeTpLevels(
  side: 'BUY' | 'SELL',
  entryPrice: number,
  slPct: number,
  tpPct: number
): {
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  slDist: number;
} {
  const slDist = entryPrice * (slPct / 100);
  // Keep TP1 & TP2 near the execution point for fast partial booking & BE/TP1 SL lock,
  // and keep TP3 long according to the strategy's take-profit runner target.
  const tp3Dist = Math.max(slDist * 3.2, entryPrice * (tpPct / 100));
  const tp1Dist = Math.min(slDist * 0.75, tp3Dist * 0.3);
  const tp2Dist = Math.min(slDist * 1.4, tp3Dist * 0.55);

  if (side === 'BUY') {
    return {
      stopLoss: entryPrice - slDist,
      tp1: entryPrice + tp1Dist,
      tp2: entryPrice + tp2Dist,
      tp3: entryPrice + tp3Dist,
      slDist,
    };
  }
  return {
    stopLoss: entryPrice + slDist,
    tp1: Math.max(0, entryPrice - tp1Dist),
    tp2: Math.max(0, entryPrice - tp2Dist),
    tp3: Math.max(0, entryPrice - tp3Dist),
    slDist,
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
  riskPerTradePct?: number;
  trailingStop?: boolean;
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
  const baseQty = Math.max(0.01, Number(params.quantity) || 1);
  const initialCap = Math.max(100, Number(params.initialCapital) || 100_000);
  const slPct = Math.max(0.05, Number(params.stopLossPct) || 0.55);
  const tpPct = Math.max(0.05, Number(params.takeProfitPct) || 1.65);
  const riskPct = params.riskPerTradePct !== undefined ? Number(params.riskPerTradePct) : 2.5;
  const trailingEnabled = params.trailingStop !== false;
  const spreadBpsModeled = quote.spreadBps ?? estimateSegmentSpreadBps(instrument);
  const commissionBpsRoundTrip = 2.0; // Realistic 0.01% per side brokerage/exchange fee
  const totalCostRate = (spreadBpsModeled + commissionBpsRoundTrip) / 10_000;

  let equity = initialCap;
  let peakEquity = initialCap;
  let maxDrawdownPct = 0;
  let totalCosts = 0;

  let openPos: {
    side: 'BUY' | 'SELL';
    entryTime: number;
    entryPrice: number;
    qty: number;
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    tpReached: 0 | 1 | 2;
    slDist: number;
  } | null = null;

  const trades: PineBacktestTrade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];

  const warmup = Math.min(30, Math.floor(candles.length * 0.2));

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];

    if (i >= warmup) {
      const currentPositionSize = openPos
        ? openPos.side === 'BUY'
          ? openPos.qty
          : -openPos.qty
        : 0;
      const runtimeState: PineRuntimeState = {
        positionSize: currentPositionSize,
        isConfirmed: true,
      };
      const longSig = ctx.longExpr
        ? evalBooleanExpr(ctx.longExpr, i, ctx.series, scalars, boolVars, runtimeState)
        : false;
      const shortSig = ctx.shortExpr
        ? evalBooleanExpr(ctx.shortExpr, i, ctx.series, scalars, boolVars, runtimeState)
        : false;

      // 1. Check stop-loss / 3-TP stepped trailing / full TP3 target / reversal on open position
      if (openPos) {
        let exitPrice: number | null = null;
        let exitReason: PineBacktestTrade['exitReason'] | null = null;
        let finalTpReached: 0 | 1 | 2 | 3 = openPos.tpReached;

        if (openPos.side === 'BUY') {
          if (bar.low <= openPos.sl) {
            exitPrice = openPos.sl;
            exitReason =
              openPos.tpReached === 2
                ? 'TRAIL_SL_TP2'
                : openPos.tpReached === 1
                  ? 'TRAIL_SL_TP1'
                  : 'STOP_LOSS';
          } else if (bar.high >= openPos.tp3) {
            exitPrice = openPos.tp3;
            exitReason = 'TP3_TARGET';
            finalTpReached = 3;
            if (trailingEnabled) {
              openPos.sl = Math.max(openPos.sl, openPos.tp2);
            }
          } else if (shortSig && !longSig && (ctx.hasExplicitReversal || openPos.tpReached === 0)) {
            exitPrice = bar.close;
            exitReason = 'SIGNAL_REVERSE';
          }
        } else {
          if (bar.high >= openPos.sl) {
            exitPrice = openPos.sl;
            exitReason =
              openPos.tpReached === 2
                ? 'TRAIL_SL_TP2'
                : openPos.tpReached === 1
                  ? 'TRAIL_SL_TP1'
                  : 'STOP_LOSS';
          } else if (bar.low <= openPos.tp3) {
            exitPrice = openPos.tp3;
            exitReason = 'TP3_TARGET';
            finalTpReached = 3;
            if (trailingEnabled) {
              openPos.sl = Math.min(openPos.sl, openPos.tp2);
            }
          } else if (longSig && !shortSig && (ctx.hasExplicitReversal || openPos.tpReached === 0)) {
            exitPrice = bar.close;
            exitReason = 'SIGNAL_REVERSE';
          }
        }

        if (exitPrice !== null && exitReason) {
          const diff =
            openPos.side === 'BUY'
              ? exitPrice - openPos.entryPrice
              : openPos.entryPrice - exitPrice;
          const grossPnl = diff * openPos.qty;
          const tradeCost = Number(
            (openPos.entryPrice * openPos.qty * totalCostRate).toFixed(2)
          );
          totalCosts += tradeCost;
          const pnl = Number((grossPnl - tradeCost).toFixed(2));
          const returnPct = Number(
            (((grossPnl - tradeCost) / Math.max(openPos.entryPrice * openPos.qty, 1e-6)) * 100).toFixed(2)
          );
          equity = Number((equity + pnl).toFixed(2));

          const reasonNote =
            exitReason === 'TP3_TARGET'
              ? 'TP3 Full Target Hit (3/3 TPs)'
              : exitReason === 'TRAIL_SL_TP2'
                ? 'Trailed SL locked at TP1 after TP2 hit'
                : exitReason === 'TRAIL_SL_TP1'
                  ? 'Trailed SL locked at Breakeven after TP1 hit'
                  : exitReason.replaceAll('_', ' ');

          trades.push({
            id: `bt-${trades.length + 1}`,
            side: openPos.side,
            entryTime: openPos.entryTime,
            exitTime: bar.time,
            entryPrice: Number(openPos.entryPrice.toFixed(4)),
            exitPrice: Number(exitPrice.toFixed(4)),
            quantity: openPos.qty,
            pnl,
            costs: tradeCost,
            returnPct,
            tp1Price: Number(openPos.tp1.toFixed(4)),
            tp2Price: Number(openPos.tp2.toFixed(4)),
            tp3Price: Number(openPos.tp3.toFixed(4)),
            tpReached: finalTpReached,
            trailedStopLoss: Number(openPos.sl.toFixed(4)),
            exitReason,
            note: `${reasonNote} · Qty ${openPos.qty} · Net after spread/fee`,
          });
          openPos = null;
        } else if (trailingEnabled && openPos) {
          // Stepped SL Trailing at every TP range hit (no future bar peeking)
          if (openPos.side === 'BUY') {
            if (bar.high >= openPos.tp2 && openPos.tpReached < 2) {
              openPos.tpReached = 2;
              openPos.sl = Math.max(openPos.sl, openPos.tp1);
            } else if (bar.high >= openPos.tp1 && openPos.tpReached < 1) {
              openPos.tpReached = 1;
              openPos.sl = Math.max(openPos.sl, openPos.entryPrice + 0.05 * openPos.slDist);
            }
          } else {
            if (bar.low <= openPos.tp2 && openPos.tpReached < 2) {
              openPos.tpReached = 2;
              openPos.sl = Math.min(openPos.sl, openPos.tp1);
            } else if (bar.low <= openPos.tp1 && openPos.tpReached < 1) {
              openPos.tpReached = 1;
              openPos.sl = Math.min(openPos.sl, openPos.entryPrice - 0.05 * openPos.slDist);
            }
          }
        }
      }

      // 2. Open new position if flat and signal triggers
      if (!openPos && equity > 0) {
        if (longSig && !shortSig) {
          const levels = computeThreeTpLevels('BUY', bar.close, slPct, tpPct);
          const posQty = computePositionQuantity({
            equity,
            entryPrice: bar.close,
            slDistance: levels.slDist,
            fixedQuantity: baseQty,
            riskPerTradePct: riskPct,
          });
          openPos = {
            side: 'BUY',
            entryTime: bar.time,
            entryPrice: bar.close,
            qty: posQty,
            sl: levels.stopLoss,
            tp1: levels.tp1,
            tp2: levels.tp2,
            tp3: levels.tp3,
            tpReached: 0,
            slDist: levels.slDist,
          };
        } else if (shortSig && !longSig) {
          const levels = computeThreeTpLevels('SELL', bar.close, slPct, tpPct);
          const posQty = computePositionQuantity({
            equity,
            entryPrice: bar.close,
            slDistance: levels.slDist,
            fixedQuantity: baseQty,
            riskPerTradePct: riskPct,
          });
          openPos = {
            side: 'SELL',
            entryTime: bar.time,
            entryPrice: bar.close,
            qty: posQty,
            sl: levels.stopLoss,
            tp1: levels.tp1,
            tp2: levels.tp2,
            tp3: levels.tp3,
            tpReached: 0,
            slDist: levels.slDist,
          };
        }
      }
    }

    // Track equity curve & drawdown
    let markEquity = equity;
    if (openPos) {
      const unreal =
        openPos.side === 'BUY'
          ? (bar.close - openPos.entryPrice) * openPos.qty
          : (openPos.entryPrice - bar.close) * openPos.qty;
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
    const grossPnl = diff * openPos.qty;
    const tradeCost = Number((openPos.entryPrice * openPos.qty * totalCostRate).toFixed(2));
    totalCosts += tradeCost;
    const pnl = Number((grossPnl - tradeCost).toFixed(2));
    const returnPct = Number(
      (((grossPnl - tradeCost) / Math.max(openPos.entryPrice * openPos.qty, 1e-6)) * 100).toFixed(2)
    );
    equity = Number((equity + pnl).toFixed(2));
    trades.push({
      id: `bt-${trades.length + 1}`,
      side: openPos.side,
      entryTime: openPos.entryTime,
      exitTime: lastBar.time,
      entryPrice: Number(openPos.entryPrice.toFixed(4)),
      exitPrice: Number(lastBar.close.toFixed(4)),
      quantity: openPos.qty,
      pnl,
      costs: tradeCost,
      returnPct,
      tp1Price: Number(openPos.tp1.toFixed(4)),
      tp2Price: Number(openPos.tp2.toFixed(4)),
      tp3Price: Number(openPos.tp3.toFixed(4)),
      tpReached: openPos.tpReached,
      trailedStopLoss: Number(openPos.sl.toFixed(4)),
      exitReason: 'END_OF_SERIES',
      note: `Marked at latest close (TP Stage ${openPos.tpReached}/3) · Qty ${openPos.qty}`,
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
      totalCosts: Number(totalCosts.toFixed(2)),
      spreadBpsModeled: Number(spreadBpsModeled.toFixed(2)),
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
      target3: 0,
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
  const slPct = Math.max(0.05, Number(params.stopLossPct) || 0.55);
  const tpPct = Math.max(0.05, Number(params.takeProfitPct) || 1.65);

  const levels = computeThreeTpLevels(
    action === 'SELL' ? 'SELL' : 'BUY',
    price,
    slPct,
    tpPct
  );
  const stopLoss = Number(levels.stopLoss.toFixed(4));
  const target1 = Number(levels.tp1.toFixed(4));
  const target2 = Number(levels.tp2.toFixed(4));
  const target3 = Number(levels.tp3.toFixed(4));

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
  if (Number.isFinite(ctx.series.adx14?.[lastIdx])) {
    snapshot.ADX = Number(ctx.series.adx14[lastIdx].toFixed(2));
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
    target3,
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
