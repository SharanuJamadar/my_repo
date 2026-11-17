import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  ClipboardCopy,
  Send,
  ShieldCheck,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import type { GeneratedSignalPayload } from '../types/trading';

interface SignalCardProps {
  signal: GeneratedSignalPayload;
  onSaveSignal?: () => void;
  onSendTelegram?: () => void;
  onLogPaperTrade?: () => void;
  onOpenOrderModal?: () => void;
  savingSignal?: boolean;
  sendingTelegram?: boolean;
  telegramStatusNote?: string | null;
}

export const SignalCard: React.FC<SignalCardProps> = ({
  signal,
  onSaveSignal,
  onSendTelegram,
  onLogPaperTrade,
  onOpenOrderModal,
  savingSignal,
  sendingTelegram,
  telegramStatusNote,
}) => {
  const [copiedMode, setCopiedMode] = useState<'SIGNAL' | 'TELEGRAM' | null>(null);

  const handleCopy = async (mode: 'SIGNAL' | 'TELEGRAM') => {
    const text = mode === 'TELEGRAM' ? signal.telegramReadyText : signal.formattedSignalText;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMode(mode);
      setTimeout(() => setCopiedMode(null), 2000);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const isBuy = signal.direction === 'BUY';
  const isSell = signal.direction === 'SELL';
  const isNoTrade = signal.direction === 'NO_TRADE';

  return (
    <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400">
            My Trade · {signal.entryTimeframe} Entry / {signal.trendTimeframe} Trend
          </div>
          <div className="mt-1 flex items-center gap-2.5">
            {isBuy && <TrendingUp className="w-5 h-5 text-emerald-400" />}
            {isSell && <TrendingDown className="w-5 h-5 text-red-400" />}
            <h3 className="text-lg font-semibold text-white">
              {signal.instrument} — {signal.contract}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-slate-400">Setup Quality Score</div>
            <div className="font-mono-tabular text-xl font-bold text-white">
              {signal.qualityScore}
              <span className="text-xs font-normal text-slate-400"> / 100</span>
            </div>
          </div>
          <div
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border whitespace-nowrap shrink-0 ${
              isBuy
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                : isSell
                  ? 'bg-red-500/10 border-red-500/40 text-red-300'
                  : 'bg-amber-500/10 border-amber-500/40 text-amber-300'
            }`}
          >
            {isNoTrade ? 'NO TRADE' : `${signal.direction} · ${signal.status}`}
          </div>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Exact My Trade Signal Output */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#090B0E] border border-white/[0.08] rounded-lg p-4">
            <pre className="font-mono-tabular text-xs leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
              {signal.formattedSignalText}
            </pre>
          </div>

          {signal.atmOptionContext && (
            <div className="bg-[#090B0E] border border-white/[0.08] rounded-lg p-3.5 space-y-1.5">
              <div className="text-xs font-semibold text-slate-200">
                ATM / Near-ATM Option Focus (Spot: {signal.atmOptionContext.spotPrice})
              </div>
              <div className="font-mono-tabular text-xs text-emerald-300">
                Primary Strike: {signal.atmOptionContext.recommendedStrike}{' '}
                {signal.atmOptionContext.optionType} · Near-ATM:{' '}
                {signal.atmOptionContext.nearAtmStrikes.join(' / ')}
              </div>
              <p className="text-xs text-slate-400">{signal.atmOptionContext.note}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleCopy('SIGNAL')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {copiedMode === 'SIGNAL' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <ClipboardCopy className="w-3.5 h-3.5" />
              )}
              {copiedMode === 'SIGNAL' ? 'Copied Signal' : 'Copy Signal'}
            </button>

            <button
              onClick={() => handleCopy('TELEGRAM')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {copiedMode === 'TELEGRAM' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <ClipboardCopy className="w-3.5 h-3.5" />
              )}
              {copiedMode === 'TELEGRAM' ? 'Copied Telegram Text' : 'Export Telegram Format'}
            </button>

            {onSendTelegram && (
              <button
                onClick={onSendTelegram}
                disabled={sendingTelegram}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {sendingTelegram ? 'Dispatching...' : 'Send to Telegram'}
              </button>
            )}

            {onSaveSignal && (
              <button
                onClick={onSaveSignal}
                disabled={savingSignal}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {savingSignal ? 'Saving...' : 'Save Signal'}
              </button>
            )}

            {!isNoTrade && onLogPaperTrade && (
              <button
                onClick={onLogPaperTrade}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-white/[0.1] text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Log Paper Trade
              </button>
            )}

            {!isNoTrade && onOpenOrderModal && (
              <button
                onClick={onOpenOrderModal}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                Execute Order
              </button>
            )}
          </div>

          {telegramStatusNote && (
            <p className="text-xs text-slate-300 bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2">
              {telegramStatusNote}
            </p>
          )}
        </div>

        {/* Right: Transparent Quality Breakdown, Checklist, Reasons For/Against */}
        <div className="lg:col-span-7 space-y-4">
          {signal.aiNarrative && (
            <div className="bg-[#090B0E] border border-white/[0.08] rounded-lg p-3.5">
              <div className="text-xs font-semibold text-slate-200 mb-1">Quantitative Analysis Summary</div>
              <p className="text-xs text-slate-300 leading-relaxed">{signal.aiNarrative}</p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-200">
                Strategy Confirmation Checklist
              </h4>
              <span className="text-[11px] text-slate-400">
                Rule alignment metric (not a guaranteed win rate)
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {signal.checklist.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-[#090B0E] border border-white/[0.06] rounded-lg px-3 py-2 flex items-start gap-2"
                >
                  {item.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200">{item.label}</div>
                    <div className="text-[11px] text-slate-400 leading-snug">{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-[#090B0E] border border-white/[0.06] rounded-lg p-3">
              <div className="text-xs font-semibold text-emerald-400 mb-1.5">Reasons Supporting Trade</div>
              {signal.reasonsFor.length === 0 ? (
                <p className="text-xs text-slate-500">None meeting strict criteria.</p>
              ) : (
                <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
                  {signal.reasonsFor.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-[#090B0E] border border-white/[0.06] rounded-lg p-3">
              <div className="text-xs font-semibold text-red-400 mb-1.5">Reasons Against / Risks</div>
              {signal.reasonsAgainst.length === 0 ? (
                <p className="text-xs text-slate-500">No major structural conflicts detected.</p>
              ) : (
                <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
                  {signal.reasonsAgainst.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {signal.verifiedVsEstimated && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-[#090B0E] border border-white/[0.06] rounded-lg p-3">
                <div className="text-xs font-semibold text-sky-300 mb-1.5">Verified From Screenshot</div>
                <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
                  {signal.verifiedVsEstimated.verifiedFromDataOrChart.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
              <div className="bg-[#090B0E] border border-white/[0.06] rounded-lg p-3">
                <div className="text-xs font-semibold text-amber-300 mb-1.5">Estimated / Not Visible</div>
                <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
                  {signal.verifiedVsEstimated.estimatedOrNotVisible.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
