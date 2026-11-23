import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Columns2, Cpu, Link2, Square } from 'lucide-react';
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

const QUICK_INDIAN_IDS = [
  'NIFTY50',
  'BANKNIFTY',
  'FINNIFTY',
  'SENSEX',
  'RELIANCE',
  'HDFCBANK',
  'SBIN',
  'INFY',
  'TCS',
];
const QUICK_INTL_IDS = [
  'XAUUSD',
  'XAGUSD',
  'MCX_CRUDEOIL',
  'USOIL',
  'NAS100',
  'SPX500',
  'EURUSD',
  'GBPUSD',
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
];

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
  const [secondaryInstrumentId, setSecondaryInstrumentId] = useState<string>(selectedInstrumentId);
  const [secondaryTimeframe, setSecondaryTimeframe] = useState<Timeframe>(() =>
    timeframe === '5m' ? config.trendTimeframe : '1h'
  );
  const [secondaryQuote, setSecondaryQuote] = useState<MarketQuoteResponse | null>(null);
  const [secondaryLoading, setSecondaryLoading] = useState(false);

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

        {/* Fast Market Switch Buttons */}
        <div className="space-y-2 pt-2.5 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1 min-w-[116px]">Indian Most Traded:</span>
            {QUICK_INDIAN_IDS.map((id) => {
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
                      ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 font-semibold'
                      : 'bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {inst.symbol}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1 min-w-[116px]">International &amp; MCX:</span>
            {QUICK_INTL_IDS.map((id) => {
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
                      ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 font-semibold'
                      : 'bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {inst.symbol}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {liveAnalysisError && (
        <div className="p-3.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/35 rounded-xl text-xs text-amber-800 dark:text-amber-200">
          {liveAnalysisError}
        </div>
      )}

      {/* Main Candlestick Chart(s) + Live Technical Matrix */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {splitChartMode ? (
          <div className="xl:col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-4">
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
              compact
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  Secondary MTF / Correlation Pane
                </span>
                <select
                  value={secondaryInstrumentId}
                  onChange={(e) => setSecondaryInstrumentId(e.target.value)}
                  className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-md px-2 py-1 text-xs font-semibold text-slate-900 dark:text-white"
                >
                  {INSTRUMENTS.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.symbol}
                    </option>
                  ))}
                </select>
              </div>
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
                compact
              />
            </div>
          </div>
        ) : (
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
              openTrades={openTrades}
              tradeProtectionMap={tradeProtectionMap}
              onLivePriceTick={onLivePriceTick}
              onQuickOrder={onQuickOrder}
              onQuickPriceAlert={onQuickPriceAlert}
            />
          </div>
        )}

        <div
          className={`${
            splitChartMode ? 'xl:col-span-12' : 'xl:col-span-4'
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
