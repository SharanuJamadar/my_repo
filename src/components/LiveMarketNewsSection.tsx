import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  Newspaper,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  INSTRUMENTS,
  type LiveMarketNewsResponse,
  type MarketNewsCategory,
} from '../types/trading';

interface LiveMarketNewsSectionProps {
  onOpenInTerminal: (instrumentId: string) => void;
}

const CATEGORY_TABS: { id: MarketNewsCategory; label: string }[] = [
  { id: 'ALL', label: 'All Markets' },
  { id: 'INDIAN', label: 'India (NSE / BSE)' },
  { id: 'MCX', label: 'Commodities & MCX' },
  { id: 'INTERNATIONAL', label: 'Global & Crypto' },
];

function resolveInstrumentId(assetLabel: string): string | null {
  const clean = assetLabel.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return null;
  const direct = INSTRUMENTS.find((inst) => {
    const idNorm = inst.id.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const symNorm = inst.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return idNorm === clean || symNorm === clean || clean === idNorm.replace('MCX', '');
  });
  if (direct) return direct.id;
  if (clean.includes('NIFTY') && clean.includes('BANK')) return 'BANKNIFTY';
  if (clean.includes('NIFTY')) return 'NIFTY50';
  if (clean.includes('SENSEX')) return 'SENSEX';
  if (clean.includes('GOLD') || clean === 'XAU') return 'XAUUSD';
  if (clean.includes('SILVER') || clean === 'XAG') return 'XAGUSD';
  if (clean.includes('CRUDE') || clean === 'WTI' || clean === 'OIL') return 'CRUDEOIL';
  if (clean === 'BTC' || clean === 'BITCOIN') return 'BTCUSDT';
  if (clean === 'ETH' || clean === 'ETHEREUM') return 'ETHUSDT';
  return null;
}

export const LiveMarketNewsSection: React.FC<LiveMarketNewsSectionProps> = ({
  onOpenInTerminal,
}) => {
  const [category, setCategory] = useState<MarketNewsCategory>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [newsData, setNewsData] = useState<LiveMarketNewsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLiveNews = useCallback(
    async (opts?: { forceRefresh?: boolean; cat?: MarketNewsCategory; q?: string }) => {
      const targetCategory = opts?.cat ?? category;
      const targetQuery = opts?.q ?? activeQuery;
      const forceRefresh = opts?.forceRefresh ?? false;

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          category: targetCategory,
        });
        if (targetQuery.trim()) {
          params.set('q', targetQuery.trim());
        }
        if (forceRefresh) {
          params.set('refresh', '1');
        }
        const res = await fetch(`/api/news/live?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error || `Failed to load live news (HTTP ${res.status})`);
        }
        setNewsData(json as LiveMarketNewsResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to fetch live market news');
      } finally {
        setLoading(false);
      }
    },
    [category, activeQuery]
  );

  useEffect(() => {
    void loadLiveNews();
  }, [loadLiveNews]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = searchInput.trim();
    if (cleaned === activeQuery) {
      void loadLiveNews({ forceRefresh: true, q: cleaned });
    } else {
      setActiveQuery(cleaned);
    }
  };

  return (
    <section className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
      {/* Header & Controls */}
      <div className="px-6 py-5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Newspaper className="w-4 h-4 text-[#C9A24D] shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-white tracking-tight">
              Live Market News
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Real-time breaking catalysts affecting indices, gold, crude oil, and global markets via Google Search
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {newsData?.fetchedAt && (
            <span className="text-[11px] text-slate-500 font-mono-tabular whitespace-nowrap">
              Updated {new Date(newsData.fetchedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadLiveNews({ forceRefresh: true })}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Updating...' : 'Refresh Live'}</span>
          </button>
        </div>
      </div>

      {/* Category Tabs + Search Filter */}
      <div className="px-6 py-3.5 border-b border-white/[0.06] bg-[#0C0F14]/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#090B0E] border border-white/[0.06] rounded-lg">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategory(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                category === tab.id
                  ? 'bg-[#161A22] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 max-w-md min-w-[240px]">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter news (e.g. Gold Fed, RBI Nifty, OPEC)"
              className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#C9A24D]"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            Search
          </button>
          {activeQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setActiveQuery('');
              }}
              className="text-xs text-slate-400 hover:text-white whitespace-nowrap shrink-0"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Macro Market Brief */}
      {newsData?.marketBrief && !error && (
        <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0C0F14]/40">
          <div className="text-[11px] font-medium text-[#C9A24D] mb-1">Session Macro Summary</div>
          <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">{newsData.marketBrief}</p>
        </div>
      )}

      {/* Body States: Loading / Error / Empty / Populated */}
      {loading && !newsData ? (
        <div className="divide-y divide-white/[0.06]">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="px-6 py-4 space-y-2 animate-pulse">
              <div className="h-3 w-48 bg-white/[0.06] rounded" />
              <div className="h-4 w-3/4 bg-white/[0.08] rounded" />
              <div className="h-3 w-2/3 bg-white/[0.05] rounded" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="px-6 py-8 text-center space-y-3">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <div>
            <button
              type="button"
              onClick={() => void loadLiveNews({ forceRefresh: true })}
              className="px-4 py-2 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-white rounded-lg transition-colors"
            >
              Retry Live Search
            </button>
          </div>
        </div>
      ) : !newsData || newsData.items.length === 0 ? (
        <div className="px-6 py-8 text-center space-y-2">
          <p className="text-xs font-medium text-slate-300">No live headlines matched this filter.</p>
          <p className="text-[11px] text-slate-500">
            Try switching market categories or clearing your search query.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {newsData.items.map((item, idx) => {
            const impactColor =
              item.impactDirection === 'BULLISH'
                ? 'text-emerald-400'
                : item.impactDirection === 'BEARISH'
                  ? 'text-red-400'
                  : item.impactDirection === 'VOLATILE'
                    ? 'text-amber-400'
                    : 'text-slate-400';

            return (
              <article
                key={`${item.headline.slice(0, 32)}-${idx}`}
                className="px-6 py-4 hover:bg-white/[0.02] transition-colors flex flex-col gap-2"
              >
                {/* Unboxed metadata row with typographic separators */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-300">{item.marketScope}</span>
                    <span aria-hidden="true">·</span>
                    <span className={`font-semibold ${impactColor}`}>
                      {item.impactDirection} ({item.impactLevel})
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{item.sourceName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular text-slate-500">{item.publishedTime}</span>
                  </div>

                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>Read Source</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {/* Headline & Impact */}
                <h3 className="text-sm font-semibold text-white leading-snug">{item.headline}</h3>
                {item.summary && (
                  <p className="text-xs text-slate-400 leading-relaxed max-w-4xl">{item.summary}</p>
                )}

                {/* Affected Asset Terminal Shortcuts */}
                {item.affectedAssets.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-[11px] text-slate-500">Affected Charts:</span>
                    {item.affectedAssets.map((asset) => {
                      const instId = resolveInstrumentId(asset);
                      if (instId) {
                        return (
                          <button
                            key={asset}
                            type="button"
                            onClick={() => onOpenInTerminal(instId)}
                            className="inline-flex items-center gap-1 text-[11px] font-mono-tabular font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-4 transition-colors whitespace-nowrap"
                          >
                            <span>{asset}</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        );
                      }
                      return (
                        <span
                          key={asset}
                          className="text-[11px] font-mono-tabular text-slate-400"
                        >
                          {asset}
                        </span>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Grounded Google Search Sources Footer */}
      {newsData && newsData.groundingSources.length > 0 && (
        <div className="px-6 py-3.5 border-t border-white/[0.06] bg-[#0C0F14]/60 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
          <span className="text-slate-500 font-medium whitespace-nowrap">
            Verified Google Search Sources:
          </span>
          {newsData.groundingSources.slice(0, 6).map((src, idx) => (
            <a
              key={`${src.uri}-${idx}`}
              href={src.uri}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className="inline-flex items-center gap-1 text-slate-400 hover:text-[#C9A24D] transition-colors truncate max-w-[220px]"
            >
              <span className="truncate">{src.title}</span>
              <ExternalLink className="w-2.5 h-2.5 shrink-0" />
            </a>
          ))}
        </div>
      )}
    </section>
  );
};
