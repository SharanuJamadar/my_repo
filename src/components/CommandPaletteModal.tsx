import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CandlestickChart,
  LayoutDashboard,
  Moon,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sun,
  UserCog,
  Wallet,
  X,
} from 'lucide-react';
import { INSTRUMENTS } from '../types/trading';

interface CommandPaletteModalProps {
  open: boolean;
  isDark: boolean;
  activeAccountType: 'LIVE' | 'DEMO';
  onClose: () => void;
  onSelectInstrument: (instrumentId: string) => void;
  onNavigateTab: (
    tab: 'dashboard' | 'terminal' | 'analyzer' | 'journal' | 'account' | 'settings' | 'mobile'
  ) => void;
  onSwitchAccountType: (next: 'LIVE' | 'DEMO') => void;
  onToggleTheme: () => void;
}

interface CommandItem {
  id: string;
  group: 'Navigation' | 'Quick Actions' | 'Markets';
  title: string;
  subtitle: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  isDark,
  activeAccountType,
  onClose,
  onSelectInstrument,
  onNavigateTab,
  onSwitchAccountType,
  onToggleTheme,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const navItems: CommandItem[] = [
      {
        id: 'nav-dashboard',
        group: 'Navigation',
        title: 'Dashboard',
        subtitle: 'Portfolio P&L, Exness routing, custom watchlist & live news',
        icon: LayoutDashboard,
        action: () => onNavigateTab('dashboard'),
      },
      {
        id: 'nav-terminal',
        group: 'Navigation',
        title: 'Trading Terminal',
        subtitle: 'Live candles, TradingView widget, drawings & signal generator',
        icon: CandlestickChart,
        action: () => onNavigateTab('terminal'),
      },
      {
        id: 'nav-analyzer',
        group: 'Navigation',
        title: 'Analyzer & Pine Studio',
        subtitle: 'Multi-market Auto-Analyzer, Pine Script v5 bots & Chart AI',
        icon: ScanSearch,
        action: () => onNavigateTab('analyzer'),
      },
      {
        id: 'nav-journal',
        group: 'Navigation',
        title: 'Trade Journal',
        subtitle: 'Open positions, 3-TP trailing ladders & closed performance',
        icon: BookOpen,
        action: () => onNavigateTab('journal'),
      },
      {
        id: 'nav-account',
        group: 'Navigation',
        title: 'Account Settings',
        subtitle: 'Profile, risk limits & live Exness bridge setup',
        icon: UserCog,
        action: () => onNavigateTab('account'),
      },
      {
        id: 'nav-settings',
        group: 'Navigation',
        title: 'Admin & Strategy Settings',
        subtitle: 'EMA/RSI parameters, Telegram channel & kill switch',
        icon: Settings,
        action: () => onNavigateTab('settings'),
      },
      {
        id: 'nav-mobile',
        group: 'Navigation',
        title: 'App Download (APK)',
        subtitle: 'Direct Android APK download & Play Store status',
        icon: Smartphone,
        action: () => onNavigateTab('mobile'),
      },
    ];

    const quickActions: CommandItem[] = [
      {
        id: 'act-account',
        group: 'Quick Actions',
        title:
          activeAccountType === 'LIVE'
            ? 'Switch to Demo Practice Account'
            : 'Switch to Actual Live Account',
        subtitle:
          activeAccountType === 'LIVE'
            ? 'Move to isolated virtual paper trading sandbox'
            : 'Switch to authenticated Live Broker / Exness MT5 desk',
        icon: activeAccountType === 'LIVE' ? Wallet : ShieldCheck,
        action: () => onSwitchAccountType(activeAccountType === 'LIVE' ? 'DEMO' : 'LIVE'),
      },
      {
        id: 'act-theme',
        group: 'Quick Actions',
        title: isDark ? 'Switch to Daylight Theme' : 'Switch to Midnight Theme',
        subtitle: isDark
          ? 'Swiss Institutional Alabaster & Royal Cobalt light palette'
          : 'Deep Navy & Sky Blue dark trading room palette',
        icon: isDark ? Sun : Moon,
        action: onToggleTheme,
      },
    ];

    const marketItems: CommandItem[] = INSTRUMENTS.map((inst) => ({
      id: `mkt-${inst.id}`,
      group: 'Markets',
      title: inst.symbol,
      subtitle: `${inst.name} · ${inst.exchangeLabel}`,
      badge: inst.segment,
      icon: CandlestickChart,
      action: () => onSelectInstrument(inst.id),
    }));

    return [...quickActions, ...navItems, ...marketItems];
  }, [activeAccountType, isDark, onNavigateTab, onSelectInstrument, onSwitchAccountType, onToggleTheme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 14);
    return items
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          (item.badge && item.badge.toLowerCase().includes(q))
      )
      .slice(0, 16);
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0
        );
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        filtered[selectedIndex].action();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, filtered, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/75 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to market (XAUUSD, NIFTY, BTC...), tab, or quick action..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching markets or commands found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  className={`w-full px-4 py-3 text-left flex items-center justify-between gap-3 transition-colors ${
                    active
                      ? 'bg-blue-50 dark:bg-sky-500/15'
                      : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        active
                          ? 'text-blue-700 dark:text-sky-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono-tabular uppercase text-slate-400 dark:text-slate-500">
                      {item.badge || item.group}
                    </span>
                    {active && <ArrowRight className="w-3.5 h-3.5 text-blue-700 dark:text-sky-400" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1424] flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>↑↓ Navigate · Enter Open · Esc Close</span>
          <span className="font-mono-tabular">Ctrl+K / ⌘K</span>
        </div>
      </div>
    </div>
  );
};
