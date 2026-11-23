import React, { useMemo } from 'react';
import { ArrowRight, Link2, ShieldAlert, ShieldCheck, TrendingUp, Unlock } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  INSTRUMENTS,
  type DemoWalletState,
  type EconomicCalendarResponse,
  type GeneratedSignalPayload,
  type PriceAlertRule,
  type StrategyConfig,
  type TradeJournalEntry,
} from '../types/trading';
import { WalletDepositWithdrawSection } from './WalletDepositWithdrawSection';
import { DashboardWatchlistSection } from './DashboardWatchlistSection';
import { LiveMarketNewsSection } from './LiveMarketNewsSection';
import { ExnessGuidePanel } from './ExnessGuidePanel';
import { MarketSessionsCalendarPanel } from './MarketSessionsCalendarPanel';
import { PriceAlertsPanel } from './PriceAlertsPanel';
import { useTheme } from '../lib/theme';

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
  accountType: 'LIVE' | 'DEMO';
  config: StrategyConfig;
  brokerLabel: string;
  brokerConfigured: boolean;
  exnessConfigured: boolean;
  wallet: DemoWalletState;
  liveBrokerBalance?: { balance: number; currency: string; serverName?: string } | null;
  trades: TradeJournalEntry[];
  livePricesBySymbol: Record<string, LivePricePoint>;
  economicCalendar: EconomicCalendarResponse | null;
  calendarLoading: boolean;
  onRefreshCalendar: () => void;
  priceAlerts: PriceAlertRule[];
  onAddPriceAlert: (rule: Omit<PriceAlertRule, 'id' | 'active' | 'createdAt'>) => void;
  onDeletePriceAlert: (id: string) => void;
  onClearTriggeredAlerts: () => void;
  dailyGuardrailStatus: {
    locked: boolean;
    reason: string | null;
    todayPnl: number;
    todayPnlPct: number;
    maxLossPct: number;
    profitTargetPct: number;
    overrideActive: boolean;
  };
  onToggleGuardrailOverride: () => void;
  onOpenInTerminal: (instrumentId: string) => void;
  onDepositFunds: (amount: number, note?: string) => Promise<void>;
  onWithdrawFunds: (amount: number, note?: string) => Promise<void>;
  onResetWallet: (newBalance: number) => Promise<void>;
  onNavigateJournal: () => void;
  onOpenBrokerModal: () => void;
  onSwitchAccountType: (next: 'LIVE' | 'DEMO') => void;
  onExnessBalanceSync?: (info: { balance: number; currency: string; serverName?: string }) => void;
}

interface DailyPnlPoint {
  dateKey: string;
  label: string;
  dailyPnl: number;
  realizedPnl: number;
  openMtmPnl: number;
  cumulativePnl: number;
  closedCount: number;
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

function parseTimestamp(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) {
    return Number.isNaN(ts.getTime()) ? null : ts;
  }
  if (typeof ts === 'object') {
    const obj = ts as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') {
      const d = obj.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof obj.seconds === 'number') {
      const d = new Date(obj.seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof ts === 'number' || typeof ts === 'string') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toLocalDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatAxisLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatCompactAxis(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  accountType,
  config,
  brokerLabel,
  brokerConfigured,
  exnessConfigured,
  wallet,
  liveBrokerBalance,
  trades,
  livePricesBySymbol,
  economicCalendar,
  calendarLoading,
  onRefreshCalendar,
  priceAlerts,
  onAddPriceAlert,
  onDeletePriceAlert,
  onClearTriggeredAlerts,
  dailyGuardrailStatus,
  onToggleGuardrailOverride,
  onOpenInTerminal,
  onDepositFunds,
  onWithdrawFunds,
  onResetWallet,
  onNavigateJournal,
  onOpenBrokerModal,
  onSwitchAccountType,
  onExnessBalanceSync,
}) => {
  const { isDark } = useTheme();
  const flatLivePrices = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(livePricesBySymbol)) {
      out[k] = v.price;
    }
    return out;
  }, [livePricesBySymbol]);
  const pnlSnapshot = useMemo(() => {
    const openTrades = trades.filter((t) => t.status === 'OPEN');
    const closedTrades = trades.filter((t) => t.status === 'CLOSED');

    let liveOpenPnl = 0;
    let openWins = 0;
    let pricedOpenCount = 0;
    let inrOpenPnl = 0;
    let usdOpenPnl = 0;
    let inrRealizedPnl = 0;
    let usdRealizedPnl = 0;
    let inrTradeCount = 0;
    let usdTradeCount = 0;

    for (const t of openTrades) {
      const meta = findInstrumentMeta(t.instrument);
      const isUsd = meta?.currency === '$';
      if (isUsd) usdTradeCount += 1;
      else inrTradeCount += 1;

      const feed = meta ? livePricesBySymbol[meta.id] : undefined;
      const onSameScale =
        feed && Math.abs(feed.price - t.entryPrice) / Math.max(t.entryPrice, 1) <= 0.45;
      if (onSameScale) {
        const diff = t.direction === 'BUY' ? feed.price - t.entryPrice : t.entryPrice - feed.price;
        const pnl = diff * t.quantity;
        liveOpenPnl += pnl;
        if (isUsd) usdOpenPnl += pnl;
        else inrOpenPnl += pnl;
        pricedOpenCount += 1;
        if (pnl > 0) openWins += 1;
      }
    }

    for (const t of closedTrades) {
      const meta = findInstrumentMeta(t.instrument);
      if (meta?.currency === '$') {
        usdRealizedPnl += t.pnl;
        usdTradeCount += 1;
      } else {
        inrRealizedPnl += t.pnl;
        inrTradeCount += 1;
      }
    }

    const realizedPnl = closedTrades.reduce((acc, t) => acc + t.pnl, 0);
    const netCombinedPnl = realizedPnl + liveOpenPnl;
    const baseCapital =
      accountType === 'LIVE'
        ? liveBrokerBalance?.balance ?? null
        : wallet.balance;
    const totalEquity =
      baseCapital !== null
        ? accountType === 'LIVE'
          ? baseCapital + liveOpenPnl
          : baseCapital + netCombinedPnl
        : null;
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
      baseCapital,
      totalEquity,
      deployedMargin,
      liveWinRate,
      inrNetPnl: inrRealizedPnl + inrOpenPnl,
      usdNetPnl: usdRealizedPnl + usdOpenPnl,
      inrTradeCount,
      usdTradeCount,
    };
  }, [trades, livePricesBySymbol, wallet.balance, accountType, liveBrokerBalance]);

  const dailyPnlSeries = useMemo<DailyPnlPoint[]>(() => {
    if (trades.length === 0) return [];

    const byDay = new Map<string, { realized: number; closedCount: number }>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = toLocalDateKey(today);

    let earliestDay = new Date(today);
    earliestDay.setDate(earliestDay.getDate() - 6);

    for (const t of trades) {
      const refDate =
        t.status === 'CLOSED'
          ? parseTimestamp(t.updatedAt) ?? parseTimestamp(t.createdAt)
          : parseTimestamp(t.createdAt);
      if (!refDate) continue;

      const dayStart = new Date(refDate);
      dayStart.setHours(0, 0, 0, 0);
      if (dayStart < earliestDay) {
        earliestDay = dayStart;
      }

      if (t.status === 'CLOSED') {
        const key = toLocalDateKey(dayStart);
        const cur = byDay.get(key) ?? { realized: 0, closedCount: 0 };
        cur.realized += Number(t.pnl) || 0;
        cur.closedCount += 1;
        byDay.set(key, cur);
      }
    }

    // Cap lookback window to 30 days for readability
    const minWindowStart = new Date(today);
    minWindowStart.setDate(minWindowStart.getDate() - 29);
    if (earliestDay < minWindowStart) {
      earliestDay = minWindowStart;
    }

    const points: DailyPnlPoint[] = [];
    let runningCumulative = 0;

    // Seed cumulative sum for any closed trades prior to window start
    for (const [key, entry] of byDay.entries()) {
      if (key < toLocalDateKey(earliestDay)) {
        runningCumulative += entry.realized;
      }
    }

    const cursor = new Date(earliestDay);
    while (cursor <= today) {
      const key = toLocalDateKey(cursor);
      const rec = byDay.get(key);
      const realized = rec ? Number(rec.realized.toFixed(2)) : 0;
      const openMtm = key === todayKey ? Number(pnlSnapshot.liveOpenPnl.toFixed(2)) : 0;
      const daily = Number((realized + openMtm).toFixed(2));
      runningCumulative = Number((runningCumulative + daily).toFixed(2));

      points.push({
        dateKey: key,
        label: formatAxisLabel(key),
        dailyPnl: daily,
        realizedPnl: realized,
        openMtmPnl: openMtm,
        cumulativePnl: runningCumulative,
        closedCount: rec?.closedCount ?? 0,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return points;
  }, [trades, pnlSnapshot.liveOpenPnl]);

  const lineStrokeColor = pnlSnapshot.netCombinedPnl >= 0 ? '#10B981' : '#EF4444';

  return (
    <div className="space-y-8">
      {/* 1. Portfolio P&L Overview (Strictly Scoped to Actual Live vs Demo Account) */}
      <section className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <TrendingUp
              className={`w-4 h-4 shrink-0 ${
                accountType === 'LIVE' ? 'text-blue-700 dark:text-sky-400' : 'text-emerald-700 dark:text-emerald-400'
              }`}
            />
            <div>
              <h1 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">
                {accountType === 'LIVE'
                  ? 'Actual Trading Account · Live Portfolio P&L'
                  : 'Demo Trading Account · Paper Portfolio P&L'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {accountType === 'LIVE'
                  ? `Strictly isolated live broker ledger (${brokerLabel}) · Never mixed with Demo paper balance`
                  : 'Isolated virtual sandbox · Practice 3-TP stepped trailing without risking real capital'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onSwitchAccountType(accountType === 'LIVE' ? 'DEMO' : 'LIVE')}
              className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Switch to {accountType === 'LIVE' ? 'Demo Account' : 'Actual Account'}
            </button>
            <button
              type="button"
              onClick={onNavigateJournal}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Trade Journal ({trades.length})
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y lg:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
          <div className="px-6 py-5 col-span-2 sm:col-span-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Net Combined P&amp;L</div>
            <div
              className={`font-mono-tabular text-3xl font-semibold tracking-tight mt-1 ${
                pnlSnapshot.netCombinedPnl >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {pnlSnapshot.netCombinedPnl >= 0 ? '+' : ''}
              {fmt(pnlSnapshot.netCombinedPnl, 2)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Open + Realized</div>
          </div>

          <div className="px-6 py-5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Live Open P&amp;L</div>
            <div
              className={`font-mono-tabular text-2xl font-semibold mt-1 ${
                pnlSnapshot.liveOpenPnl >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
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
            <div className="text-xs text-slate-500 dark:text-slate-400">Realized P&amp;L</div>
            <div
              className={`font-mono-tabular text-2xl font-semibold mt-1 ${
                pnlSnapshot.realizedPnl >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
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
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {accountType === 'LIVE' ? 'Live Broker Equity' : 'Demo Total Equity'}
            </div>
            {pnlSnapshot.totalEquity !== null ? (
              <div
                className={`font-mono-tabular text-2xl font-semibold mt-1 ${
                  pnlSnapshot.totalEquity >= (pnlSnapshot.baseCapital ?? 0)
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {accountType === 'LIVE' && liveBrokerBalance?.currency
                  ? `${liveBrokerBalance.currency} `
                  : ''}
                {fmt(pnlSnapshot.totalEquity, 2)}
              </div>
            ) : (
              <div className="font-mono-tabular text-lg font-semibold text-blue-700 dark:text-sky-400 mt-1.5">
                Sync Exness
              </div>
            )}
            <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
              {accountType === 'LIVE'
                ? liveBrokerBalance
                  ? `${liveBrokerBalance.serverName || 'Exness MT5'} · Margin ${fmt(pnlSnapshot.deployedMargin, 0)}`
                  : 'Test bridge below for live balance'
                : `Margin: ${fmt(pnlSnapshot.deployedMargin, 0)}`}
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Win Rate</div>
            <div className="font-mono-tabular text-2xl font-semibold text-slate-900 dark:text-white mt-1">
              {pnlSnapshot.liveWinRate.toFixed(1)}%
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Closed + Live MTM</div>
          </div>
        </div>

        {(pnlSnapshot.inrTradeCount > 0 || pnlSnapshot.usdTradeCount > 0) && (
          <div className="px-6 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-[#F4F6FA] dark:bg-[#08101E] flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Multi-Currency Ledger Split (No INR/USD conflation)
            </span>
            <div className="flex flex-wrap items-center gap-4 font-mono-tabular">
              {pnlSnapshot.inrTradeCount > 0 && (
                <span className="text-slate-700 dark:text-slate-300">
                  INR Desk ({pnlSnapshot.inrTradeCount}):{' '}
                  <strong
                    className={
                      pnlSnapshot.inrNetPnl >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }
                  >
                    {pnlSnapshot.inrNetPnl >= 0 ? '+' : ''}₹{fmt(pnlSnapshot.inrNetPnl, 2)}
                  </strong>
                </span>
              )}
              {pnlSnapshot.usdTradeCount > 0 && (
                <span className="text-slate-700 dark:text-slate-300">
                  USD Desk ({pnlSnapshot.usdTradeCount}):{' '}
                  <strong
                    className={
                      pnlSnapshot.usdNetPnl >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }
                  >
                    {pnlSnapshot.usdNetPnl >= 0 ? '+' : ''}${fmt(pnlSnapshot.usdNetPnl, 2)}
                  </strong>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Prop-Firm Daily Risk Guardrail Strip */}
        <div
          className={`px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs ${
            dailyGuardrailStatus.locked && !dailyGuardrailStatus.overrideActive
              ? 'bg-rose-50/80 dark:bg-rose-950/30'
              : 'bg-slate-50/60 dark:bg-[#0B1424]/70'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {dailyGuardrailStatus.locked && !dailyGuardrailStatus.overrideActive ? (
              <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 dark:text-white">
                {dailyGuardrailStatus.locked && !dailyGuardrailStatus.overrideActive
                  ? dailyGuardrailStatus.reason || 'Daily Risk Guardrail Lockout Active'
                  : dailyGuardrailStatus.overrideActive
                    ? 'Daily Risk Guardrail Manually Overridden'
                    : 'Daily Risk Guardrail Active'}
              </div>
              <div className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                Today: {dailyGuardrailStatus.todayPnl >= 0 ? '+' : ''}
                {fmt(dailyGuardrailStatus.todayPnl, 2)} ({dailyGuardrailStatus.todayPnlPct >= 0 ? '+' : ''}
                {dailyGuardrailStatus.todayPnlPct.toFixed(2)}%) · Limits: -{dailyGuardrailStatus.maxLossPct}% Max Loss / +{dailyGuardrailStatus.profitTargetPct}% Target
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-32 sm:w-44 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              {(() => {
                const span = dailyGuardrailStatus.maxLossPct + dailyGuardrailStatus.profitTargetPct;
                const clamped = Math.max(
                  -dailyGuardrailStatus.maxLossPct,
                  Math.min(dailyGuardrailStatus.profitTargetPct, dailyGuardrailStatus.todayPnlPct)
                );
                const pctWidth = span > 0 ? ((clamped + dailyGuardrailStatus.maxLossPct) / span) * 100 : 50;
                return (
                  <div
                    className={`h-full transition-all duration-300 ${
                      dailyGuardrailStatus.todayPnlPct >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.max(4, Math.min(100, pctWidth))}%` }}
                  />
                );
              })()}
            </div>
            {(dailyGuardrailStatus.locked || dailyGuardrailStatus.overrideActive) && (
              <button
                type="button"
                onClick={onToggleGuardrailOverride}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E182A] text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Unlock className="w-3 h-3" />
                {dailyGuardrailStatus.overrideActive ? 'Re-Arm Guardrail' : 'Override Lock'}
              </button>
            )}
          </div>
        </div>

        {/* Daily P&L History Chart */}
        <div className="px-6 py-5 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">Daily P&amp;L History</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Day-by-day net P&amp;L across closed trades and today&apos;s live open MTM
              </p>
            </div>
            {dailyPnlSeries.length > 0 && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                {dailyPnlSeries[0].label} – {dailyPnlSeries[dailyPnlSeries.length - 1].label}
              </span>
            )}
          </div>

          {dailyPnlSeries.length === 0 ? (
            <div className="h-[190px] flex flex-col items-center justify-center text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg px-4">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">No daily P&amp;L history yet</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-sm">
                Once trades are logged or executed in this account, your daily performance curve will render here.
              </p>
            </div>
          ) : (
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height={200} minWidth={0}>
                <LineChart
                  data={dailyPnlSeries}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke={isDark ? 'rgba(148,163,184,0.12)' : '#E2E8F0'}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{
                      fill: isDark ? '#94A3B8' : '#64748B',
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tickFormatter={formatCompactAxis}
                    tick={{
                      fill: isDark ? '#94A3B8' : '#64748B',
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                  />
                  <ReferenceLine
                    y={0}
                    stroke={isDark ? 'rgba(148,163,184,0.35)' : '#CBD5E1'}
                    strokeDasharray="3 3"
                  />
                  <Tooltip
                    cursor={{
                      stroke: isDark ? 'rgba(148,163,184,0.28)' : '#CBD5E1',
                      strokeWidth: 1,
                    }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const pt = payload[0]?.payload as DailyPnlPoint | undefined;
                      if (!pt) return null;
                      return (
                        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                            {pt.label}
                          </div>
                          <div
                            className={`font-mono-tabular font-semibold ${
                              pt.dailyPnl >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            Daily: {pt.dailyPnl >= 0 ? '+' : ''}
                            {fmt(pt.dailyPnl, 2)}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono-tabular">
                            Cumulative: {pt.cumulativePnl >= 0 ? '+' : ''}
                            {fmt(pt.cumulativePnl, 2)}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                            {pt.closedCount} closed
                            {pt.openMtmPnl !== 0
                              ? ` · Open MTM ${pt.openMtmPnl >= 0 ? '+' : ''}${fmt(pt.openMtmPnl, 2)}`
                              : ''}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="dailyPnl"
                    stroke={lineStrokeColor}
                    strokeWidth={2}
                    dot={{
                      r: 3,
                      fill: isDark ? '#0E182A' : '#FFFFFF',
                      stroke: lineStrokeColor,
                      strokeWidth: 2,
                    }}
                    activeDot={{
                      r: 5,
                      fill: lineStrokeColor,
                      stroke: isDark ? '#0E182A' : '#FFFFFF',
                      strokeWidth: 2,
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      {/* 2. Account-Specific Funding / Live Broker Connection Panel */}
      {accountType === 'DEMO' ? (
        <WalletDepositWithdrawSection
          wallet={wallet}
          liveEquity={pnlSnapshot.totalEquity ?? wallet.balance}
          deployedMargin={pnlSnapshot.deployedMargin}
          onDeposit={onDepositFunds}
          onWithdraw={onWithdrawFunds}
          onResetWallet={onResetWallet}
        />
      ) : (
        <section className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-700 dark:text-sky-400 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Actual Account Execution Routing · {brokerLabel}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {brokerConfigured
                    ? exnessConfigured
                      ? 'Exness MT5 HTTPS Bridge is verified on the server. Live orders & 3-TP SL modifications route directly to your Exness MT5 account.'
                      : 'Authorized live broker adapter credentials are verified on the server.'
                    : 'No live broker credentials configured on server yet. Follow the Exness MT5 API guide below to activate live execution.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenBrokerModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Link2 className="w-3.5 h-3.5 text-blue-700 dark:text-sky-400" />
              Configure Broker / Exness
            </button>
          </div>

          <ExnessGuidePanel onBalanceSync={onExnessBalanceSync} />
        </section>
      )}

      {/* 2.5. Global Market Sessions & High-Impact Economic Calendar */}
      <MarketSessionsCalendarPanel
        calendar={economicCalendar}
        loading={calendarLoading}
        pauseOnHighImpactNews={Boolean(config.pauseOnHighImpactNews ?? true)}
        onRefresh={onRefreshCalendar}
      />

      {/* 2.6. Custom Price Alerts */}
      <PriceAlertsPanel
        alerts={priceAlerts}
        livePricesByInstrument={flatLivePrices}
        onAddAlert={onAddPriceAlert}
        onDeleteAlert={onDeletePriceAlert}
        onClearTriggered={onClearTriggeredAlerts}
      />

      {/* 3. Custom Watchlist */}
      <DashboardWatchlistSection onOpenInTerminal={onOpenInTerminal} />

      {/* 4. Live Market News (Free Yahoo / Google / Market RSS Feeds) */}
      <LiveMarketNewsSection onOpenInTerminal={onOpenInTerminal} />
    </div>
  );
};

