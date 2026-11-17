import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Link2,
  Mail,
  Phone,
  ShieldCheck,
  User,
  UserPlus,
} from 'lucide-react';
import { BROKER_APPS } from '../lib/brokers';
import {
  INSTRUMENTS,
  type AccountProfileSettings,
  type Timeframe,
} from '../types/trading';

interface AccountOnboardingViewProps {
  isSignedIn: boolean;
  userEmail: string;
  userDisplayName: string;
  initialProfile: AccountProfileSettings;
  currentBrokerLabel: string;
  brokerReadiness: Record<string, boolean>;
  onConnectBrokerAccount: (params: {
    brokerProviderLabel: string;
    displayName: string;
    email: string;
    mobileNumber: string;
  }) => Promise<void>;
  onCreateDemoAccount: (params: {
    displayName: string;
    mobileNumber: string;
    email: string;
    startingCapital: number;
    defaultInstrumentId: string;
    defaultTimeframe: Timeframe;
    riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  }) => Promise<void>;
  onBackToLanding: () => void;
  onSignOut: () => Promise<void>;
}

const REAL_BROKERS = BROKER_APPS.filter((b) => b.id !== 'PAPER_ENGINE');

export const AccountOnboardingView: React.FC<AccountOnboardingViewProps> = ({
  isSignedIn,
  userEmail,
  userDisplayName,
  initialProfile,
  currentBrokerLabel,
  brokerReadiness,
  onConnectBrokerAccount,
  onCreateDemoAccount,
  onBackToLanding,
  onSignOut,
}) => {
  const [selectedPath, setSelectedPath] = useState<'BROKER' | 'DEMO' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trading App state
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>(() => {
    const matched = REAL_BROKERS.find((b) =>
      currentBrokerLabel.toLowerCase().includes(b.name.toLowerCase())
    );
    return matched?.id ?? REAL_BROKERS[0].id;
  });
  const [brokerAlias, setBrokerAlias] = useState('');

  // Demo Account registration state (do NOT pre-show any wallet)
  const [fullName, setFullName] = useState(
    initialProfile.displayName && initialProfile.displayName !== 'Sharan Trader'
      ? initialProfile.displayName
      : userDisplayName || ''
  );
  const [mobileNumber, setMobileNumber] = useState(initialProfile.mobileNumber || '');
  const [email, setEmail] = useState(initialProfile.email || userEmail || '');
  const [startingCapital, setStartingCapital] = useState('100000');
  const [defaultInstrumentId, setDefaultInstrumentId] = useState(
    initialProfile.defaultInstrumentId || 'XAUUSD'
  );
  const [defaultTimeframe, setDefaultTimeframe] = useState<Timeframe>(
    initialProfile.defaultTimeframe || '5m'
  );
  const [riskProfile, setRiskProfile] = useState<'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE'>(
    initialProfile.riskProfile || 'BALANCED'
  );

  useEffect(() => {
    if (userEmail && !email) setEmail(userEmail);
    if (userDisplayName && !fullName) setFullName(userDisplayName);
  }, [userEmail, userDisplayName, email, fullName]);

  const selectedBroker =
    REAL_BROKERS.find((b) => b.id === selectedBrokerId) ?? REAL_BROKERS[0];
  const hasServerCredentials = Boolean(brokerReadiness[selectedBroker.id]);

  const handleConfirmBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const cleanAlias = brokerAlias.trim().slice(0, 28);
      const modeSuffix = hasServerCredentials ? 'Live Ready' : 'Paper-Linked';
      const label = cleanAlias
        ? `${selectedBroker.name} (${cleanAlias}) · ${modeSuffix}`.slice(0, 80)
        : `${selectedBroker.name} · ${modeSuffix}`.slice(0, 80);

      await onConnectBrokerAccount({
        brokerProviderLabel: label,
        displayName: (fullName.trim() || userDisplayName || 'Sharan Trader').slice(0, 100),
        email: (email.trim() || userEmail || '').slice(0, 200),
        mobileNumber: mobileNumber.trim().slice(0, 24),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect trading app.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitDemoAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = fullName.trim();
    const cleanEmail = email.trim();
    const cleanPhone = mobileNumber.trim();
    const digitsOnly = cleanPhone.replace(/\D/g, '');
    const capitalNum = Number(startingCapital);

    if (cleanName.length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (digitsOnly.length < 10 || digitsOnly.length > 15) {
      setError('Please enter a valid mobile number (10 to 15 digits, with optional country code).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!Number.isFinite(capitalNum) || capitalNum < 1000) {
      setError('Please choose a valid starting demo capital (minimum 1,000).');
      return;
    }

    setSubmitting(true);
    try {
      await onCreateDemoAccount({
        displayName: cleanName.slice(0, 100),
        mobileNumber: cleanPhone.slice(0, 24),
        email: cleanEmail.slice(0, 200),
        startingCapital: capitalNum,
        defaultInstrumentId,
        defaultTimeframe,
        riskProfile,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create demo account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090B0E] text-[#E6EDF3] flex flex-col">
      {/* Top Bar */}
      <header className="h-16 border-b border-white/[0.08] bg-[#0C0F14] px-6 lg:px-10 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={onBackToLanding}
          className="font-classic-serif text-xl font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          SHARAN
        </button>

        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-400">
          {isSignedIn ? (
            <span>Signed in as {userEmail}</span>
          ) : (
            <span>Trader Account Registration</span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onBackToLanding}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Landing Page
          </button>
          {isSignedIn && (
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white whitespace-nowrap"
            >
              Sign Out
            </button>
          )}
        </div>
      </header>

      {/* Main Choice & Form Container */}
      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-4xl space-y-8">
          <div className="space-y-2 text-center max-w-2xl mx-auto">
            <div className="text-xs font-medium text-[#C9A24D]">Account Access Setup</div>
            <h1 className="font-classic-serif text-3xl sm:text-4xl font-semibold text-white tracking-tight text-balance">
              Choose how you would like to trade with SHARAN
            </h1>
            <p className="text-sm text-slate-400">
              Connect an existing brokerage app or create a personal Demo Account before entering
              the main landing page and trading desk.
            </p>
          </div>

          {/* Step 1: Both Account Options Side-by-Side (NO demo wallet shown) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <button
              type="button"
              onClick={() => {
                setSelectedPath('BROKER');
                setError(null);
              }}
              className={`p-6 rounded-xl border text-left transition-all flex flex-col justify-between gap-5 ${
                selectedPath === 'BROKER'
                  ? 'bg-sky-500/[0.08] border-sky-400/50'
                  : 'bg-[#11141A] border-white/[0.08] hover:border-white/25'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Link2 className="w-5 h-5 text-sky-400" />
                  <span className="text-xs font-medium text-sky-300">Brokerage Integration</span>
                </div>
                <h2 className="text-lg font-semibold text-white">Connect Trading App</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Link Groww, Exness, Upstox, Zerodha Kite, Dhan, Angel One, or Binance to route
                  supported instruments directly from your SHARAN workspace.
                </p>
              </div>
              <div className="flex items-center justify-between text-xs font-semibold text-white pt-3 border-t border-white/[0.06]">
                <span>{selectedPath === 'BROKER' ? 'Selected — Configure Below' : 'Choose Trading App'}</span>
                <ArrowRight className="w-4 h-4 text-sky-400" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedPath('DEMO');
                setError(null);
              }}
              className={`p-6 rounded-xl border text-left transition-all flex flex-col justify-between gap-5 ${
                selectedPath === 'DEMO'
                  ? 'bg-[#C9A24D]/[0.09] border-[#C9A24D]/60'
                  : 'bg-[#11141A] border-white/[0.08] hover:border-white/25'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <UserPlus className="w-5 h-5 text-[#C9A24D]" />
                  <span className="text-xs font-medium text-[#C9A24D]">Paper Trading Desk</span>
                </div>
                <h2 className="text-lg font-semibold text-white">Create Demo Account</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Register a new Demo Account using your full name, mobile number, and email to
                  test strategies, Pine bots, and live P&amp;L simulations safely.
                </p>
              </div>
              <div className="flex items-center justify-between text-xs font-semibold text-white pt-3 border-t border-white/[0.06]">
                <span>{selectedPath === 'DEMO' ? 'Selected — Enter Details Below' : 'Register Demo Account'}</span>
                <ArrowRight className="w-4 h-4 text-[#C9A24D]" />
              </div>
            </button>
          </div>

          {/* Step 2A: Connect Trading App Panel */}
          {selectedPath === 'BROKER' && (
            <form
              onSubmit={handleConfirmBroker}
              className="bg-[#11141A] border border-white/[0.1] rounded-xl p-6 space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Select Your Trading App</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Pick a broker platform below to bind your execution profile.
                  </p>
                </div>
                {selectedBroker.portalUrl && (
                  <a
                    href={selectedBroker.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-sky-300 rounded-lg whitespace-nowrap"
                  >
                    Open {selectedBroker.name} Portal
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {REAL_BROKERS.map((app) => {
                  const active = app.id === selectedBrokerId;
                  const liveReady = Boolean(brokerReadiness[app.id]);
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => setSelectedBrokerId(app.id)}
                      className={`p-3.5 rounded-lg border text-left transition-colors ${
                        active
                          ? 'bg-sky-500/10 border-sky-400/50'
                          : 'bg-[#090B0E] border-white/[0.08] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white">{app.name}</span>
                        <span
                          className={`text-[11px] font-medium ${
                            liveReady ? 'text-emerald-400' : 'text-sky-300'
                          }`}
                        >
                          {liveReady ? 'Live Ready' : 'Paper-Linked'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 truncate">{app.markets}</div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">
                    Desk / Account Alias (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={28}
                    value={brokerAlias}
                    onChange={(e) => setBrokerAlias(e.target.value)}
                    placeholder={`e.g. ${selectedBroker.name} Primary Desk`}
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Trader Name (Optional)</label>
                  <input
                    type="text"
                    maxLength={100}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your display name"
                    className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs text-slate-400 bg-[#090B0E] border border-white/[0.06] rounded-lg p-3.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  {hasServerCredentials
                    ? `${selectedBroker.name} server credentials (${selectedBroker.envHint}) are verified on this server.`
                    : `No broker API secrets are stored in browser inputs. Connecting binds ${selectedBroker.name} in Paper-Linked mode until ${selectedBroker.envHint} is added on the server.`}
                </span>
              </div>

              {error && <div className="text-xs text-red-400">{error}</div>}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  {submitting
                    ? 'Connecting...'
                    : `Connect ${selectedBroker.name} & Enter Landing Page`}
                </button>
              </div>
            </form>
          )}

          {/* Step 2B: Create Demo Account Form (Mobile Number + Email + Details) */}
          {selectedPath === 'DEMO' && (
            <form
              onSubmit={handleSubmitDemoAccount}
              className="bg-[#11141A] border border-[#C9A24D]/35 rounded-xl p-6 space-y-5"
            >
              <div className="border-b border-white/[0.08] pb-4">
                <h3 className="text-base font-semibold text-white">Create Your Demo Account</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Enter your trader profile, mobile number, and email address to activate your demo
                  account and proceed to the main landing page.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block text-slate-300 mb-1.5 font-medium">
                    Full Name <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Sharan Kumar"
                      className="w-full bg-[#090B0E] border border-white/[0.1] rounded-lg pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#C9A24D]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1.5 font-medium">
                    Mobile Number <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="tel"
                      required
                      maxLength={24}
                      value={mobileNumber}
                      onChange={(e) => setMobileNumber(e.target.value)}
                      placeholder="e.g. +91 98765 43210"
                      className="w-full bg-[#090B0E] border border-white/[0.1] rounded-lg pl-9 pr-3 py-2.5 font-mono-tabular text-white placeholder-slate-500 focus:outline-none focus:border-[#C9A24D]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1.5 font-medium">
                    Email Address <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="email"
                      required
                      maxLength={200}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="trader@example.com"
                      className="w-full bg-[#090B0E] border border-white/[0.1] rounded-lg pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#C9A24D]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-1">
                <div>
                  <label className="block text-slate-400 mb-1.5">
                    Starting Demo Capital Allocation
                  </label>
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={startingCapital}
                    onChange={(e) => setStartingCapital(e.target.value)}
                    className="w-full bg-[#090B0E] border border-white/[0.1] rounded-lg px-3 py-2.5 font-mono-tabular text-white focus:outline-none focus:border-[#C9A24D]"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {[50000, 100000, 500000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setStartingCapital(String(amt))}
                        className="px-2 py-1 text-[11px] font-mono-tabular bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-slate-300 rounded"
                      >
                        {amt.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1.5">Primary Market</label>
                  <select
                    value={defaultInstrumentId}
                    onChange={(e) => setDefaultInstrumentId(e.target.value)}
                    className="w-full bg-[#090B0E] border border-white/[0.1] rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-[#C9A24D]"
                  >
                    {INSTRUMENTS.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.symbol} ({inst.exchangeLabel})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1.5">Risk Tier &amp; Timeframe</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={riskProfile}
                      onChange={(e) =>
                        setRiskProfile(
                          e.target.value as 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE'
                        )
                      }
                      className="bg-[#090B0E] border border-white/[0.1] rounded-lg px-2.5 py-2.5 text-white"
                    >
                      <option value="CONSERVATIVE">Conservative</option>
                      <option value="BALANCED">Balanced</option>
                      <option value="AGGRESSIVE">Aggressive</option>
                    </select>
                    <select
                      value={defaultTimeframe}
                      onChange={(e) => setDefaultTimeframe(e.target.value as Timeframe)}
                      className="bg-[#090B0E] border border-white/[0.1] rounded-lg px-2.5 py-2.5 text-white"
                    >
                      <option value="5m">5M</option>
                      <option value="15m">15M</option>
                      <option value="1h">1H</option>
                    </select>
                  </div>
                </div>
              </div>

              {error && <div className="text-xs text-red-400">{error}</div>}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-[#C9A24D] hover:bg-[#d8b462] text-[#090B0E] rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  {submitting
                    ? 'Creating Demo Account...'
                    : 'Create Demo Account & Enter Landing Page'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};
