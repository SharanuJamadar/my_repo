import React, { useMemo } from 'react';
import { ArrowRight, TrendingUp } from 'lucide-react';
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
  type GeneratedSignalPayload,
  type TradeJournalEntry,
} from '../types/trading';
import { WalletDepositWithdrawSection } from './WalletDepositWithdrawSection';
import { DashboardWatchlistSection } from './DashboardWatchlistSection';
import { LiveMarketNewsSection } from './LiveMarketNewsSection';

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
      {/* 1. Portfolio P&L Overview (Summary KPIs + Daily P&L History Line Chart) */}
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

        {/* Daily P&L History Chart */}
        <div className="px-6 py-5 border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-xs font-semibold text-slate-200">Daily P&amp;L History</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Day-by-day net P&amp;L across closed trades and today&apos;s live open MTM
              </p>
            </div>
            {dailyPnlSeries.length > 0 && (
              <span className="text-[11px] text-slate-400 font-mono-tabular">
                {dailyPnlSeries[0].label} – {dailyPnlSeries[dailyPnlSeries.length - 1].label}
              </span>
            )}
          </div>

          {dailyPnlSeries.length === 0 ? (
            <div className="h-[190px] flex flex-col items-center justify-center text-center border border-dashed border-white/[0.07] rounded-lg px-4">
              <p className="text-xs font-medium text-slate-300">No daily P&amp;L history yet</p>
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
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{
                      fill: '#64748B',
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
                      fill: '#64748B',
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="rgba(148,163,184,0.28)"
                    strokeDasharray="3 3"
                  />
                  <Tooltip
                    cursor={{ stroke: 'rgba(148,163,184,0.22)', strokeWidth: 1 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const pt = payload[0]?.payload as DailyPnlPoint | undefined;
                      if (!pt) return null;
                      return (
                        <div className="bg-[#0C0F14] border border-white/[0.1] rounded-lg px-3 py-2 text-xs shadow-xl space-y-1">
                          <div className="text-[11px] text-slate-400 font-medium">{pt.label}</div>
                          <div
                            className={`font-mono-tabular font-semibold ${
                              pt.dailyPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            Daily: {pt.dailyPnl >= 0 ? '+' : ''}
                            {fmt(pt.dailyPnl, 2)}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono-tabular">
                            Cumulative: {pt.cumulativePnl >= 0 ? '+' : ''}
                            {fmt(pt.cumulativePnl, 2)}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono-tabular">
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
                    dot={{ r: 3, fill: '#11141A', stroke: lineStrokeColor, strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: lineStrokeColor, stroke: '#11141A', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
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

      {/* 4. Live Market News (Google Search Grounded) */}
      <LiveMarketNewsSection onOpenInTerminal={onOpenInTerminal} />
    </div>
  );
};

