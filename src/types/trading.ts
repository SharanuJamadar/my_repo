export type MarketSegment = 'INDIAN' | 'MCX' | 'INTERNATIONAL';
export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d';
export type SignalDirection = 'BUY' | 'SELL' | 'NO_TRADE';
export type SignalStatus = 'ACTIVE' | 'WAIT' | 'INVALIDATED' | 'TARGET_HIT' | 'SL_HIT' | 'NO_TRADE';
export type TradeMode = 'PAPER' | 'LIVE';

export interface InstrumentMeta {
  id: string;
  symbol: string;
  name: string;
  segment: MarketSegment;
  currency: '₹' | '$';
  exchangeLabel: string;
  supportsOptions: boolean;
  strikeStep?: number;
  lotSize: number;
  yahooSymbol: string;
  tradingViewSymbol: string;
  investingUrl: string;
  binanceSymbol?: string;
  bybitSymbol?: string;
  swissquotePair?: string;
  twelveDataSymbol?: string;
  ema9Priority?: boolean;
  notes?: string;
}

export interface CandleBar {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalSnapshot {
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  vwap: number | null;
  rsi: number | null;
  macd: {
    macdLine: number;
    signalLine: number;
    histogram: number;
  } | null;
  atr: number | null;
  volumeRatio: number | null;
  candlePattern: string;
  trendBias: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  momentumState: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
}

export interface SupportResistanceLevels {
  immediateSupport: number;
  strongSupport: number;
  immediateResistance: number;
  strongResistance: number;
  breakoutLevel: number;
  breakdownLevel: number;
  noTradeZoneLow: number;
  noTradeZoneHigh: number;
}

export interface MarketQuoteResponse {
  instrument: InstrumentMeta;
  available: boolean;
  statusText: 'LIVE' | 'DATA UNAVAILABLE';
  unavailableReason?: string;
  provider: string;
  fetchedAt: string; // ISO timestamp
  marketTimestamp: string; // ISO timestamp of latest candle/tick
  timeframe: Timeframe;
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  candles: CandleBar[];
  technicals?: TechnicalSnapshot;
  levels?: SupportResistanceLevels;
}

export interface ChecklistItem {
  label: string;
  passed: boolean;
  detail: string;
}

export interface StrategyConfig {
  userId: string;
  emaFast: number;
  emaMid: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiBullishMin: number;
  rsiBearishMax: number;
  trendTimeframe: '15m' | '1h' | '4h';
  entryTimeframe: '5m' | '15m';
  minSetupScore: number;
  minRiskReward: number;
  maxRiskPerTradePct: number;
  prioritizeAtmOptions: boolean;
  comexCrudeEma9Priority: boolean;
  paperTradingOnly: boolean;
  autoBroadcastTelegram: boolean;
  telegramChannelLabel: string;
  dataProviderLabel: string;
  brokerProviderLabel: string;
  killSwitchActive: boolean;
  activeInstruments: string[];
  updatedAt?: unknown;
}

export interface GeneratedSignalPayload {
  instrument: string;
  marketSegment: MarketSegment;
  contract: string;
  direction: SignalDirection;
  entryTrigger: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3?: number;
  riskReward: string;
  entryTimeframe: string;
  trendTimeframe: string;
  horizon: string;
  invalidationLevel: number;
  confirmationText: string;
  status: SignalStatus;
  qualityScore: number;
  checklist: ChecklistItem[];
  reasonsFor: string[];
  reasonsAgainst: string[];
  formattedSignalText: string;
  telegramReadyText: string;
  atmOptionContext?: {
    spotPrice: number;
    recommendedStrike: number;
    optionType: 'CE' | 'PE' | 'WAIT';
    nearAtmStrikes: number[];
    note: string;
  };
  aiNarrative?: string;
  verifiedVsEstimated?: {
    verifiedFromDataOrChart: string[];
    estimatedOrNotVisible: string[];
  };
}

export interface StoredTradeSignal {
  id: string;
  userId: string;
  instrument: string;
  marketSegment: MarketSegment;
  contract: string;
  direction: SignalDirection;
  entryTrigger?: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3?: number;
  riskReward: string;
  entryTimeframe: string;
  trendTimeframe: string;
  horizon: string;
  invalidationLevel?: number;
  confirmationText: string;
  status: SignalStatus;
  qualityScore: number;
  checklistSummary?: string[];
  reasonsFor?: string[];
  reasonsAgainst?: string[];
  sourceType: 'LIVE_MARKET' | 'CHART_UPLOAD' | 'CHATBOT';
  telegramPublished: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface TradeJournalEntry {
  id: string;
  userId: string;
  signalId?: string;
  instrument: string;
  contract: string;
  direction: 'BUY' | 'SELL';
  executionMode: TradeMode;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2?: number;
  target3?: number;
  exitPrice?: number;
  quantity: number;
  status: 'OPEN' | 'CLOSED';
  result: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';
  pnl: number;
  riskReward: string;
  strategyConfirmation: string;
  screenshotNote?: string;
  brokerOrderId?: string;
  createdAt: any;
  updatedAt: any;
}

export interface ChatMessageRecord {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  instrumentContext?: string;
  createdAt: any;
}

export interface TelegramLogRecord {
  id: string;
  userId: string;
  signalId?: string;
  instrument: string;
  eventType: 'SIGNAL' | 'TARGET_HIT' | 'SL_HIT' | 'MARKET_UPDATE';
  messageText: string;
  deliveryStatus: 'SENT' | 'FAILED' | 'NOT_CONFIGURED';
  statusDetail?: string;
  createdAt: any;
}

export interface ExecutionOrderRecord {
  id: string;
  userId: string;
  signalId: string;
  instrument: string;
  contract: string;
  expiry?: string;
  quantity: number;
  orderType: 'MARKET' | 'LIMIT' | 'SL-M';
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  executionMode: TradeMode;
  brokerName: string;
  brokerOrderId?: string;
  status: 'CONFIRMED_PAPER' | 'SUBMITTED_LIVE' | 'REJECTED' | 'KILLED';
  createdAt: any;
  updatedAt: any;
}

export interface DemoWalletState {
  userId: string;
  balance: number;
  totalAdded: number;
  recentDeposits: string[];
  updatedAt?: unknown;
}

export const DEFAULT_DEMO_WALLET: Omit<DemoWalletState, 'userId'> = {
  balance: 100000,
  totalAdded: 100000,
  recentDeposits: ['Initial Demo Allocation | +100000'],
};

export const INSTRUMENTS: InstrumentMeta[] = [
  // Indian Markets
  {
    id: 'NIFTY50',
    symbol: 'NIFTY 50',
    name: 'Nifty 50 Index',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE',
    supportsOptions: true,
    strikeStep: 50,
    lotSize: 75,
    yahooSymbol: '^NSEI',
    tradingViewSymbol: 'NSE:NIFTY',
    investingUrl: 'https://www.investing.com/indices/s-p-cnx-nifty-chart',
    twelveDataSymbol: 'NIFTY',
    notes: 'Prioritizes ATM / near-ATM CE & PE options',
  },
  {
    id: 'BANKNIFTY',
    symbol: 'BANK NIFTY',
    name: 'Nifty Bank Index',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE',
    supportsOptions: true,
    strikeStep: 100,
    lotSize: 30,
    yahooSymbol: '^NSEBANK',
    tradingViewSymbol: 'NSE:BANKNIFTY',
    investingUrl: 'https://www.investing.com/indices/bank-nifty-chart',
    twelveDataSymbol: 'BANKNIFTY',
    notes: 'Prioritizes ATM / near-ATM CE & PE options',
  },
  {
    id: 'SENSEX',
    symbol: 'SENSEX',
    name: 'BSE Sensex 30',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'BSE',
    supportsOptions: true,
    strikeStep: 100,
    lotSize: 20,
    yahooSymbol: '^BSESN',
    tradingViewSymbol: 'BSE:SENSEX',
    investingUrl: 'https://www.investing.com/indices/sensex-chart',
    twelveDataSymbol: 'SENSEX',
    notes: 'Prioritizes ATM / near-ATM CE & PE options',
  },
  // MCX Commodities
  {
    id: 'MCX_GOLD',
    symbol: 'MCX GOLD',
    name: 'Gold Futures / Benchmark',
    segment: 'MCX',
    currency: '$',
    exchangeLabel: 'MCX / COMEX',
    supportsOptions: true,
    lotSize: 1,
    yahooSymbol: 'GC=F',
    tradingViewSymbol: 'COMEX:GC1!',
    investingUrl: 'https://www.investing.com/commodities/gold-streaming-chart',
    swissquotePair: 'XAU/USD',
    twelveDataSymbol: 'XAU/USD',
    notes: 'Live Gold benchmark feed with real-time spot sync',
  },
  {
    id: 'MCX_SILVER',
    symbol: 'MCX SILVER',
    name: 'Silver Futures / Benchmark',
    segment: 'MCX',
    currency: '$',
    exchangeLabel: 'MCX / COMEX',
    supportsOptions: true,
    lotSize: 1,
    yahooSymbol: 'SI=F',
    tradingViewSymbol: 'COMEX:SI1!',
    investingUrl: 'https://www.investing.com/commodities/silver-streaming-chart',
    swissquotePair: 'XAG/USD',
    twelveDataSymbol: 'XAG/USD',
    notes: 'Live Silver benchmark feed with real-time spot sync',
  },
  {
    id: 'MCX_CRUDEOIL',
    symbol: 'MCX CRUDE OIL',
    name: 'Crude Oil Futures / Benchmark',
    segment: 'MCX',
    currency: '$',
    exchangeLabel: 'MCX / NYMEX',
    supportsOptions: true,
    lotSize: 100,
    yahooSymbol: 'CL=F',
    tradingViewSymbol: 'NYMEX:CL1!',
    investingUrl: 'https://www.investing.com/commodities/crude-oil-streaming-chart',
    twelveDataSymbol: 'WTI/USD',
    ema9Priority: true,
    notes: 'EMA 9 priority active for Crude Oil momentum tracking',
  },
  {
    id: 'MCX_NATURALGAS',
    symbol: 'MCX NATURAL GAS',
    name: 'Natural Gas Futures / Benchmark',
    segment: 'MCX',
    currency: '$',
    exchangeLabel: 'MCX / NYMEX',
    supportsOptions: true,
    lotSize: 1250,
    yahooSymbol: 'NG=F',
    tradingViewSymbol: 'NYMEX:NG1!',
    investingUrl: 'https://www.investing.com/commodities/natural-gas-streaming-chart',
    twelveDataSymbol: 'NG/USD',
    notes: 'Live Natural Gas benchmark feed',
  },
  {
    id: 'MCX_COPPER',
    symbol: 'MCX COPPER',
    name: 'Copper Futures / Benchmark',
    segment: 'MCX',
    currency: '$',
    exchangeLabel: 'MCX / COMEX',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'HG=F',
    tradingViewSymbol: 'COMEX:HG1!',
    investingUrl: 'https://www.investing.com/commodities/copper-streaming-chart',
    twelveDataSymbol: 'HG/USD',
    notes: 'Live Copper benchmark feed',
  },
  // International Markets
  {
    id: 'XAUUSD',
    symbol: 'XAUUSD',
    name: 'Spot Gold / US Dollar',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'FOREX / COMEX',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'GC=F',
    tradingViewSymbol: 'OANDA:XAUUSD',
    investingUrl: 'https://www.investing.com/currencies/xau-usd-chart',
    swissquotePair: 'XAU/USD',
    twelveDataSymbol: 'XAU/USD',
  },
  {
    id: 'XAGUSD',
    symbol: 'XAGUSD',
    name: 'Spot Silver / US Dollar',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'FOREX / COMEX',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'SI=F',
    tradingViewSymbol: 'OANDA:XAGUSD',
    investingUrl: 'https://www.investing.com/currencies/xag-usd-chart',
    swissquotePair: 'XAG/USD',
    twelveDataSymbol: 'XAG/USD',
  },
  {
    id: 'USOIL',
    symbol: 'US CRUDE OIL',
    name: 'WTI Crude Oil (COMEX/NYMEX)',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'COMEX / NYMEX',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'CL=F',
    tradingViewSymbol: 'TVC:USOIL',
    investingUrl: 'https://www.investing.com/commodities/crude-oil-streaming-chart',
    twelveDataSymbol: 'WTI/USD',
    ema9Priority: true,
    notes: 'EMA 9 special momentum weighting enabled',
  },
  {
    id: 'BTCUSDT',
    symbol: 'BTCUSDT',
    name: 'Bitcoin / Tether Perpetual',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'CRYPTO',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'BTC-USD',
    tradingViewSymbol: 'BINANCE:BTCUSDT',
    investingUrl: 'https://www.investing.com/crypto/bitcoin/btc-usd-chart',
    binanceSymbol: 'BTCUSDT',
    bybitSymbol: 'BTCUSDT',
    twelveDataSymbol: 'BTC/USD',
  },
  {
    id: 'ETHUSDT',
    symbol: 'ETHUSDT',
    name: 'Ethereum / Tether Perpetual',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'CRYPTO',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'ETH-USD',
    tradingViewSymbol: 'BINANCE:ETHUSDT',
    investingUrl: 'https://www.investing.com/crypto/ethereum/eth-usd-chart',
    binanceSymbol: 'ETHUSDT',
    bybitSymbol: 'ETHUSDT',
    twelveDataSymbol: 'ETH/USD',
  },
  {
    id: 'SOLUSDT',
    symbol: 'SOLUSDT',
    name: 'Solana / Tether Perpetual',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'CRYPTO',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'SOL-USD',
    tradingViewSymbol: 'BINANCE:SOLUSDT',
    investingUrl: 'https://www.investing.com/crypto/solana/sol-usd-chart',
    binanceSymbol: 'SOLUSDT',
    bybitSymbol: 'SOLUSDT',
    twelveDataSymbol: 'SOL/USD',
  },
];

export const DEFAULT_STRATEGY_CONFIG: Omit<StrategyConfig, 'userId'> = {
  emaFast: 9,
  emaMid: 20,
  emaSlow: 50,
  rsiPeriod: 14,
  rsiBullishMin: 55,
  rsiBearishMax: 45,
  trendTimeframe: '15m',
  entryTimeframe: '5m',
  minSetupScore: 70,
  minRiskReward: 1.8,
  maxRiskPerTradePct: 1.5,
  prioritizeAtmOptions: true,
  comexCrudeEma9Priority: true,
  paperTradingOnly: true,
  autoBroadcastTelegram: false,
  telegramChannelLabel: 'SHARAN Trading Desk',
  dataProviderLabel: 'Live Multi-Source Feed (Yahoo query2 / Binance / Swissquote)',
  brokerProviderLabel: 'SHARAN Paper Trading Engine',
  killSwitchActive: false,
  activeInstruments: INSTRUMENTS.map((i) => i.id),
};
