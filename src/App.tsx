import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Bell,
  BellOff,
  BookOpen,
  CandlestickChart,
  LayoutDashboard,
  Lock,
  LogIn,
  LogOut,
  Menu,
  Moon,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sun,
  UserCog,
  Wallet,
  X,
} from 'lucide-react';
import {
  INSTRUMENTS,
  type AccountProfileSettings,
  type ChatMessageRecord,
  type DemoWalletState,
  type EconomicCalendarResponse,
  type ExecutionOrderRecord,
  type GeneratedSignalPayload,
  type MarketQuoteResponse,
  type MonitoredPositionEvent,
  type MonitoredPositionSyncItem,
  type PineBotActivityLog,
  type PineBotEvaluationResult,
  type PineStrategyRecord,
  type PriceAlertRule,
  type StoredTradeSignal,
  type StrategyConfig,
  type TelegramLogRecord,
  type Timeframe,
  type TradeJournalEntry,
  type TradeMode,
  type TradeTrailState,
} from './types/trading';
import { AUTO_SCAN_INSTRUMENT_IDS } from './lib/brokers';
import { auth, signInWithGoogle, signOutUser } from './lib/firebase';
import { authFetch } from './lib/authFetch';
import {
  addChatMessage,
  addDemoWalletFunds,
  clearChatHistory,
  closeTradeEntry,
  createExecutionOrder,
  createOrUpdatePineStrategy,
  createStoredSignal,
  createTelegramLog,
  createTradeEntry,
  deletePineStrategy,
  deleteTradeEntry,
  ensureUserProfileAndConfig,
  markSignalTelegramPublished,
  resetDemoWallet,
  saveAccountSettings,
  saveStrategyConfig,
  subscribeAccountSettings,
  subscribeChatMessages,
  subscribeDemoWallet,
  subscribeExecutionOrders,
  subscribePineStrategies,
  subscribeSignals,
  subscribeStrategyConfig,
  subscribeTelegramLogs,
  subscribeTrades,
  updateStoredSignalStatus,
  updateTradeTrailingStop,
  withdrawDemoWalletFunds,
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
  deleteLocalPineStrategy,
  deleteLocalTrade,
  loadLocalAccountProfile,
  loadLocalChat,
  loadLocalConfig,
  loadLocalOrders,
  loadLocalPineStrategies,
  loadLocalPriceAlerts,
  loadLocalSignals,
  loadLocalTelegramLogs,
  loadLocalTrades,
  loadLocalWallet,
  markLocalSignalTelegramPublished,
  resetLocalDemoWallet,
  saveLocalAccountProfile,
  saveLocalConfig,
  saveLocalPineStrategy,
  saveLocalPriceAlerts,
  updateLocalSignalStatus,
  updateLocalTradeTrailingStop,
  withdrawLocalDemoFunds,
} from './lib/localStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  DashboardView,
  type AutoScanMarketItem,
  type LivePricePoint,
} from './components/DashboardView';
import { TerminalView } from './components/TerminalView';
import { AnalyzerHubView, type AnalyzerSubTab } from './components/AnalyzerHubView';
import { TradeJournalView } from './components/TradeJournalView';
import { AdminSettingsView } from './components/AdminSettingsView';
import { AccountSettingsView } from './components/AccountSettingsView';
import { OrderExecutionModal } from './components/OrderExecutionModal';
import { BrokerConnectModal } from './components/BrokerConnectModal';
import { ClassicLandingPage } from './components/ClassicLandingPage';
import { AccountOnboardingView } from './components/AccountOnboardingView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { MobilePlayStoreSection } from './components/MobilePlayStoreSection';
import { AuthLoginModal } from './components/AuthLoginModal';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { ThemeProvider, useTheme } from './lib/theme';
import {
  ACCOUNT_TYPE_STORAGE_KEY,
  SOUND_ALERTS_STORAGE_KEY,
  type ViewStage,
  type NavTab,
  parseHashRoute,
} from './lib/routeUtils';
import { useWorkspaceToasts } from './hooks/useWorkspaceToasts';

const MASTER_ADMIN_EMAIL = 'sharanu12131415@gmail.com';

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'terminal', label: 'Terminal', icon: CandlestickChart },
  { id: 'analyzer', label: 'Analyzer', icon: ScanSearch },
  { id: 'journal', label: 'Trade Journal', icon: BookOpen },
  { id: 'account', label: 'Account Settings', icon: UserCog },
  { id: 'settings', label: 'Admin Settings', icon: Settings },
  { id: 'mobile', label: 'App Download', icon: Smartphone },
];

function TerminalWorkspace() {
  const { isDark, toggleTheme } = useTheme();
  const initialRoute = useMemo(
    () => (typeof window !== 'undefined' ? parseHashRoute(window.location.hash) : null),
    []
  );
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [viewStage, setViewStage] = useState<ViewStage>(() => initialRoute?.stage ?? 'landing');
  const [justCompletedMode, setJustCompletedMode] = useState<'BROKER' | 'DEMO' | null>(null);
  const redirectAfterLoginRef = useRef(false);
  const postLoginActionRef = useRef<'NONE' | 'ENTER_LIVE' | 'ENTER_DEMO' | 'STAY_IN_WORKSPACE'>('NONE');
  const pendingLiveRouteRef = useRef(initialRoute?.accountMode === 'LIVE');

  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginModalIntent, setLoginModalIntent] = useState<'LIVE' | 'DEMO' | 'GENERAL'>('GENERAL');

  // Always default strictly to DEMO until Firebase Auth confirms a user AND user explicitly enters LIVE
  const [activeAccountType, setActiveAccountType] = useState<'LIVE' | 'DEMO'>('DEMO');

  const [activeTab, setActiveTab] = useState<NavTab>(() => initialRoute?.tab ?? 'dashboard');
  const [analyzerSubTab, setAnalyzerSubTab] = useState<AnalyzerSubTab>('auto-analyzer');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const {
    toasts,
    setToasts,
    pushToast,
    soundAlertsEnabled,
    setSoundAlertsEnabled,
  } = useWorkspaceToasts();
  const [liveBrokerBalance, setLiveBrokerBalance] = useState<{
    balance: number;
    currency: string;
    serverName?: string;
  } | null>(null);

  // Standalone localStorage state (immediate access without requiring any app connection)
  const [config, setConfig] = useState<StrategyConfig>(() => loadLocalConfig());
  const [accountProfile, setAccountProfile] = useState<AccountProfileSettings>(() =>
    loadLocalAccountProfile()
  );
  const [pineStrategies, setPineStrategies] = useState<PineStrategyRecord[]>(() =>
    loadLocalPineStrategies()
  );
  const [pineBotLogs, setPineBotLogs] = useState<PineBotActivityLog[]>([]);
  const [demoWallet, setDemoWallet] = useState<DemoWalletState>(() => loadLocalWallet());
  const [signals, setSignals] = useState<StoredTradeSignal[]>(() => loadLocalSignals());
  const [trades, setTrades] = useState<TradeJournalEntry[]>(() => loadLocalTrades());
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>(() => loadLocalChat());
  const [telegramLogs, setTelegramLogs] = useState<TelegramLogRecord[]>(() =>
    loadLocalTelegramLogs()
  );
  const [orders, setOrders] = useState<ExecutionOrderRecord[]>(() => loadLocalOrders());
  const [priceAlerts, setPriceAlerts] = useState<PriceAlertRule[]>(() => loadLocalPriceAlerts());
  const priceAlertsRef = useRef<PriceAlertRule[]>(priceAlerts);
  priceAlertsRef.current = priceAlerts;

  // Economic calendar, global session clocks & Prop-Firm daily risk guardrail override
  const [economicCalendar, setEconomicCalendar] = useState<EconomicCalendarResponse | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [guardrailOverride, setGuardrailOverride] = useState(false);
  const monitorSessionIdRef = useRef<string>('');
  if (!monitorSessionIdRef.current && typeof window !== 'undefined') {
    try {
      const existing = window.localStorage.getItem('mytrade_monitor_session_id');
      if (existing && existing.length >= 8) {
        monitorSessionIdRef.current = existing;
      } else {
        const created = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        window.localStorage.setItem('mytrade_monitor_session_id', created);
        monitorSessionIdRef.current = created;
      }
    } catch {
      monitorSessionIdRef.current = `sess_${Date.now().toString(36)}`;
    }
  }

  // Market & Live Signal state
  const [selectedInstrumentId, setSelectedInstrumentId] = useState(
    () => initialRoute?.instrumentId || loadLocalAccountProfile().defaultInstrumentId || 'NIFTY50'
  );
  const [timeframe, setTimeframe] = useState<Timeframe>(
    () => loadLocalAccountProfile().defaultTimeframe || '5m'
  );
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
  const pineBotExecutedKeysRef = useRef<Set<string>>(new Set());
  const closingPaperIdsRef = useRef<Set<string>>(new Set());
  const tradeTrailRef = useRef<Map<string, TradeTrailState>>(new Map());
  const [tradeProtectionMap, setTradeProtectionMap] = useState<Record<string, TradeTrailState>>({});
  const pineStrategiesRef = useRef<PineStrategyRecord[]>(pineStrategies);
  pineStrategiesRef.current = pineStrategies;

  // Strictly isolate Actual (LIVE) trades/orders from Demo (PAPER) trades/orders
  const scopedTrades = useMemo(
    () =>
      trades.filter((t) =>
        activeAccountType === 'LIVE' ? t.executionMode === 'LIVE' : t.executionMode === 'PAPER'
      ),
    [trades, activeAccountType]
  );
  const scopedOrders = useMemo(
    () =>
      orders.filter((o) =>
        activeAccountType === 'LIVE' ? o.executionMode === 'LIVE' : o.executionMode === 'PAPER'
      ),
    [orders, activeAccountType]
  );
  const scopedTradesRef = useRef<TradeJournalEntry[]>(scopedTrades);
  scopedTradesRef.current = scopedTrades;

  const [livePricesBySymbol, setLivePricesBySymbol] = useState<Record<string, LivePricePoint>>({});
  const [autoScanResults, setAutoScanResults] = useState<AutoScanMarketItem[]>([]);
  const [autoScanLoading, setAutoScanLoading] = useState(false);
  const [lastAutoScanAt, setLastAutoScanAt] = useState<string | null>(null);
  const [autoScanEnabled, setAutoScanEnabled] = useState(false);
  const [autoExecuteEnabled, setAutoExecuteEnabled] = useState(false);
  const [autoPilotNote, setAutoPilotNote] = useState<string | null>(null);
  const [executingInstrumentSymbol, setExecutingInstrumentSymbol] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACCOUNT_TYPE_STORAGE_KEY, activeAccountType);
    } catch {
      // Ignore storage quota issues
    }
  }, [activeAccountType]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SOUND_ALERTS_STORAGE_KEY, soundAlertsEnabled ? '1' : '0');
    } catch {
      // Ignore storage quota issues
    }
  }, [soundAlertsEnabled]);

  // URL hash sync so refresh preserves exact account mode (#/demo/... vs #/live/...) and Back/Forward works cleanly
  useEffect(() => {
    const modePrefix = activeAccountType === 'LIVE' ? 'live' : 'demo';
    const nextHash =
      viewStage === 'landing'
        ? '#/landing'
        : viewStage === 'onboarding'
          ? '#/onboarding'
          : activeTab === 'terminal'
            ? `#/${modePrefix}/terminal/${selectedInstrumentId}`
            : `#/${modePrefix}/${activeTab}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [viewStage, activeTab, selectedInstrumentId, activeAccountType]);

  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseHashRoute(window.location.hash);
      if (!parsed) return;
      if (parsed.accountMode === 'LIVE') {
        if (auth.currentUser) {
          setActiveAccountType('LIVE');
        } else {
          setActiveAccountType('DEMO');
        }
      } else if (parsed.accountMode === 'DEMO') {
        setActiveAccountType('DEMO');
      }
      setViewStage(parsed.stage);
      if (parsed.tab) setActiveTab(parsed.tab);
      if (parsed.instrumentId) setSelectedInstrumentId(parsed.instrumentId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Global Ctrl+K / Cmd+K Quick-Jump Command Palette shortcut (disabled on onboarding or overlapping modals)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (viewStage === 'onboarding' || loginModalOpen || brokerModalOpen || Boolean(orderModalSignal)) {
          return;
        }
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewStage, loginModalOpen, brokerModalOpen, orderModalSignal]);

  // Real Firebase Google Auth subscription; guest users are strictly locked to DEMO mode
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        setLoginModalOpen(false);
        try {
          await ensureUserProfileAndConfig(u);
        } catch {
          // Stay operational if profile sync encounters a transient error
        }
        if (postLoginActionRef.current === 'ENTER_LIVE') {
          postLoginActionRef.current = 'NONE';
          redirectAfterLoginRef.current = false;
          pendingLiveRouteRef.current = false;
          setActiveAccountType('LIVE');
          setActiveTab('dashboard');
          setViewStage('workspace');
          pushToast('Actual Account Active', `Signed in as ${u.email || 'verified trader'} (LIVE mode).`, 'emerald');
        } else if (postLoginActionRef.current === 'ENTER_DEMO') {
          postLoginActionRef.current = 'NONE';
          redirectAfterLoginRef.current = false;
          pendingLiveRouteRef.current = false;
          setActiveAccountType('DEMO');
          setActiveTab('dashboard');
          setViewStage('workspace');
          pushToast('Demo Account Synced', `Signed in as ${u.email || 'trader'} in isolated Demo mode.`, 'blue');
        } else if (postLoginActionRef.current === 'STAY_IN_WORKSPACE') {
          postLoginActionRef.current = 'NONE';
          redirectAfterLoginRef.current = false;
          pendingLiveRouteRef.current = false;
          pushToast('Google Cloud Sync Active', `Connected ${u.email || 'your account'} without leaving your workspace.`, 'emerald');
        } else if (pendingLiveRouteRef.current) {
          pendingLiveRouteRef.current = false;
          setActiveAccountType('LIVE');
        }
      } else {
        pendingLiveRouteRef.current = false;
        setActiveAccountType('DEMO');
        setLiveBrokerBalance(null);
      }
    });
    return () => unsub();
  }, [pushToast]);

  // Fetch server integration & broker readiness (non-secret booleans + active OAuth sessions)
  const refreshBrokerAndIntegrationStatus = useCallback(() => {
    fetch('/api/integrations/status')
      .then((r) => r.json())
      .then((d) => setIntegrationStatus(d))
      .catch(() => {});
    authFetch('/api/brokers/status')
      .then((r) => r.json())
      .then((d) => {
        if (d?.brokers) setBrokerReadiness(d.brokers);
        if (typeof d?.anyLiveBrokerConfigured === 'boolean') {
          setIntegrationStatus((prev) => ({
            ...prev,
            brokerConfigured: d.anyLiveBrokerConfigured,
          }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshBrokerAndIntegrationStatus();
  }, [refreshBrokerAndIntegrationStatus, user?.uid]);

  // Fetch Global Market Sessions & High-Impact Economic Calendar (initial + 60s refresh)
  const refreshEconomicCalendar = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const res = await fetch('/api/calendar/economic');
      if (res.ok) {
        const data = (await res.json()) as EconomicCalendarResponse;
        setEconomicCalendar(data);
      }
    } catch {
      // Preserve last calendar snapshot silently
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewStage !== 'workspace') return;
    void refreshEconomicCalendar();
    const timer = window.setInterval(() => void refreshEconomicCalendar(), 60_000);
    return () => window.clearInterval(timer);
  }, [viewStage, refreshEconomicCalendar]);

  // Prop-Firm Daily Risk Guardrail Status (Today's realized + live MTM P&L % vs daily limits)
  const dailyGuardrailStatus = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const getMs = (ts: any): number => {
      if (!ts) return 0;
      if (typeof ts.toDate === 'function') return ts.toDate().getTime();
      if (typeof ts.seconds === 'number') return ts.seconds * 1000;
      const parsed = Date.parse(String(ts));
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    let todayRealized = 0;
    let openMtm = 0;

    for (const t of scopedTrades) {
      if (t.status === 'CLOSED') {
        const closedMs = getMs(t.updatedAt) || getMs(t.createdAt);
        if (closedMs >= todayMs) {
          todayRealized += Number(t.pnl) || 0;
        }
      } else if (t.status === 'OPEN') {
        const partial = typeof t.partialRealizedPnl === 'number' ? t.partialRealizedPnl : 0;
        const norm = t.instrument.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const meta = INSTRUMENTS.find(
          (i) =>
            i.id.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm ||
            i.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm ||
            norm.includes(i.id.toUpperCase().replace(/[^A-Z0-9]/g, ''))
        );
        const feed = meta ? livePricesBySymbol[meta.id] : undefined;
        if (feed && Math.abs(feed.price - t.entryPrice) / Math.max(t.entryPrice, 1) <= 0.45) {
          const diff = t.direction === 'BUY' ? feed.price - t.entryPrice : t.entryPrice - feed.price;
          const remQty =
            typeof t.remainingQuantity === 'number' && t.remainingQuantity > 0
              ? t.remainingQuantity
              : t.quantity;
          openMtm += partial + diff * remQty;
        } else {
          openMtm += partial;
        }
      }
    }

    const todayPnl = Number((todayRealized + openMtm).toFixed(2));
    const baseCapital =
      activeAccountType === 'LIVE'
        ? Math.max(100, liveBrokerBalance?.balance ?? 1000)
        : Math.max(1000, demoWallet.balance);
    const todayPnlPct = Number(((todayPnl / baseCapital) * 100).toFixed(2));
    const maxLossPct = Math.max(0.5, Number(config.dailyMaxLossPct ?? 3.0));
    const profitTargetPct = Math.max(1, Number(config.dailyProfitTargetPct ?? 10.0));

    const hitLoss = todayPnlPct <= -maxLossPct;
    const hitProfit = todayPnlPct >= profitTargetPct;
    const locked = hitLoss || hitProfit;
    const reason = hitLoss
      ? `Daily Max Loss Limit (-${maxLossPct}%) Reached — New Auto-Trades Locked`
      : hitProfit
        ? `Daily Profit Target (+${profitTargetPct}%) Reached — Gains Protected`
        : null;

    return {
      locked,
      reason,
      todayPnl,
      todayPnlPct,
      maxLossPct,
      profitTargetPct,
      overrideActive: guardrailOverride,
    };
  }, [
    scopedTrades,
    livePricesBySymbol,
    activeAccountType,
    liveBrokerBalance?.balance,
    demoWallet.balance,
    config.dailyMaxLossPct,
    config.dailyProfitTargetPct,
    guardrailOverride,
  ]);

  const newsShieldBlocked = Boolean(
    (config.pauseOnHighImpactNews ?? true) && economicCalendar?.highImpactBlackout?.active
  );

  // Price Alert CRUD helpers
  const handleAddPriceAlert = useCallback(
    (rule: Omit<PriceAlertRule, 'id' | 'active' | 'createdAt'>) => {
      const nextRule: PriceAlertRule = {
        ...rule,
        id: `alrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        active: true,
        createdAt: new Date().toISOString(),
      };
      setPriceAlerts((prev) => {
        const updated = [nextRule, ...prev].slice(0, 50);
        saveLocalPriceAlerts(updated);
        return updated;
      });
      pushToast(
        `Price Alert Armed · ${rule.symbol}`,
        `Triggers when ${rule.symbol} ${rule.condition === 'ABOVE' ? '≥' : '≤'} ${rule.targetPrice}`,
        'blue'
      );
    },
    [pushToast]
  );

  const handleDeletePriceAlert = useCallback((id: string) => {
    setPriceAlerts((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      saveLocalPriceAlerts(updated);
      return updated;
    });
  }, []);

  const handleClearTriggeredAlerts = useCallback(() => {
    setPriceAlerts((prev) => {
      const updated = prev.filter((a) => a.active);
      saveLocalPriceAlerts(updated);
      return updated;
    });
  }, []);

  // Auto-sync live Exness MT5 balance when signed in and Exness bridge is configured
  useEffect(() => {
    if (!user || !brokerReadiness.EXNESS) return;
    let cancelled = false;
    void authFetch('/api/brokers/exness/test', { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.connected && typeof d.balance === 'number') {
          setLiveBrokerBalance({
            balance: d.balance,
            currency: d.currency || 'USD',
            serverName: d.serverName,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, brokerReadiness.EXNESS]);

  // Firestore subscriptions when optionally signed in; revert to local store on sign-out
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setConfig(loadLocalConfig());
      setAccountProfile(loadLocalAccountProfile());
      setPineStrategies(loadLocalPineStrategies());
      setDemoWallet(loadLocalWallet());
      setSignals(loadLocalSignals());
      setTrades(loadLocalTrades());
      setChatMessages(loadLocalChat());
      setTelegramLogs(loadLocalTelegramLogs());
      setOrders(loadLocalOrders());
      return;
    }

    const unsubConfig = subscribeStrategyConfig(user.uid, setConfig);
    const unsubAccount = subscribeAccountSettings(user.uid, (settings, existsInDb) => {
      setAccountProfile(settings);
      if (redirectAfterLoginRef.current) {
        redirectAfterLoginRef.current = false;
        if (!existsInDb || !settings.onboardingCompleted) {
          setViewStage('onboarding');
        } else {
          setViewStage('landing');
        }
      }
    });
    const unsubPine = subscribePineStrategies(user.uid, setPineStrategies);
    const unsubWallet = subscribeDemoWallet(user.uid, setDemoWallet);
    const unsubSignals = subscribeSignals(user.uid, setSignals);
    const unsubTrades = subscribeTrades(user.uid, setTrades);
    const unsubChat = subscribeChatMessages(user.uid, setChatMessages);
    const unsubTg = subscribeTelegramLogs(user.uid, setTelegramLogs);
    const unsubOrders = subscribeExecutionOrders(user.uid, setOrders);
    return () => {
      unsubConfig();
      unsubAccount();
      unsubPine();
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

  // Initial fetch whenever workspace opens or instrument/timeframe changes
  useEffect(() => {
    if (viewStage !== 'workspace') return;
    refreshQuote({ silent: false });
  }, [viewStage, refreshQuote]);

  // Fast 1.5-second live polling on Terminal while liveStreaming is active
  useEffect(() => {
    if (viewStage !== 'workspace' || activeTab !== 'terminal' || !liveStreaming) return;
    const timer = window.setInterval(() => {
      refreshQuote({ silent: true });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [viewStage, activeTab, liveStreaming, refreshQuote]);

  const handleLivePriceTick = useCallback((instrumentId: string, price: number) => {
    const nowIso = new Date().toISOString();
    setQuote((prev) => {
      if (!prev || !prev.available || prev.instrument.id !== instrumentId) return prev;
      const prevClose = prev.previousClose ?? prev.price ?? price;
      const change = Number((price - prevClose).toFixed(4));
      const changePercent = prevClose ? Number(((change / prevClose) * 100).toFixed(2)) : 0;
      return {
        ...prev,
        price,
        change,
        changePercent,
        marketTimestamp: nowIso,
      };
    });
    setLivePricesBySymbol((prev) => {
      const prevEntry = prev[instrumentId];
      return {
        ...prev,
        [instrumentId]: {
          price,
          changePercent: prevEntry?.changePercent ?? 0,
          marketTimestamp: nowIso,
        },
      };
    });
  }, []);

  // Keep live LTP map warm globally across ALL workspace tabs whenever open trades exist
  useEffect(() => {
    if (viewStage !== 'workspace') return;
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
        if (meta && (activeTab !== 'terminal' || meta.id !== selectedInstrumentId)) {
          openIds.add(meta.id);
        }
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
  }, [viewStage, activeTab, selectedInstrumentId]);

  // Automatic 3-TP Stepped SL Trailing Monitor (Persisted to Firestore & localStorage)
  useEffect(() => {
    const openTrades = trades.filter((t) => t.status === 'OPEN');
    const activeIds = new Set(openTrades.map((t) => t.id));

    let mapChanged = false;
    for (const id of Array.from(tradeTrailRef.current.keys())) {
      if (!activeIds.has(id)) {
        tradeTrailRef.current.delete(id);
        mapChanged = true;
      }
    }

    for (const trade of openTrades) {
      const isBuy = trade.direction === 'BUY';
      const dir = isBuy ? 1 : -1;
      const roundLvl = (n: number) => Number(n.toFixed(trade.entryPrice < 10 ? 4 : 2));
      const baseSlDist =
        Math.abs(trade.entryPrice - trade.stopLoss) > 0
          ? Math.abs(trade.entryPrice - trade.stopLoss)
          : trade.target1
            ? Math.abs(trade.target1 - trade.entryPrice) / 1.2
            : 0;
      if (baseSlDist <= 0) continue;

      const target1 =
        trade.target1 && (isBuy ? trade.target1 > trade.entryPrice : trade.target1 < trade.entryPrice)
          ? trade.target1
          : roundLvl(trade.entryPrice + dir * baseSlDist * 1.2);
      const target2 =
        trade.target2 && (isBuy ? trade.target2 > target1 : trade.target2 < target1)
          ? trade.target2
          : roundLvl(trade.entryPrice + dir * baseSlDist * 2.2);
      const target3 =
        trade.target3 && (isBuy ? trade.target3 > target2 : trade.target3 < target2)
          ? trade.target3
          : roundLvl(trade.entryPrice + dir * baseSlDist * 3.2);

      const persistedStage: 0 | 1 | 2 =
        trade.tpStage === 2 ? 2 : trade.tpStage === 1 ? 1 : 0;

      const existingState = tradeTrailRef.current.get(trade.id);
      let state: TradeTrailState;
      if (existingState) {
        state = existingState;
      } else {
        state = {
          currentSl: trade.stopLoss,
          tpStage: persistedStage,
          target1,
          target2,
          target3,
        };
        tradeTrailRef.current.set(trade.id, state);
        mapChanged = true;
      }

      if (closingPaperIdsRef.current.has(trade.id)) continue;

      const norm = trade.instrument.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const meta = INSTRUMENTS.find(
        (i) =>
          i.id.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm ||
          i.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm ||
          norm.includes(i.id.toUpperCase().replace(/[^A-Z0-9]/g, ''))
      );
      if (!meta) continue;
      const feed = livePricesBySymbol[meta.id];
      if (!feed || !Number.isFinite(feed.price)) continue;
      const ltp = feed.price;
      // Sanity check against price-scale mismatch (e.g. spot vs option premium)
      if (Math.abs(ltp - trade.entryPrice) / Math.max(trade.entryPrice, 1) > 0.45) continue;

      let nextStage: 0 | 1 | 2 = state.tpStage;
      let nextSl = state.currentSl;
      let nextPartialPnl = typeof trade.partialRealizedPnl === 'number' ? trade.partialRealizedPnl : 0;
      let nextRemQty =
        typeof trade.remainingQuantity === 'number' && trade.remainingQuantity > 0
          ? trade.remainingQuantity
          : trade.quantity;
      const nextAudit = Array.isArray(trade.auditTrail) ? [...trade.auditTrail] : [];
      const partialEnabled = config.enablePartialProfitBooking !== false;
      const nowTime = new Date().toLocaleTimeString();

      if (isBuy) {
        if (nextStage < 1 && ltp >= target1) {
          nextStage = 1;
          nextSl = Math.max(nextSl, roundLvl(trade.entryPrice + 0.15 * baseSlDist));
          if (partialEnabled && trade.quantity >= 0.05) {
            const bookQty = Number((trade.quantity * 0.4).toFixed(4));
            const bookedPnl = Number(((target1 - trade.entryPrice) * bookQty).toFixed(2));
            nextPartialPnl = Number((nextPartialPnl + bookedPnl).toFixed(2));
            nextRemQty = Number(Math.max(0.01, trade.quantity - bookQty).toFixed(4));
            nextAudit.push(
              `[${nowTime}] TP1 @ ${target1}: Booked 40% (${bookQty}) +${bookedPnl}, SL → ${nextSl} (BE)`
            );
          } else {
            nextAudit.push(`[${nowTime}] TP1 @ ${target1}: SL trailed to ${nextSl} (Breakeven Lock)`);
          }
        }
        if (nextStage < 2 && ltp >= target2) {
          nextStage = 2;
          nextSl = Math.max(nextSl, target1);
          if (partialEnabled && trade.quantity >= 0.05) {
            const bookQty = Number((trade.quantity * 0.3).toFixed(4));
            const bookedPnl = Number(((target2 - trade.entryPrice) * bookQty).toFixed(2));
            nextPartialPnl = Number((nextPartialPnl + bookedPnl).toFixed(2));
            nextRemQty = Number(Math.max(0.01, trade.quantity * 0.3).toFixed(4));
            nextAudit.push(
              `[${nowTime}] TP2 @ ${target2}: Booked 30% (${bookQty}) +${bookedPnl}, SL → ${nextSl} (TP1 Lock)`
            );
          } else {
            nextAudit.push(`[${nowTime}] TP2 @ ${target2}: SL trailed to ${nextSl} (TP1 Profit Lock)`);
          }
        }
      } else {
        if (nextStage < 1 && ltp <= target1) {
          nextStage = 1;
          nextSl = Math.min(nextSl, roundLvl(trade.entryPrice - 0.15 * baseSlDist));
          if (partialEnabled && trade.quantity >= 0.05) {
            const bookQty = Number((trade.quantity * 0.4).toFixed(4));
            const bookedPnl = Number(((trade.entryPrice - target1) * bookQty).toFixed(2));
            nextPartialPnl = Number((nextPartialPnl + bookedPnl).toFixed(2));
            nextRemQty = Number(Math.max(0.01, trade.quantity - bookQty).toFixed(4));
            nextAudit.push(
              `[${nowTime}] TP1 @ ${target1}: Booked 40% (${bookQty}) +${bookedPnl}, SL → ${nextSl} (BE)`
            );
          } else {
            nextAudit.push(`[${nowTime}] TP1 @ ${target1}: SL trailed to ${nextSl} (Breakeven Lock)`);
          }
        }
        if (nextStage < 2 && ltp <= target2) {
          nextStage = 2;
          nextSl = Math.min(nextSl, target1);
          if (partialEnabled && trade.quantity >= 0.05) {
            const bookQty = Number((trade.quantity * 0.3).toFixed(4));
            const bookedPnl = Number(((trade.entryPrice - target2) * bookQty).toFixed(2));
            nextPartialPnl = Number((nextPartialPnl + bookedPnl).toFixed(2));
            nextRemQty = Number(Math.max(0.01, trade.quantity * 0.3).toFixed(4));
            nextAudit.push(
              `[${nowTime}] TP2 @ ${target2}: Booked 30% (${bookQty}) +${bookedPnl}, SL → ${nextSl} (TP1 Lock)`
            );
          } else {
            nextAudit.push(`[${nowTime}] TP2 @ ${target2}: SL trailed to ${nextSl} (TP1 Profit Lock)`);
          }
        }
      }

      if (nextStage !== state.tpStage || nextSl !== state.currentSl) {
        state = {
          currentSl: nextSl,
          tpStage: nextStage,
          target1,
          target2,
          target3,
        };
        tradeTrailRef.current.set(trade.id, state);
        mapChanged = true;

        // Persist ratcheted SL, TP stage, partial booking & audit trail
        if (user) {
          void updateTradeTrailingStop(trade.id, {
            stopLoss: nextSl,
            tpStage: nextStage,
            remainingQuantity: nextRemQty,
            partialRealizedPnl: nextPartialPnl,
            auditTrail: nextAudit.slice(-20),
          }).catch(() => {});
        } else {
          setTrades(
            updateLocalTradeTrailingStop(trade.id, {
              stopLoss: nextSl,
              tpStage: nextStage,
              remainingQuantity: nextRemQty,
              partialRealizedPnl: nextPartialPnl,
              auditTrail: nextAudit.slice(-20),
            })
          );
        }

        pushToast(
          nextStage === 2
            ? `${trade.instrument} TP2 Reached · SL → TP1 Locked`
            : `${trade.instrument} TP1 Reached · SL → Breakeven Locked`,
          `SL ratcheted to ${nextSl}${partialEnabled ? ` · Partial Booked +${nextPartialPnl.toFixed(2)} (Rem ${nextRemQty})` : ''}`,
          'emerald'
        );

        // Forward live SL trail modification to Exness MT5 bridge when running on an Actual Live position
        if (trade.executionMode === 'LIVE' && trade.brokerOrderId) {
          void authFetch('/api/orders/trail-sl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              brokerOrderId: trade.brokerOrderId,
              instrument: trade.instrument,
              newStopLoss: nextSl,
              tpStage: nextStage,
            }),
          }).catch(() => {});
        }
      }

      // Automatic paper execution exit on Trailed SL or TP3 Full Target (combining partial booked + runner)
      if (trade.executionMode === 'PAPER') {
        let closePrice: number | null = null;
        let closeNote = '';

        if (isBuy) {
          if (ltp <= state.currentSl) {
            closePrice = state.currentSl;
            closeNote =
              state.tpStage === 2
                ? 'Auto-closed on Stepped Trailing SL (TP2 → TP1 Profit Locked)'
                : state.tpStage === 1
                  ? 'Auto-closed on Stepped Trailing SL (TP1 → Breakeven Locked)'
                  : 'Auto-closed on Initial Stop Loss';
          } else if (ltp >= target3) {
            closePrice = target3;
            closeNote = 'Auto-closed on TP3 Full Target Hit';
          }
        } else {
          if (ltp >= state.currentSl) {
            closePrice = state.currentSl;
            closeNote =
              state.tpStage === 2
                ? 'Auto-closed on Stepped Trailing SL (TP2 → TP1 Profit Locked)'
                : state.tpStage === 1
                  ? 'Auto-closed on Stepped Trailing SL (TP1 → Breakeven Locked)'
                  : 'Auto-closed on Initial Stop Loss';
          } else if (ltp <= target3) {
            closePrice = target3;
            closeNote = 'Auto-closed on TP3 Full Target Hit';
          }
        }

        if (closePrice !== null) {
          closingPaperIdsRef.current.add(trade.id);
          const runnerPnl = (isBuy ? closePrice - trade.entryPrice : trade.entryPrice - closePrice) * nextRemQty;
          const pnl = Number((nextPartialPnl + runnerPnl).toFixed(2));
          const result = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN';
          const finalAudit = [
            ...nextAudit,
            `[${nowTime}] ${closeNote} @ ${closePrice} (Runner ${nextRemQty}) · Total Net P&L ${pnl >= 0 ? '+' : ''}${pnl}`,
          ].slice(-20);
          const doClose = async () => {
            try {
              if (user) {
                await closeTradeEntry(trade.id, {
                  exitPrice: closePrice!,
                  pnl,
                  result,
                  screenshotNote: closeNote,
                  remainingQuantity: 0,
                  partialRealizedPnl: nextPartialPnl,
                  auditTrail: finalAudit,
                });
              } else {
                setTrades(
                  closeLocalTrade(trade.id, {
                    exitPrice: closePrice!,
                    pnl,
                    result,
                    screenshotNote: closeNote,
                    remainingQuantity: 0,
                    partialRealizedPnl: nextPartialPnl,
                    auditTrail: finalAudit,
                  })
                );
              }
              tradeTrailRef.current.delete(trade.id);
              pushToast(
                `${trade.instrument} Closed (${result})`,
                `${closeNote} · Net P&L ${pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}`,
                pnl >= 0 ? 'emerald' : 'rose'
              );
            } finally {
              closingPaperIdsRef.current.delete(trade.id);
            }
          };
          void doClose();
        }
      }
    }

    if (mapChanged) {
      const snapshot: Record<string, TradeTrailState> = {};
      tradeTrailRef.current.forEach((v, k) => {
        snapshot[k] = v;
      });
      setTradeProtectionMap(snapshot);
    }
  }, [livePricesBySymbol, trades, user, config.enablePartialProfitBooking, pushToast]);

  // Global Custom Price Alert Evaluator on Live Ticks
  useEffect(() => {
    const active = priceAlertsRef.current.filter((a) => a.active);
    if (active.length === 0) return;

    const triggeredIds = new Map<string, { price: number; at: string; rule: PriceAlertRule }>();
    const nowIso = new Date().toISOString();

    for (const rule of active) {
      const feed = livePricesBySymbol[rule.instrumentId];
      if (!feed || !Number.isFinite(feed.price)) continue;
      const hit =
        rule.condition === 'ABOVE'
          ? feed.price >= rule.targetPrice
          : feed.price <= rule.targetPrice;
      if (hit) {
        triggeredIds.set(rule.id, { price: feed.price, at: nowIso, rule });
      }
    }

    if (triggeredIds.size === 0) return;

    setPriceAlerts((prev) => {
      const updated = prev.map((a) => {
        const hit = triggeredIds.get(a.id);
        if (!hit) return a;
        return {
          ...a,
          active: false,
          triggeredAt: hit.at,
          triggeredPrice: hit.price,
        };
      });
      saveLocalPriceAlerts(updated);
      return updated;
    });

    for (const { price, rule } of triggeredIds.values()) {
      pushToast(
        `Price Alert Triggered · ${rule.symbol}`,
        `${rule.symbol} crossed ${rule.condition === 'ABOVE' ? 'above' : 'below'} ${rule.targetPrice} (Live ${price})${rule.note ? ` · ${rule.note}` : ''}`,
        'emerald'
      );
      if (rule.sendTelegram) {
        void authFetch('/api/telegram/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageText: `MY TRADE PRICE ALERT\n${rule.symbol} crossed ${rule.condition} ${rule.targetPrice}\nLive Price: ${price}${rule.note ? `\nNote: ${rule.note}` : ''}`,
            chatId: config.telegramChannelLabel,
          }),
        }).catch(() => {});
      }
    }
  }, [livePricesBySymbol, config.telegramChannelLabel, pushToast]);

  // Sync kill switch state to the authoritative server-side guard whenever signed-in user or config changes
  useEffect(() => {
    if (!user?.emailVerified) return;
    void authFetch('/api/account/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ killSwitchActive: Boolean(config.killSwitchActive) }),
    }).catch(() => {});
  }, [user, config.killSwitchActive]);

  // 24/7 Server-Side Position Monitor Sync & Event Reconciliation (continues monitoring even if tab was closed)
  useEffect(() => {
    if (viewStage !== 'workspace' || !user?.emailVerified) return;

    const syncServerMonitor = async () => {
      const openList = tradesRef.current.filter((t) => t.status === 'OPEN');
      const items: MonitoredPositionSyncItem[] = [];
      for (const t of openList) {
        const norm = t.instrument.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const meta = INSTRUMENTS.find(
          (i) =>
            i.id.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm ||
            i.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm ||
            norm.includes(i.id.toUpperCase().replace(/[^A-Z0-9]/g, ''))
        );
        if (!meta) continue;
        const slDist = Math.abs(t.entryPrice - t.stopLoss) || t.entryPrice * 0.005;
        const dir = t.direction === 'BUY' ? 1 : -1;
        const roundLvl = (n: number) => Number(n.toFixed(t.entryPrice < 10 ? 4 : 2));
        items.push({
          tradeId: t.id,
          instrumentId: meta.id,
          symbol: meta.symbol,
          contract: t.contract,
          direction: t.direction,
          executionMode: t.executionMode,
          entryPrice: t.entryPrice,
          stopLoss: t.stopLoss,
          target1: t.target1 || roundLvl(t.entryPrice + dir * slDist * 1.5),
          target2: t.target2 || roundLvl(t.entryPrice + dir * slDist * 2.4),
          target3: t.target3 || roundLvl(t.entryPrice + dir * slDist * 3.4),
          tpStage: t.tpStage === 2 ? 2 : t.tpStage === 1 ? 1 : 0,
          quantity: t.quantity,
          remainingQuantity:
            typeof t.remainingQuantity === 'number' && t.remainingQuantity > 0
              ? t.remainingQuantity
              : t.quantity,
          partialRealizedPnl: typeof t.partialRealizedPnl === 'number' ? t.partialRealizedPnl : 0,
          enablePartialProfitBooking: config.enablePartialProfitBooking !== false,
          brokerOrderId: t.brokerOrderId,
        });
      }

      try {
        const res = await authFetch('/api/monitor/positions/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: monitorSessionIdRef.current,
            positions: items,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { events?: MonitoredPositionEvent[] };
        const events = Array.isArray(data?.events) ? data.events : [];
        for (const ev of events) {
          const targetTrade = tradesRef.current.find((x) => x.id === ev.tradeId);
          if (!targetTrade || targetTrade.status !== 'OPEN') continue;
          const prevAudit = Array.isArray(targetTrade.auditTrail) ? targetTrade.auditTrail : [];
          const stamped = `[${new Date(ev.timestamp).toLocaleTimeString()} · 24/7 Server] ${ev.detail}`;
          const nextAudit = [...prevAudit, stamped].slice(-20);

          if (ev.type === 'TRAIL_TP1' || ev.type === 'TRAIL_TP2') {
            if (user) {
              void updateTradeTrailingStop(ev.tradeId, {
                stopLoss: ev.newStopLoss,
                tpStage: ev.tpStage,
                remainingQuantity: ev.remainingQuantity,
                partialRealizedPnl: ev.partialRealizedPnl,
                auditTrail: nextAudit,
              }).catch(() => {});
            } else {
              setTrades(
                updateLocalTradeTrailingStop(ev.tradeId, {
                  stopLoss: ev.newStopLoss,
                  tpStage: ev.tpStage,
                  remainingQuantity: ev.remainingQuantity,
                  partialRealizedPnl: ev.partialRealizedPnl,
                  auditTrail: nextAudit,
                })
              );
            }
            pushToast(`24/7 Server Monitor · ${targetTrade.instrument}`, ev.detail, 'emerald');
          } else if (
            (ev.type === 'CLOSE_TP3' || ev.type === 'CLOSE_SL') &&
            targetTrade.executionMode === 'PAPER' &&
            typeof ev.finalPnl === 'number'
          ) {
            const result = ev.result ?? (ev.finalPnl > 0 ? 'WIN' : ev.finalPnl < 0 ? 'LOSS' : 'BREAKEVEN');
            if (user) {
              void closeTradeEntry(ev.tradeId, {
                exitPrice: ev.price,
                pnl: ev.finalPnl,
                result,
                screenshotNote: ev.detail,
                remainingQuantity: 0,
                partialRealizedPnl: ev.partialRealizedPnl,
                auditTrail: nextAudit,
              }).catch(() => {});
            } else {
              setTrades(
                closeLocalTrade(ev.tradeId, {
                  exitPrice: ev.price,
                  pnl: ev.finalPnl,
                  result,
                  screenshotNote: ev.detail,
                  remainingQuantity: 0,
                  partialRealizedPnl: ev.partialRealizedPnl,
                  auditTrail: nextAudit,
                })
              );
            }
            pushToast(
              `24/7 Server Auto-Close · ${targetTrade.instrument}`,
              `${ev.detail} · Net P&L ${ev.finalPnl >= 0 ? '+' : ''}${ev.finalPnl}`,
              ev.finalPnl >= 0 ? 'emerald' : 'rose'
            );
          }
        }
      } catch {
        // Silent retry on next interval
      }
    };

    void syncServerMonitor();
    const timer = window.setInterval(() => void syncServerMonitor(), 12_000);
    return () => window.clearInterval(timer);
  }, [viewStage, user, config.enablePartialProfitBooking, pushToast]);

  const handleOpenLoginModal = (intent: 'LIVE' | 'DEMO' | 'GENERAL' = 'GENERAL') => {
    setAuthError(null);
    setLoginModalIntent(intent);
    setLoginModalOpen(true);
  };

  const handleSignIn = async (intentOverride?: 'LIVE' | 'DEMO' | 'GENERAL') => {
    const intent = intentOverride ?? loginModalIntent;
    setAuthError(null);
    setAuthLoading(true);
    if (intent === 'LIVE') {
      postLoginActionRef.current = 'ENTER_LIVE';
      redirectAfterLoginRef.current = false;
    } else if (intent === 'DEMO') {
      postLoginActionRef.current = 'ENTER_DEMO';
      redirectAfterLoginRef.current = false;
    } else if (viewStage === 'workspace') {
      // Signing in from inside workspace keeps the trader in their current Demo/Live desk
      postLoginActionRef.current = 'STAY_IN_WORKSPACE';
      redirectAfterLoginRef.current = false;
    } else {
      postLoginActionRef.current = 'NONE';
      redirectAfterLoginRef.current = true;
    }
    try {
      await signInWithGoogle();
    } catch (err) {
      redirectAfterLoginRef.current = false;
      postLoginActionRef.current = 'NONE';
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    setActiveAccountType('DEMO');
    setJustCompletedMode(null);
    setLiveBrokerBalance(null);
    setViewStage('landing');
    pushToast('Signed Out', 'Session closed. Demo Account remains available anytime.', 'blue');
  };

  const handleSwitchAccountType = (next: 'LIVE' | 'DEMO') => {
    if (next === 'LIVE' && !user) {
      handleOpenLoginModal('LIVE');
      return;
    }
    setActiveAccountType(next);
    setAutoPilotNote(null);
  };

  const handleEnterActualAccount = () => {
    if (!user) {
      handleOpenLoginModal('LIVE');
      return;
    }
    setActiveAccountType('LIVE');
    setActiveTab('dashboard');
    setViewStage('workspace');
  };

  const handleEnterDemoAccount = () => {
    setLoginModalOpen(false);
    setActiveAccountType('DEMO');
    setActiveTab('dashboard');
    setViewStage('workspace');
  };

  const handleConnectBrokerOnboarding = async (params: {
    brokerProviderLabel: string;
    displayName: string;
    email: string;
    mobileNumber: string;
  }) => {
    const nextProfile: AccountProfileSettings = {
      ...accountProfile,
      displayName: params.displayName || accountProfile.displayName,
      email: params.email || accountProfile.email,
      mobileNumber: params.mobileNumber || accountProfile.mobileNumber,
      accountMode: 'BROKER',
      onboardingCompleted: true,
    };
    const { userId: _u, updatedAt: _t, ...restConfig } = config;
    const nextConfig = {
      ...restConfig,
      brokerProviderLabel: params.brokerProviderLabel.slice(0, 80),
    };

    if (user) {
      await Promise.all([
        saveAccountSettings(user.uid, nextProfile),
        saveStrategyConfig(user.uid, nextConfig),
      ]);
      setJustCompletedMode('BROKER');
      setActiveAccountType('LIVE');
      setActiveTab('dashboard');
      setViewStage('workspace');
      pushToast('Actual Account Ready', `Bound to ${params.brokerProviderLabel}.`, 'emerald');
    } else {
      setAccountProfile(saveLocalAccountProfile(nextProfile));
      setConfig(saveLocalConfig(nextConfig));
      setJustCompletedMode('BROKER');
      setActiveAccountType('DEMO');
      setViewStage('landing');
      handleOpenLoginModal('LIVE');
    }
  };

  const handleCreateDemoOnboarding = async (params: {
    displayName: string;
    mobileNumber: string;
    email: string;
    startingCapital: number;
    defaultInstrumentId: string;
    defaultTimeframe: Timeframe;
    riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  }) => {
    const nextProfile: AccountProfileSettings = {
      ...accountProfile,
      displayName: params.displayName,
      mobileNumber: params.mobileNumber,
      email: params.email,
      accountMode: 'DEMO',
      onboardingCompleted: true,
      defaultInstrumentId: params.defaultInstrumentId,
      defaultTimeframe: params.defaultTimeframe,
      riskProfile: params.riskProfile,
    };
    const { userId: _u, updatedAt: _t, ...restConfig } = config;
    const nextConfig = {
      ...restConfig,
      brokerProviderLabel: 'My Trade Paper Engine · Demo Active',
      paperTradingOnly: true,
    };

    if (user) {
      await Promise.all([
        saveAccountSettings(user.uid, nextProfile),
        saveStrategyConfig(user.uid, nextConfig),
        resetDemoWallet(user.uid, params.startingCapital),
      ]);
    } else {
      setAccountProfile(saveLocalAccountProfile(nextProfile));
      setConfig(saveLocalConfig(nextConfig));
      setDemoWallet(resetLocalDemoWallet(params.startingCapital));
    }

    setSelectedInstrumentId(params.defaultInstrumentId);
    setTimeframe(params.defaultTimeframe);
    setActiveAccountType('DEMO');
    setJustCompletedMode('DEMO');
    setActiveTab('dashboard');
    setViewStage('workspace');
    pushToast(
      'Demo Account Created',
      `Isolated Demo workspace ready with ${params.startingCapital.toLocaleString()} virtual balance.`,
      'blue'
    );
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
      const res = await authFetch('/api/telegram/send', {
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
      const res = await authFetch('/api/ai/analyze-live', {
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

  const computeSmartRiskQuantity = useCallback(
    (entryPrice: number, stopLoss: number, riskPctOverride?: number): number => {
      const capital =
        activeAccountType === 'LIVE'
          ? Math.max(100, liveBrokerBalance?.balance ?? 1000)
          : Math.max(1000, demoWallet.balance);
      const riskPct = Math.max(0.25, Math.min(riskPctOverride ?? config.maxRiskPerTradePct ?? 2.0, 10));
      const slDist = Math.abs(entryPrice - stopLoss);
      if (entryPrice <= 0 || slDist <= 0) return 1;
      const riskAmount = capital * (riskPct / 100);
      const rawQty = riskAmount / Math.max(slDist, entryPrice * 0.001);
      const maxNotionalQty = (capital * 6) / entryPrice;
      const bounded = Math.max(0.01, Math.min(rawQty, maxNotionalQty));
      return bounded >= 10 ? Math.round(bounded) : Number(bounded.toFixed(2));
    },
    [activeAccountType, liveBrokerBalance?.balance, demoWallet.balance, config.maxRiskPerTradePct]
  );

  const handleLogPaperTrade = async (signal: GeneratedSignalPayload) => {
    if (signal.direction === 'NO_TRADE') return;
    const sizedQty = computeSmartRiskQuantity(signal.entryPrice, signal.stopLoss);
    const slDist = Math.abs(signal.entryPrice - signal.stopLoss);
    const dir = signal.direction === 'BUY' ? 1 : -1;
    const roundLvl = (n: number) => Number(n.toFixed(signal.entryPrice < 10 ? 4 : 2));
    const tp2 = signal.target2 || roundLvl(signal.entryPrice + dir * slDist * 2.2);
    const tp3 = signal.target3 || roundLvl(signal.entryPrice + dir * slDist * 3.2);

    const tradePayload = {
      instrument: signal.instrument,
      contract: signal.contract,
      direction: signal.direction,
      executionMode: 'PAPER' as const,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      target1: signal.target1,
      target2: tp2,
      target3: tp3,
      quantity: sizedQty,
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
    setActiveAccountType('DEMO');
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
    const enforcedMode: TradeMode = activeAccountType === 'LIVE' ? 'LIVE' : 'PAPER';
    if (enforcedMode === 'LIVE' && !user) {
      handleOpenLoginModal('LIVE');
      throw new Error('Sign in with Google to place Actual Live trades.');
    }
    const slDist = Math.abs(orderModalSignal.entryPrice - orderModalSignal.stopLoss);
    const dir = orderModalSignal.direction === 'BUY' ? 1 : -1;
    const roundLvl = (n: number) => Number(n.toFixed(orderModalSignal.entryPrice < 10 ? 4 : 2));
    const tp2 = orderModalSignal.target2 || roundLvl(orderModalSignal.entryPrice + dir * slDist * 2.2);
    const tp3 = orderModalSignal.target3 || roundLvl(orderModalSignal.entryPrice + dir * slDist * 3.2);

    const signalId = `sig-${Date.now()}`;
    const res = await authFetch('/api/orders/execute', {
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
        target1: orderModalSignal.target1,
        target2: tp2,
        target3: tp3,
        executionMode: enforcedMode,
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
      target2: tp2,
      target3: tp3,
      executionMode: enforcedMode,
      brokerName: data.brokerName || payload.brokerName,
      brokerOrderId: data.brokerOrderId,
      status: data.status,
    };

    const journalPayload = {
      signalId,
      instrument: orderModalSignal.instrument,
      contract: orderModalSignal.contract,
      direction: orderModalSignal.direction,
      executionMode: enforcedMode,
      entryPrice: orderModalSignal.entryPrice,
      stopLoss: orderModalSignal.stopLoss,
      target1: orderModalSignal.target1,
      target2: tp2,
      target3: tp3,
      tpStage: 0 as const,
      quantity: payload.quantity,
      remainingQuantity: payload.quantity,
      partialRealizedPnl: 0,
      status: 'OPEN' as const,
      result: 'OPEN' as const,
      pnl: 0,
      riskReward: orderModalSignal.riskReward,
      strategyConfirmation: orderModalSignal.confirmationText,
      brokerOrderId: data.brokerOrderId,
      auditTrail: [
        `[${new Date().toLocaleTimeString()}] Opened ${orderModalSignal.direction} ${payload.quantity} @ ${orderModalSignal.entryPrice} (${payload.orderType} · ${enforcedMode})`,
      ],
    };

    if (user) {
      await createExecutionOrder(user.uid, orderPayload);
      await createTradeEntry(user.uid, journalPayload);
    } else {
      setOrders(createLocalOrder(orderPayload));
      setTrades(createLocalTrade(journalPayload));
    }
    pushToast(
      `${enforcedMode === 'LIVE' ? 'Live' : 'Demo'} ${orderModalSignal.direction} Filled`,
      `${orderModalSignal.instrument} · Qty ${payload.quantity} @ ${orderModalSignal.entryPrice} (3-TP Trailing Active)`,
      'blue'
    );
  };

  // Instant execution helper strictly bound to activeAccountType (LIVE vs DEMO) with 3-TP targets
  const executeSignalRecord = useCallback(
    async (
      sig: GeneratedSignalPayload,
      isAuto = false,
      orderType: 'MARKET' | 'LIMIT' = 'MARKET',
      quantityOverride?: number
    ): Promise<boolean> => {
      if (sig.direction === 'NO_TRADE' || sig.entryPrice <= 0 || config.killSwitchActive) {
        return false;
      }

      if (isAuto && dailyGuardrailStatus.locked && !dailyGuardrailStatus.overrideActive) {
        throw new Error(
          dailyGuardrailStatus.reason || 'Daily Risk Guardrail Lockout Active.'
        );
      }
      if (isAuto && newsShieldBlocked) {
        throw new Error(
          `High-Impact News Shield paused auto-execution (±15m around ${economicCalendar?.highImpactBlackout?.eventTitle || 'macro release'}).`
        );
      }

      const mode: TradeMode = activeAccountType === 'LIVE' ? 'LIVE' : 'PAPER';
      if (mode === 'LIVE' && !user) {
        throw new Error('Sign in with Google to run Actual Live account execution.');
      }
      if (mode === 'LIVE' && !integrationStatus.brokerConfigured) {
        throw new Error(
          'Live broker API not configured. Configure Exness MT5 Bridge env vars or switch to Demo Account.'
        );
      }

      const qty =
        typeof quantityOverride === 'number' && quantityOverride > 0
          ? quantityOverride
          : computeSmartRiskQuantity(sig.entryPrice, sig.stopLoss);

      const slDist = Math.abs(sig.entryPrice - sig.stopLoss);
      const dir = sig.direction === 'BUY' ? 1 : -1;
      const roundLvl = (n: number) => Number(n.toFixed(sig.entryPrice < 10 ? 4 : 2));
      const tp2 = sig.target2 || roundLvl(sig.entryPrice + dir * slDist * 2.2);
      const tp3 = sig.target3 || roundLvl(sig.entryPrice + dir * slDist * 3.2);

      const signalId = `sig-${Date.now()}-${sig.instrument.replace(/[^A-Z0-9]/gi, '')}`;
      const brokerLabel =
        mode === 'PAPER'
          ? 'My Trade Demo Paper Engine'
          : config.brokerProviderLabel || 'Exness MT5 Live Bridge';

      const res = await authFetch('/api/orders/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.uid || 'local-standalone',
          signalId,
          instrument: sig.instrument,
          contract: sig.contract,
          quantity: qty,
          orderType,
          side: sig.direction,
          entryPrice: sig.entryPrice,
          stopLoss: sig.stopLoss,
          targetPrice: sig.target1,
          target1: sig.target1,
          target2: tp2,
          target3: tp3,
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
        quantity: qty,
        orderType,
        side: sig.direction,
        entryPrice: sig.entryPrice,
        stopLoss: sig.stopLoss,
        targetPrice: sig.target1,
        target2: tp2,
        target3: tp3,
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
        target2: tp2,
        target3: tp3,
        tpStage: 0 as const,
        quantity: qty,
        remainingQuantity: qty,
        partialRealizedPnl: 0,
        status: 'OPEN' as const,
        result: 'OPEN' as const,
        pnl: 0,
        riskReward: sig.riskReward,
        strategyConfirmation: isAuto
          ? `[AUTO-PILOT 3-TP ${orderType}] ${sig.confirmationText}`
          : sig.confirmationText,
        brokerOrderId: data.brokerOrderId,
        auditTrail: [
          `[${new Date().toLocaleTimeString()}] Opened ${isAuto ? 'Auto ' : ''}${sig.direction} ${qty} @ ${sig.entryPrice} (${orderType} · ${mode})`,
        ],
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

      pushToast(
        `${isAuto ? 'Auto-Pilot' : 'Instant'} ${sig.direction} Executed`,
        `${sig.instrument} · Qty ${qty} @ ${sig.entryPrice} (${mode})`,
        'blue'
      );

      return true;
    },
    [
      activeAccountType,
      config.killSwitchActive,
      config.brokerProviderLabel,
      integrationStatus.brokerConfigured,
      computeSmartRiskQuantity,
      dailyGuardrailStatus.locked,
      dailyGuardrailStatus.overrideActive,
      dailyGuardrailStatus.reason,
      newsShieldBlocked,
      economicCalendar?.highImpactBlackout?.eventTitle,
      user,
      pushToast,
    ]
  );

  // One-Click Chart Quick-Trade Execution (BUY @ Ask / SELL @ Bid with ATR SL & 3-TP Ladder)
  const handleQuickChartOrder = useCallback(
    async (side: 'BUY' | 'SELL', quantity: number) => {
      if (!quote?.available || typeof quote.price !== 'number') {
        pushToast('Quote Unavailable', 'Wait for live Bid/Ask quote before placing a quick order.', 'rose');
        return;
      }
      if (config.killSwitchActive) {
        pushToast('Kill Switch Active', 'Disable Emergency Kill Switch in Settings before ordering.', 'rose');
        return;
      }
      if (dailyGuardrailStatus.locked && !dailyGuardrailStatus.overrideActive) {
        pushToast(
          'Daily Risk Guardrail Active',
          dailyGuardrailStatus.reason || 'Override the daily guardrail on Dashboard to continue.',
          'rose'
        );
        return;
      }

      const execPrice =
        side === 'BUY' ? (quote.ask ?? quote.price) : (quote.bid ?? quote.price);
      const atr =
        quote.technicals?.atr && quote.technicals.atr > 0
          ? quote.technicals.atr
          : execPrice * 0.004;
      const risk = Math.max(atr * 1.15, execPrice * 0.002);
      const dir = side === 'BUY' ? 1 : -1;
      const roundLvl = (n: number) => Number(n.toFixed(execPrice < 10 ? 4 : 2));

      const sl = roundLvl(execPrice - dir * risk);
      const tp1 = roundLvl(execPrice + dir * risk * 1.5);
      const tp2 = roundLvl(execPrice + dir * risk * 2.4);
      const tp3 = roundLvl(execPrice + dir * risk * 3.4);

      const quickSignal: GeneratedSignalPayload = {
        instrument: quote.instrument.symbol,
        marketSegment: quote.instrument.segment,
        contract: `${quote.instrument.symbol} · 1-Click ${side}`,
        direction: side,
        entryTrigger: `1-Click Market @ ${side === 'BUY' ? 'Ask' : 'Bid'}`,
        entryPrice: roundLvl(execPrice),
        stopLoss: sl,
        target1: tp1,
        target2: tp2,
        target3: tp3,
        riskReward: '1:3.4',
        entryTimeframe: timeframe.toUpperCase(),
        trendTimeframe: config.trendTimeframe.toUpperCase(),
        horizon: 'INTRADAY',
        invalidationLevel: sl,
        confirmationText: `1-Click Chart Execution @ ${side === 'BUY' ? 'Ask' : 'Bid'} ${roundLvl(execPrice)} (Spread ${quote.spreadBps?.toFixed(1) ?? '—'} bps) · 3-TP Stepped Trailing Armed`,
        status: 'ACTIVE',
        qualityScore: 80,
        checklist: [],
        reasonsFor: ['Manual 1-Click Chart Execution'],
        reasonsAgainst: [],
        formattedSignalText: `1-Click ${side} ${quote.instrument.symbol} @ ${roundLvl(execPrice)}`,
        telegramReadyText: `MY TRADE 1-CLICK\n${side} ${quote.instrument.symbol} @ ${roundLvl(execPrice)}\nSL: ${sl} | TP1: ${tp1} | TP2: ${tp2} | TP3: ${tp3}`,
      };

      try {
        await executeSignalRecord(quickSignal, false, 'MARKET', quantity);
      } catch (err) {
        pushToast(
          'Quick Order Blocked',
          err instanceof Error ? err.message : 'Unable to execute quick order',
          'rose'
        );
      }
    },
    [
      quote,
      config.killSwitchActive,
      config.trendTimeframe,
      dailyGuardrailStatus.locked,
      dailyGuardrailStatus.overrideActive,
      dailyGuardrailStatus.reason,
      timeframe,
      executeSignalRecord,
      pushToast,
    ]
  );

  // One-Click Chart Price Alert (sets an alert +0.25% above live price for instant breakout tracking)
  const handleQuickPriceAlertFromChart = useCallback(
    (price: number) => {
      const inst = INSTRUMENTS.find((i) => i.id === selectedInstrumentId) ?? INSTRUMENTS[0];
      const decimals = price < 10 ? 4 : 2;
      const target = Number((price * 1.0025).toFixed(decimals));
      handleAddPriceAlert({
        instrumentId: inst.id,
        symbol: inst.symbol,
        condition: 'ABOVE',
        targetPrice: target,
        note: 'Quick chart breakout (+0.25%)',
        sendTelegram: false,
      });
    },
    [selectedInstrumentId, handleAddPriceAlert]
  );

  const evaluatePineBotStrategy = useCallback(
    async (strategy: PineStrategyRecord): Promise<PineBotEvaluationResult | null> => {
      try {
        const res = await authFetch('/api/pine/evaluate-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strategyId: strategy.id,
            strategyName: strategy.name,
            instrumentId: strategy.instrumentId,
            timeframe: strategy.timeframe,
            pineCode: strategy.pineCode,
            stopLossPct: strategy.stopLossPct,
            takeProfitPct: strategy.takeProfitPct,
          }),
        });
        const evalRes = (await res.json()) as PineBotEvaluationResult;

        if (!evalRes.available) {
          setPineBotLogs((prev) =>
            [
              {
                id: `plog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                timestamp: new Date().toISOString(),
                strategyName: strategy.name,
                instrumentSymbol: strategy.instrumentId,
                timeframe: strategy.timeframe,
                action: 'ERROR' as const,
                price: 0,
                executed: false,
                detail: evalRes.error || 'Market feed unavailable',
              },
              ...prev,
            ].slice(0, 60)
          );
          return evalRes;
        }

        let didExecute = false;
        let execDetail = evalRes.reason;

        if (evalRes.action === 'BUY' || evalRes.action === 'SELL') {
          const barKey = `${activeAccountType}:${strategy.id}:${evalRes.barTime}:${evalRes.action}`;
          if (
            strategy.autoExecute &&
            !config.killSwitchActive &&
            !pineBotExecutedKeysRef.current.has(barKey)
          ) {
            pineBotExecutedKeysRef.current.add(barKey);
            const sig: GeneratedSignalPayload = {
              instrument: evalRes.instrument.symbol,
              marketSegment: evalRes.instrument.segment,
              contract: `${evalRes.instrument.symbol} [PINE BOT: ${strategy.name.slice(0, 24)}]`,
              direction: evalRes.action,
              entryTrigger: `Pine ${strategy.timeframe.toUpperCase()} trigger`,
              entryPrice: evalRes.price,
              stopLoss: evalRes.stopLoss,
              target1: evalRes.target1,
              target2: evalRes.target2,
              target3: evalRes.target3,
              riskReward: `1:${Number(
                (strategy.takeProfitPct / Math.max(strategy.stopLossPct, 0.05)).toFixed(1)
              )}`,
              entryTimeframe: strategy.timeframe.toUpperCase(),
              trendTimeframe: strategy.timeframe.toUpperCase(),
              horizon: 'INTRADAY',
              invalidationLevel: evalRes.stopLoss,
              confirmationText: `[PINE BOT 3-TP · ${strategy.name}] ${evalRes.reason}`,
              status: 'ACTIVE',
              qualityScore: 85,
              checklist: [],
              reasonsFor: [evalRes.reason],
              reasonsAgainst: [],
              formattedSignalText: `${strategy.name}: ${evalRes.action} ${evalRes.instrument.symbol} @ ${evalRes.price} | TP1: ${evalRes.target1} | TP2: ${evalRes.target2} | TP3: ${evalRes.target3}`,
              telegramReadyText: `MY TRADE PINE BOT · ${strategy.name}\n${evalRes.action} ${evalRes.instrument.symbol} @ ${evalRes.price}\nSL: ${evalRes.stopLoss} | TP1: ${evalRes.target1} | TP2: ${evalRes.target2} | TP3: ${evalRes.target3}`,
            };

            try {
              const botRiskPct = strategy.riskPerTradePct ?? 2.5;
              const botQty =
                botRiskPct > 0
                  ? computeSmartRiskQuantity(evalRes.price, evalRes.stopLoss, botRiskPct)
                  : strategy.quantity;
              didExecute = await executeSignalRecord(sig, true, 'MARKET', botQty);
              execDetail = didExecute
                ? `Auto-executed ${evalRes.action} ${botQty} qty @ ${evalRes.price} (3-TP Trailing Active)`
                : evalRes.reason;
            } catch (err) {
              pineBotExecutedKeysRef.current.delete(barKey);
              execDetail = err instanceof Error ? err.message : 'Bot execution rejected';
            }
          }
        }

        setPineBotLogs((prev) =>
          [
            {
              id: `plog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              timestamp: evalRes.evaluatedAt,
              strategyName: strategy.name,
              instrumentSymbol: evalRes.instrument.symbol,
              timeframe: strategy.timeframe,
              action: evalRes.action,
              price: evalRes.price,
              executed: didExecute,
              detail: execDetail,
            },
            ...prev,
          ].slice(0, 60)
        );

        return evalRes;
      } catch (err) {
        setPineBotLogs((prev) =>
          [
            {
              id: `plog-${Date.now()}`,
              timestamp: new Date().toISOString(),
              strategyName: strategy.name,
              instrumentSymbol: strategy.instrumentId,
              timeframe: strategy.timeframe,
              action: 'ERROR' as const,
              price: 0,
              executed: false,
              detail: err instanceof Error ? err.message : 'Pine evaluation error',
            },
            ...prev,
          ].slice(0, 60)
        );
        return null;
      }
    },
    [activeAccountType, config.killSwitchActive, computeSmartRiskQuantity, executeSignalRecord]
  );

  // Background Pine Bot live scanner every 12 seconds for any active bots (workspace + signed-in only)
  useEffect(() => {
    if (viewStage !== 'workspace' || !user?.emailVerified) return;
    const activeBots = pineStrategies.filter((s) => s.botEnabled);
    if (activeBots.length === 0) return;

    const runBots = async () => {
      for (const s of pineStrategiesRef.current.filter((x) => x.botEnabled)) {
        await evaluatePineBotStrategy(s);
      }
    };

    void runBots();
    const timer = window.setInterval(() => {
      void runBots();
    }, 12_000);

    return () => window.clearInterval(timer);
  }, [viewStage, user, pineStrategies, evaluatePineBotStrategy]);

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
      const res = await authFetch('/api/ai/auto-scan', {
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

      // Auto-Execute qualifying ACTIVE or qualified LIMIT setups without duplicating open instruments in current account
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
          const alreadyOpen = scopedTradesRef.current.some((t) => {
            if (t.status !== 'OPEN') return false;
            const tNorm = t.instrument.toUpperCase().replace(/[^A-Z0-9]/g, '');
            return tNorm === instNorm || tNorm === idNorm;
          });
          const sessionKey = `${activeAccountType}:${item.instrument.id}:${sig.direction}`;
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
          } catch (err) {
            autoExecutedKeysRef.current.delete(sessionKey);
            setAutoPilotNote(err instanceof Error ? err.message : 'Auto-execution blocked');
          }
        }

        if (executedNames.length > 0) {
          setAutoPilotNote(
            `Auto-executed ${executedNames.join(', ')} into ${activeAccountType === 'LIVE' ? 'Actual Live' : 'Demo Paper'} Account (3-TP Trailing Active).`
          );
        }
      }
    } catch {
      // Preserve last scan table silently on transient poll errors
    } finally {
      setAutoScanLoading(false);
    }
  }, [activeAccountType, config, autoExecuteEnabled, executeSignalRecord]);

  const runAutoScanRef = useRef(runAutoScanAndExecute);
  runAutoScanRef.current = runAutoScanAndExecute;

  // Strictly manual / opt-in: NEVER runs or turns on unless user explicitly enables autoScanEnabled
  useEffect(() => {
    if (viewStage !== 'workspace' || !autoScanEnabled) return;
    void runAutoScanRef.current();
    const timer = window.setInterval(() => {
      void runAutoScanRef.current();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [viewStage, autoScanEnabled]);

  const authModalElement = (
    <AuthLoginModal
      open={loginModalOpen}
      authLoading={authLoading}
      authError={authError}
      intent={loginModalIntent}
      onClose={() => setLoginModalOpen(false)}
      onGoogleSignIn={(targetMode) => handleSignIn(targetMode)}
      onContinueDemoGuest={handleEnterDemoAccount}
    />
  );

  const isMasterAdmin = Boolean(
    user?.email && user.email.trim().toLowerCase() === MASTER_ADMIN_EMAIL
  );

  const visibleNavItems = useMemo(
    () => (isMasterAdmin ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.id !== 'settings')),
    [isMasterAdmin]
  );

  useEffect(() => {
    if (activeTab === 'settings' && !isMasterAdmin) {
      setActiveTab('dashboard');
    }
  }, [activeTab, isMasterAdmin]);

  const commandPaletteElement = (
    <CommandPaletteModal
      open={commandPaletteOpen}
      isDark={isDark}
      activeAccountType={activeAccountType}
      isMasterAdmin={isMasterAdmin}
      onClose={() => setCommandPaletteOpen(false)}
      onSelectInstrument={(instrumentId) => {
        if (viewStage === 'landing') {
          setActiveAccountType('DEMO');
        }
        setSelectedInstrumentId(instrumentId);
        setActiveTab('terminal');
        setViewStage('workspace');
      }}
      onNavigateTab={(tab) => {
        if (tab === 'settings' && !isMasterAdmin) return;
        if (viewStage === 'landing') {
          setActiveAccountType('DEMO');
        }
        setActiveTab(tab);
        setViewStage('workspace');
      }}
      onSwitchAccountType={handleSwitchAccountType}
      onEnterDemoAccount={handleEnterDemoAccount}
      onEnterActualAccount={handleEnterActualAccount}
      onToggleTheme={toggleTheme}
    />
  );

  if (viewStage === 'onboarding') {
    return (
      <>
        <AccountOnboardingView
          isSignedIn={Boolean(user)}
          userEmail={user?.email || ''}
          userDisplayName={user?.displayName || ''}
          initialProfile={accountProfile}
          currentBrokerLabel={config.brokerProviderLabel}
          brokerReadiness={brokerReadiness}
          onConnectBrokerAccount={handleConnectBrokerOnboarding}
          onCreateDemoAccount={handleCreateDemoOnboarding}
          onBackToLanding={() => setViewStage('landing')}
          onSignOut={handleSignOut}
        />
        {authModalElement}
      </>
    );
  }

  if (viewStage === 'landing') {
    return (
      <>
        <ClassicLandingPage
          isSignedIn={Boolean(user)}
          userEmail={user?.email || ''}
          activeAccountType={activeAccountType}
          accountProfile={accountProfile}
          brokerProviderLabel={config.brokerProviderLabel}
          exnessConfigured={Boolean(brokerReadiness.EXNESS)}
          authLoading={authLoading}
          authError={authError}
          onDismissAuthError={() => setAuthError(null)}
          onOpenLoginModal={handleOpenLoginModal}
          onSignOut={handleSignOut}
          onStartOnboarding={() => {
            setJustCompletedMode(null);
            setViewStage('onboarding');
          }}
          onEnterActualAccount={handleEnterActualAccount}
          onEnterDemoAccount={handleEnterDemoAccount}
          onEnterTerminal={(instrumentId) => {
            if (instrumentId) {
              setSelectedInstrumentId(instrumentId);
            }
            // Landing chart/ticker previews strictly enter isolated Demo Account — never Real/Live accidentally
            setActiveAccountType('DEMO');
            setActiveTab('terminal');
            setViewStage('workspace');
          }}
          onEnterAutoAnalyzer={() => {
            setActiveAccountType('DEMO');
            setAnalyzerSubTab('auto-analyzer');
            setActiveTab('analyzer');
            setViewStage('workspace');
          }}
          onEnterPineBot={() => {
            setActiveAccountType('DEMO');
            setAnalyzerSubTab('pine-bot');
            setActiveTab('analyzer');
            setViewStage('workspace');
          }}
          justCompletedMode={justCompletedMode}
          onDismissCompletedBanner={() => setJustCompletedMode(null)}
        />
        {authModalElement}
        {commandPaletteElement}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F6FA] dark:bg-[#08101E] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 clean zones separated by gap-8 */}
      <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1424] px-4 lg:px-6 flex items-center justify-between gap-8 sticky top-0 z-40">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            className="lg:hidden p-1.5 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <a
            href="#landing"
            onClick={(e) => {
              e.preventDefault();
              setViewStage('landing');
            }}
            className="font-classic-serif text-lg font-semibold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            My Trade
          </a>
        </div>

        <nav className="hidden lg:flex items-center gap-5 text-xs font-medium text-slate-500 dark:text-slate-400">
          {NAV_ITEMS.filter((i) =>
            ['dashboard', 'terminal', 'analyzer', 'journal', 'account'].includes(i.id)
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === item.id
                  ? 'text-slate-900 dark:text-white border-blue-700 dark:border-sky-400'
                  : 'border-transparent hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleSwitchAccountType(activeAccountType === 'LIVE' ? 'DEMO' : 'LIVE')}
            className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              activeAccountType === 'LIVE'
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/35 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/35 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20'
            }`}
          >
            {activeAccountType === 'LIVE' ? (
              <ShieldCheck className="w-3.5 h-3.5" />
            ) : (
              <Wallet className="w-3.5 h-3.5" />
            )}
            {activeAccountType === 'LIVE' ? 'Actual Account' : 'Demo Account'}
          </button>

          {user ? (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleOpenLoginModal(activeAccountType === 'DEMO' ? 'DEMO' : 'GENERAL')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <LogIn className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              Sign In
            </button>
          )}
        </div>
      </header>

      {authError && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border-b border-rose-200 dark:border-rose-500/35 px-6 py-2 flex items-center justify-between text-xs text-rose-700 dark:text-rose-300">
          <span>{authError}</span>
          <button
            type="button"
            onClick={() => setAuthError(null)}
            className="text-rose-800 dark:text-rose-200 hover:text-slate-900 dark:hover:text-white ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 flex">
        {/* Mobile Sidebar Dimmed Tap-Outside Backdrop */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 top-14 bg-slate-950/50 backdrop-blur-[2px] z-20 lg:hidden"
            aria-hidden="true"
          />
        )}

        {/* Sidebar Navigation (Desktop + Mobile Drawer) */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-14 left-0 z-30 block shadow-2xl overflow-y-auto' : 'hidden'
          } lg:block w-60 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1424] p-4 space-y-5`}
        >
          {/* Isolated Account Switcher: Actual Live vs Demo Practice */}
          <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-xl p-2 space-y-1.5">
            <div className="px-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              <span>Account Workspace</span>
              {user ? (
                <span className="text-emerald-700 dark:text-emerald-400">Verified</span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">Guest</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => handleSwitchAccountType('LIVE')}
                className={`px-2 py-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 border transition-colors ${
                  activeAccountType === 'LIVE'
                    ? 'bg-emerald-50 dark:bg-emerald-600/20 border-emerald-200 dark:border-emerald-500/35 text-emerald-800 dark:text-emerald-200'
                    : 'bg-transparent border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                {user ? <ShieldCheck className="w-3.5 h-3.5" /> : <Lock className="w-3 h-3" />}
                Actual
              </button>
              <button
                type="button"
                onClick={() => handleSwitchAccountType('DEMO')}
                className={`px-2 py-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 border transition-colors ${
                  activeAccountType === 'DEMO'
                    ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/35 text-amber-800 dark:text-amber-200'
                    : 'bg-transparent border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <Wallet className="w-3.5 h-3.5" />
                Demo
              </button>
            </div>
          </div>

          {/* Quick-Jump Command Palette Trigger */}
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setCommandPaletteOpen(true);
            }}
            className="w-full flex items-center justify-between px-3 py-2 text-xs bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 rounded-lg transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-blue-700 dark:text-sky-400" />
              <span>Quick Jump...</span>
            </span>
            <kbd className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
              ⌘K
            </kbd>
          </button>

          <div className="space-y-1">
            {visibleNavItems.map((item) => {
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
                      ? 'bg-blue-50 dark:bg-sky-500/15 text-blue-700 dark:text-sky-300 border border-blue-200 dark:border-sky-500/30'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <button
              type="button"
              onClick={toggleTheme}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <span className="inline-flex items-center gap-2">
                {isDark ? (
                  <Sun className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-blue-700" />
                )}
                {isDark ? 'Daylight Theme' : 'Midnight Theme'}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                {isDark ? 'DARK' : 'LIGHT'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSoundAlertsEnabled((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <span className="inline-flex items-center gap-2">
                {soundAlertsEnabled ? (
                  <Bell className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                ) : (
                  <BellOff className="w-3.5 h-3.5 text-slate-400" />
                )}
                TP / SL Chime
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                {soundAlertsEnabled ? 'ON' : 'OFF'}
              </span>
            </button>
            <PWAInstallButton
              onOpenMobileHub={() => {
                setActiveTab('mobile');
                setMobileMenuOpen(false);
              }}
            />
          </div>
        </aside>

        {/* Main Workspace Content */}
        <main className="flex-1 min-w-0 w-full p-4 pb-20 lg:p-5 lg:pb-6">
          {activeTab === 'dashboard' && (
            <DashboardView
              accountType={activeAccountType}
              config={config}
              brokerLabel={config.brokerProviderLabel}
              brokerConfigured={integrationStatus.brokerConfigured}
              exnessConfigured={Boolean(brokerReadiness.EXNESS)}
              wallet={demoWallet}
              liveBrokerBalance={liveBrokerBalance}
              trades={scopedTrades}
              livePricesBySymbol={livePricesBySymbol}
              economicCalendar={economicCalendar}
              calendarLoading={calendarLoading}
              onRefreshCalendar={refreshEconomicCalendar}
              priceAlerts={priceAlerts}
              onAddPriceAlert={handleAddPriceAlert}
              onDeletePriceAlert={handleDeletePriceAlert}
              onClearTriggeredAlerts={handleClearTriggeredAlerts}
              dailyGuardrailStatus={dailyGuardrailStatus}
              onToggleGuardrailOverride={() => setGuardrailOverride((v) => !v)}
              onOpenInTerminal={(id) => {
                setSelectedInstrumentId(id);
                setActiveTab('terminal');
              }}
              onDepositFunds={async (amt, note) => {
                if (user) {
                  await addDemoWalletFunds(user.uid, demoWallet, amt, note);
                } else {
                  setDemoWallet(addLocalDemoFunds(amt, note));
                }
              }}
              onWithdrawFunds={async (amt, note) => {
                if (user) {
                  await withdrawDemoWalletFunds(user.uid, demoWallet, amt, note);
                } else {
                  setDemoWallet(withdrawLocalDemoFunds(amt, note));
                }
              }}
              onResetWallet={async (newBalance) => {
                if (user) {
                  await resetDemoWallet(user.uid, newBalance);
                } else {
                  setDemoWallet(resetLocalDemoWallet(newBalance));
                }
              }}
              onNavigateJournal={() => setActiveTab('journal')}
              onOpenBrokerModal={() => setBrokerModalOpen(true)}
              onSwitchAccountType={handleSwitchAccountType}
              onExnessBalanceSync={(info) => setLiveBrokerBalance(info)}
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
              openTradesCount={scopedTrades.filter((t) => t.status === 'OPEN').length}
              openTrades={scopedTrades.filter((t) => t.status === 'OPEN')}
              tradeProtectionMap={tradeProtectionMap}
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
              onLivePriceTick={handleLivePriceTick}
              onQuickOrder={handleQuickChartOrder}
              onQuickPriceAlert={handleQuickPriceAlertFromChart}
            />
          )}

          {activeTab === 'analyzer' && (
            <AnalyzerHubView
              activeSubTab={analyzerSubTab}
              onSubTabChange={setAnalyzerSubTab}
              selectedInstrumentId={selectedInstrumentId}
              onSelectInstrumentForTerminal={(id) => {
                setSelectedInstrumentId(id);
                setActiveTab('terminal');
              }}
              activeAccountType={activeAccountType}
              tradeProtectionMap={tradeProtectionMap}
              config={config}
              trades={scopedTrades}
              signals={signals}
              orders={scopedOrders}
              telegramLogs={telegramLogs}
              chatMessages={chatMessages}
              pineStrategies={pineStrategies}
              pineBotLogs={pineBotLogs}
              integrationStatus={integrationStatus}
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
              onSaveSignal={handleSaveSignal}
              onDispatchTelegram={handleDispatchTelegram}
              onLogPaperTrade={handleLogPaperTrade}
              onOpenOrderModal={setOrderModalSignal}
              onUpdateInstrumentSelection={setSelectedInstrumentId}
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
              onClearChatHistory={async () => {
                if (user) {
                  await clearChatHistory(chatMessages);
                } else {
                  setChatMessages(clearLocalChat());
                }
              }}
              onSavePineStrategy={async (item) => {
                if (user) {
                  await createOrUpdatePineStrategy(user.uid, item);
                } else {
                  setPineStrategies(saveLocalPineStrategy(item));
                }
              }}
              onDeletePineStrategy={async (strategyId) => {
                if (user) {
                  await deletePineStrategy(strategyId);
                } else {
                  setPineStrategies(deleteLocalPineStrategy(strategyId));
                }
              }}
              onTogglePineBot={async (strategy) => {
                const toggled = { ...strategy, botEnabled: !strategy.botEnabled };
                if (user) {
                  await createOrUpdatePineStrategy(user.uid, toggled);
                } else {
                  setPineStrategies(saveLocalPineStrategy(toggled));
                }
              }}
              onCheckPineBotNow={evaluatePineBotStrategy}
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
            />
          )}

          {activeTab === 'journal' && (
            <TradeJournalView
              accountType={activeAccountType}
              trades={scopedTrades}
              tradeProtectionMap={tradeProtectionMap}
              wallet={demoWallet}
              liveBrokerBalance={liveBrokerBalance}
              onCreateTrade={async (entry) => {
                const enforcedEntry = {
                  ...entry,
                  executionMode: (activeAccountType === 'LIVE' ? 'LIVE' : 'PAPER') as TradeMode,
                };
                if (user) {
                  await createTradeEntry(user.uid, enforcedEntry);
                } else {
                  setTrades(createLocalTrade(enforcedEntry));
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

          {activeTab === 'settings' && isMasterAdmin && (
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

          {activeTab === 'account' && (
            <AccountSettingsView
              activeAccountType={activeAccountType}
              onSwitchAccountType={handleSwitchAccountType}
              profile={accountProfile}
              onSaveProfile={async (next) => {
                if (user) {
                  await saveAccountSettings(user.uid, next);
                } else {
                  setAccountProfile(saveLocalAccountProfile(next));
                }
              }}
              userEmail={user?.email || ''}
              isSignedIn={Boolean(user)}
              onSignIn={() => handleSignIn('GENERAL')}
              onSignOut={handleSignOut}
              wallet={demoWallet}
              onAddWalletFunds={async (amt, note) => {
                if (user) {
                  await addDemoWalletFunds(user.uid, demoWallet, amt, note);
                } else {
                  setDemoWallet(addLocalDemoFunds(amt, note));
                }
              }}
              onResetWallet={async (amt) => {
                if (user) {
                  await resetDemoWallet(user.uid, amt);
                } else {
                  setDemoWallet(resetLocalDemoWallet(amt));
                }
              }}
              config={config}
              onToggleKillSwitch={async () => {
                const { userId: _u, updatedAt: _t, ...rest } = config;
                const next = { ...rest, killSwitchActive: !config.killSwitchActive };
                if (user) {
                  await saveStrategyConfig(user.uid, next);
                  void authFetch('/api/account/kill-switch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ killSwitchActive: next.killSwitchActive }),
                  }).catch(() => {});
                } else {
                  setConfig(saveLocalConfig(next));
                }
              }}
              onOpenBrokerModal={() => setBrokerModalOpen(true)}
              onSwitchAccountSetup={() => setViewStage('onboarding')}
              trades={scopedTrades}
              pineStrategies={pineStrategies}
            />
          )}

          {activeTab === 'mobile' && <MobilePlayStoreSection />}
        </main>
      </div>

      {orderModalSignal && (
        <OrderExecutionModal
          signal={orderModalSignal}
          config={config}
          activeAccountType={activeAccountType}
          brokerConfigured={integrationStatus.brokerConfigured}
          walletBalance={
            activeAccountType === 'LIVE' ? liveBrokerBalance?.balance : demoWallet.balance
          }
          onClose={() => setOrderModalSignal(null)}
          onOpenBrokerModal={() => {
            setOrderModalSignal(null);
            setBrokerModalOpen(true);
          }}
          onConfirmOrder={handleConfirmOrder}
        />
      )}

      {brokerModalOpen && (
        <BrokerConnectModal
          currentBrokerLabel={config.brokerProviderLabel}
          brokerReadiness={brokerReadiness}
          onClose={() => setBrokerModalOpen(false)}
          onConnectionsUpdated={(nextReadiness) => {
            setBrokerReadiness(nextReadiness);
            const anyLive = Object.entries(nextReadiness).some(
              ([k, v]) => k !== 'PAPER_ENGINE' && Boolean(v)
            );
            setIntegrationStatus((prev) => ({ ...prev, brokerConfigured: anyLive }));
          }}
          onSelectBroker={async (brokerProviderLabel) => {
            const { userId: _u, updatedAt: _t, ...rest } = config;
            const next = { ...rest, brokerProviderLabel: brokerProviderLabel.slice(0, 80) };
            if (user) {
              await saveStrategyConfig(user.uid, next);
            } else {
              setConfig(saveLocalConfig(next));
            }
            pushToast('Trading App Connected', `Active desk bound to ${brokerProviderLabel}`, 'emerald');
          }}
        />
      )}

      {commandPaletteElement}

      {/* Mobile Bottom Navigation Bar (< lg screens) */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-16 bg-white/95 dark:bg-[#0B1424]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 px-1"
      >
        {NAV_ITEMS.filter((i) =>
          ['dashboard', 'terminal', 'analyzer', 'journal', 'account'].includes(i.id)
        ).map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                active
                  ? 'text-blue-700 dark:text-sky-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-[64px]">
                {item.id === 'journal'
                  ? 'Journal'
                  : item.id === 'account'
                    ? 'Account'
                    : item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Workspace Real-Time Toast Stack (3-TP Trailing & Execution Events) */}
      {toasts.length > 0 && (
        <div className="fixed bottom-20 lg:bottom-5 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-80 pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-xl border px-3.5 py-2.5 shadow-xl backdrop-blur-md flex items-start justify-between gap-3 ${
                toast.tone === 'emerald'
                  ? 'bg-white/95 dark:bg-[#0E182A]/95 border-emerald-300 dark:border-emerald-500/40'
                  : toast.tone === 'rose'
                    ? 'bg-white/95 dark:bg-[#0E182A]/95 border-rose-300 dark:border-rose-500/40'
                    : 'bg-white/95 dark:bg-[#0E182A]/95 border-blue-300 dark:border-sky-500/40'
              }`}
            >
              <div className="min-w-0">
                <div
                  className={`text-xs font-semibold ${
                    toast.tone === 'emerald'
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : toast.tone === 'rose'
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-blue-700 dark:text-sky-300'
                  }`}
                >
                  {toast.title}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">
                  {toast.detail}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== toast.id))}
                aria-label="Dismiss notification"
                className="text-slate-400 hover:text-slate-800 dark:hover:text-white shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {authModalElement}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <TerminalWorkspace />
        <OfflineIndicator />
      </ErrorBoundary>
    </ThemeProvider>
  );
}
