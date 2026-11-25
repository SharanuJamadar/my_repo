import {
  DEFAULT_ACCOUNT_PROFILE,
  DEFAULT_DEMO_WALLET,
  DEFAULT_STRATEGY_CONFIG,
  INSTRUMENTS,
  type AccountProfileSettings,
  type ChatMessageRecord,
  type DemoWalletState,
  type ExecutionOrderRecord,
  type GeneratedSignalPayload,
  type PineStrategyRecord,
  type PriceAlertRule,
  type SignalStatus,
  type StoredTradeSignal,
  type StrategyConfig,
  type TelegramLogRecord,
  type TradeJournalEntry,
} from '../types/trading';
import { PINE_STRATEGY_TEMPLATES } from './pineTemplates';

const KEYS = {
  config: 'sharan_strategy_config_v1',
  wallet: 'sharan_demo_wallet_v1',
  signals: 'sharan_signals_v1',
  trades: 'sharan_trades_v1',
  chat: 'sharan_chat_v1',
  telegram: 'sharan_telegram_logs_v1',
  orders: 'sharan_execution_orders_v1',
  account: 'sharan_account_profile_v1',
  pineStrategies: 'sharan_pine_strategies_v1',
  customWatchlist: 'sharan_custom_watchlist_v1',
  priceAlerts: 'sharan_price_alerts_v1',
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadLocalConfig(): StrategyConfig {
  const saved = readJson<Partial<StrategyConfig> | null>(KEYS.config, null);
  const allIds = INSTRUMENTS.map((i) => i.id);
  const savedIds = Array.isArray(saved?.activeInstruments) ? saved.activeInstruments : [];
  // Upgrade legacy 14-market configs to include newly added Indian & International instruments
  const mergedInstruments =
    savedIds.length > 0 && savedIds.length <= 14
      ? Array.from(new Set([...savedIds, ...allIds]))
      : savedIds.length > 0
        ? savedIds
        : allIds;
  const upgradedSaved = saved ? { ...saved } : {};
  if (upgradedSaved.minSetupScore === 70 && upgradedSaved.minRiskReward === 1.8) {
    upgradedSaved.minSetupScore = DEFAULT_STRATEGY_CONFIG.minSetupScore;
    upgradedSaved.minRiskReward = DEFAULT_STRATEGY_CONFIG.minRiskReward;
    upgradedSaved.maxRiskPerTradePct = DEFAULT_STRATEGY_CONFIG.maxRiskPerTradePct;
  }
  return {
    ...DEFAULT_STRATEGY_CONFIG,
    ...upgradedSaved,
    activeInstruments: mergedInstruments,
    userId: 'local-standalone',
  };
}

export function saveLocalConfig(
  next: Omit<StrategyConfig, 'userId' | 'updatedAt'>
): StrategyConfig {
  const merged: StrategyConfig = {
    ...next,
    userId: 'local-standalone',
    updatedAt: new Date().toISOString(),
  };
  writeJson(KEYS.config, merged);
  return merged;
}

export function loadLocalSignals(): StoredTradeSignal[] {
  return readJson<StoredTradeSignal[]>(KEYS.signals, []);
}

export function createLocalSignal(
  signal: GeneratedSignalPayload,
  sourceType: 'LIVE_MARKET' | 'CHART_UPLOAD' | 'CHATBOT',
  telegramPublished = false
): StoredTradeSignal[] {
  const existing = loadLocalSignals();
  const now = new Date().toISOString();
  const record: StoredTradeSignal = {
    id: makeId('sig'),
    userId: 'local-standalone',
    instrument: signal.instrument,
    marketSegment: signal.marketSegment,
    contract: signal.contract,
    direction: signal.direction,
    entryTrigger: signal.entryTrigger,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    target1: signal.target1,
    target2: signal.target2,
    target3: signal.target3,
    riskReward: signal.riskReward,
    entryTimeframe: signal.entryTimeframe,
    trendTimeframe: signal.trendTimeframe,
    horizon: signal.horizon,
    invalidationLevel: signal.invalidationLevel,
    confirmationText: signal.confirmationText,
    status: signal.status,
    qualityScore: signal.qualityScore,
    checklistSummary: signal.checklist.map(
      (c) => `${c.passed ? 'PASS' : 'FAIL'}: ${c.label}`
    ),
    reasonsFor: signal.reasonsFor,
    reasonsAgainst: signal.reasonsAgainst,
    sourceType,
    telegramPublished,
    createdAt: now,
    updatedAt: now,
  };
  const updated = [record, ...existing].slice(0, 100);
  writeJson(KEYS.signals, updated);
  return updated;
}

export function updateLocalSignalStatus(
  signalId: string,
  status: SignalStatus
): StoredTradeSignal[] {
  const now = new Date().toISOString();
  const updated = loadLocalSignals().map((s) =>
    s.id === signalId ? { ...s, status, updatedAt: now } : s
  );
  writeJson(KEYS.signals, updated);
  return updated;
}

export function markLocalSignalTelegramPublished(signalId: string): StoredTradeSignal[] {
  const now = new Date().toISOString();
  const updated = loadLocalSignals().map((s) =>
    s.id === signalId ? { ...s, telegramPublished: true, updatedAt: now } : s
  );
  writeJson(KEYS.signals, updated);
  return updated;
}

export function loadLocalTrades(): TradeJournalEntry[] {
  return readJson<TradeJournalEntry[]>(KEYS.trades, []);
}

export function createLocalTrade(
  entry: Omit<TradeJournalEntry, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): TradeJournalEntry[] {
  const now = new Date().toISOString();
  const record: TradeJournalEntry = {
    ...entry,
    id: makeId('trd'),
    userId: 'local-standalone',
    strategyConfirmation: entry.strategyConfirmation || 'My Trade setup',
    createdAt: now,
    updatedAt: now,
  };
  const updated = [record, ...loadLocalTrades()].slice(0, 200);
  writeJson(KEYS.trades, updated);
  return updated;
}

export function closeLocalTrade(
  tradeId: string,
  params: {
    exitPrice: number;
    pnl: number;
    result: 'WIN' | 'LOSS' | 'BREAKEVEN';
    screenshotNote?: string;
    remainingQuantity?: number;
    partialRealizedPnl?: number;
    auditTrail?: string[];
  }
): TradeJournalEntry[] {
  const now = new Date().toISOString();
  const updated: TradeJournalEntry[] = loadLocalTrades().map((t) =>
    t.id === tradeId
      ? {
          ...t,
          exitPrice: params.exitPrice,
          result: params.result,
          pnl: params.pnl,
          status: 'CLOSED' as const,
          ...(params.remainingQuantity !== undefined ? { remainingQuantity: params.remainingQuantity } : {}),
          ...(params.partialRealizedPnl !== undefined ? { partialRealizedPnl: params.partialRealizedPnl } : {}),
          ...(params.screenshotNote ? { screenshotNote: params.screenshotNote } : {}),
          ...(params.auditTrail ? { auditTrail: params.auditTrail.slice(0, 20) } : {}),
          updatedAt: now,
        }
      : t
  );
  writeJson(KEYS.trades, updated);
  return updated;
}

export function updateLocalTradeTrailingStop(
  tradeId: string,
  params: {
    stopLoss: number;
    tpStage: 0 | 1 | 2;
    remainingQuantity?: number;
    partialRealizedPnl?: number;
    auditTrail?: string[];
  }
): TradeJournalEntry[] {
  const now = new Date().toISOString();
  const updated: TradeJournalEntry[] = loadLocalTrades().map((t) =>
    t.id === tradeId && t.status === 'OPEN'
      ? {
          ...t,
          stopLoss: params.stopLoss,
          tpStage: params.tpStage,
          ...(params.remainingQuantity !== undefined ? { remainingQuantity: params.remainingQuantity } : {}),
          ...(params.partialRealizedPnl !== undefined ? { partialRealizedPnl: params.partialRealizedPnl } : {}),
          ...(params.auditTrail ? { auditTrail: params.auditTrail.slice(0, 20) } : {}),
          updatedAt: now,
        }
      : t
  );
  writeJson(KEYS.trades, updated);
  return updated;
}

export function deleteLocalTrade(tradeId: string): TradeJournalEntry[] {
  const updated = loadLocalTrades().filter((t) => t.id !== tradeId);
  writeJson(KEYS.trades, updated);
  return updated;
}

export function loadLocalChat(): ChatMessageRecord[] {
  return readJson<ChatMessageRecord[]>(KEYS.chat, []);
}

export function addLocalChatMessage(
  role: 'user' | 'assistant',
  content: string,
  instrumentContext?: string
): ChatMessageRecord[] {
  const record: ChatMessageRecord = {
    id: makeId('msg'),
    userId: 'local-standalone',
    role,
    content,
    instrumentContext,
    createdAt: new Date().toISOString(),
  };
  const updated = [...loadLocalChat(), record].slice(-120);
  writeJson(KEYS.chat, updated);
  return updated;
}

export function clearLocalChat(): ChatMessageRecord[] {
  writeJson(KEYS.chat, []);
  return [];
}

export function loadLocalTelegramLogs(): TelegramLogRecord[] {
  return readJson<TelegramLogRecord[]>(KEYS.telegram, []);
}

export function createLocalTelegramLog(
  log: Omit<TelegramLogRecord, 'id' | 'userId' | 'createdAt'>
): TelegramLogRecord[] {
  const record: TelegramLogRecord = {
    ...log,
    id: makeId('tg'),
    userId: 'local-standalone',
    createdAt: new Date().toISOString(),
  };
  const updated = [record, ...loadLocalTelegramLogs()].slice(0, 100);
  writeJson(KEYS.telegram, updated);
  return updated;
}

export function loadLocalOrders(): ExecutionOrderRecord[] {
  return readJson<ExecutionOrderRecord[]>(KEYS.orders, []);
}

export function createLocalOrder(
  order: Omit<ExecutionOrderRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): ExecutionOrderRecord[] {
  const now = new Date().toISOString();
  const record: ExecutionOrderRecord = {
    ...order,
    id: makeId('ord'),
    userId: 'local-standalone',
    createdAt: now,
    updatedAt: now,
  };
  const updated = [record, ...loadLocalOrders()].slice(0, 100);
  writeJson(KEYS.orders, updated);
  return updated;
}

export function loadLocalWallet(): DemoWalletState {
  const saved = readJson<Partial<DemoWalletState> | null>(KEYS.wallet, null);
  return {
    userId: 'local-standalone',
    balance:
      typeof saved?.balance === 'number' && Number.isFinite(saved.balance) && saved.balance >= 0
        ? saved.balance
        : DEFAULT_DEMO_WALLET.balance,
    totalAdded:
      typeof saved?.totalAdded === 'number' &&
      Number.isFinite(saved.totalAdded) &&
      saved.totalAdded >= 0
        ? saved.totalAdded
        : DEFAULT_DEMO_WALLET.totalAdded,
    recentDeposits: Array.isArray(saved?.recentDeposits)
      ? saved.recentDeposits.slice(0, 20)
      : DEFAULT_DEMO_WALLET.recentDeposits,
    updatedAt: saved?.updatedAt,
  };
}

export function addLocalDemoFunds(amount: number, note?: string): DemoWalletState {
  const safeAmount = Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : 0;
  const current = loadLocalWallet();
  if (safeAmount <= 0) return current;
  const entry = `${new Date().toLocaleString()} | +${safeAmount.toLocaleString()} | ${
    (note || 'Deposit').trim().slice(0, 40)
  }`;
  const next: DemoWalletState = {
    userId: 'local-standalone',
    balance: Number((current.balance + safeAmount).toFixed(2)),
    totalAdded: Number((current.totalAdded + safeAmount).toFixed(2)),
    recentDeposits: [entry, ...current.recentDeposits].slice(0, 20),
    updatedAt: new Date().toISOString(),
  };
  writeJson(KEYS.wallet, next);
  return next;
}

export function withdrawLocalDemoFunds(amount: number, note?: string): DemoWalletState {
  const safeAmount = Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : 0;
  const current = loadLocalWallet();
  if (safeAmount <= 0) {
    throw new Error('Enter a valid withdrawal amount greater than 0.');
  }
  if (safeAmount > current.balance) {
    throw new Error(
      `Insufficient wallet balance. Available: ${current.balance.toLocaleString()}`
    );
  }
  const entry = `${new Date().toLocaleString()} | -${safeAmount.toLocaleString()} | ${
    (note || 'Withdrawal').trim().slice(0, 40)
  }`;
  const next: DemoWalletState = {
    userId: 'local-standalone',
    balance: Number(Math.max(0, current.balance - safeAmount).toFixed(2)),
    totalAdded: current.totalAdded,
    recentDeposits: [entry, ...current.recentDeposits].slice(0, 20),
    updatedAt: new Date().toISOString(),
  };
  writeJson(KEYS.wallet, next);
  return next;
}

export function resetLocalDemoWallet(newBalance = DEFAULT_DEMO_WALLET.balance): DemoWalletState {
  const safeBal =
    Number.isFinite(newBalance) && newBalance >= 0 ? Number(newBalance.toFixed(2)) : 0;
  const entry = `${new Date().toLocaleString()} | Reset to ${safeBal.toLocaleString()}`;
  const next: DemoWalletState = {
    userId: 'local-standalone',
    balance: safeBal,
    totalAdded: safeBal,
    recentDeposits: [entry],
    updatedAt: new Date().toISOString(),
  };
  writeJson(KEYS.wallet, next);
  return next;
}

export function loadLocalAccountProfile(): AccountProfileSettings {
  const saved = readJson<Partial<AccountProfileSettings> | null>(KEYS.account, null);
  return {
    ...DEFAULT_ACCOUNT_PROFILE,
    ...(saved || {}),
  };
}

export function saveLocalAccountProfile(next: AccountProfileSettings): AccountProfileSettings {
  const clean: AccountProfileSettings = {
    displayName: next.displayName.trim().slice(0, 100) || DEFAULT_ACCOUNT_PROFILE.displayName,
    email: (next.email || '').trim().slice(0, 200),
    mobileNumber: (next.mobileNumber || '').trim().slice(0, 24),
    accountMode: next.accountMode || 'UNDECIDED',
    onboardingCompleted: Boolean(next.onboardingCompleted),
    riskProfile: next.riskProfile,
    defaultInstrumentId: next.defaultInstrumentId || 'XAUUSD',
    defaultTimeframe: next.defaultTimeframe,
    dailyLossLimit: Math.max(0, Number(next.dailyLossLimit) || 0),
    telegramChatId: next.telegramChatId.trim().slice(0, 64),
    tradeAlertsEnabled: Boolean(next.tradeAlertsEnabled),
  };
  writeJson(KEYS.account, clean);
  return clean;
}

export function loadLocalPineStrategies(): PineStrategyRecord[] {
  const saved = readJson<PineStrategyRecord[] | null>(KEYS.pineStrategies, null);
  const now = new Date().toISOString();
  const buildSeeded = (): PineStrategyRecord[] =>
    PINE_STRATEGY_TEMPLATES.map((tpl, idx) => ({
      id: `pine-tpl-${idx + 1}`,
      userId: 'local-standalone',
      name: tpl.name,
      description: tpl.description,
      instrumentId: tpl.instrumentId,
      timeframe: tpl.timeframe,
      pineCode: tpl.pineCode,
      quantity: tpl.quantity,
      initialCapital: tpl.initialCapital ?? 100_000,
      stopLossPct: tpl.stopLossPct,
      takeProfitPct: tpl.takeProfitPct,
      riskPerTradePct: tpl.riskPerTradePct,
      trailingStop: tpl.trailingStop,
      executionMode: 'PAPER',
      botEnabled: false,
      autoExecute: true,
      createdAt: now,
      updatedAt: now,
    }));

  if (saved && Array.isArray(saved) && saved.length > 0) {
    const legacyNames = new Set([
      'My Trade EMA 9/20 Crossover + VWAP + RSI',
      'SHARAN EMA 9/20 Crossover + VWAP + RSI',
      'Crude Oil / Gold EMA 9 Price Breakout',
      'Crypto / Index MACD + EMA 50 Trend Bot',
    ]);
    let changed = false;
    const upgraded = saved.map((s) => {
      const tplMatch = s.id.match(/^pine-tpl-(\d+)$/);
      if (tplMatch && legacyNames.has(s.name)) {
        const idx = Number(tplMatch[1]) - 1;
        const tpl = PINE_STRATEGY_TEMPLATES[idx];
        if (tpl) {
          changed = true;
          return {
            ...s,
            name: tpl.name,
            description: tpl.description,
            instrumentId: tpl.instrumentId,
            timeframe: tpl.timeframe,
            pineCode: tpl.pineCode,
            quantity: tpl.quantity,
            initialCapital: tpl.initialCapital ?? s.initialCapital ?? 100_000,
            stopLossPct: tpl.stopLossPct,
            takeProfitPct: tpl.takeProfitPct,
            riskPerTradePct: tpl.riskPerTradePct,
            trailingStop: tpl.trailingStop,
            updatedAt: now,
          };
        }
      }
      return s;
    });

    // Auto-append any newly added built-in templates (e.g., MR_X EMA 9-15-200 Reversal)
    const seededAll = buildSeeded();
    for (const candidate of seededAll) {
      const alreadyExists = upgraded.some(
        (existing) => existing.id === candidate.id || existing.name === candidate.name
      );
      if (!alreadyExists) {
        upgraded.push(candidate);
        changed = true;
      }
    }

    if (changed) {
      writeJson(KEYS.pineStrategies, upgraded);
    }
    return upgraded;
  }

  const seeded = buildSeeded();
  writeJson(KEYS.pineStrategies, seeded);
  return seeded;
}

export function saveLocalPineStrategy(
  item: Omit<PineStrategyRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }
): PineStrategyRecord[] {
  const existing = loadLocalPineStrategies();
  const now = new Date().toISOString();
  if (item.id && existing.some((x) => x.id === item.id)) {
    const updated = existing.map((x) =>
      x.id === item.id ? { ...x, ...item, updatedAt: now } : x
    );
    writeJson(KEYS.pineStrategies, updated);
    return updated;
  }
  const record: PineStrategyRecord = {
    ...item,
    id: makeId('pine'),
    userId: 'local-standalone',
    createdAt: now,
    updatedAt: now,
  };
  const updated = [record, ...existing].slice(0, 50);
  writeJson(KEYS.pineStrategies, updated);
  return updated;
}

export function deleteLocalPineStrategy(strategyId: string): PineStrategyRecord[] {
  const updated = loadLocalPineStrategies().filter((x) => x.id !== strategyId);
  writeJson(KEYS.pineStrategies, updated);
  return updated;
}

export function loadLocalCustomWatchlist(): string[] {
  const saved = readJson<unknown>(KEYS.customWatchlist, []);
  if (!Array.isArray(saved)) return [];
  const validIds = new Set(INSTRUMENTS.map((i) => i.id));
  const out: string[] = [];
  for (const id of saved) {
    if (typeof id === 'string' && validIds.has(id) && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

export function saveLocalCustomWatchlist(ids: string[]): string[] {
  const validIds = new Set(INSTRUMENTS.map((i) => i.id));
  const clean: string[] = [];
  for (const id of ids) {
    if (validIds.has(id) && !clean.includes(id)) {
      clean.push(id);
    }
  }
  writeJson(KEYS.customWatchlist, clean);
  return clean;
}

export function loadLocalPriceAlerts(): PriceAlertRule[] {
  const saved = readJson<unknown>(KEYS.priceAlerts, []);
  if (!Array.isArray(saved)) return [];
  return saved.filter(
    (a): a is PriceAlertRule =>
      Boolean(a && typeof a === 'object' && typeof (a as PriceAlertRule).id === 'string' && Number.isFinite(Number((a as PriceAlertRule).targetPrice)))
  ).slice(0, 50);
}

export function saveLocalPriceAlerts(alerts: PriceAlertRule[]): PriceAlertRule[] {
  const clean = alerts.slice(0, 50);
  writeJson(KEYS.priceAlerts, clean);
  return clean;
}



