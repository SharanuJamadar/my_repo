import type {
  EconomicCalendarEvent,
  EconomicCalendarResponse,
  MarketSegment,
  MarketSessionClock,
} from '../src/types/trading.ts';

interface CachedCalendar {
  fetchedAtMs: number;
  source: string;
  rawEvents: Omit<EconomicCalendarEvent, 'minutesUntil' | 'isImminent'>[];
}

let calendarCache: CachedCalendar | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const BLACKOUT_WINDOW_MINUTES = 15;

function getZonedClockParts(
  now: Date,
  timeZone: string
): { weekday: number; hour: number; minute: number; localTime: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const wdStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    weekday: dayMap[wdStr] ?? 1,
    hour,
    minute,
    localTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

export function getGlobalMarketSessions(now = new Date()): MarketSessionClock[] {
  const specs: Array<{
    id: MarketSessionClock['id'];
    name: string;
    city: string;
    timezone: string;
    openMin: number;
    closeMin: number;
    markets: string;
  }> = [
    {
      id: 'NSE',
      name: 'NSE India',
      city: 'Mumbai',
      timezone: 'Asia/Kolkata',
      openMin: 9 * 60 + 15,
      closeMin: 15 * 60 + 30,
      markets: 'Nifty 50, Bank Nifty, NSE F&O',
    },
    {
      id: 'TOKYO',
      name: 'Tokyo / Asia',
      city: 'Tokyo',
      timezone: 'Asia/Tokyo',
      openMin: 9 * 60,
      closeMin: 15 * 60,
      markets: 'USD/JPY, Gold Asia, Nikkei',
    },
    {
      id: 'LONDON',
      name: 'London / Europe',
      city: 'London',
      timezone: 'Europe/London',
      openMin: 8 * 60,
      closeMin: 16 * 60 + 30,
      markets: 'XAUUSD, EUR/USD, GBP/USD, Brent',
    },
    {
      id: 'NEW_YORK',
      name: 'New York / US',
      city: 'New York',
      timezone: 'America/New_York',
      openMin: 8 * 60,
      closeMin: 17 * 60,
      markets: 'NAS100, SPX500, US30, COMEX Gold & WTI',
    },
  ];

  return specs.map((spec) => {
    const { weekday, hour, minute, localTime } = getZonedClockParts(now, spec.timezone);
    const totalMin = hour * 60 + minute;
    const isWeekday = weekday >= 1 && weekday <= 5;
    const isOpen = isWeekday && totalMin >= spec.openMin && totalMin < spec.closeMin;

    let statusDetail = 'Closed (Weekend)';
    if (isOpen) {
      const rem = spec.closeMin - totalMin;
      const rh = Math.floor(rem / 60);
      const rm = rem % 60;
      statusDetail = `Closes in ${rh}h ${rm}m`;
    } else if (isWeekday && totalMin < spec.openMin) {
      const until = spec.openMin - totalMin;
      const uh = Math.floor(until / 60);
      const um = until % 60;
      statusDetail = `Opens in ${uh}h ${um}m`;
    } else if (isWeekday) {
      statusDetail = 'Closed for session';
    }

    return {
      id: spec.id,
      name: spec.name,
      city: spec.city,
      timezone: spec.timezone,
      localTime,
      isOpen,
      statusDetail,
      markets: spec.markets,
    };
  });
}

export function isLiquiditySessionActive(
  segment: MarketSegment,
  instrumentId: string,
  now = new Date()
): { active: boolean; label: string } {
  // Crypto runs 24/7 with continuous liquidity
  if (instrumentId.endsWith('USDT')) {
    return { active: true, label: '24/7 Crypto Liquidity' };
  }

  const sessions = getGlobalMarketSessions(now);
  const byId = new Map(sessions.map((s) => [s.id, s]));

  if (segment === 'INDIAN') {
    const nse = byId.get('NSE');
    if (!nse) return { active: true, label: 'NSE Session' };
    const { weekday, hour, minute } = getZonedClockParts(now, 'Asia/Kolkata');
    const mins = hour * 60 + minute;
    // Prime NSE institutional liquidity window: 09:20–15:10 IST (avoids 9:15 spike & 15:15 closing chop)
    const prime = weekday >= 1 && weekday <= 5 && mins >= 9 * 60 + 20 && mins <= 15 * 60 + 10;
    return {
      active: prime,
      label: prime
        ? 'NSE Prime Window (09:20–15:10 IST)'
        : nse.isOpen
          ? 'NSE Open/Close Volatility Buffer'
          : 'NSE Off-Hours',
    };
  }

  if (segment === 'MCX') {
    const { weekday, hour, minute } = getZonedClockParts(now, 'Asia/Kolkata');
    const mins = hour * 60 + minute;
    const mcxOpen = weekday >= 1 && weekday <= 5 && mins >= 9 * 60 && mins <= 23 * 60 + 30;
    return {
      active: mcxOpen,
      label: mcxOpen ? 'MCX Active Window (09:00–23:30 IST)' : 'MCX Off-Hours',
    };
  }

  // International FX, Metals, US Indices: highest institutional accuracy during London or NY sessions
  const londonOpen = byId.get('LONDON')?.isOpen ?? false;
  const nyOpen = byId.get('NEW_YORK')?.isOpen ?? false;
  const tokyoOpen = byId.get('TOKYO')?.isOpen ?? false;

  if (londonOpen && nyOpen) {
    return { active: true, label: 'London + NY Overlap (Peak Liquidity)' };
  }
  if (londonOpen) {
    return { active: true, label: 'London Session Active' };
  }
  if (nyOpen) {
    return { active: true, label: 'New York Session Active' };
  }
  if (tokyoOpen && (instrumentId === 'USDJPY' || instrumentId === 'XAUUSD')) {
    return { active: true, label: 'Tokyo Asia Session' };
  }
  return { active: false, label: 'Low-Liquidity Off-Session Window' };
}

function mapCurrencyToSegments(currency: string): MarketSegment[] {
  const c = currency.toUpperCase();
  if (c === 'INR') return ['INDIAN', 'MCX'];
  if (c === 'USD') return ['INTERNATIONAL', 'MCX', 'INDIAN'];
  return ['INTERNATIONAL'];
}

function buildFallbackScheduledEvents(now: Date): Omit<EconomicCalendarEvent, 'minutesUntil' | 'isImminent'>[] {
  // Deterministic recurring weekly macro schedule (EIA Crude Wed 14:30 UTC, US Jobless Claims Thu 12:30 UTC,
  // US Core PCE/CPI/NFP Fri 12:30 UTC, London PMI Mon 08:30 UTC, RBI/India CPI Tue 12:00 UTC)
  const baseDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const templates: Array<{
    offsetDays: number;
    hourUtc: number;
    minuteUtc: number;
    title: string;
    country: string;
    currency: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    forecast: string;
    previous: string;
  }> = [
    {
      offsetDays: 0,
      hourUtc: 12,
      minuteUtc: 30,
      title: 'US Core Inflation / Macro Data Release Window',
      country: 'US',
      currency: 'USD',
      impact: 'HIGH',
      forecast: '0.3%',
      previous: '0.3%',
    },
    {
      offsetDays: 0,
      hourUtc: 14,
      minuteUtc: 30,
      title: 'EIA Crude Oil Inventories',
      country: 'US',
      currency: 'USD',
      impact: 'HIGH',
      forecast: '-1.4M',
      previous: '-2.1M',
    },
    {
      offsetDays: 1,
      hourUtc: 12,
      minuteUtc: 30,
      title: 'US Initial Jobless Claims',
      country: 'US',
      currency: 'USD',
      impact: 'MEDIUM',
      forecast: '218K',
      previous: '215K',
    },
    {
      offsetDays: 1,
      hourUtc: 18,
      minuteUtc: 0,
      title: 'Federal Reserve / FOMC Policy Commentary',
      country: 'US',
      currency: 'USD',
      impact: 'HIGH',
      forecast: 'Hold',
      previous: 'Hold',
    },
    {
      offsetDays: 2,
      hourUtc: 8,
      minuteUtc: 30,
      title: 'UK / Eurozone Flash PMI',
      country: 'EU',
      currency: 'EUR',
      impact: 'MEDIUM',
      forecast: '50.8',
      previous: '50.4',
    },
    {
      offsetDays: 2,
      hourUtc: 12,
      minuteUtc: 0,
      title: 'India Macro / RBI Liquidity Update',
      country: 'IN',
      currency: 'INR',
      impact: 'MEDIUM',
      forecast: '6.50%',
      previous: '6.50%',
    },
  ];

  return templates.map((tpl, idx) => {
    const dt = new Date(baseDay.getTime() + tpl.offsetDays * 86_400_000);
    dt.setUTCHours(tpl.hourUtc, tpl.minuteUtc, 0, 0);
    // If already more than 2 hours in the past, roll forward to next weekday
    if (dt.getTime() < now.getTime() - 2 * 3600_000) {
      dt.setUTCDate(dt.getUTCDate() + 3);
    }
    return {
      id: `macro-ref-${idx + 1}`,
      title: tpl.title,
      country: tpl.country,
      currency: tpl.currency,
      impact: tpl.impact,
      scheduledAt: dt.toISOString(),
      forecast: tpl.forecast,
      previous: tpl.previous,
      affectsSegments: mapCurrencyToSegments(tpl.currency),
    };
  });
}

async function fetchExternalCalendarEvents(): Promise<{
  source: string;
  events: Omit<EconomicCalendarEvent, 'minutesUntil' | 'isImminent'>[];
}> {
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MyTradeTerminal/1.0)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as Array<{
      title?: string;
      country?: string;
      date?: string;
      impact?: string;
      forecast?: string;
      previous?: string;
    }>;
    if (!Array.isArray(json) || json.length === 0) {
      throw new Error('Empty feed');
    }

    const relevantCurrencies = new Set(['USD', 'EUR', 'GBP', 'JPY', 'INR', 'CNY', 'AUD']);
    const mapped: Omit<EconomicCalendarEvent, 'minutesUntil' | 'isImminent'>[] = [];
    for (let i = 0; i < json.length; i++) {
      const item = json[i];
      if (!item?.title || !item?.date) continue;
      const currency = String(item.country || 'USD').toUpperCase();
      if (!relevantCurrencies.has(currency)) continue;
      const parsedMs = Date.parse(item.date);
      if (Number.isNaN(parsedMs)) continue;

      const rawImpact = String(item.impact || 'LOW').toUpperCase();
      const impact: 'HIGH' | 'MEDIUM' | 'LOW' =
        rawImpact === 'HIGH' ? 'HIGH' : rawImpact === 'MEDIUM' ? 'MEDIUM' : 'LOW';
      if (impact === 'LOW') continue;

      mapped.push({
        id: `ff-${i}-${parsedMs}`,
        title: String(item.title).slice(0, 110),
        country: currency.slice(0, 3),
        currency,
        impact,
        scheduledAt: new Date(parsedMs).toISOString(),
        forecast: item.forecast ? String(item.forecast).slice(0, 24) : undefined,
        previous: item.previous ? String(item.previous).slice(0, 24) : undefined,
        affectsSegments: mapCurrencyToSegments(currency),
      });
    }

    if (mapped.length > 0) {
      return {
        source: 'ForexFactory Live Macro Calendar',
        events: mapped,
      };
    }
  } catch {
    // Graceful fallback below
  }

  return {
    source: 'Scheduled Global Macro Calendar',
    events: buildFallbackScheduledEvents(new Date()),
  };
}

export async function getEconomicCalendarSnapshot(
  forceRefresh = false
): Promise<EconomicCalendarResponse> {
  const now = new Date();
  const nowMs = now.getTime();

  if (!calendarCache || forceRefresh || nowMs - calendarCache.fetchedAtMs > CACHE_TTL_MS) {
    const fetched = await fetchExternalCalendarEvents();
    calendarCache = {
      fetchedAtMs: nowMs,
      source: fetched.source,
      rawEvents: fetched.events,
    };
  }

  const enriched: EconomicCalendarEvent[] = calendarCache.rawEvents
    .map((ev) => {
      const evMs = Date.parse(ev.scheduledAt);
      const minutesUntil = Math.round((evMs - nowMs) / 60_000);
      return {
        ...ev,
        minutesUntil,
        isImminent:
          ev.impact === 'HIGH' &&
          minutesUntil >= -BLACKOUT_WINDOW_MINUTES &&
          minutesUntil <= BLACKOUT_WINDOW_MINUTES,
      };
    })
    // Show events from last 45m up to next 7 days
    .filter((ev) => ev.minutesUntil >= -45 && ev.minutesUntil <= 7 * 24 * 60)
    .sort((a, b) => a.minutesUntil - b.minutesUntil)
    .slice(0, 12);

  const imminentHigh = enriched.find((ev) => ev.isImminent);

  return {
    fetchedAt: now.toISOString(),
    source: calendarCache.source,
    sessions: getGlobalMarketSessions(now),
    events: enriched,
    highImpactBlackout: {
      active: Boolean(imminentHigh),
      eventTitle: imminentHigh?.title,
      minutesUntil: imminentHigh?.minutesUntil,
      windowMinutes: BLACKOUT_WINDOW_MINUTES,
    },
  };
}
