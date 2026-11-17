import {
  DEFAULT_DEMO_WALLET,
  DEFAULT_STRATEGY_CONFIG,
  type ChatMessageRecord,
  type DemoWalletState,
  type ExecutionOrderRecord,
  type GeneratedSignalPayload,
  type SignalStatus,
  type StoredTradeSignal,
  type StrategyConfig,
  type TelegramLogRecord,
  type TradeJournalEntry,
} from '../types/trading';

const KEYS = {
  config: 'sharan_strategy_config_v1',
  wallet: 'sharan_demo_wallet_v1',
  signals: 'sharan_signals_v1',
  trades: 'sharan_trades_v1',
  chat: 'sharan_chat_v1',
  telegram: 'sharan_telegram_logs_v1',
  orders: 'sharan_execution_orders_v1',
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
  return {
    ...DEFAULT_STRATEGY_CONFIG,
    ...(saved || {}),
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
    strategyConfirmation: entry.strategyConfirmation || 'SHARAN setup',
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
          ...(params.screenshotNote ? { screenshotNote: params.screenshotNote } : {}),
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
    (note || 'Demo Top-Up').trim().slice(0, 40)
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
