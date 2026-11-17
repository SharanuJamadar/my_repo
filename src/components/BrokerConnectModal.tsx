import React, { useState } from 'react';
import { Check, ExternalLink, Link2, ShieldCheck, X } from 'lucide-react';
import { BROKER_APPS, type BrokerAppMeta } from '../lib/brokers';

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
    BROKER_APPS.find((b) => currentBrokerLabel.toLowerCase().includes(b.name.toLowerCase()))?.id ??
    'PAPER_ENGINE';

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
          ? 'Instant Demo'
          : hasServerCredentials
            ? 'Live Ready'
            : 'Paper-Linked';
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
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[#11141A] border border-white/[0.1] rounded-xl max-w-2xl w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-white">Connect Trading App / Broker</h3>
              <p className="text-[11px] text-slate-400">
                Link Groww, Exness, Upstox, Zerodha, Dhan, Angel One, Binance, or Paper Engine
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close broker modal"
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {BROKER_APPS.map((app) => {
              const active = app.id === selectedId;
              const liveReady = Boolean(brokerReadiness[app.id]);
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedId(app.id)}
                  className={`p-3.5 rounded-lg border text-left transition-colors ${
                    active
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : 'bg-[#090B0E] border-white/[0.08] hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">{app.name}</span>
                    <span
                      className={`text-[11px] font-medium ${
                        app.id === 'PAPER_ENGINE'
                          ? 'text-emerald-400'
                          : liveReady
                            ? 'text-emerald-400'
                            : 'text-sky-300'
                      }`}
                    >
                      {app.id === 'PAPER_ENGINE'
                        ? 'Demo Active'
                        : liveReady
                          ? 'Server Ready'
                          : 'Paper-Linked'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 truncate">{app.markets}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{app.authProtocol}</div>
                </button>
              );
            })}
          </div>

          <div className="bg-[#090B0E] border border-white/[0.08] rounded-lg p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-white">{selectedBroker.name} Configuration</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Supported Markets: {selectedBroker.markets}
                </div>
              </div>
              {selectedBroker.portalUrl && (
                <a
                  href={selectedBroker.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-sky-300 rounded-lg whitespace-nowrap shrink-0"
                >
                  Open {selectedBroker.name} Terminal
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Account / Desk Label (Optional non-secret identifier)
              </label>
              <input
                type="text"
                maxLength={28}
                value={accountAlias}
                onChange={(e) => setAccountAlias(e.target.value)}
                placeholder={
                  selectedBroker.id === 'EXNESS'
                    ? 'e.g. Exness MT5 Pro'
                    : selectedBroker.id === 'GROWW'
                      ? 'e.g. Groww F&O Desk'
                      : 'e.g. Main Account'
                }
                className="w-full bg-[#11141A] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-start gap-2 text-[11px] text-slate-400 pt-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                {selectedBroker.id === 'PAPER_ENGINE'
                  ? 'My Trade Paper Engine executes instantly against your Demo Trading Wallet with live mark-to-market P&L.'
                  : hasServerCredentials
                    ? `Server credentials (${selectedBroker.envHint}) are detected. Live execution can be enabled via Order Confirmation.`
                    : `No broker API secrets are stored in browser inputs. Connecting links ${selectedBroker.name} to your account profile in Paper-Linked mode; configure ${selectedBroker.envHint} in server environment secrets when ready for live routing.`}
              </span>
            </div>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="px-5 py-3.5 border-t border-white/[0.08] bg-[#090B0E] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-slate-300 rounded-lg whitespace-nowrap"
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
            {saving ? 'Connecting...' : `Connect ${selectedBroker.name}`}
          </button>
        </div>
      </div>
    </div>
  );
};
