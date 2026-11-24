import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Code2,
  Layers,
  Link2,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { AccountProfileSettings, MarketQuoteResponse } from '../types/trading';
import heroObsidianDeskImg from '../assets/images/hero_obsidian_desk_1795436083282.jpg';
import { ExnessGuidePanel } from './ExnessGuidePanel';
import { Sparkline } from './Sparkline';
import { useTheme } from '../lib/theme';

interface ClassicLandingPageProps {
  isSignedIn: boolean;
  userEmail: string;
  activeAccountType: 'LIVE' | 'DEMO';
  accountProfile: AccountProfileSettings;
  brokerProviderLabel: string;
  exnessConfigured: boolean;
  authLoading: boolean;
  authError: string | null;
  onDismissAuthError: () => void;
  onOpenLoginModal: (intent: 'LIVE' | 'DEMO' | 'GENERAL') => void;
  onSignOut: () => Promise<void>;
  onStartOnboarding: () => void;
  onEnterActualAccount: () => void;
  onEnterDemoAccount: () => void;
  onEnterTerminal: (instrumentId?: string) => void;
  onEnterAutoAnalyzer: () => void;
  onEnterPineBot: () => void;
  justCompletedMode: 'BROKER' | 'DEMO' | null;
  onDismissCompletedBanner: () => void;
}

interface TickerQuote {
  id: string;
  symbol: string;
  segment: 'INDIAN' | 'MCX' | 'INTERNATIONAL';
  currency: string;
  price: number;
  changePercent: number;
  exchangeLabel: string;
  sparkline: number[];
}

const DESK_GROUPS = [
  {
    id: 'INDIAN' as const,
    title: 'Indian Equities & Index F&O',
    subtitle: 'NSE · BSE · ATM Options & Bluechips',
    ids: ['NIFTY50', 'BANKNIFTY', 'SENSEX', 'RELIANCE', 'HDFCBANK'],
  },
  {
    id: 'MCX' as const,
    title: 'MCX & Global Commodities',
    subtitle: 'Gold · Silver · Crude Oil · Natural Gas',
    ids: ['MCX_GOLD', 'MCX_SILVER', 'MCX_CRUDEOIL', 'MCX_NATURALGAS'],
  },
  {
    id: 'INTERNATIONAL' as const,
    title: 'Global FX, Metals & Crypto',
    subtitle: 'Exness MT5 Compatible · 24/7 Streams',
    ids: ['XAUUSD', 'EURUSD', 'NAS100', 'BTCUSDT', 'ETHUSDT'],
  },
];

const PROOF_METRICS = [
  {
    value: '32 Markets',
    label: 'NSE, MCX, COMEX, FX & Crypto',
    detail: 'Live multi-desk quote routing',
  },
  {
    value: '30ms WS',
    label: 'Sub-Second Tick Ingestion',
    detail: 'Direct orderbook & candle streams',
  },
  {
    value: '40 / 30 / 30',
    label: '3-TP Stepped Profit Ladder',
    detail: 'Automated SL ratchet at TP1 & TP2',
  },
  {
    value: '24/7 Guard',
    label: 'Server-Side Risk & Trailing',
    detail: 'Daily drawdown cap + ±15m news shield',
  },
];

export const ClassicLandingPage: React.FC<ClassicLandingPageProps> = ({
  isSignedIn,
  userEmail,
  activeAccountType,
  brokerProviderLabel,
  exnessConfigured,
  authError,
  onDismissAuthError,
  onOpenLoginModal,
  onSignOut,
  onStartOnboarding,
  onEnterActualAccount,
  onEnterDemoAccount,
  onEnterTerminal,
  onEnterAutoAnalyzer,
  onEnterPineBot,
  justCompletedMode,
  onDismissCompletedBanner,
}) => {
  const { isDark, toggleTheme } = useTheme();
  const [quotes, setQuotes] = useState<Record<string, TickerQuote>>({});
  const [activeDesk, setActiveDesk] = useState<'INDIAN' | 'MCX' | 'INTERNATIONAL'>('INTERNATIONAL');
  const [heroImgError, setHeroImgError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch('/api/market/watchlist?timeframe=15m');
        if (!res.ok) return;
        const data = await res.json();
        const items = (data?.items || []) as MarketQuoteResponse[];
        const next: Record<string, TickerQuote> = {};
        for (const item of items) {
          if (item.available && typeof item.price === 'number') {
            next[item.instrument.id] = {
              id: item.instrument.id,
              symbol: item.instrument.symbol,
              segment: item.instrument.segment,
              currency: item.instrument.currency,
              price: item.price,
              changePercent: item.changePercent ?? 0,
              exchangeLabel: item.instrument.exchangeLabel,
              sparkline: Array.isArray(item.candles)
                ? item.candles.slice(-24).map((c) => c.close)
                : [],
            };
          }
        }
        if (active && Object.keys(next).length > 0) {
          setQuotes(next);
        }
      } catch {
        // Keep clean fallback state silently
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 25_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const currentGroup = DESK_GROUPS.find((g) => g.id === activeDesk) ?? DESK_GROUPS[2];
  const tapeIds = ['XAUUSD', 'NIFTY50', 'BTCUSDT', 'MCX_CRUDEOIL', 'NAS100', 'EURUSD'];
  const goldQuote = quotes['XAUUSD'];

  return (
    <div className="min-h-screen font-landing-body bg-[#F6F4EE] dark:bg-[#07090E] text-stone-900 dark:text-stone-100 flex flex-col selection:bg-emerald-600/20 selection:text-emerald-950 dark:selection:text-emerald-100">
      {/* 1. Strict 3-Zone Sticky Navigation Bar (Brand · 4 Single-Line Links · 1 Primary CTA) */}
      <header className="h-16 border-b border-stone-200/90 dark:border-white/[0.08] bg-[#F6F4EE]/92 dark:bg-[#07090E]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto h-full px-6 lg:px-10 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-landing-display text-xl font-bold tracking-[-0.03em] text-stone-950 dark:text-white whitespace-nowrap shrink-0"
          >
            My Trade
          </a>

          <nav className="hidden md:flex items-center gap-8 text-xs font-medium text-stone-600 dark:text-stone-400">
            <a
              href="#capabilities"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('capabilities')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="hover:text-stone-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Auto-Trade
            </a>
            <a
              href="#accounts"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('accounts')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="hover:text-stone-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Live &amp; Demo
            </a>
            <a
              href="#markets"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('markets')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="hover:text-stone-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Markets
            </a>
            <a
              href="#exness-api"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('exness-api')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="hover:text-stone-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Exness API
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onEnterDemoAccount}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white dark:bg-[#111622] hover:bg-stone-100 dark:hover:bg-[#171E2E] border border-stone-300 dark:border-white/[0.14] text-stone-900 dark:text-stone-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Wallet className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
              Demo Account
            </button>
            {isSignedIn ? (
              <button
                type="button"
                onClick={onEnterActualAccount}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-emerald-700 dark:bg-emerald-500 hover:bg-emerald-800 dark:hover:bg-emerald-400 text-white dark:text-stone-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                Actual Account
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenLoginModal('GENERAL')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-stone-950 dark:bg-emerald-500 hover:bg-stone-800 dark:hover:bg-emerald-400 text-white dark:text-stone-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Sign In
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Optional Status Banners */}
      {authError && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border-b border-rose-200 dark:border-rose-500/30 px-6 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between max-w-7xl mx-auto w-full">
          <span>{authError}</span>
          <button
            type="button"
            onClick={onDismissAuthError}
            className="text-rose-700 dark:text-rose-300 hover:text-stone-950 dark:hover:text-white ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {justCompletedMode && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border-b border-emerald-200 dark:border-emerald-500/30">
          <div className="max-w-7xl mx-auto px-6 lg:px-10 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>
                {justCompletedMode === 'BROKER'
                  ? `Actual Trading Account bound to ${brokerProviderLabel}. Ready to enter your isolated live desk.`
                  : 'Demo Trading Account configured with isolated paper balance. Ready to launch.'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={justCompletedMode === 'BROKER' ? onEnterActualAccount : onEnterDemoAccount}
                className="font-semibold text-stone-950 dark:text-white underline underline-offset-4 hover:text-emerald-700 dark:hover:text-emerald-300"
              >
                Enter {justCompletedMode === 'BROKER' ? 'Actual Account' : 'Demo Account'} →
              </button>
              <button
                type="button"
                onClick={onDismissCompletedBanner}
                className="text-stone-600 dark:text-stone-400 hover:text-stone-950 dark:hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Live Institutional Market Tape */}
      <div className="border-b border-stone-200/80 dark:border-white/[0.07] bg-white/80 dark:bg-[#0B0F17]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-2.5 flex items-center justify-between gap-6 overflow-x-auto text-xs font-landing-mono">
          <div className="flex items-center gap-7">
            {tapeIds.map((id) => {
              const q = quotes[id];
              if (!q) return null;
              const pos = q.changePercent >= 0;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onEnterTerminal(id)}
                  className="flex items-center gap-2 whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
                >
                  <span className="text-stone-500 dark:text-stone-400">{q.symbol}</span>
                  <span className="text-stone-950 dark:text-white font-semibold">
                    {q.currency}
                    {q.price.toLocaleString()}
                  </span>
                  <span
                    className={
                      pos
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }
                  >
                    {pos ? '+' : ''}
                    {q.changePercent.toFixed(2)}%
                  </span>
                </button>
              );
            })}
            {Object.keys(quotes).length === 0 && (
              <span className="text-stone-500 dark:text-stone-400">
                Connecting verified exchange feeds · NSE · MCX · COMEX · FX · Crypto
              </span>
            )}
          </div>
          <span className="hidden xl:inline text-[11px] text-stone-400 dark:text-stone-500 whitespace-nowrap shrink-0">
            Click any quote to launch chart
          </span>
        </div>
      </div>

      {/* 3. Architectural Editorial Hero Section (Obsidian Carbon + Ambient Illumination + Fine Grid) */}
      <section
        id="top"
        className="relative overflow-hidden border-b border-stone-200/90 dark:border-white/[0.08] landing-arch-grid"
      >
        <div className="landing-hero-glow">
          <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-14 pb-12 lg:pt-20 lg:pb-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
            {/* Left Editorial Proposition */}
            <div className="lg:col-span-6 flex flex-col justify-between space-y-8">
              <div className="space-y-6">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800 dark:text-emerald-400">
                  Institutional Execution Desk · 3-TP Stepped Trailing
                </div>

                <h1 className="font-landing-display tracking-[-0.025em] text-4xl sm:text-5xl lg:text-[3.55rem] font-semibold text-stone-950 dark:text-white tracking-tight leading-[1.06] text-balance">
                  Disciplined multi-asset execution with isolated live &amp; demo accounts.
                </h1>

                <p className="text-sm sm:text-base text-stone-600 dark:text-stone-300 leading-relaxed max-w-xl">
                  Trade XAUUSD, NIFTY 50, MCX Crude Oil, and Crypto on a full-bleed charting workspace with interactive Trendlines, Fibonacci retracements, Pine Script v5 automation, and automatic 3-target profit booking that ratchets your Stop Loss at every milestone.
                </p>

                {/* Primary & Secondary Action Pair */}
                <div className="flex flex-wrap items-center gap-3.5 pt-1">
                  <button
                    type="button"
                    onClick={onEnterActualAccount}
                    className="inline-flex items-center gap-2.5 px-6 py-3.5 text-sm font-semibold bg-emerald-700 dark:bg-emerald-500 hover:bg-emerald-800 dark:hover:bg-emerald-400 text-white dark:text-stone-950 rounded-xl transition-colors whitespace-nowrap"
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    {isSignedIn ? 'Open Actual Account (Live)' : 'Sign In — Actual Account'}
                  </button>

                  <button
                    type="button"
                    onClick={onEnterDemoAccount}
                    className="inline-flex items-center gap-2.5 px-6 py-3.5 text-sm font-semibold bg-white dark:bg-[#111622] hover:bg-stone-100 dark:hover:bg-[#171E2E] border border-stone-300 dark:border-white/[0.14] text-stone-950 dark:text-white rounded-xl transition-colors whitespace-nowrap"
                  >
                    <Wallet className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                    Launch Demo Account
                  </button>
                </div>
              </div>

              {/* Quiet Editorial Credentials / Auth Status Line */}
              <div className="pt-5 border-t border-stone-300/70 dark:border-white/[0.08] flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-600 dark:text-stone-400">
                {isSignedIn ? (
                  <>
                    <span>
                      Active session:{' '}
                      <strong className="text-stone-950 dark:text-white font-medium">{userEmail}</strong>
                    </span>
                    <span className="text-stone-400 dark:text-stone-600">·</span>
                    <button
                      type="button"
                      onClick={onStartOnboarding}
                      className="text-emerald-800 dark:text-emerald-400 hover:underline underline-offset-4 font-medium"
                    >
                      Account Setup
                    </button>
                    <span className="text-stone-400 dark:text-stone-600">·</span>
                    <button
                      type="button"
                      onClick={() => void onSignOut()}
                      className="hover:text-stone-950 dark:hover:text-white transition-colors"
                    >
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <span>Firebase Auth Protected</span>
                    <span className="text-stone-400 dark:text-stone-600">·</span>
                    <span>Server-Side Broker Signing</span>
                    <span className="text-stone-400 dark:text-stone-600">·</span>
                    <span>Exness MT5 Bridge Ready</span>
                  </>
                )}
              </div>
            </div>

            {/* Right Architectural Visual & Live 3-TP Ladder Showcase */}
            <div className="lg:col-span-6 flex flex-col">
              <div className="bg-[#0D1119] border border-stone-800/80 dark:border-white/[0.11] rounded-2xl overflow-hidden shadow-2xl flex flex-col flex-1">
                <div className="relative h-64 sm:h-80 bg-[#0A0E16]">
                  {!heroImgError ? (
                    <img
                      src={heroObsidianDeskImg}
                      alt="My Trade obsidian architectural trading desk"
                      referrerPolicy="no-referrer"
                      onError={() => setHeroImgError(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#0F1722] via-[#0A0E16] to-[#06090F]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0D1119] via-[#0D1119]/35 to-transparent" />
                  <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300 font-medium">
                        {goldQuote
                          ? `XAUUSD LIVE · $${goldQuote.price.toLocaleString()} (${goldQuote.changePercent >= 0 ? '+' : ''}${goldQuote.changePercent.toFixed(2)}%)`
                          : 'Automated Protection Architecture'}
                      </div>
                      <div className="font-landing-display tracking-[-0.025em] text-xl sm:text-2xl font-semibold text-white mt-0.5">
                        3-TP Stepped Trailing &amp; Fibonacci Charting
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onEnterTerminal()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/15 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
                    >
                      Open Terminal
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Crisp 3-Step Protection Readout */}
                <div className="p-5 sm:p-6 grid grid-cols-3 divide-x divide-white/[0.08] text-xs font-landing-mono bg-[#0D1119]">
                  <div className="pr-4 space-y-1">
                    <div className="text-[11px] text-stone-400 font-sans">Stage 01 · TP1 Hit</div>
                    <div className="text-sm font-semibold text-emerald-400">SL → Entry</div>
                    <div className="text-[11px] text-stone-500 font-sans">40% booked · Risk zero</div>
                  </div>
                  <div className="px-4 space-y-1">
                    <div className="text-[11px] text-stone-400 font-sans">Stage 02 · TP2 Hit</div>
                    <div className="text-sm font-semibold text-amber-400">SL → TP1</div>
                    <div className="text-[11px] text-stone-500 font-sans">30% booked · Gain locked</div>
                  </div>
                  <div className="pl-4 space-y-1">
                    <div className="text-[11px] text-stone-400 font-sans">Stage 03 · TP3 Hit</div>
                    <div className="text-sm font-semibold text-white">Full Exit</div>
                    <div className="text-[11px] text-stone-500 font-sans">Final 30% runner closed</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Full-Width 4-Column Institutional Proof Strip */}
          <div className="border-t border-stone-200/80 dark:border-white/[0.08] bg-white/75 dark:bg-[#0A0E16]/85 backdrop-blur-sm">
            <div className="max-w-7xl mx-auto px-6 lg:px-10 grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-stone-200/80 dark:divide-white/[0.08]">
              {PROOF_METRICS.map((m) => (
                <div key={m.value} className="py-5 lg:px-6 first:lg:pl-0 last:lg:pr-0 space-y-0.5">
                  <div className="font-landing-mono text-lg sm:text-xl font-bold text-stone-950 dark:text-white tracking-tight">
                    {m.value}
                  </div>
                  <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-400">
                    {m.label}
                  </div>
                  <div className="text-[11px] text-stone-500 dark:text-stone-400">{m.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 4. Asymmetric Editorial Capabilities Bento Grid (01–04) */}
      <section
        id="capabilities"
        className="max-w-7xl mx-auto px-6 lg:px-10 py-20 space-y-10 w-full"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-400">
              Execution Architecture
            </div>
            <h2 className="font-landing-display tracking-[-0.025em] text-3xl sm:text-4xl font-semibold text-stone-950 dark:text-white tracking-tight">
              Engineered for risk discipline, visual clarity, and speed.
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onEnterTerminal()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-400 hover:underline underline-offset-4"
          >
            Inspect Live Terminal
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* 01 Wide Marquee Card */}
          <div className="lg:col-span-7 bg-white dark:bg-[#0D1119] border border-stone-200/90 dark:border-white/[0.08] rounded-2xl p-7 flex flex-col justify-between gap-6 hover:border-emerald-600/40 dark:hover:border-emerald-500/35 transition-colors">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs font-landing-mono">
                <span className="text-stone-400 dark:text-stone-500">01.</span>
                <Bot className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
              </div>
              <h3 className="font-landing-display tracking-[-0.025em] text-2xl font-semibold text-stone-950 dark:text-white">
                3-TP Auto-Trade &amp; Partial Booking Engine
              </h3>
              <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed max-w-xl">
                Every auto-analyzed signal and Pine Script v5 bot entry calculates ADX trend regime, spread cost, and three institutional targets — banking 40% at TP1, 30% at TP2, and trailing Stop Loss automatically to protect realized gains.
              </p>
              <div className="grid grid-cols-3 gap-3 pt-2 font-landing-mono text-[11px]">
                <div className="p-3 rounded-xl bg-[#F6F4EE] dark:bg-[#07090E] border border-stone-200/80 dark:border-white/[0.07]">
                  <div className="text-stone-500 dark:text-stone-400">Entry Gate</div>
                  <div className="font-semibold text-stone-900 dark:text-white mt-0.5">
                    ADX &amp; News Shield
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F6F4EE] dark:bg-[#07090E] border border-stone-200/80 dark:border-white/[0.07]">
                  <div className="text-stone-500 dark:text-stone-400">Stop Ratchet</div>
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">
                    BE → TP1 Auto
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F6F4EE] dark:bg-[#07090E] border border-stone-200/80 dark:border-white/[0.07]">
                  <div className="text-stone-500 dark:text-stone-400">Monitor Loop</div>
                  <div className="font-semibold text-amber-700 dark:text-amber-400 mt-0.5">
                    24/7 Server Guard
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onEnterAutoAnalyzer}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-950 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors w-fit"
            >
              Open Auto-Analyzer
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 02 Focused Card */}
          <div className="lg:col-span-5 bg-white dark:bg-[#0D1119] border border-stone-200/90 dark:border-white/[0.08] rounded-2xl p-7 flex flex-col justify-between gap-6 hover:border-emerald-600/40 dark:hover:border-emerald-500/35 transition-colors">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs font-landing-mono">
                <span className="text-stone-400 dark:text-stone-500">02.</span>
                <Lock className="w-5 h-5 text-amber-700 dark:text-amber-400" />
              </div>
              <h3 className="font-landing-display tracking-[-0.025em] text-2xl font-semibold text-stone-950 dark:text-white">
                Strict Actual vs. Demo Isolation
              </h3>
              <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                Authenticated Actual Live accounts keep separate trade ledgers, equity curves, daily drawdown locks, and broker routes from your Demo sandbox. Live trades never silently fall back to paper fills.
              </p>
            </div>
            <button
              type="button"
              onClick={onStartOnboarding}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-950 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors w-fit"
            >
              Configure Account Mode
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 03 Focused Card */}
          <div className="lg:col-span-5 bg-white dark:bg-[#0D1119] border border-stone-200/90 dark:border-white/[0.08] rounded-2xl p-7 flex flex-col justify-between gap-6 hover:border-emerald-600/40 dark:hover:border-emerald-500/35 transition-colors">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs font-landing-mono">
                <span className="text-stone-400 dark:text-stone-500">03.</span>
                <Code2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
              </div>
              <h3 className="font-landing-display tracking-[-0.025em] text-2xl font-semibold text-stone-950 dark:text-white">
                Trendline, Fibonacci &amp; Pine v5 Studio
              </h3>
              <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                Draw persistent Trend Lines, Extended Rays, Fibonacci Retracements (with 61.8% Golden Pocket highlighting), and Supply/Demand zones across full-width Single or Dual MTF split charts alongside Pine Script v5 backtesting.
              </p>
            </div>
            <button
              type="button"
              onClick={onEnterPineBot}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-950 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors w-fit"
            >
              Launch Pine &amp; Chart Studio
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 04 Wide Marquee Card */}
          <div className="lg:col-span-7 bg-white dark:bg-[#0D1119] border border-stone-200/90 dark:border-white/[0.08] rounded-2xl p-7 flex flex-col justify-between gap-6 hover:border-emerald-600/40 dark:hover:border-emerald-500/35 transition-colors">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs font-landing-mono">
                <span className="text-stone-400 dark:text-stone-500">04.</span>
                <Link2 className="w-5 h-5 text-amber-700 dark:text-amber-400" />
              </div>
              <h3 className="font-landing-display tracking-[-0.025em] text-2xl font-semibold text-stone-950 dark:text-white">
                Encrypted Exness MT5 Live Bridge &amp; TradeZella Journal
              </h3>
              <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed max-w-xl">
                Connect your Exness Web or App MT5 account through a dedicated server-side HTTPS bridge with zero broker secrets exposed to the browser — paired with a calendar P&amp;L heatmap, R-multiple expectancy audit, and CSV export.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                document.getElementById('exness-api')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-950 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors w-fit"
            >
              Read Exness MT5 API Guide
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* 5. Side-by-Side Actual Account vs Demo Account Separation */}
      <section
        id="accounts"
        className="border-y border-stone-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0B0F17] w-full"
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 space-y-10">
          <div className="max-w-2xl space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-400">
              Account Separation
            </div>
            <h2 className="font-landing-display tracking-[-0.025em] text-3xl sm:text-4xl font-semibold text-stone-950 dark:text-white tracking-tight">
              Two isolated environments. Zero accidental cross-execution.
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Actual Trading Account */}
            <div className="bg-[#F6F4EE] dark:bg-[#0D1119] border border-emerald-700/30 dark:border-emerald-500/35 rounded-2xl p-8 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800 dark:text-emerald-400">
                    Actual Trading Account · LIVE
                  </span>
                  <span className="text-xs font-landing-mono text-stone-500 dark:text-stone-400">
                    {exnessConfigured ? 'Exness Bridge Verified' : 'Google Login Required'}
                  </span>
                </div>
                <h3 className="font-landing-display tracking-[-0.025em] text-2xl font-semibold text-stone-950 dark:text-white">
                  Live Broker &amp; Exness MT5 Execution
                </h3>
                <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                  Protected by Firebase Authentication. Tracks exclusively live broker orders, live equity balance, and server-side Exness MT5 / Indian broker routing — completely separated from Demo wallet funds.
                </p>
                <ul className="space-y-2.5 text-xs text-stone-700 dark:text-stone-300 pt-2">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    Dedicated live ledger, audit trail &amp; live Daily P&amp;L curve
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    Automatic broker SL modification hooks on TP1 &amp; TP2 hits
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    Strict live routing — never silently falls back to paper fills
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={onEnterActualAccount}
                className="w-full py-3.5 px-4 bg-emerald-700 dark:bg-emerald-500 hover:bg-emerald-800 dark:hover:bg-emerald-400 text-white dark:text-stone-950 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isSignedIn ? 'Enter Actual Live Account' : 'Sign In with Google for Actual Account'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Demo Practice Account */}
            <div className="bg-[#F6F4EE] dark:bg-[#0D1119] border border-stone-300 dark:border-white/[0.10] rounded-2xl p-8 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-400">
                    Demo Practice Account · PAPER
                  </span>
                  <span className="text-xs font-landing-mono text-stone-500 dark:text-stone-400">
                    100,000 Virtual Capital
                  </span>
                </div>
                <h3 className="font-landing-display tracking-[-0.025em] text-2xl font-semibold text-stone-950 dark:text-white">
                  Isolated Paper Sandbox &amp; Strategy Testing
                </h3>
                <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                  Validate 3-TP stepped trailing, multi-market Auto-Analyzer scans, and Pine Script v5 bots on live market bid/ask spreads with customizable deposits and instant resets — zero risk to live capital.
                </p>
                <ul className="space-y-2.5 text-xs text-stone-700 dark:text-stone-300 pt-2">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                    Dedicated demo wallet (deposit, withdraw, instant reset)
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                    Live mark-to-market 40/30/30 partial booking &amp; auto-trail
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                    100% air-gapped from live broker endpoints
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={onEnterDemoAccount}
                className="w-full py-3.5 px-4 bg-white dark:bg-[#141B29] hover:bg-stone-100 dark:hover:bg-[#1B2436] border border-stone-300 dark:border-white/[0.14] text-stone-950 dark:text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                Launch Demo Account
                <ArrowRight className="w-4 h-4 text-amber-700 dark:text-amber-400" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Live Markets Desk with Sparklines */}
      <section id="markets" className="max-w-7xl mx-auto px-6 lg:px-10 py-20 space-y-8 w-full">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-400">
              Live Market Coverage
            </div>
            <h2 className="font-landing-display tracking-[-0.025em] text-3xl sm:text-4xl font-semibold text-stone-950 dark:text-white tracking-tight">
              32 Instruments Across 3 Global Desks
            </h2>
          </div>

          <div className="flex items-center bg-white dark:bg-[#0D1119] border border-stone-200 dark:border-white/[0.10] rounded-xl p-1 text-xs">
            {DESK_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveDesk(g.id)}
                className={`px-4 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${
                  activeDesk === g.id
                    ? 'bg-emerald-700 dark:bg-emerald-500 text-white dark:text-stone-950 font-semibold'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-950 dark:hover:text-white'
                }`}
              >
                {g.id === 'INDIAN' ? 'India NSE' : g.id === 'MCX' ? 'MCX' : 'Global & Exness'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-[#0D1119] border border-stone-200/90 dark:border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-200/80 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-stone-950 dark:text-white">
                {currentGroup.title}
              </div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                {currentGroup.subtitle}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onEnterTerminal()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300"
            >
              Open Full Chart Terminal
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-stone-200/80 dark:divide-white/[0.06]">
            {currentGroup.ids.map((id) => {
              const q = quotes[id];
              const pos = (q?.changePercent ?? 0) >= 0;
              return (
                <div
                  key={id}
                  className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-[#F6F4EE]/70 dark:hover:bg-white/[0.03] transition-colors text-xs"
                >
                  <div>
                    <div className="font-semibold text-stone-950 dark:text-white">
                      {q?.symbol ?? id}
                    </div>
                    <div className="text-[11px] text-stone-500 dark:text-stone-400">
                      {q?.exchangeLabel ?? 'Live Feed'}
                    </div>
                  </div>
                  <div className="flex items-center gap-5 sm:gap-6 font-landing-mono">
                    <div className="hidden sm:flex items-center">
                      <Sparkline values={q?.sparkline ?? []} positive={pos} width={88} height={26} />
                    </div>
                    <div className="text-right min-w-[92px]">
                      <div className="text-sm font-semibold text-stone-950 dark:text-white">
                        {q ? `${q.currency}${q.price.toLocaleString()}` : 'Syncing...'}
                      </div>
                      {q && (
                        <div
                          className={`text-[11px] ${
                            pos
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {pos ? '+' : ''}
                          {q.changePercent.toFixed(2)}%
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onEnterTerminal(id)}
                      className="px-3.5 py-1.5 bg-[#F6F4EE] dark:bg-[#131926] hover:bg-stone-200 dark:hover:bg-[#1A2233] border border-stone-200 dark:border-white/[0.10] text-stone-900 dark:text-stone-100 rounded-lg font-sans font-medium whitespace-nowrap transition-colors"
                    >
                      Chart →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 7. Exness Web / App MT5 API Integration Section */}
      <section
        id="exness-api"
        className="border-t border-stone-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0B0F17] w-full"
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 space-y-8">
          <div className="max-w-2xl space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-400">
              Exness Live Connection Guide
            </div>
            <h2 className="font-landing-display tracking-[-0.025em] text-3xl sm:text-4xl font-semibold text-stone-950 dark:text-white tracking-tight">
              Connect your Exness Web or App account via MT5 API Bridge
            </h2>
          </div>

          <ExnessGuidePanel />
        </div>
      </section>

      {/* 8. Quiet Editorial Footer */}
      <footer className="border-t border-stone-200/90 dark:border-white/[0.08] bg-[#F6F4EE] dark:bg-[#07090E]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-10 flex flex-wrap items-center justify-between gap-4 text-xs text-stone-500 dark:text-stone-400">
          <div className="flex items-center gap-3">
            <span className="font-landing-display tracking-[-0.025em] text-base font-semibold text-stone-950 dark:text-white">
              My Trade
            </span>
            <span>·</span>
            <span>Multi-Asset Execution, Fibonacci Charting &amp; Exness MT5 Bridge</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-[#111622] hover:bg-stone-100 dark:hover:bg-[#171E2E] border border-stone-200 dark:border-white/[0.10] text-stone-800 dark:text-stone-200 rounded-lg transition-colors whitespace-nowrap"
            >
              {isDark ? (
                <Sun className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-emerald-700" />
              )}
              {isDark ? 'Alabaster Light' : 'Obsidian Dark'}
            </button>
            <TrendingUp className="w-3.5 h-3.5 text-stone-400" />
            <Layers className="w-3.5 h-3.5 text-stone-400" />
            <span>Trading involves market risk. Validate strategies on Demo first.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
