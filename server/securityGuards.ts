import dns from 'dns/promises';
import net from 'net';
import {
  DEFAULT_STRATEGY_CONFIG,
  type StrategyConfig,
} from '../src/types/trading.ts';

export interface VerifiedUserLike {
  uid: string;
  email?: string;
  emailVerified: boolean;
  isAdminClaim?: boolean;
}

const DEFAULT_OWNER_EMAIL = 'sharanu12131415@gmail.com';

export function getAllowedOperatorEmails(): Set<string> {
  const raw = process.env.ADMIN_ALLOWED_EMAILS?.trim();
  const emails = new Set<string>();
  if (raw) {
    for (const part of raw.split(',')) {
      const normalized = part.trim().toLowerCase();
      if (normalized && normalized.includes('@')) {
        emails.add(normalized);
      }
    }
  }
  if (emails.size === 0) {
    emails.add(DEFAULT_OWNER_EMAIL);
  }
  return emails;
}

/**
 * Checks whether a verified Firebase user is authorized to trigger sensitive
 * operator-level server actions (live Exness broker execution, Telegram bot
 * broadcasts/chat discovery, bridge inspection).
 */
export function isAuthorizedOperator(user: VerifiedUserLike | null | undefined): boolean {
  if (!user || !user.emailVerified) return false;
  if (user.isAdminClaim === true) return true;
  if (!user.email) return false;
  return getAllowedOperatorEmails().has(user.email.trim().toLowerCase());
}

/**
 * Safely parses a finite number within [min, max], preserving 0 when valid
 * and falling back cleanly when given NaN, Infinity, or non-numeric strings.
 */
export function finiteNumber(
  raw: unknown,
  fallback: number,
  min = -Infinity,
  max = Infinity
): number {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') {
    return fallback;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function sanitizeConfig(raw: any): StrategyConfig {
  return {
    userId: typeof raw?.userId === 'string' ? raw.userId.slice(0, 128) : 'default',
    emaFast: Math.round(finiteNumber(raw?.emaFast, DEFAULT_STRATEGY_CONFIG.emaFast, 2, 50)),
    emaMid: Math.round(finiteNumber(raw?.emaMid, DEFAULT_STRATEGY_CONFIG.emaMid, 5, 100)),
    emaSlow: Math.round(finiteNumber(raw?.emaSlow, DEFAULT_STRATEGY_CONFIG.emaSlow, 20, 200)),
    rsiPeriod: Math.round(finiteNumber(raw?.rsiPeriod, DEFAULT_STRATEGY_CONFIG.rsiPeriod, 5, 30)),
    rsiBullishMin: finiteNumber(raw?.rsiBullishMin, DEFAULT_STRATEGY_CONFIG.rsiBullishMin, 30, 80),
    rsiBearishMax: finiteNumber(raw?.rsiBearishMax, DEFAULT_STRATEGY_CONFIG.rsiBearishMax, 20, 70),
    trendTimeframe: ['15m', '1h', '4h'].includes(raw?.trendTimeframe)
      ? raw.trendTimeframe
      : DEFAULT_STRATEGY_CONFIG.trendTimeframe,
    entryTimeframe: ['5m', '15m'].includes(raw?.entryTimeframe)
      ? raw.entryTimeframe
      : DEFAULT_STRATEGY_CONFIG.entryTimeframe,
    minSetupScore: Math.round(
      finiteNumber(raw?.minSetupScore, DEFAULT_STRATEGY_CONFIG.minSetupScore, 40, 95)
    ),
    minRiskReward: finiteNumber(raw?.minRiskReward, DEFAULT_STRATEGY_CONFIG.minRiskReward, 1, 10),
    maxRiskPerTradePct: finiteNumber(
      raw?.maxRiskPerTradePct,
      DEFAULT_STRATEGY_CONFIG.maxRiskPerTradePct,
      0.25,
      10
    ),
    prioritizeAtmOptions:
      typeof raw?.prioritizeAtmOptions === 'boolean'
        ? raw.prioritizeAtmOptions
        : DEFAULT_STRATEGY_CONFIG.prioritizeAtmOptions,
    comexCrudeEma9Priority:
      typeof raw?.comexCrudeEma9Priority === 'boolean'
        ? raw.comexCrudeEma9Priority
        : DEFAULT_STRATEGY_CONFIG.comexCrudeEma9Priority,
    paperTradingOnly:
      typeof raw?.paperTradingOnly === 'boolean'
        ? raw.paperTradingOnly
        : DEFAULT_STRATEGY_CONFIG.paperTradingOnly,
    autoBroadcastTelegram:
      typeof raw?.autoBroadcastTelegram === 'boolean'
        ? raw.autoBroadcastTelegram
        : DEFAULT_STRATEGY_CONFIG.autoBroadcastTelegram,
    telegramChannelLabel:
      typeof raw?.telegramChannelLabel === 'string'
        ? raw.telegramChannelLabel.slice(0, 100)
        : DEFAULT_STRATEGY_CONFIG.telegramChannelLabel,
    dataProviderLabel:
      typeof raw?.dataProviderLabel === 'string'
        ? raw.dataProviderLabel.slice(0, 80)
        : DEFAULT_STRATEGY_CONFIG.dataProviderLabel,
    brokerProviderLabel:
      typeof raw?.brokerProviderLabel === 'string'
        ? raw.brokerProviderLabel.slice(0, 80)
        : DEFAULT_STRATEGY_CONFIG.brokerProviderLabel,
    killSwitchActive:
      typeof raw?.killSwitchActive === 'boolean'
        ? raw.killSwitchActive
        : DEFAULT_STRATEGY_CONFIG.killSwitchActive,
    activeInstruments: Array.isArray(raw?.activeInstruments)
      ? raw.activeInstruments
          .filter((item: unknown): item is string => typeof item === 'string')
          .slice(0, 50)
      : DEFAULT_STRATEGY_CONFIG.activeInstruments,
    adxMinThreshold: finiteNumber(
      raw?.adxMinThreshold,
      DEFAULT_STRATEGY_CONFIG.adxMinThreshold ?? 18,
      10,
      50
    ),
    enableSessionFilter:
      typeof raw?.enableSessionFilter === 'boolean'
        ? raw.enableSessionFilter
        : DEFAULT_STRATEGY_CONFIG.enableSessionFilter,
    pauseOnHighImpactNews:
      typeof raw?.pauseOnHighImpactNews === 'boolean'
        ? raw.pauseOnHighImpactNews
        : DEFAULT_STRATEGY_CONFIG.pauseOnHighImpactNews,
    enablePartialProfitBooking:
      typeof raw?.enablePartialProfitBooking === 'boolean'
        ? raw.enablePartialProfitBooking
        : DEFAULT_STRATEGY_CONFIG.enablePartialProfitBooking,
    dailyMaxLossPct: finiteNumber(
      raw?.dailyMaxLossPct,
      DEFAULT_STRATEGY_CONFIG.dailyMaxLossPct ?? 3,
      0.5,
      25
    ),
    dailyProfitTargetPct: finiteNumber(
      raw?.dailyProfitTargetPct,
      DEFAULT_STRATEGY_CONFIG.dailyProfitTargetPct ?? 6,
      1,
      50
    ),
  };
}

function isPrivateIpv4Octets(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((oct) => !Number.isInteger(oct) || oct < 0 || oct > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // Carrier-grade NAT (RFC 6598)
  if (a === 169 && b === 254) return true; // Link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

/**
 * Checks whether an IPv4 or IPv6 address (including IPv4-mapped IPv6 such as
 * ::ffff:127.0.0.1 or ::ffff:7f00:1) points to a private, loopback, link-local,
 * ULA, or metadata network.
 */
export function isBlockedIpAddress(ip: string): boolean {
  const clean = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const version = net.isIP(clean);
  if (version === 4) {
    const [a, b, c, d] = clean.split('.').map(Number);
    return isPrivateIpv4Octets(a, b, c, d);
  }
  if (version === 6) {
    if (clean === '::' || clean === '::1' || clean === '0:0:0:0:0:0:0:1' || clean === '0:0:0:0:0:0:0:0') {
      return true;
    }
    // IPv4-mapped IPv6 dotted form: ::ffff:127.0.0.1
    const mappedDotted = clean.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (mappedDotted) {
      return isPrivateIpv4Octets(
        Number(mappedDotted[1]),
        Number(mappedDotted[2]),
        Number(mappedDotted[3]),
        Number(mappedDotted[4])
      );
    }
    // IPv4-mapped IPv6 hex form: ::ffff:7f00:1
    const mappedHex = clean.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isPrivateIpv4Octets((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    }
    // Unique Local Addresses (fc00::/7) and Link-Local (fe80::/10) and Multicast (ff00::/8)
    const firstHextet = clean.split(':')[0] || '';
    if (/^f[cd][0-9a-f]{2}$/.test(firstHextet)) return true;
    if (/^fe[89ab][0-9a-f]$/.test(firstHextet)) return true;
    if (/^ff[0-9a-f]{2}$/.test(firstHextet)) return true;
    return false;
  }
  return false;
}

/**
 * Checks whether a hostname is a local/internal domain or blocked IP literal.
 * Does NOT falsely block public domains starting with "fc" or "fd" (e.g., fcm.googleapis.com).
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa') ||
    host === 'metadata.google.internal' ||
    host === 'metadata'
  ) {
    return true;
  }

  // If it's an IP literal (IPv4 or IPv6), check IP range rules directly
  if (net.isIP(host) !== 0) {
    return isBlockedIpAddress(host);
  }

  return false;
}

export function validateExnessBridgeUrl(rawUrl?: string): URL | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (isBlockedHostname(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Validates URL syntax + resolves DNS records to confirm EVERY resolved IP
 * is public (defending against DNS rebinding and IPv4-mapped IPv6 SSRF).
 */
export async function resolveAndValidateBridgeUrl(rawUrl?: string): Promise<URL | null> {
  const parsed = validateExnessBridgeUrl(rawUrl);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) !== 0) {
    return isBlockedIpAddress(host) ? null : parsed;
  }
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records || records.length === 0) return null;
    for (const rec of records) {
      if (isBlockedIpAddress(rec.address)) {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Bounded per-user sliding-window rate limiter to protect AI and execution endpoints.
 */
export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxKeys: number;

  constructor(maxKeys = 2000) {
    this.maxKeys = maxKeys;
  }

  consume(key: string, limit: number, windowMs: number, now = Date.now()): {
    allowed: boolean;
    retryAfterSec: number;
    remaining: number;
  } {
    const cutoff = now - windowMs;
    const prev = this.buckets.get(key) || [];
    const active = prev.filter((ts) => ts > cutoff);

    if (active.length >= limit) {
      this.buckets.set(key, active);
      const oldest = active[0] ?? now;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        remaining: 0,
      };
    }

    active.push(now);
    this.buckets.set(key, active);

    // Prevent unbounded memory growth
    if (this.buckets.size > this.maxKeys) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey !== undefined) {
        this.buckets.delete(oldestKey);
      }
    }

    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.max(0, limit - active.length),
    };
  }
}

/**
 * Bounded TTL cache (prevents memory exhaustion on user-controlled cache keys).
 */
export class BoundedTtlCache<V> {
  private readonly store = new Map<string, { expiresAt: number; value: V }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  get(key: string, now = Date.now()): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency (LRU)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number, now = Date.now()): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, { expiresAt: now + ttlMs, value });
    if (this.store.size > this.maxEntries) {
      for (const [k, entry] of this.store.entries()) {
        if (entry.expiresAt <= now) {
          this.store.delete(k);
        }
      }
      while (this.store.size > this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey === undefined) break;
        this.store.delete(oldestKey);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }
}
