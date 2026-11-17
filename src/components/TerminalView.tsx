import React, { useMemo } from 'react';
import { Activity, Cpu, Link2 } from 'lucide-react';
import {
  INSTRUMENTS,
  type GeneratedSignalPayload,
  type MarketQuoteResponse,
  type StoredTradeSignal,
  type StrategyConfig,
  type Timeframe,
} from '../types/trading';
import { TradingChart } from './TradingChart';
import { SignalCard } from './SignalCard';

const QUICK_TERMINAL_IDS = ['NIFTY50', 'XAUUSD', 'XAGUSD', 'BTCUSDT', 'MCX_CRUDEOIL'];

interface TerminalViewProps {
  selectedInstrumentId: string;
  onSelectInstrument: (id: string) => void;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  quote: MarketQuoteResponse | null;
  quoteLoading: boolean;
  onRefreshQuote: () => void;
  liveStreaming: boolean;
  onToggleLiveStreaming: () => void;
  config: StrategyConfig;
  openTradesCount: number;
  onOpenBrokerModal: () => void;
  onNavigateDashboard: () => void;
  signals: StoredTradeSignal[];
  liveSignal: GeneratedSignalPayload | null;
  analyzingLive: boolean;
  liveAnalysisError: string | null;
  onRunLiveAnalysis: () => Promise<void>;
  onSaveSignal: (signal: GeneratedSignalPayload, source: 'LIVE_MARKET') => Promise<void>;
  onSendTelegram: (signal: GeneratedSignalPayload) => Promise<void>;
  onLogPaperTrade: (signal: GeneratedSignalPayload) => Promise<void>;
  onOpenOrderModal: (signal: GeneratedSignalPayload) => void;
  savingSignal: boolean;
  sendingTelegram: boolean;
  telegramNote: string | null;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  selectedInstrumentId,
  onSelectInstrument,
  timeframe,
  onTimeframeChange,
  quote,
  quoteLoading,
  onRefreshQuote,
  liveStreaming,
  onToggleLiveStreaming,
  config,
  openTradesCount,
  onOpenBrokerModal,
  onNavigateDashboard,
  signals,
  liveSignal,
  analyzingLive,
  liveAnalysisError,
  onRunLiveAnalysis,
  onSaveSignal,
  onSendTelegram,
  onLogPaperTrade,
  onOpenOrderModal,
  savingSignal,
  sendingTelegram,
  telegramNote,
}) => {
  const activeInstruments = useMemo(() => {
    const list = INSTRUMENTS.filter(
      (i) => config.activeInstruments.length === 0 || config.activeInstruments.includes(i.id)
    );
    return list.length > 0 ? list : INSTRUMENTS;
  }, [config.activeInstruments]);

  const selectedInstrument = useMemo(
    () => INSTRUMENTS.find((i) => i.id === selectedInstrumentId) ?? INSTRUMENTS[0],
    [selectedInstrumentId]
  );

  const cur = quote?.instrument.currency ?? selectedInstrument.currency;
  const pos = (quote?.changePercent ?? 0) >= 0;

  return (
    <div className="space-y-5">
      {/* Terminal Header & Market Switching Bar */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Trading Terminal Market</label>
              <select
                value={selectedInstrumentId}
                onChange={(e) => onSelectInstrument(e.target.value)}
                className="bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-emerald-500"
              >
                {activeInstruments.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.symbol} · {inst.segment}
                  </option>
                ))}
              </select>
            </div>

            <div className="h-9 w-px bg-white/[0.08] hidden sm:block" />

            <div>
              <div className="text-[11px] text-slate-400">Live Spot / Last Price</div>
              {quote?.available && quote.price !== undefined ? (
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="font-mono-tabular text-lg font-bold text-white">
                    {cur}
                    {quote.price.toLocaleString()}
                  </span>
                  <span
                    className={`font-mono-tabular text-xs font-semibold ${
                      pos ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {pos ? '+' : ''}
                    {quote.changePercent?.toFixed(2)}%
                  </span>
                </div>
              ) : (
                <div className="text-sm font-semibold text-amber-400 mt-0.5">
                  {quoteLoading ? 'Fetching feed...' : 'DATA UNAVAILABLE'}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onNavigateDashboard}
              className="px-3 py-2 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Dashboard ({openTradesCount} Open)
            </button>

            <button
              type="button"
              onClick={onOpenBrokerModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Link2 className="w-3.5 h-3.5" />
              {config.brokerProviderLabel.split('·')[0].trim()}
            </button>

            <button
              type="button"
              onClick={onRunLiveAnalysis}
              disabled={analyzingLive}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Cpu className="w-4 h-4" />
              {analyzingLive
                ? `Running ${config.trendTimeframe} + ${config.entryTimeframe}...`
                : `Generate ${config.trendTimeframe}/${config.entryTimeframe} Signal`}
            </button>
          </div>
        </div>

        {/* Fast Market Switch Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/[0.06]">
          <span className="text-[11px] text-slate-400 mr-1">Priority Charts:</span>
          {QUICK_TERMINAL_IDS.map((id) => {
            const inst = INSTRUMENTS.find((x) => x.id === id);
            if (!inst) return null;
            const active = selectedInstrumentId === inst.id;
            return (
              <button
                key={inst.id}
                type="button"
                onClick={() => onSelectInstrument(inst.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#090B0E] border border-white/[0.08] text-slate-300 hover:text-white'
                }`}
              >
                {inst.symbol}
              </button>
            );
          })}
        </div>
      </div>

      {liveAnalysisError && (
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200">
          {liveAnalysisError}
        </div>
      )}

      {/* Main Candlestick Chart + Live Technical Matrix */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        <div className="xl:col-span-8">
          <TradingChart
            instrument={selectedInstrument}
            quote={quote}
            loading={quoteLoading}
            timeframe={timeframe}
            onTimeframeChange={onTimeframeChange}
            onRefresh={onRefreshQuote}
            liveStreaming={liveStreaming}
            onToggleLiveStreaming={onToggleLiveStreaming}
            config={config}
            activeSignal={liveSignal}
          />
        </div>

        <div className="xl:col-span-4 bg-[#11141A] border border-white/[0.08] rounded-xl p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Live Market Matrix</h3>
              </div>
              <span className="text-[11px] font-mono-tabular text-slate-400">
                {quote?.available ? timeframe.toUpperCase() : 'UNAVAILABLE'}
              </span>
            </div>

            {!quote?.available || !quote.technicals || !quote.levels ? (
              <div className="py-12 text-center text-xs text-slate-400">
                {quoteLoading ? 'Loading market matrix...' : 'DATA UNAVAILABLE for selected feed.'}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Open</span>
                    <span className="font-mono-tabular text-white">
                      {cur}
                      {quote.open}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Prev Close</span>
                    <span className="font-mono-tabular text-white">
                      {cur}
                      {quote.previousClose}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Day High</span>
                    <span className="font-mono-tabular text-emerald-400">
                      {cur}
                      {quote.high}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Day Low</span>
                    <span className="font-mono-tabular text-red-400">
                      {cur}
                      {quote.low}
                    </span>
                  </div>
                  <div className="flex justify-between col-span-2 pt-1 border-t border-white/[0.06]">
                    <span className="text-slate-400">Volume</span>
                    <span className="font-mono-tabular text-white">
                      {quote.volume?.toLocaleString() ?? 'N/A'}
                      {quote.technicals.volumeRatio ? ` (${quote.technicals.volumeRatio}x avg)` : ''}
                    </span>
                  </div>
                </div>

                <div className="border-t border-white/[0.08] pt-3 space-y-2 text-xs">
                  <div className="font-semibold text-slate-200">Technical Indicators</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Trend Bias</span>
                      <span
                        className={`font-semibold ${
                          quote.technicals.trendBias === 'BULLISH'
                            ? 'text-emerald-400'
                            : quote.technicals.trendBias === 'BEARISH'
                              ? 'text-red-400'
                              : 'text-amber-300'
                        }`}
                      >
                        {quote.technicals.trendBias}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">RSI ({config.rsiPeriod})</span>
                      <span className="font-mono-tabular text-white">
                        {quote.technicals.rsi ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">EMA {config.emaFast}</span>
                      <span className="font-mono-tabular text-amber-300">
                        {quote.technicals.ema9 ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">EMA {config.emaMid}</span>
                      <span className="font-mono-tabular text-sky-300">
                        {quote.technicals.ema20 ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">EMA {config.emaSlow}</span>
                      <span className="font-mono-tabular text-purple-300">
                        {quote.technicals.ema50 ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">VWAP</span>
                      <span className="font-mono-tabular text-slate-200">
                        {quote.technicals.vwap ?? '—'}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 pt-1">
                    Candle Pattern:{' '}
                    <span className="text-slate-200">{quote.technicals.candlePattern}</span>
                  </div>
                </div>

                <div className="border-t border-white/[0.08] pt-3 space-y-1.5 text-xs">
                  <div className="font-semibold text-slate-200">Support, Resistance & Zones</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Strong Res</span>
                      <span className="font-mono-tabular text-red-400">
                        {quote.levels.strongResistance}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Imm Res</span>
                      <span className="font-mono-tabular text-red-300">
                        {quote.levels.immediateResistance}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Imm Sup</span>
                      <span className="font-mono-tabular text-emerald-300">
                        {quote.levels.immediateSupport}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Strong Sup</span>
                      <span className="font-mono-tabular text-emerald-400">
                        {quote.levels.strongSupport}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Breakout</span>
                      <span className="font-mono-tabular text-sky-300">
                        {quote.levels.breakoutLevel}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Breakdown</span>
                      <span className="font-mono-tabular text-amber-300">
                        {quote.levels.breakdownLevel}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 pt-1">
                    No-Trade Zone:{' '}
                    <span className="font-mono-tabular text-amber-300">
                      {quote.levels.noTradeZoneLow} – {quote.levels.noTradeZoneHigh}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="text-[11px] text-slate-500 border-t border-white/[0.06] pt-2.5">
            {quote?.available
              ? `Latest tick: ${new Date(quote.marketTimestamp).toLocaleString()}`
              : 'Waiting for verified market feed'}
          </div>
        </div>
      </div>

      {/* Generated Signal Panel */}
      {liveSignal && (
        <SignalCard
          signal={liveSignal}
          savingSignal={savingSignal}
          sendingTelegram={sendingTelegram}
          telegramStatusNote={telegramNote}
          onSaveSignal={() => onSaveSignal(liveSignal, 'LIVE_MARKET')}
          onSendTelegram={() => onSendTelegram(liveSignal)}
          onLogPaperTrade={() => onLogPaperTrade(liveSignal)}
          onOpenOrderModal={() => onOpenOrderModal(liveSignal)}
        />
      )}

      {/* Historical Signal Log */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Terminal Signal Log</h3>
          <span className="text-xs text-slate-400 font-mono-tabular">{signals.length} Recorded</span>
        </div>
        {signals.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Click Generate {config.trendTimeframe}/{config.entryTimeframe} Signal above to run a live multi-timeframe setup analysis.
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
                {signals.slice(0, 8).map((s) => (
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
