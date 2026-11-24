import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlink,
  X,
} from 'lucide-react';
import {
  BROKER_APPS,
  BROKER_CATEGORY_LABELS,
  type BrokerAppMeta,
  type BrokerCategory,
} from '../lib/brokers';
import { authFetch } from '../lib/authFetch';
import { ExnessGuidePanel } from './ExnessGuidePanel';

interface BrokerConnectionCatalogItem {
  id: string;
  name: string;
  supportsOAuth: boolean;
  oauthAuthConfigured: boolean;
  envConfigured: boolean;
  connected: boolean;
  callbackUrl: string;
  portalUrl: string;
  developerPortalUrl: string;
  requiredEnvVars: string[];
}

interface BrokerOAuthSessionInfo {
  brokerId: string;
  brokerName: string;
  connectedAt: string;
  expiresAt: string;
  method: 'OAUTH_SESSION';
  tokenPreview: string;
}

interface BrokerConnectModalProps {
  currentBrokerLabel: string;
  brokerReadiness: Record<string, boolean>;
  onClose: () => void;
  onSelectBroker: (brokerProviderLabel: string) => Promise<void>;
  onConnectionsUpdated?: (readiness: Record<string, boolean>) => void;
}

const REAL_BROKERS = BROKER_APPS.filter((b) => b.id !== 'PAPER_ENGINE');

export const BrokerConnectModal: React.FC<BrokerConnectModalProps> = ({
  currentBrokerLabel,
  brokerReadiness,
  onClose,
  onSelectBroker,
  onConnectionsUpdated,
}) => {
  const initialSelected =
    REAL_BROKERS.find((b) => currentBrokerLabel.toLowerCase().includes(b.id.toLowerCase()))?.id ??
    REAL_BROKERS.find((b) => currentBrokerLabel.toLowerCase().includes(b.name.toLowerCase()))?.id ??
    'ZERODHA';

  const [selectedId, setSelectedId] = useState<string>(initialSelected);
  const [category, setCategory] = useState<'ALL' | BrokerCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [accountAlias, setAccountAlias] = useState('');
  const [saving, setSaving] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [copiedCallback, setCopiedCallback] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    tone: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);

  const [catalogById, setCatalogById] = useState<Record<string, BrokerConnectionCatalogItem>>({});
  const [oauthSessions, setOauthSessions] = useState<BrokerOAuthSessionInfo[]>([]);
  const [liveReadiness, setLiveReadiness] = useState<Record<string, boolean>>(brokerReadiness);

  const loadConnections = useCallback(async () => {
    try {
      const res = await authFetch('/api/brokers/connections');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.catalog)) {
        const nextMap: Record<string, BrokerConnectionCatalogItem> = {};
        for (const item of data.catalog) {
          nextMap[item.id] = item;
        }
        setCatalogById(nextMap);
      }
      if (Array.isArray(data.oauthSessions)) {
        setOauthSessions(data.oauthSessions);
      }
      if (data.brokers) {
        setLiveReadiness(data.brokers);
        onConnectionsUpdated?.(data.brokers);
      }
    } catch {
      // Keep existing brokerReadiness on transient error
    }
  }, [onConnectionsUpdated]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose]);

  // Listen for OAuth popup completion postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      const validOrigin =
        origin === window.location.origin ||
        origin.endsWith('.run.app') ||
        origin.includes('localhost');
      if (!validOrigin) return;

      const payload = event.data as {
        type?: string;
        brokerId?: string;
        brokerName?: string;
        message?: string;
      };
      if (!payload || typeof payload !== 'object') return;

      if (payload.type === 'BROKER_OAUTH_SUCCESS' && payload.brokerId) {
        setRedirecting(false);
        setSelectedId(payload.brokerId);
        setStatusMessage({
          tone: 'success',
          text: `${payload.brokerName || payload.brokerId} connected via OAuth redirect! Binding to your workspace...`,
        });
        void loadConnections().then(async () => {
          const cleanAlias = accountAlias.trim().slice(0, 28);
          const label = cleanAlias
            ? `${payload.brokerName || payload.brokerId} (${cleanAlias}) · OAuth Live`.slice(0, 80)
            : `${payload.brokerName || payload.brokerId} · OAuth Live`.slice(0, 80);
          try {
            await onSelectBroker(label);
            setStatusMessage({
              tone: 'success',
              text: `${payload.brokerName || payload.brokerId} is now live-linked and active in My Trade.`,
            });
          } catch {
            // Leave modal open if saving label fails
          }
        });
      } else if (payload.type === 'BROKER_OAUTH_ERROR') {
        setRedirecting(false);
        setStatusMessage({
          tone: 'error',
          text: payload.message || 'Trading app authorization was cancelled or failed.',
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [accountAlias, loadConnections, onSelectBroker]);

  const filteredBrokers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return REAL_BROKERS.filter((b) => {
      if (category !== 'ALL' && b.category !== category) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q) ||
        b.markets.toLowerCase().includes(q) ||
        b.authProtocol.toLowerCase().includes(q)
      );
    });
  }, [category, searchQuery]);

  const selectedBroker: BrokerAppMeta =
    REAL_BROKERS.find((b) => b.id === selectedId) ?? REAL_BROKERS[0];
  const selectedServerInfo = catalogById[selectedBroker.id];
  const activeOAuthSession = oauthSessions.find((s) => s.brokerId === selectedBroker.id);
  const hasServerCredentials = Boolean(
    liveReadiness[selectedBroker.id] || selectedServerInfo?.connected
  );
  const callbackUrl =
    selectedServerInfo?.callbackUrl ||
    `${window.location.origin}/auth/broker/callback/${selectedBroker.id}`;

  const handleRedirectConnect = async () => {
    setRedirecting(true);
    setStatusMessage(null);
    try {
      const res = await authFetch(`/api/brokers/oauth/url/${encodeURIComponent(selectedBroker.id)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Unable to initialize ${selectedBroker.name} connection.`);
      }

      const targetUrl: string = data.oauthConfigured ? data.authUrl : data.portalUrl;
      if (!targetUrl || !/^https:\/\//i.test(targetUrl)) {
        throw new Error(`Invalid redirect URL for ${selectedBroker.name}.`);
      }

      const popup = window.open(
        targetUrl,
        `mytrade_broker_${selectedBroker.id}`,
        'width=640,height=760,noopener=no,noreferrer=no'
      );

      if (!popup) {
        setRedirecting(false);
        setStatusMessage({
          tone: 'error',
          text: `Popup was blocked by your browser. Allow popups for this site or click "Open ${selectedBroker.name} Web Portal" directly.`,
        });
        return;
      }

      if (data.oauthConfigured) {
        setStatusMessage({
          tone: 'info',
          text: `Redirected to ${selectedBroker.name} OAuth login. Approve access in the popup window to connect automatically back to My Trade.`,
        });
      } else {
        setRedirecting(false);
        setStatusMessage({
          tone: 'info',
          text: selectedBroker.supportsOAuth
            ? `Opened ${selectedBroker.name}. To enable one-click OAuth callback auto-sync, add ${selectedBroker.envHint} in Settings → Secrets and register the Callback URL below in your ${selectedBroker.name} developer console.`
            : `Opened ${selectedBroker.name} trading portal in a new window. Click "Bind ${selectedBroker.name}" below to link it to your desk.`,
        });
      }
    } catch (err) {
      setRedirecting(false);
      setStatusMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Unable to launch trading app redirect.',
      });
    }
  };

  const handleDisconnectOAuth = async (brokerId: string) => {
    setDisconnectingId(brokerId);
    try {
      await authFetch(`/api/brokers/connections/${encodeURIComponent(brokerId)}`, {
        method: 'DELETE',
      });
      await loadConnections();
      setStatusMessage({
        tone: 'info',
        text: `Disconnected active OAuth session for ${selectedBroker.name}.`,
      });
    } finally {
      setDisconnectingId(null);
    }
  };

  const handleCopyCallback = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopiedCallback(true);
      setTimeout(() => setCopiedCallback(false), 2000);
    } catch {
      // Clipboard fallback ignored silently
    }
  };

  const handleBindBroker = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const cleanAlias = accountAlias.trim().slice(0, 28);
      const modeSuffix = activeOAuthSession
        ? 'OAuth Live'
        : hasServerCredentials
          ? 'Live Ready'
          : 'App Linked';
      const label = cleanAlias
        ? `${selectedBroker.name} (${cleanAlias}) · ${modeSuffix}`.slice(0, 80)
        : `${selectedBroker.name} · ${modeSuffix}`.slice(0, 80);

      await onSelectBroker(label);
      onClose();
    } catch (err) {
      setStatusMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Unable to save trading app connection.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0">
              <Link2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate">
                Connect Trading Apps · Universal Redirect &amp; OAuth Hub
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                18 Indian, Forex/MT5, Global, Crypto &amp; Charting apps — redirect to login and connect directly back to My Trade
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close broker modal"
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
          {/* Category Tabs + Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['ALL', 'INDIAN', 'FOREX', 'GLOBAL', 'CRYPTO', 'CHARTING'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    category === cat
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  {BROKER_CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>

            <div className="relative sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search trading app..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Trading Apps Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto pr-0.5">
            {filteredBrokers.map((app) => {
              const active = app.id === selectedId;
              const session = oauthSessions.find((s) => s.brokerId === app.id);
              const liveReady = Boolean(liveReadiness[app.id] || catalogById[app.id]?.connected);
              const oauthReady = Boolean(catalogById[app.id]?.oauthAuthConfigured);

              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(app.id);
                    setStatusMessage(null);
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    active
                      ? 'bg-emerald-50 dark:bg-emerald-500/12 border-emerald-500/60 ring-1 ring-emerald-500/25'
                      : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[10px] font-bold bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 shrink-0">
                      {app.shortCode}
                    </span>
                    <span
                      className={`text-[10px] font-semibold truncate ${
                        session || liveReady
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : oauthReady
                            ? 'text-sky-700 dark:text-sky-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {session
                        ? 'OAuth Live'
                        : liveReady
                          ? 'API Connected'
                          : app.supportsOAuth
                            ? 'OAuth Redirect'
                            : 'Web Portal'}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white mt-2 truncate">
                    {app.name}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {app.markets}
                  </div>
                </button>
              );
            })}
            {filteredBrokers.length === 0 && (
              <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No trading apps matched "{searchQuery}".
              </div>
            )}
          </div>

          {/* Selected Trading App Action & Redirect Panel */}
          <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {selectedBroker.name}
                  </h4>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                    {selectedBroker.authProtocol}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Supported Markets: {selectedBroker.markets}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRedirectConnect}
                  disabled={redirecting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-600 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  {redirecting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  )}
                  {selectedServerInfo?.oauthAuthConfigured
                    ? `Redirect & Connect ${selectedBroker.name}`
                    : selectedBroker.supportsOAuth
                      ? `Launch ${selectedBroker.name} & Connect`
                      : `Open ${selectedBroker.name} App`}
                </button>

                {selectedBroker.developerPortalUrl && (
                  <a
                    href={selectedBroker.developerPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg whitespace-nowrap"
                  >
                    API Console
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {activeOAuthSession && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>
                    Active OAuth Session connected at{' '}
                    <span className="font-mono-tabular">
                      {new Date(activeOAuthSession.connectedAt).toLocaleTimeString()}
                    </span>{' '}
                    (Token {activeOAuthSession.tokenPreview})
                  </span>
                </div>
                <button
                  type="button"
                  disabled={disconnectingId === selectedBroker.id}
                  onClick={() => handleDisconnectOAuth(selectedBroker.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#0E182A] border border-rose-200 dark:border-rose-500/35 text-rose-700 dark:text-rose-300 rounded-md hover:bg-rose-50 dark:hover:bg-rose-500/15"
                >
                  <Unlink className="w-3 h-3" />
                  Disconnect
                </button>
              </div>
            )}

            {/* OAuth Callback Redirect URI Box (for all OAuth-capable trading apps) */}
            {selectedBroker.supportsOAuth && (
              <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                    Redirect / Callback URL (Paste in {selectedBroker.name} Developer App Settings)
                  </span>
                  <span className="text-[10px] font-mono-tabular text-slate-500">
                    Env: {selectedBroker.envHint}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate px-3 py-1.5 rounded-lg bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-700 font-mono-tabular text-[11px] text-slate-800 dark:text-emerald-300">
                    {callbackUrl}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyCallback}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg shrink-0"
                  >
                    {copiedCallback ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy URL
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Exness MT5 Live Bridge Panel or Standard Security Note */}
            {selectedBroker.id === 'EXNESS' || selectedBroker.id === 'MT5' ? (
              <div className="pt-1">
                <ExnessGuidePanel compact />
              </div>
            ) : (
              <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  {hasServerCredentials
                    ? `${selectedBroker.name} credentials are verified on the server. Live execution and OAuth redirect sync are ready.`
                    : `API keys and OAuth client secrets are never entered in browser forms. Add ${selectedBroker.envHint} in Settings → Secrets to activate one-click OAuth auto-connect and live execution for ${selectedBroker.name}.`}
                </span>
              </div>
            )}
          </div>

          {/* Account Alias */}
          <div className="text-xs">
            <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              Desk / Account Label (Optional display label saved to your profile)
            </label>
            <input
              type="text"
              maxLength={28}
              value={accountAlias}
              onChange={(e) => setAccountAlias(e.target.value)}
              placeholder={
                selectedBroker.id === 'EXNESS'
                  ? 'e.g. Exness MT5 Real-14'
                  : `e.g. ${selectedBroker.name} Primary Desk`
              }
              className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {statusMessage && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                statusMessage.tone === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/35 text-emerald-800 dark:text-emerald-300'
                  : statusMessage.tone === 'error'
                    ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/35 text-rose-700 dark:text-rose-300'
                    : 'bg-blue-50 dark:bg-sky-500/10 border-blue-200 dark:border-sky-500/35 text-blue-800 dark:text-sky-300'
              }`}
            >
              {statusMessage.text}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-[#F4F6FA] dark:bg-[#08101E] flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Active Desk Binding:{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {currentBrokerLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-lg whitespace-nowrap"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleBindBroker}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : `Bind ${selectedBroker.name}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
