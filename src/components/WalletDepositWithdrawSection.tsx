import React, { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  History,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import type { DemoWalletState } from '../types/trading';

interface WalletDepositWithdrawSectionProps {
  wallet: DemoWalletState;
  liveEquity: number;
  deployedMargin: number;
  onDeposit: (amount: number, note?: string) => Promise<void>;
  onWithdraw: (amount: number, note?: string) => Promise<void>;
  onResetWallet?: (newBalance: number) => Promise<void>;
}

const DEPOSIT_PRESETS = [10000, 50000, 100000, 500000];
const WITHDRAW_PRESETS = [5000, 10000, 25000, 50000];

function fmt(val: number, decimals = 2): string {
  return val.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const WalletDepositWithdrawSection: React.FC<WalletDepositWithdrawSectionProps> = ({
  wallet,
  liveEquity,
  deployedMargin,
  onDeposit,
  onWithdraw,
  onResetWallet,
}) => {
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('UPI / Bank Deposit');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('Bank A/C Payout');
  const [busyAction, setBusyAction] = useState<'DEPOSIT' | 'WITHDRAW' | 'RESET' | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [resetInput, setResetInput] = useState('100000');

  const freeMargin = Math.max(0, liveEquity - deployedMargin);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    window.setTimeout(() => {
      setFeedback((cur) => (cur?.text === text ? null : cur));
    }, 4000);
  };

  const handleDepositAmount = async (amount: number, noteOverride?: string) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('err', 'Enter a valid deposit amount greater than 0.');
      return;
    }
    setBusyAction('DEPOSIT');
    try {
      await onDeposit(amount, noteOverride ?? depositNote);
      setDepositAmount('');
      showToast('ok', `Deposited +${fmt(amount, 0)} into your wallet.`);
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Deposit failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleWithdrawAmount = async (amount: number, noteOverride?: string) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('err', 'Enter a valid withdrawal amount greater than 0.');
      return;
    }
    if (amount > wallet.balance) {
      showToast(
        'err',
        `Insufficient wallet balance. Available to withdraw: ${fmt(wallet.balance, 2)}.`
      );
      return;
    }
    setBusyAction('WITHDRAW');
    try {
      await onWithdraw(amount, noteOverride ?? withdrawNote);
      setWithdrawAmount('');
      showToast('ok', `Withdrew -${fmt(amount, 0)} from your wallet.`);
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Withdrawal failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onResetWallet) return;
    const nextBal = Number(resetInput);
    if (!Number.isFinite(nextBal) || nextBal < 0) {
      showToast('err', 'Enter a valid non-negative balance.');
      return;
    }
    setBusyAction('RESET');
    try {
      await onResetWallet(nextBal);
      showToast('ok', `Wallet capital set to ${fmt(nextBal, 0)}.`);
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Wallet reset failed.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-white tracking-tight">
              Wallet · Deposit &amp; Withdrawal
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage wallet balance, instant deposits, and withdrawals
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowLedger((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <History className="w-3.5 h-3.5" />
          {showLedger ? 'Hide Ledger' : `Transactions (${wallet.recentDeposits.length})`}
        </button>
      </div>

      {/* Wallet Balance Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.06] border-b border-white/[0.06]">
        <div className="px-6 py-4">
          <div className="text-xs text-slate-400">Wallet Balance</div>
          <div className="font-mono-tabular text-2xl font-semibold text-white mt-1">
            {fmt(wallet.balance, 2)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Available funds</div>
        </div>

        <div className="px-6 py-4">
          <div className="text-xs text-slate-400">Live Total Equity</div>
          <div
            className={`font-mono-tabular text-2xl font-semibold mt-1 ${
              liveEquity >= wallet.balance ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {fmt(liveEquity, 2)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Wallet + P&amp;L</div>
        </div>

        <div className="px-6 py-4">
          <div className="text-xs text-slate-400">Free Margin</div>
          <div className="font-mono-tabular text-2xl font-semibold text-slate-100 mt-1">
            {fmt(freeMargin, 2)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono-tabular">
            Deployed: {fmt(deployedMargin, 0)}
          </div>
        </div>

        <div className="px-6 py-4">
          <div className="text-xs text-slate-400">Total Deposited</div>
          <div className="font-mono-tabular text-2xl font-semibold text-slate-100 mt-1">
            {fmt(wallet.totalAdded, 0)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Cumulative credits</div>
        </div>
      </div>

      {feedback && (
        <div
          className={`mx-6 mt-5 px-3.5 py-2.5 rounded-lg border text-xs flex items-center gap-2 ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-red-500/10 border-red-500/30 text-red-200'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Side-by-Side Deposit & Withdrawal Controls separated by hairline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.06]">
        {/* Deposit Column */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleDepositAmount(Number(depositAmount));
          }}
          className="p-6 space-y-3.5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <ArrowDownLeft className="w-4 h-4" />
              Deposit Funds
            </div>
            <span className="text-[11px] text-slate-500">Instant credit</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {DEPOSIT_PRESETS.map((amt) => (
              <button
                key={amt}
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleDepositAmount(amt, 'Quick Deposit')}
                className="px-2.5 py-1 text-[11px] font-mono-tabular font-medium bg-[#090B0E] hover:bg-emerald-600/20 border border-white/[0.08] hover:border-emerald-500/40 text-emerald-300 rounded-md transition-colors disabled:opacity-50"
              >
                +{amt.toLocaleString()}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              type="number"
              min="1"
              step="any"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Deposit amount"
              className="bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono-tabular text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <input
              type="text"
              maxLength={40}
              value={depositNote}
              onChange={(e) => setDepositNote(e.target.value)}
              placeholder="Method / note"
              className="bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={busyAction !== null || !depositAmount || Number(depositAmount) <= 0}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            {busyAction === 'DEPOSIT' ? 'Crediting Wallet...' : 'Deposit to Wallet'}
          </button>
        </form>

        {/* Withdrawal Column */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleWithdrawAmount(Number(withdrawAmount));
          }}
          className="p-6 space-y-3.5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <ArrowUpRight className="w-4 h-4" />
              Withdraw Funds
            </div>
            <span className="text-[11px] font-mono-tabular text-slate-400">
              Available: {fmt(wallet.balance, 0)}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {WITHDRAW_PRESETS.map((amt) => (
              <button
                key={amt}
                type="button"
                disabled={busyAction !== null || wallet.balance < amt}
                onClick={() => void handleWithdrawAmount(amt, 'Quick Withdrawal')}
                className="px-2.5 py-1 text-[11px] font-mono-tabular font-medium bg-[#090B0E] hover:bg-amber-600/20 border border-white/[0.08] hover:border-amber-500/40 text-amber-300 rounded-md transition-colors disabled:opacity-40"
              >
                -{amt.toLocaleString()}
              </button>
            ))}
            <button
              type="button"
              disabled={busyAction !== null || wallet.balance <= 0}
              onClick={() => setWithdrawAmount(String(wallet.balance))}
              className="px-2.5 py-1 text-[11px] font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-slate-300 rounded-md transition-colors disabled:opacity-40"
            >
              Max
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              type="number"
              min="1"
              step="any"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Withdraw amount"
              className="bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono-tabular text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            <input
              type="text"
              maxLength={40}
              value={withdrawNote}
              onChange={(e) => setWithdrawNote(e.target.value)}
              placeholder="Payout destination"
              className="bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <button
            type="submit"
            disabled={
              busyAction !== null ||
              !withdrawAmount ||
              Number(withdrawAmount) <= 0 ||
              Number(withdrawAmount) > wallet.balance
            }
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            {busyAction === 'WITHDRAW' ? 'Processing Withdrawal...' : 'Withdraw from Wallet'}
          </button>
        </form>
      </div>

      {/* Collapsible Wallet Ledger & Capital Reset */}
      {showLedger && (
        <div className="px-6 py-5 border-t border-white/[0.06] grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
          <div className="lg:col-span-7 space-y-2">
            <div className="font-semibold text-slate-200">
              Recent Deposit &amp; Withdrawal Ledger
            </div>
            {wallet.recentDeposits.length === 0 ? (
              <div className="text-slate-500">No wallet transactions recorded yet.</div>
            ) : (
              <div className="max-h-36 overflow-y-auto divide-y divide-white/[0.05] font-mono-tabular text-[11px]">
                {wallet.recentDeposits.map((entry, idx) => {
                  const isWithdraw = entry.includes(' | -');
                  return (
                    <div
                      key={`${entry}-${idx}`}
                      className={`py-1.5 ${
                        isWithdraw ? 'text-amber-300' : 'text-emerald-300'
                      }`}
                    >
                      {entry}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {onResetWallet && (
            <form
              onSubmit={handleResetSubmit}
              className="lg:col-span-5 flex flex-wrap items-end gap-2.5"
            >
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[11px] text-slate-400 mb-1.5">
                  Set / Reset Wallet Balance
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={resetInput}
                  onChange={(e) => setResetInput(e.target.value)}
                  className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono-tabular text-white"
                />
              </div>
              <button
                type="submit"
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Capital
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
};
