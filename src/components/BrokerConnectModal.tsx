import React, { useState } from 'react';
import { Check, ExternalLink, Link2, ShieldCheck, X } from 'lucide-react';
import { BROKER_APPS, type BrokerAppMeta } from '../lib/brokers';
import { ExnessGuidePanel } from './ExnessGuidePanel';

interface BrokerConnectModalProps {
  currentBrokerLabel: string;
  brokerReadiness: Record<string, boolean>;
  onClose: () => void;
  onSelectBroker: (brokerProviderLabel: string) => Promise<void>;
}

export const BrokerConnectModal: React.FC<BrokerConnectModalProps> = ({
  currentBrokerLabel,
  brokerReadiness,
  onClose,
  onSelectBroker,
}) => {
  const initialSelected =
    BROKER_APPS.find((b) => currentBrokerLabel.toLowerCase().includes(b.id.toLowerCase()))?.id ??
    BROKER_APPS.find((b) => currentBrokerLabel.toLowerCase().includes(b.name.toLowerCase()))?.id ??
    'EXNESS';

  const [selectedId, setSelectedId] = useState<string>(initialSelected);
  const [accountAlias, setAccountAlias] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBroker: BrokerAppMeta =
    BROKER_APPS.find((b) => b.id === selectedId) ?? BROKER_APPS[0];
  const hasServerCredentials = Boolean(brokerReadiness[selectedBroker.id]);

  const handleConnect = async () => {
    setSaving(true);
    setError(null);
    try {
      const cleanAlias = accountAlias.trim().slice(0, 28);
      const modeSuffix =
        selectedBroker.id === 'PAPER_ENGINE'
          ? 'Demo Paper Engine'
          : hasServerCredentials
            ? 'Live Ready'
            : 'Bridge Pending';
      const label = cleanAlias
        ? `${selectedBroker.name} (${cleanAlias}) · ${modeSuffix}`.slice(0, 80)
        : `${selectedBroker.name} · ${modeSuffix}`.slice(0, 80);

      await onSelectBroker(label);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save trading app connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Actual Account · Broker &amp; Exness API Hub</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Connect Exness MT5 Bridge, Groww, Upstox, Zerodha, Dhan, Angel One, or Binance
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close broker modal"
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {BROKER_APPS.filter((b) => b.id !== 'PAPER_ENGINE').map((app) => {
              const active = app.id === selectedId;
              const liveReady = Boolean(brokerReadiness[app.id]);
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedId(app.id)}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    active
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/35'
                      : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">{app.name}</span>
                  </div>
                  <div
                    className={`text-[10px] font-medium mt-1 ${
                      liveReady ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {liveReady ? 'Live Connected' : 'Setup Secrets'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">{app.authProtocol}</div>
                </button>
              );
            })}
          </div>

          {selectedBroker.id === 'EXNESS' ? (
            <ExnessGuidePanel compact />
          ) : (
            <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white">{selectedBroker.name} Configuration</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Markets: {selectedBroker.markets}
                  </div>
                </div>
                {selectedBroker.portalUrl && (
                  <a
                    href={selectedBroker.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-blue-700 dark:text-sky-300 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Open {selectedBroker.name}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  {hasServerCredentials
                    ? `Server credentials (${selectedBroker.envHint}) are verified. Live execution is ready in your Actual Trading Account.`
                    : `Broker API keys never enter browser forms. Add ${selectedBroker.envHint} in Settings → Secrets on the server to activate live order routing for ${selectedBroker.name}.`}
                </span>
              </div>
            </div>
          )}

          <div className="text-xs">
            <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              Desk / Account Label (Optional non-secret display label)
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

          {error && <div className="text-xs text-rose-700 dark:text-rose-400">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-[#F4F6FA] dark:bg-[#08101E] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-lg whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConnect}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : `Bind ${selectedBroker.name}`}
          </button>
        </div>
      </div>
    </div>
  );
};
