import React, { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import {
  INSTRUMENTS,
  type MarketQuoteResponse,
  type MarketSegment,
} from '../types/trading';

interface WatchlistViewProps {
  selectedInstrumentId: string;
  onSelectInstrument: (id: string) => void;
  activeInstrumentIds: string[];
}

export const WatchlistView: React.FC<WatchlistViewProps> = ({
  selectedInstrumentId,
  onSelectInstrument,
  activeInstrumentIds,
}) => {
  const [segment, setSegment] = useState<'ALL' | MarketSegment>('ALL');
  const [quotes, setQuotes] = useState<Record<string, MarketQuoteResponse>>({});
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadWatchlist = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market/watchlist?timeframe=15m`);
      if (!res.ok) return;
      const json = await res.json();
      const map: Record<string, MarketQuoteResponse> = {};
      for (const item of json.items || []) {
        map[item.instrument.id] = item;
      }
      setQuotes(map);
      setLastUpdated(json.fetchedAt || new Date().toISOString());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlist();
  }, []);

  const sections: { title: string; seg: MarketSegment; subtitle: string }[] = [
    {
      title: 'Indian Markets',
      seg: 'INDIAN',
      subtitle: 'NSE & BSE Index Spots with ATM / Near-ATM CE & PE focus',
    },
    {
      title: 'MCX Commodities',
      seg: 'MCX',
      subtitle: 'Metals & Energy (EMA 9 priority applied on Crude Oil)',
    },
    {
      title: 'International Markets',
      seg: 'INTERNATIONAL',
      subtitle: 'Global Precious Metals, WTI Crude, and Crypto Perpetuals',
    },
  ];

  const visibleSections =
    segment === 'ALL' ? sections : sections.filter((s) => s.seg === segment);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Market Watchlist</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {lastUpdated
              ? `15m Multi-Market Snapshot · Synced ${new Date(lastUpdated).toLocaleTimeString()}`
              : 'Loading live multi-market quotes...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[#11141A] border border-white/[0.08] rounded-lg p-1">
            {(['ALL', 'INDIAN', 'MCX', 'INTERNATIONAL'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSegment(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  segment === tab
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
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
            onClick={loadWatchlist}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Quotes
          </button>
        </div>
      </div>

      {visibleSections.map((sec) => {
        const items = INSTRUMENTS.filter(
          (i) => i.segment === sec.seg && (activeInstrumentIds.length === 0 || activeInstrumentIds.includes(i.id))
        );
        return (
          <div
            key={sec.seg}
            className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white">{sec.title}</h3>
                <p className="text-xs text-slate-400">{sec.subtitle}</p>
              </div>
              <span className="text-xs text-slate-400 font-mono-tabular">
                {items.length} Instruments
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[11px] text-slate-400">
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
                <tbody className="divide-y divide-white/[0.06] text-xs">
                  {items.map((inst) => {
                    const q = quotes[inst.id];
                    const isSelected = inst.id === selectedInstrumentId;
                    const pos = (q?.changePercent ?? 0) >= 0;
                    const atmStrike =
                      q?.available && q.price && inst.strikeStep
                        ? Math.round(q.price / inst.strikeStep) * inst.strikeStep
                        : null;

                    return (
                      <tr
                        key={inst.id}
                        className={`hover:bg-white/[0.03] transition-colors ${
                          isSelected ? 'bg-emerald-500/[0.04]' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{inst.symbol}</div>
                          <div className="text-[11px] text-slate-400">
                            {inst.name} · {inst.exchangeLabel}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-white">
                          {loading && !q ? (
                            <span className="text-slate-500">Loading...</span>
                          ) : q?.available && q.price !== undefined ? (
                            `${inst.currency}${q.price.toLocaleString()}`
                          ) : (
                            <span className="text-amber-400">DATA UNAVAILABLE</span>
                          )}
                        </td>

                        <td
                          className={`py-3 px-4 text-right font-mono-tabular font-medium ${
                            !q?.available
                              ? 'text-slate-500'
                              : pos
                                ? 'text-emerald-400'
                                : 'text-red-400'
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
                                  ? 'text-emerald-400'
                                  : q.technicals.trendBias === 'BEARISH'
                                    ? 'text-red-400'
                                    : 'text-amber-300'
                              }`}
                            >
                              {q.technicals.trendBias}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right font-mono-tabular text-slate-300">
                          {q?.available && q.technicals?.rsi !== null && q.technicals?.rsi !== undefined
                            ? q.technicals.rsi.toFixed(1)
                            : '—'}
                        </td>

                        <td className="py-3 px-4 text-slate-300">
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

                        <td className="py-3 px-4 text-[11px] text-slate-400">
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
                            onClick={() => onSelectInstrument(inst.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
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
