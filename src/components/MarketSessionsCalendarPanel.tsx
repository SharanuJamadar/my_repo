import React, { useMemo } from 'react';
import { CalendarClock, Globe, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { EconomicCalendarResponse } from '../types/trading';

interface Props {
  calendar: EconomicCalendarResponse | null;
  loading: boolean;
  pauseOnHighImpactNews: boolean;
  onRefresh: () => void;
}

function formatCountdown(minutes: number): string {
  if (minutes <= 0 && minutes >= -15) return 'LIVE WINDOW';
  if (minutes < -15) return `${Math.abs(minutes)}m ago`;
  if (minutes < 60) return `in ${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs < 24) return `in ${hrs}h ${mins}m`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return `in ${days}d ${remHrs}h`;
}

export const MarketSessionsCalendarPanel: React.FC<Props> = ({
  calendar,
  loading,
  pauseOnHighImpactNews,
  onRefresh,
}) => {
  const highImpactEvents = useMemo(
    () => (calendar?.events ?? []).slice(0, 6),
    [calendar?.events]
  );

  const blackoutActive = Boolean(calendar?.highImpactBlackout?.active);

  return (
    <div className="bg-white dark:bg-[#111722] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Global Market Sessions &amp; Economic Calendar
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              blackoutActive && pauseOnHighImpactNews
                ? 'text-rose-600 dark:text-rose-400'
                : pauseOnHighImpactNews
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {blackoutActive && pauseOnHighImpactNews ? (
              <ShieldAlert className="w-3.5 h-3.5" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            {blackoutActive && pauseOnHighImpactNews
              ? `News Shield Paused Auto-Trade (±15m)`
              : pauseOnHighImpactNews
                ? 'News Shield Armed (±15m High-Impact)'
                : 'News Shield Off'}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Live Session Clocks Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800">
        {(calendar?.sessions ?? []).map((sess) => (
          <div key={sess.id} className="px-4 py-3 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-white">
                {sess.name}
              </span>
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide ${
                  sess.isOpen
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {sess.isOpen ? 'OPEN' : 'CLOSED'}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-base font-bold font-mono-tabular text-slate-900 dark:text-slate-100">
                {sess.localTime}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {sess.statusDetail}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {sess.markets}
            </div>
          </div>
        ))}
        {(!calendar || calendar.sessions.length === 0) && (
          <div className="col-span-4 px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
            Loading live global trading sessions...
          </div>
        )}
      </div>

      {/* Upcoming High-Impact Macro Events */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <CalendarClock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            Upcoming High &amp; Medium Impact Macro Releases
          </div>
          {calendar?.source && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {calendar.source}
            </span>
          )}
        </div>

        {blackoutActive && calendar?.highImpactBlackout?.eventTitle && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
            <span>
              <strong>High-Impact Volatility Window:</strong>{' '}
              {calendar.highImpactBlackout.eventTitle} (
              {formatCountdown(calendar.highImpactBlackout.minutesUntil ?? 0)}).
              {pauseOnHighImpactNews
                ? ' Automated entries are paused to avoid news slippage.'
                : ' Exercise elevated caution on spreads.'}
            </span>
          </div>
        )}

        {highImpactEvents.length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 py-2">
            No imminent high-impact macro releases in the next window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-medium">Impact</th>
                  <th className="py-2 pr-3 font-medium">Ccy</th>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium text-right">Forecast / Prev</th>
                  <th className="py-2 font-medium text-right">Countdown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {highImpactEvents.map((ev) => (
                  <tr
                    key={ev.id}
                    className={
                      ev.isImminent
                        ? 'bg-rose-50/60 dark:bg-rose-950/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }
                  >
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span
                        className={`text-[11px] font-bold ${
                          ev.impact === 'HIGH'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {ev.impact}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono-tabular font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      {ev.currency}
                    </td>
                    <td className="py-2 pr-3 text-slate-900 dark:text-slate-100 font-medium">
                      {ev.title}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono-tabular text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {ev.forecast || '—'} / {ev.previous || '—'}
                    </td>
                    <td
                      className={`py-2 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                        ev.isImminent
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {formatCountdown(ev.minutesUntil)}
                    </td>
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
