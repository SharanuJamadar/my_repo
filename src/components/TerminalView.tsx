import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Columns2, Cpu, Link2, Send, Square, TrendingUp, Zap } from 'lucide-react';
import {
  INSTRUMENTS,
  type GeneratedSignalPayload,
  type MarketQuoteResponse,
  type StoredTradeSignal,
  type StrategyConfig,
  type Timeframe,
  type TradeJournalEntry,
  type TradeTrailState,
} from '../types/trading';
import { TradingChart } from './TradingChart';
import { SignalCard } from './SignalCard';
import { buildMrxSignalPayload, evaluateMrxReversalStrategy } from '../lib/mrxStrategy';

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
  openTrades?: TradeJournalEntry[];
  tradeProtectionMap?: Record<string, TradeTrailState>;
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
  onLivePriceTick?: (instrumentId: string, price: number) => void;
  onQuickOrder?: (side: 'BUY' | 'SELL', quantity: number) => Promise<void> | void;
  onQuickPriceAlert?: (price: number) => void;
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
  openTrades,
  tradeProtectionMap,
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
  onLivePriceTick,
  onQuickOrder,
  onQuickPriceAlert,
}) => {
  const [splitChartMode, setSplitChartMode] = useState(false);
  const [mrXEnabled, setMrXEnabled] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem('mytrade_terminal_mrx_enabled');
      return saved === null ? true : saved === '1';
    } catch {
      return true;
    }
  });
  const [focusMyTradeChartSignal, setFocusMyTradeChartSignal] = useState(0);
  const [secondaryInstrumentId, setSecondaryInstrumentId] = useState<string>(selectedInstrumentId);
  const [secondaryTimeframe, setSecondaryTimeframe] = useState<Timeframe>(() =>
    timeframe === '5m' ? config.trendTimeframe : '1h'
  );
  const [secondaryQuote, setSecondaryQuote] = useState<MarketQuoteResponse | null>(null);
  const [secondaryLoading, setSecondaryLoading] = useState(false);

  const toggleMrX = useCallback(() => {
    setMrXEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('mytrade_terminal_mrx_enabled', next ? '1' : '0');
      } catch {
        // Ignore storage errors
      }
      if (next) {
        setFocusMyTradeChartSignal((c) => c + 1);
      }
      return next;
    });
  }, []);

  // Sync secondary chart instrument when primary changes if user hasn't diverged or on initial enable
  useEffect(() => {
    setSecondaryInstrumentId(selectedInstrumentId);
  }, [selectedInstrumentId]);

  const fetchSecondaryQuote = useCallback(
    async (silent = false) => {
      if (!splitChartMode) return;
      if (!silent) setSecondaryLoading(true);
      try {
        const qs = new URLSearchParams({
          instrument: secondaryInstrumentId,
          timeframe: secondaryTimeframe,
          emaFast: String(config.emaFast),
          emaMid: String(config.emaMid),
          emaSlow: String(config.emaSlow),
          rsiPeriod: String(config.rsiPeriod),
        });
        const res = await fetch(`/api/market/quote?${qs.toString()}`);
        if (res.ok) {
          const data = (await res.json()) as MarketQuoteResponse;
          setSecondaryQuote(data);
        }
      } catch {
        // Keep last valid quote
      } finally {
        if (!silent) setSecondaryLoading(false);
      }
    },
    [
      splitChartMode,
      secondaryInstrumentId,
      secondaryTimeframe,
      config.emaFast,
      config.emaMid,
      config.emaSlow,
      config.rsiPeriod,
    ]
  );

  useEffect(() => {
    if (!splitChartMode) return;
    void fetchSecondaryQuote(false);
    if (!liveStreaming) return;
    const timer = window.setInterval(() => void fetchSecondaryQuote(true), 5000);
    return () => window.clearInterval(timer);
  }, [splitChartMode, liveStreaming, fetchSecondaryQuote]);
  const indianInstruments = useMemo(
    () => INSTRUMENTS.filter((i) => i.segment === 'INDIAN'),
    []
  );
  const mcxInstruments = useMemo(
    () => INSTRUMENTS.filter((i) => i.segment === 'MCX'),
    []
  );
  const intlInstruments = useMemo(
    () => INSTRUMENTS.filter((i) => i.segment === 'INTERNATIONAL'),
    []
  );

  const selectedInstrument = useMemo(
    () => INSTRUMENTS.find((i) => i.id === selectedInstrumentId) ?? INSTRUMENTS[0],
    [selectedInstrumentId]
  );

  const secondaryInstrument = useMemo(
    () => INSTRUMENTS.find((i) => i.id === secondaryInstrumentId) ?? selectedInstrument,
    [secondaryInstrumentId, selectedInstrument]
  );

  const cur = quote?.instrument.currency ?? selectedInstrument.currency;
  const pos = (quote?.changePercent ?? 0) >= 0;

  const mrxEvaluation = useMemo(
    () => (quote?.available && quote.candles?.length ? evaluateMrxReversalStrategy(quote.candles) : null),
    [quote]
  );

  const handleMrxAction = useCallback(
    (action: 'ORDER' | 'PAPER' | 'TELEGRAM') => {
      if (!mrxEvaluation?.latest || !quote?.price) return;
      const dir: 'BUY' | 'SELL' =
        mrxEvaluation.lastSignal?.direction ??
        (mrxEvaluation.latest.aboveEma200 ? 'BUY' : 'SELL');
      const payload = buildMrxSignalPayload({
        instrument: selectedInstrument,
        timeframe,
        direction: dir,
        spotPrice: quote.price,
        atr: quote.technicals?.atr,
        evaluation: mrxEvaluation,
      });
      if (action === 'ORDER') onOpenOrderModal(payload);
      else if (action === 'PAPER') void onLogPaperTrade(payload);
      else void onSendTelegram(payload);
    },
    [
      mrxEvaluation,
      quote,
      selectedInstrument,
      timeframe,
      onOpenOrderModal,
      onLogPaperTrade,
      onSendTelegram,
    ]
  );

  return (
    <div className="space-y-5">
      {/* Terminal Header & Market Switching Bar */}
      <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                Trading Terminal Market ({INSTRUMENTS.length} Live Charts)
              </label>
              <select
                value={selectedInstrumentId}
                onChange={(e) => onSelectInstrument(e.target.value)}
                className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <optgroup label="Indian Markets (Indices & NSE F&O)">
                  {indianInstruments.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.symbol} · {inst.exchangeLabel}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="MCX Commodities">
                  {mcxInstruments.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.symbol} · {inst.exchangeLabel}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="International (Metals, US Indices, FX & Crypto)">
                  {intlInstruments.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.symbol} · {inst.exchangeLabel}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="h-9 w-px bg-slate-200 dark:bg-white/[0.08] hidden sm:block" />

            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Live Spot / Last Price</div>
              {quote?.available && quote.price !== undefined ? (
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="font-mono-tabular text-lg font-bold text-slate-900 dark:text-white">
                    {cur}
                    {quote.price.toLocaleString()}
                  </span>
                  <span
                    className={`font-mono-tabular text-xs font-semibold ${
                      pos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {pos ? '+' : ''}
                    {quote.changePercent?.toFixed(2)}%
                  </span>
                </div>
              ) : (
                <div className="text-sm font-semibold text-amber-700 dark:text-amber-400 mt-0.5">
                  {quoteLoading ? 'Fetching feed...' : 'DATA UNAVAILABLE'}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Single vs Dual Multi-Timeframe Split Chart Toggle */}
            <div className="flex items-center bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setSplitChartMode(false)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  !splitChartMode
                    ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Square className="w-3.5 h-3.5" />
                1 Chart
              </button>
              <button
                type="button"
                onClick={() => setSplitChartMode(true)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  splitChartMode
                    ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Columns2 className="w-3.5 h-3.5" />
                Dual MTF Split
              </button>
            </div>

            <button
              type="button"
              onClick={toggleMrX}
              title="Plot MR_X EMA 9 / 15 / 200 Reversal strategy & BUY/SELL markers on the main terminal chart"
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                mrXEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/45 text-emerald-700 dark:text-emerald-300'
                  : 'bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>MR_X 9-15-200 {mrXEnabled ? 'ON' : 'OFF'}</span>
            </button>

            <button
              type="button"
              onClick={onNavigateDashboard}
              className="px-3 py-2 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Dashboard ({openTradesCount} Open)
            </button>

            <button
              type="button"
              onClick={onOpenBrokerModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-blue-700 dark:text-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Link2 className="w-3.5 h-3.5" />
              {config.brokerProviderLabel.split('·')[0].trim()}
            </button>

            <button
              type="button"
              onClick={onRunLiveAnalysis}
              disabled={analyzingLive}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-blue-700 dark:bg-sky-500 hover:bg-blue-800 dark:hover:bg-sky-400 text-white dark:text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Cpu className="w-4 h-4" />
              {analyzingLive
                ? `Running ${config.trendTimeframe} + ${config.entryTimeframe}...`
                : `Generate ${config.trendTimeframe}/${config.entryTimeframe} Signal`}
            </button>
          </div>
        </div>
      </div>

      {liveAnalysisError && (
        <div className="p-3.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/35 rounded-xl text-xs text-amber-800 dark:text-amber-200">
          {liveAnalysisError}
        </div>
      )}

      {/* Main Candlestick Chart(s) + Live Technical Matrix */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        {splitChartMode ? (
          <div className="xl:col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
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
              openTrades={openTrades}
              tradeProtectionMap={tradeProtectionMap}
              onLivePriceTick={onLivePriceTick}
              onQuickOrder={onQuickOrder}
              onQuickPriceAlert={onQuickPriceAlert}
              mrXEnabled={mrXEnabled}
              onToggleMrX={toggleMrX}
              focusMyTradeChartSignal={focusMyTradeChartSignal}
              compact
            />
            <TradingChart
              instrument={secondaryInstrument}
              quote={secondaryQuote}
              loading={secondaryLoading}
              timeframe={secondaryTimeframe}
              onTimeframeChange={setSecondaryTimeframe}
              onRefresh={() => void fetchSecondaryQuote(false)}
              liveStreaming={liveStreaming}
              onToggleLiveStreaming={onToggleLiveStreaming}
              config={config}
              openTrades={openTrades}
              tradeProtectionMap={tradeProtectionMap}
              onQuickPriceAlert={onQuickPriceAlert}
              headerAccessory={
                <select
                  value={secondaryInstrumentId}
                  onChange={(e) => setSecondaryInstrumentId(e.target.value)}
                  aria-label="Secondary chart instrument"
                  className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                >
                  {INSTRUMENTS.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.symbol}
                    </option>
                  ))}
                </select>
              }
              secondaryStrip={
                <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E182A] flex flex-wrap items-center justify-between gap-2.5 text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      MTF Correlation Pane
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="font-mono-tabular text-slate-600 dark:text-slate-300">
                      {secondaryQuote?.technicals?.trendBias
                        ? `Bias: ${secondaryQuote.technicals.trendBias}`
                        : 'Syncing HTF structure'}
                    </span>
                    {typeof secondaryQuote?.technicals?.rsi === 'number' && (
                      <>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono-tabular text-slate-600 dark:text-slate-300">
                          RSI {secondaryQuote.technicals.rsi}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Pair / Index
                    </span>
                    <select
                      value={secondaryInstrumentId}
                      onChange={(e) => setSecondaryInstrumentId(e.target.value)}
                      aria-label="Select secondary MTF market"
                      className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    >
                      {INSTRUMENTS.map((inst) => (
                        <option key={inst.id} value={inst.id}>
                          {inst.symbol}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              }
              compact
            />
          </div>
        ) : (
          <div className="xl:col-span-9">
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
              openTrades={openTrades}
              tradeProtectionMap={tradeProtectionMap}
              onLivePriceTick={onLivePriceTick}
              onQuickOrder={onQuickOrder}
              onQuickPriceAlert={onQuickPriceAlert}
              mrXEnabled={mrXEnabled}
              onToggleMrX={toggleMrX}
              focusMyTradeChartSignal={focusMyTradeChartSignal}
            />
          </div>
        )}

        <div
          className={`${
            splitChartMode ? 'xl:col-span-12' : 'xl:col-span-3'
          } bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-4`}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Live Market Matrix</h3>
              </div>
              <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                {quote?.available ? timeframe.toUpperCase() : 'UNAVAILABLE'}
              </span>
            </div>

            {!quote?.available || !quote.technicals || !quote.levels ? (
              <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                {quoteLoading ? 'Loading market matrix...' : 'DATA UNAVAILABLE for selected feed.'}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Open</span>
                    <span className="font-mono-tabular text-slate-900 dark:text-white">
                      {cur}
                      {quote.open}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Prev Close</span>
                    <span className="font-mono-tabular text-slate-900 dark:text-white">
                      {cur}
                      {quote.previousClose}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Day High</span>
                    <span className="font-mono-tabular text-emerald-700 dark:text-emerald-400">
                      {cur}
                      {quote.high}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Day Low</span>
                    <span className="font-mono-tabular text-rose-700 dark:text-rose-400">
                      {cur}
                      {quote.low}
                    </span>
                  </div>
                  <div className="flex justify-between col-span-2 pt-1 border-t border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Bid / Ask (Spread)</span>
                    <span className="font-mono-tabular text-slate-900 dark:text-white">
                      {typeof quote.bid === 'number' && typeof quote.ask === 'number'
                        ? `${cur}${quote.bid} / ${cur}${quote.ask}${
                            typeof quote.spreadBps === 'number' ? ` (${quote.spreadBps.toFixed(1)} bps)` : ''
                          }`
                        : 'Spot Mid'}
                    </span>
                  </div>
                  <div className="flex justify-between col-span-2">
                    <span className="text-slate-500 dark:text-slate-400">Volume</span>
                    <span className="font-mono-tabular text-slate-900 dark:text-white">
                      {quote.volume?.toLocaleString() ?? 'N/A'}
                      {quote.technicals.volumeRatio ? ` (${quote.technicals.volumeRatio}x avg)` : ''}
                    </span>
                  </div>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2 text-xs">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Technical Indicators &amp; Regime</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Trend Bias</span>
                      <span
                        className={`font-semibold ${
                          quote.technicals.trendBias === 'BULLISH'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : quote.technicals.trendBias === 'BEARISH'
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {quote.technicals.trendBias}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Regime</span>
                      <span
                        className={`font-semibold ${
                          quote.technicals.regime === 'TRENDING'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : quote.technicals.regime === 'SQUEEZE'
                              ? 'text-blue-700 dark:text-sky-300'
                              : 'text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {quote.technicals.regime ?? 'TRENDING'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">RSI ({config.rsiPeriod})</span>
                      <span className="font-mono-tabular text-slate-900 dark:text-white">
                        {quote.technicals.rsi ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">ADX (14)</span>
                      <span
                        className={`font-mono-tabular font-semibold ${
                          typeof quote.technicals.adx === 'number' &&
                          quote.technicals.adx >= (config.adxMinThreshold ?? 18)
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {typeof quote.technicals.adx === 'number'
                          ? quote.technicals.adx.toFixed(1)
                          : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">EMA {config.emaFast}</span>
                      <span className="font-mono-tabular text-amber-700 dark:text-amber-300">
                        {quote.technicals.ema9 ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">EMA {config.emaMid}</span>
                      <span className="font-mono-tabular text-blue-700 dark:text-sky-300">
                        {quote.technicals.ema20 ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">EMA {config.emaSlow}</span>
                      <span className="font-mono-tabular text-purple-700 dark:text-purple-300">
                        {quote.technicals.ema50 ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">VWAP</span>
                      <span className="font-mono-tabular text-slate-800 dark:text-slate-200">
                        {quote.technicals.vwap ?? '—'}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                    Candle Pattern:{' '}
                    <span className="text-slate-800 dark:text-slate-200">{quote.technicals.candlePattern}</span>
                  </div>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-1.5 text-xs">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Support, Resistance & Zones</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Strong Res</span>
                      <span className="font-mono-tabular text-rose-700 dark:text-rose-400">
                        {quote.levels.strongResistance}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Imm Res</span>
                      <span className="font-mono-tabular text-rose-700 dark:text-rose-300">
                        {quote.levels.immediateResistance}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Imm Sup</span>
                      <span className="font-mono-tabular text-emerald-700 dark:text-emerald-300">
                        {quote.levels.immediateSupport}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Strong Sup</span>
                      <span className="font-mono-tabular text-emerald-700 dark:text-emerald-400">
                        {quote.levels.strongSupport}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Breakout</span>
                      <span className="font-mono-tabular text-blue-700 dark:text-sky-300">
                        {quote.levels.breakoutLevel}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Breakdown</span>
                      <span className="font-mono-tabular text-amber-700 dark:text-amber-300">
                        {quote.levels.breakdownLevel}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                    No-Trade Zone:{' '}
                    <span className="font-mono-tabular text-amber-700 dark:text-amber-300">
                      {quote.levels.noTradeZoneLow} – {quote.levels.noTradeZoneHigh}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="text-[11px] text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-2.5">
            {quote?.available
              ? `Latest tick: ${new Date(quote.marketTimestamp).toLocaleString()}`
              : 'Waiting for verified market feed'}
          </div>
        </div>
      </div>

      {/* MR_X EMA 9-15-200 Reversal Live Terminal Strategy Panel */}
      {mrXEnabled && (
        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2.5">
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                MR_X EMA 9-15-200 Reversal
              </h3>
              <span className="text-[11px] font-mono-tabular px-2 py-0.5 rounded bg-slate-100 dark:bg-[#08101E] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                {selectedInstrument.symbol} · {timeframe.toUpperCase()}
              </span>
              {mrxEvaluation && (
                <span
                  className={`text-[11px] font-mono-tabular font-semibold px-2 py-0.5 rounded ${
                    mrxEvaluation.positionState === 'LONG'
                      ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/35'
                      : mrxEvaluation.positionState === 'SHORT'
                        ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/35'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  State: {mrxEvaluation.positionState}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFocusMyTradeChartSignal((c) => c + 1)}
                className="px-2.5 py-1.5 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors"
              >
                Plot on Live Chart
              </button>
              <button
                type="button"
                disabled={!mrxEvaluation?.latest || !quote?.price}
                onClick={() => handleMrxAction('ORDER')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-45"
              >
                <Zap className="w-3.5 h-3.5" />
                Execute {mrxEvaluation?.lastSignal?.direction ?? (mrxEvaluation?.latest?.aboveEma200 ? 'BUY' : 'SELL')}
              </button>
              <button
                type="button"
                disabled={!mrxEvaluation?.latest || !quote?.price || sendingTelegram}
                onClick={() => handleMrxAction('TELEGRAM')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-blue-700 dark:text-sky-300 rounded-lg transition-colors disabled:opacity-45"
              >
                <Send className="w-3.5 h-3.5" />
                Alert
              </button>
            </div>
          </div>

          {!mrxEvaluation?.latest ? (
            <div className="py-4 text-xs text-slate-500 dark:text-slate-400">
              Waiting for live candles to compute EMA 9 / EMA 15 / EMA 200 reversal signals.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-3 text-xs">
              <div className="p-2.5 rounded-lg bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">EMA 9 (Green)</div>
                <div className="font-mono-tabular text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {cur}
                  {mrxEvaluation.latest.ema9}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">EMA 15 (Orange)</div>
                <div className="font-mono-tabular text-sm font-bold text-orange-600 dark:text-orange-400 mt-0.5">
                  {cur}
                  {mrxEvaluation.latest.ema15}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">EMA 200 (Red)</div>
                <div className="font-mono-tabular text-sm font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                  {cur}
                  {mrxEvaluation.latest.ema200}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Macro Filter</div>
                <div
                  className={`text-xs font-semibold mt-1 ${
                    mrxEvaluation.latest.aboveEma200
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {mrxEvaluation.latest.aboveEma200
                    ? 'Close > EMA 200 (BUY Zone)'
                    : 'Close < EMA 200 (SELL Zone)'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 col-span-2 md:col-span-1">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Last Reversal ({mrxEvaluation.signals.length} on chart)
                </div>
                {mrxEvaluation.lastSignal ? (
                  <div className="mt-0.5 flex items-baseline justify-between gap-1.5">
                    <span
                      className={`font-bold ${
                        mrxEvaluation.lastSignal.direction === 'BUY'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {mrxEvaluation.lastSignal.direction}
                    </span>
                    <span className="font-mono-tabular text-slate-800 dark:text-slate-200">
                      {cur}
                      {mrxEvaluation.lastSignal.price}
                    </span>
                  </div>
                ) : (
                  <div className="text-slate-500 dark:text-slate-400 mt-1">Awaiting 9/15 cross</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
      <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Terminal Signal Log</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">{signals.length} Recorded</span>
        </div>
        {signals.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Click Generate {config.trendTimeframe}/{config.entryTimeframe} Signal above to run a live multi-timeframe setup analysis.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Instrument</th>
                  <th className="py-2.5 px-4 font-medium">Contract</th>
                  <th className="py-2.5 px-4 font-medium">Direction</th>
                  <th className="py-2.5 px-4 font-medium text-right">Entry</th>
                  <th className="py-2.5 px-4 font-medium text-right">SL / T1 / T2</th>
                  <th className="py-2.5 px-4 font-medium text-right">Score</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {signals.slice(0, 8).map((s) => (
                  <tr key={s.id} className="hover:bg-slate-100 dark:hover:bg-white/[0.06]">
                    <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">{s.instrument}</td>
                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{s.contract}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={
                          s.direction === 'BUY'
                            ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                            : s.direction === 'SELL'
                              ? 'text-rose-700 dark:text-rose-400 font-medium'
                              : 'text-amber-700 dark:text-amber-300 font-medium'
                        }
                      >
                        {s.direction}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-900 dark:text-white">
                      {s.entryPrice || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-500 dark:text-slate-400">
                      {s.stopLoss || '—'} / {s.target1 || '—'} / {s.target2 || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-900 dark:text-white">
                      {s.qualityScore}/100
                    </td>
                    <td className="py-2.5 px-4 text-slate-800 dark:text-slate-200">{s.status}</td>
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
