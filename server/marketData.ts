import {
  INSTRUMENTS,
  type CandleBar,
  type InstrumentMeta,
  type MarketQuoteResponse,
  type Timeframe,
} from '../src/types/trading.ts';
import { computeLevels, computeTechnicals } from './strategyEngine.ts';

interface RawMarketData {
  candles: CandleBar[];
  price: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  provider: string;
}

interface CachedRaw {
  freshUntil: number;
  staleUntil: number;
  spotCheckedAt: number;
  data: RawMarketData;
}

const rawFeedCache = new Map<string, CachedRaw>();
const inFlightRaw = new Map<string, Promise<RawMarketData | null>>();
const FRESH_CANDLES_MS = 12_000;
const STALE_MAX_MS = 180_000;
const WATCHLIST_FRESH_MS = 8_000;
const SPOT_TICK_COOLDOWN_MS = 1_200;
const WATCHLIST_SPOT_COOLDOWN_MS = 2_500;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

export function getInstrumentById(id: string): InstrumentMeta {
  const found = INSTRUMENTS.find(
    (item) =>
      item.id.toLowerCase() === id.toLowerCase() ||
      item.symbol.toLowerCase() === id.toLowerCase()
  );
  return found ?? INSTRUMENTS[0];
}

function mapTimeframeToYahoo(tf: Timeframe): { interval: string; range: string } {
  switch (tf) {
    case '5m':
      return { interval: '5m', range: '5d' };
    case '15m':
      return { interval: '15m', range: '5d' };
    case '1h':
      return { interval: '60m', range: '1mo' };
    case '4h':
      return { interval: '60m', range: '3mo' };
    case '1d':
      return { interval: '1d', range: '6mo' };
  }
}

function aggregateTo4h(candles: CandleBar[]): CandleBar[] {
  if (candles.length === 0) return [];
  const buckets = new Map<number, CandleBar>();
  const FOUR_HOURS = 4 * 3600;
  for (const bar of candles) {
    const bucketKey = Math.floor(bar.time / FOUR_HOURS) * FOUR_HOURS;
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, { ...bar, time: bucketKey });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSwissquoteSpot(pair: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${pair}`,
      2200
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any[];
    const spread = json?.[0]?.spreadProfilePrices?.[0];
    if (spread && typeof spread.bid === 'number' && typeof spread.ask === 'number') {
      return Number(((spread.bid + spread.ask) / 2).toFixed(4));
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchBinanceSpotPrice(symbol: string): Promise<number | null> {
  const endpoints = [
    'https://api.binance.com',
    'https://data-api.binance.vision',
    'https://api.binance.us',
  ];
  for (const base of endpoints) {
    try {
      const res = await fetchWithTimeout(
        `${base}/api/v3/ticker/price?symbol=${symbol}`,
        2000
      );
      if (!res.ok) continue;
      const json = (await res.json()) as any;
      const p = Number(json?.price);
      if (Number.isFinite(p) && p > 0) return p;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchBinanceFuturesPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`,
      1800
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const p = Number(json?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function fetchYahooFastSpot(yahooSymbol: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yahooSymbol
      )}?interval=1m&range=1d&includePrePost=true`,
      2500
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function patchCachedSpotPrice(instrument: InstrumentMeta, entry: CachedRaw): Promise<void> {
  entry.spotCheckedAt = Date.now();
  let spotPrice: number | null = null;
  if (instrument.binanceSymbol) {
    spotPrice = await fetchBinanceSpotPrice(instrument.binanceSymbol);
  } else if (instrument.binanceFuturesSymbol) {
    spotPrice = await fetchBinanceFuturesPrice(instrument.binanceFuturesSymbol);
  } else if (instrument.swissquotePair) {
    spotPrice = await fetchSwissquoteSpot(instrument.swissquotePair);
  } else {
    spotPrice = await fetchYahooFastSpot(instrument.yahooSymbol);
  }

  if (!spotPrice || spotPrice <= 0) return;

  // Reject mismatched proxy spot values (>5% jump in 1s is different contract scale)
  if (Math.abs(spotPrice - entry.data.price) / Math.max(entry.data.price, 1) > 0.05) {
    return;
  }

  const nextCandles = entry.data.candles.map((c, idx, arr) => {
    if (idx !== arr.length - 1) return c;
    return {
      ...c,
      close: spotPrice!,
      high: Math.max(c.high, spotPrice!),
      low: Math.min(c.low, spotPrice!),
    };
  });

  const change = spotPrice - entry.data.previousClose;
  const changePercent = entry.data.previousClose ? (change / entry.data.previousClose) * 100 : 0;

  entry.data = {
    ...entry.data,
    candles: nextCandles,
    price: spotPrice,
    high: Math.max(entry.data.high, spotPrice),
    low: Math.min(entry.data.low, spotPrice),
    change,
    changePercent,
  };
}

async function fetchBinanceCrypto(
  symbol: string,
  tf: Timeframe
): Promise<RawMarketData | null> {
  const intervalMap: Record<Timeframe, string> = {
    '5m': '5m',
    '15m': '15m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
  };
  const interval = intervalMap[tf];
  const endpoints = [
    'https://api.binance.com',
    'https://data-api.binance.vision',
    'https://api.binance.us',
  ];

  for (const base of endpoints) {
    try {
      const [klineRes, tickerRes] = await Promise.all([
        fetchWithTimeout(`${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=140`),
        fetchWithTimeout(`${base}/api/v3/ticker/24hr?symbol=${symbol}`),
      ]);
      if (!klineRes.ok || !tickerRes.ok) continue;
      const klines = (await klineRes.json()) as any[];
      const ticker = (await tickerRes.json()) as any;
      if (!Array.isArray(klines) || klines.length < 10) continue;

      const candles: CandleBar[] = klines
        .map((k) => ({
          time: Math.floor(Number(k[0]) / 1000),
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[5]),
        }))
        .filter((c) => Number.isFinite(c.close) && c.close > 0);

      if (candles.length < 10) continue;
      const price = Number(ticker.lastPrice) || candles[candles.length - 1].close;
      candles[candles.length - 1].close = price;
      candles[candles.length - 1].high = Math.max(candles[candles.length - 1].high, price);
      candles[candles.length - 1].low = Math.min(candles[candles.length - 1].low, price);

      const open = Number(ticker.openPrice) || candles[0].open;
      const high = Number(ticker.highPrice) || Math.max(...candles.map((c) => c.high));
      const low = Number(ticker.lowPrice) || Math.min(...candles.map((c) => c.low));
      const previousClose = Number(ticker.prevClosePrice) || open;
      const change = Number(ticker.priceChange) || price - previousClose;
      const changePercent =
        Number(ticker.priceChangePercent) || (previousClose ? (change / previousClose) * 100 : 0);
      const volume = Number(ticker.volume) || candles[candles.length - 1].volume;

      return {
        candles,
        price,
        open,
        high,
        low,
        previousClose,
        change,
        changePercent,
        volume,
        provider: 'Binance Live Spot API',
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchBinanceFutures(
  symbol: string,
  tf: Timeframe
): Promise<RawMarketData | null> {
  const intervalMap: Record<Timeframe, string> = {
    '5m': '5m',
    '15m': '15m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
  };
  const interval = intervalMap[tf];

  try {
    const [klineRes, tickerRes] = await Promise.all([
      fetchWithTimeout(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=140`,
        4500
      ),
      fetchWithTimeout(
        `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`,
        4500
      ),
    ]);
    if (!klineRes.ok || !tickerRes.ok) return null;
    const klines = (await klineRes.json()) as any[];
    const ticker = (await tickerRes.json()) as any;
    if (!Array.isArray(klines) || klines.length < 10) return null;

    const candles: CandleBar[] = klines
      .map((k) => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      }))
      .filter((c) => Number.isFinite(c.close) && c.close > 0);

    if (candles.length < 10) return null;
    const price = Number(ticker.lastPrice) || candles[candles.length - 1].close;
    candles[candles.length - 1].close = price;
    candles[candles.length - 1].high = Math.max(candles[candles.length - 1].high, price);
    candles[candles.length - 1].low = Math.min(candles[candles.length - 1].low, price);

    const open = Number(ticker.openPrice) || candles[0].open;
    const high = Number(ticker.highPrice) || Math.max(...candles.map((c) => c.high));
    const low = Number(ticker.lowPrice) || Math.min(...candles.map((c) => c.low));
    const previousClose = Number(ticker.prevClosePrice) || open;
    const change = Number(ticker.priceChange) || price - previousClose;
    const changePercent =
      Number(ticker.priceChangePercent) || (previousClose ? (change / previousClose) * 100 : 0);
    const volume = Number(ticker.volume) || candles[candles.length - 1].volume;

    return {
      candles,
      price,
      open,
      high,
      low,
      previousClose,
      change,
      changePercent,
      volume,
      provider: `Binance Futures Live (${symbol})`,
    };
  } catch {
    return null;
  }
}

async function fetchBybitCrypto(symbol: string, tf: Timeframe): Promise<RawMarketData | null> {
  const intervalMap: Record<Timeframe, string> = {
    '5m': '5',
    '15m': '15',
    '1h': '60',
    '4h': '240',
    '1d': 'D',
  };
  try {
    const [klineRes, tickerRes] = await Promise.all([
      fetchWithTimeout(
        `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${intervalMap[tf]}&limit=140`
      ),
      fetchWithTimeout(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`),
    ]);
    if (!klineRes.ok || !tickerRes.ok) return null;
    const kJson = (await klineRes.json()) as any;
    const tJson = (await tickerRes.json()) as any;
    const rows = kJson?.result?.list;
    const ticker = tJson?.result?.list?.[0];
    if (!Array.isArray(rows) || rows.length < 10) return null;

    const candles: CandleBar[] = rows
      .map((r: any[]) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }))
      .filter((c) => Number.isFinite(c.close) && c.close > 0)
      .sort((a, b) => a.time - b.time);

    if (candles.length < 10) return null;
    const last = candles[candles.length - 1];
    const price = Number(ticker?.lastPrice) || last.close;
    last.close = price;
    const previousClose = Number(ticker?.prevPrice24h) || candles[0].open;
    const high = Number(ticker?.highPrice24h) || Math.max(...candles.map((c) => c.high));
    const low = Number(ticker?.lowPrice24h) || Math.min(...candles.map((c) => c.low));
    const change = price - previousClose;
    const changePercent = previousClose ? (change / previousClose) * 100 : 0;
    const volume = Number(ticker?.volume24h) || last.volume;

    return {
      candles,
      price,
      open: previousClose,
      high,
      low,
      previousClose,
      change,
      changePercent,
      volume,
      provider: 'Bybit Live Spot API',
    };
  } catch {
    return null;
  }
}

async function fetchYahooMarket(
  yahooSymbol: string,
  segment: string,
  tf: Timeframe,
  swissquotePair?: string
): Promise<RawMarketData | null> {
  const { interval, range } = mapTimeframeToYahoo(tf);
  const encoded = encodeURIComponent(yahooSymbol);
  const hosts = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com'];

  for (const host of hosts) {
    try {
      const res = await fetchWithTimeout(
        `${host}/v8/finance/chart/${encoded}?interval=${interval}&range=${range}&includePrePost=true`
      );
      if (!res.ok) continue;
      const json = (await res.json()) as any;
      const result = json?.chart?.result?.[0];
      if (!result || !Array.isArray(result.timestamp)) continue;

      const meta = result.meta ?? {};
      const quote = result.indicators?.quote?.[0] ?? {};
      const timestamps: number[] = result.timestamp;
      const opens: (number | null)[] = quote.open ?? [];
      const highs: (number | null)[] = quote.high ?? [];
      const lows: (number | null)[] = quote.low ?? [];
      const closes: (number | null)[] = quote.close ?? [];
      const volumes: (number | null)[] = quote.volume ?? [];

      let candles: CandleBar[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const o = opens[i];
        const h = highs[i];
        const l = lows[i];
        const c = closes[i];
        if (
          typeof o === 'number' &&
          typeof h === 'number' &&
          typeof l === 'number' &&
          typeof c === 'number' &&
          Number.isFinite(c) &&
          c > 0
        ) {
          candles.push({
            time: timestamps[i],
            open: o,
            high: h,
            low: l,
            close: c,
            volume:
              typeof volumes[i] === 'number' && Number.isFinite(volumes[i]!) ? volumes[i]! : 0,
          });
        }
      }

      if (tf === '4h') {
        candles = aggregateTo4h(candles);
      }

      if (candles.length > 140) {
        candles = candles.slice(-140);
      }
      if (candles.length < 5) continue;

      const latest = candles[candles.length - 1];
      let price =
        typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : latest.close;

      let providerLabel =
        segment === 'MCX'
          ? `Live Benchmark (${yahooSymbol})`
          : `Yahoo Live (${yahooSymbol})`;
      if (swissquotePair && (segment === 'INTERNATIONAL' || yahooSymbol === 'GC=F' || yahooSymbol === 'SI=F')) {
        const sqPrice = await fetchSwissquoteSpot(swissquotePair);
        if (sqPrice && Math.abs(sqPrice - price) / price < 0.05) {
          price = sqPrice;
          latest.close = sqPrice;
          latest.high = Math.max(latest.high, sqPrice);
          latest.low = Math.min(latest.low, sqPrice);
          providerLabel = `Live Spot (${swissquotePair} + ${yahooSymbol})`;
        }
      }

      const previousClose =
        typeof meta.chartPreviousClose === 'number'
          ? meta.chartPreviousClose
          : typeof meta.previousClose === 'number'
            ? meta.previousClose
            : candles[Math.max(0, candles.length - 2)].close;
      const open =
        typeof meta.regularMarketOpen === 'number' ? meta.regularMarketOpen : latest.open;
      const high =
        typeof meta.regularMarketDayHigh === 'number' ? meta.regularMarketDayHigh : latest.high;
      const low =
        typeof meta.regularMarketDayLow === 'number' ? meta.regularMarketDayLow : latest.low;
      const volume =
        typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : latest.volume;
      const change = price - previousClose;
      const changePercent = previousClose ? (change / previousClose) * 100 : 0;

      return {
        candles,
        price,
        open,
        high,
        low,
        previousClose,
        change,
        changePercent,
        volume,
        provider: providerLabel,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchTwelveData(
  twelveDataSymbol: string,
  tf: Timeframe
): Promise<RawMarketData | null> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return null;

  const intervalMap: Record<Timeframe, string> = {
    '5m': '5min',
    '15m': '15min',
    '1h': '1h',
    '4h': '4h',
    '1d': '1day',
  };

  try {
    const res = await fetchWithTimeout(
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
        twelveDataSymbol
      )}&interval=${intervalMap[tf]}&outputsize=120&apikey=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (!Array.isArray(json?.values) || json.values.length < 10) return null;

    const candles: CandleBar[] = json.values
      .map((v: any) => ({
        time: Math.floor(new Date(v.datetime).getTime() / 1000),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: Number(v.volume || 0),
      }))
      .filter((c: CandleBar) => Number.isFinite(c.close) && c.close > 0)
      .sort((a: CandleBar, b: CandleBar) => a.time - b.time);

    if (candles.length < 10) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const change = last.close - prev.close;
    const changePercent = prev.close ? (change / prev.close) * 100 : 0;

    return {
      candles,
      price: last.close,
      open: last.open,
      high: last.high,
      low: last.low,
      previousClose: prev.close,
      change,
      changePercent,
      volume: last.volume,
      provider: 'Twelve Data Market API',
    };
  } catch {
    return null;
  }
}

function triggerUpstreamRefresh(
  feedKey: string,
  instrument: InstrumentMeta,
  timeframe: Timeframe,
  freshWindowMs: number
): Promise<RawMarketData | null> {
  const existingFlight = inFlightRaw.get(feedKey);
  if (existingFlight) {
    return existingFlight;
  }

  const flight = (async () => {
    let raw: RawMarketData | null = null;
    if (instrument.binanceSymbol) {
      raw = await fetchBinanceCrypto(instrument.binanceSymbol, timeframe);
    }
    if (!raw && instrument.binanceFuturesSymbol) {
      raw = await fetchBinanceFutures(instrument.binanceFuturesSymbol, timeframe);
    }
    if (!raw && process.env.TWELVE_DATA_API_KEY && instrument.twelveDataSymbol) {
      raw = await fetchTwelveData(instrument.twelveDataSymbol, timeframe);
    }
    if (!raw && instrument.bybitSymbol) {
      raw = await fetchBybitCrypto(instrument.bybitSymbol, timeframe);
    }
    if (!raw) {
      raw = await fetchYahooMarket(
        instrument.yahooSymbol,
        instrument.segment,
        timeframe,
        instrument.swissquotePair
      );
    }

    if (raw) {
      const now = Date.now();
      rawFeedCache.set(feedKey, {
        freshUntil: now + freshWindowMs,
        staleUntil: now + STALE_MAX_MS,
        spotCheckedAt: now,
        data: raw,
      });
    }
    return raw;
  })().finally(() => {
    inFlightRaw.delete(feedKey);
  });

  inFlightRaw.set(feedKey, flight);
  return flight;
}

export function applyLiveStreamTickToCache(binanceStreamSymbol: string, price: number): void {
  if (!Number.isFinite(price) || price <= 0) return;
  const upperSym = binanceStreamSymbol.toUpperCase();
  const now = Date.now();

  for (const [feedKey, entry] of rawFeedCache.entries()) {
    if (!feedKey.startsWith(`${upperSym}:`)) continue;
    const lastIdx = entry.data.candles.length - 1;
    if (lastIdx < 0) continue;

    const prevLast = entry.data.candles[lastIdx];
    const nextCandles = [...entry.data.candles];
    nextCandles[lastIdx] = {
      ...prevLast,
      close: price,
      high: Math.max(prevLast.high, price),
      low: Math.min(prevLast.low, price),
    };

    const change = price - entry.data.previousClose;
    const changePercent = entry.data.previousClose ? (change / entry.data.previousClose) * 100 : 0;

    entry.spotCheckedAt = now;
    entry.data = {
      ...entry.data,
      candles: nextCandles,
      price,
      high: Math.max(entry.data.high, price),
      low: Math.min(entry.data.low, price),
      change,
      changePercent,
    };
  }
}

async function getRawFeed(
  instrument: InstrumentMeta,
  timeframe: Timeframe,
  isWatchlist: boolean
): Promise<RawMarketData | null> {
  const feedKey = `${
    instrument.binanceSymbol || instrument.binanceFuturesSymbol || instrument.yahooSymbol
  }:${timeframe}`;
  const now = Date.now();
  const freshWindowMs = isWatchlist ? WATCHLIST_FRESH_MS : FRESH_CANDLES_MS;
  const cached = rawFeedCache.get(feedKey);

  const spotCooldown = isWatchlist ? WATCHLIST_SPOT_COOLDOWN_MS : SPOT_TICK_COOLDOWN_MS;

  // 1. Fresh cache hit: apply lightweight spot tick (WS ticks already update spotCheckedAt continuously)
  if (cached && now < cached.freshUntil) {
    if (now - cached.spotCheckedAt > spotCooldown) {
      await patchCachedSpotPrice(instrument, cached);
    }
    return cached.data;
  }

  // 2. Stale-While-Revalidate hit: return cached snapshot immediately (<1ms) & refresh candles async
  if (cached && now < cached.staleUntil) {
    if (now - cached.spotCheckedAt > spotCooldown) {
      await patchCachedSpotPrice(instrument, cached);
    }
    void triggerUpstreamRefresh(feedKey, instrument, timeframe, freshWindowMs);
    return cached.data;
  }

  // 3. Cold miss or expired beyond STALE_MAX_MS: block for real upstream verification
  return triggerUpstreamRefresh(feedKey, instrument, timeframe, freshWindowMs);
}

export async function prewarmPriorityFeeds(): Promise<void> {
  const priorityIds = [
    'XAUUSD',
    'NIFTY50',
    'BANKNIFTY',
    'XAGUSD',
    'BTCUSDT',
    'MCX_CRUDEOIL',
    'NAS100',
    'EURUSD',
    'RELIANCE',
  ];
  const targets = priorityIds.map((id) => getInstrumentById(id));
  await Promise.allSettled(
    targets.flatMap((inst) => [
      getRawFeed(inst, '5m', true),
      getRawFeed(inst, '15m', true),
    ])
  );
}

export async function fetchLiveMarketQuote(
  instrumentId: string,
  timeframe: Timeframe = '5m',
  emaPeriods = { fast: 9, mid: 20, slow: 50, rsi: 14 },
  isWatchlist = false
): Promise<MarketQuoteResponse> {
  const instrument = getInstrumentById(instrumentId);
  const fetchedAt = new Date().toISOString();
  const raw = await getRawFeed(instrument, timeframe, isWatchlist);

  if (!raw || raw.candles.length === 0) {
    return {
      instrument,
      available: false,
      statusText: 'DATA UNAVAILABLE',
      unavailableReason: `Live upstream market feed for ${instrument.symbol} (${timeframe}) is temporarily unavailable. Use the Stream Widget toggle to view TradingView / Investing.com stream.`,
      provider: 'No Active Feed',
      fetchedAt,
      marketTimestamp: fetchedAt,
      timeframe,
      candles: [],
    };
  }

  const lastCandle = raw.candles[raw.candles.length - 1];
  const technicals = computeTechnicals(raw.candles, emaPeriods);
  const levels = computeLevels(
    raw.candles,
    raw.price,
    technicals.atr ?? raw.price * 0.004
  );

  return {
    instrument,
    available: true,
    statusText: 'LIVE',
    provider: raw.provider,
    fetchedAt,
    marketTimestamp: new Date(lastCandle.time * 1000).toISOString(),
    timeframe,
    price: Number(raw.price.toFixed(4)),
    open: Number(raw.open.toFixed(4)),
    high: Number(raw.high.toFixed(4)),
    low: Number(raw.low.toFixed(4)),
    previousClose: Number(raw.previousClose.toFixed(4)),
    change: Number(raw.change.toFixed(4)),
    changePercent: Number(raw.changePercent.toFixed(2)),
    volume: Math.round(raw.volume),
    candles: raw.candles,
    technicals,
    levels,
  };
}
