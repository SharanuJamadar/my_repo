import React from 'react';
import {
  Activity,
  Bot,
  Code2,
  MessageSquare,
  Play,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import type {
  ChatMessageRecord,
  ExecutionOrderRecord,
  GeneratedSignalPayload,
  PineBotActivityLog,
  PineBotEvaluationResult,
  PineStrategyRecord,
  StoredTradeSignal,
  StrategyConfig,
  TelegramLogRecord,
  TradeJournalEntry,
} from '../types/trading';
import type { AutoScanMarketItem } from './DashboardView';
import { WatchlistView } from './WatchlistView';
import { ChartAnalysisBotView } from './ChartAnalysisBotView';
import { ChatbotView } from './ChatbotView';
import { PineStrategyBotView } from './PineStrategyBotView';
import { ExecutionTelegramView } from './ExecutionTelegramView';

export type AnalyzerSubTab =
  | 'auto-analyzer'
  | 'screener'
  | 'chart-ai'
  | 'ai-assistant'
  | 'pine-bot'
  | 'signals-orders';

interface AnalyzerHubViewProps {
  activeSubTab: AnalyzerSubTab;
  onSubTabChange: (tab: AnalyzerSubTab) => void;
  selectedInstrumentId: string;
  onSelectInstrumentForTerminal: (id: string) => void;
  config: StrategyConfig;
  trades: TradeJournalEntry[];
  signals: StoredTradeSignal[];
  orders: ExecutionOrderRecord[];
  telegramLogs: TelegramLogRecord[];
  chatMessages: ChatMessageRecord[];
  pineStrategies: PineStrategyRecord[];
  pineBotLogs: PineBotActivityLog[];
  integrationStatus: {
    telegramConfigured: boolean;
    telegramChatConfigured: boolean;
    telegramBotUsername: string | null;
    brokerConfigured: boolean;
  };
  // Auto-analyzer state & actions (strictly OFF by default)
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
  // Chart AI, Chatbot, Pine & Execution handlers
  onSaveSignal: (
    signal: GeneratedSignalPayload,
    source: 'LIVE_MARKET' | 'CHART_UPLOAD' | 'CHATBOT'
  ) => Promise<void>;
  onDispatchTelegram: (payload: {
    signalId?: string;
    instrument: string;
    eventType: 'SIGNAL' | 'TARGET_HIT' | 'SL_HIT' | 'MARKET_UPDATE';
    messageText: string;
  }) => Promise<void>;
  onLogPaperTrade: (signal: GeneratedSignalPayload) => Promise<void>;
  onOpenOrderModal: (signal: GeneratedSignalPayload) => void;
  onUpdateInstrumentSelection: (id: string) => void;
  onSendUserMessage: (content: string, instrumentContext?: string) => Promise<void>;
  onSaveAssistantMessage: (content: string, instrumentContext?: string) => Promise<void>;
  onClearChatHistory: () => Promise<void>;
  onSavePineStrategy: (
    item: Omit<PineStrategyRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => Promise<void>;
  onDeletePineStrategy: (strategyId: string) => Promise<void>;
  onTogglePineBot: (strategy: PineStrategyRecord) => Promise<void>;
  onCheckPineBotNow: (strategy: PineStrategyRecord) => Promise<PineBotEvaluationResult | null>;
  onUpdateChannelLabel: (label: string) => Promise<void>;
  onUpdateSignalStatus: (
    signalId: string,
    status: StoredTradeSignal['status']
  ) => Promise<void>;
}

function normalizeKey(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const SUB_TABS: {
  id: AnalyzerSubTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'auto-analyzer', label: 'Trade Auto-Analyzer', icon: Bot },
  { id: 'screener', label: 'Scripts Screener (32)', icon: Activity },
  { id: 'chart-ai', label: 'Chart Upload AI', icon: ScanSearch },
  { id: 'ai-assistant', label: 'AI Assistant', icon: MessageSquare },
  { id: 'pine-bot', label: 'Pine Strategy & Bot', icon: Code2 },
  { id: 'signals-orders', label: 'Telegram & Orders', icon: Send },
];

export const AnalyzerHubView: React.FC<AnalyzerHubViewProps> = ({
  activeSubTab,
  onSubTabChange,
  selectedInstrumentId,
  onSelectInstrumentForTerminal,
  config,
  trades,
  signals,
  orders,
  telegramLogs,
  chatMessages,
  pineStrategies,
  pineBotLogs,
  integrationStatus,
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
  onSaveSignal,
  onDispatchTelegram,
  onLogPaperTrade,
  onOpenOrderModal,
  onUpdateInstrumentSelection,
  onSendUserMessage,
  onSaveAssistantMessage,
  onClearChatHistory,
  onSavePineStrategy,
  onDeletePineStrategy,
  onTogglePineBot,
  onCheckPineBotNow,
  onUpdateChannelLabel,
  onUpdateSignalStatus,
}) => {
  const openInstrumentKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const t of trades) {
      if (t.status === 'OPEN') {
        keys.add(normalizeKey(t.instrument));
      }
    }
    return keys;
  }, [trades]);

  return (
    <div className="space-y-6">
      {/* Analyzer Header + Clean Sub-Tab Navigation */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Market Analyzer &amp; AI Tools</h2>
            <p className="text-xs text-slate-400">
              Trade Auto-Analyzer (manual trigger by default), 32-Market Screener, Chart AI, Assistant, Pine Bots &amp; Signal Routing
            </p>
          </div>
          <div className="text-[11px] font-mono-tabular text-slate-400">
            Auto-Scan:{' '}
            <span className={autoScanEnabled ? 'text-emerald-400 font-semibold' : 'text-slate-300'}>
              {autoScanEnabled ? 'ON (20s)' : 'OFF'}
            </span>
            {' · '}
            Auto-Execute:{' '}
            <span
              className={
                autoExecuteEnabled && !config.killSwitchActive
                  ? 'text-amber-300 font-semibold'
                  : 'text-slate-300'
              }
            >
              {autoExecuteEnabled && !config.killSwitchActive ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/[0.06]">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSubTabChange(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                    : 'bg-[#090B0E] border-white/[0.08] text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-Tab 1: Trade Auto-Analyzer (Moved off Dashboard, stays OFF until user activates) */}
      {activeSubTab === 'auto-analyzer' && (
        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Bot className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Trade Auto-Analyzer (XAUUSD · NIFTY 50 · XAGUSD · BTCUSDT · Crude Oil MCX)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Off by default — runs only when you click Scan Now or manually enable Auto-Scan
                  {lastAutoScanAt
                    ? ` · Last scan ${new Date(lastAutoScanAt).toLocaleTimeString()}`
                    : ''}
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
                    <td colSpan={7} className="py-8 px-4 text-center text-slate-400">
                      {autoScanLoading
                        ? 'Scanning XAUUSD, NIFTY 50, XAGUSD, BTCUSDT, and MCX Crude Oil...'
                        : 'Auto-Analyzer is currently OFF. Click "Scan & Analyze Now" for a single scan or toggle Auto-Scan ON.'}
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
                            onClick={() => onSelectInstrumentForTerminal(row.instrument.id)}
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
      )}

      {/* Sub-Tab 2: 32-Market Scripts Screener */}
      {activeSubTab === 'screener' && (
        <WatchlistView
          selectedInstrumentId={selectedInstrumentId}
          onSelectInstrument={onSelectInstrumentForTerminal}
        />
      )}

      {/* Sub-Tab 3: Chart Upload AI */}
      {activeSubTab === 'chart-ai' && (
        <ChartAnalysisBotView
          config={config}
          onSaveSignal={onSaveSignal}
          onSendTelegram={(sig) =>
            onDispatchTelegram({
              instrument: sig.instrument,
              eventType: 'SIGNAL',
              messageText: sig.telegramReadyText,
            })
          }
          onLogPaperTrade={onLogPaperTrade}
          onOpenOrderModal={onOpenOrderModal}
        />
      )}

      {/* Sub-Tab 4: AI Assistant */}
      {activeSubTab === 'ai-assistant' && (
        <ChatbotView
          messages={chatMessages}
          config={config}
          selectedInstrumentId={selectedInstrumentId}
          onInstrumentChange={onUpdateInstrumentSelection}
          onSendUserMessage={onSendUserMessage}
          onSaveAssistantMessage={onSaveAssistantMessage}
          onClearHistory={onClearChatHistory}
        />
      )}

      {/* Sub-Tab 5: Pine Strategy & Bot */}
      {activeSubTab === 'pine-bot' && (
        <PineStrategyBotView
          strategies={pineStrategies}
          onSaveStrategy={onSavePineStrategy}
          onDeleteStrategy={onDeletePineStrategy}
          onToggleBot={onTogglePineBot}
          onCheckLiveBotNow={onCheckPineBotNow}
          botLogs={pineBotLogs}
          killSwitchActive={config.killSwitchActive}
        />
      )}

      {/* Sub-Tab 6: Signals, Orders & Telegram */}
      {activeSubTab === 'signals-orders' && (
        <ExecutionTelegramView
          signals={signals}
          orders={orders}
          telegramLogs={telegramLogs}
          config={config}
          telegramConfigured={integrationStatus.telegramConfigured}
          telegramChatConfigured={integrationStatus.telegramChatConfigured}
          telegramBotUsername={integrationStatus.telegramBotUsername}
          brokerConfigured={integrationStatus.brokerConfigured}
          onUpdateChannelLabel={onUpdateChannelLabel}
          onUpdateSignalStatus={onUpdateSignalStatus}
          onDispatchTelegramText={onDispatchTelegram}
        />
      )}
    </div>
  );
};
