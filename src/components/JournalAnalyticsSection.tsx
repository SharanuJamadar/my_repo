import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
} from 'lucide-react';
import type { TradeJournalEntry } from '../types/trading';

interface Props {
  trades: TradeJournalEntry[];
  onExportCsv: () => void;
}

function toDateObj(ts: any): Date {
  if (!ts) return new Date();
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  const parsed = Date.parse(String(ts));
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const JournalAnalyticsSection: React.FC<Props> = ({ trades, onExportCsv }) => {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0..11
  const [breakdownTab, setBreakdownTab] = useState<'INSTRUMENT' | 'HOUR' | 'DIRECTION'>(
    'INSTRUMENT'
  );

  const closedTrades = useMemo(
    () => trades.filter((t) => t.status === 'CLOSED'),
    [trades]
  );

  const stats = useMemo(() => {
    const wins = closedTrades.filter((t) => t.pnl > 0);
    const losses = closedTrades.filter((t) => t.pnl < 0);
    const totalPnl = closedTrades.reduce((acc, t) => acc + t.pnl, 0);
    const grossWin = wins.reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));
    const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
    const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const expectancy =
      closedTrades.length > 0 ? winRate * avgWin - (1 - winRate) * avgLoss : 0;
    const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 9.99 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9.99 : 0;

    return {
      totalPnl,
      winRatePct: winRate * 100,
      avgWin,
      avgLoss,
      expectancy,
      payoffRatio,
      profitFactor,
      totalClosed: closedTrades.length,
    };
  }, [closedTrades]);

  // Daily P&L map for Calendar Heatmap
  const dailyMap = useMemo(() => {
    const map = new Map<string, { pnl: number; count: number; wins: number }>();
    for (const t of closedTrades) {
      const dt = toDateObj(t.updatedAt || t.createdAt);
      const key = dateKey(dt);
      const cur = map.get(key) ?? { pnl: 0, count: 0, wins: 0 };
      cur.pnl += t.pnl;
      cur.count += 1;
      if (t.pnl > 0) cur.wins += 1;
      map.set(key, cur);
    }
    return map;
  }, [closedTrades]);

  // Calendar grid for selected month
  const calendarCells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const startOffset = firstDay.getDay(); // 0 Sun..6 Sat
    const cells: Array<{
      day: number | null;
      key: string;
      pnl: number;
      count: number;
      wins: number;
    }> = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push({ day: null, key: `pad-${i}`, pnl: 0, count: 0, wins: 0 });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const k = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const info = dailyMap.get(k);
      cells.push({
        day: d,
        key: k,
        pnl: info ? Number(info.pnl.toFixed(2)) : 0,
        count: info?.count ?? 0,
        wins: info?.wins ?? 0,
      });
    }
    return cells;
  }, [viewYear, viewMonth, dailyMap]);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const monthTotalPnl = useMemo(
    () => calendarCells.reduce((acc, c) => acc + c.pnl, 0),
    [calendarCells]
  );

  // Edge Breakdown rows
  const breakdownRows = useMemo(() => {
    const bucket = new Map<string, { label: string; count: number; wins: number; pnl: number }>();

    for (const t of closedTrades) {
      let key = t.instrument;
      if (breakdownTab === 'HOUR') {
        const hr = toDateObj(t.createdAt).getHours();
        key = `${String(hr).padStart(2, '0')}:00–${String((hr + 1) % 24).padStart(2, '0')}:00`;
      } else if (breakdownTab === 'DIRECTION') {
        key = t.direction === 'BUY' ? 'LONG (BUY)' : 'SHORT (SELL)';
      }

      const cur = bucket.get(key) ?? { label: key, count: 0, wins: 0, pnl: 0 };
      cur.count += 1;
      if (t.pnl > 0) cur.wins += 1;
      cur.pnl += t.pnl;
      bucket.set(key, cur);
    }

    return Array.from(bucket.values()).sort((a, b) => b.pnl - a.pnl);
  }, [closedTrades, breakdownTab]);

  const shiftMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  return (
    <div className="space-y-5">
      {/* Expectancy & Institutional Metrics Strip */}
      <div className="bg-white dark:bg-[#111722] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Institutional Edge &amp; Expectancy Metrics
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              · {stats.totalClosed} closed trades
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white dark:bg-sky-600 dark:text-white hover:bg-slate-800 dark:hover:bg-sky-500 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Statement
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Expectancy / Trade
            </div>
            <div
              className={`mt-1 text-lg font-bold font-mono-tabular ${
                stats.expectancy >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {stats.expectancy >= 0 ? '+' : ''}
              {stats.expectancy.toFixed(2)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Profit Factor
            </div>
            <div className="mt-1 text-lg font-bold font-mono-tabular text-slate-900 dark:text-white">
              {stats.profitFactor.toFixed(2)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Payoff Ratio (W/L)
            </div>
            <div className="mt-1 text-lg font-bold font-mono-tabular text-slate-900 dark:text-white">
              {stats.payoffRatio.toFixed(2)}R
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Avg Win
            </div>
            <div className="mt-1 text-lg font-bold font-mono-tabular text-emerald-600 dark:text-emerald-400">
              +{stats.avgWin.toFixed(2)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Avg Loss
            </div>
            <div className="mt-1 text-lg font-bold font-mono-tabular text-rose-600 dark:text-rose-400">
              -{stats.avgLoss.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Main 2-Column TradeZella Layout: Monthly P&L Calendar Heatmap + Edge Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Monthly P&L Calendar Heatmap */}
        <div className="xl:col-span-7 bg-white dark:bg-[#111722] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                Monthly P&amp;L Calendar Heatmap
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-bold font-mono-tabular ${
                  monthTotalPnl >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                Month: {monthTotalPnl >= 0 ? '+' : ''}
                {monthTotalPnl.toFixed(2)}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 min-w-[108px] text-center">
                {monthLabel}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Next month"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((cell) => {
              if (cell.day === null) {
                return <div key={cell.key} className="h-14 rounded-lg bg-transparent" />;
              }
              const hasTrades = cell.count > 0;
              const isGreen = hasTrades && cell.pnl > 0;
              const isRed = hasTrades && cell.pnl < 0;
              return (
                <div
                  key={cell.key}
                  title={
                    hasTrades
                      ? `${cell.key}: ${cell.pnl >= 0 ? '+' : ''}${cell.pnl.toFixed(2)} (${cell.wins}/${cell.count} wins)`
                      : `${cell.key}: No closed trades`
                  }
                  className={`h-14 p-1.5 rounded-lg border flex flex-col justify-between transition-colors ${
                    isGreen
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                      : isRed
                        ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/70'
                        : 'bg-slate-50/70 dark:bg-[#0B0F17] border-slate-200/70 dark:border-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">
                      {cell.day}
                    </span>
                    {hasTrades && (
                      <span className="text-[9px] font-mono-tabular text-slate-500 dark:text-slate-400">
                        {cell.count}t
                      </span>
                    )}
                  </div>
                  {hasTrades ? (
                    <div
                      className={`text-[11px] font-bold font-mono-tabular truncate ${
                        isGreen
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : isRed
                            ? 'text-rose-700 dark:text-rose-300'
                            : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {cell.pnl >= 0 ? '+' : ''}
                      {Math.abs(cell.pnl) >= 1000
                        ? `${(cell.pnl / 1000).toFixed(1)}k`
                        : cell.pnl.toFixed(0)}
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-300 dark:text-slate-700">—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Edge Breakdown by Instrument / Hour / Direction */}
        <div className="xl:col-span-5 bg-white dark:bg-[#111722] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Edge Breakdown
            </h4>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#0B0F17] p-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
              {(
                [
                  ['INSTRUMENT', 'Market'],
                  ['HOUR', 'Hour'],
                  ['DIRECTION', 'Side'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBreakdownTab(id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                    breakdownTab === id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {breakdownRows.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
              Close trades to populate your edge breakdown by market, hour of day, and side.
            </div>
          ) : (
            <div className="space-y-2.5 overflow-y-auto max-h-[340px] pr-1">
              {breakdownRows.map((row) => {
                const wr = row.count > 0 ? (row.wins / row.count) * 100 : 0;
                return (
                  <div
                    key={row.label}
                    className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {row.label}
                      </span>
                      <span
                        className={`font-bold font-mono-tabular ${
                          row.pnl >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {row.pnl >= 0 ? '+' : ''}
                        {row.pnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      <span>
                        {row.wins}W / {row.count - row.wins}L ({row.count} trades)
                      </span>
                      <span className="font-mono-tabular font-semibold text-slate-700 dark:text-slate-300">
                        {wr.toFixed(0)}% Win Rate
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          wr >= 50 ? 'bg-emerald-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(4, wr))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
