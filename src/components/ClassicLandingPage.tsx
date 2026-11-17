import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  CandlestickChart,
  CheckCircle2,
  Cloud,
  Code2,
  Globe2,
  Layers,
  Link2,
  LogOut,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { AccountProfileSettings, MarketQuoteResponse } from '../types/trading';
import { ClassicCandleBackground } from './ClassicCandleBackground';

const HERO_DESK_IMG = '/src/assets/images/hero_trading_desk_1794903330673.jpg';
const MARKETS_GOLD_IMG = '/src/assets/images/markets_gold_bullion_1794903331732.jpg';

const STREAM_SYMBOL_TO_IDS: Record<string, string[]> = {
  XAUUSDT: ['XAUUSD', 'MCX_GOLD'],
  XAGUSDT: ['XAGUSD', 'MCX_SILVER'],
  BTCUSDT: ['BTCUSDT'],
  ETHUSDT: ['ETHUSDT'],
  SOLUSDT: ['SOLUSDT'],
  BNBUSDT: ['BNBUSDT'],
  XRPUSDT: ['XRPUSDT'],
};

interface ClassicLandingPageProps {
  isSignedIn: boolean;
  userEmail: string;
  accountProfile: AccountProfileSettings;
  brokerProviderLabel: string;
  authLoading: boolean;
  authError: string | null;
  onDismissAuthError: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onStartOnboarding: () => void;
  onEnterDashboard: () => void;
  onEnterTerminal: () => void;
  onEnterPineBot: () => void;
  justCompletedMode: 'BROKER' | 'DEMO' | null;
  onDismissCompletedBanner: () => void;
}

function formatPrice(val: number | undefined, currency: string): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return '—';
  const decimals = val < 10 ? 3 : val < 500 ? 2 : 2;
  return `${currency}${val.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export const ClassicLandingPage: React.FC<ClassicLandingPageProps> = ({
  isSignedIn,
  userEmail,
  accountProfile,
  brokerProviderLabel,
  authLoading,
  authError,
  onDismissAuthError,
  onSignIn,
  onSignOut,
  onStartOnboarding,
  onEnterDashboard,
  onEnterTerminal,
  onEnterPineBot,
  justCompletedMode,
  onDismissCompletedBanner,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [goldImgFailed, setGoldImgFailed] = useState(false);
  const [tapeQuotes, setTapeQuotes] = useState<MarketQuoteResponse[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const isOnboarded = accountProfile.onboardingCompleted;

  // Real live watchlist snapshot + 30ms WS price stream for the landing tape
  useEffect(() => {
    let active = true;

    const loadTape = async () => {
      try {
        const res = await fetch('/api/market/watchlist?timeframe=15m');
        if (!res.ok) return;
        const json = await res.json();
        if (active && Array.isArray(json.items)) {
          setTapeQuotes(json.items.filter((x: MarketQuoteResponse) => x.available && typeof x.price === 'number'));
        }
      } catch {
        // Silently keep current verified tape state
      }
    };

    void loadTape();
    const poll = window.setInterval(() => {
      void loadTape();
    }, 6000);

    let ws: WebSocket | null = null;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/market?instrument=ALL`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (!active) return;
        try {
          const payload = JSON.parse(event.data);
          const incomingTicks: { streamSymbol: string; price: number }[] =
            payload.type === 'snapshot' || payload.type === 'ticks'
              ? Array.isArray(payload.ticks)
                ? payload.ticks
                : []
              : [];
          if (incomingTicks.length === 0) return;

          setTapeQuotes((prev) => {
            if (prev.length === 0) return prev;
            const updates = new Map<string, number>();
            for (const t of incomingTicks) {
              const ids = STREAM_SYMBOL_TO_IDS[t.streamSymbol];
              if (ids && Number.isFinite(t.price)) {
                for (const id of ids) updates.set(id, t.price);
              }
            }
            if (updates.size === 0) return prev;
            return prev.map((item) => {
              const nextP = updates.get(item.instrument.id);
              if (nextP === undefined || nextP === item.price) return item;
              const prevClose = item.previousClose ?? item.open ?? item.price;
              const changePercent = prevClose ? ((nextP - prevClose) / prevClose) * 100 : item.changePercent;
              return { ...item, price: nextP, changePercent };
            });
          });
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          // ignore
        }
      };
    } catch {
      ws = null;
    }

    return () => {
      active = false;
      window.clearInterval(poll);
      try {
        ws?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, []);

  const easeClassic: [number, number, number, number] = [0.16, 1, 0.3, 1];

  const fadeUp = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 18 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.65, ease: easeClassic },
      };

  const handlePrimaryCta = () => {
    if (isOnboarded) {
      onEnterDashboard();
      return;
    }
    if (isSignedIn) {
      onStartOnboarding();
      return;
    }
    void onSignIn();
  };

  const tapeLoop = tapeQuotes.length > 0 ? [...tapeQuotes, ...tapeQuotes] : [];

  return (
    <div className="min-h-screen bg-[#090B0E] text-[#E6EDF3] flex flex-col selection:bg-[#C9A24D]/30 selection:text-white">
      {/* Top Bar Contract: 3 clean zones separated by gap-8 */}
      <header className="h-16 border-b border-white/[0.08] bg-[#090B0E]/95 backdrop-blur-md px-6 lg:px-10 flex items-center justify-between gap-8 sticky top-0 z-40">
        <a
          href="#top"
          className="font-classic-serif text-xl font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          SHARAN
        </a>

        <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-slate-400">
          <a href="#markets" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Markets
          </a>
          <a href="#methodology" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Methodology
          </a>
          <a href="#pine-bots" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Pine Bots
          </a>
          <a href="#brokers" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Brokers
          </a>
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={handlePrimaryCta}
            disabled={authLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#C9A24D] hover:bg-[#d8b462] text-[#090B0E] rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <span>
              {authLoading
                ? 'Connecting...'
                : isOnboarded
                  ? 'Enter Dashboard'
                  : isSignedIn
                    ? 'Complete Account Setup'
                    : 'Sign In'}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Post-Onboarding Confirmation Strip (when returning from Connect Broker / Create Demo Account) */}
      {justCompletedMode && (
        <div className="bg-emerald-500/10 border-b border-emerald-500/25 px-6 lg:px-10 py-3">
          <div className="max-w-[1280px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2.5 text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                {justCompletedMode === 'DEMO'
                  ? `Demo Account verified for ${accountProfile.displayName} (${accountProfile.mobileNumber} · ${accountProfile.email}). Your trading desk is unlocked.`
                  : `Trading App linked (${brokerProviderLabel}). Your institutional desk is ready.`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onEnterDashboard}
                className="px-3.5 py-1.5 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors whitespace-nowrap"
              >
                Enter Dashboard Now
              </button>
              <button
                type="button"
                onClick={onDismissCompletedBanner}
                className="text-slate-400 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {authError && (
        <div className="bg-red-500/10 border-b border-red-500/30 px-6 lg:px-10 py-2.5">
          <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs text-red-300">
            <span>{authError}</span>
            <button
              type="button"
              onClick={onDismissAuthError}
              className="text-red-200 hover:text-white ml-4"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Hero Section with Classic AI Moving Candle Background */}
      <section id="top" className="relative border-b border-white/[0.08] overflow-hidden">
        <ClassicCandleBackground className="absolute inset-0 z-0" />
        <div className="relative z-10 max-w-[1280px] mx-auto px-6 lg:px-10 pt-12 pb-14 lg:pt-16 lg:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            {/* Left Editorial Column */}
            <motion.div
              {...fadeUp}
              className="lg:col-span-6 flex flex-col justify-between space-y-8"
            >
              <div className="space-y-6">
                <div className="text-xs text-[#C9A24D] font-medium tracking-wide">
                  Indian Indices · MCX Commodities · Global FX &amp; Crypto
                </div>

                <h1
                  className="font-classic-serif font-semibold text-white tracking-tight text-balance"
                  style={{ fontSize: 'clamp(2.35rem, 4.1vw, 3.75rem)', lineHeight: 1.07 }}
                >
                  Disciplined precision across every market session.
                </h1>

                <p className="text-[15px] sm:text-base text-slate-300 leading-relaxed max-w-xl">
                  SHARAN combines institutional 15-minute trend confirmation with 5-minute entry
                  triggers, 30ms global price streams, custom Pine Script backtesting, and unified
                  broker routing in one focused trading terminal.
                </p>
              </div>

              <div className="space-y-5">
                {isOnboarded && (
                  <div className="border border-white/[0.08] bg-[#0E1218] rounded-lg px-4 py-3 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-white font-semibold">{accountProfile.displayName}</span>
                      <span className="mx-2 text-slate-500">·</span>
                      <span>
                        {accountProfile.accountMode === 'BROKER'
                          ? brokerProviderLabel
                          : `Demo Desk (${accountProfile.mobileNumber || accountProfile.email})`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={onStartOnboarding}
                      className="text-[#C9A24D] hover:text-[#e2be6c] font-medium underline underline-offset-4"
                    >
                      Switch Account Mode
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3.5">
                  {isOnboarded ? (
                    <>
                      <button
                        type="button"
                        onClick={onEnterDashboard}
                        className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#C9A24D] hover:bg-[#d8b462] text-[#090B0E] rounded-lg transition-all whitespace-nowrap shrink-0"
                      >
                        Enter Dashboard
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={onEnterTerminal}
                        className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium bg-[#12161E] hover:bg-[#191F2A] border border-white/[0.1] text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <CandlestickChart className="w-4 h-4 text-emerald-400" />
                        Open Live Terminal
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void onSignIn()}
                        disabled={authLoading}
                        className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#C9A24D] hover:bg-[#d8b462] text-[#090B0E] rounded-lg transition-all whitespace-nowrap shrink-0 disabled:opacity-60"
                      >
                        <Cloud className="w-4 h-4" />
                        {authLoading
                          ? 'Authenticating...'
                          : isSignedIn
                            ? 'Choose Trading or Demo Account'
                            : 'Login with Google & Setup'}
                      </button>
                      <button
                        type="button"
                        onClick={onStartOnboarding}
                        className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium bg-[#12161E] hover:bg-[#191F2A] border border-white/[0.1] text-slate-200 hover:text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        Connect App or Create Demo Account
                      </button>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                  <span>Supports Groww, Exness, Upstox, Zerodha, Dhan, Angel One &amp; Binance</span>
                  {isSignedIn && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-300">Signed in: {userEmail}</span>
                      <button
                        type="button"
                        onClick={() => void onSignOut()}
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-white underline underline-offset-4"
                      >
                        <LogOut className="w-3 h-3" />
                        Sign Out
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Right Visual Showcase Column */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.85, ease: easeClassic }}
              className="lg:col-span-6 relative min-h-[340px] lg:min-h-[430px] rounded-xl overflow-hidden border border-[#C9A24D]/25 bg-[#0E1218]"
            >
              {!heroImgFailed ? (
                <img
                  src={HERO_DESK_IMG}
                  alt="SHARAN Institutional Multi-Asset Trading Desk"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="w-full h-full object-cover object-center lg:h-full"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#121720] via-[#0B0E14] to-[#1A1610] flex items-center justify-center">
                  <CandlestickChart className="w-16 h-16 text-[#C9A24D]/60" />
                </div>
              )}

              {/* Measured readability scrim */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#090B0E] via-[#090B0E]/35 to-transparent pointer-events-none" />

              {/* Animated SVG Precision Trajectory Overlay */}
              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                <svg
                  viewBox="0 0 560 92"
                  className="w-full h-20 mb-2 overflow-visible"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="sharanEquityGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#C9A24D" stopOpacity="0.45" />
                      <stop offset="60%" stopColor="#10B981" stopOpacity="0.95" />
                      <stop offset="100%" stopColor="#34D399" stopOpacity="1" />
                    </linearGradient>
                  </defs>
                  {/* Subtle candlesticks along structure */}
                  {[
                    { x: 24, y1: 68, y2: 78, h: 6, up: true },
                    { x: 58, y1: 62, y2: 74, h: 7, up: true },
                    { x: 92, y1: 66, y2: 76, h: 5, up: false },
                    { x: 126, y1: 56, y2: 68, h: 8, up: true },
                    { x: 160, y1: 50, y2: 63, h: 8, up: true },
                    { x: 194, y1: 53, y2: 65, h: 6, up: false },
                    { x: 228, y1: 42, y2: 56, h: 9, up: true },
                    { x: 262, y1: 38, y2: 52, h: 8, up: true },
                    { x: 296, y1: 41, y2: 53, h: 6, up: false },
                    { x: 330, y1: 31, y2: 44, h: 9, up: true },
                    { x: 364, y1: 27, y2: 39, h: 8, up: true },
                    { x: 398, y1: 30, y2: 40, h: 5, up: false },
                    { x: 432, y1: 19, y2: 32, h: 9, up: true },
                    { x: 466, y1: 14, y2: 26, h: 8, up: true },
                    { x: 500, y1: 10, y2: 21, h: 7, up: true },
                  ].map((c, i) => (
                    <motion.g
                      key={i}
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.25 + i * 0.045, ease: easeClassic }}
                    >
                      <line
                        x1={c.x}
                        y1={c.y1 - 3}
                        x2={c.x}
                        y2={c.y2 + 3}
                        stroke={c.up ? '#10B981' : '#C9A24D'}
                        strokeOpacity="0.55"
                        strokeWidth="1.2"
                      />
                      <rect
                        x={c.x - 3}
                        y={c.y1}
                        width="6"
                        height={c.h}
                        rx="1"
                        fill={c.up ? '#10B981' : '#C9A24D'}
                        fillOpacity="0.82"
                      />
                    </motion.g>
                  ))}
                  <motion.path
                    d="M 14 75 C 90 71, 145 57, 210 52 C 275 47, 330 34, 405 28 C 460 23, 505 15, 544 10"
                    fill="none"
                    stroke="url(#sharanEquityGrad)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    initial={prefersReducedMotion ? false : { pathLength: 0, opacity: 0.3 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 1.5, ease: easeClassic }}
                  />
                </svg>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-t border-white/15 pt-3">
                  <span className="font-medium text-white">
                    15m Primary Structure · 5m Trigger Confluence
                  </span>
                  <span className="font-mono-tabular text-[#C9A24D]">
                    EMA 9 · EMA 20 · EMA 50 · VWAP · RSI · MACD
                  </span>
                </div>
              </div>
            </motion.div>
          </div>

          {/* 4-Column Quantitative Capabilities Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10 pt-8 border-t border-white/[0.08]">
            {[
              {
                metric: '30 ms',
                label: 'Binance Futures & Spot WebSocket Tick Cadence',
              },
              {
                metric: '32 Markets',
                label: 'NSE/BSE Stocks & Indices, MCX, US Indices, Major FX & Crypto',
              },
              {
                metric: '15m + 5m',
                label: 'Mandatory Multi-Timeframe Entry Verification',
              },
              {
                metric: 'Pine v5',
                label: 'Historical Backtester & Automated Live Bot Engine',
              },
            ].map((item, idx) => (
              <motion.div
                key={item.metric}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 + idx * 0.08, ease: easeClassic }}
                className="bg-[#0D1016] border border-white/[0.07] rounded-lg px-4 py-4"
              >
                <div className="font-mono-tabular text-xl sm:text-2xl font-semibold text-white">
                  {item.metric}
                </div>
                <div className="text-xs text-slate-400 mt-1 leading-snug">{item.label}</div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Continuous Real Market Tape */}
        <div className="relative z-10 border-t border-white/[0.08] bg-[#0B0E14]/95 backdrop-blur-sm py-3 overflow-hidden">
          {tapeLoop.length > 0 ? (
            <div className="flex w-max animate-ticker-marquee">
              {tapeLoop.map((q, i) => {
                const up = (q.changePercent ?? 0) >= 0;
                return (
                  <div
                    key={`${q.instrument.id}-${i}`}
                    className="flex items-center gap-3 px-6 border-r border-white/[0.06] text-xs whitespace-nowrap"
                  >
                    <span className="font-semibold text-white">{q.instrument.symbol}</span>
                    <span className="font-mono-tabular text-slate-200">
                      {formatPrice(q.price, q.instrument.currency)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-0.5 font-mono-tabular ${
                        up ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {up ? '+' : ''}
                      {(q.changePercent ?? 0).toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="max-w-[1280px] mx-auto px-6 lg:px-10 text-xs text-slate-400 font-mono-tabular">
              Connecting to live NSE, MCX, COMEX &amp; Binance exchange feeds...
            </div>
          )}
        </div>
      </section>

      {/* Core Capabilities (Asymmetric Bento Grid) */}
      <section id="methodology" className="max-w-[1280px] mx-auto w-full px-6 lg:px-10 py-16 lg:py-24">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: easeClassic }}
          className="max-w-2xl mb-12"
        >
          <div className="text-xs font-medium text-[#C9A24D] mb-2">Architecture &amp; Rules</div>
          <h2 className="font-classic-serif text-3xl sm:text-4xl font-semibold text-white tracking-tight text-balance">
            Built for traders who refuse unverified signals.
          </h2>
          <p className="text-sm sm:text-base text-slate-400 mt-3 leading-relaxed">
            Every trade plan generated inside SHARAN enforces structural support/resistance levels,
            validated risk-to-reward ratios, and real exchange market feeds.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Marquee Card 01 (col-span-2) */}
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.55, ease: easeClassic }}
            className="md:col-span-2 bg-[#0E1218] border border-white/[0.08] rounded-xl p-6 sm:p-8 flex flex-col justify-between gap-6"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono-tabular text-[#C9A24D]">01. Signal Engine</span>
                <BarChart3 className="w-4 h-4 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold text-white">
                Multi-Timeframe Trend &amp; Breakout Verification
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                Before suggesting any Call, Put, Long, or Short trigger, the engine evaluates the
                15-minute trend against EMA 9, EMA 20, EMA 50, VWAP, RSI, and MACD, then waits for
                5-minute volume-backed candle confirmation with explicit Stop-Loss and T1/T2/T3 targets.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-white/[0.06] text-xs">
              <div>
                <div className="text-slate-400">Indian F&amp;O Selection</div>
                <div className="text-white font-medium mt-0.5">ATM &amp; Near-ATM Priority</div>
              </div>
              <div>
                <div className="text-slate-400">Crude Oil / COMEX</div>
                <div className="text-white font-medium mt-0.5">EMA 9 Momentum Focus</div>
              </div>
              <div>
                <div className="text-slate-400">No-Trade Discipline</div>
                <div className="text-white font-medium mt-0.5">Auto-Blocks Chop Zones</div>
              </div>
            </div>
          </motion.div>

          {/* Card 02 */}
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.55, delay: 0.08, ease: easeClassic }}
            className="bg-[#0E1218] border border-white/[0.08] rounded-xl p-6 sm:p-8 flex flex-col justify-between gap-6"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono-tabular text-[#C9A24D]">02. Live Telemetry</span>
                <Activity className="w-4 h-4 text-[#C9A24D]" />
              </div>
              <h3 className="text-xl font-semibold text-white">30ms Live Market Streams</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Dedicated WebSocket hub relaying Binance Futures Gold (XAUUSDT) &amp; Silver
                (XAGUSDT) plus crypto spot books alongside fast NSE/BSE watchlist polling.
              </p>
            </div>
            <div className="text-xs text-emerald-400 font-medium pt-4 border-t border-white/[0.06]">
              Zero simulated fallback prices
            </div>
          </motion.div>

          {/* Card 03 (Pine Bots anchor) */}
          <motion.div
            id="pine-bots"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.55, delay: 0.12, ease: easeClassic }}
            className="bg-[#0E1218] border border-white/[0.08] rounded-xl p-6 sm:p-8 flex flex-col justify-between gap-6"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono-tabular text-[#C9A24D]">03. Automation</span>
                <Code2 className="w-4 h-4 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold text-white">Pine Script Chart &amp; Bot</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Import or author Pine v5 strategies, inspect indicator overlays and backtest equity
                curves on real candles, then run automated per-bar bot execution.
              </p>
            </div>
            {isOnboarded && (
              <button
                type="button"
                onClick={onEnterPineBot}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#C9A24D] hover:text-[#e2be6c] pt-4 border-t border-white/[0.06] w-full text-left"
              >
                Open Pine Strategy Studio
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </motion.div>

          {/* Card 04 (col-span-2 - Brokers) */}
          <motion.div
            id="brokers"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.55, delay: 0.16, ease: easeClassic }}
            className="md:col-span-2 bg-[#0E1218] border border-white/[0.08] rounded-xl p-6 sm:p-8 flex flex-col justify-between gap-6"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono-tabular text-[#C9A24D]">04. Execution &amp; Accounts</span>
                <Link2 className="w-4 h-4 text-sky-400" />
              </div>
              <h3 className="text-xl font-semibold text-white">
                Connect Your Trading App or Register an Isolated Demo Account
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                After signing in, choose between linking your preferred broker desk (Groww, Exness,
                Upstox, Zerodha Kite, Dhan, Angel One, Binance) or creating a personal Demo Account
                with verified contact details and custom paper capital.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-white/[0.06] text-xs text-slate-300 font-medium">
              <div>Groww &amp; Upstox</div>
              <div>Exness MT5</div>
              <div>Zerodha &amp; Dhan</div>
              <div>Binance &amp; Angel One</div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Multi-Asset Coverage Showcase */}
      <section id="markets" className="border-y border-white/[0.08] bg-[#0B0E14]">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-16 lg:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, ease: easeClassic }}
              className="lg:col-span-5 relative min-h-[300px] rounded-xl overflow-hidden border border-white/[0.08]"
            >
              {!goldImgFailed ? (
                <img
                  src={MARKETS_GOLD_IMG}
                  alt="Gold Bullion and Institutional Trading Instruments"
                  referrerPolicy="no-referrer"
                  onError={() => setGoldImgFailed(true)}
                  className="w-full h-full object-cover lg:h-full"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#17130C] to-[#0D1016] flex items-center justify-center">
                  <Globe2 className="w-14 h-14 text-[#C9A24D]/60" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#090B0E]/85 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-5 left-5 right-5 text-xs text-slate-200">
                <div className="font-semibold text-white">Cross-Exchange Price Discovery</div>
                <div className="text-slate-400 mt-0.5">
                  Synchronized spot, futures, and ATM option strike workflows.
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: 0.1, ease: easeClassic }}
              className="lg:col-span-7 flex flex-col justify-between space-y-6"
            >
              <div>
                <div className="text-xs font-medium text-[#C9A24D] mb-2">Covered Instruments</div>
                <h2 className="font-classic-serif text-3xl font-semibold text-white tracking-tight text-balance">
                  Three specialized market desks unified on one ledger.
                </h2>
              </div>

              <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
                <div className="py-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="font-semibold text-white">Indian Markets (13)</div>
                  <div className="sm:col-span-2 text-slate-300 leading-relaxed">
                    NIFTY 50, BANK NIFTY, FIN NIFTY, MIDCAP NIFTY, SENSEX, RELIANCE, HDFC BANK, ICICI BANK, SBIN, INFOSYS, TCS, BHARTI AIRTEL &amp; AXIS BANK
                  </div>
                </div>
                <div className="py-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="font-semibold text-white">MCX Commodities (5)</div>
                  <div className="sm:col-span-2 text-slate-300 leading-relaxed">
                    MCX GOLD, MCX SILVER, MCX CRUDE OIL (EMA 9 Momentum Priority), MCX NATURAL GAS &amp; MCX COPPER
                  </div>
                </div>
                <div className="py-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="font-semibold text-white">International Markets (14)</div>
                  <div className="sm:col-span-2 text-slate-300 leading-relaxed">
                    XAUUSD, XAGUSD, US CRUDE OIL, NASDAQ 100, S&amp;P 500, DOW JONES, EUR/USD, GBP/USD, USD/JPY, BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT &amp; XRPUSDT
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-400">
                <div className="flex items-start gap-2">
                  <Layers className="w-4 h-4 text-[#C9A24D] shrink-0 mt-0.5" />
                  <span>Visual Chart Upload AI inspects screenshots without fabricating levels</span>
                </div>
                <div className="flex items-start gap-2">
                  <Bot className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Auto-pilot scanner tracks XAUUSD, NIFTY50, XAGUSD, BTC &amp; Crude</span>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span>Emergency Kill Switch &amp; duplicate order lock enforced server-side</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Conversion Band */}
      <section className="max-w-[1280px] mx-auto w-full px-6 lg:px-10 py-16">
        <div className="bg-[#0E1218] border border-[#C9A24D]/25 rounded-xl p-8 lg:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <h2 className="font-classic-serif text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              {isOnboarded
                ? 'Your trading environment is configured.'
                : 'Choose your execution path after sign-in.'}
            </h2>
            <p className="text-sm text-slate-300">
              {isOnboarded
                ? 'Enter the Dashboard to review live positions, run automated market scans, or launch Pine Script bots.'
                : 'Log in to select between connecting your brokerage app or creating a personalized Demo Account with your mobile number and email.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handlePrimaryCta}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#C9A24D] hover:bg-[#d8b462] text-[#090B0E] rounded-lg transition-colors whitespace-nowrap"
            >
              {isOnboarded
                ? 'Enter Dashboard'
                : isSignedIn
                  ? 'Select Broker or Demo'
                  : 'Login & Choose Account'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Quiet Institutional Footer */}
      <footer className="mt-auto border-t border-white/[0.08] bg-[#090B0E] px-6 lg:px-10 py-8">
        <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span className="font-classic-serif text-sm font-semibold text-white">SHARAN</span>
            <span>Multi-Asset Trading &amp; Quantitative Research Terminal</span>
          </div>
          <div>
            Signals and backtests are analytical tools. Trade within disciplined intraday risk limits.
          </div>
        </div>
      </footer>
    </div>
  );
};
