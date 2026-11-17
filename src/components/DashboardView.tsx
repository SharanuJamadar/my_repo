import React, { useMemo } from 'react';
import {
  Bot,
  CandlestickChart,
  Link2,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import {
  INSTRUMENTS,
  type DemoWalletState,
  type GeneratedSignalPayload,
  type StoredTradeSignal,
  type StrategyConfig,
  type TradeJournalEntry,
} from '../types/trading';

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
  config: StrategyConfig;
  userEmail: string;
  wallet: DemoWalletState;
  trades: TradeJournalEntry[];
  signals: StoredTradeSignal[];
  livePricesBySymbol: Record<string, LivePricePoint>;
  onOpenInTerminal: (instrumentId: string) => void;
  onQuickAddWalletFunds: (amount: number) => Promise<void>;
  onOpenBrokerModal: () => void;
  onNavigateTab: (tab: 'terminal' | 'journal' | 'execution' | 'settings') => void;
  onQuickCloseTrade: (trade: TradeJournalEntry, exitPrice: number) => Promise<void>;
  autoScanResults: AutoScanMarketItem[];
  autoScanLoading: boolean;
  lastAutoScanAt: string | null;
  autoScanEnabled: boolean;
  onToggleAutoScan: () => void;
  autoExecuteEnabled: boolean;
  onToggleAutoExecute: () => void;
  autoPilotNote: string | null;
  onRunAutoScan: () => Promise<void>;
  onExecuteSignalInstant: (signal: GeneratedSignalPayload) => Promise<void>;
  executingInstrumentSymbol: string | null;
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
  config,
  userEmail,
  wallet,
  trades,
  signals,
  livePricesBySymbol,
  onOpenInTerminal,
  onQuickAddWalletFunds,
  onOpenBrokerModal,
  onNavigateTab,
  onQuickCloseTrade,
  autoScanResults,
  autoScanLoading,
  lastAutoScanAt,
  autoScanEnabled,
  onToggleAutoScan,
  autoExecuteEnabled,
  onToggleAutoExecute,
  autoPilotNote,
  onRunAutoScan,
  onExecuteSignalInstant,
  executingInstrumentSymbol,
}) => {
  const liveTradesSnapshot = useMemo(() => {
    const openTrades = trades.filter((t) => t.status === 'OPEN');
    const closedTrades = trades.filter((t) => t.status === 'CLOSED');

    const enrichedOpen = openTrades.map((t) => {
      const meta = findInstrumentMeta(t.instrument);
      const feed = meta ? livePricesBySymbol[meta.id] : undefined;
      const onSameScale =
        feed && Math.abs(feed.price - t.entryPrice) / Math.max(t.entryPrice, 1) <= 0.45;
      const liveLtp = onSameScale ? feed.price : null;
      const diff =
        liveLtp !== null
          ? t.direction === 'BUY'
            ? liveLtp - t.entryPrice
            : t.entryPrice - liveLtp
          : null;
      const livePnl = diff !== null ? Number((diff * t.quantity).toFixed(2)) : null;
      const risk = Math.abs(t.entryPrice - t.stopLoss);
      const liveR = diff !== null && risk > 0 ? Number((diff / risk).toFixed(2)) : null;
      const roiPct =
        diff !== null && t.entryPrice > 0
          ? Number(((diff / t.entryPrice) * 100).toFixed(2))
          : null;

      return {
        trade: t,
        meta,
        currency: meta?.currency ?? '₹',
        liveLtp,
        livePnl,
        liveR,
        roiPct,
      };
    });

    const realizedPnl = closedTrades.reduce((acc, t) => acc + t.pnl, 0);
    const liveOpenPnl = enrichedOpen.reduce((acc, x) => acc + (x.livePnl ?? 0), 0);
    const totalEquity = wallet.balance + realizedPnl + liveOpenPnl;
    const deployedMargin = openTrades.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0);
    const closedWins = closedTrades.filter((t) => t.result === 'WIN').length;
    const openWins = enrichedOpen.filter((x) => (x.livePnl ?? 0) > 0).length;
    const pricedOpenCount = enrichedOpen.filter((x) => x.livePnl !== null).length;
    const totalCount = closedTrades.length + pricedOpenCount;
    const liveWinRate = totalCount > 0 ? ((closedWins + openWins) / totalCount) * 100 : 0;

    return {
      enrichedOpen,
      closedCount: closedTrades.length,
      realizedPnl,
      liveOpenPnl,
      totalEquity,
      deployedMargin,
      liveWinRate,
    };
  }, [trades, livePricesBySymbol, wallet.balance]);

  const openInstrumentKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of liveTradesSnapshot.enrichedOpen) {
      keys.add(normalizeKey(item.trade.instrument));
      if (item.meta) keys.add(normalizeKey(item.meta.id));
    }
    return keys;
  }, [liveTradesSnapshot.enrichedOpen]);

  return (
    <div className="space-y-6">
      {/* Account Details, Connected Trading App & Live Equity Overview */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold text-white text-base">Trading Account Dashboard</span>
              <span aria-hidden="true">·</span>
              <span>{userEmail || 'Standalone Desk'}</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400 font-medium">{config.brokerProviderLabel}</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Account equity, live running positions, 5-market auto-pilot setups, and connected broker apps
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigateTab('terminal')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <CandlestickChart className="w-3.5 h-3.5" />
              Open Chart Terminal
            </button>

            <button
              type="button"
              onClick={onOpenBrokerModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Link2 className="w-3.5 h-3.5" />
              Connect Trading App
            </button>

            <button
              type="button"
              onClick={() => onQuickAddWalletFunds(100000)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              +100,000 Demo Funds
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('journal')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Wallet className="w-3.5 h-3.5 text-sky-300" />
              Wallet & Journal
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <div className="text-[11px] text-slate-400">Demo Wallet Capital</div>
            <div className="font-mono-tabular text-xl font-semibold text-white mt-0.5">
              {fmt(wallet.balance, 2)}
            </div>
            <div className="text-[11px] text-slate-500">
              {config.paperTradingOnly ? 'Paper Engine Active' : 'Live + Paper'}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-400">Live Total Equity</div>
            <div
              className={`font-mono-tabular text-xl font-semibold mt-0.5 ${
                liveTradesSnapshot.totalEquity >= wallet.balance ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {fmt(liveTradesSnapshot.totalEquity, 2)}
            </div>
            <div className="text-[11px] text-slate-500 font-mono-tabular">
              Margin: {fmt(liveTradesSnapshot.deployedMargin, 0)}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-400">Live Open P&L</div>
            <div
              className={`font-mono-tabular text-xl font-semibold mt-0.5 ${
                liveTradesSnapshot.liveOpenPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {liveTradesSnapshot.liveOpenPnl >= 0 ? '+' : ''}
              {fmt(liveTradesSnapshot.liveOpenPnl, 2)}
            </div>
            <div className="text-[11px] text-slate-500 font-mono-tabular">
              {liveTradesSnapshot.enrichedOpen.length} open running
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-400">Realized P&L</div>
            <div
              className={`font-mono-tabular text-xl font-semibold mt-0.5 ${
                liveTradesSnapshot.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {liveTradesSnapshot.realizedPnl >= 0 ? '+' : ''}
              {fmt(liveTradesSnapshot.realizedPnl, 2)}
            </div>
            <div className="text-[11px] text-slate-500 font-mono-tabular">
              {liveTradesSnapshot.closedCount} closed trades
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-400">Live Win Rate</div>
            <div className="font-mono-tabular text-xl font-semibold text-white mt-0.5">
              {liveTradesSnapshot.liveWinRate.toFixed(1)}%
            </div>
            <div className="text-[11px] text-slate-500">Closed + Running MTM</div>
          </div>

          <div>
            <div className="text-[11px] text-slate-400">Available Setups</div>
            <div className="font-mono-tabular text-xl font-semibold text-sky-300 mt-0.5">
              {autoScanResults.filter((r) => r.signal && r.signal.direction !== 'NO_TRADE').length} /{' '}
              {autoScanResults.length || 5}
            </div>
            <div className="text-[11px] text-slate-500">5 Priority Markets</div>
          </div>
        </div>
      </div>

      {/* Live Running Trades Monitor */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
            <h3 className="text-sm font-semibold text-white">
              Live Running Trades ({liveTradesSnapshot.enrichedOpen.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('journal')}
            className="text-xs font-medium text-sky-300 hover:text-sky-200 whitespace-nowrap shrink-0"
          >
            Open Full Trade Journal & Ratios →
          </button>
        </div>

        {liveTradesSnapshot.enrichedOpen.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            No live running trades right now. Click Execute Trade on any Available Setup below or turn on Auto-Execute.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Instrument · Contract</th>
                  <th className="py-2.5 px-4 font-medium">Side · Mode</th>
                  <th className="py-2.5 px-4 font-medium text-right">Entry</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live LTP</th>
                  <th className="py-2.5 px-4 font-medium text-right">SL / T1</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live P&L</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live R · ROI</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {liveTradesSnapshot.enrichedOpen.map(
                  ({ trade: t, meta, currency, liveLtp, livePnl, liveR, roiPct }) => (
                    <tr key={t.id} className="hover:bg-white/[0.03]">
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => {
                            if (meta) onOpenInTerminal(meta.id);
                          }}
                          className="text-left hover:text-emerald-300 transition-colors"
                        >
                          <div className="font-semibold text-white">{t.instrument}</div>
                          <div className="text-[11px] text-slate-400 font-mono-tabular">
                            {t.contract} · Qty {t.quantity}
                          </div>
                        </button>
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`font-semibold ${
                            t.direction === 'BUY' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {t.direction}
                        </span>
                        <span className="text-slate-500"> · </span>
                        <span className="text-sky-300">{t.executionMode}</span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-white">
                        {currency}
                        {t.entryPrice}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular font-semibold text-white">
                        {liveLtp !== null ? `${currency}${liveLtp.toLocaleString()}` : 'Syncing...'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-400">
                        {t.stopLoss} / {t.target1}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono-tabular font-semibold ${
                          livePnl === null
                            ? 'text-slate-400'
                            : livePnl >= 0
                              ? 'text-emerald-400'
                              : 'text-red-400'
                        }`}
                      >
                        {livePnl === null
                          ? '—'
                          : `${livePnl >= 0 ? '+' : ''}${currency}${fmt(livePnl, 2)}`}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular">
                        <span
                          className={
                            liveR === null
                              ? 'text-slate-400'
                              : liveR >= 0
                                ? 'text-emerald-400'
                                : 'text-red-400'
                          }
                        >
                          {liveR !== null ? `${liveR >= 0 ? '+' : ''}${liveR}R` : t.riskReward}
                        </span>
                        {roiPct !== null && (
                          <div className="text-[10px] text-slate-400">
                            {roiPct >= 0 ? '+' : ''}
                            {roiPct}%
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {meta && (
                            <button
                              type="button"
                              onClick={() => onOpenInTerminal(meta.id)}
                              className="px-2 py-1 text-[11px] font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-sky-300 rounded-md whitespace-nowrap"
                            >
                              Chart
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              onQuickCloseTrade(t, liveLtp ?? t.target1 ?? t.entryPrice)
                            }
                            className="px-2.5 py-1 text-[11px] font-medium bg-[#090B0E] hover:bg-emerald-600/20 border border-white/[0.08] hover:border-emerald-500/40 text-emerald-300 rounded-md whitespace-nowrap"
                          >
                            Close @ Live
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

      {/* Auto-Pilot Multi-Market Scanner & Available Trades */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Bot className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Auto-Analyzer & Available Trades (XAUUSD · NIFTY 50 · XAGUSD · BTCUSDT · Crude Oil MCX)
              </h3>
              <p className="text-[11px] text-slate-400">
                Click any market row to open its full interactive candlestick chart inside Terminal
                {lastAutoScanAt ? ` · Last scan ${new Date(lastAutoScanAt).toLocaleTimeString()}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleAutoScan}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                autoScanEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                  : 'bg-[#090B0E] border-white/[0.08] text-slate-400 hover:text-slate-200'
              }`}
            >
              Auto-Scan (20s): {autoScanEnabled ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              onClick={onToggleAutoExecute}
              disabled={config.killSwitchActive}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                autoExecuteEnabled && !config.killSwitchActive
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-[#090B0E] border-white/[0.08] text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Auto-Execute: {autoExecuteEnabled && !config.killSwitchActive ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              onClick={onRunAutoScan}
              disabled={autoScanLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoScanLoading ? 'animate-spin' : ''}`} />
              {autoScanLoading ? 'Scanning 5 Markets...' : 'Scan & Analyze Now'}
            </button>
          </div>
        </div>

        {config.killSwitchActive && (
          <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2 text-xs text-red-300">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            Emergency Kill Switch is ACTIVE — automated execution is paused until switched off in Admin Settings.
          </div>
        )}

        {autoPilotNote && (
          <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20 text-xs text-emerald-200">
            {autoPilotNote}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-[11px] text-slate-400">
                <th className="py-2.5 px-4 font-medium">Market (Open Terminal)</th>
                <th className="py-2.5 px-4 font-medium text-right">Live Price</th>
                <th className="py-2.5 px-4 font-medium">15m / 5m Bias</th>
                <th className="py-2.5 px-4 font-medium">Setup / Contract</th>
                <th className="py-2.5 px-4 font-medium text-right">Entry / SL / T1</th>
                <th className="py-2.5 px-4 font-medium text-right">Score · R:R</th>
                <th className="py-2.5 px-4 font-medium text-right">Execution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {autoScanResults.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 px-4 text-center text-slate-400">
                    {autoScanLoading
                      ? 'Scanning XAUUSD, NIFTY 50, XAGUSD, BTCUSDT, and MCX Crude Oil...'
                      : 'Click Scan & Analyze Now to inspect live setups across all 5 markets.'}
                  </td>
                </tr>
              ) : (
                autoScanResults.map((row) => {
                  const sig = row.signal;
                  const c = row.instrument.currency;
                  const alreadyOpen =
                    openInstrumentKeys.has(normalizeKey(row.instrument.id)) ||
                    openInstrumentKeys.has(normalizeKey(row.instrument.symbol));
                  const canExecute =
                    Boolean(sig) && sig!.direction !== 'NO_TRADE' && sig!.entryPrice > 0;
                  const isExecuting = executingInstrumentSymbol === row.instrument.symbol;
                  const chgPos = (row.changePercent ?? 0) >= 0;

                  return (
                    <tr key={row.instrument.id} className="hover:bg-white/[0.03]">
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => onOpenInTerminal(row.instrument.id)}
                          className="text-left group"
                        >
                          <div className="font-semibold text-white group-hover:text-emerald-300 transition-colors">
                            {row.instrument.symbol}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {row.instrument.exchangeLabel} · Open Terminal →
                          </div>
                        </button>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular">
                        {row.quoteAvailable && row.price !== null ? (
                          <div>
                            <div className="font-semibold text-white">
                              {c}
                              {row.price.toLocaleString()}
                            </div>
                            <div
                              className={`text-[11px] ${
                                chgPos ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {chgPos ? '+' : ''}
                              {(row.changePercent ?? 0).toFixed(2)}%
                            </div>
                          </div>
                        ) : (
                          <span className="text-amber-400">DATA UNAVAILABLE</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-200">
                          {row.trend15m} / {row.trend5m}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono-tabular">
                          RSI {row.rsi5m ?? '—'} · EMA9 {row.ema9 ?? '—'}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        {sig ? (
                          <div>
                            <span
                              className={`font-semibold ${
                                sig.direction === 'BUY'
                                  ? 'text-emerald-400'
                                  : sig.direction === 'SELL'
                                    ? 'text-red-400'
                                    : 'text-amber-300'
                              }`}
                            >
                              {sig.direction === 'NO_TRADE' ? 'WAIT / NO TRADE' : sig.direction}
                            </span>
                            <span className="text-slate-500"> · </span>
                            <span className="text-slate-300">{sig.contract}</span>
                          </div>
                        ) : (
                          <span className="text-slate-500">Unavailable</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-300">
                        {canExecute
                          ? `${c}${sig!.entryPrice} / ${sig!.stopLoss} / ${sig!.target1}`
                          : 'Zone Wait'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular">
                        <div className="font-semibold text-white">
                          {sig ? `${sig.qualityScore}/100` : '—'}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {sig?.riskReward || '—'} · {sig?.status || '—'}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {alreadyOpen ? (
                          <span className="text-[11px] font-semibold text-sky-300 whitespace-nowrap">
                            OPEN RUNNING
                          </span>
                        ) : canExecute ? (
                          <button
                            type="button"
                            disabled={isExecuting || config.killSwitchActive}
                            onClick={() => onExecuteSignalInstant(sig!)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-300 rounded-md whitespace-nowrap disabled:opacity-50"
                          >
                            <Play className="w-3 h-3" />
                            {isExecuting ? 'Placing...' : 'Execute Trade'}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-500 whitespace-nowrap">
                            No Entry
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Historical Signal Log */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Recent Signal Activity</h3>
          <button
            type="button"
            onClick={() => onNavigateTab('execution')}
            className="text-xs font-medium text-sky-300 hover:text-sky-200 whitespace-nowrap"
          >
            Telegram & Orders ({signals.length}) →
          </button>
        </div>
        {signals.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Signals generated by Auto-Analyzer or Chart Terminal will appear here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Instrument</th>
                  <th className="py-2.5 px-4 font-medium">Contract</th>
                  <th className="py-2.5 px-4 font-medium">Direction</th>
                  <th className="py-2.5 px-4 font-medium text-right">Entry</th>
                  <th className="py-2.5 px-4 font-medium text-right">SL / T1 / T2</th>
                  <th className="py-2.5 px-4 font-medium text-right">Score</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {signals.slice(0, 6).map((s) => (
                  <tr key={s.id} className="hover:bg-white/[0.03]">
                    <td className="py-2.5 px-4 font-semibold text-white">{s.instrument}</td>
                    <td className="py-2.5 px-4 text-slate-300">{s.contract}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={
                          s.direction === 'BUY'
                            ? 'text-emerald-400 font-medium'
                            : s.direction === 'SELL'
                              ? 'text-red-400 font-medium'
                              : 'text-amber-300 font-medium'
                        }
                      >
                        {s.direction}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-white">
                      {s.entryPrice || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-400">
                      {s.stopLoss || '—'} / {s.target1 || '—'} / {s.target2 || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-white">
                      {s.qualityScore}/100
                    </td>
                    <td className="py-2.5 px-4 text-slate-200">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
