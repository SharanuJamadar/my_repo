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
  expiresAt: number;
  data: RawMarketData;
}

const rawFeedCache = new Map<string, CachedRaw>();
const inFlightRaw = new Map<string, Promise<RawMarketData | null>>();
const CACHE_TTL_MS = 3500; // 3.5s fast live refresh cache
const WATCHLIST_CACHE_TTL_MS = 20_000;

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

async function fetchWithTimeout(url: string, timeoutMs = 7000): Promise<Response> {
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
      3500
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
      // Update latest bar close to real-time ticker price
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
  // query2 works reliably with browser headers; keep query1 as fallback
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

      // For XAUUSD / XAGUSD spot feeds, blend live Swissquote sub-second BBO if available
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

async function getRawFeed(
  instrument: InstrumentMeta,
  timeframe: Timeframe,
  ttlMs: number
): Promise<RawMarketData | null> {
  // Share underlying feed key (e.g. GC=F, SI=F, CL=F) to prevent duplicate burst requests
  const feedKey = `${
    instrument.binanceSymbol || instrument.yahooSymbol
  }:${timeframe}`;

  const cached = rawFeedCache.get(feedKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const existingFlight = inFlightRaw.get(feedKey);
  if (existingFlight) {
    return existingFlight;
  }

  const flight = (async () => {
    let raw: RawMarketData | null = null;
    if (process.env.TWELVE_DATA_API_KEY && instrument.twelveDataSymbol) {
      raw = await fetchTwelveData(instrument.twelveDataSymbol, timeframe);
    }
    if (!raw && instrument.binanceSymbol) {
      raw = await fetchBinanceCrypto(instrument.binanceSymbol, timeframe);
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
      rawFeedCache.set(feedKey, { expiresAt: Date.now() + ttlMs, data: raw });
    }
    return raw;
  })().finally(() => {
    inFlightRaw.delete(feedKey);
  });

  inFlightRaw.set(feedKey, flight);
  return flight;
}

export async function fetchLiveMarketQuote(
  instrumentId: string,
  timeframe: Timeframe = '5m',
  emaPeriods = { fast: 9, mid: 20, slow: 50, rsi: 14 },
  isWatchlist = false
): Promise<MarketQuoteResponse> {
  const instrument = getInstrumentById(instrumentId);
  const fetchedAt = new Date().toISOString();
  const raw = await getRawFeed(
    instrument,
    timeframe,
    isWatchlist ? WATCHLIST_CACHE_TTL_MS : CACHE_TTL_MS
  );

  if (!raw || raw.candles.length === 0) {
    return {
      instrument,
      available: false,
      statusText: 'DATA UNAVAILABLE',
      unavailableReason: `Live upstream market feed for ${instrument.symbol} (${timeframe}) is temporarily unavailable. Use the Live Chart switch to view TradingView / Investing.com stream.`,
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
