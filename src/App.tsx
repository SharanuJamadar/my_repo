import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Activity,
  BookOpen,
  CandlestickChart,
  Cloud,
  LayoutDashboard,
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
  INSTRUMENTS,
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
import { AUTO_SCAN_INSTRUMENT_IDS } from './lib/brokers';
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
import {
  DashboardView,
  type AutoScanMarketItem,
  type LivePricePoint,
} from './components/DashboardView';
import { TerminalView } from './components/TerminalView';
import { WatchlistView } from './components/WatchlistView';
import { ChartAnalysisBotView } from './components/ChartAnalysisBotView';
import { ChatbotView } from './components/ChatbotView';
import { TradeJournalView } from './components/TradeJournalView';
import { ExecutionTelegramView } from './components/ExecutionTelegramView';
import { AdminSettingsView } from './components/AdminSettingsView';
import { OrderExecutionModal } from './components/OrderExecutionModal';
import { BrokerConnectModal } from './components/BrokerConnectModal';

type NavTab =
  | 'dashboard'
  | 'terminal'
  | 'watchlist'
  | 'chart-bot'
  | 'chatbot'
  | 'journal'
  | 'execution'
  | 'settings';

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'terminal', label: 'Terminal', icon: CandlestickChart },
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

  // Order Modal, Broker Hub & Integration readiness
  const [orderModalSignal, setOrderModalSignal] = useState<GeneratedSignalPayload | null>(null);
  const [brokerModalOpen, setBrokerModalOpen] = useState(false);
  const [brokerReadiness, setBrokerReadiness] = useState<Record<string, boolean>>({
    PAPER_ENGINE: true,
  });
  const [integrationStatus, setIntegrationStatus] = useState({
    geminiConfigured: true,
    telegramConfigured: false,
    telegramChatConfigured: false,
    telegramBotUsername: null as string | null,
    twelveDataConfigured: false,
    brokerConfigured: false,
    publicFeedsActive: [] as string[],
  });

  // 0ms client quote cache + live price map + 5-market auto-pilot state
  const quoteCacheRef = useRef<Map<string, MarketQuoteResponse>>(new Map());
  const tradesRef = useRef<TradeJournalEntry[]>(trades);
  tradesRef.current = trades;
  const autoExecutedKeysRef = useRef<Set<string>>(new Set());

  const [livePricesBySymbol, setLivePricesBySymbol] = useState<Record<string, LivePricePoint>>({});
  const [autoScanResults, setAutoScanResults] = useState<AutoScanMarketItem[]>([]);
  const [autoScanLoading, setAutoScanLoading] = useState(false);
  const [lastAutoScanAt, setLastAutoScanAt] = useState<string | null>(null);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [autoExecuteEnabled, setAutoExecuteEnabled] = useState(true);
  const [autoPilotNote, setAutoPilotNote] = useState<string | null>(null);
  const [executingInstrumentSymbol, setExecutingInstrumentSymbol] = useState<string | null>(null);

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

  // Fetch server integration & broker readiness (non-secret booleans)
  useEffect(() => {
    fetch('/api/integrations/status')
      .then((r) => r.json())
      .then((d) => setIntegrationStatus(d))
      .catch(() => {});
    fetch('/api/brokers/status')
      .then((r) => r.json())
      .then((d) => {
        if (d?.brokers) setBrokerReadiness(d.brokers);
      })
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

  // Fetch live market quote with 0ms client cache for instant instrument/timeframe switching
  const refreshQuote = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      const cacheKey = `${selectedInstrumentId}:${timeframe}`;
      const cached = quoteCacheRef.current.get(cacheKey);
      if (cached && !silent) {
        setQuote(cached);
        setQuoteLoading(false);
      } else if (!silent) {
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
        quoteCacheRef.current.set(cacheKey, data);
        setQuote(data);
        if (data.available && typeof data.price === 'number') {
          setLivePricesBySymbol((prev) => ({
            ...prev,
            [data.instrument.id]: {
              price: data.price!,
              changePercent: data.changePercent ?? 0,
              marketTimestamp: data.marketTimestamp,
            },
          }));
        }
      } catch {
        if (!silent && !cached) {
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

  // Fast 1.5-second live polling on Terminal while liveStreaming is active
  useEffect(() => {
    if (activeTab !== 'terminal' || !liveStreaming) return;
    const timer = window.setInterval(() => {
      refreshQuote({ silent: true });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeTab, liveStreaming, refreshQuote]);

  // Keep live LTP map warm for all instruments with open trades
  useEffect(() => {
    if (activeTab !== 'dashboard' && activeTab !== 'terminal') return;
    const syncOpenTradesLtp = async () => {
      const openIds = new Set<string>();
      for (const t of tradesRef.current) {
        if (t.status !== 'OPEN') continue;
        const norm = t.instrument.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const meta = INSTRUMENTS.find(
          (i) =>
            i.id.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm ||
            i.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm ||
            norm.includes(i.id.toUpperCase().replace(/[^A-Z0-9]/g, ''))
        );
        if (meta && meta.id !== selectedInstrumentId) openIds.add(meta.id);
      }
      if (openIds.size === 0) return;

      const quotes = await Promise.all(
        Array.from(openIds).map(async (id) => {
          try {
            const res = await fetch(`/api/market/quote?instrument=${id}&timeframe=5m`);
            return res.ok ? ((await res.json()) as MarketQuoteResponse) : null;
          } catch {
            return null;
          }
        })
      );
      const patch: Record<string, LivePricePoint> = {};
      for (const q of quotes) {
        if (q?.available && typeof q.price === 'number') {
          patch[q.instrument.id] = {
            price: q.price,
            changePercent: q.changePercent ?? 0,
            marketTimestamp: q.marketTimestamp,
          };
        }
      }
      if (Object.keys(patch).length > 0) {
        setLivePricesBySymbol((prev) => ({ ...prev, ...patch }));
      }
    };

    void syncOpenTradesLtp();
    const timer = window.setInterval(() => void syncOpenTradesLtp(), 4000);
    return () => window.clearInterval(timer);
  }, [activeTab, selectedInstrumentId]);

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

  // Instant execution helper used both by manual 1-click "Execute Trade" and Auto-Execute engine
  const executeSignalRecord = useCallback(
    async (
      sig: GeneratedSignalPayload,
      isAuto = false,
      orderType: 'MARKET' | 'LIMIT' = 'MARKET'
    ): Promise<boolean> => {
      if (sig.direction === 'NO_TRADE' || sig.entryPrice <= 0 || config.killSwitchActive) {
        return false;
      }

      const mode: TradeMode =
        config.paperTradingOnly || !integrationStatus.brokerConfigured ? 'PAPER' : 'LIVE';
      const signalId = `sig-${Date.now()}-${sig.instrument.replace(/[^A-Z0-9]/gi, '')}`;
      const brokerLabel =
        config.brokerProviderLabel || 'SHARAN Paper Trading Engine';

      const res = await fetch('/api/orders/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.uid || 'local-standalone',
          signalId,
          instrument: sig.instrument,
          contract: sig.contract,
          quantity: 1,
          orderType,
          side: sig.direction,
          entryPrice: sig.entryPrice,
          stopLoss: sig.stopLoss,
          targetPrice: sig.target1,
          executionMode: mode,
          brokerName: brokerLabel,
          userConfirmed: true,
          killSwitchActive: config.killSwitchActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Trade execution rejected.');
      }

      const orderPayload = {
        signalId,
        instrument: sig.instrument,
        contract: sig.contract,
        quantity: 1,
        orderType,
        side: sig.direction,
        entryPrice: sig.entryPrice,
        stopLoss: sig.stopLoss,
        targetPrice: sig.target1,
        executionMode: mode,
        brokerName: data.brokerName || brokerLabel,
        brokerOrderId: data.brokerOrderId,
        status: data.status,
      };

      const journalPayload = {
        signalId,
        instrument: sig.instrument,
        contract: sig.contract,
        direction: sig.direction,
        executionMode: mode,
        entryPrice: sig.entryPrice,
        stopLoss: sig.stopLoss,
        target1: sig.target1,
        target2: sig.target2,
        target3: sig.target3,
        quantity: 1,
        status: 'OPEN' as const,
        result: 'OPEN' as const,
        pnl: 0,
        riskReward: sig.riskReward,
        strategyConfirmation: isAuto
          ? `[AUTO-PILOT ${orderType}] ${sig.confirmationText}`
          : sig.confirmationText,
        brokerOrderId: data.brokerOrderId,
      };

      if (user) {
        await createStoredSignal(user.uid, sig, 'LIVE_MARKET', false);
        await createExecutionOrder(user.uid, orderPayload);
        await createTradeEntry(user.uid, journalPayload);
      } else {
        setSignals(createLocalSignal(sig, 'LIVE_MARKET', false));
        setOrders(createLocalOrder(orderPayload));
        setTrades(createLocalTrade(journalPayload));
      }

      return true;
    },
    [config.killSwitchActive, config.paperTradingOnly, config.brokerProviderLabel, integrationStatus.brokerConfigured, user]
  );

  const handleExecuteSignalInstant = async (sig: GeneratedSignalPayload) => {
    setExecutingInstrumentSymbol(sig.instrument);
    setAutoPilotNote(null);
    try {
      await executeSignalRecord(sig, false, sig.status === 'ACTIVE' ? 'MARKET' : 'LIMIT');
      setAutoPilotNote(
        `Executed ${sig.direction} on ${sig.contract} @ ${sig.entryPrice} via ${config.brokerProviderLabel}.`
      );
    } catch (err) {
      setAutoPilotNote(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setExecutingInstrumentSymbol(null);
    }
  };

  const runAutoScanAndExecute = useCallback(async () => {
    setAutoScanLoading(true);
    try {
      const res = await fetch('/api/ai/auto-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrumentIds: [...AUTO_SCAN_INSTRUMENT_IDS],
          strategyConfig: config,
        }),
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.results)) return;

      const scanned = data.results as AutoScanMarketItem[];
      setAutoScanResults(scanned);
      setLastAutoScanAt(data.scannedAt || new Date().toISOString());

      // Sync latest live prices for all 5 scanned markets
      const pricePatch: Record<string, LivePricePoint> = {};
      for (const item of scanned) {
        if (item.quoteAvailable && item.price !== null && item.marketTimestamp) {
          pricePatch[item.instrument.id] = {
            price: item.price,
            changePercent: item.changePercent ?? 0,
            marketTimestamp: item.marketTimestamp,
          };
        }
      }
      if (Object.keys(pricePatch).length > 0) {
        setLivePricesBySymbol((prev) => ({ ...prev, ...pricePatch }));
      }

      // Auto-Execute qualifying ACTIVE or qualified LIMIT setups without duplicating open instruments
      if (autoExecuteEnabled && !config.killSwitchActive) {
        const executedNames: string[] = [];
        for (const item of scanned) {
          const sig = item.signal;
          const isQualified =
            sig &&
            sig.direction !== 'NO_TRADE' &&
            sig.entryPrice > 0 &&
            (sig.status === 'ACTIVE' ||
              (sig.status === 'WAIT' && sig.qualityScore >= config.minSetupScore));
          if (!isQualified) {
            continue;
          }
          const instNorm = item.instrument.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const idNorm = item.instrument.id.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const alreadyOpen = tradesRef.current.some((t) => {
            if (t.status !== 'OPEN') return false;
            const tNorm = t.instrument.toUpperCase().replace(/[^A-Z0-9]/g, '');
            return tNorm === instNorm || tNorm === idNorm;
          });
          const sessionKey = `${item.instrument.id}:${sig.direction}`;
          if (alreadyOpen || autoExecutedKeysRef.current.has(sessionKey)) {
            continue;
          }

          autoExecutedKeysRef.current.add(sessionKey);
          try {
            const ok = await executeSignalRecord(
              sig,
              true,
              sig.status === 'ACTIVE' ? 'MARKET' : 'LIMIT'
            );
            if (ok) {
              executedNames.push(`${item.instrument.symbol} (${sig.direction})`);
            }
          } catch {
            autoExecutedKeysRef.current.delete(sessionKey);
          }
        }

        if (executedNames.length > 0) {
          setAutoPilotNote(
            `Auto-executed ${executedNames.join(', ')} into Live Running Trades.`
          );
        }
      }
    } catch {
      // Preserve last scan table silently on transient poll errors
    } finally {
      setAutoScanLoading(false);
    }
  }, [config, autoExecuteEnabled, executeSignalRecord]);

  // Run initial 5-market auto-scan on load and every 20s when enabled across Dashboard & Terminal
  useEffect(() => {
    if (activeTab !== 'dashboard' && activeTab !== 'terminal') return;
    void runAutoScanAndExecute();
    if (!autoScanEnabled) return;
    const timer = window.setInterval(() => {
      void runAutoScanAndExecute();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [activeTab, autoScanEnabled, runAutoScanAndExecute]);

  const handleQuickCloseTrade = async (trade: TradeJournalEntry, exitPrice: number) => {
    const diff =
      trade.direction === 'BUY' ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
    const pnl = Number((diff * trade.quantity).toFixed(2));
    const result: 'WIN' | 'LOSS' | 'BREAKEVEN' =
      pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN';

    if (user) {
      await closeTradeEntry(trade.id, { exitPrice, pnl, result });
    } else {
      setTrades(closeLocalTrade(trade.id, { exitPrice, pnl, result }));
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
              config={config}
              userEmail={user?.email || ''}
              wallet={demoWallet}
              trades={trades}
              signals={signals}
              livePricesBySymbol={livePricesBySymbol}
              onOpenInTerminal={(id) => {
                setSelectedInstrumentId(id);
                setActiveTab('terminal');
              }}
              onQuickAddWalletFunds={async (amt) => {
                if (user) {
                  await addDemoWalletFunds(user.uid, demoWallet, amt, 'Dashboard Quick Top-Up');
                } else {
                  setDemoWallet(addLocalDemoFunds(amt, 'Dashboard Quick Top-Up'));
                }
              }}
              onOpenBrokerModal={() => setBrokerModalOpen(true)}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onQuickCloseTrade={handleQuickCloseTrade}
              autoScanResults={autoScanResults}
              autoScanLoading={autoScanLoading}
              lastAutoScanAt={lastAutoScanAt}
              autoScanEnabled={autoScanEnabled}
              onToggleAutoScan={() => setAutoScanEnabled((v) => !v)}
              autoExecuteEnabled={autoExecuteEnabled}
              onToggleAutoExecute={() => setAutoExecuteEnabled((v) => !v)}
              autoPilotNote={autoPilotNote}
              onRunAutoScan={runAutoScanAndExecute}
              onExecuteSignalInstant={handleExecuteSignalInstant}
              executingInstrumentSymbol={executingInstrumentSymbol}
            />
          )}

          {activeTab === 'terminal' && (
            <TerminalView
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
              openTradesCount={trades.filter((t) => t.status === 'OPEN').length}
              onOpenBrokerModal={() => setBrokerModalOpen(true)}
              onNavigateDashboard={() => setActiveTab('dashboard')}
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
                setActiveTab('terminal');
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

      {brokerModalOpen && (
        <BrokerConnectModal
          currentBrokerLabel={config.brokerProviderLabel}
          brokerReadiness={brokerReadiness}
          onClose={() => setBrokerModalOpen(false)}
          onSelectBroker={async (brokerProviderLabel) => {
            const { userId: _u, updatedAt: _t, ...rest } = config;
            const next = { ...rest, brokerProviderLabel: brokerProviderLabel.slice(0, 80) };
            if (user) {
              await saveStrategyConfig(user.uid, next);
            } else {
              setConfig(saveLocalConfig(next));
            }
          }}
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
