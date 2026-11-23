import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Pause, Play, RefreshCw } from 'lucide-react';
import {
  INSTRUMENTS,
  type MarketQuoteResponse,
  type MarketSegment,
} from '../types/trading';

interface WatchlistViewProps {
  selectedInstrumentId: string;
  onSelectInstrument: (id: string) => void;
}

export const WatchlistView: React.FC<WatchlistViewProps> = ({
  selectedInstrumentId,
  onSelectInstrument,
}) => {
  const [segment, setSegment] = useState<'ALL' | MarketSegment>('ALL');
  const [quotes, setQuotes] = useState<Record<string, MarketQuoteResponse>>({});
  const [tickDirections, setTickDirections] = useState<Record<string, 'UP' | 'DOWN' | null>>({});
  const [loading, setLoading] = useState(false);
  const [liveStreamEnabled, setLiveStreamEnabled] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const prevPricesRef = useRef<Record<string, number>>({});

  const loadWatchlist = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/market/watchlist?timeframe=15m');
      if (!res.ok) return;
      const json = await res.json();
      const dirs: Record<string, 'UP' | 'DOWN' | null> = {};
      const nextMap: Record<string, MarketQuoteResponse> = {};

      for (const item of json.items || []) {
        const id = item.instrument?.id;
        if (!id) continue;
        nextMap[id] = item;
        if (item.available && typeof item.price === 'number') {
          const prev = prevPricesRef.current[id];
          if (typeof prev === 'number' && prev !== item.price) {
            dirs[id] = item.price > prev ? 'UP' : 'DOWN';
          }
          prevPricesRef.current[id] = item.price;
        }
      }

      setQuotes((prev) => ({ ...prev, ...nextMap }));
      if (Object.keys(dirs).length > 0) {
        setTickDirections((prev) => ({ ...prev, ...dirs }));
      }
      setLastUpdated(json.fetchedAt || new Date().toISOString());
    } catch {
      // Preserve last fetched watchlist silently on transient errors
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load + 3-second silent polling for all markets (NSE, BSE, MCX, US Oil, Crypto)
  useEffect(() => {
    void loadWatchlist({ silent: false });
    if (!liveStreamEnabled) return;
    const pollTimer = window.setInterval(() => {
      void loadWatchlist({ silent: true });
    }, 3000);
    return () => window.clearInterval(pollTimer);
  }, [liveStreamEnabled, loadWatchlist]);

  // Real-time Binance WebSocket tick stream for all Binance-linked markets in Watchlist
  useEffect(() => {
    if (!liveStreamEnabled) {
      setWsConnected(false);
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let retryMs = 1500;
    const pendingBySym = new Map<string, { price: number; ts: number }>();

    const connect = () => {
      if (disposed) return;
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      try {
        socket = new WebSocket(`${wsProto}//${window.location.host}/ws/market?instrument=ALL`);
      } catch {
        reconnectTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 1.5, 8000);
        return;
      }

      socket.onopen = () => {
        if (disposed) {
          socket?.close();
          return;
        }
        retryMs = 1500;
        setWsConnected(true);
      };

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as {
            type?: string;
            streamSymbol?: string;
            price?: number;
            ts?: number;
            ticks?: { streamSymbol: string; price: number; ts: number }[];
          };

          if ((msg.type === 'ticks' || msg.type === 'snapshot') && Array.isArray(msg.ticks)) {
            for (const t of msg.ticks) {
              if (t?.streamSymbol && typeof t.price === 'number' && t.price > 0) {
                pendingBySym.set(t.streamSymbol.toUpperCase(), {
                  price: t.price,
                  ts: typeof t.ts === 'number' ? t.ts : Date.now(),
                });
              }
            }
          } else if (
            msg.type === 'tick' &&
            msg.streamSymbol &&
            typeof msg.price === 'number' &&
            msg.price > 0
          ) {
            pendingBySym.set(msg.streamSymbol.toUpperCase(), {
              price: msg.price,
              ts: typeof msg.ts === 'number' ? msg.ts : Date.now(),
            });
          }
        } catch {
          // Ignore malformed WS payloads
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        setWsConnected(false);
        reconnectTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 1.5, 8000);
      };

      socket.onerror = () => {
        try {
          socket?.close();
        } catch {
          // Ignore close error
        }
      };
    };

    connect();

    // Flush batched Binance ticks onto Watchlist rows cleanly every 120ms
    const flushTimer = window.setInterval(() => {
      if (pendingBySym.size === 0) return;
      const batch = new Map(pendingBySym);
      pendingBySym.clear();

      const matchingInsts = INSTRUMENTS.filter((inst) => {
        const sym = (inst.binanceSymbol || inst.binanceFuturesSymbol || '').toUpperCase();
        return sym && batch.has(sym);
      });
      if (matchingInsts.length === 0) return;

      const dirs: Record<string, 'UP' | 'DOWN' | null> = {};
      setQuotes((prevQuotes) => {
        let changed = false;
        const nextQuotes = { ...prevQuotes };

        for (const inst of matchingInsts) {
          const sym = (inst.binanceSymbol || inst.binanceFuturesSymbol || '').toUpperCase();
          const tick = batch.get(sym);
          const cur = prevQuotes[inst.id];
          if (!tick || !cur || !cur.available) continue;

          const oldPrice = prevPricesRef.current[inst.id] ?? cur.price;
          if (oldPrice !== tick.price) {
            dirs[inst.id] = oldPrice && tick.price > oldPrice ? 'UP' : 'DOWN';
            prevPricesRef.current[inst.id] = tick.price;
          }

          const prevClose = cur.previousClose ?? cur.price ?? tick.price;
          const change = Number((tick.price - prevClose).toFixed(4));
          const changePercent = prevClose ? Number(((change / prevClose) * 100).toFixed(2)) : 0;

          nextQuotes[inst.id] = {
            ...cur,
            price: tick.price,
            change,
            changePercent,
            marketTimestamp: new Date(tick.ts).toISOString(),
          };
          changed = true;
        }

        return changed ? nextQuotes : prevQuotes;
      });

      if (Object.keys(dirs).length > 0) {
        setTickDirections((prev) => ({ ...prev, ...dirs }));
      }
      setLastUpdated(new Date().toISOString());
    }, 120);

    return () => {
      disposed = true;
      window.clearInterval(flushTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // Ignore cleanup close
      }
    };
  }, [liveStreamEnabled]);

  const sections: { title: string; seg: MarketSegment; subtitle: string }[] = [
    {
      title: 'Indian Markets',
      seg: 'INDIAN',
      subtitle: 'NIFTY, BANK NIFTY, FIN NIFTY, MIDCAP NIFTY, SENSEX & Most-Traded NSE F&O Equities',
    },
    {
      title: 'MCX Commodities',
      seg: 'MCX',
      subtitle: 'Metals & Energy (Binance Futures live stream on Gold/Silver · EMA 9 priority on Crude Oil)',
    },
    {
      title: 'International Markets',
      seg: 'INTERNATIONAL',
      subtitle: 'Precious Metals, WTI Crude, US Indices (NAS100/SPX500/US30), Major FX & Top Crypto Perpetuals',
    },
  ];

  const visibleSections =
    segment === 'ALL' ? sections : sections.filter((s) => s.seg === segment);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Market Watchlist</h2>
            {liveStreamEnabled && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {wsConnected ? 'WS + 3s Live' : 'Live 3s'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {lastUpdated
              ? `15m Multi-Market Snapshot · Synced ${new Date(lastUpdated).toLocaleTimeString()}`
              : 'Loading live multi-market quotes...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-1">
            {(['ALL', 'INDIAN', 'MCX', 'INTERNATIONAL'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSegment(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  segment === tab
                    ? 'bg-blue-700 dark:bg-slate-800 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {tab === 'ALL'
                  ? 'All Markets'
                  : tab === 'INDIAN'
                    ? 'Indian Markets'
                    : tab === 'MCX'
                      ? 'MCX Commodities'
                      : 'International'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setLiveStreamEnabled((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              liveStreamEnabled
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                : 'bg-white dark:bg-[#0E182A] border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
            }`}
          >
            {liveStreamEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {liveStreamEnabled ? 'Streaming ON' : 'Paused'}
          </button>

          <button
            type="button"
            onClick={() => loadWatchlist({ silent: false })}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Quotes
          </button>
        </div>
      </div>

      {visibleSections.map((sec) => {
        const items = INSTRUMENTS.filter((i) => i.segment === sec.seg);
        return (
          <div
            key={sec.seg}
            className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{sec.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{sec.subtitle}</p>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                {items.length} Instruments
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-medium">Instrument</th>
                    <th className="py-2.5 px-4 font-medium text-right">Live Price</th>
                    <th className="py-2.5 px-4 font-medium text-right">Change %</th>
                    <th className="py-2.5 px-4 font-medium">15m Trend</th>
                    <th className="py-2.5 px-4 font-medium text-right">RSI (14)</th>
                    <th className="py-2.5 px-4 font-medium">ATM / Contract Focus</th>
                    <th className="py-2.5 px-4 font-medium">Timestamp / Source</th>
                    <th className="py-2.5 px-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {items.map((inst) => {
                    const q = quotes[inst.id];
                    const isSelected = inst.id === selectedInstrumentId;
                    const pos = (q?.changePercent ?? 0) >= 0;
                    const tickDir = tickDirections[inst.id];
                    const atmStrike =
                      q?.available && q.price && inst.strikeStep
                        ? Math.round(q.price / inst.strikeStep) * inst.strikeStep
                        : null;

                    return (
                      <tr
                        key={inst.id}
                        className={`hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors ${
                          isSelected ? 'bg-emerald-500/[0.04]' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white">{inst.symbol}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {inst.name} · {inst.exchangeLabel}
                          </div>
                        </td>

                        <td
                          className={`py-3 px-4 text-right font-mono-tabular font-semibold transition-colors ${
                            !q?.available
                              ? 'text-slate-900 dark:text-white'
                              : tickDir === 'UP'
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : tickDir === 'DOWN'
                                  ? 'text-rose-700 dark:text-rose-300'
                                  : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {loading && !q ? (
                            <span className="text-slate-500">Loading...</span>
                          ) : q?.available && q.price !== undefined ? (
                            `${inst.currency}${q.price.toLocaleString()}`
                          ) : (
                            <span className="text-amber-700 dark:text-amber-400">DATA UNAVAILABLE</span>
                          )}
                        </td>

                        <td
                          className={`py-3 px-4 text-right font-mono-tabular font-medium ${
                            !q?.available
                              ? 'text-slate-500'
                              : pos
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {q?.available && q.changePercent !== undefined
                            ? `${pos ? '+' : ''}${q.changePercent.toFixed(2)}%`
                            : '—'}
                        </td>

                        <td className="py-3 px-4">
                          {q?.available && q.technicals ? (
                            <span
                              className={`font-medium ${
                                q.technicals.trendBias === 'BULLISH'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : q.technicals.trendBias === 'BEARISH'
                                    ? 'text-rose-700 dark:text-rose-400'
                                    : 'text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {q.technicals.trendBias}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                          {q?.available && q.technicals?.rsi !== null && q.technicals?.rsi !== undefined
                            ? q.technicals.rsi.toFixed(1)
                            : '—'}
                        </td>

                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                          {atmStrike ? (
                            <span className="font-mono-tabular">
                              ATM {atmStrike} CE / PE
                            </span>
                          ) : inst.ema9Priority ? (
                            <span>EMA 9 Priority</span>
                          ) : (
                            <span>Spot / Futures</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-[11px] text-slate-500 dark:text-slate-400">
                          {q?.available ? (
                            <div>
                              <div className="font-mono-tabular">
                                {new Date(q.marketTimestamp).toLocaleTimeString()}
                              </div>
                              <div className="truncate max-w-[180px]">{q.provider}</div>
                            </div>
                          ) : (
                            <span>Feed unavailable</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => onSelectInstrument(inst.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            Analyze
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};
