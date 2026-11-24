import React, { useEffect, useState } from 'react';
import { AlertOctagon, ShieldAlert, X } from 'lucide-react';
import type { GeneratedSignalPayload, StrategyConfig, TradeMode } from '../types/trading';

interface OrderExecutionModalProps {
  signal: GeneratedSignalPayload;
  config: StrategyConfig;
  activeAccountType: 'LIVE' | 'DEMO';
  brokerConfigured: boolean;
  walletBalance?: number;
  onClose: () => void;
  onOpenBrokerModal: () => void;
  onConfirmOrder: (payload: {
    executionMode: TradeMode;
    quantity: number;
    orderType: 'MARKET' | 'LIMIT' | 'SL-M';
    expiry: string;
    brokerName: string;
  }) => Promise<void>;
}

export const OrderExecutionModal: React.FC<OrderExecutionModalProps> = ({
  signal,
  config,
  activeAccountType,
  brokerConfigured,
  walletBalance,
  onClose,
  onOpenBrokerModal,
  onConfirmOrder,
}) => {
  const executionMode: TradeMode = activeAccountType === 'LIVE' ? 'LIVE' : 'PAPER';
  const [quantity, setQuantity] = useState<number>(1);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'SL-M'>('LIMIT');
  const [expiry, setExpiry] = useState<string>('');
  const [userConfirmed, setUserConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [submitting, onClose]);

  const slDist = Math.abs(signal.entryPrice - signal.stopLoss);
  const dir = signal.direction === 'SELL' ? -1 : 1;
  const tp1 = signal.target1;
  const tp2 = signal.target2 || Number((signal.entryPrice + dir * slDist * 2.2).toFixed(4));
  const tp3 = signal.target3 || Number((signal.entryPrice + dir * slDist * 3.2).toFixed(4));

  const liveBlocked = executionMode === 'LIVE' && !brokerConfigured;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userConfirmed || config.killSwitchActive || liveBlocked) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirmOrder({
        executionMode,
        quantity,
        orderType,
        expiry,
        brokerName:
          executionMode === 'PAPER'
            ? 'My Trade Demo Paper Engine'
            : config.brokerProviderLabel || 'Exness MT5 Live Bridge',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order execution failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {executionMode === 'LIVE' ? 'Actual Account · Live Order Desk' : 'Demo Account · Paper Order Desk'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {executionMode === 'LIVE'
                ? 'Routes strictly to connected Live Broker / Exness MT5 Bridge'
                : 'Isolated paper execution · Zero real capital at risk'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order modal"
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {config.killSwitchActive && (
            <div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/35 rounded-lg flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
              <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Emergency Kill Switch is ACTIVE. Disable it in Account Settings before executing any orders.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Instrument</span>
              <div className="font-semibold text-slate-900 dark:text-white mt-0.5">{signal.instrument}</div>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Contract</span>
              <div className="font-semibold text-slate-900 dark:text-white mt-0.5 truncate">{signal.contract}</div>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Side &amp; Entry</span>
              <div
                className={`font-mono-tabular font-semibold mt-0.5 ${
                  signal.direction === 'BUY' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {signal.direction} @ {signal.entryPrice}
              </div>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Initial Stop Loss</span>
              <div className="font-mono-tabular text-rose-700 dark:text-rose-300 mt-0.5">{signal.stopLoss}</div>
            </div>
            <div className="col-span-2 pt-2.5 border-t border-slate-200 dark:border-slate-800 grid grid-cols-3 gap-2 font-mono-tabular">
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">TP1 (SL → Entry)</div>
                <div className="text-emerald-700 dark:text-emerald-300 font-semibold mt-0.5">{tp1}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">TP2 (SL → TP1)</div>
                <div className="text-emerald-700 dark:text-emerald-300 font-semibold mt-0.5">{tp2}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">TP3 (Full Exit)</div>
                <div className="text-blue-700 dark:text-sky-400 font-semibold mt-0.5">{tp3}</div>
              </div>
            </div>
            {executionMode === 'PAPER' && walletBalance !== undefined && (
              <div className="col-span-2 pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">
                  Demo Balance:{' '}
                  <span className="font-mono-tabular text-emerald-700 dark:text-emerald-300">
                    {walletBalance.toLocaleString()}
                  </span>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  Est. Notional:{' '}
                  <span className="font-mono-tabular text-slate-900 dark:text-white">
                    {(signal.entryPrice * quantity).toLocaleString()}
                  </span>
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Order Type</label>
              <select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT' | 'SL-M')}
                className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="LIMIT">LIMIT</option>
                <option value="MARKET">MARKET</option>
                <option value="SL-M">SL-M</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Quantity / Lots</label>
              <input
                type="number"
                min={0.01}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(0.01, Number(e.target.value)))}
                className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Expiry (F&amp;O)</label>
              <input
                type="text"
                placeholder="Optional"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Built-in Risk % & Position Size Calculator */}
          <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                Smart Risk % Sizing {walletBalance ? `(Base ${walletBalance.toLocaleString()})` : ''}
              </span>
              <div className="flex items-center gap-1">
                {[0.5, 1, 2, 3, 5].map((pct) => {
                  const baseCap = Math.max(1000, walletBalance ?? 100000);
                  const calcQty = () => {
                    if (slDist <= 0 || signal.entryPrice <= 0) return;
                    const riskAmt = baseCap * (pct / 100);
                    const raw = riskAmt / Math.max(slDist, signal.entryPrice * 0.001);
                    const maxNotional = (baseCap * 6) / signal.entryPrice;
                    const bounded = Math.max(0.01, Math.min(raw, maxNotional));
                    setQuantity(bounded >= 10 ? Math.round(bounded) : Number(bounded.toFixed(2)));
                  };
                  return (
                    <button
                      key={pct}
                      type="button"
                      onClick={calcQty}
                      className="px-2 py-0.5 text-[11px] font-mono-tabular font-medium rounded bg-white dark:bg-[#0E182A] hover:bg-blue-50 dark:hover:bg-sky-500/15 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-blue-700 dark:hover:text-sky-300 transition-colors"
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 font-mono-tabular text-[11px]">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Max Risk @ SL</div>
                <div className="text-rose-700 dark:text-rose-400 font-semibold mt-0.5">
                  -{(slDist * quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Est. @ TP2</div>
                <div className="text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                  +{(Math.abs(tp2 - signal.entryPrice) * quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Est. @ TP3</div>
                <div className="text-blue-700 dark:text-sky-400 font-semibold mt-0.5">
                  +{(Math.abs(tp3 - signal.entryPrice) * quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          {liveBlocked && (
            <div className="p-3.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/35 rounded-lg space-y-2 text-xs text-amber-800 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                <span>
                  Live order routing is locked until Exness MT5 Bridge (<span className="font-mono-tabular">EXNESS_BRIDGE_URL</span> + <span className="font-mono-tabular">EXNESS_API_TOKEN</span>) or another authorized broker secret is configured on the server.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenBrokerModal();
                }}
                className="text-xs font-semibold text-slate-900 dark:text-white underline underline-offset-4 hover:text-emerald-700 dark:hover:text-emerald-300"
              >
                Open Exness &amp; Broker Connection Guide →
              </button>
            </div>
          )}

          <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={userConfirmed}
              onChange={(e) => setUserConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 dark:border-slate-700 bg-[#F4F6FA] dark:bg-[#08101E] text-emerald-500"
            />
            <span>
              I confirm placing this <strong className="text-slate-900 dark:text-white">{executionMode}</strong> order with Initial SL {signal.stopLoss} and stepped SL trailing across TP1 ({tp1}), TP2 ({tp2}), and TP3 ({tp3}).
            </span>
          </label>

          {error && (
            <div className="p-2.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/35 rounded-lg text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!userConfirmed || submitting || config.killSwitchActive || liveBlocked}
              className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors disabled:opacity-40 ${
                executionMode === 'LIVE'
                  ? 'bg-blue-700 dark:bg-sky-500 hover:bg-blue-800 dark:hover:bg-sky-400 text-white dark:text-slate-950'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {submitting
                ? 'Submitting...'
                : executionMode === 'LIVE'
                  ? 'Confirm Live Broker Order'
                  : 'Confirm Demo Paper Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
