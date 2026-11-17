import React, { useMemo } from 'react';
import { ArrowRight, TrendingUp } from 'lucide-react';
import {
  INSTRUMENTS,
  type DemoWalletState,
  type GeneratedSignalPayload,
  type TradeJournalEntry,
} from '../types/trading';
import { WalletDepositWithdrawSection } from './WalletDepositWithdrawSection';
import { DashboardWatchlistSection } from './DashboardWatchlistSection';

export interface AutoScanMarketItem {
  instrument: (typeof INSTRUMENTS)[number];
  quoteAvailable: boolean;
  price: number | null;
  changePercent: number | null;
  marketTimestamp: string | null;
  trend15m: string;
  trend5m: string;
  rsi5m: number | null;
  ema9: number | null;
  signal: GeneratedSignalPayload | null;
}

export interface LivePricePoint {
  price: number;
  changePercent: number;
  marketTimestamp: string;
}

interface DashboardViewProps {
  wallet: DemoWalletState;
  trades: TradeJournalEntry[];
  livePricesBySymbol: Record<string, LivePricePoint>;
  onOpenInTerminal: (instrumentId: string) => void;
  onDepositFunds: (amount: number, note?: string) => Promise<void>;
  onWithdrawFunds: (amount: number, note?: string) => Promise<void>;
  onResetWallet: (newBalance: number) => Promise<void>;
  onNavigateJournal: () => void;
}

function normalizeKey(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function findInstrumentMeta(label: string) {
  const key = normalizeKey(label);
  return INSTRUMENTS.find(
    (i) =>
      normalizeKey(i.id) === key ||
      normalizeKey(i.symbol) === key ||
      key.includes(normalizeKey(i.id)) ||
      normalizeKey(i.symbol).includes(key)
  );
}

function fmt(val: number, decimals = 2): string {
  return val.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  wallet,
  trades,
  livePricesBySymbol,
  onOpenInTerminal,
  onDepositFunds,
  onWithdrawFunds,
  onResetWallet,
  onNavigateJournal,
}) => {
  const pnlSnapshot = useMemo(() => {
    const openTrades = trades.filter((t) => t.status === 'OPEN');
    const closedTrades = trades.filter((t) => t.status === 'CLOSED');

    let liveOpenPnl = 0;
    let openWins = 0;
    let pricedOpenCount = 0;

    for (const t of openTrades) {
      const meta = findInstrumentMeta(t.instrument);
      const feed = meta ? livePricesBySymbol[meta.id] : undefined;
      const onSameScale =
        feed && Math.abs(feed.price - t.entryPrice) / Math.max(t.entryPrice, 1) <= 0.45;
      if (onSameScale) {
        const diff = t.direction === 'BUY' ? feed.price - t.entryPrice : t.entryPrice - feed.price;
        const pnl = diff * t.quantity;
        liveOpenPnl += pnl;
        pricedOpenCount += 1;
        if (pnl > 0) openWins += 1;
      }
    }

    const realizedPnl = closedTrades.reduce((acc, t) => acc + t.pnl, 0);
    const netCombinedPnl = realizedPnl + liveOpenPnl;
    const totalEquity = wallet.balance + netCombinedPnl;
    const deployedMargin = openTrades.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0);
    const closedWins = closedTrades.filter((t) => t.result === 'WIN').length;
    const totalCount = closedTrades.length + pricedOpenCount;
    const liveWinRate = totalCount > 0 ? ((closedWins + openWins) / totalCount) * 100 : 0;

    return {
      openCount: openTrades.length,
      closedCount: closedTrades.length,
      realizedPnl,
      liveOpenPnl,
      netCombinedPnl,
      totalEquity,
      deployedMargin,
      liveWinRate,
    };
  }, [trades, livePricesBySymbol, wallet.balance]);

  return (
    <div className="space-y-8">
      {/* 1. Portfolio P&L Overview (No live trades table) */}
      <section className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <h1 className="text-base font-semibold text-white tracking-tight">
                Portfolio P&amp;L
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Net performance across open mark-to-market positions and realized trades
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onNavigateJournal}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Trade Journal ({trades.length})
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y lg:divide-y-0 sm:divide-x divide-white/[0.06]">
          <div className="px-6 py-5 col-span-2 sm:col-span-1">
            <div className="text-xs text-slate-400">Net Combined P&amp;L</div>
            <div
              className={`font-mono-tabular text-3xl font-semibold tracking-tight mt-1 ${
                pnlSnapshot.netCombinedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {pnlSnapshot.netCombinedPnl >= 0 ? '+' : ''}
              {fmt(pnlSnapshot.netCombinedPnl, 2)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Open + Realized</div>
          </div>

          <div className="px-6 py-5">
            <div className="text-xs text-slate-400">Live Open P&amp;L</div>
            <div
              className={`font-mono-tabular text-2xl font-semibold mt-1 ${
                pnlSnapshot.liveOpenPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {pnlSnapshot.liveOpenPnl >= 0 ? '+' : ''}
              {fmt(pnlSnapshot.liveOpenPnl, 2)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
              {pnlSnapshot.openCount} open
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="text-xs text-slate-400">Realized P&amp;L</div>
            <div
              className={`font-mono-tabular text-2xl font-semibold mt-1 ${
                pnlSnapshot.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {pnlSnapshot.realizedPnl >= 0 ? '+' : ''}
              {fmt(pnlSnapshot.realizedPnl, 2)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
              {pnlSnapshot.closedCount} closed
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="text-xs text-slate-400">Live Total Equity</div>
            <div
              className={`font-mono-tabular text-2xl font-semibold mt-1 ${
                pnlSnapshot.totalEquity >= wallet.balance ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {fmt(pnlSnapshot.totalEquity, 2)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
              Margin: {fmt(pnlSnapshot.deployedMargin, 0)}
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="text-xs text-slate-400">Win Rate</div>
            <div className="font-mono-tabular text-2xl font-semibold text-white mt-1">
              {pnlSnapshot.liveWinRate.toFixed(1)}%
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Closed + Live MTM</div>
          </div>
        </div>
      </section>

      {/* 2. Wallet: Deposit & Withdrawal Section */}
      <WalletDepositWithdrawSection
        wallet={wallet}
        liveEquity={pnlSnapshot.totalEquity}
        deployedMargin={pnlSnapshot.deployedMargin}
        onDeposit={onDepositFunds}
        onWithdraw={onWithdrawFunds}
        onResetWallet={onResetWallet}
      />

      {/* 3. Custom Watchlist (Add chosen scripts only) */}
      <DashboardWatchlistSection onOpenInTerminal={onOpenInTerminal} />
    </div>
  );
};
