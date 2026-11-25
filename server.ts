import 'dotenv/config';
import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  INSTRUMENTS,
  type LiveMarketNewsResponse,
  type MarketNewsCategory,
  type Timeframe,
} from './src/types/trading.ts';
import {
  fetchLiveMarketQuote,
  getInstrumentById,
  prewarmPriorityFeeds,
} from './server/marketData.ts';
import { attachBinanceWsHub } from './server/binanceWsHub.ts';
import { evaluatePineStrategyLive, runPineBacktest } from './server/pineEngine.ts';
import { evaluateMultiTimeframeStrategy } from './server/strategyEngine.ts';
import {
  analyzeUploadedChartWithGemini,
  chatWithTradingAssistant,
  enhanceLiveAnalysisWithGemini,
  normalizeGeminiError,
} from './server/geminiService.ts';
import { fetchFreeLiveMarketNews } from './server/newsService.ts';
import { getEconomicCalendarSnapshot } from './server/economicCalendarService.ts';
import {
  getGlobalMonitorStats,
  getMonitoredStatusForOwner,
  removeMonitoredPosition,
  startPositionMonitorWorker,
  syncMonitoredPositions,
} from './server/positionMonitorService.ts';
import {
  getAllBrokerReadiness,
  registerBrokerOAuthRoutes,
} from './server/brokerOAuth.ts';
import {
  BoundedTtlCache,
  SlidingWindowRateLimiter,
  isAuthorizedOperator,
  resolveAndValidateBridgeUrl,
  sanitizeConfig,
  validateExnessBridgeUrl,
  type VerifiedUserLike,
} from './server/securityGuards.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Tightened global JSON payload limit (8MB allows ~5MB base64 chart screenshot safely)
app.use(express.json({ limit: '8mb' }));

// Duplicate order guard cache (userId:signalId:side -> timestamp) with automatic TTL pruning
const recentOrderCache = new Map<string, number>();

function pruneRecentOrderCache(now = Date.now()) {
  for (const [k, ts] of recentOrderCache.entries()) {
    if (now - ts >= 60_000) {
      recentOrderCache.delete(k);
    }
  }
}

// Server-side kill-switch state per authenticated user (persisted safely in .data/)
const KILL_SWITCH_DIR = path.resolve(process.cwd(), '.data');
const KILL_SWITCH_FILE = path.join(KILL_SWITCH_DIR, 'kill-switches.json');
const serverKillSwitchByUser = new Map<string, boolean>();

function loadKillSwitchState() {
  try {
    if (!fs.existsSync(KILL_SWITCH_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(KILL_SWITCH_FILE, 'utf8')) as Record<string, boolean>;
    if (raw && typeof raw === 'object') {
      for (const [uid, active] of Object.entries(raw)) {
        if (typeof active === 'boolean') {
          serverKillSwitchByUser.set(uid, active);
        }
      }
    }
  } catch {
    // Ignore unreadable state file
  }
}

function saveKillSwitchState() {
  try {
    fs.mkdirSync(KILL_SWITCH_DIR, { recursive: true, mode: 0o700 });
    const obj: Record<string, boolean> = {};
    for (const [uid, active] of serverKillSwitchByUser.entries()) {
      obj[uid] = active;
    }
    const tmp = `${KILL_SWITCH_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, KILL_SWITCH_FILE);
  } catch {
    // Non-fatal in read-only filesystem
  }
}

loadKillSwitchState();

// Per-user rate limiter for AI, Pine, and execution routes
const rateLimiter = new SlidingWindowRateLimiter(2000);

function enforceRateLimit(
  req: Request,
  res: Response,
  bucketKey: string,
  limit: number,
  windowMs: number
): boolean {
  const verdict = rateLimiter.consume(bucketKey, limit, windowMs);
  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.retryAfterSec));
    res.status(429).json({
      error: `Rate limit exceeded. Please retry in ${verdict.retryAfterSec}s.`,
    });
    return false;
  }
  return true;
}

// Cryptographic Firebase Auth ID token verifier (uses Google's public X.509 certs, zero IAM needed)
interface VerifiedFirebaseUser extends VerifiedUserLike {
  uid: string;
  email?: string;
  emailVerified: boolean;
  isAdminClaim: boolean;
}

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedFirebaseProjectId: string | null = null;
let cachedFirebaseCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

function getFirebaseProjectId(): string {
  if (cachedFirebaseProjectId) return cachedFirebaseProjectId;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
    cachedFirebaseProjectId = raw.projectId || process.env.FIREBASE_PROJECT_ID || '';
  } catch {
    cachedFirebaseProjectId = process.env.FIREBASE_PROJECT_ID || '';
  }
  return cachedFirebaseProjectId;
}

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedFirebaseCerts && cachedFirebaseCerts.expiresAt > now) {
    return cachedFirebaseCerts.certs;
  }
  const res = await fetch(FIREBASE_CERTS_URL, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase auth certificates (HTTP ${res.status})`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) * 1000 : 3600_000;
  const certs = (await res.json()) as Record<string, string>;
  cachedFirebaseCerts = { certs, expiresAt: now + ttlMs };
  return certs;
}

async function verifyFirebaseRequestUser(req: Request): Promise<VerifiedFirebaseUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const projectId = getFirebaseProjectId();
    if (!projectId) return null;

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean;
      admin?: boolean;
      role?: string;
    };

    if (header.alg !== 'RS256' || !header.kid) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) return null;
    if (payload.aud !== projectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) return null;

    const certs = await getFirebasePublicCerts();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const signature = Buffer.from(parts[2], 'base64url');
    const signedData = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
    const verified = crypto.verify('RSA-SHA256', signedData, certPem, signature);
    if (!verified) return null;

    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      emailVerified: payload.email_verified === true,
      isAdminClaim: payload.admin === true || payload.role === 'admin',
    };
  } catch {
    return null;
  }
}

async function requireVerifiedUser(
  req: Request,
  res: Response,
  message = 'Verified Google Sign-In is required to access this endpoint.'
): Promise<VerifiedFirebaseUser | null> {
  const user = await verifyFirebaseRequestUser(req);
  if (!user || !user.emailVerified) {
    res.status(401).json({ error: message });
    return null;
  }
  return user;
}

async function requireOperator(
  req: Request,
  res: Response,
  message = 'Operator / account owner authorization is required for this live action.'
): Promise<VerifiedFirebaseUser | null> {
  const user = await verifyFirebaseRequestUser(req);
  if (!user || !user.emailVerified) {
    res.status(401).json({ error: 'Verified Google Sign-In is required.' });
    return null;
  }
  if (!isAuthorizedOperator(user)) {
    res.status(403).json({ error: message });
    return null;
  }
  return user;
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'My Trade', timestamp: new Date().toISOString() });
});

// Server-side per-user Kill Switch endpoint (source of truth for order execution guard)
app.get('/api/account/kill-switch', async (req: Request, res: Response) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  res.json({
    killSwitchActive: serverKillSwitchByUser.get(user.uid) === true,
  });
});

app.post('/api/account/kill-switch', async (req: Request, res: Response) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const active = Boolean(req.body?.killSwitchActive);
  serverKillSwitchByUser.set(user.uid, active);
  saveKillSwitchState();
  res.json({ ok: true, killSwitchActive: active });
});

// Serve static, server-configured Android Digital Asset Links ONLY (never reflect req.query)
app.get('/.well-known/assetlinks.json', (_req: Request, res: Response) => {
  const pkg = process.env.PLAYSTORE_PACKAGE_NAME?.trim() || 'com.mytrade.terminal';
  const sha =
    process.env.PLAYSTORE_SHA256_FINGERPRINT?.trim() ||
    '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00';

  res.type('application/json').json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: [sha],
      },
    },
  ]);
});

app.get('/MyTrade.apk', (_req: Request, res: Response) => {
  const candidates = [
    path.resolve(process.cwd(), 'public', 'MyTrade.apk'),
    path.resolve(process.cwd(), 'dist', 'MyTrade.apk'),
  ];
  const apkPath = candidates.find((p) => fs.existsSync(p));
  if (!apkPath) {
    res.status(404).json({ error: 'MyTrade.apk package not found on server.' });
    return;
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="MyTrade.apk"');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(apkPath);
});

// Bounded TTL cache (max 100 entries) preventing unbounded memory growth from arbitrary query strings
const liveNewsCache = new BoundedTtlCache<LiveMarketNewsResponse>(100);

app.get('/api/news/live', async (req: Request, res: Response) => {
  try {
    const rawCat = String(req.query.category || 'ALL').toUpperCase();
    const category: MarketNewsCategory = ['ALL', 'INDIAN', 'MCX', 'INTERNATIONAL'].includes(rawCat)
      ? (rawCat as MarketNewsCategory)
      : 'ALL';
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    const cacheKey = `${category}:${query.toLowerCase()}`;
    const existing = !forceRefresh ? liveNewsCache.get(cacheKey) : undefined;
    if (existing) {
      res.json({ ...existing, cached: true });
      return;
    }

    const news = await fetchFreeLiveMarketNews({ category, query });
    liveNewsCache.set(cacheKey, news, 90_000);
    res.json({ ...news, cached: false });
  } catch (err: any) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch live market news feeds.',
    });
  }
});

app.get('/api/calendar/economic', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const snapshot = await getEconomicCalendarSnapshot(forceRefresh);
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load economic calendar.',
    });
  }
});

// Cache Telegram bot usernames keyed by SHA-256 hash of token (never a single global string)
const telegramBotUsernameCache = new BoundedTtlCache<string>(16);

async function getTelegramBotUsername(token?: string): Promise<string | null> {
  if (!token) return null;
  const tokenKey = crypto.createHash('sha256').update(token).digest('hex');
  const cached = telegramBotUsernameCache.get(tokenKey);
  if (cached) return cached;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(6000),
    });
    const data = (await res.json()) as any;
    if (res.ok && data?.ok && data?.result?.username) {
      const username = `@${data.result.username}`;
      telegramBotUsernameCache.set(tokenKey, username, 60 * 60_000);
      return username;
    }
  } catch {
    // Ignore transient network errors
  }
  return null;
}

async function discoverTelegramChats(
  token: string
): Promise<{ id: string; title: string; type: string }[]> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=25`, {
      signal: AbortSignal.timeout(6000),
    });
    const data = (await res.json()) as any;
    if (!res.ok || !data?.ok || !Array.isArray(data.result)) return [];
    const seen = new Map<string, { id: string; title: string; type: string }>();
    for (const upd of data.result) {
      const chat =
        upd?.message?.chat ||
        upd?.channel_post?.chat ||
        upd?.my_chat_member?.chat ||
        upd?.edited_message?.chat;
      if (chat && chat.id !== undefined) {
        const id = String(chat.id);
        const title =
          chat.title ||
          (chat.username ? `@${chat.username}` : [chat.first_name, chat.last_name].filter(Boolean).join(' ')) ||
          id;
        seen.set(id, { id, title, type: String(chat.type || 'chat') });
      }
    }
    return Array.from(seen.values());
  } catch {
    return [];
  }
}

function isValidTelegramTarget(val?: unknown): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return /^-?\d{5,20}$/.test(trimmed) || /^@[a-zA-Z0-9_]{3,64}$/.test(trimmed);
}

function getBrokerReadinessMap(userId?: string): Record<string, boolean> {
  const validExnessUrl = Boolean(validateExnessBridgeUrl(process.env.EXNESS_BRIDGE_URL));
  const combined = getAllBrokerReadiness(userId);
  const exnessReady = Boolean(validExnessUrl && process.env.EXNESS_API_TOKEN);
  return {
    ...combined,
    PAPER_ENGINE: true,
    EXNESS: exnessReady,
    MT5: exnessReady,
  };
}

function hasAnyLiveBrokerConfigured(userId?: string): boolean {
  if (process.env.BROKER_API_KEY && process.env.BROKER_API_SECRET) return true;
  const map = getBrokerReadinessMap(userId);
  return Object.entries(map).some(([k, v]) => k !== 'PAPER_ENGINE' && v);
}

app.get('/api/brokers/status', async (req: Request, res: Response) => {
  const verifiedUser = await verifyFirebaseRequestUser(req);
  const uid = verifiedUser?.emailVerified ? verifiedUser.uid : undefined;
  res.json({
    brokers: getBrokerReadinessMap(uid),
    anyLiveBrokerConfigured: hasAnyLiveBrokerConfigured(uid),
  });
});

registerBrokerOAuthRoutes(app, verifyFirebaseRequestUser);

// Protect Exness bridge host, serverName, and accountMasked behind operator auth
app.get('/api/brokers/exness/status', async (req: Request, res: Response) => {
  const parsedUrl = validateExnessBridgeUrl(process.env.EXNESS_BRIDGE_URL);
  const hasToken = Boolean(process.env.EXNESS_API_TOKEN);
  const configured = Boolean(parsedUrl && hasToken);

  const verifiedUser = await verifyFirebaseRequestUser(req);
  if (!isAuthorizedOperator(verifiedUser)) {
    res.json({
      configured,
      bridgeUrlValid: Boolean(parsedUrl),
      bridgeHost: null,
      serverName: null,
      accountMasked: null,
    });
    return;
  }

  const rawAcc = process.env.EXNESS_ACCOUNT_ID?.trim() || '';
  const accountMasked =
    rawAcc.length >= 4 ? `${'*'.repeat(Math.max(2, rawAcc.length - 4))}${rawAcc.slice(-4)}` : null;

  res.json({
    configured,
    bridgeUrlValid: Boolean(parsedUrl),
    bridgeHost: parsedUrl ? parsedUrl.hostname : null,
    serverName: process.env.EXNESS_SERVER?.trim() || null,
    accountMasked,
  });
});

app.post('/api/brokers/exness/test', async (req: Request, res: Response) => {
  const operator = await requireOperator(
    req,
    res,
    'Only authorized workspace operators can test the live Exness MT5 Bridge.'
  );
  if (!operator) return;

  const parsedUrl = await resolveAndValidateBridgeUrl(process.env.EXNESS_BRIDGE_URL);
  const token = process.env.EXNESS_API_TOKEN?.trim();

  if (!parsedUrl || !token) {
    res.status(400).json({
      connected: false,
      message:
        'Exness MT5 Bridge is not configured or resolves to a restricted network. Add a public HTTPS EXNESS_BRIDGE_URL and EXNESS_API_TOKEN in server environment secrets.',
    });
    return;
  }

  try {
    const base = parsedUrl.toString().replace(/\/+$/, '');
    const healthRes = await fetch(`${base}/health`, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!healthRes.ok) {
      res.status(502).json({
        connected: false,
        message: `Exness MT5 Bridge responded with HTTP ${healthRes.status}. Verify your token and bridge /health route.`,
      });
      return;
    }

    const payload = (await healthRes.json().catch(() => ({}))) as Record<string, unknown>;
    res.json({
      connected: true,
      bridgeHost: parsedUrl.hostname,
      serverName:
        (typeof payload.server === 'string' && payload.server) ||
        process.env.EXNESS_SERVER?.trim() ||
        'Exness MT5 Bridge',
      balance: typeof payload.balance === 'number' ? payload.balance : undefined,
      currency: typeof payload.currency === 'string' ? payload.currency : 'USD',
      message: 'Connected to Exness MT5 Execution Bridge successfully.',
    });
  } catch (err) {
    res.status(502).json({
      connected: false,
      message:
        err instanceof Error
          ? `Could not reach Exness MT5 Bridge: ${err.message}`
          : 'Exness MT5 Bridge connection timed out.',
    });
  }
});

app.get('/api/integrations/status', async (_req: Request, res: Response) => {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const botUsername = await getTelegramBotUsername(tgToken);
  const hasChat = Boolean(process.env.TELEGRAM_CHAT_ID);
  res.json({
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    telegramConfigured: Boolean(tgToken),
    telegramChatConfigured: hasChat,
    telegramBotUsername: botUsername,
    twelveDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    brokerConfigured: hasAnyLiveBrokerConfigured(),
    publicFeedsActive: [
      'Binance Live Spot API',
      'Bybit Live Spot API',
      'Yahoo Live Feed',
      'Yahoo News & Market RSS',
      'Swissquote Spot',
    ],
  });
});

app.get('/api/market/quote', async (req: Request, res: Response) => {
  try {
    const instrumentId = String(req.query.instrument || 'NIFTY50');
    const tfRaw = String(req.query.timeframe || '5m');
    const timeframe: Timeframe = ['5m', '15m', '1h', '4h', '1d'].includes(tfRaw)
      ? (tfRaw as Timeframe)
      : '5m';
    const emaPeriods = {
      fast: Number(req.query.emaFast) || 9,
      mid: Number(req.query.emaMid) || 20,
      slow: Number(req.query.emaSlow) || 50,
      rsi: Number(req.query.rsiPeriod) || 14,
    };

    const quote = await fetchLiveMarketQuote(instrumentId, timeframe, emaPeriods, false);
    res.json(quote);
  } catch (err) {
    res.status(500).json({
      available: false,
      statusText: 'DATA UNAVAILABLE',
      unavailableReason: err instanceof Error ? err.message : 'Market data fetch failed',
    });
  }
});

app.get('/api/market/watchlist', async (req: Request, res: Response) => {
  try {
    const segment = req.query.segment ? String(req.query.segment).toUpperCase() : 'ALL';
    const tfRaw = String(req.query.timeframe || '15m');
    const timeframe: Timeframe = ['5m', '15m', '1h', '4h', '1d'].includes(tfRaw)
      ? (tfRaw as Timeframe)
      : '15m';

    const targetInstruments =
      segment === 'ALL'
        ? INSTRUMENTS
        : INSTRUMENTS.filter((item) => item.segment === segment);

    const quotes = await Promise.all(
      targetInstruments.map((inst) =>
        fetchLiveMarketQuote(inst.id, timeframe, { fast: 9, mid: 20, slow: 50, rsi: 14 }, true)
      )
    );

    res.json({
      fetchedAt: new Date().toISOString(),
      timeframe,
      items: quotes,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load market watchlist',
    });
  }
});

// Authenticated + rate-limited AI live analysis route
app.post('/api/ai/analyze-live', async (req: Request, res: Response) => {
  try {
    const user = await requireVerifiedUser(
      req,
      res,
      'Sign in with a verified account to run AI live market analysis.'
    );
    if (!user) return;
    if (!enforceRateLimit(req, res, `ai:analyze-live:${user.uid}`, 20, 60_000)) return;

    const instrumentId = String(req.body?.instrumentId || 'NIFTY50');
    const config = sanitizeConfig(req.body?.strategyConfig);
    const includeAiNarrative = req.body?.includeAiNarrative !== false;
    const instrument = getInstrumentById(instrumentId);

    const emaPeriods = {
      fast: config.emaFast,
      mid: config.emaMid,
      slow: config.emaSlow,
      rsi: config.rsiPeriod,
    };

    const [trendQuote, entryQuote] = await Promise.all([
      fetchLiveMarketQuote(instrument.id, config.trendTimeframe, emaPeriods),
      fetchLiveMarketQuote(instrument.id, config.entryTimeframe, emaPeriods),
    ]);

    if (!trendQuote.available || !entryQuote.available || !trendQuote.technicals || !entryQuote.technicals) {
      res.status(503).json({
        available: false,
        statusText: 'DATA UNAVAILABLE',
        error: `Live market data unavailable for ${instrument.symbol}. Cannot generate live signal without verified market feed.`,
        trendQuote,
        entryQuote,
      });
      return;
    }

    const baseSignal = evaluateMultiTimeframeStrategy({
      instrument,
      trendQuote,
      entryQuote,
      config,
    });

    if (includeAiNarrative && process.env.GEMINI_API_KEY) {
      try {
        baseSignal.aiNarrative = await enhanceLiveAnalysisWithGemini({
          instrument,
          trendQuote,
          entryQuote,
          baseSignal,
          config,
        });
      } catch (aiErr) {
        const normalized = normalizeGeminiError(aiErr);
        baseSignal.aiNarrative = `Quantitative multi-timeframe rule engine completed. (${normalized.message})`;
      }
    }

    res.json({
      available: true,
      trendQuote,
      entryQuote,
      signal: baseSignal,
    });
  } catch (err) {
    const normalized = normalizeGeminiError(err);
    res.status(normalized.status).json({ error: normalized.message });
  }
});

// Authenticated + rate-limited AI auto-scanner route
app.post('/api/ai/auto-scan', async (req: Request, res: Response) => {
  try {
    const user = await requireVerifiedUser(
      req,
      res,
      'Sign in with a verified account to run the automated market scanner.'
    );
    if (!user) return;
    if (!enforceRateLimit(req, res, `ai:auto-scan:${user.uid}`, 12, 60_000)) return;

    const requestedIds: string[] =
      Array.isArray(req.body?.instrumentIds) && req.body.instrumentIds.length > 0
        ? req.body.instrumentIds.map((x: unknown) => String(x)).slice(0, 10)
        : ['XAUUSD', 'NIFTY50', 'XAGUSD', 'BTCUSDT', 'MCX_CRUDEOIL'];

    const config = sanitizeConfig(req.body?.strategyConfig);
    const emaPeriods = {
      fast: config.emaFast,
      mid: config.emaMid,
      slow: config.emaSlow,
      rsi: config.rsiPeriod,
    };

    const results = await Promise.all(
      requestedIds.map(async (instId) => {
        const instrument = getInstrumentById(instId);
        try {
          const [trendQuote, entryQuote] = await Promise.all([
            fetchLiveMarketQuote(instrument.id, config.trendTimeframe, emaPeriods),
            fetchLiveMarketQuote(instrument.id, config.entryTimeframe, emaPeriods),
          ]);

          if (
            !trendQuote.available ||
            !entryQuote.available ||
            !trendQuote.technicals ||
            !entryQuote.technicals
          ) {
            return {
              instrument,
              quoteAvailable: false,
              price: null,
              changePercent: null,
              marketTimestamp: null,
              trend15m: 'UNAVAILABLE',
              trend5m: 'UNAVAILABLE',
              rsi5m: null,
              ema9: null,
              signal: null,
            };
          }

          const signal = evaluateMultiTimeframeStrategy({
            instrument,
            trendQuote,
            entryQuote,
            config,
          });

          return {
            instrument,
            quoteAvailable: true,
            price: entryQuote.price ?? null,
            changePercent: entryQuote.changePercent ?? 0,
            marketTimestamp: entryQuote.marketTimestamp,
            trend15m: trendQuote.technicals.trendBias,
            trend5m: entryQuote.technicals.trendBias,
            rsi5m: entryQuote.technicals.rsi,
            ema9: entryQuote.technicals.ema9,
            signal,
          };
        } catch {
          return {
            instrument,
            quoteAvailable: false,
            price: null,
            changePercent: null,
            marketTimestamp: null,
            trend15m: 'UNAVAILABLE',
            trend5m: 'UNAVAILABLE',
            rsi5m: null,
            ema9: null,
            signal: null,
          };
        }
      })
    );

    res.json({
      scannedAt: new Date().toISOString(),
      results,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Auto-scan failed',
    });
  }
});

app.post('/api/pine/backtest', async (req: Request, res: Response) => {
  try {
    const user = await requireVerifiedUser(
      req,
      res,
      'Sign in with a verified account to run Pine Script backtests.'
    );
    if (!user) return;
    if (!enforceRateLimit(req, res, `pine:backtest:${user.uid}`, 25, 60_000)) return;

    const {
      strategyName,
      instrumentId,
      timeframe,
      pineCode,
      quantity,
      initialCapital,
      stopLossPct,
      takeProfitPct,
      riskPerTradePct,
      trailingStop,
    } = req.body ?? {};

    if (!pineCode || typeof pineCode !== 'string' || pineCode.trim().length < 5) {
      res.status(400).json({ error: 'Valid Pine Script source code is required.' });
      return;
    }

    const tf: Timeframe = ['5m', '15m', '1h', '4h', '1d'].includes(timeframe)
      ? (timeframe as Timeframe)
      : '5m';

    const result = await runPineBacktest({
      strategyName: typeof strategyName === 'string' ? strategyName.slice(0, 100) : 'Pine Strategy',
      instrumentId: String(instrumentId || 'XAUUSD'),
      timeframe: tf,
      pineCode: pineCode.slice(0, 30_000),
      quantity: Number.isFinite(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 1,
      initialCapital:
        Number.isFinite(Number(initialCapital)) && Number(initialCapital) >= 100
          ? Number(initialCapital)
          : 100_000,
      stopLossPct:
        Number.isFinite(Number(stopLossPct)) && Number(stopLossPct) > 0 ? Number(stopLossPct) : 0.55,
      takeProfitPct:
        Number.isFinite(Number(takeProfitPct)) && Number(takeProfitPct) > 0
          ? Number(takeProfitPct)
          : 1.65,
      riskPerTradePct:
        riskPerTradePct !== undefined && Number.isFinite(Number(riskPerTradePct))
          ? Math.max(0, Math.min(10, Number(riskPerTradePct)))
          : 2.5,
      trailingStop: trailingStop !== false,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      available: false,
      error: err instanceof Error ? err.message : 'Pine backtest execution failed',
    });
  }
});

app.post('/api/pine/evaluate-live', async (req: Request, res: Response) => {
  try {
    const user = await requireVerifiedUser(
      req,
      res,
      'Sign in with a verified account to evaluate live Pine strategies.'
    );
    if (!user) return;
    if (!enforceRateLimit(req, res, `pine:eval:${user.uid}`, 30, 60_000)) return;

    const {
      strategyId,
      strategyName,
      instrumentId,
      timeframe,
      pineCode,
      stopLossPct,
      takeProfitPct,
    } = req.body ?? {};

    if (!pineCode || typeof pineCode !== 'string') {
      res.status(400).json({ error: 'Pine Script source code is required.' });
      return;
    }

    const tf: Timeframe = ['5m', '15m', '1h', '4h', '1d'].includes(timeframe)
      ? (timeframe as Timeframe)
      : '5m';

    const result = await evaluatePineStrategyLive({
      strategyId: String(strategyId || 'custom').slice(0, 128),
      strategyName: typeof strategyName === 'string' ? strategyName.slice(0, 100) : 'Pine Bot',
      instrumentId: String(instrumentId || 'XAUUSD'),
      timeframe: tf,
      pineCode: pineCode.slice(0, 30_000),
      stopLossPct:
        Number.isFinite(Number(stopLossPct)) && Number(stopLossPct) > 0 ? Number(stopLossPct) : 0.6,
      takeProfitPct:
        Number.isFinite(Number(takeProfitPct)) && Number(takeProfitPct) > 0
          ? Number(takeProfitPct)
          : 1.2,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      available: false,
      error: err instanceof Error ? err.message : 'Live Pine evaluation failed',
    });
  }
});

const MAX_IMAGE_BASE64_CHARS = 7_000_000; // ~5 MB binary image

// Authenticated + rate-limited + payload-capped AI chart screenshot analyzer
app.post('/api/ai/analyze-chart', async (req: Request, res: Response) => {
  try {
    const user = await requireVerifiedUser(
      req,
      res,
      'Sign in with a verified account to inspect chart screenshots with AI.'
    );
    if (!user) return;
    if (!enforceRateLimit(req, res, `ai:analyze-chart:${user.uid}`, 10, 60_000)) return;

    const { imageBase64, mimeType, instrumentId, timeframe, currentPrice, optionType, expiry, strategyConfig } =
      req.body ?? {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: 'Chart screenshot image is required.' });
      return;
    }
    if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
      res.status(413).json({ error: 'Chart screenshot exceeds 5 MB upload limit.' });
      return;
    }
    const safeMime =
      typeof mimeType === 'string' && /^image\/(png|jpeg|jpg|webp)$/i.test(mimeType)
        ? mimeType
        : 'image/png';

    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in server environment secrets.',
      });
      return;
    }

    const instrument = getInstrumentById(String(instrumentId || 'NIFTY50'));
    const config = sanitizeConfig(strategyConfig);
    const parsedCurrentPrice =
      currentPrice !== undefined && Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0
        ? Number(currentPrice)
        : undefined;

    const signal = await analyzeUploadedChartWithGemini({
      imageBase64,
      mimeType: safeMime,
      instrument,
      timeframe: typeof timeframe === 'string' ? timeframe.slice(0, 12) : '5m',
      currentPrice: parsedCurrentPrice,
      optionType: ['SPOT_FUT', 'CE', 'PE'].includes(optionType) ? optionType : 'SPOT_FUT',
      expiry: typeof expiry === 'string' ? expiry.slice(0, 40) : undefined,
      config,
    });

    res.json({ signal });
  } catch (err) {
    const normalized = normalizeGeminiError(err);
    res.status(normalized.status).json({ error: normalized.message });
  }
});

// Authenticated + rate-limited AI trading assistant chat route
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const user = await requireVerifiedUser(
      req,
      res,
      'Sign in with a verified account to use the AI Trading Assistant.'
    );
    if (!user) return;
    if (!enforceRateLimit(req, res, `ai:chat:${user.uid}`, 20, 60_000)) return;

    const { message, history, instrumentId, imageBase64, mimeType, strategyConfig } = req.body ?? {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Message text is required.' });
      return;
    }
    if (typeof imageBase64 === 'string' && imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
      res.status(413).json({ error: 'Attached chart image exceeds 5 MB upload limit.' });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in server environment secrets.',
      });
      return;
    }

    const instrument = getInstrumentById(String(instrumentId || 'NIFTY50'));
    const config = sanitizeConfig(strategyConfig);
    const emaPeriods = {
      fast: config.emaFast,
      mid: config.emaMid,
      slow: config.emaSlow,
      rsi: config.rsiPeriod,
    };

    const [trendQuote, entryQuote] = await Promise.all([
      fetchLiveMarketQuote(instrument.id, config.trendTimeframe, emaPeriods).catch(() => null),
      fetchLiveMarketQuote(instrument.id, config.entryTimeframe, emaPeriods).catch(() => null),
    ]);

    const safeMime =
      typeof mimeType === 'string' && /^image\/(png|jpeg|jpg|webp)$/i.test(mimeType)
        ? mimeType
        : 'image/png';

    const reply = await chatWithTradingAssistant({
      message: message.slice(0, 4000),
      history: Array.isArray(history) ? history.slice(-10) : [],
      instrument,
      trendQuote,
      entryQuote,
      imageBase64: typeof imageBase64 === 'string' ? imageBase64 : undefined,
      mimeType: imageBase64 ? safeMime : undefined,
      config,
    });

    res.json({
      reply,
      marketContextUsed: Boolean(trendQuote?.available && entryQuote?.available),
      marketTimestamp: entryQuote?.marketTimestamp ?? null,
    });
  } catch (err) {
    const normalized = normalizeGeminiError(err);
    res.status(normalized.status).json({ error: normalized.message });
  }
});

// Operator-authorized Telegram chat discovery (prevents arbitrary verified users reading bot updates)
app.get('/api/telegram/chats', async (req: Request, res: Response) => {
  const operator = await requireOperator(
    req,
    res,
    'Only authorized workspace operators can inspect server Telegram bot chats.'
  );
  if (!operator) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    res.json({ botConfigured: false, botUsername: null, chats: [] });
    return;
  }
  const [botUsername, chats] = await Promise.all([
    getTelegramBotUsername(token),
    discoverTelegramChats(token),
  ]);
  res.json({
    botConfigured: true,
    botUsername,
    defaultEnvChatConfigured: Boolean(process.env.TELEGRAM_CHAT_ID),
    chats,
  });
});

// Operator-authorized + rate-limited Telegram broadcast endpoint
app.post('/api/telegram/send', async (req: Request, res: Response) => {
  try {
    const operator = await requireOperator(
      req,
      res,
      'Only authorized workspace operators can send alerts through the server Telegram bot.'
    );
    if (!operator) return;
    if (!enforceRateLimit(req, res, `tg:send:${operator.uid}`, 15, 60_000)) return;

    const { messageText, chatId: requestedChatId } = req.body ?? {};
    if (!messageText || typeof messageText !== 'string' || !messageText.trim()) {
      res.status(400).json({ error: 'messageText is required.' });
      return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      res.json({
        deliveryStatus: 'NOT_CONFIGURED',
        statusDetail:
          'TELEGRAM_BOT_TOKEN is not configured on the server. Broadcast logged locally; copy message for manual posting.',
      });
      return;
    }

    let targetChatId: string | undefined = isValidTelegramTarget(requestedChatId)
      ? requestedChatId.trim()
      : process.env.TELEGRAM_CHAT_ID?.trim();

    if (!targetChatId) {
      const discovered = await discoverTelegramChats(token);
      if (discovered.length > 0) {
        targetChatId = discovered[discovered.length - 1].id;
      }
    }

    if (!targetChatId) {
      const botUsername = await getTelegramBotUsername(token);
      res.json({
        deliveryStatus: 'NOT_CONFIGURED',
        statusDetail: `Telegram bot ${botUsername || 'token'} is active, but no destination Chat/Channel ID is linked yet. Send /start to ${botUsername || 'your bot'} in Telegram (or add it to your channel) and click Detect Chat, or enter your @channel / Chat ID.`,
      });
      return;
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: messageText.slice(0, 4096),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const tgJson = (await tgRes.json()) as any;
    if (!tgRes.ok || !tgJson?.ok) {
      res.json({
        deliveryStatus: 'FAILED',
        statusDetail: tgJson?.description || `Telegram API returned HTTP ${tgRes.status}`,
      });
      return;
    }

    res.json({
      deliveryStatus: 'SENT',
      statusDetail: `Telegram message_id ${tgJson.result?.message_id ?? 'ok'} delivered to ${targetChatId}.`,
    });
  } catch (err) {
    res.json({
      deliveryStatus: 'FAILED',
      statusDetail: err instanceof Error ? err.message : 'Telegram request failed',
    });
  }
});

// Authenticated order execution with server-side kill-switch, operator LIVE check, and strict finite numeric validation
app.post('/api/orders/execute', async (req: Request, res: Response) => {
  try {
    const verifiedUser = await requireVerifiedUser(
      req,
      res,
      'Verified Google Sign-In is required before executing orders.'
    );
    if (!verifiedUser) return;
    if (!enforceRateLimit(req, res, `orders:exec:${verifiedUser.uid}`, 20, 60_000)) return;

    const {
      signalId,
      instrument,
      contract,
      expiry,
      quantity,
      orderType,
      side,
      entryPrice,
      stopLoss,
      targetPrice,
      target2,
      target3,
      executionMode,
      brokerName,
      userConfirmed,
      killSwitchActive,
    } = req.body ?? {};

    // Enforce server-side kill switch state (cannot be bypassed by sending killSwitchActive: false)
    const serverKillActive = serverKillSwitchByUser.get(verifiedUser.uid) === true;
    if (serverKillActive || killSwitchActive === true) {
      res.status(403).json({
        status: 'KILLED',
        error: 'Emergency Kill Switch is ACTIVE. All order execution is halted.',
      });
      return;
    }

    if (userConfirmed !== true) {
      res.status(400).json({
        status: 'REJECTED',
        error: 'Explicit user confirmation is mandatory before placing any order.',
      });
      return;
    }

    const qtyNum = Number(quantity);
    const entryNum = Number(entryPrice);
    const slNum = stopLoss !== undefined ? Number(stopLoss) : 0;
    const tp1Num = targetPrice !== undefined ? Number(targetPrice) : 0;
    const tp2Num = target2 !== undefined && target2 !== null ? Number(target2) : undefined;
    const tp3Num = target3 !== undefined && target3 !== null ? Number(target3) : undefined;

    if (
      !instrument ||
      typeof instrument !== 'string' ||
      !contract ||
      typeof contract !== 'string' ||
      !['BUY', 'SELL'].includes(String(side)) ||
      !Number.isFinite(qtyNum) ||
      qtyNum <= 0 ||
      qtyNum > 1_000_000 ||
      !Number.isFinite(entryNum) ||
      entryNum <= 0 ||
      entryNum > 100_000_000 ||
      !Number.isFinite(slNum) ||
      slNum < 0 ||
      !Number.isFinite(tp1Num) ||
      tp1Num < 0 ||
      (tp2Num !== undefined && (!Number.isFinite(tp2Num) || tp2Num < 0)) ||
      (tp3Num !== undefined && (!Number.isFinite(tp3Num) || tp3Num < 0))
    ) {
      res.status(400).json({
        status: 'REJECTED',
        error:
          'Invalid order parameters: instrument, contract, BUY/SELL side, finite positive quantity and entryPrice, and non-negative SL/TP values are required.',
      });
      return;
    }

    const normalizedMode = executionMode === 'LIVE' ? 'LIVE' : 'PAPER';

    if (normalizedMode === 'LIVE' && !isAuthorizedOperator(verifiedUser)) {
      res.status(403).json({
        status: 'REJECTED',
        error:
          'Only authorized account operators can submit LIVE broker orders. Switch to Paper/Demo mode or configure ADMIN_ALLOWED_EMAILS.',
      });
      return;
    }

    pruneRecentOrderCache();
    const dedupKey = `${verifiedUser.uid}:${String(signalId || contract).slice(0, 80)}:${side}`;
    const lastOrderAt = recentOrderCache.get(dedupKey);
    if (lastOrderAt && Date.now() - lastOrderAt < 60_000) {
      res.status(409).json({
        status: 'REJECTED',
        error: 'Duplicate order blocked: identical signal & side was already submitted within the last 60 seconds.',
      });
      return;
    }

    if (normalizedMode === 'LIVE') {
      if (!hasAnyLiveBrokerConfigured(verifiedUser.uid)) {
        res.status(503).json({
          status: 'REJECTED',
          error:
            'No Live Broker / Exness MT5 Bridge credentials are configured on the server. Connect Exness MT5 Bridge via server secrets or switch to your Demo Account.',
        });
        return;
      }

      const exnessUrl = await resolveAndValidateBridgeUrl(process.env.EXNESS_BRIDGE_URL);
      const exnessToken = process.env.EXNESS_API_TOKEN?.trim();
      const brokerLabelStr = String(brokerName || 'Authorized Broker Adapter').slice(0, 80);
      const wantsExness =
        Boolean(exnessUrl && exnessToken) &&
        (brokerLabelStr.toLowerCase().includes('exness') || !process.env.BROKER_API_KEY);

      if (wantsExness && exnessUrl && exnessToken) {
        const base = exnessUrl.toString().replace(/\/+$/, '');
        const bridgeRes = await fetch(`${base}/orders`, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${exnessToken}`,
          },
          body: JSON.stringify({
            symbol: instrument.slice(0, 40),
            contract: contract.slice(0, 80),
            side: side === 'SELL' ? 'SELL' : 'BUY',
            orderType: ['MARKET', 'LIMIT', 'SL-M'].includes(String(orderType))
              ? String(orderType)
              : 'MARKET',
            volume: qtyNum,
            entryPrice: entryNum,
            stopLoss: slNum,
            tp1: tp1Num,
            tp2: tp2Num,
            tp3: tp3Num,
            accountId: process.env.EXNESS_ACCOUNT_ID?.trim() || undefined,
            server: process.env.EXNESS_SERVER?.trim() || undefined,
          }),
          signal: AbortSignal.timeout(8000),
        });

        const bridgeJson = (await bridgeRes.json().catch(() => ({}))) as Record<string, unknown>;
        if (!bridgeRes.ok) {
          res.status(502).json({
            status: 'REJECTED',
            error:
              (typeof bridgeJson.error === 'string' && bridgeJson.error) ||
              `Exness MT5 Bridge rejected live order (HTTP ${bridgeRes.status}).`,
          });
          return;
        }

        recentOrderCache.set(dedupKey, Date.now());
        const liveOrderId =
          (typeof bridgeJson.orderId === 'string' && bridgeJson.orderId) ||
          (typeof bridgeJson.ticket === 'number' && `EXN-${bridgeJson.ticket}`) ||
          `EXN-${Date.now().toString(36).toUpperCase()}`;

        res.json({
          status: 'SUBMITTED_LIVE',
          brokerOrderId: liveOrderId,
          brokerName: 'Exness MT5 Live Bridge',
          message: `Live order ${liveOrderId} transmitted to Exness MT5 (${side} ${qtyNum} ${contract}, SL ${slNum}, TP1 ${tp1Num}${tp2Num ? ` / TP2 ${tp2Num}` : ''}${tp3Num ? ` / TP3 ${tp3Num}` : ''}).`,
        });
        return;
      }

      res.status(501).json({
        status: 'REJECTED',
        error: `Direct automated live order transmission is currently enabled for the Exness MT5 Bridge. Configure EXNESS_BRIDGE_URL + EXNESS_API_TOKEN for live execution, or place ${brokerLabelStr} orders in Demo Paper mode.`,
      });
      return;
    }

    recentOrderCache.set(dedupKey, Date.now());
    const paperOrderId = `PAPER-${Date.now().toString(36).toUpperCase()}`;
    res.json({
      status: 'CONFIRMED_PAPER',
      brokerOrderId: paperOrderId,
      brokerName: String(brokerName || 'My Trade Paper Trading Engine').slice(0, 80),
      message: `Paper order ${paperOrderId} recorded for ${contract} (${side} ${qtyNum} qty, SL ${slNum}, TP1 ${tp1Num}${tp2Num ? ` · TP2 ${tp2Num}` : ''}${tp3Num ? ` · TP3 ${tp3Num}` : ''}${expiry ? `, Exp ${expiry}` : ''}).`,
    });
  } catch (err) {
    res.status(500).json({
      status: 'REJECTED',
      error: err instanceof Error ? err.message : 'Order execution error',
    });
  }
});

app.post('/api/orders/trail-sl', async (req: Request, res: Response) => {
  try {
    const operator = await requireOperator(
      req,
      res,
      'Only authorized workspace operators can modify live Stop-Loss orders.'
    );
    if (!operator) return;

    const { brokerOrderId, instrument, newStopLoss, tpStage } = req.body ?? {};
    const slNum = Number(newStopLoss);
    if (!brokerOrderId || typeof brokerOrderId !== 'string' || !Number.isFinite(slNum) || slNum <= 0) {
      res.status(400).json({ ok: false, error: 'brokerOrderId and positive finite newStopLoss are required.' });
      return;
    }

    const exnessUrl = await resolveAndValidateBridgeUrl(process.env.EXNESS_BRIDGE_URL);
    const exnessToken = process.env.EXNESS_API_TOKEN?.trim();
    if (!exnessUrl || !exnessToken) {
      res.json({ ok: false, skipped: true, reason: 'No live Exness MT5 bridge configured.' });
      return;
    }

    const base = exnessUrl.toString().replace(/\/+$/, '');
    const modRes = await fetch(`${base}/orders/modify-sl`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${exnessToken}`,
      },
      body: JSON.stringify({
        orderId: brokerOrderId.slice(0, 80),
        symbol: String(instrument || '').slice(0, 40),
        stopLoss: slNum,
        tpStage: Number.isFinite(Number(tpStage)) ? Number(tpStage) : 1,
      }),
      signal: AbortSignal.timeout(8000),
    });

    res.json({ ok: modRes.ok, status: modRes.status });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to trail SL on Exness bridge.',
    });
  }
});

// Position monitor routes strictly require verified Firebase Auth (eliminating guest sessionId IDOR)
app.post('/api/monitor/positions/sync', async (req: Request, res: Response) => {
  try {
    const verifiedUser = await requireVerifiedUser(
      req,
      res,
      'Verified Google Sign-In is required to sync positions to the 24/7 server monitor.'
    );
    if (!verifiedUser) return;

    const positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
    const hasLivePosition = positions.some((p: any) => p?.executionMode === 'LIVE');
    if (hasLivePosition && !isAuthorizedOperator(verifiedUser)) {
      res.status(403).json({
        ok: false,
        error: 'Operator authorization is required to register LIVE positions on the server monitor.',
      });
      return;
    }

    const ownerKey = `uid:${verifiedUser.uid}`;
    const sanitized = positions
      .filter((p: any) => p && typeof p.tradeId === 'string' && typeof p.instrumentId === 'string')
      .slice(0, 30)
      .map((p: any) => ({
        tradeId: String(p.tradeId).slice(0, 128),
        instrumentId: String(p.instrumentId).slice(0, 40),
        symbol: String(p.symbol || p.instrumentId).slice(0, 40),
        contract: String(p.contract || p.instrumentId).slice(0, 80),
        direction: p.direction === 'SELL' ? ('SELL' as const) : ('BUY' as const),
        executionMode:
          p.executionMode === 'LIVE' && isAuthorizedOperator(verifiedUser)
            ? ('LIVE' as const)
            : ('PAPER' as const),
        entryPrice: Number.isFinite(Number(p.entryPrice)) ? Math.max(0, Number(p.entryPrice)) : 0,
        stopLoss: Number.isFinite(Number(p.stopLoss)) ? Math.max(0, Number(p.stopLoss)) : 0,
        target1: Number.isFinite(Number(p.target1)) ? Math.max(0, Number(p.target1)) : 0,
        target2: Number.isFinite(Number(p.target2)) ? Math.max(0, Number(p.target2)) : 0,
        target3: Number.isFinite(Number(p.target3)) ? Math.max(0, Number(p.target3)) : 0,
        tpStage: ([0, 1, 2].includes(Number(p.tpStage)) ? Number(p.tpStage) : 0) as 0 | 1 | 2,
        quantity: Number.isFinite(Number(p.quantity)) && Number(p.quantity) > 0 ? Number(p.quantity) : 1,
        remainingQuantity:
          Number.isFinite(Number(p.remainingQuantity ?? p.quantity))
            ? Math.max(0, Number(p.remainingQuantity ?? p.quantity))
            : 0,
        partialRealizedPnl: Number.isFinite(Number(p.partialRealizedPnl))
          ? Number(p.partialRealizedPnl)
          : 0,
        enablePartialProfitBooking: p.enablePartialProfitBooking !== false,
        brokerOrderId: typeof p.brokerOrderId === 'string' ? p.brokerOrderId.slice(0, 80) : undefined,
      }));

    const result = syncMonitoredPositions(ownerKey, sanitized);
    res.json({
      ok: true,
      ...result,
      worker: getGlobalMonitorStats(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Position monitor sync failed.',
    });
  }
});

app.get('/api/monitor/positions', async (req: Request, res: Response) => {
  try {
    const verifiedUser = await requireVerifiedUser(
      req,
      res,
      'Verified Google Sign-In is required to read monitored positions.'
    );
    if (!verifiedUser) return;

    const ownerKey = `uid:${verifiedUser.uid}`;
    const status = getMonitoredStatusForOwner(ownerKey);
    res.json({
      ok: true,
      ...status,
      worker: getGlobalMonitorStats(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to read monitored positions.',
    });
  }
});

app.delete('/api/monitor/positions/:tradeId', async (req: Request, res: Response) => {
  const verifiedUser = await requireVerifiedUser(
    req,
    res,
    'Verified Google Sign-In is required to remove monitored positions.'
  );
  if (!verifiedUser) return;

  const ownerKey = `uid:${verifiedUser.uid}`;
  const removed = removeMonitoredPosition(ownerKey, String(req.params.tradeId || '').slice(0, 128));
  res.json({ ok: true, removed });
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  const httpServer = http.createServer(app);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req: Request, res: Response, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result?.code) {
          next();
          return;
        }
        const safeCode = result.code
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* Vite HMR WebSocket disabled in AI Studio runtime */'
          )
          .replace(
            'else throw new SendBeforeConnectError("send was called before connect");',
            'else return;'
          )
          .replace(
            'else throw new SendBeforeConnectError("invoke was called before connect");',
            'else return;'
          );
        res.type('application/javascript').send(safeCode);
      } catch {
        next();
      }
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Production build not found. Run npm run build.');
      }
    });
  }

  attachBinanceWsHub(httpServer);
  startPositionMonitorWorker();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`My Trade server + /ws/market + 24/7 SL Monitor listening on http://0.0.0.0:${PORT}`);
    void prewarmPriorityFeeds();
    const keepWarmTimer = setInterval(() => {
      void prewarmPriorityFeeds();
    }, 35_000);
    if (typeof keepWarmTimer.unref === 'function') {
      keepWarmTimer.unref();
    }
  });
}

startServer();
