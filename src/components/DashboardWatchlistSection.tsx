import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Plus, RefreshCw, Search, X } from 'lucide-react';
import { INSTRUMENTS, type MarketQuoteResponse } from '../types/trading';
import { loadLocalCustomWatchlist, saveLocalCustomWatchlist } from '../lib/localStore';
import { Sparkline } from './Sparkline';

interface DashboardWatchlistSectionProps {
  onOpenInTerminal: (instrumentId: string) => void;
}

export const DashboardWatchlistSection: React.FC<DashboardWatchlistSectionProps> = ({
  onOpenInTerminal,
}) => {
  const [watchlistIds, setWatchlistIds] = useState<string[]>(() => loadLocalCustomWatchlist());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [quotes, setQuotes] = useState<Record<string, MarketQuoteResponse>>({});
  const [tickDirections, setTickDirections] = useState<Record<string, 'UP' | 'DOWN' | null>>({});
  const [loading, setLoading] = useState(false);
  const prevPricesRef = useRef<Record<string, number>>({});
  const pickerContainerRef = useRef<HTMLDivElement | null>(null);

  const watchedInstruments = useMemo(
    () =>
      watchlistIds
        .map((id) => INSTRUMENTS.find((inst) => inst.id === id))
        .filter((inst): inst is (typeof INSTRUMENTS)[number] => Boolean(inst)),
    [watchlistIds]
  );

  const availableToAdd = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return INSTRUMENTS.filter((inst) => {
      if (watchlistIds.includes(inst.id)) return false;
      if (!q) return true;
      return (
        inst.symbol.toLowerCase().includes(q) ||
        inst.name.toLowerCase().includes(q) ||
        inst.exchangeLabel.toLowerCase().includes(q) ||
        inst.segment.toLowerCase().includes(q)
      );
    });
  }, [watchlistIds, searchQuery]);

  // Close picker on outside click or Escape
  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        pickerContainerRef.current &&
        !pickerContainerRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  const fetchSelectedQuotes = useCallback(
    async (ids: string[], options?: { silent?: boolean }) => {
      if (ids.length === 0) return;
      const silent = options?.silent ?? false;
      if (!silent) setLoading(true);
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            try {
              const res = await fetch(`/api/market/quote?instrument=${encodeURIComponent(id)}&timeframe=15m`);
              if (!res.ok) return null;
              return (await res.json()) as MarketQuoteResponse;
            } catch {
              return null;
            }
          })
        );

        const nextMap: Record<string, MarketQuoteResponse> = {};
        const dirs: Record<string, 'UP' | 'DOWN' | null> = {};

        for (const item of results) {
          if (!item?.instrument?.id) continue;
          const id = item.instrument.id;
          nextMap[id] = item;
          if (item.available && typeof item.price === 'number') {
            const prev = prevPricesRef.current[id];
            if (typeof prev === 'number' && prev !== item.price) {
              dirs[id] = item.price > prev ? 'UP' : 'DOWN';
            }
            prevPricesRef.current[id] = item.price;
          }
        }

        if (Object.keys(nextMap).length > 0) {
          setQuotes((prev) => ({ ...prev, ...nextMap }));
        }
        if (Object.keys(dirs).length > 0) {
          setTickDirections((prev) => ({ ...prev, ...dirs }));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    []
  );

  // Poll live quotes strictly for user's chosen watchlist scripts
  useEffect(() => {
    if (watchlistIds.length === 0) return;
    void fetchSelectedQuotes(watchlistIds, { silent: false });
    const timer = window.setInterval(() => {
      void fetchSelectedQuotes(watchlistIds, { silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [watchlistIds, fetchSelectedQuotes]);

  // Real-time WebSocket stream filtered exclusively to user's chosen Binance-linked scripts
  useEffect(() => {
    const binanceWatched = watchedInstruments.filter((inst) =>
      Boolean(inst.binanceSymbol || inst.binanceFuturesSymbol)
    );
    if (binanceWatched.length === 0) return;

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

    const flushTimer = window.setInterval(() => {
      if (pendingBySym.size === 0) return;
      const batch = new Map(pendingBySym);
      pendingBySym.clear();

      const dirs: Record<string, 'UP' | 'DOWN' | null> = {};
      setQuotes((prevQuotes) => {
        let changed = false;
        const nextQuotes = { ...prevQuotes };

        for (const inst of binanceWatched) {
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
  }, [watchedInstruments]);

  const handleAddScript = (id: string) => {
    const next = saveLocalCustomWatchlist([...watchlistIds, id]);
    setWatchlistIds(next);
    setSearchQuery('');
    setPickerOpen(false);
    void fetchSelectedQuotes([id], { silent: true });
  };

  const handleRemoveScript = (id: string) => {
    const next = saveLocalCustomWatchlist(watchlistIds.filter((x) => x !== id));
    setWatchlistIds(next);
  };

  return (
    <section className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl">
      <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">My Watchlist</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Track only your chosen scripts · Click any instrument to launch its live chart
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {watchlistIds.length > 0 && (
            <button
              type="button"
              onClick={() => void fetchSelectedQuotes(watchlistIds, { silent: false })}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}

          <div className="relative" ref={pickerContainerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Script
            </button>

            {pickerOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#0B1424] border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl z-30 overflow-hidden">
                <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search NIFTY, XAUUSD, BTC, Crude..."
                    className="w-full bg-transparent text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.05]">
                  {availableToAdd.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-slate-500">
                      {watchlistIds.length === INSTRUMENTS.length
                        ? 'All available scripts are already in your watchlist.'
                        : 'No matching scripts found.'}
                    </div>
                  ) : (
                    availableToAdd.map((inst) => (
                      <button
                        key={inst.id}
                        type="button"
                        onClick={() => handleAddScript(inst.id)}
                        className="w-full px-3.5 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {inst.symbol}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {inst.name} · {inst.exchangeLabel}
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 shrink-0">
                          Add
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {watchedInstruments.length === 0 ? (
        <div className="px-6 py-12 text-center space-y-3">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Your personal watchlist is empty</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Add only the scripts you want to follow—such as NIFTY 50, XAUUSD, Crude Oil, or BTCUSDT—using the Add Script button above.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                <th className="py-3 px-6 font-medium">Instrument</th>
                <th className="py-3 px-4 font-medium">Exchange</th>
                <th className="py-3 px-4 font-medium hidden md:table-cell">Session Curve</th>
                <th className="py-3 px-4 font-medium text-right">Live Price</th>
                <th className="py-3 px-4 font-medium text-right">Change %</th>
                <th className="py-3 px-4 font-medium">15m Trend</th>
                <th className="py-3 px-6 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {watchedInstruments.map((inst) => {
                const q = quotes[inst.id];
                const pos = (q?.changePercent ?? 0) >= 0;
                const tickDir = tickDirections[inst.id];
                const sparkValues = q?.candles ? q.candles.slice(-24).map((c) => c.close) : [];

                return (
                  <tr key={inst.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                    <td className="py-3.5 px-6">
                      <div className="font-semibold text-slate-900 dark:text-white">{inst.symbol}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{inst.name}</div>
                    </td>

                    <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400">{inst.exchangeLabel}</td>

                    <td className="py-3.5 px-4 hidden md:table-cell">
                      <Sparkline values={sparkValues} positive={pos} width={84} height={24} />
                    </td>

                    <td
                      className={`py-3.5 px-4 text-right font-mono-tabular font-semibold transition-colors ${
                        !q?.available
                          ? 'text-slate-700 dark:text-slate-300'
                          : tickDir === 'UP'
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : tickDir === 'DOWN'
                              ? 'text-rose-700 dark:text-rose-300'
                              : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {loading && !q ? (
                        <span className="text-slate-500">Syncing...</span>
                      ) : q?.available && q.price !== undefined ? (
                        `${inst.currency}${q.price.toLocaleString()}`
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    <td
                      className={`py-3.5 px-4 text-right font-mono-tabular font-medium ${
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

                    <td className="py-3.5 px-4">
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

                    <td className="py-3.5 px-6 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenInTerminal(inst.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          Open Chart
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveScript(inst.id)}
                          aria-label={`Remove ${inst.symbol} from watchlist`}
                          title="Remove from watchlist"
                          className="p-1.5 text-slate-500 hover:text-rose-700 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
