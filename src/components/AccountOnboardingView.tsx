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
import {
  BROKER_APPS,
  BROKER_CATEGORY_LABELS,
  type BrokerCategory,
} from '../lib/brokers';
import { authFetch } from '../lib/authFetch';
import {
  INSTRUMENTS,
  type AccountProfileSettings,
  type Timeframe,
} from '../types/trading';
import { ExnessGuidePanel } from './ExnessGuidePanel';

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
  const [brokerCategory, setBrokerCategory] = useState<'ALL' | BrokerCategory>('ALL');
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>(() => {
    const matched = REAL_BROKERS.find(
      (b) =>
        currentBrokerLabel.toLowerCase().includes(b.id.toLowerCase()) ||
        currentBrokerLabel.toLowerCase().includes(b.name.toLowerCase())
    );
    return matched?.id ?? 'ZERODHA';
  });
  const [brokerAlias, setBrokerAlias] = useState('');
  const [redirectNote, setRedirectNote] = useState<string | null>(null);

  const visibleBrokers =
    brokerCategory === 'ALL'
      ? REAL_BROKERS
      : REAL_BROKERS.filter((b) => b.category === brokerCategory);

  const handleLaunchBrokerRedirect = async () => {
    setError(null);
    setRedirectNote(null);
    try {
      const res = await authFetch(`/api/brokers/oauth/url/${encodeURIComponent(selectedBrokerId)}`);
      const data = await res.json();
      const targetUrl: string = data?.oauthConfigured ? data.authUrl : selectedBroker.portalUrl;
      if (!targetUrl || !/^https:\/\//i.test(targetUrl)) {
        setError('Unable to resolve redirect URL for this trading app.');
        return;
      }
      const win = window.open(
        targetUrl,
        `mytrade_onboard_${selectedBrokerId}`,
        'width=640,height=760'
      );
      if (!win) {
        setError('Popup blocked by browser. Allow popups or use the Open Portal link.');
        return;
      }
      setRedirectNote(
        data?.oauthConfigured
          ? `Redirected to ${selectedBroker.name} OAuth login. Complete sign-in in the popup to connect automatically.`
          : `Opened ${selectedBroker.name}. After logging in, click Connect below to bind your desk.`
      );
    } catch {
      setError('Could not launch trading app redirect.');
    }
  };

  // Demo Account registration state (do NOT pre-show any wallet)
  const [fullName, setFullName] = useState(
    initialProfile.displayName &&
      initialProfile.displayName !== 'Sharan Trader' &&
      initialProfile.displayName !== 'My Trade Trader'
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
        displayName: (fullName.trim() || userDisplayName || 'My Trade Trader').slice(0, 100),
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
    <div className="min-h-screen bg-[#F4F6FA] dark:bg-[#08101E] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1424] px-6 lg:px-10 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={onBackToLanding}
          className="font-landing-display text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          My Trade
        </button>

        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Landing Page
          </button>
          {isSignedIn && (
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
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
            <div className="text-xs font-medium text-blue-700 dark:text-sky-400">Account Access Setup</div>
            <h1 className="font-landing-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-[-0.025em] text-balance">
              Choose how you would like to trade with My Trade
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
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
                  : 'bg-white dark:bg-[#0E182A] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Link2 className="w-5 h-5 text-blue-700 dark:text-sky-400" />
                  <span className="text-xs font-medium text-blue-700 dark:text-sky-300">Brokerage Integration</span>
                </div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Connect Trading App</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Link Groww, Exness, Upstox, Zerodha Kite, Dhan, Angel One, or Binance to route
                  supported instruments directly from your My Trade workspace.
                </p>
              </div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-white pt-3 border-t border-slate-200 dark:border-slate-800">
                <span>{selectedPath === 'BROKER' ? 'Selected — Configure Below' : 'Choose Trading App'}</span>
                <ArrowRight className="w-4 h-4 text-blue-700 dark:text-sky-400" />
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
                  ? 'bg-blue-50 dark:bg-sky-500/[0.09] border-blue-500 dark:border-sky-400'
                  : 'bg-white dark:bg-[#0E182A] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <UserPlus className="w-5 h-5 text-blue-700 dark:text-sky-400" />
                  <span className="text-xs font-medium text-blue-700 dark:text-sky-400">Paper Trading Desk</span>
                </div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create Demo Account</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Register a new Demo Account using your full name, mobile number, and email to
                  test strategies, Pine bots, and live P&amp;L simulations safely.
                </p>
              </div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-white pt-3 border-t border-slate-200 dark:border-slate-800">
                <span>{selectedPath === 'DEMO' ? 'Selected — Enter Details Below' : 'Register Demo Account'}</span>
                <ArrowRight className="w-4 h-4 text-blue-700 dark:text-sky-400" />
              </div>
            </button>
          </div>

          {/* Step 2A: Connect Trading App Panel */}
          {selectedPath === 'BROKER' && (
            <form
              onSubmit={handleConfirmBroker}
              className="bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-xl p-6 space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Select Your Trading App ({REAL_BROKERS.length} Supported)</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Redirect to your trading app to connect or bind your execution profile.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLaunchBrokerRedirect}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-700 hover:bg-blue-600 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 rounded-lg whitespace-nowrap"
                  >
                    Redirect &amp; Connect {selectedBroker.name}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(['ALL', 'INDIAN', 'FOREX', 'GLOBAL', 'CRYPTO', 'CHARTING'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setBrokerCategory(cat)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                      brokerCategory === cat
                        ? 'bg-blue-700 dark:bg-sky-500 border-blue-700 dark:border-sky-500 text-white dark:text-slate-950'
                        : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {BROKER_CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-0.5">
                {visibleBrokers.map((app) => {
                  const active = app.id === selectedBrokerId;
                  const liveReady = Boolean(brokerReadiness[app.id]);
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => {
                        setSelectedBrokerId(app.id);
                        setRedirectNote(null);
                      }}
                      className={`p-3.5 rounded-lg border text-left transition-colors ${
                        active
                          ? 'bg-blue-50 dark:bg-sky-500/10 border-sky-400/50'
                          : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">{app.name}</span>
                        <span
                          className={`text-[11px] font-medium shrink-0 ${
                            liveReady ? 'text-emerald-700 dark:text-emerald-400' : 'text-blue-700 dark:text-sky-300'
                          }`}
                        >
                          {liveReady ? 'Live Ready' : app.supportsOAuth ? 'OAuth Redirect' : 'Web Portal'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">{app.markets}</div>
                    </button>
                  );
                })}
              </div>

              {redirectNote && (
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-sky-500/10 border border-blue-200 dark:border-sky-500/35 text-xs text-blue-800 dark:text-sky-300">
                  {redirectNote}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">
                    Desk / Account Alias (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={28}
                    value={brokerAlias}
                    onChange={(e) => setBrokerAlias(e.target.value)}
                    placeholder={`e.g. ${selectedBroker.name} Primary Desk`}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-sky-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1">Trader Name (Optional)</label>
                  <input
                    type="text"
                    maxLength={100}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your display name"
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>

              {selectedBroker.id === 'EXNESS' ? (
                <ExnessGuidePanel compact />
              ) : (
                <div className="flex items-start gap-2.5 text-xs text-slate-500 dark:text-slate-400 bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    {hasServerCredentials
                      ? `${selectedBroker.name} server credentials (${selectedBroker.envHint}) are verified on this server.`
                      : `No broker API secrets are stored in browser inputs. Add ${selectedBroker.envHint} in server Settings → Secrets to enable live order routing.`}
                  </span>
                </div>
              )}

              {error && <div className="text-xs text-rose-700 dark:text-rose-400">{error}</div>}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  {submitting
                    ? 'Connecting...'
                    : `Connect ${selectedBroker.name} & Enter Trading Desk`}
                </button>
              </div>
            </form>
          )}

          {/* Step 2B: Create Demo Account Form (Mobile Number + Email + Details) */}
          {selectedPath === 'DEMO' && (
            <form
              onSubmit={handleSubmitDemoAccount}
              className="bg-white dark:bg-[#0E182A] border border-blue-200 dark:border-sky-500/35 rounded-xl p-6 space-y-5"
            >
              <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">Create Your Demo Account</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Enter your trader profile, mobile number, and email address to activate your demo
                  account and proceed to the main landing page.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 mb-1.5 font-medium">
                    Full Name <span className="text-rose-700 dark:text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Aarav Mehta"
                      className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-300 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 mb-1.5 font-medium">
                    Mobile Number <span className="text-rose-700 dark:text-rose-400">*</span>
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
                      className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-300 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2.5 font-mono-tabular text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 mb-1.5 font-medium">
                    Email Address <span className="text-rose-700 dark:text-rose-400">*</span>
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
                      className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-300 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-1">
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1.5">
                    Starting Demo Capital Allocation
                  </label>
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={startingCapital}
                    onChange={(e) => setStartingCapital(e.target.value)}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2.5 font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {[50000, 100000, 500000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setStartingCapital(String(amt))}
                        className="px-2 py-1 text-[11px] font-mono-tabular bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded"
                      >
                        {amt.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1.5">Primary Market</label>
                  <select
                    value={defaultInstrumentId}
                    onChange={(e) => setDefaultInstrumentId(e.target.value)}
                    className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                  >
                    {INSTRUMENTS.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.symbol} ({inst.exchangeLabel})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-500 dark:text-slate-400 mb-1.5">Risk Tier &amp; Timeframe</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={riskProfile}
                      onChange={(e) =>
                        setRiskProfile(
                          e.target.value as 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE'
                        )
                      }
                      className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2.5 text-slate-900 dark:text-white"
                    >
                      <option value="CONSERVATIVE">Conservative</option>
                      <option value="BALANCED">Balanced</option>
                      <option value="AGGRESSIVE">Aggressive</option>
                    </select>
                    <select
                      value={defaultTimeframe}
                      onChange={(e) => setDefaultTimeframe(e.target.value as Timeframe)}
                      className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2.5 text-slate-900 dark:text-white"
                    >
                      <option value="5m">5M</option>
                      <option value="15m">15M</option>
                      <option value="1h">1H</option>
                    </select>
                  </div>
                </div>
              </div>

              {error && <div className="text-xs text-rose-700 dark:text-rose-400">{error}</div>}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-blue-700 dark:bg-sky-500 hover:bg-blue-800 dark:hover:bg-sky-400 text-white dark:text-slate-950 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  {submitting
                    ? 'Creating Demo Account...'
                    : 'Create Demo Account & Enter Trading Desk'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};
