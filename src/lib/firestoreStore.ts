import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
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
  type SignalStatus,
  type StoredTradeSignal,
  type StrategyConfig,
  type TelegramLogRecord,
  type TradeJournalEntry,
} from '../types/trading';
import { db, handleFirestoreError, OperationType } from './firebase';

function toMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const parsed = Date.parse(String(ts));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function clampString(val: string | undefined, max: number): string {
  return (val ?? '').trim().slice(0, max);
}

export async function ensureUserProfileAndConfig(user: User): Promise<void> {
  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: clampString(user.displayName || user.email?.split('@')[0] || 'Trader', 100),
        email: clampString(user.email || '', 200),
        photoURL: clampString(user.photoURL || '', 500),
        role: user.email === 'sharanu12131415@gmail.com' ? 'admin' : 'trader',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
  }

  const configRef = doc(db, 'strategyConfigs', user.uid);
  try {
    const cfgSnap = await getDoc(configRef);
    if (!cfgSnap.exists()) {
      await setDoc(configRef, {
        ...DEFAULT_STRATEGY_CONFIG,
        userId: user.uid,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `strategyConfigs/${user.uid}`);
  }

  const walletRef = doc(db, 'demoWallets', user.uid);
  try {
    const walletSnap = await getDoc(walletRef);
    if (!walletSnap.exists()) {
      await setDoc(walletRef, {
        ...DEFAULT_DEMO_WALLET,
        userId: user.uid,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `demoWallets/${user.uid}`);
  }
}

export function subscribeStrategyConfig(
  userId: string,
  onData: (config: StrategyConfig) => void
): Unsubscribe {
  const ref = doc(db, 'strategyConfigs', userId);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        const raw = snap.data() as StrategyConfig;
        const allIds = INSTRUMENTS.map((i) => i.id);
        const savedIds = Array.isArray(raw.activeInstruments) ? raw.activeInstruments : [];
        const mergedInstruments =
          savedIds.length > 0 && savedIds.length <= 14
            ? Array.from(new Set([...savedIds, ...allIds]))
            : savedIds.length > 0
              ? savedIds
              : allIds;
        onData({
          ...(DEFAULT_STRATEGY_CONFIG as StrategyConfig),
          ...raw,
          activeInstruments: mergedInstruments,
          userId,
        });
      } else {
        onData({ ...DEFAULT_STRATEGY_CONFIG, userId });
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, `strategyConfigs/${userId}`)
  );
}

export async function saveStrategyConfig(
  userId: string,
  config: Omit<StrategyConfig, 'userId' | 'updatedAt'>
): Promise<void> {
  const ref = doc(db, 'strategyConfigs', userId);
  try {
    await setDoc(
      ref,
      {
        userId,
        emaFast: Math.max(2, Math.min(50, Math.round(config.emaFast))),
        emaMid: Math.max(5, Math.min(100, Math.round(config.emaMid))),
        emaSlow: Math.max(20, Math.min(200, Math.round(config.emaSlow))),
        rsiPeriod: Math.max(5, Math.min(30, Math.round(config.rsiPeriod))),
        rsiBullishMin: Math.max(30, Math.min(80, Number(config.rsiBullishMin))),
        rsiBearishMax: Math.max(20, Math.min(70, Number(config.rsiBearishMax))),
        trendTimeframe: config.trendTimeframe,
        entryTimeframe: config.entryTimeframe,
        minSetupScore: Math.max(40, Math.min(95, Math.round(config.minSetupScore))),
        minRiskReward: Math.max(1, Math.min(10, Number(config.minRiskReward))),
        maxRiskPerTradePct: Math.max(0.25, Math.min(10, Number(config.maxRiskPerTradePct))),
        prioritizeAtmOptions: Boolean(config.prioritizeAtmOptions),
        comexCrudeEma9Priority: Boolean(config.comexCrudeEma9Priority),
        paperTradingOnly: Boolean(config.paperTradingOnly),
        autoBroadcastTelegram: Boolean(config.autoBroadcastTelegram),
        telegramChannelLabel: clampString(config.telegramChannelLabel, 100),
        dataProviderLabel: clampString(config.dataProviderLabel, 80),
        brokerProviderLabel: clampString(config.brokerProviderLabel, 80),
        killSwitchActive: Boolean(config.killSwitchActive),
        activeInstruments: (config.activeInstruments || []).slice(0, 50),
        updatedAt: serverTimestamp(),
      },
      { merge: false }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `strategyConfigs/${userId}`);
  }
}

export function subscribeSignals(
  userId: string,
  onData: (signals: StoredTradeSignal[]) => void
): Unsubscribe {
  const q = query(collection(db, 'signals'), where('userId', '==', userId), limit(120));
  return onSnapshot(
    q,
    (snap) => {
      const items: StoredTradeSignal[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StoredTradeSignal, 'id'>),
      }));
      items.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'signals')
  );
}

export async function createStoredSignal(
  userId: string,
  signal: GeneratedSignalPayload,
  sourceType: 'LIVE_MARKET' | 'CHART_UPLOAD' | 'CHATBOT',
  telegramPublished = false
): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, 'signals'), {
      userId,
      instrument: clampString(signal.instrument, 40) || 'NIFTY 50',
      marketSegment: signal.marketSegment,
      contract: clampString(signal.contract, 80) || signal.instrument,
      direction: signal.direction,
      entryTrigger: clampString(signal.entryTrigger, 60),
      entryPrice: Number(signal.entryPrice) || 0,
      stopLoss: Number(signal.stopLoss) || 0,
      target1: Number(signal.target1) || 0,
      target2: Number(signal.target2) || 0,
      ...(signal.target3 ? { target3: Number(signal.target3) } : {}),
      riskReward: clampString(signal.riskReward, 20) || 'N/A',
      entryTimeframe: clampString(signal.entryTimeframe, 20) || '5 MIN',
      trendTimeframe: clampString(signal.trendTimeframe, 20) || '15 MIN',
      horizon: clampString(signal.horizon, 30) || 'INTRADAY',
      invalidationLevel: Number(signal.invalidationLevel) || 0,
      confirmationText: clampString(signal.confirmationText, 500) || 'Strategy evaluation recorded.',
      status: signal.status,
      qualityScore: Math.max(0, Math.min(100, Math.round(signal.qualityScore))),
      checklistSummary: signal.checklist.slice(0, 12).map((c) => clampString(`${c.passed ? 'PASS' : 'FAIL'}: ${c.label}`, 120)),
      reasonsFor: signal.reasonsFor.slice(0, 10).map((r) => clampString(r, 200)),
      reasonsAgainst: signal.reasonsAgainst.slice(0, 10).map((r) => clampString(r, 200)),
      sourceType,
      telegramPublished,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'signals');
  }
}

export async function updateStoredSignalStatus(
  signalId: string,
  status: SignalStatus,
  telegramPublished?: boolean
): Promise<void> {
  const ref = doc(db, 'signals', signalId);
  try {
    const payload: Record<string, unknown> = {
      status,
      updatedAt: serverTimestamp(),
    };
    if (typeof telegramPublished === 'boolean') {
      payload.telegramPublished = telegramPublished;
    }
    await updateDoc(ref, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `signals/${signalId}`);
  }
}

export async function markSignalTelegramPublished(signalId: string): Promise<void> {
  const ref = doc(db, 'signals', signalId);
  try {
    await updateDoc(ref, {
      telegramPublished: true,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `signals/${signalId}`);
  }
}

export async function deleteStoredSignal(signalId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'signals', signalId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `signals/${signalId}`);
  }
}

export function subscribeTrades(
  userId: string,
  onData: (trades: TradeJournalEntry[]) => void
): Unsubscribe {
  const q = query(collection(db, 'trades'), where('userId', '==', userId), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const items: TradeJournalEntry[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<TradeJournalEntry, 'id'>),
      }));
      items.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'trades')
  );
}

export async function createTradeEntry(
  userId: string,
  entry: Omit<TradeJournalEntry, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, 'trades'), {
      userId,
      ...(entry.signalId ? { signalId: clampString(entry.signalId, 128) } : {}),
      instrument: clampString(entry.instrument, 40),
      contract: clampString(entry.contract, 80),
      direction: entry.direction,
      executionMode: entry.executionMode,
      entryPrice: Number(entry.entryPrice),
      stopLoss: Number(entry.stopLoss),
      target1: Number(entry.target1),
      ...(entry.target2 !== undefined ? { target2: Number(entry.target2) } : {}),
      ...(entry.target3 !== undefined ? { target3: Number(entry.target3) } : {}),
      ...(entry.exitPrice !== undefined ? { exitPrice: Number(entry.exitPrice) } : {}),
      quantity: Number(entry.quantity),
      status: entry.status,
      result: entry.result,
      pnl: Number(entry.pnl),
      riskReward: clampString(entry.riskReward, 20),
      strategyConfirmation: clampString(entry.strategyConfirmation, 500) || 'SHARAN setup',
      ...(entry.screenshotNote ? { screenshotNote: clampString(entry.screenshotNote, 300) } : {}),
      ...(entry.brokerOrderId ? { brokerOrderId: clampString(entry.brokerOrderId, 80) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'trades');
  }
}

export async function closeTradeEntry(
  tradeId: string,
  params: {
    exitPrice: number;
    pnl: number;
    result: 'WIN' | 'LOSS' | 'BREAKEVEN';
    screenshotNote?: string;
  }
): Promise<void> {
  const ref = doc(db, 'trades', tradeId);
  try {
    await updateDoc(ref, {
      exitPrice: Number(params.exitPrice),
      status: 'CLOSED',
      result: params.result,
      pnl: Number(params.pnl),
      ...(params.screenshotNote ? { screenshotNote: clampString(params.screenshotNote, 300) } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `trades/${tradeId}`);
  }
}

export async function deleteTradeEntry(tradeId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'trades', tradeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `trades/${tradeId}`);
  }
}

export function subscribeChatMessages(
  userId: string,
  onData: (messages: ChatMessageRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, 'chatMessages'), where('userId', '==', userId), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items: ChatMessageRecord[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ChatMessageRecord, 'id'>),
      }));
      items.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'chatMessages')
  );
}

export async function addChatMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  instrumentContext?: string
): Promise<void> {
  try {
    await addDoc(collection(db, 'chatMessages'), {
      userId,
      role,
      content: clampString(content, 8000),
      ...(instrumentContext ? { instrumentContext: clampString(instrumentContext, 40) } : {}),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'chatMessages');
  }
}

export async function clearChatHistory(messages: ChatMessageRecord[]): Promise<void> {
  for (const m of messages) {
    try {
      await deleteDoc(doc(db, 'chatMessages', m.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chatMessages/${m.id}`);
    }
  }
}

export function subscribeTelegramLogs(
  userId: string,
  onData: (logs: TelegramLogRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, 'telegramLogs'), where('userId', '==', userId), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items: TelegramLogRecord[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<TelegramLogRecord, 'id'>),
      }));
      items.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'telegramLogs')
  );
}

export async function createTelegramLog(
  userId: string,
  log: Omit<TelegramLogRecord, 'id' | 'userId' | 'createdAt'>
): Promise<void> {
  try {
    await addDoc(collection(db, 'telegramLogs'), {
      userId,
      ...(log.signalId ? { signalId: clampString(log.signalId, 128) } : {}),
      instrument: clampString(log.instrument, 40),
      eventType: log.eventType,
      messageText: clampString(log.messageText, 4096),
      deliveryStatus: log.deliveryStatus,
      ...(log.statusDetail ? { statusDetail: clampString(log.statusDetail, 300) } : {}),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'telegramLogs');
  }
}

export function subscribeExecutionOrders(
  userId: string,
  onData: (orders: ExecutionOrderRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, 'executionOrders'), where('userId', '==', userId), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items: ExecutionOrderRecord[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ExecutionOrderRecord, 'id'>),
      }));
      items.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'executionOrders')
  );
}

export async function createExecutionOrder(
  userId: string,
  order: Omit<ExecutionOrderRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, 'executionOrders'), {
      userId,
      signalId: clampString(order.signalId, 128),
      instrument: clampString(order.instrument, 40),
      contract: clampString(order.contract, 80),
      ...(order.expiry ? { expiry: clampString(order.expiry, 40) } : {}),
      quantity: Number(order.quantity),
      orderType: order.orderType,
      side: order.side,
      entryPrice: Number(order.entryPrice),
      stopLoss: Number(order.stopLoss),
      targetPrice: Number(order.targetPrice),
      executionMode: order.executionMode,
      brokerName: clampString(order.brokerName, 60),
      ...(order.brokerOrderId ? { brokerOrderId: clampString(order.brokerOrderId, 80) } : {}),
      status: order.status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'executionOrders');
  }
}

export function subscribeDemoWallet(
  userId: string,
  onData: (wallet: DemoWalletState) => void
): Unsubscribe {
  const ref = doc(db, 'demoWallets', userId);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as DemoWalletState;
        onData({
          userId,
          balance: Number(data.balance ?? DEFAULT_DEMO_WALLET.balance),
          totalAdded: Number(data.totalAdded ?? DEFAULT_DEMO_WALLET.totalAdded),
          recentDeposits: Array.isArray(data.recentDeposits) ? data.recentDeposits : [],
          updatedAt: data.updatedAt,
        });
      } else {
        onData({ ...DEFAULT_DEMO_WALLET, userId });
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, `demoWallets/${userId}`)
  );
}

export async function addDemoWalletFunds(
  userId: string,
  current: DemoWalletState,
  amount: number,
  note?: string
): Promise<void> {
  const safeAmount = Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : 0;
  if (safeAmount <= 0) return;
  const entry = clampString(
    `${new Date().toLocaleString()} | +${safeAmount.toLocaleString()} | ${(note || 'Deposit').trim()}`,
    120
  );
  const ref = doc(db, 'demoWallets', userId);
  try {
    await setDoc(ref, {
      userId,
      balance: Number((current.balance + safeAmount).toFixed(2)),
      totalAdded: Number((current.totalAdded + safeAmount).toFixed(2)),
      recentDeposits: [entry, ...(current.recentDeposits || [])].slice(0, 20),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `demoWallets/${userId}`);
  }
}

export async function withdrawDemoWalletFunds(
  userId: string,
  current: DemoWalletState,
  amount: number,
  note?: string
): Promise<void> {
  const safeAmount = Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : 0;
  if (safeAmount <= 0) {
    throw new Error('Enter a valid withdrawal amount greater than 0.');
  }
  if (safeAmount > current.balance) {
    throw new Error(
      `Insufficient wallet balance. Available: ${current.balance.toLocaleString()}`
    );
  }
  const entry = clampString(
    `${new Date().toLocaleString()} | -${safeAmount.toLocaleString()} | ${(note || 'Withdrawal').trim()}`,
    120
  );
  const ref = doc(db, 'demoWallets', userId);
  try {
    await setDoc(ref, {
      userId,
      balance: Number(Math.max(0, current.balance - safeAmount).toFixed(2)),
      totalAdded: current.totalAdded,
      recentDeposits: [entry, ...(current.recentDeposits || [])].slice(0, 20),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `demoWallets/${userId}`);
  }
}

export async function resetDemoWallet(
  userId: string,
  newBalance = DEFAULT_DEMO_WALLET.balance
): Promise<void> {
  const safeBal =
    Number.isFinite(newBalance) && newBalance >= 0 ? Number(newBalance.toFixed(2)) : 0;
  const entry = clampString(
    `${new Date().toLocaleString()} | Reset to ${safeBal.toLocaleString()}`,
    120
  );
  const ref = doc(db, 'demoWallets', userId);
  try {
    await setDoc(ref, {
      userId,
      balance: safeBal,
      totalAdded: safeBal,
      recentDeposits: [entry],
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `demoWallets/${userId}`);
  }
}

export function subscribeAccountSettings(
  userId: string,
  onData: (settings: AccountProfileSettings, existsInDb?: boolean) => void
): Unsubscribe {
  const ref = doc(db, 'accountSettings', userId);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        const d = snap.data() as Partial<AccountProfileSettings>;
        onData(
          {
            ...DEFAULT_ACCOUNT_PROFILE,
            ...d,
          },
          true
        );
      } else {
        onData({ ...DEFAULT_ACCOUNT_PROFILE }, false);
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, `accountSettings/${userId}`)
  );
}

export async function saveAccountSettings(
  userId: string,
  settings: AccountProfileSettings
): Promise<void> {
  const ref = doc(db, 'accountSettings', userId);
  try {
    await setDoc(ref, {
      userId,
      displayName: clampString(settings.displayName, 100) || 'Sharan Trader',
      email: clampString(settings.email || '', 200),
      mobileNumber: clampString(settings.mobileNumber || '', 24),
      accountMode: settings.accountMode || 'UNDECIDED',
      onboardingCompleted: Boolean(settings.onboardingCompleted),
      riskProfile: settings.riskProfile,
      defaultInstrumentId: clampString(settings.defaultInstrumentId, 40) || 'XAUUSD',
      defaultTimeframe: settings.defaultTimeframe,
      dailyLossLimit: Math.max(0, Number(settings.dailyLossLimit) || 0),
      telegramChatId: clampString(settings.telegramChatId, 64),
      tradeAlertsEnabled: Boolean(settings.tradeAlertsEnabled),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `accountSettings/${userId}`);
  }
}

export function subscribePineStrategies(
  userId: string,
  onData: (items: PineStrategyRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, 'pineStrategies'), where('userId', '==', userId), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const items: PineStrategyRecord[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<PineStrategyRecord, 'id'>),
      }));
      items.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'pineStrategies')
  );
}

export async function createOrUpdatePineStrategy(
  userId: string,
  strategy: Omit<PineStrategyRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    createdAt?: any;
  }
): Promise<string> {
  try {
    const cleanPayload = {
      userId,
      name: clampString(strategy.name, 120) || 'Custom Pine Strategy',
      description: clampString(strategy.description, 400),
      instrumentId: clampString(strategy.instrumentId, 40) || 'XAUUSD',
      timeframe: strategy.timeframe,
      pineCode: (strategy.pineCode || '').slice(0, 30_000),
      quantity: Math.max(0.01, Number(strategy.quantity) || 1),
      initialCapital: Math.max(100, Number(strategy.initialCapital) || 100_000),
      stopLossPct: Math.max(0.05, Math.min(50, Number(strategy.stopLossPct) || 0.6)),
      takeProfitPct: Math.max(0.05, Math.min(200, Number(strategy.takeProfitPct) || 1.2)),
      executionMode: strategy.executionMode,
      botEnabled: Boolean(strategy.botEnabled),
      autoExecute: Boolean(strategy.autoExecute),
      updatedAt: serverTimestamp(),
    };

    if (strategy.id && !strategy.id.startsWith('pine-')) {
      const ref = doc(db, 'pineStrategies', strategy.id);
      await updateDoc(ref, cleanPayload);
      return strategy.id;
    }

    const docRef = await addDoc(collection(db, 'pineStrategies'), {
      ...cleanPayload,
      createdAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'pineStrategies');
  }
}

export async function deletePineStrategy(strategyId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'pineStrategies', strategyId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `pineStrategies/${strategyId}`);
  }
}

