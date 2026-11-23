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
import heroSwissDayImg from '../assets/images/hero_swiss_trading_desk_1795425555705.jpg';
import heroDeskDarkImg from '../assets/images/hero_trading_desk_1794903330673.jpg';
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

  return (
    <div className="min-h-screen bg-[#F4F6FA] dark:bg-[#08101E] text-slate-900 dark:text-slate-100 flex flex-col selection:bg-blue-700 dark:bg-sky-500/25 selection:text-slate-900 dark:text-white">
      {/* 1. Clean 3-Zone Sticky Top Navigation (Brand · 4 Nav Links · 1 Primary CTA) */}
      <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#08101E]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto h-full px-6 lg:px-10 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-classic-serif text-xl font-semibold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            My Trade
          </a>

          <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-slate-500 dark:text-slate-400">
            <a href="#capabilities" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Auto-Trade
            </a>
            <a href="#accounts" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Live &amp; Demo
            </a>
            <a href="#markets" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Markets
            </a>
            <a href="#exness-api" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Exness API
            </a>
          </nav>

          <div className="flex items-center gap-4 shrink-0">
            {isSignedIn ? (
              <button
                type="button"
                onClick={activeAccountType === 'LIVE' ? onEnterActualAccount : onEnterDemoAccount}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-blue-700 dark:bg-sky-500 hover:bg-blue-800 dark:hover:bg-sky-400 text-white dark:text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Open Workspace
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenLoginModal('GENERAL')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-blue-700 dark:bg-white hover:bg-blue-800 dark:hover:bg-slate-100 text-white dark:text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
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
          <button type="button" onClick={onDismissAuthError} className="text-rose-700 dark:text-rose-300 hover:text-slate-900 dark:hover:text-white ml-4">
            Dismiss
          </button>
        </div>
      )}

      {justCompletedMode && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border-b border-emerald-200 dark:border-emerald-500/30">
          <div className="max-w-7xl mx-auto px-6 lg:px-10 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
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
                className="font-semibold text-slate-900 dark:text-white underline underline-offset-4 hover:text-emerald-700 dark:hover:text-emerald-300"
              >
                Enter {justCompletedMode === 'BROKER' ? 'Actual Account' : 'Demo Account'} →
              </button>
              <button
                type="button"
                onClick={onDismissCompletedBanner}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Live Exchange Tape */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1424]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-2.5 flex items-center gap-6 overflow-x-auto text-xs font-mono-tabular">
          {tapeIds.map((id) => {
            const q = quotes[id];
            if (!q) return null;
            const pos = q.changePercent >= 0;
            return (
              <div key={id} className="flex items-center gap-2 whitespace-nowrap shrink-0">
                <span className="text-slate-500 dark:text-slate-400">{q.symbol}</span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {q.currency}
                  {q.price.toLocaleString()}
                </span>
                <span className={pos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}>
                  {pos ? '+' : ''}
                  {q.changePercent.toFixed(2)}%
                </span>
              </div>
            );
          })}
          {Object.keys(quotes).length === 0 && (
            <span className="text-slate-500">Connecting live exchange quotes · NSE · MCX · COMEX · Crypto</span>
          )}
        </div>
      </div>

      {/* 3. Hero Section — Clear Editorial Hierarchy & Direct Actual vs Demo Path */}
      <section id="top" className="relative overflow-hidden border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 space-y-6">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-blue-700 dark:text-sky-400">
              Multi-Asset Execution Terminal · 3-TP Stepped Trailing
            </div>

            <h1 className="font-classic-serif text-4xl sm:text-5xl lg:text-[3.35rem] font-semibold text-slate-900 dark:text-white tracking-tight leading-[1.08] text-balance">
              Precision automated trading with strict live &amp; demo isolation.
            </h1>

            <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 leading-relaxed max-w-xl">
              Execute multi-timeframe strategies and Pine Script v5 bots across XAUUSD, NIFTY 50, MCX Crude Oil, and Crypto — with automatic 3-target profit ladders that trail your Stop Loss at every TP milestone.
            </p>

            {/* Clear Dual Action Pair: Actual Account vs Demo Account */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onEnterActualAccount}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold bg-blue-700 dark:bg-sky-500 hover:bg-blue-800 dark:hover:bg-sky-400 text-white dark:text-slate-950 rounded-lg transition-colors whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                {isSignedIn ? 'Open Actual Account (Live)' : 'Sign In — Actual Account'}
              </button>

              <button
                type="button"
                onClick={onEnterDemoAccount}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold bg-white dark:bg-[#132038] hover:bg-slate-50 dark:hover:bg-[#1A2A47] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg transition-colors whitespace-nowrap"
              >
                <Wallet className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                Launch Demo Account
              </button>
            </div>

            {/* Quiet Account Status Line (Zero Pills) */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
              {isSignedIn ? (
                <>
                  <span>
                    Signed in: <strong className="text-slate-800 dark:text-slate-200 font-medium">{userEmail}</strong>
                  </span>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={onStartOnboarding}
                    className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white underline underline-offset-4"
                  >
                    Configure Account
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => void onSignOut()}
                    className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <span>Google Firebase Auth</span>
                  <span>·</span>
                  <span>Zero Broker Keys in Browser</span>
                  <span>·</span>
                  <span>Exness MT5 Bridge Ready</span>
                </>
              )}
            </div>
          </div>

          {/* Right: Clean Desk Visual + 3-TP Stepped Trailing Preview Card */}
          <div className="lg:col-span-6">
            <div className="bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-2xl overflow-hidden shadow-2xl">
              <div className="relative h-60 sm:h-72 bg-slate-100 dark:bg-[#0B1424]">
                {!heroImgError ? (
                  <img
                    src={isDark ? heroDeskDarkImg : heroSwissDayImg}
                    alt="My Trade institutional trading desk"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-50 via-slate-100 to-slate-200 dark:from-[#132038] dark:via-[#0B1424] dark:to-[#08101E]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent" />
                <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-sky-300 font-medium">
                      Automated Protection Logic
                    </div>
                    <div className="text-lg font-semibold text-white mt-0.5">
                      3-TP Stepped Stop-Loss Trailing
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onEnterTerminal()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-white hover:text-sky-300 transition-colors whitespace-nowrap"
                  >
                    Live Charts
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Crisp 3-Step Trailing Ladder Readout */}
              <div className="p-5 grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800 text-xs font-mono-tabular">
                <div className="pr-4 space-y-1">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">TP1 Reached</div>
                  <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">SL → Entry</div>
                  <div className="text-[11px] text-slate-500 font-sans">Breakeven locked</div>
                </div>
                <div className="px-4 space-y-1">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">TP2 Reached</div>
                  <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">SL → TP1</div>
                  <div className="text-[11px] text-slate-500 font-sans">Profit protected</div>
                </div>
                <div className="pl-4 space-y-1">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">TP3 Reached</div>
                  <div className="text-sm font-semibold text-blue-700 dark:text-sky-400">Book Full TP3</div>
                  <div className="text-[11px] text-slate-500 font-sans">3/3 target exit</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Capabilities Bento Grid */}
      <section id="capabilities" className="max-w-7xl mx-auto px-6 lg:px-10 py-20 space-y-10 w-full">
        <div className="max-w-2xl space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-blue-700 dark:text-sky-400">
            Execution Architecture
          </div>
          <h2 className="font-classic-serif text-3xl sm:text-4xl font-semibold text-slate-900 dark:text-white tracking-tight">
            Built for clarity, capital discipline, and speed.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              icon: Bot,
              accent: 'text-emerald-700 dark:text-emerald-400',
              title: '3-TP Auto-Trade Engine',
              body: 'Every auto-analyzed signal and Pine bot entry computes TP1, TP2, and TP3 automatically, ratcheting your Stop Loss upward after each TP range hits.',
              cta: 'Open Auto-Analyzer',
              action: onEnterAutoAnalyzer,
            },
            {
              icon: Lock,
              accent: 'text-blue-700 dark:text-sky-400',
              title: 'Actual vs. Demo Isolation',
              body: 'Authenticated Actual Live accounts maintain completely separate trade ledgers, P&L charts, and broker execution from your Demo practice sandbox.',
              cta: 'Choose Account Mode',
              action: onStartOnboarding,
            },
            {
              icon: Code2,
              accent: 'text-blue-700 dark:text-sky-400',
              title: 'Pine Script v5 & TradingView',
              body: 'Backtest EMA pullback, Supertrend, and ADX strategies over verified market candles with TradingView Pro charting, zoom controls, and equity curves.',
              cta: 'Launch Pine Studio',
              action: onEnterPineBot,
            },
            {
              icon: Link2,
              accent: 'text-emerald-700 dark:text-emerald-400',
              title: 'Exness MT5 Live Bridge',
              body: 'Connect your Exness Web & App MT5 account via an encrypted server-side HTTPS bridge with live connection verification and SL modification hooks.',
              cta: 'View Exness API Guide',
              action: () => {
                document.getElementById('exness-api')?.scrollIntoView({ behavior: 'smooth' });
              },
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col justify-between gap-6 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div className="space-y-3">
                  <Icon className={`w-5 h-5 ${item.accent}`} />
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">{item.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{item.body}</p>
                </div>
                <button
                  type="button"
                  onClick={item.action}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors w-fit"
                >
                  {item.cta}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5. Side-by-Side Actual Account vs Demo Account Separation */}
      <section id="accounts" className="border-y border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1424] w-full">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 space-y-10">
          <div className="max-w-2xl space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-blue-700 dark:text-sky-400">
              Account Separation
            </div>
            <h2 className="font-classic-serif text-3xl sm:text-4xl font-semibold text-slate-900 dark:text-white tracking-tight">
              Two clean environments. Zero accidental cross-execution.
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Actual Trading Account */}
            <div className="bg-white dark:bg-[#0E182A] border border-blue-200 dark:border-sky-500/35 rounded-2xl p-7 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-sky-400">
                    Actual Trading Account · LIVE
                  </span>
                  <span className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
                    {exnessConfigured ? 'Exness Bridge Verified' : 'Google Login Required'}
                  </span>
                </div>
                <h3 className="font-classic-serif text-2xl font-semibold text-slate-900 dark:text-white">
                  Live Broker &amp; Exness MT5 Execution
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Protected by Firebase Google Sign-In. Displays exclusively live broker orders, live P&amp;L history, and server-side Exness MT5 / Indian broker routing — completely separated from Demo wallet funds.
                </p>
                <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300 pt-2">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-700 dark:text-sky-400 shrink-0" />
                    Dedicated live ledger &amp; live Daily P&amp;L curve
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-700 dark:text-sky-400 shrink-0" />
                    Automatic SL modification hooks on TP1 &amp; TP2 hits
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-700 dark:text-sky-400 shrink-0" />
                    Never silently falls back to paper orders
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={onEnterActualAccount}
                className="w-full py-3 px-4 bg-blue-700 dark:bg-sky-500 hover:bg-blue-800 dark:hover:bg-sky-400 text-white dark:text-slate-950 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isSignedIn ? 'Enter Actual Live Account' : 'Sign In with Google for Actual Account'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Demo Practice Account */}
            <div className="bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-2xl p-7 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400">
                    Demo Practice Account · PAPER
                  </span>
                  <span className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
                    100,000 Virtual Capital
                  </span>
                </div>
                <h3 className="font-classic-serif text-2xl font-semibold text-slate-900 dark:text-white">
                  Isolated Paper Sandbox &amp; Strategy Testing
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Validate 3-TP stepped trailing, multi-market Auto-Analyzer scans, and Pine Script v5 bots on live market prices with customizable demo deposits and instant resets — zero risk to real funds.
                </p>
                <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300 pt-2">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    Dedicated demo wallet (deposit, withdraw, reset)
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    Live mark-to-market 3-TP auto-trailing &amp; auto-close
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    Never touches live broker endpoints
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={onEnterDemoAccount}
                className="w-full py-3 px-4 bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                Launch Demo Account
                <ArrowRight className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Live Markets Desk */}
      <section id="markets" className="max-w-7xl mx-auto px-6 lg:px-10 py-20 space-y-8 w-full">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-blue-700 dark:text-sky-400">
              Live Market Coverage
            </div>
            <h2 className="font-classic-serif text-3xl font-semibold text-slate-900 dark:text-white tracking-tight">
              32 Instruments Across 3 Global Desks
            </h2>
          </div>

          <div className="flex items-center bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-1 text-xs">
            {DESK_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveDesk(g.id)}
                className={`px-3.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                  activeDesk === g.id ? 'bg-blue-700 dark:bg-slate-800 text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {g.id === 'INDIAN' ? 'India NSE' : g.id === 'MCX' ? 'MCX' : 'Global & Exness'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{currentGroup.title}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{currentGroup.subtitle}</div>
            </div>
            <button
              type="button"
              onClick={() => onEnterTerminal()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
            >
              Open Full TradingView Terminal
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {currentGroup.ids.map((id) => {
              const q = quotes[id];
              const pos = (q?.changePercent ?? 0) >= 0;
              return (
                <div
                  key={id}
                  className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors text-xs"
                >
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">{q?.symbol ?? id}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{q?.exchangeLabel ?? 'Live Feed'}</div>
                  </div>
                  <div className="flex items-center gap-5 sm:gap-6 font-mono-tabular">
                    <div className="hidden sm:flex items-center">
                      <Sparkline values={q?.sparkline ?? []} positive={pos} width={84} height={26} />
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        {q ? `${q.currency}${q.price.toLocaleString()}` : 'Syncing...'}
                      </div>
                      {q && (
                        <div className={`text-[11px] ${pos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                          {pos ? '+' : ''}
                          {q.changePercent.toFixed(2)}%
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onEnterTerminal(id)}
                      className="px-3 py-1.5 bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg font-sans font-medium whitespace-nowrap"
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
      <section id="exness-api" className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1424] w-full">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 space-y-8">
          <div className="max-w-2xl space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-blue-700 dark:text-sky-400">
              Exness Live Connection Guide
            </div>
            <h2 className="font-classic-serif text-3xl font-semibold text-slate-900 dark:text-white tracking-tight">
              Connect your Exness Web or App account via MT5 API Bridge
            </h2>
          </div>

          <ExnessGuidePanel />
        </div>
      </section>

      {/* 8. Quiet Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-[#F4F6FA] dark:bg-[#08101E]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-10 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="font-classic-serif text-base font-semibold text-slate-900 dark:text-white">My Trade</span>
            <span>·</span>
            <span>Multi-Asset Trading, 3-TP Stepped Trailing &amp; Exness MT5 Bridge</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              {isDark ? <Sun className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-blue-700" />}
              {isDark ? 'Daylight Theme' : 'Midnight Theme'}
            </button>
            <TrendingUp className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <Layers className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span>Trading involves market risk. Always test strategies on Demo first.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
