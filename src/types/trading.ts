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
  binanceFuturesSymbol?: string;
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
  adx?: number | null;
  bollingerSqueeze?: boolean;
  regime?: 'TRENDING' | 'CHOPPY' | 'SQUEEZE';
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
  bid?: number;
  ask?: number;
  spread?: number;
  spreadBps?: number;
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
  adxMinThreshold?: number;
  enableSessionFilter?: boolean;
  pauseOnHighImpactNews?: boolean;
  enablePartialProfitBooking?: boolean;
  dailyMaxLossPct?: number;
  dailyProfitTargetPct?: number;
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
  tpStage?: 0 | 1 | 2;
  exitPrice?: number;
  quantity: number;
  remainingQuantity?: number;
  partialRealizedPnl?: number;
  status: 'OPEN' | 'CLOSED';
  result: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';
  pnl: number;
  riskReward: string;
  strategyConfirmation: string;
  screenshotNote?: string;
  brokerOrderId?: string;
  auditTrail?: string[];
  createdAt: any;
  updatedAt: any;
}

export interface TradeTrailState {
  currentSl: number;
  tpStage: 0 | 1 | 2;
  target1: number;
  target2: number;
  target3: number;
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
  target2?: number;
  target3?: number;
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
  // Indian Markets — Most Traded Indices & NSE F&O Leaders
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
    id: 'FINNIFTY',
    symbol: 'FIN NIFTY',
    name: 'Nifty Financial Services',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE',
    supportsOptions: true,
    strikeStep: 50,
    lotSize: 65,
    yahooSymbol: 'NIFTY_FIN_SERVICE.NS',
    tradingViewSymbol: 'NSE:CNXFINANCE',
    investingUrl: 'https://www.investing.com/indices/cnx-finance-chart',
    twelveDataSymbol: 'FINNIFTY',
    notes: 'Prioritizes ATM / near-ATM CE & PE options',
  },
  {
    id: 'MIDCPNIFTY',
    symbol: 'MIDCAP NIFTY',
    name: 'Nifty Midcap Select Index',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE',
    supportsOptions: true,
    strikeStep: 25,
    lotSize: 120,
    yahooSymbol: 'NIFTY_MID_SELECT.NS',
    tradingViewSymbol: 'NSE:NIFTYMIDCAP150',
    investingUrl: 'https://www.investing.com/indices/nifty-midcap-select',
    notes: 'High-volume NSE midcap index derivatives',
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
  {
    id: 'RELIANCE',
    symbol: 'RELIANCE',
    name: 'Reliance Industries Ltd',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE F&O',
    supportsOptions: true,
    strikeStep: 20,
    lotSize: 500,
    yahooSymbol: 'RELIANCE.NS',
    tradingViewSymbol: 'NSE:RELIANCE',
    investingUrl: 'https://www.investing.com/equities/reliance-industries',
    notes: 'Top-volume NSE bluechip stock & F&O contract',
  },
  {
    id: 'HDFCBANK',
    symbol: 'HDFC BANK',
    name: 'HDFC Bank Ltd',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE F&O',
    supportsOptions: true,
    strikeStep: 10,
    lotSize: 550,
    yahooSymbol: 'HDFCBANK.NS',
    tradingViewSymbol: 'NSE:HDFCBANK',
    investingUrl: 'https://www.investing.com/equities/hdfc-bank-ltd',
    notes: 'Heavyweight Bank Nifty constituent & NSE F&O leader',
  },
  {
    id: 'ICICIBANK',
    symbol: 'ICICI BANK',
    name: 'ICICI Bank Ltd',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE F&O',
    supportsOptions: true,
    strikeStep: 10,
    lotSize: 700,
    yahooSymbol: 'ICICIBANK.NS',
    tradingViewSymbol: 'NSE:ICICIBANK',
    investingUrl: 'https://www.investing.com/equities/icici-bank-ltd',
    notes: 'Active NSE banking F&O stock',
  },
  {
    id: 'SBIN',
    symbol: 'SBIN',
    name: 'State Bank of India',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE F&O',
    supportsOptions: true,
    strikeStep: 10,
    lotSize: 750,
    yahooSymbol: 'SBIN.NS',
    tradingViewSymbol: 'NSE:SBIN',
    investingUrl: 'https://www.investing.com/equities/state-bank-of-india',
    notes: 'High-liquidity PSU banking leader',
  },
  {
    id: 'INFY',
    symbol: 'INFOSYS',
    name: 'Infosys Ltd',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE F&O',
    supportsOptions: true,
    strikeStep: 20,
    lotSize: 400,
    yahooSymbol: 'INFY.NS',
    tradingViewSymbol: 'NSE:INFY',
    investingUrl: 'https://www.investing.com/equities/infosys',
    notes: 'NSE IT bellwether & active F&O stock',
  },
  {
    id: 'TCS',
    symbol: 'TCS',
    name: 'Tata Consultancy Services',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE F&O',
    supportsOptions: true,
    strikeStep: 50,
    lotSize: 175,
    yahooSymbol: 'TCS.NS',
    tradingViewSymbol: 'NSE:TCS',
    investingUrl: 'https://www.investing.com/equities/tata-consultancy-services',
    notes: 'Large-cap IT benchmark & NSE F&O contract',
  },
  {
    id: 'BHARTIARTL',
    symbol: 'BHARTI AIRTEL',
    name: 'Bharti Airtel Ltd',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE F&O',
    supportsOptions: true,
    strikeStep: 20,
    lotSize: 475,
    yahooSymbol: 'BHARTIARTL.NS',
    tradingViewSymbol: 'NSE:BHARTIARTL',
    investingUrl: 'https://www.investing.com/equities/bharti-airtel',
    notes: 'Most traded Indian telecom equity & F&O',
  },
  {
    id: 'AXISBANK',
    symbol: 'AXIS BANK',
    name: 'Axis Bank Ltd',
    segment: 'INDIAN',
    currency: '₹',
    exchangeLabel: 'NSE F&O',
    supportsOptions: true,
    strikeStep: 10,
    lotSize: 625,
    yahooSymbol: 'AXISBANK.NS',
    tradingViewSymbol: 'NSE:AXISBANK',
    investingUrl: 'https://www.investing.com/equities/axis-bank',
    notes: 'High-beta private banking F&O leader',
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
    binanceFuturesSymbol: 'XAUUSDT',
    swissquotePair: 'XAU/USD',
    twelveDataSymbol: 'XAU/USD',
    notes: 'Binance Futures XAUUSDT live stream + spot sync',
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
    binanceFuturesSymbol: 'XAGUSDT',
    swissquotePair: 'XAG/USD',
    twelveDataSymbol: 'XAG/USD',
    notes: 'Binance Futures XAGUSDT live stream + spot sync',
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
  // International Markets — Global Metals, US Indices, Major FX & Crypto
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
    binanceFuturesSymbol: 'XAUUSDT',
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
    binanceFuturesSymbol: 'XAGUSDT',
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
    id: 'NAS100',
    symbol: 'NASDAQ 100',
    name: 'E-Mini Nasdaq-100 Futures',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'CME / US TECH',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'NQ=F',
    tradingViewSymbol: 'NASDAQ:NDX',
    investingUrl: 'https://www.investing.com/indices/nq-100',
    twelveDataSymbol: 'NDX',
    notes: 'Most traded US tech index benchmark',
  },
  {
    id: 'SPX500',
    symbol: 'S&P 500',
    name: 'E-Mini S&P 500 Futures',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'CME / US500',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'ES=F',
    tradingViewSymbol: 'SP:SPX',
    investingUrl: 'https://www.investing.com/indices/us-spx-500',
    twelveDataSymbol: 'SPX',
    notes: 'Global institutional equity benchmark',
  },
  {
    id: 'US30',
    symbol: 'DOW JONES',
    name: 'E-Mini Dow 30 Futures (US30)',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'CBOT / US30',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'YM=F',
    tradingViewSymbol: 'DJ:DJI',
    investingUrl: 'https://www.investing.com/indices/us-30',
    twelveDataSymbol: 'DJI',
    notes: 'US30 industrial index benchmark',
  },
  {
    id: 'EURUSD',
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar Spot FX',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'FOREX MAJOR',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'EURUSD=X',
    tradingViewSymbol: 'FX:EURUSD',
    investingUrl: 'https://www.investing.com/currencies/eur-usd',
    swissquotePair: 'EUR/USD',
    twelveDataSymbol: 'EUR/USD',
    notes: 'World most liquid forex pair + Swissquote BBO sync',
  },
  {
    id: 'GBPUSD',
    symbol: 'GBP/USD',
    name: 'British Pound / US Dollar Spot FX',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'FOREX MAJOR',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'GBPUSD=X',
    tradingViewSymbol: 'FX:GBPUSD',
    investingUrl: 'https://www.investing.com/currencies/gbp-usd',
    swissquotePair: 'GBP/USD',
    twelveDataSymbol: 'GBP/USD',
    notes: 'London/NY session forex major + Swissquote BBO sync',
  },
  {
    id: 'USDJPY',
    symbol: 'USD/JPY',
    name: 'US Dollar / Japanese Yen Spot FX',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'FOREX MAJOR',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'USDJPY=X',
    tradingViewSymbol: 'FX:USDJPY',
    investingUrl: 'https://www.investing.com/currencies/usd-jpy',
    swissquotePair: 'USD/JPY',
    twelveDataSymbol: 'USD/JPY',
    notes: 'Tokyo/NY forex benchmark + Swissquote BBO sync',
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
  {
    id: 'BNBUSDT',
    symbol: 'BNBUSDT',
    name: 'BNB / Tether Perpetual',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'CRYPTO',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'BNB-USD',
    tradingViewSymbol: 'BINANCE:BNBUSDT',
    investingUrl: 'https://www.investing.com/crypto/bnb/bnb-usd-chart',
    binanceSymbol: 'BNBUSDT',
    bybitSymbol: 'BNBUSDT',
    twelveDataSymbol: 'BNB/USD',
  },
  {
    id: 'XRPUSDT',
    symbol: 'XRPUSDT',
    name: 'XRP / Tether Perpetual',
    segment: 'INTERNATIONAL',
    currency: '$',
    exchangeLabel: 'CRYPTO',
    supportsOptions: false,
    lotSize: 1,
    yahooSymbol: 'XRP-USD',
    tradingViewSymbol: 'BINANCE:XRPUSDT',
    investingUrl: 'https://www.investing.com/crypto/xrp/xrp-usd-chart',
    binanceSymbol: 'XRPUSDT',
    bybitSymbol: 'XRPUSDT',
    twelveDataSymbol: 'XRP/USD',
  },
];

export const DEFAULT_STRATEGY_CONFIG: Omit<StrategyConfig, 'userId'> = {
  emaFast: 9,
  emaMid: 20,
  emaSlow: 50,
  rsiPeriod: 14,
  rsiBullishMin: 53,
  rsiBearishMax: 47,
  trendTimeframe: '15m',
  entryTimeframe: '5m',
  minSetupScore: 75,
  minRiskReward: 2.0,
  maxRiskPerTradePct: 2.0,
  prioritizeAtmOptions: true,
  comexCrudeEma9Priority: true,
  paperTradingOnly: true,
  autoBroadcastTelegram: false,
  telegramChannelLabel: 'My Trade Desk',
  dataProviderLabel: 'Live Multi-Source Feed (Yahoo query2 / Binance / Swissquote)',
  brokerProviderLabel: 'My Trade Paper Trading Engine',
  killSwitchActive: false,
  activeInstruments: INSTRUMENTS.map((i) => i.id),
  adxMinThreshold: 18,
  enableSessionFilter: true,
  pauseOnHighImpactNews: true,
  enablePartialProfitBooking: true,
  dailyMaxLossPct: 3.0,
  dailyProfitTargetPct: 10.0,
};

export interface AccountProfileSettings {
  displayName: string;
  email: string;
  mobileNumber: string;
  accountMode: 'UNDECIDED' | 'BROKER' | 'DEMO';
  onboardingCompleted: boolean;
  riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  defaultInstrumentId: string;
  defaultTimeframe: Timeframe;
  dailyLossLimit: number;
  telegramChatId: string;
  tradeAlertsEnabled: boolean;
}

export const DEFAULT_ACCOUNT_PROFILE: AccountProfileSettings = {
  displayName: 'My Trade Trader',
  email: '',
  mobileNumber: '',
  accountMode: 'UNDECIDED',
  onboardingCompleted: false,
  riskProfile: 'BALANCED',
  defaultInstrumentId: 'XAUUSD',
  defaultTimeframe: '5m',
  dailyLossLimit: 5000,
  telegramChatId: '',
  tradeAlertsEnabled: true,
};

export interface PineStrategyRecord {
  id: string;
  userId: string;
  name: string;
  description: string;
  instrumentId: string;
  timeframe: Timeframe;
  pineCode: string;
  quantity: number;
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
  riskPerTradePct?: number;
  trailingStop?: boolean;
  executionMode: TradeMode;
  botEnabled: boolean;
  autoExecute: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface PineBacktestTrade {
  id: string;
  side: 'BUY' | 'SELL';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  costs?: number;
  returnPct: number;
  tp1Price?: number;
  tp2Price?: number;
  tp3Price?: number;
  tpReached?: 0 | 1 | 2 | 3;
  trailedStopLoss?: number;
  exitReason:
    | 'TP3_TARGET'
    | 'TRAIL_SL_TP2'
    | 'TRAIL_SL_TP1'
    | 'TAKE_PROFIT'
    | 'TRAILING_PROFIT'
    | 'STOP_LOSS'
    | 'SIGNAL_REVERSE'
    | 'END_OF_SERIES';
  note: string;
}

export interface PineOverlaySeries {
  label: string;
  color: string;
  points: { time: number; value: number }[];
}

export interface PineParsedSummary {
  scriptTitle: string;
  pineVersion: string;
  indicatorsDetected: string[];
  buyRuleSummary: string;
  sellRuleSummary: string;
  unsupportedConstructs: string[];
}

export interface PineBacktestResult {
  available: boolean;
  error?: string;
  strategyName: string;
  instrument: InstrumentMeta;
  timeframe: Timeframe;
  provider: string;
  marketTimestamp: string;
  candlesCount: number;
  parsed: PineParsedSummary;
  candles: CandleBar[];
  overlays: PineOverlaySeries[];
  trades: PineBacktestTrade[];
  equityCurve: { time: number; equity: number }[];
  metrics: {
    initialCapital: number;
    finalEquity: number;
    netProfit: number;
    netProfitPct: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRatePct: number;
    profitFactor: number;
    maxDrawdownPct: number;
    avgWin: number;
    avgLoss: number;
    totalCosts?: number;
    spreadBpsModeled?: number;
  };
}

export interface PineBotEvaluationResult {
  available: boolean;
  error?: string;
  strategyId: string;
  strategyName: string;
  instrument: InstrumentMeta;
  timeframe: Timeframe;
  evaluatedAt: string;
  barTime: number;
  price: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  reason: string;
  indicatorSnapshot: Record<string, number | string>;
  parsed: PineParsedSummary;
}

export interface PineBotActivityLog {
  id: string;
  timestamp: string;
  strategyName: string;
  instrumentSymbol: string;
  timeframe: Timeframe;
  action: 'BUY' | 'SELL' | 'HOLD' | 'ERROR';
  price: number;
  executed: boolean;
  detail: string;
}

export type MarketNewsCategory = 'ALL' | 'INDIAN' | 'MCX' | 'INTERNATIONAL';

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface MarketNewsItem {
  headline: string;
  summary: string;
  impactDirection: 'BULLISH' | 'BEARISH' | 'VOLATILE' | 'NEUTRAL';
  impactLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  marketScope: 'INDIAN' | 'MCX' | 'INTERNATIONAL';
  affectedAssets: string[];
  publishedTime: string;
  sourceName: string;
  sourceUrl?: string;
}

export interface LiveMarketNewsResponse {
  category: MarketNewsCategory;
  query: string;
  fetchedAt: string;
  marketBrief: string;
  items: MarketNewsItem[];
  groundingSources: GroundingSource[];
  cached?: boolean;
}

export interface PriceAlertRule {
  id: string;
  instrumentId: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW';
  targetPrice: number;
  note?: string;
  sendTelegram: boolean;
  active: boolean;
  triggeredAt?: string;
  triggeredPrice?: number;
  createdAt: string;
}

export interface MarketSessionClock {
  id: 'NSE' | 'TOKYO' | 'LONDON' | 'NEW_YORK';
  name: string;
  city: string;
  timezone: string;
  localTime: string;
  isOpen: boolean;
  statusDetail: string;
  markets: string;
}

export interface EconomicCalendarEvent {
  id: string;
  title: string;
  country: string;
  currency: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  scheduledAt: string; // ISO
  forecast?: string;
  previous?: string;
  minutesUntil: number;
  isImminent: boolean;
  affectsSegments: MarketSegment[];
}

export interface EconomicCalendarResponse {
  fetchedAt: string;
  source: string;
  sessions: MarketSessionClock[];
  events: EconomicCalendarEvent[];
  highImpactBlackout: {
    active: boolean;
    eventTitle?: string;
    minutesUntil?: number;
    windowMinutes: number;
  };
}

export interface MonitoredPositionSyncItem {
  tradeId: string;
  instrumentId: string;
  symbol: string;
  contract: string;
  direction: 'BUY' | 'SELL';
  executionMode: TradeMode;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  tpStage: 0 | 1 | 2;
  quantity: number;
  remainingQuantity: number;
  partialRealizedPnl: number;
  enablePartialProfitBooking: boolean;
  brokerOrderId?: string;
}

export interface MonitoredPositionEvent {
  tradeId: string;
  type: 'TRAIL_TP1' | 'TRAIL_TP2' | 'CLOSE_TP3' | 'CLOSE_SL';
  timestamp: string;
  price: number;
  newStopLoss: number;
  tpStage: 0 | 1 | 2;
  partialRealizedPnl: number;
  remainingQuantity: number;
  finalPnl?: number;
  result?: 'WIN' | 'LOSS' | 'BREAKEVEN';
  detail: string;
}

