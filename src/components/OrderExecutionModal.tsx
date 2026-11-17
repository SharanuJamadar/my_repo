import React, { useState } from 'react';
import { AlertOctagon, ShieldAlert, X } from 'lucide-react';
import type { GeneratedSignalPayload, StrategyConfig, TradeMode } from '../types/trading';

interface OrderExecutionModalProps {
  signal: GeneratedSignalPayload;
  config: StrategyConfig;
  brokerConfigured: boolean;
  walletBalance?: number;
  onClose: () => void;
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
  brokerConfigured,
  walletBalance,
  onClose,
  onConfirmOrder,
}) => {
  const [executionMode, setExecutionMode] = useState<TradeMode>(
    config.paperTradingOnly ? 'PAPER' : 'LIVE'
  );
  const [quantity, setQuantity] = useState<number>(1);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'SL-M'>('LIMIT');
  const [expiry, setExpiry] = useState<string>('');
  const [userConfirmed, setUserConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userConfirmed || config.killSwitchActive) return;
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
            ? 'My Trade Paper Trading Engine'
            : config.brokerProviderLabel || 'Authorized Broker Adapter',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order execution failed');
    } finally {
      setSubmitting(false);
    }
  };

  const liveBlocked = executionMode === 'LIVE' && (config.paperTradingOnly || !brokerConfigured);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[#11141A] border border-white/[0.1] rounded-xl max-w-lg w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">Order Confirmation Desk</h3>
            <p className="text-xs text-slate-400">
              Explicit approval required · Default mode is Paper Trading
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close order modal"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {config.killSwitchActive && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2.5 text-xs text-red-300">
              <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Emergency Kill Switch is ACTIVE in Admin Settings. Disable it before executing any orders.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 bg-[#090B0E] border border-white/[0.08] rounded-lg p-3.5 text-xs">
            <div>
              <span className="text-slate-400">Instrument</span>
              <div className="font-semibold text-white mt-0.5">{signal.instrument}</div>
            </div>
            <div>
              <span className="text-slate-400">Contract</span>
              <div className="font-semibold text-white mt-0.5">{signal.contract}</div>
            </div>
            <div>
              <span className="text-slate-400">Side & Entry</span>
              <div className="font-mono-tabular font-semibold text-emerald-300 mt-0.5">
                {signal.direction} @ {signal.entryPrice}
              </div>
            </div>
            <div>
              <span className="text-slate-400">SL / Target 1</span>
              <div className="font-mono-tabular text-slate-200 mt-0.5">
                SL {signal.stopLoss} · T1 {signal.target1}
              </div>
            </div>
            {executionMode === 'PAPER' && walletBalance !== undefined && (
              <div className="col-span-2 pt-2 border-t border-white/[0.06] flex items-center justify-between">
                <span className="text-slate-400">
                  Demo Wallet: <span className="font-mono-tabular text-emerald-300">{walletBalance.toLocaleString()}</span>
                </span>
                <span className="text-slate-400">
                  Est. Value: <span className="font-mono-tabular text-white">{(signal.entryPrice * quantity).toLocaleString()}</span>
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Execution Mode</label>
              <div className="grid grid-cols-2 gap-1 bg-[#090B0E] border border-white/[0.08] rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setExecutionMode('PAPER')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                    executionMode === 'PAPER' ? 'bg-slate-800 text-white' : 'text-slate-400'
                  }`}
                >
                  PAPER
                </button>
                <button
                  type="button"
                  onClick={() => setExecutionMode('LIVE')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                    executionMode === 'LIVE' ? 'bg-red-600/80 text-white' : 'text-slate-400'
                  }`}
                >
                  LIVE
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Order Type</label>
              <select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT' | 'SL-M')}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="LIMIT">LIMIT</option>
                <option value="MARKET">MARKET</option>
                <option value="SL-M">SL-M</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Quantity / Lots</label>
              <input
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono-tabular text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Expiry (if F&O)</label>
              <input
                type="text"
                placeholder="e.g. 26 NOV 2026"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {liveBlocked && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2 text-xs text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {config.paperTradingOnly
                  ? 'Live order execution is locked because Paper Trading Only is enforced in Admin Settings.'
                  : 'Broker API credentials (BROKER_API_KEY / BROKER_API_SECRET) are not configured on the server. Live execution cannot proceed without broker authentication.'}
              </span>
            </div>
          )}

          <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={userConfirmed}
              onChange={(e) => setUserConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-slate-600 bg-[#090B0E] text-emerald-500"
            />
            <span>
              I have verified the instrument, contract, quantity, stop-loss ({signal.stopLoss}), and targets, and explicitly confirm placing this {executionMode} order.
            </span>
          </label>

          {error && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-slate-300 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!userConfirmed || submitting || config.killSwitchActive || liveBlocked}
              className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-40"
            >
              {submitting ? 'Submitting...' : `Confirm ${executionMode} Order`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
