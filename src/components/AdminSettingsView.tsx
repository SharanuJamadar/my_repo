import React, { useEffect, useState } from 'react';
import { Check, RotateCcw, Save } from 'lucide-react';
import {
  DEFAULT_STRATEGY_CONFIG,
  INSTRUMENTS,
  type StrategyConfig,
} from '../types/trading';

interface IntegrationStatus {
  geminiConfigured: boolean;
  telegramConfigured: boolean;
  telegramChatConfigured?: boolean;
  telegramBotUsername?: string | null;
  twelveDataConfigured: boolean;
  brokerConfigured: boolean;
  publicFeedsActive: string[];
}

interface AdminSettingsViewProps {
  config: StrategyConfig;
  userEmail: string;
  integrationStatus: IntegrationStatus;
  onSaveConfig: (next: Omit<StrategyConfig, 'userId' | 'updatedAt'>) => Promise<void>;
}

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({
  config,
  userEmail,
  integrationStatus,
  onSaveConfig,
}) => {
  const [draft, setDraft] = useState<Omit<StrategyConfig, 'userId' | 'updatedAt'>>({
    emaFast: config.emaFast,
    emaMid: config.emaMid,
    emaSlow: config.emaSlow,
    rsiPeriod: config.rsiPeriod,
    rsiBullishMin: config.rsiBullishMin,
    rsiBearishMax: config.rsiBearishMax,
    trendTimeframe: config.trendTimeframe,
    entryTimeframe: config.entryTimeframe,
    minSetupScore: config.minSetupScore,
    minRiskReward: config.minRiskReward,
    maxRiskPerTradePct: config.maxRiskPerTradePct,
    prioritizeAtmOptions: config.prioritizeAtmOptions,
    comexCrudeEma9Priority: config.comexCrudeEma9Priority,
    paperTradingOnly: config.paperTradingOnly,
    autoBroadcastTelegram: config.autoBroadcastTelegram,
    telegramChannelLabel: config.telegramChannelLabel,
    dataProviderLabel: config.dataProviderLabel,
    brokerProviderLabel: config.brokerProviderLabel,
    killSwitchActive: config.killSwitchActive,
    activeInstruments: config.activeInstruments,
  });
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  useEffect(() => {
    setDraft({
      emaFast: config.emaFast,
      emaMid: config.emaMid,
      emaSlow: config.emaSlow,
      rsiPeriod: config.rsiPeriod,
      rsiBullishMin: config.rsiBullishMin,
      rsiBearishMax: config.rsiBearishMax,
      trendTimeframe: config.trendTimeframe,
      entryTimeframe: config.entryTimeframe,
      minSetupScore: config.minSetupScore,
      minRiskReward: config.minRiskReward,
      maxRiskPerTradePct: config.maxRiskPerTradePct,
      prioritizeAtmOptions: config.prioritizeAtmOptions,
      comexCrudeEma9Priority: config.comexCrudeEma9Priority,
      paperTradingOnly: config.paperTradingOnly,
      autoBroadcastTelegram: config.autoBroadcastTelegram,
      telegramChannelLabel: config.telegramChannelLabel,
      dataProviderLabel: config.dataProviderLabel,
      brokerProviderLabel: config.brokerProviderLabel,
      killSwitchActive: config.killSwitchActive,
      activeInstruments: config.activeInstruments,
    });
  }, [config]);

  const toggleInstrument = (id: string) => {
    setDraft((prev) => {
      const exists = prev.activeInstruments.includes(id);
      const next = exists
        ? prev.activeInstruments.filter((x) => x !== id)
        : [...prev.activeInstruments, id];
      return { ...prev, activeInstruments: next.length ? next : [id] };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedBanner(false);
    try {
      await onSaveConfig(draft);
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Admin & Strategy Engine Settings</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure My Trade strategy parameters, risk gates, instruments, and optional integrations without editing code
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft({ ...DEFAULT_STRATEGY_CONFIG })}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {savedBanner ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving...' : savedBanner ? 'Configuration Saved' : 'Save Configuration'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* EMA & RSI Settings */}
        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Technical Indicators (EMA & RSI)</h3>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Fast EMA (Crude Priority)</label>
              <input
                type="number"
                min={2}
                max={50}
                value={draft.emaFast}
                onChange={(e) => setDraft({ ...draft, emaFast: Number(e.target.value) })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Mid EMA</label>
              <input
                type="number"
                min={5}
                max={100}
                value={draft.emaMid}
                onChange={(e) => setDraft({ ...draft, emaMid: Number(e.target.value) })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Slow EMA</label>
              <input
                type="number"
                min={20}
                max={200}
                value={draft.emaSlow}
                onChange={(e) => setDraft({ ...draft, emaSlow: Number(e.target.value) })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">RSI Period</label>
              <input
                type="number"
                min={5}
                max={30}
                value={draft.rsiPeriod}
                onChange={(e) => setDraft({ ...draft, rsiPeriod: Number(e.target.value) })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">RSI Bullish Min</label>
              <input
                type="number"
                min={30}
                max={80}
                value={draft.rsiBullishMin}
                onChange={(e) => setDraft({ ...draft, rsiBullishMin: Number(e.target.value) })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">RSI Bearish Max</label>
              <input
                type="number"
                min={20}
                max={70}
                value={draft.rsiBearishMax}
                onChange={(e) => setDraft({ ...draft, rsiBearishMax: Number(e.target.value) })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>
          </div>
        </div>

        {/* Multi-Timeframe & Risk Gates */}
        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Multi-Timeframe & Risk Gates</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Primary Trend Timeframe</label>
              <select
                value={draft.trendTimeframe}
                onChange={(e) =>
                  setDraft({ ...draft, trendTimeframe: e.target.value as '15m' | '1h' | '4h' })
                }
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
              >
                <option value="15m">15 Minutes (Default)</option>
                <option value="1h">1 Hour</option>
                <option value="4h">4 Hours</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Entry Trigger Timeframe</label>
              <select
                value={draft.entryTimeframe}
                onChange={(e) =>
                  setDraft({ ...draft, entryTimeframe: e.target.value as '5m' | '15m' })
                }
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
              >
                <option value="5m">5 Minutes (Default)</option>
                <option value="15m">15 Minutes</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Min Quality Score</label>
              <input
                type="number"
                min={40}
                max={95}
                value={draft.minSetupScore}
                onChange={(e) => setDraft({ ...draft, minSetupScore: Number(e.target.value) })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Min Risk:Reward (1:X)</label>
              <input
                type="number"
                step="0.1"
                min={1}
                max={10}
                value={draft.minRiskReward}
                onChange={(e) => setDraft({ ...draft, minRiskReward: Number(e.target.value) })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Max Risk / Trade (%)</label>
              <input
                type="number"
                step="0.25"
                min={0.25}
                max={10}
                value={draft.maxRiskPerTradePct}
                onChange={(e) => setDraft({ ...draft, maxRiskPerTradePct: Number(e.target.value) })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Rule Toggles & Execution Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-5 space-y-3 text-xs">
          <h3 className="text-sm font-semibold text-white">Strategy & Execution Safeguards</h3>

          {[
            {
              key: 'prioritizeAtmOptions',
              title: 'Prioritize ATM & Near-ATM CE/PE Strikes',
              desc: 'Avoid far OTM contracts on NIFTY 50, BANK NIFTY, and SENSEX.',
            },
            {
              key: 'comexCrudeEma9Priority',
              title: 'COMEX / WTI Crude Oil EMA 9 Priority',
              desc: 'Enforce strict EMA 9 momentum weighting on Crude Oil signals.',
            },
            {
              key: 'paperTradingOnly',
              title: 'Paper Trading Mode Locked (Default)',
              desc: 'Blocks real broker execution until explicitly switched off and broker auth is configured.',
            },
            {
              key: 'autoBroadcastTelegram',
              title: 'Auto-Broadcast Signals to Telegram',
              desc: 'Keep OFF to require manual trader approval before publishing any signal.',
            },
            {
              key: 'killSwitchActive',
              title: 'Emergency Order Kill Switch',
              desc: 'Immediately halts all order placement across paper and live execution.',
            },
          ].map((item) => {
            const checked = Boolean((draft as any)[item.key]);
            return (
              <label
                key={item.key}
                className="flex items-start justify-between gap-4 p-3 bg-[#090B0E] border border-white/[0.06] rounded-lg cursor-pointer"
              >
                <div>
                  <div className="font-medium text-white">{item.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{item.desc}</div>
                </div>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setDraft({ ...draft, [item.key]: e.target.checked })}
                  className="mt-1 rounded border-slate-600 bg-[#11141A] text-emerald-500"
                />
              </label>
            );
          })}
        </div>

        {/* Integrations, Providers & Permissions */}
        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-5 space-y-4 text-xs">
          <h3 className="text-sm font-semibold text-white">Data API, Telegram & Broker Architecture</h3>

          <div className="space-y-3">
            <div>
              <label className="block text-slate-400 mb-1">Data Provider Architecture Label</label>
              <input
                value={draft.dataProviderLabel}
                onChange={(e) => setDraft({ ...draft, dataProviderLabel: e.target.value })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Telegram Channel Label</label>
              <input
                value={draft.telegramChannelLabel}
                onChange={(e) => setDraft({ ...draft, telegramChannelLabel: e.target.value })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Broker Adapter Label</label>
              <input
                value={draft.brokerProviderLabel}
                onChange={(e) => setDraft({ ...draft, brokerProviderLabel: e.target.value })}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="bg-[#090B0E] border border-white/[0.06] rounded-lg p-3.5 space-y-2">
            <div className="font-semibold text-white">Server Environment Integration Readiness</div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="text-slate-300">
                Gemini AI Engine:{' '}
                <span className={integrationStatus.geminiConfigured ? 'text-emerald-400' : 'text-amber-300'}>
                  {integrationStatus.geminiConfigured ? 'Ready' : 'Needs Server Secret'}
                </span>
              </div>
              <div className="text-slate-300">
                Telegram Bot:{' '}
                <span className={integrationStatus.telegramConfigured ? 'text-emerald-400' : 'text-slate-400'}>
                  {integrationStatus.telegramConfigured
                    ? `Active (${integrationStatus.telegramBotUsername || 'Bot Ready'})`
                    : 'Optional (Not Connected)'}
                </span>
              </div>
              <div className="text-slate-300">
                Licensed TwelveData:{' '}
                <span className={integrationStatus.twelveDataConfigured ? 'text-emerald-400' : 'text-slate-400'}>
                  {integrationStatus.twelveDataConfigured ? 'Configured' : 'Using Live Public Feeds'}
                </span>
              </div>
              <div className="text-slate-300">
                Live Broker API:{' '}
                <span className={integrationStatus.brokerConfigured ? 'text-emerald-400' : 'text-slate-400'}>
                  {integrationStatus.brokerConfigured ? 'Configured' : 'Optional (Paper Mode Ready)'}
                </span>
              </div>
            </div>
            <div className="text-[11px] text-slate-400 pt-1">
              {userEmail
                ? `Cloud Sync Active: ${userEmail} · Credentials remain strictly in server environment secrets.`
                : 'Standalone Mode Active (Local Browser Storage) — No external app connection required.'}
            </div>
          </div>
        </div>
      </div>

      {/* Active Instruments Selector */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">Active Trading Instruments</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 text-xs">
          {INSTRUMENTS.map((inst) => {
            const active = draft.activeInstruments.includes(inst.id);
            return (
              <button
                key={inst.id}
                type="button"
                onClick={() => toggleInstrument(inst.id)}
                className={`p-2.5 rounded-lg border text-left transition-colors ${
                  active
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-white'
                    : 'bg-[#090B0E] border-white/[0.06] text-slate-400'
                }`}
              >
                <div className="font-semibold">{inst.symbol}</div>
                <div className="text-[11px] text-slate-400">{inst.segment}</div>
              </button>
            );
          })}
        </div>
      </div>
    </form>
  );
};
