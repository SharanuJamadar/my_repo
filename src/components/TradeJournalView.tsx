import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Download,
  List,
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
  type TradeTrailState,
} from '../types/trading';
import { JournalAnalyticsSection } from './JournalAnalyticsSection';
import { computeTpLadderMetrics, type TpLadderMetrics } from '../lib/tpLadderProgress';

interface TradeJournalViewProps {
  accountType: 'LIVE' | 'DEMO';
  trades: TradeJournalEntry[];
  tradeProtectionMap: Record<string, TradeTrailState>;
  wallet: DemoWalletState;
  liveBrokerBalance?: { balance: number; currency: string; serverName?: string } | null;
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
  accountType,
  trades,
  tradeProtectionMap,
  wallet,
  liveBrokerBalance,
  onCreateTrade,
  onCloseTrade,
  onDeleteTrade,
}) => {
  const lockedMode: TradeMode = accountType === 'LIVE' ? 'LIVE' : 'PAPER';
  const [viewMode, setViewMode] = useState<'LEDGER' | 'ANALYTICS'>('LEDGER');
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
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
  const [newEntry, setNewEntry] = useState('');
  const [newSl, setNewSl] = useState('');
  const [newT1, setNewT1] = useState('');
  const [newT2, setNewT2] = useState('');
  const [newT3, setNewT3] = useState('');
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

      const activeQty =
        typeof t.remainingQuantity === 'number' && t.remainingQuantity > 0
          ? t.remainingQuantity
          : t.quantity;
      const partialBooked = typeof t.partialRealizedPnl === 'number' ? t.partialRealizedPnl : 0;

      const effectivePnl =
        t.status === 'CLOSED'
          ? t.pnl
          : priceDiff !== null
            ? Number((partialBooked + priceDiff * activeQty).toFixed(2))
            : null;

      const roiPct =
        priceDiff !== null && t.entryPrice > 0
          ? Number(((priceDiff / t.entryPrice) * 100).toFixed(2))
          : null;

      const trail = tradeProtectionMap[t.id];
      const activeSl = trail ? trail.currentSl : t.stopLoss;
      const tpStage = trail?.tpStage ?? t.tpStage ?? 0;
      const tp1Val = trail?.target1 ?? t.target1;
      const tp2Val = trail?.target2 ?? t.target2;
      const tp3Val = trail?.target3 ?? t.target3;

      const ladderMetrics: TpLadderMetrics | null =
        livePrice !== null
          ? computeTpLadderMetrics({
              direction: t.direction,
              entryPrice: t.entryPrice,
              currentSl: activeSl,
              initialSl: trail?.initialSl,
              livePrice,
              target1: tp1Val,
              target2: tp2Val,
              target3: tp3Val,
              tpStage,
              riskReward: t.riskReward,
            })
          : null;

      const liveRMultiple = ladderMetrics?.liveRMultiple ?? null;

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
        ladderMetrics,
        deployedCapital,
      };
    });
  }, [trades, liveFeedMap, manualLtpMap, tradeProtectionMap]);

  const filteredTrades = useMemo(() => {
    return enrichedTrades.filter(({ trade: t }) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (
        search.trim() &&
        !`${t.instrument} ${t.contract}`.toLowerCase().includes(search.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [enrichedTrades, statusFilter, search]);

  // Real-time Portfolio Equity + All Live Running Ratios
  const stats = useMemo(() => {
    const scope = enrichedTrades;
    const closed = scope.filter(({ trade: t }) => t.status === 'CLOSED');
    const open = scope.filter(({ trade: t }) => t.status === 'OPEN');

    const realizedNetPnl = closed.reduce((acc, item) => acc + item.trade.pnl, 0);
    const liveOpenPnl = open.reduce((acc, item) => acc + (item.effectivePnl ?? 0), 0);
    const combinedPnl = realizedNetPnl + liveOpenPnl;

    const deployedMargin = open.reduce((acc, item) => acc + item.deployedCapital, 0);
    const capitalBase =
      accountType === 'LIVE' ? liveBrokerBalance?.balance ?? 0 : wallet.balance;
    const totalLiveEquity = capitalBase + combinedPnl;
    const freeMargin = totalLiveEquity - deployedMargin;
    const marginUtilizationPct =
      totalLiveEquity > 0 ? Math.max(0, (deployedMargin / totalLiveEquity) * 100) : 0;

    const portfolioRoiPct = capitalBase > 0 ? (combinedPnl / capitalBase) * 100 : 0;
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
  }, [enrichedTrades, wallet.balance, accountType, liveBrokerBalance]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entry = Number(newEntry);
    const sl = Number(newSl);
    const t1 = Number(newT1);
    const qty = Math.max(0.01, Number(newQty));
    if (!entry || entry <= 0) return;

    const risk = Math.abs(entry - sl);
    const dir = newDirection === 'BUY' ? 1 : -1;
    const t2Val = Number(newT2) > 0 ? Number(newT2) : Number((entry + dir * Math.max(risk * 1.4, Math.abs(t1 - entry) * 1.75)).toFixed(4));
    const t3Val = Number(newT3) > 0 ? Number(newT3) : Number((entry + dir * Math.max(risk * 3.5, Math.abs(t2Val - entry) * 2.2)).toFixed(4));
    const reward = Math.abs(t3Val - entry);
    const rr = risk > 0 ? `1:${(reward / risk).toFixed(2)}` : '1:3.5';

    await onCreateTrade({
      instrument: newInstrument,
      contract: newContract.trim() || newInstrument,
      direction: newDirection,
      executionMode: lockedMode,
      entryPrice: entry,
      stopLoss: sl,
      target1: t1,
      target2: t2Val,
      target3: t3Val,
      quantity: qty,
      status: 'OPEN',
      result: 'OPEN',
      pnl: 0,
      riskReward: rr,
      strategyConfirmation: newNotes.trim() || 'My Trade manual log',
    });

    setShowAddModal(false);
    setNewEntry('');
    setNewSl('');
    setNewT1('');
    setNewT2('');
    setNewT3('');
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
    const remQty =
      typeof closingTrade.remainingQuantity === 'number' && closingTrade.remainingQuantity > 0
        ? closingTrade.remainingQuantity
        : closingTrade.quantity;
    const partialBooked =
      typeof closingTrade.partialRealizedPnl === 'number' ? closingTrade.partialRealizedPnl : 0;
    const pnl = Number((partialBooked + diff * remQty).toFixed(2));
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

  const handleExportCsv = useCallback(() => {
    const csvEscape = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      'TradeID',
      'Date',
      'Instrument',
      'Contract',
      'Mode',
      'Side',
      'Quantity',
      'RemainingQty',
      'EntryPrice',
      'ExitPrice',
      'StopLoss',
      'TP1',
      'TP2',
      'TP3',
      'PartialBookedPnL',
      'NetPnL',
      'Status',
      'Result',
      'RiskReward',
      'BrokerOrderID',
      'Notes',
    ];
    const rows = trades.map((t) => {
      const dt =
        t.createdAt && typeof t.createdAt === 'object' && typeof t.createdAt.toDate === 'function'
          ? t.createdAt.toDate().toISOString()
          : String(t.createdAt || '');
      return [
        t.id,
        dt,
        t.instrument,
        t.contract,
        t.executionMode,
        t.direction,
        t.quantity,
        t.remainingQuantity ?? (t.status === 'CLOSED' ? 0 : t.quantity),
        t.entryPrice,
        t.exitPrice ?? '',
        t.stopLoss,
        t.target1,
        t.target2 ?? '',
        t.target3 ?? '',
        t.partialRealizedPnl ?? 0,
        t.pnl,
        t.status,
        t.result,
        t.riskReward,
        t.brokerOrderId ?? '',
        t.screenshotNote || t.strategyConfirmation || '',
      ]
        .map(csvEscape)
        .join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `my-trade-${accountType.toLowerCase()}-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [trades, accountType]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            {accountType === 'LIVE' ? 'Actual Account · Live Trade Journal' : 'Demo Account · Paper Trade Journal'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time P&amp;L, 3-TP stepped SL trailing progress, and isolated {accountType === 'LIVE' ? 'live broker' : 'demo paper'} ledger
            {lastPriceSyncAt ? ` · Feed updated ${new Date(lastPriceSyncAt).toLocaleTimeString()}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('LEDGER')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'LEDGER'
                  ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Trade Ledger
            </button>
            <button
              type="button"
              onClick={() => setViewMode('ANALYTICS')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'ANALYTICS'
                  ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Calendar &amp; Edge
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>

          <button
            type="button"
            onClick={() => {
              fetchWatchlistPrices();
              refreshOpenTradeQuotes(false);
            }}
            disabled={syncingPrices}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
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
            tone: stats.liveOpenPnl >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
          },
          {
            label: 'Realized P&L',
            value: `${stats.realizedNetPnl >= 0 ? '+' : ''}${formatNumber(stats.realizedNetPnl, 2)}`,
            sub: `${stats.closedCount} closed trades`,
            tone: stats.realizedNetPnl >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
          },
          {
            label: 'Portfolio ROI',
            value: `${stats.portfolioRoiPct >= 0 ? '+' : ''}${stats.portfolioRoiPct.toFixed(2)}%`,
            sub: 'Live + Realized / Wallet',
            tone: stats.portfolioRoiPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
          },
          {
            label: 'Live Win Rate',
            value: `${stats.liveWinRate.toFixed(1)}%`,
            sub: `Closed: ${stats.closedWinRate.toFixed(1)}% · Run: ${stats.openInProfitCount}/${stats.pricedOpenCount}`,
            tone: stats.liveWinRate >= 50 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-white',
          },
          {
            label: 'Live Profit Factor',
            value: stats.liveProfitFactor.toFixed(2),
            sub: `Payoff ${stats.winLossPayoffRatio.toFixed(2)}x`,
            tone: stats.liveProfitFactor >= 1.5 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-white',
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
                ? 'text-slate-500 dark:text-slate-400'
                : stats.avgLiveR >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400',
          },
          {
            label: 'Long / Short',
            value: `${stats.openBuyCount} / ${stats.openSellCount}`,
            sub: `${stats.marginUtilizationPct.toFixed(1)}% margin used`,
            tone: 'text-blue-700 dark:text-sky-300',
          },
          {
            label: 'Max Drawdown',
            value: `-${formatNumber(stats.maxDrawdown, 2)}`,
            sub: `Avg W/L: +${formatNumber(stats.avgWin, 0)} / -${formatNumber(stats.avgLoss, 0)}`,
            tone: 'text-amber-700 dark:text-amber-300',
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5"
          >
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{kpi.label}</div>
            <div className={`font-mono-tabular text-lg font-semibold mt-1 ${kpi.tone}`}>
              {kpi.value}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate font-mono-tabular">
              {kpi.sub}
            </div>
          </div>
        ))}
      </div>

      {viewMode === 'ANALYTICS' ? (
        <JournalAnalyticsSection trades={trades} onExportCsv={handleExportCsv} />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-1">
                {(['ALL', 'OPEN', 'CLOSED'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      statusFilter === s ? 'bg-blue-700 dark:bg-slate-800 text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Ledger Isolation:{' '}
                <strong className={accountType === 'LIVE' ? 'text-blue-700 dark:text-sky-400' : 'text-emerald-700 dark:text-emerald-400'}>
                  {accountType === 'LIVE' ? 'LIVE ONLY' : 'DEMO PAPER ONLY'}
                </strong>
              </span>
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter instrument or contract..."
              className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-64"
            />
          </div>

          {/* Trade Table with Real-Time Running P&L, Partial Booking & Execution Audit Timeline */}
          <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {filteredTrades.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <div className="text-sm font-medium text-slate-900 dark:text-white">No recorded trades match this filter</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Log a paper trade from any generated signal or click Log Trade Entry above to track live P&L.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Instrument / Contract</th>
                  <th className="py-2.5 px-4 font-medium">Mode · Side</th>
                  <th className="py-2.5 px-4 font-medium text-right">Entry</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live LTP / Exit</th>
                  <th className="py-2.5 px-4 font-medium text-right">Active SL · 3-TP Ladder</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live / Closed P&L</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live R · ROI %</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
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
                    ladderMetrics,
                  }) => {
                    const isExpanded = expandedTradeId === t.id;
                    const remQty =
                      typeof t.remainingQuantity === 'number' ? t.remainingQuantity : t.quantity;
                    const hasPartial =
                      typeof t.partialRealizedPnl === 'number' && t.partialRealizedPnl !== 0;
                    return (
                    <React.Fragment key={t.id}>
                    <tr className="hover:bg-slate-100 dark:hover:bg-white/[0.06]">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => setExpandedTradeId(isExpanded ? null : t.id)}
                          className="flex items-start gap-1.5 text-left group"
                          title="Toggle execution audit timeline"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 mt-0.5 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-white shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-white shrink-0" />
                          )}
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white">{t.instrument}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                              {t.contract} · Qty {t.quantity}
                              {t.status === 'OPEN' && remQty < t.quantity ? ` (Rem ${remQty})` : ''}
                            </div>
                            {hasPartial && (
                              <div className="text-[10px] font-mono-tabular text-emerald-700 dark:text-emerald-400">
                                Partial Booked: +{currency}{formatNumber(t.partialRealizedPnl!, 2)}
                              </div>
                            )}
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium">
                          <span
                            className={
                              t.executionMode === 'LIVE' ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-sky-300'
                            }
                          >
                            {t.executionMode}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span
                            className={
                              t.direction === 'BUY' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                            }
                          >
                            {t.direction}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-slate-900 dark:text-white">
                        {currency}
                        {t.entryPrice}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular">
                        {t.status === 'CLOSED' ? (
                          <span className="text-slate-800 dark:text-slate-200">
                            {currency}
                            {t.exitPrice ?? '—'}
                          </span>
                        ) : spotOnScale && livePrice !== null ? (
                          <div>
                            <div className="text-slate-900 dark:text-white font-semibold">
                              {currency}
                              {livePrice.toLocaleString()}
                            </div>
                            <div className="text-[10px] text-emerald-700 dark:text-emerald-400">Live Tick</div>
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
                              className="w-24 bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded px-2 py-0.5 text-right text-[11px] font-mono-tabular text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500"
                            />
                            {underlyingSpot !== null && (
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                Spot {currency}
                                {underlyingSpot.toLocaleString()}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular">
                        {(() => {
                          const trail = tradeProtectionMap[t.id];
                          const activeSl = trail ? Number(trail.currentSl.toFixed(4)) : t.stopLoss;
                          const tpStage = trail?.tpStage ?? t.tpStage ?? 0;
                          const tp1Val = trail?.target1 ?? t.target1;
                          const tp2Val = trail?.target2 ?? t.target2;
                          const tp3Val = trail?.target3 ?? t.target3;
                          const isClosedTp3 =
                            t.status === 'CLOSED' && t.result === 'WIN' && tpStage === 2;
                          return (
                            <div className="space-y-1.5 min-w-[168px]">
                              <div
                                className={
                                  tpStage > 0
                                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                    : 'text-rose-700 dark:text-rose-300'
                                }
                              >
                                SL {activeSl}
                                {tpStage === 1
                                  ? ' · BE Lock'
                                  : tpStage === 2
                                    ? ' · TP1 Lock'
                                    : ''}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                T1 {tp1Val}
                                {tp2Val ? ` · T2 ${tp2Val}` : ''}
                                {tp3Val ? ` · T3 ${tp3Val}` : ''}
                              </div>

                              {/* Visual 3-TP Stepped Trailing Milestone Stepper */}
                              <div className="flex items-center justify-end gap-1 pt-0.5 text-[9px] font-semibold">
                                <span
                                  className={`px-1.5 py-0.5 rounded border ${
                                    tpStage >= 1
                                      ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-slate-100 dark:bg-[#08101E] border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {tpStage >= 1 ? '✓ TP1' : 'TP1'}
                                </span>
                                <span className="text-slate-400 dark:text-slate-600">→</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded border ${
                                    tpStage >= 2
                                      ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-slate-100 dark:bg-[#08101E] border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {tpStage >= 2 ? '✓ TP2' : 'TP2'}
                                </span>
                                <span className="text-slate-400 dark:text-slate-600">→</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded border ${
                                    isClosedTp3
                                      ? 'bg-blue-50 dark:bg-sky-500/15 border-blue-300 dark:border-sky-500/40 text-blue-700 dark:text-sky-300'
                                      : 'bg-slate-100 dark:bg-[#08101E] border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {isClosedTp3 ? '✓ TP3' : 'TP3'}
                                </span>
                              </div>

                              {ladderMetrics !== null && t.status === 'OPEN' && (
                                <div className="w-36 ml-auto space-y-1">
                                  <div
                                    className="relative w-full h-1.5 bg-slate-200 dark:bg-white/[0.08] rounded-full overflow-hidden"
                                    title={ladderMetrics.statusLabel}
                                  >
                                    {ladderMetrics.zone === 'DRAWDOWN' ? (
                                      <div
                                        className="h-full bg-rose-500 dark:bg-rose-400 transition-all duration-300"
                                        style={{ width: `${ladderMetrics.slDrawdownPct}%` }}
                                      />
                                    ) : (
                                      <div
                                        className={`h-full transition-all duration-300 ${
                                          ladderMetrics.zone === 'ENTRY_TO_TP1'
                                            ? 'bg-blue-600 dark:bg-sky-400'
                                            : 'bg-emerald-500 dark:bg-emerald-400'
                                        }`}
                                        style={{ width: `${ladderMetrics.tpProgressPct}%` }}
                                      />
                                    )}
                                    {ladderMetrics.zone !== 'DRAWDOWN' && (
                                      <>
                                        <span className="pointer-events-none absolute top-0 bottom-0 left-[33.33%] w-px bg-slate-400/50 dark:bg-slate-950/70" />
                                        <span className="pointer-events-none absolute top-0 bottom-0 left-[66.67%] w-px bg-slate-400/50 dark:bg-slate-950/70" />
                                      </>
                                    )}
                                  </div>
                                  <div
                                    className={`text-[9px] font-medium ${
                                      ladderMetrics.zone === 'DRAWDOWN'
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : ladderMetrics.zone === 'ENTRY_TO_TP1'
                                          ? 'text-blue-600 dark:text-sky-400'
                                          : ladderMetrics.zone === 'AT_ENTRY'
                                            ? 'text-slate-500 dark:text-slate-400'
                                            : 'text-emerald-600 dark:text-emerald-400'
                                    }`}
                                  >
                                    {ladderMetrics.statusLabel}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono-tabular font-semibold ${
                          effectivePnl === null
                            ? 'text-slate-500 dark:text-slate-400'
                            : effectivePnl >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
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
                              ? 'text-slate-500 dark:text-slate-400'
                              : liveRMultiple >= 0
                                ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                : 'text-rose-700 dark:text-rose-400 font-medium'
                          }
                        >
                          {liveRMultiple !== null
                            ? `${liveRMultiple >= 0 ? '+' : ''}${liveRMultiple}R`
                            : t.riskReward}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">
                          {roiPct !== null
                            ? `${roiPct >= 0 ? '+' : ''}${roiPct}% · Plan ${t.riskReward}`
                            : `Plan ${t.riskReward}`}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-medium ${
                            t.result === 'WIN'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : t.result === 'LOSS'
                                ? 'text-rose-700 dark:text-rose-400'
                                : t.status === 'OPEN'
                                  ? 'text-blue-700 dark:text-sky-300'
                                  : 'text-slate-500 dark:text-slate-400'
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
                              className="px-2.5 py-1 text-[11px] font-medium bg-emerald-50 dark:bg-emerald-600/20 hover:bg-emerald-100 dark:hover:bg-emerald-600/30 border border-emerald-200 dark:border-emerald-500/35 text-emerald-700 dark:text-emerald-300 rounded-md whitespace-nowrap"
                            >
                              {livePrice !== null ? 'Close @ Live' : 'Close Trade'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteTrade(t.id)}
                            aria-label="Delete trade entry"
                            className="p-1 text-slate-500 hover:text-rose-700 dark:hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/90 dark:bg-[#08101E]">
                        <td colSpan={9} className="px-6 py-3.5 border-t border-slate-200/70 dark:border-slate-800/80">
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 text-xs">
                            <div className="md:col-span-5 space-y-1.5">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Trade Metadata &amp; Broker Reference
                              </div>
                              <div className="text-slate-700 dark:text-slate-300">
                                <span className="text-slate-500 dark:text-slate-400">Setup: </span>
                                {t.strategyConfirmation}
                              </div>
                              {t.screenshotNote && (
                                <div className="text-slate-700 dark:text-slate-300">
                                  <span className="text-slate-500 dark:text-slate-400">Execution Note: </span>
                                  {t.screenshotNote}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                                <span>Ref: {t.brokerOrderId || t.id}</span>
                                <span>Orig Qty: {t.quantity}</span>
                                {typeof t.remainingQuantity === 'number' && (
                                  <span>Runner Qty: {t.remainingQuantity}</span>
                                )}
                                {typeof t.partialRealizedPnl === 'number' && t.partialRealizedPnl !== 0 && (
                                  <span className="text-emerald-700 dark:text-emerald-400">
                                    Partial Realized: +{currency}{formatNumber(t.partialRealizedPnl, 2)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="md:col-span-7 space-y-1.5">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Execution Audit Timeline
                              </div>
                              {t.auditTrail && t.auditTrail.length > 0 ? (
                                <ul className="space-y-1 font-mono-tabular text-[11px] text-slate-700 dark:text-slate-300">
                                  {t.auditTrail.map((line, idx) => (
                                    <li key={idx} className="flex items-start gap-2">
                                      <span className="text-sky-600 dark:text-sky-400 shrink-0">•</span>
                                      <span>{line}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  Opened {t.direction} {t.quantity} @ {currency}{t.entryPrice} · SL {t.stopLoss} · TP1 {t.target1}
                                  {t.status === 'CLOSED' && t.exitPrice ? ` · Closed @ ${currency}${t.exitPrice}` : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      )}

      {/* Add Trade Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Log Trade Journal Entry</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddSubmit} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">Instrument</label>
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
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                  >
                    {INSTRUMENTS.map((i) => (
                      <option key={i.id} value={i.symbol}>
                        {i.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">Contract</label>
                  <input
                    required
                    value={newContract}
                    onChange={(e) => setNewContract(e.target.value)}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">Direction</label>
                  <select
                    value={newDirection}
                    onChange={(e) => setNewDirection(e.target.value as 'BUY' | 'SELL')}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">Account Ledger</label>
                  <div className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-300 font-semibold">
                    {lockedMode === 'LIVE' ? 'LIVE (Actual)' : 'PAPER (Demo)'}
                  </div>
                </div>
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">Quantity</label>
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    required
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">Entry Price</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={newEntry}
                    onChange={(e) => setNewEntry(e.target.value)}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">Initial Stop Loss</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={newSl}
                    onChange={(e) => setNewSl(e.target.value)}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">TP1 (SL → Entry)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={newT1}
                    onChange={(e) => setNewT1(e.target.value)}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">TP2 (SL → TP1)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="Auto"
                    value={newT2}
                    onChange={(e) => setNewT2(e.target.value)}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">TP3 (Full Exit)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="Auto"
                    value={newT3}
                    onChange={(e) => setNewT3(e.target.value)}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">Strategy Confirmation</label>
                <input
                  required
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-[#152238] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-lg"
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
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Close {closingTrade.instrument} ({closingTrade.contract})
              </h3>
              <button
                type="button"
                onClick={() => setClosingTrade(null)}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCloseSubmit} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">
                  Exit Price (Entry was {closingTrade.entryPrice})
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={closeExitPrice}
                  onChange={(e) => setCloseExitPrice(e.target.value)}
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">Chart / Execution Note (Optional)</label>
                <input
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  placeholder="e.g. Target 1 hit cleanly on 5m volume expansion"
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setClosingTrade(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-[#152238] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-lg"
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
