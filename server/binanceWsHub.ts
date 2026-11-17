import type { Server as HttpServer, IncomingMessage } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { applyLiveStreamTickToCache, getInstrumentById } from './marketData.ts';

export const BINANCE_FLUSH_INTERVAL_MS = 30;

const FUTURES_STREAM_URL =
  'wss://fstream.binance.com/stream?streams=xauusdt@bookTicker/xagusdt@bookTicker/xauusdt@aggTrade/xagusdt@aggTrade';

const SPOT_STREAM_URL =
  'wss://stream.binance.com:9443/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker/solusdt@bookTicker/bnbusdt@bookTicker/xrpusdt@bookTicker/btcusdt@aggTrade/ethusdt@aggTrade/solusdt@aggTrade/bnbusdt@aggTrade/xrpusdt@aggTrade';

interface LiveTickEntry {
  price: number;
  ts: number;
}

interface MarketClientMeta {
  instrumentId: string;
  streamSymbol: string | null;
  allMarketFeed: boolean;
}

function resolveStreamSymbol(instrumentId: string): string | null {
  if (instrumentId.toUpperCase() === 'ALL') return null;
  const inst = getInstrumentById(instrumentId);
  const sym = inst.binanceSymbol || inst.binanceFuturesSymbol;
  return sym ? sym.toUpperCase() : null;
}

export function attachBinanceWsHub(httpServer: HttpServer): void {
  const latestPrices = new Map<string, LiveTickEntry>();
  const dirtyPrices = new Map<string, LiveTickEntry>();
  const clientSubs = new Map<WebSocket, MarketClientMeta>();

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws/market',
  });

  function sendJson(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // Ignore transient write errors on closing sockets
      }
    }
  }

  function bindClientSubscription(ws: WebSocket, instrumentId: string): void {
    const allMarketFeed = instrumentId.toUpperCase() === 'ALL';
    const streamSymbol = allMarketFeed ? null : resolveStreamSymbol(instrumentId);
    clientSubs.set(ws, { instrumentId, streamSymbol, allMarketFeed });

    sendJson(ws, {
      type: 'status',
      instrumentId,
      streamSymbol,
      allMarketFeed,
      streamSupported: allMarketFeed || Boolean(streamSymbol),
      flushIntervalMs: BINANCE_FLUSH_INTERVAL_MS,
    });

    if (allMarketFeed) {
      const snapshotTicks = Array.from(latestPrices.entries()).map(([sym, entry]) => ({
        streamSymbol: sym,
        price: entry.price,
        ts: entry.ts,
      }));
      if (snapshotTicks.length > 0) {
        sendJson(ws, { type: 'snapshot', ticks: snapshotTicks });
      }
    } else if (streamSymbol) {
      const latest = latestPrices.get(streamSymbol);
      if (latest) {
        sendJson(ws, {
          type: 'tick',
          streamSymbol,
          price: latest.price,
          ts: latest.ts,
        });
      }
    }
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    let initialInstrument = 'NIFTY50';
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      initialInstrument = parsed.searchParams.get('instrument') || 'NIFTY50';
    } catch {
      initialInstrument = 'NIFTY50';
    }

    bindClientSubscription(ws, initialInstrument);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; instrumentId?: string };
        if (msg?.type === 'subscribe' && typeof msg.instrumentId === 'string') {
          bindClientSubscription(ws, msg.instrumentId);
        } else if (msg?.type === 'subscribe_all') {
          bindClientSubscription(ws, 'ALL');
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on('close', () => {
      clientSubs.delete(ws);
    });

    ws.on('error', () => {
      clientSubs.delete(ws);
    });
  });

  function recordUpstreamTick(sym: string, price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const upper = sym.toUpperCase();
    const entry: LiveTickEntry = { price, ts: Date.now() };
    latestPrices.set(upper, entry);
    dirtyPrices.set(upper, entry);
    applyLiveStreamTickToCache(upper, price);
  }

  function handleBinanceFrame(raw: WebSocket.RawData): void {
    try {
      const msg = JSON.parse(raw.toString()) as { stream?: string; data?: any };
      const data = msg?.data ?? msg;
      if (!data || typeof data.s !== 'string') return;

      const streamName = typeof msg?.stream === 'string' ? msg.stream : '';
      let price = NaN;

      if (streamName.endsWith('@aggTrade') || data.e === 'aggTrade') {
        price = Number(data.p);
      } else {
        const bid = Number(data.b);
        const ask = Number(data.a);
        if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) {
          price = Number(((bid + ask) / 2).toFixed(4));
        } else if (Number.isFinite(bid) && bid > 0) {
          price = bid;
        } else if (Number.isFinite(ask) && ask > 0) {
          price = ask;
        }
      }

      if (Number.isFinite(price) && price > 0) {
        recordUpstreamTick(data.s, price);
      }
    } catch {
      // Ignore unparseable frames
    }
  }

  function connectUpstream(label: string, url: string, retryMs = 2000): void {
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(url);
    } catch {
      const nextRetry = Math.min(retryMs * 2, 15_000);
      setTimeout(() => connectUpstream(label, url, nextRetry), retryMs);
      return;
    }

    let currentRetry = retryMs;

    socket.on('open', () => {
      currentRetry = 2000;
      console.log(`[SHARAN WS] Connected to ${label}`);
    });

    socket.on('message', handleBinanceFrame);

    socket.on('close', () => {
      const delay = currentRetry;
      currentRetry = Math.min(currentRetry * 1.5, 15_000);
      setTimeout(() => connectUpstream(label, url, currentRetry), delay);
    });

    socket.on('error', () => {
      // Errors trigger close; keep handler attached to avoid unhandled exceptions
      try {
        socket?.close();
      } catch {
        // Ignore close error
      }
    });
  }

  // Coalesce & broadcast ONLY real upstream Binance ticks received during the last 30 ms
  const flushTimer = setInterval(() => {
    if (dirtyPrices.size === 0 || wss.clients.size === 0) {
      if (dirtyPrices.size > 0) dirtyPrices.clear();
      return;
    }

    const batch = new Map(dirtyPrices);
    dirtyPrices.clear();

    const batchList = Array.from(batch.entries()).map(([streamSymbol, tick]) => ({
      streamSymbol,
      price: tick.price,
      ts: tick.ts,
    }));

    for (const [client, meta] of clientSubs.entries()) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (meta.allMarketFeed) {
        sendJson(client, { type: 'ticks', ticks: batchList });
        continue;
      }
      if (!meta.streamSymbol) continue;
      const tick = batch.get(meta.streamSymbol);
      if (!tick) continue;
      sendJson(client, {
        type: 'tick',
        streamSymbol: meta.streamSymbol,
        price: tick.price,
        ts: tick.ts,
      });
    }
  }, BINANCE_FLUSH_INTERVAL_MS);

  if (typeof flushTimer.unref === 'function') {
    flushTimer.unref();
  }

  connectUpstream('Binance Futures Stream (XAUUSDT/XAGUSDT)', FUTURES_STREAM_URL);
  connectUpstream('Binance Spot Stream (BTCUSDT/ETHUSDT/SOLUSDT)', SPOT_STREAM_URL);
}
