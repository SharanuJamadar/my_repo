import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  INSTRUMENTS,
  type DemoWalletState,
  type InstrumentMeta,
  type MarketQuoteResponse,
  type TradeJournalEntry,
  type TradeMode,
} from '../types/trading';

interface TradeJournalViewProps {
  trades: TradeJournalEntry[];
  wallet: DemoWalletState;
  onCreateTrade: (
    entry: Omit<TradeJournalEntry, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onCloseTrade: (
    tradeId: string,
    params: { exitPrice: number; pnl: number; result: 'WIN' | 'LOSS' | 'BREAKEVEN'; screenshotNote?: string }
  ) => Promise<void>;
  onDeleteTrade: (tradeId: string) => Promise<void>;
}

interface LiveFeedPoint {
  price: number;
  changePercent: number;
  marketTimestamp: string;
  currency: '₹' | '$';
}

function normalizeName(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function findInstrumentMeta(instrumentLabel: string): InstrumentMeta | undefined {
  const target = normalizeName(instrumentLabel);
  return INSTRUMENTS.find(
    (inst) =>
      normalizeName(inst.id) === target ||
      normalizeName(inst.symbol) === target ||
      target.includes(normalizeName(inst.id)) ||
      normalizeName(inst.symbol).includes(target)
  );
}

function formatNumber(val: number, decimals = 2): string {
  return val.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const TradeJournalView: React.FC<TradeJournalViewProps> = ({
  trades,
  wallet,
  onCreateTrade,
  onCloseTrade,
  onDeleteTrade,
}) => {
  const [modeFilter, setModeFilter] = useState<'ALL' | TradeMode>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [closingTrade, setClosingTrade] = useState<TradeJournalEntry | null>(null);
  const [closeExitPrice, setCloseExitPrice] = useState('');
  const [closeNote, setCloseNote] = useState('');

  // Live price map keyed by InstrumentMeta.id + optional manual LTP overrides for option-premium entries
  const [liveFeedMap, setLiveFeedMap] = useState<Record<string, LiveFeedPoint>>({});
  const [manualLtpMap, setManualLtpMap] = useState<Record<string, string>>({});
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [lastPriceSyncAt, setLastPriceSyncAt] = useState<string | null>(null);

  // New trade form state
  const [newInstrument, setNewInstrument] = useState('NIFTY 50');
  const [newContract, setNewContract] = useState('NIFTY 50 Spot / Intraday');
  const [newDirection, setNewDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [newMode, setNewMode] = useState<TradeMode>('PAPER');
  const [newEntry, setNewEntry] = useState('');
  const [newSl, setNewSl] = useState('');
  const [newT1, setNewT1] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newNotes, setNewNotes] = useState('15m trend aligned + 5m breakout confirmation');

  // Identify unique instrument IDs needed for OPEN trades
  const openInstrumentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of trades) {
      if (t.status !== 'OPEN') continue;
      const meta = findInstrumentMeta(t.instrument);
      if (meta) ids.add(meta.id);
    }
    return Array.from(ids);
  }, [trades]);

  // Initial full watchlist load for quick live prices across all markets
  const fetchWatchlistPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/market/watchlist?timeframe=5m');
      if (!res.ok) return;
      const data = await res.json();
      const items = (data?.items || []) as MarketQuoteResponse[];
      const next: Record<string, LiveFeedPoint> = {};
      for (const item of items) {
        if (item.available && typeof item.price === 'number') {
          next[item.instrument.id] = {
            price: item.price,
            changePercent: item.changePercent ?? 0,
            marketTimestamp: item.marketTimestamp,
            currency: item.instrument.currency,
          };
        }
      }
      if (Object.keys(next).length > 0) {
        setLiveFeedMap((prev) => ({ ...prev, ...next }));
        setLastPriceSyncAt(new Date().toISOString());
      }
    } catch {
      // Preserve last verified feed points
    }
  }, []);

  // Fast 4-second live quote refresh strictly for instruments with OPEN trades
  const refreshOpenTradeQuotes = useCallback(
    async (silent = true) => {
      if (openInstrumentIds.length === 0) return;
      if (!silent) setSyncingPrices(true);
      try {
        const results = await Promise.all(
          openInstrumentIds.map(async (instId) => {
            try {
              const res = await fetch(`/api/market/quote?instrument=${instId}&timeframe=5m`);
              if (!res.ok) return null;
              return (await res.json()) as MarketQuoteResponse;
            } catch {
              return null;
            }
          })
        );

        const updates: Record<string, LiveFeedPoint> = {};
        for (const q of results) {
          if (q && q.available && typeof q.price === 'number') {
            updates[q.instrument.id] = {
              price: q.price,
              changePercent: q.changePercent ?? 0,
              marketTimestamp: q.marketTimestamp,
              currency: q.instrument.currency,
            };
          }
        }
        if (Object.keys(updates).length > 0) {
          setLiveFeedMap((prev) => ({ ...prev, ...updates }));
          setLastPriceSyncAt(new Date().toISOString());
        }
      } finally {
        if (!silent) setSyncingPrices(false);
      }
    },
    [openInstrumentIds]
  );

  useEffect(() => {
    fetchWatchlistPrices();
  }, [fetchWatchlistPrices]);

  useEffect(() => {
    if (openInstrumentIds.length === 0) return;
    refreshOpenTradeQuotes(true);
    const timer = window.setInterval(() => {
      refreshOpenTradeQuotes(true);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [openInstrumentIds, refreshOpenTradeQuotes]);

  // Compute live mark-to-market snapshot for every trade
  const enrichedTrades = useMemo(() => {
    return trades.map((t) => {
      const meta = findInstrumentMeta(t.instrument);
      const feed = meta ? liveFeedMap[meta.id] : undefined;
      const currency = meta?.currency || '₹';

      // Check if live feed price is on the same underlying scale (spot/futures/crypto)
      const spotOnScale =
        feed && Math.abs(feed.price - t.entryPrice) / Math.max(t.entryPrice, 1) <= 0.45;
      const manualVal = manualLtpMap[t.id] ? Number(manualLtpMap[t.id]) : NaN;
      const hasManualLtp = Number.isFinite(manualVal) && manualVal > 0;

      const livePrice =
        t.status === 'OPEN'
          ? hasManualLtp
            ? manualVal
            : spotOnScale
              ? feed.price
              : null
          : t.exitPrice ?? null;

      const priceDiff =
        livePrice !== null
          ? t.direction === 'BUY'
            ? livePrice - t.entryPrice
            : t.entryPrice - livePrice
          : null;

      const effectivePnl =
        t.status === 'CLOSED'
          ? t.pnl
          : priceDiff !== null
            ? Number((priceDiff * t.quantity).toFixed(2))
            : null;

      const roiPct =
        priceDiff !== null && t.entryPrice > 0
          ? Number(((priceDiff / t.entryPrice) * 100).toFixed(2))
          : null;

      const initialRisk = Math.abs(t.entryPrice - t.stopLoss);
      const liveRMultiple =
        priceDiff !== null && initialRisk > 0 ? Number((priceDiff / initialRisk).toFixed(2)) : null;

      // Target vs SL progress bar [0..100]
      let targetProgressPct: number | null = null;
      if (livePrice !== null && t.target1 > 0 && t.stopLoss > 0 && t.target1 !== t.stopLoss) {
        const raw =
          t.direction === 'BUY'
            ? ((livePrice - t.stopLoss) / (t.target1 - t.stopLoss)) * 100
            : ((t.stopLoss - livePrice) / (t.stopLoss - t.target1)) * 100;
        targetProgressPct = Math.max(0, Math.min(100, raw));
      }

      const deployedCapital = t.entryPrice * t.quantity;

      return {
        trade: t,
        currency,
        underlyingSpot: feed?.price ?? null,
        underlyingChangePct: feed?.changePercent ?? null,
        spotOnScale: Boolean(spotOnScale),
        livePrice,
        effectivePnl,
        roiPct,
        liveRMultiple,
        targetProgressPct,
        deployedCapital,
      };
    });
  }, [trades, liveFeedMap, manualLtpMap]);

  const filteredTrades = useMemo(() => {
    return enrichedTrades.filter(({ trade: t }) => {
      if (modeFilter !== 'ALL' && t.executionMode !== modeFilter) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (
        search.trim() &&
        !`${t.instrument} ${t.contract}`.toLowerCase().includes(search.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [enrichedTrades, modeFilter, statusFilter, search]);

  // Real-time Portfolio Equity + All Live Running Ratios
  const stats = useMemo(() => {
    const scope = enrichedTrades.filter(
      ({ trade: t }) => modeFilter === 'ALL' || t.executionMode === modeFilter
    );
    const closed = scope.filter(({ trade: t }) => t.status === 'CLOSED');
    const open = scope.filter(({ trade: t }) => t.status === 'OPEN');

    const realizedNetPnl = closed.reduce((acc, item) => acc + item.trade.pnl, 0);
    const liveOpenPnl = open.reduce((acc, item) => acc + (item.effectivePnl ?? 0), 0);
    const combinedPnl = realizedNetPnl + liveOpenPnl;

    const deployedMargin = open.reduce((acc, item) => acc + item.deployedCapital, 0);
    const totalLiveEquity = wallet.balance + combinedPnl;
    const freeMargin = totalLiveEquity - deployedMargin;
    const marginUtilizationPct =
      totalLiveEquity > 0 ? Math.max(0, (deployedMargin / totalLiveEquity) * 100) : 0;

    const portfolioRoiPct = wallet.balance > 0 ? (combinedPnl / wallet.balance) * 100 : 0;
    const openRoiPct = deployedMargin > 0 ? (liveOpenPnl / deployedMargin) * 100 : 0;

    // Closed-only metrics
    const closedWins = closed.filter(({ trade: t }) => t.result === 'WIN');
    const closedLosses = closed.filter(({ trade: t }) => t.result === 'LOSS');
    const closedWinRate = closed.length > 0 ? (closedWins.length / closed.length) * 100 : 0;

    // Live running metrics (Closed + Priced Open trades)
    const pricedOpen = open.filter((item) => item.effectivePnl !== null);
    const openInProfit = pricedOpen.filter((item) => (item.effectivePnl ?? 0) > 0);
    const openInLoss = pricedOpen.filter((item) => (item.effectivePnl ?? 0) < 0);

    const liveTotalCount = closed.length + pricedOpen.length;
    const liveWinCount = closedWins.length + openInProfit.length;
    const liveWinRate = liveTotalCount > 0 ? (liveWinCount / liveTotalCount) * 100 : 0;

    const closedGrossProfit = closedWins.reduce((acc, x) => acc + Math.max(0, x.trade.pnl), 0);
    const closedGrossLoss = closedLosses.reduce(
      (acc, x) => acc + Math.abs(Math.min(0, x.trade.pnl)),
      0
    );
    const openGrossProfit = openInProfit.reduce(
      (acc, x) => acc + Math.max(0, x.effectivePnl ?? 0),
      0
    );
    const openGrossLoss = openInLoss.reduce(
      (acc, x) => acc + Math.abs(Math.min(0, x.effectivePnl ?? 0)),
      0
    );

    const totalGrossProfit = closedGrossProfit + openGrossProfit;
    const totalGrossLoss = closedGrossLoss + openGrossLoss;
    const liveProfitFactor =
      totalGrossLoss > 0
        ? totalGrossProfit / totalGrossLoss
        : totalGrossProfit > 0
          ? totalGrossProfit
          : 0;

    const avgWin =
      liveWinCount > 0 ? totalGrossProfit / liveWinCount : 0;
    const totalLossCount = closedLosses.length + openInLoss.length;
    const avgLoss =
      totalLossCount > 0 ? totalGrossLoss / totalLossCount : 0;
    const winLossPayoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? avgWin : 0;

    // Average running R-Multiple across open trades
    const rMultiples = open
      .map((x) => x.liveRMultiple)
      .filter((r): r is number => r !== null);
    const avgLiveR =
      rMultiples.length > 0
        ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
        : null;

    // Max drawdown over closed equity curve + current unrealized equity point
    const chronological = [...closed].reverse();
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const item of chronological) {
      equity += item.trade.pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    const currentCurvePoint = equity + liveOpenPnl;
    if (currentCurvePoint > peak) peak = currentCurvePoint;
    if (peak - currentCurvePoint > maxDrawdown) {
      maxDrawdown = peak - currentCurvePoint;
    }

    const openBuyCount = open.filter((x) => x.trade.direction === 'BUY').length;
    const openSellCount = open.filter((x) => x.trade.direction === 'SELL').length;

    return {
      openCount: open.length,
      closedCount: closed.length,
      realizedNetPnl,
      liveOpenPnl,
      combinedPnl,
      deployedMargin,
      totalLiveEquity,
      freeMargin,
      marginUtilizationPct,
      portfolioRoiPct,
      openRoiPct,
      closedWinRate,
      liveWinRate,
      openInProfitCount: openInProfit.length,
      pricedOpenCount: pricedOpen.length,
      liveProfitFactor,
      winLossPayoffRatio,
      avgWin,
      avgLoss,
      avgLiveR,
      maxDrawdown,
      openBuyCount,
      openSellCount,
    };
  }, [enrichedTrades, modeFilter, wallet.balance]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entry = Number(newEntry);
    const sl = Number(newSl);
    const t1 = Number(newT1);
    const qty = Math.max(1, Number(newQty));
    if (!entry || entry <= 0) return;

    const risk = Math.abs(entry - sl);
    const reward = Math.abs(t1 - entry);
    const rr = risk > 0 ? `1:${(reward / risk).toFixed(2)}` : '1:2';

    await onCreateTrade({
      instrument: newInstrument,
      contract: newContract.trim() || newInstrument,
      direction: newDirection,
      executionMode: newMode,
      entryPrice: entry,
      stopLoss: sl,
      target1: t1,
      quantity: qty,
      status: 'OPEN',
      result: 'OPEN',
      pnl: 0,
      riskReward: rr,
      strategyConfirmation: newNotes.trim() || 'SHARAN manual log',
    });

    setShowAddModal(false);
    setNewEntry('');
    setNewSl('');
    setNewT1('');
  };

  const handleCloseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingTrade) return;
    const exitPrice = Number(closeExitPrice);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) return;

    const diff =
      closingTrade.direction === 'BUY'
        ? exitPrice - closingTrade.entryPrice
        : closingTrade.entryPrice - exitPrice;
    const pnl = Number((diff * closingTrade.quantity).toFixed(2));
    const result: 'WIN' | 'LOSS' | 'BREAKEVEN' =
      pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN';

    await onCloseTrade(closingTrade.id, {
      exitPrice,
      pnl,
      result,
      screenshotNote: closeNote.trim() || undefined,
    });

    setClosingTrade(null);
    setCloseExitPrice('');
    setCloseNote('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">
            Live P&amp;L &amp; Trade Journal
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time mark-to-market P&amp;L, running risk ratios, and closed trade history
            {lastPriceSyncAt ? ` · Feed updated ${new Date(lastPriceSyncAt).toLocaleTimeString()}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              fetchWatchlistPrices();
              refreshOpenTradeQuotes(false);
            }}
            disabled={syncingPrices}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingPrices ? 'animate-spin' : ''}`} />
            Sync Live P&L
          </button>

          <button
            type="button"
            onClick={() => {
              const meta = findInstrumentMeta(newInstrument);
              const live = meta ? liveFeedMap[meta.id] : undefined;
              if (live && !newEntry) {
                setNewEntry(String(live.price));
              }
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Log Trade Entry
          </button>
        </div>
      </div>

      {/* Live P&L & All Running Performance Ratios */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          {
            label: 'Live Open P&L',
            value: `${stats.liveOpenPnl >= 0 ? '+' : ''}${formatNumber(stats.liveOpenPnl, 2)}`,
            sub: `${stats.openRoiPct >= 0 ? '+' : ''}${stats.openRoiPct.toFixed(2)}% on margin`,
            tone: stats.liveOpenPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
          },
          {
            label: 'Realized P&L',
            value: `${stats.realizedNetPnl >= 0 ? '+' : ''}${formatNumber(stats.realizedNetPnl, 2)}`,
            sub: `${stats.closedCount} closed trades`,
            tone: stats.realizedNetPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
          },
          {
            label: 'Portfolio ROI',
            value: `${stats.portfolioRoiPct >= 0 ? '+' : ''}${stats.portfolioRoiPct.toFixed(2)}%`,
            sub: 'Live + Realized / Wallet',
            tone: stats.portfolioRoiPct >= 0 ? 'text-emerald-400' : 'text-red-400',
          },
          {
            label: 'Live Win Rate',
            value: `${stats.liveWinRate.toFixed(1)}%`,
            sub: `Closed: ${stats.closedWinRate.toFixed(1)}% · Run: ${stats.openInProfitCount}/${stats.pricedOpenCount}`,
            tone: stats.liveWinRate >= 50 ? 'text-emerald-400' : 'text-white',
          },
          {
            label: 'Live Profit Factor',
            value: stats.liveProfitFactor.toFixed(2),
            sub: `Payoff ${stats.winLossPayoffRatio.toFixed(2)}x`,
            tone: stats.liveProfitFactor >= 1.5 ? 'text-emerald-400' : 'text-white',
          },
          {
            label: 'Running Avg R',
            value:
              stats.avgLiveR !== null
                ? `${stats.avgLiveR >= 0 ? '+' : ''}${stats.avgLiveR.toFixed(2)}R`
                : '—',
            sub: 'Live open R-multiple',
            tone:
              stats.avgLiveR === null
                ? 'text-slate-400'
                : stats.avgLiveR >= 0
                  ? 'text-emerald-400'
                  : 'text-red-400',
          },
          {
            label: 'Long / Short',
            value: `${stats.openBuyCount} / ${stats.openSellCount}`,
            sub: `${stats.marginUtilizationPct.toFixed(1)}% margin used`,
            tone: 'text-sky-300',
          },
          {
            label: 'Max Drawdown',
            value: `-${formatNumber(stats.maxDrawdown, 2)}`,
            sub: `Avg W/L: +${formatNumber(stats.avgWin, 0)} / -${formatNumber(stats.avgLoss, 0)}`,
            tone: 'text-amber-300',
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-[#11141A] border border-white/[0.08] rounded-xl p-3.5"
          >
            <div className="text-[11px] text-slate-400">{kpi.label}</div>
            <div className={`font-mono-tabular text-lg font-semibold mt-1 ${kpi.tone}`}>
              {kpi.value}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate font-mono-tabular">
              {kpi.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[#11141A] border border-white/[0.08] rounded-lg p-1">
            {(['ALL', 'PAPER', 'LIVE'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModeFilter(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  modeFilter === m ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'ALL' ? 'All Modes' : `${m} Trades`}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-[#11141A] border border-white/[0.08] rounded-lg p-1">
            {(['ALL', 'OPEN', 'CLOSED'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === s ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter instrument or contract..."
          className="bg-[#11141A] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-64"
        />
      </div>

      {/* Trade Table with Real-Time Running P&L and Live Ratios */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
        {filteredTrades.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <div className="text-sm font-medium text-white">No recorded trades match this filter</div>
            <p className="text-xs text-slate-400">
              Log a paper trade from any generated signal or click Log Trade Entry above to track live P&L.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Instrument / Contract</th>
                  <th className="py-2.5 px-4 font-medium">Mode · Side</th>
                  <th className="py-2.5 px-4 font-medium text-right">Entry</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live LTP / Exit</th>
                  <th className="py-2.5 px-4 font-medium text-right">SL / T1</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live / Closed P&L</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live R · ROI %</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
                {filteredTrades.map(
                  ({
                    trade: t,
                    currency,
                    underlyingSpot,
                    spotOnScale,
                    livePrice,
                    effectivePnl,
                    roiPct,
                    liveRMultiple,
                    targetProgressPct,
                  }) => (
                    <tr key={t.id} className="hover:bg-white/[0.03]">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">{t.instrument}</div>
                        <div className="text-[11px] text-slate-400 font-mono-tabular">
                          {t.contract} · Qty {t.quantity}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium">
                          <span
                            className={
                              t.executionMode === 'LIVE' ? 'text-amber-300' : 'text-sky-300'
                            }
                          >
                            {t.executionMode}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span
                            className={
                              t.direction === 'BUY' ? 'text-emerald-400' : 'text-red-400'
                            }
                          >
                            {t.direction}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-white">
                        {currency}
                        {t.entryPrice}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular">
                        {t.status === 'CLOSED' ? (
                          <span className="text-slate-200">
                            {currency}
                            {t.exitPrice ?? '—'}
                          </span>
                        ) : spotOnScale && livePrice !== null ? (
                          <div>
                            <div className="text-white font-semibold">
                              {currency}
                              {livePrice.toLocaleString()}
                            </div>
                            <div className="text-[10px] text-emerald-400">Live Tick</div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <input
                              type="number"
                              step="any"
                              value={manualLtpMap[t.id] ?? ''}
                              onChange={(e) =>
                                setManualLtpMap((prev) => ({
                                  ...prev,
                                  [t.id]: e.target.value,
                                }))
                              }
                              placeholder="Option LTP"
                              className="w-24 bg-[#090B0E] border border-white/[0.08] rounded px-2 py-0.5 text-right text-[11px] font-mono-tabular text-white placeholder-slate-500"
                            />
                            {underlyingSpot !== null && (
                              <span className="text-[10px] text-slate-400">
                                Spot {currency}
                                {underlyingSpot.toLocaleString()}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-slate-400">
                        <div>
                          {t.stopLoss} / {t.target1}
                        </div>
                        {targetProgressPct !== null && t.status === 'OPEN' && (
                          <div className="w-20 ml-auto mt-1 h-1 bg-white/[0.08] rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                targetProgressPct >= 50 ? 'bg-emerald-400' : 'bg-amber-400'
                              }`}
                              style={{ width: `${targetProgressPct}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono-tabular font-semibold ${
                          effectivePnl === null
                            ? 'text-slate-400'
                            : effectivePnl >= 0
                              ? 'text-emerald-400'
                              : 'text-red-400'
                        }`}
                      >
                        {effectivePnl === null
                          ? 'Enter LTP'
                          : `${effectivePnl >= 0 ? '+' : ''}${currency}${formatNumber(
                              effectivePnl,
                              2
                            )}`}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular">
                        <div
                          className={
                            liveRMultiple === null
                              ? 'text-slate-400'
                              : liveRMultiple >= 0
                                ? 'text-emerald-400 font-medium'
                                : 'text-red-400 font-medium'
                          }
                        >
                          {liveRMultiple !== null
                            ? `${liveRMultiple >= 0 ? '+' : ''}${liveRMultiple}R`
                            : t.riskReward}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {roiPct !== null
                            ? `${roiPct >= 0 ? '+' : ''}${roiPct}% · Plan ${t.riskReward}`
                            : `Plan ${t.riskReward}`}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-medium ${
                            t.result === 'WIN'
                              ? 'text-emerald-400'
                              : t.result === 'LOSS'
                                ? 'text-red-400'
                                : t.status === 'OPEN'
                                  ? 'text-sky-300'
                                  : 'text-slate-400'
                          }`}
                        >
                          {t.status === 'OPEN' ? 'RUNNING' : t.result}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          {t.status === 'OPEN' && (
                            <button
                              type="button"
                              onClick={() => {
                                setClosingTrade(t);
                                setCloseExitPrice(
                                  String(livePrice ?? t.target1 ?? t.entryPrice)
                                );
                              }}
                              className="px-2.5 py-1 text-[11px] font-medium bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-md whitespace-nowrap"
                            >
                              {livePrice !== null ? 'Close @ Live' : 'Close Trade'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteTrade(t.id)}
                            aria-label="Delete trade entry"
                            className="p-1 text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Trade Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#11141A] border border-white/[0.1] rounded-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Log Trade Journal Entry</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddSubmit} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Instrument</label>
                  <select
                    value={newInstrument}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewInstrument(val);
                      setNewContract(`${val} Spot / Intraday`);
                      const meta = findInstrumentMeta(val);
                      const live = meta ? liveFeedMap[meta.id] : undefined;
                      if (live) {
                        setNewEntry(String(live.price));
                      }
                    }}
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
                  >
                    {INSTRUMENTS.map((i) => (
                      <option key={i.id} value={i.symbol}>
                        {i.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Contract</label>
                  <input
                    required
                    value={newContract}
                    onChange={(e) => setNewContract(e.target.value)}
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Direction</label>
                  <select
                    value={newDirection}
                    onChange={(e) => setNewDirection(e.target.value as 'BUY' | 'SELL')}
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Mode</label>
                  <select
                    value={newMode}
                    onChange={(e) => setNewMode(e.target.value as TradeMode)}
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
                  >
                    <option value="PAPER">PAPER</option>
                    <option value="LIVE">LIVE</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Entry Price</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={newEntry}
                    onChange={(e) => setNewEntry(e.target.value)}
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Stop Loss</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={newSl}
                    onChange={(e) => setNewSl(e.target.value)}
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Target 1</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={newT1}
                    onChange={(e) => setNewT1(e.target.value)}
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Strategy Confirmation</label>
                <input
                  required
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-[#161A22] border border-white/[0.08] text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close Trade Modal */}
      {closingTrade && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#11141A] border border-white/[0.1] rounded-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Close {closingTrade.instrument} ({closingTrade.contract})
              </h3>
              <button
                type="button"
                onClick={() => setClosingTrade(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCloseSubmit} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">
                  Exit Price (Entry was {closingTrade.entryPrice})
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={closeExitPrice}
                  onChange={(e) => setCloseExitPrice(e.target.value)}
                  className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Chart / Execution Note (Optional)</label>
                <input
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  placeholder="e.g. Target 1 hit cleanly on 5m volume expansion"
                  className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setClosingTrade(null)}
                  className="px-4 py-2 bg-[#161A22] border border-white/[0.08] text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg"
                >
                  Record Closed Trade
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
