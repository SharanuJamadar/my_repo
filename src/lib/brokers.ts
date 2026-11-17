export interface BrokerAppMeta {
  id: string;
  name: string;
  markets: string;
  authProtocol: string;
  portalUrl: string;
  envHint: string;
}

export const BROKER_APPS: BrokerAppMeta[] = [
  {
    id: 'PAPER_ENGINE',
    name: 'SHARAN Paper Engine',
    markets: 'All 14 Markets (Indian, MCX, Global, Crypto)',
    authProtocol: 'Built-in Instant Demo Execution',
    portalUrl: '',
    envHint: 'Always Ready',
  },
  {
    id: 'GROWW',
    name: 'Groww',
    markets: 'NIFTY 50, BANK NIFTY, SENSEX, Indian F&O',
    authProtocol: 'Broker API / Trading Token',
    portalUrl: 'https://groww.in/stocks/user/explore',
    envHint: 'GROWW_API_TOKEN',
  },
  {
    id: 'EXNESS',
    name: 'Exness',
    markets: 'XAUUSD, XAGUSD, US Crude Oil, BTCUSDT',
    authProtocol: 'MT5 WebTerminal / Execution Bridge',
    portalUrl: 'https://www.exness.com/webterminal/',
    envHint: 'EXNESS_BRIDGE_URL',
  },
  {
    id: 'UPSTOX',
    name: 'Upstox',
    markets: 'NSE, BSE, NIFTY/BANKNIFTY Options, MCX',
    authProtocol: 'Upstox v2 OAuth2 API',
    portalUrl: 'https://login.upstox.com/',
    envHint: 'UPSTOX_ACCESS_TOKEN',
  },
  {
    id: 'ZERODHA',
    name: 'Zerodha Kite',
    markets: 'NSE, BSE, NFO, MCX Commodities',
    authProtocol: 'Kite Connect OAuth',
    portalUrl: 'https://kite.zerodha.com/',
    envHint: 'KITE_ACCESS_TOKEN',
  },
  {
    id: 'DHAN',
    name: 'Dhan',
    markets: 'Indian Indices, Options, MCX Commodities',
    authProtocol: 'DhanHQ Access Token API',
    portalUrl: 'https://web.dhan.co/',
    envHint: 'DHAN_ACCESS_TOKEN',
  },
  {
    id: 'ANGELONE',
    name: 'Angel One',
    markets: 'NSE, BSE, F&O, MCX Commodities',
    authProtocol: 'SmartAPI Session Auth',
    portalUrl: 'https://trade.angelone.in/',
    envHint: 'ANGEL_API_KEY',
  },
  {
    id: 'BINANCE',
    name: 'Binance',
    markets: 'BTCUSDT, ETHUSDT, SOLUSDT Spot & Futures',
    authProtocol: 'Binance Signed Spot/Futures API',
    portalUrl: 'https://www.binance.com/en/trade/BTC_USDT',
    envHint: 'BINANCE_API_KEY',
  },
];

export const AUTO_SCAN_INSTRUMENT_IDS = [
  'XAUUSD',
  'NIFTY50',
  'XAGUSD',
  'BTCUSDT',
  'MCX_CRUDEOIL',
] as const;
