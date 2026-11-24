import crypto from 'crypto';
import type { Express, Request, Response } from 'express';

export interface BrokerOAuthSession {
  brokerId: string;
  brokerName: string;
  userId: string;
  connectedAt: string;
  expiresAt: number;
  method: 'OAUTH_SESSION';
  tokenPreview: string;
  /** Stored strictly in server memory; never sent to browser */
  accessToken: string;
}

interface PendingOAuthState {
  brokerId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

interface BrokerOAuthSpec {
  id: string;
  name: string;
  supportsOAuth: boolean;
  portalUrl: string;
  developerPortalUrl: string;
  requiredEnvVars: string[];
  isEnvConfigured: () => boolean;
  buildAuthUrl?: (callbackUrl: string, state: string) => string | null;
  exchangeCode?: (params: {
    code: string;
    callbackUrl: string;
  }) => Promise<{ accessToken: string; expiresInSec?: number }>;
}

const pendingStates = new Map<string, PendingOAuthState>();
const activeSessions = new Map<string, BrokerOAuthSession>();

function pruneExpiredOAuthState(now = Date.now()) {
  for (const [key, entry] of pendingStates.entries()) {
    if (entry.expiresAt <= now) {
      pendingStates.delete(key);
    }
  }
  for (const [key, session] of activeSessions.entries()) {
    if (session.expiresAt <= now) {
      activeSessions.delete(key);
    }
  }
}

export function getCanonicalAppUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, '');
  }
  const port = Number(process.env.PORT) || 3000;
  return `http://localhost:${port}`;
}

export function getBrokerCallbackUrl(brokerId: string): string {
  return `${getCanonicalAppUrl()}/auth/broker/callback/${encodeURIComponent(brokerId)}`;
}

const BROKER_OAUTH_SPECS: Record<string, BrokerOAuthSpec> = {
  ZERODHA: {
    id: 'ZERODHA',
    name: 'Zerodha Kite',
    supportsOAuth: true,
    portalUrl: 'https://kite.zerodha.com/',
    developerPortalUrl: 'https://developers.kite.trade/apps',
    requiredEnvVars: ['KITE_API_KEY', 'KITE_API_SECRET'],
    isEnvConfigured: () => Boolean(process.env.KITE_API_KEY && process.env.KITE_ACCESS_TOKEN),
    buildAuthUrl: (_callbackUrl, state) => {
      const apiKey = process.env.KITE_API_KEY?.trim();
      if (!apiKey) return null;
      const params = new URLSearchParams({
        v: '3',
        api_key: apiKey,
        redirect_params: `state=${state}`,
      });
      return `https://kite.zerodha.com/connect/login?${params.toString()}`;
    },
    exchangeCode: async ({ code }) => {
      const apiKey = process.env.KITE_API_KEY?.trim() || '';
      const apiSecret = process.env.KITE_API_SECRET?.trim() || '';
      if (!apiKey || !apiSecret) {
        return { accessToken: code, expiresInSec: 43_200 };
      }
      const checksum = crypto
        .createHash('sha256')
        .update(`${apiKey}${code}${apiSecret}`)
        .digest('hex');
      const body = new URLSearchParams({
        api_key: apiKey,
        request_token: code,
        checksum,
      });
      const res = await fetch('https://api.kite.trade/session/token', {
        method: 'POST',
        headers: {
          'X-Kite-Version': '3',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        message?: string;
        data?: { access_token?: string };
      };
      if (!res.ok || !data?.data?.access_token) {
        throw new Error(data?.message || `Zerodha token exchange failed (HTTP ${res.status})`);
      }
      return { accessToken: data.data.access_token, expiresInSec: 43_200 };
    },
  },

  UPSTOX: {
    id: 'UPSTOX',
    name: 'Upstox',
    supportsOAuth: true,
    portalUrl: 'https://login.upstox.com/',
    developerPortalUrl: 'https://account.upstox.com/developer/apps',
    requiredEnvVars: ['UPSTOX_API_KEY', 'UPSTOX_API_SECRET'],
    isEnvConfigured: () => Boolean(process.env.UPSTOX_ACCESS_TOKEN),
    buildAuthUrl: (callbackUrl, state) => {
      const clientId = process.env.UPSTOX_API_KEY?.trim();
      if (!clientId) return null;
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callbackUrl,
        state,
      });
      return `https://api.upstox.com/v2/login/authorization/dialog?${params.toString()}`;
    },
    exchangeCode: async ({ code, callbackUrl }) => {
      const clientId = process.env.UPSTOX_API_KEY?.trim() || '';
      const clientSecret = process.env.UPSTOX_API_SECRET?.trim() || '';
      const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      });
      const res = await fetch('https://api.upstox.com/v2/login/authorization/token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        errors?: { message?: string }[];
      };
      if (!res.ok || !data?.access_token) {
        throw new Error(data?.errors?.[0]?.message || `Upstox token exchange failed (HTTP ${res.status})`);
      }
      return { accessToken: data.access_token, expiresInSec: 43_200 };
    },
  },

  FYERS: {
    id: 'FYERS',
    name: 'Fyers',
    supportsOAuth: true,
    portalUrl: 'https://trade.fyers.in/',
    developerPortalUrl: 'https://myapi.fyers.in/dashboard',
    requiredEnvVars: ['FYERS_APP_ID', 'FYERS_SECRET_ID'],
    isEnvConfigured: () => Boolean(process.env.FYERS_APP_ID && process.env.FYERS_ACCESS_TOKEN),
    buildAuthUrl: (callbackUrl, state) => {
      const appId = process.env.FYERS_APP_ID?.trim();
      if (!appId) return null;
      const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        state,
      });
      return `https://api-t1.fyers.in/api/v3/generate-authcode?${params.toString()}`;
    },
    exchangeCode: async ({ code }) => {
      const appId = process.env.FYERS_APP_ID?.trim() || '';
      const secretId = process.env.FYERS_SECRET_ID?.trim() || '';
      const appIdHash = crypto.createHash('sha256').update(`${appId}:${secretId}`).digest('hex');
      const res = await fetch('https://api-t1.fyers.in/api/v3/validate-authcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          appIdHash,
          code,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        message?: string;
      };
      if (!res.ok || !data?.access_token) {
        throw new Error(data?.message || `Fyers token validation failed (HTTP ${res.status})`);
      }
      return { accessToken: data.access_token, expiresInSec: 43_200 };
    },
  },

  ANGELONE: {
    id: 'ANGELONE',
    name: 'Angel One SmartAPI',
    supportsOAuth: true,
    portalUrl: 'https://trade.angelone.in/',
    developerPortalUrl: 'https://smartapi.angelbroking.com/apps',
    requiredEnvVars: ['ANGEL_API_KEY'],
    isEnvConfigured: () => Boolean(process.env.ANGEL_API_KEY),
    buildAuthUrl: (_callbackUrl, state) => {
      const apiKey = process.env.ANGEL_API_KEY?.trim();
      if (!apiKey) return null;
      const params = new URLSearchParams({
        api_key: apiKey,
        state,
      });
      return `https://smartapi.angelone.in/publisher-login?${params.toString()}`;
    },
  },

  DHAN: {
    id: 'DHAN',
    name: 'Dhan',
    supportsOAuth: true,
    portalUrl: 'https://web.dhan.co/',
    developerPortalUrl: 'https://web.dhan.co/index/home',
    requiredEnvVars: ['DHAN_CLIENT_ID', 'DHAN_ACCESS_TOKEN'],
    isEnvConfigured: () => Boolean(process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN),
    buildAuthUrl: () => null,
  },

  GROWW: {
    id: 'GROWW',
    name: 'Groww',
    supportsOAuth: false,
    portalUrl: 'https://groww.in/stocks/user/explore',
    developerPortalUrl: 'https://groww.in/trade-api',
    requiredEnvVars: ['GROWW_API_TOKEN'],
    isEnvConfigured: () => Boolean(process.env.GROWW_API_TOKEN),
  },

  ALICEBLUE: {
    id: 'ALICEBLUE',
    name: 'Alice Blue',
    supportsOAuth: true,
    portalUrl: 'https://ant.aliceblueonline.com/',
    developerPortalUrl: 'https://ant.aliceblueonline.com/apps',
    requiredEnvVars: ['ALICEBLUE_APP_CODE', 'ALICEBLUE_API_SECRET'],
    isEnvConfigured: () => Boolean(process.env.ALICEBLUE_APP_CODE && process.env.ALICEBLUE_API_SECRET),
    buildAuthUrl: (_callbackUrl, state) => {
      const appCode = process.env.ALICEBLUE_APP_CODE?.trim();
      if (!appCode) return null;
      const params = new URLSearchParams({ appcode: appCode, state });
      return `https://ant.aliceblueonline.com/?${params.toString()}`;
    },
  },

  FIVEPAISA: {
    id: 'FIVEPAISA',
    name: '5paisa',
    supportsOAuth: true,
    portalUrl: 'https://trade.5paisa.com/',
    developerPortalUrl: 'https://www.5paisa.com/developerapi',
    requiredEnvVars: ['FIVEPAISA_VENDOR_KEY', 'FIVEPAISA_APP_SECRET'],
    isEnvConfigured: () => Boolean(process.env.FIVEPAISA_VENDOR_KEY && process.env.FIVEPAISA_APP_SECRET),
    buildAuthUrl: (callbackUrl, state) => {
      const vendorKey = process.env.FIVEPAISA_VENDOR_KEY?.trim();
      if (!vendorKey) return null;
      const params = new URLSearchParams({
        VendorKey: vendorKey,
        ResponseURL: callbackUrl,
        State: state,
      });
      return `https://dev-openapi.5paisa.com/WebVendorLogin/VLogin/Index?${params.toString()}`;
    },
  },

  EXNESS: {
    id: 'EXNESS',
    name: 'Exness (MT5 Live Bridge)',
    supportsOAuth: false,
    portalUrl: 'https://www.exness.com/webterminal/',
    developerPortalUrl: 'https://my.exness.com/',
    requiredEnvVars: ['EXNESS_BRIDGE_URL', 'EXNESS_API_TOKEN'],
    isEnvConfigured: () => Boolean(process.env.EXNESS_BRIDGE_URL && process.env.EXNESS_API_TOKEN),
  },

  MT5: {
    id: 'MT5',
    name: 'MetaTrader 5 (Universal)',
    supportsOAuth: false,
    portalUrl: 'https://trade.mql5.com/trade',
    developerPortalUrl: 'https://www.metatrader5.com/en/terminal/help/start_advanced/web_terminal',
    requiredEnvVars: ['EXNESS_BRIDGE_URL', 'EXNESS_API_TOKEN'],
    isEnvConfigured: () => Boolean(process.env.EXNESS_BRIDGE_URL && process.env.EXNESS_API_TOKEN),
  },

  CTRADER: {
    id: 'CTRADER',
    name: 'cTrader / IC Markets',
    supportsOAuth: true,
    portalUrl: 'https://app.ctrader.com/',
    developerPortalUrl: 'https://openapi.ctrader.com/apps',
    requiredEnvVars: ['CTRADER_CLIENT_ID', 'CTRADER_CLIENT_SECRET'],
    isEnvConfigured: () => Boolean(process.env.CTRADER_CLIENT_ID && process.env.CTRADER_CLIENT_SECRET),
    buildAuthUrl: (callbackUrl, state) => {
      const clientId = process.env.CTRADER_CLIENT_ID?.trim();
      if (!clientId) return null;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'trading',
        product: 'web',
        state,
      });
      return `https://id.ctrader.com/my/settings/openapi/grantingaccess/?${params.toString()}`;
    },
    exchangeCode: async ({ code, callbackUrl }) => {
      const clientId = process.env.CTRADER_CLIENT_ID?.trim() || '';
      const clientSecret = process.env.CTRADER_CLIENT_SECRET?.trim() || '';
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const res = await fetch(`https://openapi.ctrader.com/apps/token?${params.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        expiresIn?: number;
        description?: string;
      };
      if (!res.ok || !data?.accessToken) {
        throw new Error(data?.description || `cTrader token exchange failed (HTTP ${res.status})`);
      }
      return { accessToken: data.accessToken, expiresInSec: Number(data.expiresIn) || 86_400 };
    },
  },

  OANDA: {
    id: 'OANDA',
    name: 'OANDA fxTrade',
    supportsOAuth: false,
    portalUrl: 'https://trade.oanda.com/',
    developerPortalUrl: 'https://hub.oanda.com/apply/login/',
    requiredEnvVars: ['OANDA_API_TOKEN', 'OANDA_ACCOUNT_ID'],
    isEnvConfigured: () => Boolean(process.env.OANDA_API_TOKEN && process.env.OANDA_ACCOUNT_ID),
  },

  ALPACA: {
    id: 'ALPACA',
    name: 'Alpaca Markets',
    supportsOAuth: true,
    portalUrl: 'https://app.alpaca.markets/',
    developerPortalUrl: 'https://app.alpaca.markets/brokerage/dashboard/overview',
    requiredEnvVars: ['ALPACA_CLIENT_ID', 'ALPACA_CLIENT_SECRET'],
    isEnvConfigured: () =>
      Boolean(
        (process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET) ||
          (process.env.ALPACA_CLIENT_ID && process.env.ALPACA_CLIENT_SECRET)
      ),
    buildAuthUrl: (callbackUrl, state) => {
      const clientId = process.env.ALPACA_CLIENT_ID?.trim();
      if (!clientId) return null;
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'account:write trading',
        state,
      });
      return `https://app.alpaca.markets/oauth/authorize?${params.toString()}`;
    },
    exchangeCode: async ({ code, callbackUrl }) => {
      const clientId = process.env.ALPACA_CLIENT_ID?.trim() || '';
      const clientSecret = process.env.ALPACA_CLIENT_SECRET?.trim() || '';
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
      });
      const res = await fetch('https://api.alpaca.markets/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        error_description?: string;
      };
      if (!res.ok || !data?.access_token) {
        throw new Error(data?.error_description || `Alpaca token exchange failed (HTTP ${res.status})`);
      }
      return { accessToken: data.access_token, expiresInSec: 86_400 };
    },
  },

  IBKR: {
    id: 'IBKR',
    name: 'Interactive Brokers',
    supportsOAuth: false,
    portalUrl: 'https://www.interactivebrokers.com/sso/Login',
    developerPortalUrl: 'https://www.interactivebrokers.com/en/trading/ib-api.php',
    requiredEnvVars: ['IBKR_GATEWAY_URL', 'IBKR_API_TOKEN'],
    isEnvConfigured: () => Boolean(process.env.IBKR_GATEWAY_URL && process.env.IBKR_API_TOKEN),
  },

  BINANCE: {
    id: 'BINANCE',
    name: 'Binance',
    supportsOAuth: false,
    portalUrl: 'https://www.binance.com/en/trade/BTC_USDT',
    developerPortalUrl: 'https://www.binance.com/en/my/settings/api-management',
    requiredEnvVars: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
    isEnvConfigured: () => Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET),
  },

  BYBIT: {
    id: 'BYBIT',
    name: 'Bybit',
    supportsOAuth: false,
    portalUrl: 'https://www.bybit.com/trade/usdt/BTCUSDT',
    developerPortalUrl: 'https://www.bybit.com/app/user/api-management',
    requiredEnvVars: ['BYBIT_API_KEY', 'BYBIT_API_SECRET'],
    isEnvConfigured: () => Boolean(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET),
  },

  COINBASE: {
    id: 'COINBASE',
    name: 'Coinbase Advanced',
    supportsOAuth: true,
    portalUrl: 'https://advanced.coinbase.com/trade/BTC-USD',
    developerPortalUrl: 'https://portal.cdp.coinbase.com/',
    requiredEnvVars: ['COINBASE_CLIENT_ID', 'COINBASE_CLIENT_SECRET'],
    isEnvConfigured: () => Boolean(process.env.COINBASE_CLIENT_ID && process.env.COINBASE_CLIENT_SECRET),
    buildAuthUrl: (callbackUrl, state) => {
      const clientId = process.env.COINBASE_CLIENT_ID?.trim();
      if (!clientId) return null;
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'wallet:accounts:read,wallet:orders:create',
        state,
      });
      return `https://www.coinbase.com/oauth/authorize?${params.toString()}`;
    },
    exchangeCode: async ({ code, callbackUrl }) => {
      const clientId = process.env.COINBASE_CLIENT_ID?.trim() || '';
      const clientSecret = process.env.COINBASE_CLIENT_SECRET?.trim() || '';
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
      });
      const res = await fetch('https://api.coinbase.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error_description?: string;
      };
      if (!res.ok || !data?.access_token) {
        throw new Error(data?.error_description || `Coinbase token exchange failed (HTTP ${res.status})`);
      }
      return { accessToken: data.access_token, expiresInSec: Number(data.expires_in) || 7_200 };
    },
  },

  TRADINGVIEW: {
    id: 'TRADINGVIEW',
    name: 'TradingView',
    supportsOAuth: false,
    portalUrl: 'https://www.tradingview.com/chart/',
    developerPortalUrl: 'https://www.tradingview.com/support/solutions/43000529348-about-webhooks/',
    requiredEnvVars: ['TRADINGVIEW_WEBHOOK_SECRET'],
    isEnvConfigured: () => Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET),
  },
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOAuthCallbackPage(payload: {
  ok: boolean;
  brokerId: string;
  brokerName: string;
  message: string;
  connectedAt?: string;
}): string {
  const safePayloadJson = JSON.stringify({
    type: payload.ok ? 'BROKER_OAUTH_SUCCESS' : 'BROKER_OAUTH_ERROR',
    brokerId: payload.brokerId,
    brokerName: payload.brokerName,
    message: payload.message,
    connectedAt: payload.connectedAt || new Date().toISOString(),
  }).replace(/</g, '\\u003c');

  const safeTitle = escapeHtml(
    payload.ok ? `${payload.brokerName} Connected` : `${payload.brokerName} Connection Failed`
  );
  const safeMsg = escapeHtml(payload.message);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle} · My Trade</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #08101e;
        color: #f1f5f9;
        padding: 24px;
      }
      .card {
        max-width: 440px;
        width: 100%;
        background: #0e182a;
        border: 1px solid ${payload.ok ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.4)'};
        border-radius: 16px;
        padding: 28px;
        text-align: center;
      }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 18px; }
      .badge {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 14px;
        background: ${payload.ok ? 'rgba(16, 185, 129, 0.14)' : 'rgba(244, 63, 94, 0.14)'};
        color: ${payload.ok ? '#34d399' : '#fb7185'};
      }
      button {
        background: #10b981;
        color: #fff;
        border: 0;
        border-radius: 8px;
        padding: 10px 18px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">${payload.ok ? 'CONNECTED' : 'ACTION REQUIRED'}</div>
      <h1>${safeTitle}</h1>
      <p>${safeMsg}</p>
      <button type="button" onclick="window.close()">Return to My Trade</button>
    </div>
    <script>
      (function () {
        var data = ${safePayloadJson};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(data, '*');
            setTimeout(function () { window.close(); }, 600);
          } else {
            setTimeout(function () { window.location.href = '/'; }, 1800);
          }
        } catch (e) {
          // User can click the Return button manually
        }
      })();
    </script>
  </body>
</html>`;
}

export function getAllBrokerReadiness(userId?: string): Record<string, boolean> {
  pruneExpiredOAuthState();
  const map: Record<string, boolean> = { PAPER_ENGINE: true };

  for (const spec of Object.values(BROKER_OAUTH_SPECS)) {
    const hasSession = Boolean(
      userId && activeSessions.has(`${userId}:${spec.id}`)
    );
    map[spec.id] = spec.isEnvConfigured() || hasSession;
  }

  return map;
}

export function getActiveBrokerOAuthSessionsForUser(userId: string) {
  pruneExpiredOAuthState();
  const out: Array<{
    brokerId: string;
    brokerName: string;
    connectedAt: string;
    expiresAt: string;
    method: 'OAUTH_SESSION';
    tokenPreview: string;
  }> = [];

  for (const session of activeSessions.values()) {
    if (session.userId === userId) {
      out.push({
        brokerId: session.brokerId,
        brokerName: session.brokerName,
        connectedAt: session.connectedAt,
        expiresAt: new Date(session.expiresAt).toISOString(),
        method: session.method,
        tokenPreview: session.tokenPreview,
      });
    }
  }
  return out;
}

export function registerBrokerOAuthRoutes(
  app: Express,
  verifyUser: (req: Request) => Promise<{ uid: string; email?: string; emailVerified: boolean } | null>
) {
  // List all broker OAuth/Env connection metadata for the current user
  app.get('/api/brokers/connections', async (req: Request, res: Response) => {
    const verifiedUser = await verifyUser(req);
    const userId = verifiedUser?.uid;
    const readiness = getAllBrokerReadiness(userId);
    const oauthSessions = userId ? getActiveBrokerOAuthSessionsForUser(userId) : [];

    const specs = Object.values(BROKER_OAUTH_SPECS).map((spec) => {
      const callbackUrl = getBrokerCallbackUrl(spec.id);
      const oauthAuthConfigured = Boolean(spec.supportsOAuth && spec.buildAuthUrl?.(callbackUrl, 'probe'));
      return {
        id: spec.id,
        name: spec.name,
        supportsOAuth: spec.supportsOAuth,
        oauthAuthConfigured,
        envConfigured: spec.isEnvConfigured(),
        connected: Boolean(readiness[spec.id]),
        callbackUrl,
        portalUrl: spec.portalUrl,
        developerPortalUrl: spec.developerPortalUrl,
        requiredEnvVars: spec.requiredEnvVars,
      };
    });

    res.json({
      appUrl: getCanonicalAppUrl(),
      brokers: readiness,
      oauthSessions,
      catalog: specs,
    });
  });

  // Construct external OAuth authorization URL (or return portal redirect metadata)
  app.get('/api/brokers/oauth/url/:brokerId', async (req: Request, res: Response) => {
    pruneExpiredOAuthState();
    const brokerId = String(req.params.brokerId || '').toUpperCase().trim();
    const spec = BROKER_OAUTH_SPECS[brokerId];
    if (!spec) {
      res.status(404).json({ error: `Unsupported trading app '${brokerId}'.` });
      return;
    }

    const verifiedUser = await verifyUser(req);
    const userId = verifiedUser?.uid || 'guest';
    const callbackUrl = getBrokerCallbackUrl(spec.id);
    const state = crypto.randomBytes(20).toString('hex');

    const authUrl = spec.supportsOAuth && spec.buildAuthUrl ? spec.buildAuthUrl(callbackUrl, state) : null;
    if (authUrl) {
      pendingStates.set(state, {
        brokerId: spec.id,
        userId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60_000,
      });
    }

    res.json({
      brokerId: spec.id,
      brokerName: spec.name,
      supportsOAuth: spec.supportsOAuth,
      oauthConfigured: Boolean(authUrl),
      url: authUrl || spec.portalUrl,
      authUrl,
      portalUrl: spec.portalUrl,
      developerPortalUrl: spec.developerPortalUrl,
      callbackUrl,
      requiredEnvVars: spec.requiredEnvVars,
    });
  });

  // Disconnect an active OAuth broker session for the authenticated user
  app.delete('/api/brokers/connections/:brokerId', async (req: Request, res: Response) => {
    const verifiedUser = await verifyUser(req);
    if (!verifiedUser) {
      res.status(401).json({ ok: false, error: 'Sign in required to manage broker OAuth sessions.' });
      return;
    }
    const brokerId = String(req.params.brokerId || '').toUpperCase().trim();
    const key = `${verifiedUser.uid}:${brokerId}`;
    const removed = activeSessions.delete(key);
    res.json({ ok: true, removed, brokerId });
  });

  // Universal OAuth callback route (handles both with and without trailing slash)
  const handleOAuthCallback = async (req: Request, res: Response) => {
    pruneExpiredOAuthState();
    const brokerId = String(req.params.brokerId || '').toUpperCase().trim();
    const spec = BROKER_OAUTH_SPECS[brokerId];
    if (!spec) {
      res
        .status(404)
        .type('text/html')
        .send(
          renderOAuthCallbackPage({
            ok: false,
            brokerId,
            brokerName: 'Trading App',
            message: 'Unknown broker callback route.',
          })
        );
      return;
    }

    const rawError =
      (typeof req.query.error_description === 'string' && req.query.error_description) ||
      (typeof req.query.error === 'string' && req.query.error) ||
      (typeof req.query.message === 'string' && req.query.status === 'error' ? req.query.message : '');

    if (rawError) {
      res
        .status(400)
        .type('text/html')
        .send(
          renderOAuthCallbackPage({
            ok: false,
            brokerId: spec.id,
            brokerName: spec.name,
            message: `Authorization was declined or failed: ${rawError.slice(0, 180)}`,
          })
        );
      return;
    }

    const authCode =
      (typeof req.query.code === 'string' && req.query.code.trim()) ||
      (typeof req.query.request_token === 'string' && req.query.request_token.trim()) ||
      (typeof req.query.auth_code === 'string' && req.query.auth_code.trim()) ||
      (typeof req.query.authCode === 'string' && req.query.authCode.trim()) ||
      (typeof req.query.RequestToken === 'string' && req.query.RequestToken.trim()) ||
      '';

    const stateParam =
      (typeof req.query.state === 'string' && req.query.state.trim()) ||
      (typeof req.query.State === 'string' && req.query.State.trim()) ||
      '';

    const pending = stateParam ? pendingStates.get(stateParam) : undefined;
    if (stateParam) {
      if (!pending || pending.brokerId !== spec.id) {
        res
          .status(400)
          .type('text/html')
          .send(
            renderOAuthCallbackPage({
              ok: false,
              brokerId: spec.id,
              brokerName: spec.name,
              message: 'OAuth session expired or invalid state token. Please restart the connection from My Trade.',
            })
          );
        return;
      }
      pendingStates.delete(stateParam);
    }

    if (!authCode) {
      res
        .status(400)
        .type('text/html')
        .send(
          renderOAuthCallbackPage({
            ok: false,
            brokerId: spec.id,
            brokerName: spec.name,
            message: 'No authorization code or request token was returned by the broker.',
          })
        );
      return;
    }

    try {
      const callbackUrl = getBrokerCallbackUrl(spec.id);
      let accessToken = authCode;
      let expiresInSec = 43_200;

      if (spec.exchangeCode) {
        const exchanged = await spec.exchangeCode({ code: authCode, callbackUrl });
        accessToken = exchanged.accessToken;
        if (exchanged.expiresInSec) {
          expiresInSec = exchanged.expiresInSec;
        }
      }

      const userId = pending?.userId || 'guest';
      const connectedAt = new Date().toISOString();
      const tokenPreview =
        accessToken.length >= 6
          ? `${accessToken.slice(0, 3)}•••${accessToken.slice(-3)}`
          : '••••••';

      activeSessions.set(`${userId}:${spec.id}`, {
        brokerId: spec.id,
        brokerName: spec.name,
        userId,
        connectedAt,
        expiresAt: Date.now() + expiresInSec * 1000,
        method: 'OAUTH_SESSION',
        tokenPreview,
        accessToken,
      });

      res
        .status(200)
        .type('text/html')
        .send(
          renderOAuthCallbackPage({
            ok: true,
            brokerId: spec.id,
            brokerName: spec.name,
            connectedAt,
            message: `${spec.name} authorized and securely connected to My Trade. This window will close automatically.`,
          })
        );
    } catch (err) {
      res
        .status(502)
        .type('text/html')
        .send(
          renderOAuthCallbackPage({
            ok: false,
            brokerId: spec.id,
            brokerName: spec.name,
            message:
              err instanceof Error
                ? err.message
                : `Unable to complete ${spec.name} token exchange.`,
          })
        );
    }
  };

  app.get(
    ['/auth/broker/callback/:brokerId', '/auth/broker/callback/:brokerId/'],
    handleOAuthCallback
  );
}
