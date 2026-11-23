import React, { useEffect, useState } from 'react';
import {
  Check,
  Cloud,
  Download,
  Link2,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  UserCheck,
  Wallet,
} from 'lucide-react';
import {
  DEFAULT_ACCOUNT_PROFILE,
  INSTRUMENTS,
  type AccountProfileSettings,
  type DemoWalletState,
  type PineStrategyRecord,
  type StrategyConfig,
  type Timeframe,
  type TradeJournalEntry,
} from '../types/trading';
import { ExnessGuidePanel } from './ExnessGuidePanel';

interface AccountSettingsViewProps {
  activeAccountType: 'LIVE' | 'DEMO';
  onSwitchAccountType: (next: 'LIVE' | 'DEMO') => void;
  profile: AccountProfileSettings;
  onSaveProfile: (next: AccountProfileSettings) => Promise<void>;
  userEmail: string;
  isSignedIn: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  wallet: DemoWalletState;
  onAddWalletFunds: (amount: number, note?: string) => Promise<void>;
  onResetWallet: (amount: number) => Promise<void>;
  config: StrategyConfig;
  onToggleKillSwitch: () => Promise<void>;
  onOpenBrokerModal: () => void;
  onSwitchAccountSetup: () => void;
  trades: TradeJournalEntry[];
  pineStrategies: PineStrategyRecord[];
}

export const AccountSettingsView: React.FC<AccountSettingsViewProps> = ({
  activeAccountType,
  onSwitchAccountType,
  profile,
  onSaveProfile,
  userEmail,
  isSignedIn,
  onSignIn,
  onSignOut,
  wallet,
  onAddWalletFunds,
  onResetWallet,
  config,
  onToggleKillSwitch,
  onOpenBrokerModal,
  onSwitchAccountSetup,
  trades,
  pineStrategies,
}) => {
  const [draft, setDraft] = useState<AccountProfileSettings>(profile);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [fundAmount, setFundAmount] = useState('50000');
  const [fundBusy, setFundBusy] = useState(false);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedOk(false);
    try {
      await onSaveProfile(draft);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleAddFunds = async (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    setFundBusy(true);
    try {
      await onAddWalletFunds(amount, 'Account Settings Deposit');
    } finally {
      setFundBusy(false);
    }
  };

  const handleExportAccountData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      account: draft,
      wallet,
      strategyConfig: config,
      pineStrategies,
      trades,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-trade-account-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const realizedPnl = trades
    .filter((t) => t.status === 'CLOSED')
    .reduce((acc, t) => acc + t.pnl, 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Account Settings</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isSignedIn
              ? `Cloud Account Active (${userEmail}) · Synced with Google Firestore`
              : 'Standalone Trader Account · Persisted locally in browser storage'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft({ ...DEFAULT_ACCOUNT_PROFILE })}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Profile Defaults
          </button>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {savedOk ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving...' : savedOk ? 'Account Saved' : 'Save Account Settings'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trader Profile & Preferences */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Trader Identity & Cloud Sync</h3>
              </div>
              {isSignedIn ? (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
                >
                  <Cloud className="w-3.5 h-3.5" />
                  Connect Google Sync
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">Trader Display Name</label>
                <input
                  value={draft.displayName}
                  onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                  required
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">Mobile Number</label>
                <input
                  type="tel"
                  maxLength={24}
                  value={draft.mobileNumber || ''}
                  onChange={(e) => setDraft({ ...draft, mobileNumber: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">Account Email</label>
                <input
                  type="email"
                  maxLength={200}
                  value={draft.email || (isSignedIn ? userEmail : '')}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  placeholder="trader@example.com"
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
              <div className="text-slate-500 dark:text-slate-400">
                Current Workspace:{' '}
                <span
                  className={`font-semibold ${
                    activeAccountType === 'LIVE' ? 'text-blue-700 dark:text-sky-400' : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {activeAccountType === 'LIVE'
                    ? 'Actual Trading Account (LIVE)'
                    : 'Demo Practice Account (PAPER)'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onSwitchAccountType(activeAccountType === 'LIVE' ? 'DEMO' : 'LIVE')}
                  className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 underline underline-offset-4 font-medium"
                >
                  Switch to {activeAccountType === 'LIVE' ? 'Demo' : 'Actual Live'}
                </button>
                <button
                  type="button"
                  onClick={onSwitchAccountSetup}
                  className="text-blue-700 dark:text-sky-300 hover:text-blue-800 dark:hover:text-sky-200 underline underline-offset-4 font-medium"
                >
                  Onboarding Setup
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-1 text-xs">
              <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Account Access</div>
                <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                  {userEmail === 'sharanu12131415@gmail.com' ? 'Admin Desk' : 'Standard Trader'}
                </div>
              </div>
              <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Saved Pine Bots</div>
                <div className="font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">
                  {pineStrategies.length}
                </div>
              </div>
              <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Recorded Trades</div>
                <div className="font-mono-tabular font-semibold text-slate-900 dark:text-white mt-0.5">
                  {trades.length}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Risk Profile & Terminal Defaults</h3>

            <div className="space-y-1.5">
              <label className="block text-xs text-slate-500 dark:text-slate-400">Account Risk Appetite</label>
              <div className="grid grid-cols-3 gap-2">
                {(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setDraft({ ...draft, riskProfile: tier })}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                      draft.riskProfile === tier
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                        : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tier.charAt(0) + tier.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">Default Market</label>
                <select
                  value={draft.defaultInstrumentId}
                  onChange={(e) => setDraft({ ...draft, defaultInstrumentId: e.target.value })}
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                >
                  {INSTRUMENTS.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.symbol}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">Default Timeframe</label>
                <select
                  value={draft.defaultTimeframe}
                  onChange={(e) =>
                    setDraft({ ...draft, defaultTimeframe: e.target.value as Timeframe })
                  }
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                >
                  <option value="5m">5M</option>
                  <option value="15m">15M</option>
                  <option value="1h">1H</option>
                  <option value="4h">4H</option>
                  <option value="1d">1D</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">Daily Loss Guardrail</label>
                <input
                  type="number"
                  min={0}
                  step="500"
                  value={draft.dailyLossLimit}
                  onChange={(e) =>
                    setDraft({ ...draft, dailyLossLimit: Number(e.target.value) })
                  }
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
              <div>
                <label className="block text-slate-500 dark:text-slate-400 mb-1">Default Telegram Chat / Channel ID</label>
                <input
                  value={draft.telegramChatId}
                  onChange={(e) => setDraft({ ...draft, telegramChatId: e.target.value })}
                  placeholder="@channel or numeric Chat ID"
                  className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>
              <label className="flex items-center justify-between gap-3 p-3 bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg cursor-pointer self-end">
                <div>
                  <div className="font-medium text-slate-900 dark:text-white">Trade Execution Alerts</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Notify on auto & bot entries</div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.tradeAlertsEnabled}
                  onChange={(e) =>
                    setDraft({ ...draft, tradeAlertsEnabled: e.target.checked })
                  }
                  className="rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E182A] text-emerald-500"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Demo Capital (DEMO Mode) OR Exness Live API Guide (LIVE Mode) */}
        <div className="space-y-6">
          {activeAccountType === 'DEMO' ? (
            <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Demo Account Capital &amp; Virtual Wallet</h3>
                </div>
                <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                  Demo Realized P&amp;L: {realizedPnl >= 0 ? '+' : ''}
                  {realizedPnl.toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Available Demo Balance</div>
                  <div className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-white mt-1">
                    {wallet.balance.toLocaleString()}
                  </div>
                </div>
                <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Demo Funds Added</div>
                  <div className="font-mono-tabular text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                    {wallet.totalAdded.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="number"
                  min={1}
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  className="flex-1 min-w-[140px] bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono-tabular text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  disabled={fundBusy}
                  onClick={() => handleAddFunds(Number(fundAmount))}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Demo Funds
                </button>
                <button
                  type="button"
                  disabled={fundBusy}
                  onClick={() => onResetWallet(100000)}
                  className="px-3 py-2 font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Reset 100k
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {[10000, 50000, 100000, 500000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={fundBusy}
                    onClick={() => handleAddFunds(preset)}
                    className="px-2.5 py-1 bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-mono-tabular rounded-md transition-colors"
                  >
                    +{preset.toLocaleString()}
                  </button>
                ))}
              </div>

              {wallet.recentDeposits.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Recent Demo Deposits</div>
                  <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] font-mono-tabular text-slate-700 dark:text-slate-300">
                    {wallet.recentDeposits.slice(0, 6).map((dep, i) => (
                      <div key={i} className="truncate">
                        {dep}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <ExnessGuidePanel compact />
          )}

          <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Broker Connection, Safety & Data</h3>

            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Active Execution Adapter</div>
                <div className="font-semibold text-slate-900 dark:text-white mt-0.5">{config.brokerProviderLabel}</div>
              </div>
              <button
                type="button"
                onClick={onOpenBrokerModal}
                className="inline-flex items-center gap-1.5 px-3 py-2 font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-blue-700 dark:text-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Link2 className="w-3.5 h-3.5" />
                Connect Trading App
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg">
              <div>
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <ShieldAlert
                    className={`w-4 h-4 ${
                      config.killSwitchActive ? 'text-rose-700 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  />
                  Emergency Order Kill Switch
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {config.killSwitchActive
                    ? 'ACTIVE — All live, paper, and bot orders are blocked.'
                    : 'Standby — Manual, auto-scan, and Pine bot execution permitted.'}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleKillSwitch}
                className={`px-3 py-2 font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  config.killSwitchActive
                    ? 'bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/35 text-rose-700 dark:text-rose-300 hover:bg-red-500/25'
                    : 'bg-white dark:bg-[#0E182A] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {config.killSwitchActive ? 'Disable Kill Switch' : 'Activate Kill Switch'}
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportAccountData}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              Export Account Backup (Profile, Pine Strategies & Trade Journal JSON)
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};
