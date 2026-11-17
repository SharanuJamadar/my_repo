import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Activity,
  BookOpen,
  CandlestickChart,
  Cloud,
  LogOut,
  Menu,
  MessageSquare,
  ScanSearch,
  Send,
  Settings,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  type ChatMessageRecord,
  type DemoWalletState,
  type ExecutionOrderRecord,
  type GeneratedSignalPayload,
  type MarketQuoteResponse,
  type StoredTradeSignal,
  type StrategyConfig,
  type TelegramLogRecord,
  type Timeframe,
  type TradeJournalEntry,
  type TradeMode,
} from './types/trading';
import { auth, signInWithGoogle, signOutUser } from './lib/firebase';
import {
  addChatMessage,
  addDemoWalletFunds,
  clearChatHistory,
  closeTradeEntry,
  createExecutionOrder,
  createStoredSignal,
  createTelegramLog,
  createTradeEntry,
  deleteTradeEntry,
  ensureUserProfileAndConfig,
  markSignalTelegramPublished,
  resetDemoWallet,
  saveStrategyConfig,
  subscribeChatMessages,
  subscribeDemoWallet,
  subscribeExecutionOrders,
  subscribeSignals,
  subscribeStrategyConfig,
  subscribeTelegramLogs,
  subscribeTrades,
  updateStoredSignalStatus,
} from './lib/firestoreStore';
import {
  addLocalChatMessage,
  addLocalDemoFunds,
  clearLocalChat,
  closeLocalTrade,
  createLocalOrder,
  createLocalSignal,
  createLocalTelegramLog,
  createLocalTrade,
  deleteLocalTrade,
  loadLocalChat,
  loadLocalConfig,
  loadLocalOrders,
  loadLocalSignals,
  loadLocalTelegramLogs,
  loadLocalTrades,
  loadLocalWallet,
  markLocalSignalTelegramPublished,
  resetLocalDemoWallet,
  saveLocalConfig,
  updateLocalSignalStatus,
} from './lib/localStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardView } from './components/DashboardView';
import { WatchlistView } from './components/WatchlistView';
import { ChartAnalysisBotView } from './components/ChartAnalysisBotView';
import { ChatbotView } from './components/ChatbotView';
import { TradeJournalView } from './components/TradeJournalView';
import { ExecutionTelegramView } from './components/ExecutionTelegramView';
import { AdminSettingsView } from './components/AdminSettingsView';
import { OrderExecutionModal } from './components/OrderExecutionModal';

type NavTab =
  | 'dashboard'
  | 'watchlist'
  | 'chart-bot'
  | 'chatbot'
  | 'journal'
  | 'execution'
  | 'settings';

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Terminal', icon: CandlestickChart },
  { id: 'watchlist', label: 'Watchlist', icon: Activity },
  { id: 'chart-bot', label: 'Chart AI', icon: ScanSearch },
  { id: 'chatbot', label: 'AI Assistant', icon: MessageSquare },
  { id: 'journal', label: 'Trade Journal', icon: BookOpen },
  { id: 'execution', label: 'Telegram & Orders', icon: Send },
  { id: 'settings', label: 'Admin Settings', icon: Settings },
];

function TerminalWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Standalone localStorage state (immediate access without requiring any app connection)
  const [config, setConfig] = useState<StrategyConfig>(() => loadLocalConfig());
  const [demoWallet, setDemoWallet] = useState<DemoWalletState>(() => loadLocalWallet());
  const [signals, setSignals] = useState<StoredTradeSignal[]>(() => loadLocalSignals());
  const [trades, setTrades] = useState<TradeJournalEntry[]>(() => loadLocalTrades());
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>(() => loadLocalChat());
  const [telegramLogs, setTelegramLogs] = useState<TelegramLogRecord[]>(() =>
    loadLocalTelegramLogs()
  );
  const [orders, setOrders] = useState<ExecutionOrderRecord[]>(() => loadLocalOrders());

  // Market & Live Signal state
  const [selectedInstrumentId, setSelectedInstrumentId] = useState('NIFTY50');
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [liveStreaming, setLiveStreaming] = useState(true);
  const [quote, setQuote] = useState<MarketQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [liveSignal, setLiveSignal] = useState<GeneratedSignalPayload | null>(null);
  const [analyzingLive, setAnalyzingLive] = useState(false);
  const [liveAnalysisError, setLiveAnalysisError] = useState<string | null>(null);
  const [savingSignal, setSavingSignal] = useState(false);
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [telegramNote, setTelegramNote] = useState<string | null>(null);

  // Order Modal & Integration readiness
  const [orderModalSignal, setOrderModalSignal] = useState<GeneratedSignalPayload | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState({
    geminiConfigured: true,
    telegramConfigured: false,
    telegramChatConfigured: false,
    telegramBotUsername: null as string | null,
    twelveDataConfigured: false,
    brokerConfigured: false,
    publicFeedsActive: [] as string[],
  });

  // Optional Google Auth subscription (never blocks terminal access)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        try {
          await ensureUserProfileAndConfig(u);
        } catch {
          // Stay operational if profile sync encounters a transient error
        }
      }
    });
    return () => unsub();
  }, []);

  // Fetch server integration readiness (non-secret status)
  useEffect(() => {
    fetch('/api/integrations/status')
      .then((r) => r.json())
      .then((d) => setIntegrationStatus(d))
      .catch(() => {});
  }, []);

  // Firestore subscriptions when optionally signed in; revert to local store on sign-out
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setConfig(loadLocalConfig());
      setDemoWallet(loadLocalWallet());
      setSignals(loadLocalSignals());
      setTrades(loadLocalTrades());
      setChatMessages(loadLocalChat());
      setTelegramLogs(loadLocalTelegramLogs());
      setOrders(loadLocalOrders());
      return;
    }

    const unsubConfig = subscribeStrategyConfig(user.uid, setConfig);
    const unsubWallet = subscribeDemoWallet(user.uid, setDemoWallet);
    const unsubSignals = subscribeSignals(user.uid, setSignals);
    const unsubTrades = subscribeTrades(user.uid, setTrades);
    const unsubChat = subscribeChatMessages(user.uid, setChatMessages);
    const unsubTg = subscribeTelegramLogs(user.uid, setTelegramLogs);
    const unsubOrders = subscribeExecutionOrders(user.uid, setOrders);
    return () => {
      unsubConfig();
      unsubWallet();
      unsubSignals();
      unsubTrades();
      unsubChat();
      unsubTg();
      unsubOrders();
    };
  }, [authReady, user]);

  // Fetch live market quote for active instrument + timeframe
  const refreshQuote = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setQuoteLoading(true);
      }
      try {
        const qs = new URLSearchParams({
          instrument: selectedInstrumentId,
          timeframe,
          emaFast: String(config.emaFast),
          emaMid: String(config.emaMid),
          emaSlow: String(config.emaSlow),
          rsiPeriod: String(config.rsiPeriod),
        });
        const res = await fetch(`/api/market/quote?${qs.toString()}`);
        const data = (await res.json()) as MarketQuoteResponse;
        setQuote(data);
      } catch {
        if (!silent) {
          setQuote(null);
        }
      } finally {
        if (!silent) {
          setQuoteLoading(false);
        }
      }
    },
    [
      selectedInstrumentId,
      timeframe,
      config.emaFast,
      config.emaMid,
      config.emaSlow,
      config.rsiPeriod,
    ]
  );

  // Initial fetch whenever instrument/timeframe changes
  useEffect(() => {
    refreshQuote({ silent: false });
  }, [refreshQuote]);

  // Automatic 4-second live polling on Dashboard while liveStreaming is active
  useEffect(() => {
    if (activeTab !== 'dashboard' || !liveStreaming) return;
    const timer = window.setInterval(() => {
      refreshQuote({ silent: true });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeTab, liveStreaming, refreshQuote]);

  const handleSignIn = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sync failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDispatchTelegram = async (payload: {
    signalId?: string;
    instrument: string;
    eventType: 'SIGNAL' | 'TARGET_HIT' | 'SL_HIT' | 'MARKET_UPDATE';
    messageText: string;
  }) => {
    setSendingTelegram(true);
    setTelegramNote(null);
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageText: payload.messageText,
          chatId: config.telegramChannelLabel,
        }),
      });
      const data = await res.json();
      if (user) {
        await createTelegramLog(user.uid, {
          signalId: payload.signalId,
          instrument: payload.instrument,
          eventType: payload.eventType,
          messageText: payload.messageText,
          deliveryStatus: data.deliveryStatus || 'FAILED',
          statusDetail: data.statusDetail,
        });
        if (payload.signalId && data.deliveryStatus === 'SENT') {
          await markSignalTelegramPublished(payload.signalId);
        }
      } else {
        setTelegramLogs(
          createLocalTelegramLog({
            signalId: payload.signalId,
            instrument: payload.instrument,
            eventType: payload.eventType,
            messageText: payload.messageText,
            deliveryStatus: data.deliveryStatus || 'FAILED',
            statusDetail: data.statusDetail,
          })
        );
        if (payload.signalId && data.deliveryStatus === 'SENT') {
          setSignals(markLocalSignalTelegramPublished(payload.signalId));
        }
      }
      setTelegramNote(data.statusDetail || `Telegram status: ${data.deliveryStatus}`);
    } finally {
      setSendingTelegram(false);
    }
  };

  const handleRunLiveAnalysis = async () => {
    setAnalyzingLive(true);
    setLiveAnalysisError(null);
    setTelegramNote(null);
    try {
      const res = await fetch('/api/ai/analyze-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrumentId: selectedInstrumentId,
          strategyConfig: config,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.available) {
        throw new Error(data.error || 'Live market data unavailable for strategy evaluation.');
      }
      setLiveSignal(data.signal);

      if (config.autoBroadcastTelegram && data.signal.direction !== 'NO_TRADE') {
        if (user) {
          const savedId = await createStoredSignal(user.uid, data.signal, 'LIVE_MARKET', true);
          await handleDispatchTelegram({
            signalId: savedId,
            instrument: data.signal.instrument,
            eventType: 'SIGNAL',
            messageText: data.signal.telegramReadyText,
          });
        } else {
          const updated = createLocalSignal(data.signal, 'LIVE_MARKET', true);
          setSignals(updated);
          await handleDispatchTelegram({
            signalId: updated[0]?.id,
            instrument: data.signal.instrument,
            eventType: 'SIGNAL',
            messageText: data.signal.telegramReadyText,
          });
        }
      }
    } catch (err) {
      setLiveAnalysisError(err instanceof Error ? err.message : 'Live analysis error');
    } finally {
      setAnalyzingLive(false);
    }
  };

  const handleSaveSignal = async (
    signal: GeneratedSignalPayload,
    source: 'LIVE_MARKET' | 'CHART_UPLOAD' | 'CHATBOT'
  ) => {
    setSavingSignal(true);
    try {
      if (user) {
        await createStoredSignal(user.uid, signal, source, false);
        setTelegramNote('Signal persisted to Cloud Signal Log.');
      } else {
        setSignals(createLocalSignal(signal, source, false));
        setTelegramNote('Signal saved to local Signal Log.');
      }
    } finally {
      setSavingSignal(false);
    }
  };

  const handleLogPaperTrade = async (signal: GeneratedSignalPayload) => {
    if (signal.direction === 'NO_TRADE') return;
    const tradePayload = {
      instrument: signal.instrument,
      contract: signal.contract,
      direction: signal.direction,
      executionMode: 'PAPER' as const,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      target1: signal.target1,
      target2: signal.target2,
      target3: signal.target3,
      quantity: 1,
      status: 'OPEN' as const,
      result: 'OPEN' as const,
      pnl: 0,
      riskReward: signal.riskReward,
      strategyConfirmation: signal.confirmationText,
    };

    if (user) {
      await createTradeEntry(user.uid, tradePayload);
    } else {
      setTrades(createLocalTrade(tradePayload));
    }
    setActiveTab('journal');
  };

  const handleConfirmOrder = async (payload: {
    executionMode: TradeMode;
    quantity: number;
    orderType: 'MARKET' | 'LIMIT' | 'SL-M';
    expiry: string;
    brokerName: string;
  }) => {
    if (!orderModalSignal || orderModalSignal.direction === 'NO_TRADE') return;
    const signalId = `sig-${Date.now()}`;
    const res = await fetch('/api/orders/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user?.uid || 'local-standalone',
        signalId,
        instrument: orderModalSignal.instrument,
        contract: orderModalSignal.contract,
        expiry: payload.expiry,
        quantity: payload.quantity,
        orderType: payload.orderType,
        side: orderModalSignal.direction,
        entryPrice: orderModalSignal.entryPrice,
        stopLoss: orderModalSignal.stopLoss,
        targetPrice: orderModalSignal.target1,
        executionMode: payload.executionMode,
        brokerName: payload.brokerName,
        userConfirmed: true,
        killSwitchActive: config.killSwitchActive,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Order execution rejected.');
    }

    const orderPayload = {
      signalId,
      instrument: orderModalSignal.instrument,
      contract: orderModalSignal.contract,
      expiry: payload.expiry || undefined,
      quantity: payload.quantity,
      orderType: payload.orderType,
      side: orderModalSignal.direction,
      entryPrice: orderModalSignal.entryPrice,
      stopLoss: orderModalSignal.stopLoss,
      targetPrice: orderModalSignal.target1,
      executionMode: payload.executionMode,
      brokerName: data.brokerName || payload.brokerName,
      brokerOrderId: data.brokerOrderId,
      status: data.status,
    };

    const journalPayload = {
      signalId,
      instrument: orderModalSignal.instrument,
      contract: orderModalSignal.contract,
      direction: orderModalSignal.direction,
      executionMode: payload.executionMode,
      entryPrice: orderModalSignal.entryPrice,
      stopLoss: orderModalSignal.stopLoss,
      target1: orderModalSignal.target1,
      target2: orderModalSignal.target2,
      target3: orderModalSignal.target3,
      quantity: payload.quantity,
      status: 'OPEN' as const,
      result: 'OPEN' as const,
      pnl: 0,
      riskReward: orderModalSignal.riskReward,
      strategyConfirmation: orderModalSignal.confirmationText,
      brokerOrderId: data.brokerOrderId,
    };

    if (user) {
      await createExecutionOrder(user.uid, orderPayload);
      await createTradeEntry(user.uid, journalPayload);
    } else {
      setOrders(createLocalOrder(orderPayload));
      setTrades(createLocalTrade(journalPayload));
    }
  };

  return (
    <div className="min-h-screen bg-[#090B0E] text-[#E6EDF3] flex flex-col">
      {/* Top Bar Contract: 3 clean zones separated by gap-8 */}
      <header className="h-14 border-b border-white/[0.08] bg-[#0C0F14] px-4 lg:px-6 flex items-center justify-between gap-8 sticky top-0 z-40">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            className="lg:hidden p-1.5 text-slate-300 hover:text-white rounded-lg"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <a
            href="#terminal"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('dashboard');
            }}
            className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            SHARAN
          </a>
        </div>

        <nav className="hidden lg:flex items-center gap-6 text-xs font-medium text-slate-400">
          {NAV_ITEMS.slice(0, 5).map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === item.id
                  ? 'text-white border-emerald-500'
                  : 'border-transparent hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <button
              type="button"
              onClick={signOutUser}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={authLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Cloud className="w-3.5 h-3.5 text-emerald-400" />
              {authLoading ? 'Syncing...' : 'Sync Google'}
            </button>
          )}
        </div>
      </header>

      {authError && (
        <div className="bg-red-500/10 border-b border-red-500/30 px-6 py-2 flex items-center justify-between text-xs text-red-300">
          <span>{authError}</span>
          <button
            type="button"
            onClick={() => setAuthError(null)}
            className="text-red-200 hover:text-white ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 flex">
        {/* Sidebar Navigation (Desktop + Mobile Drawer) */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-14 left-0 z-30 block' : 'hidden'
          } lg:block w-60 shrink-0 border-r border-white/[0.08] bg-[#0C0F14] p-4 space-y-6`}
        >
          <div className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="pt-4 border-t border-white/[0.08] space-y-2 text-[11px] text-slate-400">
            <div className="font-semibold text-slate-200">Active Strategy Rules</div>
            <div>
              Trend: {config.trendTimeframe.toUpperCase()} · Entry:{' '}
              {config.entryTimeframe.toUpperCase()}
            </div>
            <div>
              EMAs: {config.emaFast} / {config.emaMid} / {config.emaSlow}
            </div>
            <div>
              Min Score: {config.minSetupScore}/100 · R:R 1:{config.minRiskReward}
            </div>
            <div className={config.paperTradingOnly ? 'text-sky-300' : 'text-amber-300'}>
              Mode: {config.paperTradingOnly ? 'Paper Trading' : 'Live + Paper'}
            </div>
            <div className="font-mono-tabular text-emerald-300">
              Demo Wallet: {demoWallet.balance.toLocaleString()}
            </div>
            <div className="text-slate-500">
              Storage: {user ? 'Google Cloud Sync' : 'Standalone Local'}
            </div>
            {config.killSwitchActive && (
              <div className="flex items-center gap-1.5 text-red-400 font-semibold">
                <ShieldAlert className="w-3.5 h-3.5" />
                Kill Switch Active
              </div>
            )}
          </div>
        </aside>

        {/* Main Workspace Content */}
        <main className="flex-1 min-w-0 p-4 lg:p-6 max-w-[1440px]">
          {activeTab === 'dashboard' && (
            <DashboardView
              selectedInstrumentId={selectedInstrumentId}
              onSelectInstrument={setSelectedInstrumentId}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              quote={quote}
              quoteLoading={quoteLoading}
              onRefreshQuote={() => refreshQuote({ silent: false })}
              liveStreaming={liveStreaming}
              onToggleLiveStreaming={() => setLiveStreaming((v) => !v)}
              config={config}
              signals={signals}
              liveSignal={liveSignal}
              analyzingLive={analyzingLive}
              liveAnalysisError={liveAnalysisError}
              onRunLiveAnalysis={handleRunLiveAnalysis}
              onSaveSignal={handleSaveSignal}
              onSendTelegram={(sig) =>
                handleDispatchTelegram({
                  instrument: sig.instrument,
                  eventType: 'SIGNAL',
                  messageText: sig.telegramReadyText,
                })
              }
              onLogPaperTrade={handleLogPaperTrade}
              onOpenOrderModal={setOrderModalSignal}
              savingSignal={savingSignal}
              sendingTelegram={sendingTelegram}
              telegramNote={telegramNote}
            />
          )}

          {activeTab === 'watchlist' && (
            <WatchlistView
              selectedInstrumentId={selectedInstrumentId}
              activeInstrumentIds={config.activeInstruments}
              onSelectInstrument={(id) => {
                setSelectedInstrumentId(id);
                setActiveTab('dashboard');
              }}
            />
          )}

          {activeTab === 'chart-bot' && (
            <ChartAnalysisBotView
              config={config}
              onSaveSignal={handleSaveSignal}
              onSendTelegram={(sig) =>
                handleDispatchTelegram({
                  instrument: sig.instrument,
                  eventType: 'SIGNAL',
                  messageText: sig.telegramReadyText,
                })
              }
              onLogPaperTrade={handleLogPaperTrade}
              onOpenOrderModal={setOrderModalSignal}
            />
          )}

          {activeTab === 'chatbot' && (
            <ChatbotView
              messages={chatMessages}
              config={config}
              selectedInstrumentId={selectedInstrumentId}
              onInstrumentChange={setSelectedInstrumentId}
              onSendUserMessage={async (content, ctx) => {
                if (user) {
                  await addChatMessage(user.uid, 'user', content, ctx);
                } else {
                  setChatMessages(addLocalChatMessage('user', content, ctx));
                }
              }}
              onSaveAssistantMessage={async (content, ctx) => {
                if (user) {
                  await addChatMessage(user.uid, 'assistant', content, ctx);
                } else {
                  setChatMessages(addLocalChatMessage('assistant', content, ctx));
                }
              }}
              onClearHistory={async () => {
                if (user) {
                  await clearChatHistory(chatMessages);
                } else {
                  setChatMessages(clearLocalChat());
                }
              }}
            />
          )}

          {activeTab === 'journal' && (
            <TradeJournalView
              trades={trades}
              wallet={demoWallet}
              onAddDemoFunds={async (amount, note) => {
                if (user) {
                  await addDemoWalletFunds(user.uid, demoWallet, amount, note);
                } else {
                  setDemoWallet(addLocalDemoFunds(amount, note));
                }
              }}
              onResetDemoWallet={async (newBalance) => {
                if (user) {
                  await resetDemoWallet(user.uid, newBalance);
                } else {
                  setDemoWallet(resetLocalDemoWallet(newBalance));
                }
              }}
              onCreateTrade={async (entry) => {
                if (user) {
                  await createTradeEntry(user.uid, entry);
                } else {
                  setTrades(createLocalTrade(entry));
                }
              }}
              onCloseTrade={async (id, params) => {
                if (user) {
                  await closeTradeEntry(id, params);
                } else {
                  setTrades(closeLocalTrade(id, params));
                }
              }}
              onDeleteTrade={async (id) => {
                if (user) {
                  await deleteTradeEntry(id);
                } else {
                  setTrades(deleteLocalTrade(id));
                }
              }}
            />
          )}

          {activeTab === 'execution' && (
            <ExecutionTelegramView
              signals={signals}
              orders={orders}
              telegramLogs={telegramLogs}
              config={config}
              telegramConfigured={integrationStatus.telegramConfigured}
              telegramChatConfigured={integrationStatus.telegramChatConfigured}
              telegramBotUsername={integrationStatus.telegramBotUsername}
              brokerConfigured={integrationStatus.brokerConfigured}
              onUpdateChannelLabel={async (label) => {
                const { userId: _u, updatedAt: _t, ...rest } = config;
                const next = { ...rest, telegramChannelLabel: label };
                if (user) {
                  await saveStrategyConfig(user.uid, next);
                } else {
                  setConfig(saveLocalConfig(next));
                }
              }}
              onUpdateSignalStatus={async (id, status) => {
                if (user) {
                  await updateStoredSignalStatus(id, status);
                } else {
                  setSignals(updateLocalSignalStatus(id, status));
                }
              }}
              onDispatchTelegramText={handleDispatchTelegram}
            />
          )}

          {activeTab === 'settings' && (
            <AdminSettingsView
              config={config}
              userEmail={user?.email || ''}
              integrationStatus={integrationStatus}
              onSaveConfig={async (next) => {
                if (user) {
                  await saveStrategyConfig(user.uid, next);
                } else {
                  setConfig(saveLocalConfig(next));
                }
              }}
            />
          )}
        </main>
      </div>

      {orderModalSignal && (
        <OrderExecutionModal
          signal={orderModalSignal}
          config={config}
          brokerConfigured={integrationStatus.brokerConfigured}
          walletBalance={demoWallet.balance}
          onClose={() => setOrderModalSignal(null)}
          onConfirmOrder={handleConfirmOrder}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TerminalWorkspace />
    </ErrorBoundary>
  );
}
