import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, Wallet, X } from 'lucide-react';

interface AuthLoginModalProps {
  open: boolean;
  authLoading: boolean;
  authError: string | null;
  intent: 'LIVE' | 'DEMO' | 'GENERAL';
  onClose: () => void;
  onGoogleSignIn: (targetMode: 'LIVE' | 'DEMO' | 'GENERAL') => Promise<void>;
  onContinueDemoGuest: () => void;
}

function formatFriendlyAuthError(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes('popup-closed-by-user')) {
    return 'Google sign-in popup was closed before finishing. Click Continue with Google to try again.';
  }
  if (lower.includes('popup-blocked')) {
    return 'Your browser blocked the Google sign-in popup. Please allow popups for this site and retry.';
  }
  if (lower.includes('cancelled-popup-request')) {
    return 'A previous sign-in popup was cancelled. Click Continue with Google once to sign in.';
  }
  if (lower.includes('unauthorized-domain')) {
    return 'This preview domain is not yet authorized in Firebase Auth settings. You can still launch the isolated Demo Account below.';
  }
  if (lower.includes('network-request-failed')) {
    return 'Network error contacting Google Sign-In. Check your internet connection and retry.';
  }
  return raw;
}

export const AuthLoginModal: React.FC<AuthLoginModalProps> = ({
  open,
  authLoading,
  authError,
  intent,
  onClose,
  onGoogleSignIn,
  onContinueDemoGuest,
}) => {
  const [selectedTarget, setSelectedTarget] = useState<'LIVE' | 'DEMO'>(
    intent === 'LIVE' ? 'LIVE' : 'DEMO'
  );

  useEffect(() => {
    if (open) {
      setSelectedTarget(intent === 'LIVE' ? 'LIVE' : 'DEMO');
    }
  }, [open, intent]);

  // Escape key closes the sign-in modal cleanly
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !authLoading) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, authLoading, onClose]);

  if (!open) return null;

  const effectiveTarget: 'LIVE' | 'DEMO' =
    intent === 'LIVE' ? 'LIVE' : intent === 'DEMO' ? 'DEMO' : selectedTarget;
  const friendlyError = formatFriendlyAuthError(authError);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => {
        if (!authLoading) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div
        className="bg-white dark:bg-[#0E182A] border border-slate-300 dark:border-slate-700 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-blue-700 dark:text-sky-400 font-medium">
              My Trade Authentication
            </div>
            <h2
              id="auth-modal-title"
              className="font-landing-display text-xl font-bold tracking-[-0.02em] text-slate-900 dark:text-white mt-0.5"
            >
              {intent === 'LIVE'
                ? 'Sign In for Actual Account'
                : intent === 'DEMO'
                  ? 'Sign In for Demo Account'
                  : 'Sign In to My Trade'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={authLoading}
            aria-label="Close sign in dialog"
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {effectiveTarget === 'LIVE'
              ? 'Actual live trading accounts require verified Google authentication so your broker routing, live P&L ledger, and 3-TP trailing logs stay strictly isolated from Demo practice funds.'
              : 'Sign in with Google to sync your Demo Account balance, Pine strategies, and Trade Journal across devices — strictly isolated from any Real/Live broker execution.'}
          </p>

          {/* Interactive Account Target Selector (when opened via general Sign In) or Locked Mode Indicator */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <button
              type="button"
              disabled={intent === 'DEMO'}
              onClick={() => setSelectedTarget('LIVE')}
              className={`rounded-xl p-3.5 space-y-1.5 border text-left transition-all ${
                effectiveTarget === 'LIVE'
                  ? 'bg-emerald-50 dark:bg-emerald-500/12 border-emerald-500/60 ring-1 ring-emerald-500/25'
                  : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              } disabled:opacity-45 disabled:cursor-not-allowed`}
            >
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Actual Account</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Verified login · Live broker &amp; Exness MT5 bridge · Isolated live P&amp;L.
              </p>
            </button>

            <button
              type="button"
              disabled={intent === 'LIVE'}
              onClick={() => setSelectedTarget('DEMO')}
              className={`rounded-xl p-3.5 space-y-1.5 border text-left transition-all ${
                effectiveTarget === 'DEMO'
                  ? 'bg-amber-50 dark:bg-amber-500/12 border-amber-500/60 ring-1 ring-amber-500/25'
                  : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              } disabled:opacity-45 disabled:cursor-not-allowed`}
            >
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-semibold">
                <Wallet className="w-4 h-4 shrink-0" />
                <span>Demo Account</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Separate virtual sandbox · 100,000 paper balance · Zero capital risk.
              </p>
            </button>
          </div>

          {friendlyError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/35 rounded-lg text-xs text-rose-700 dark:text-rose-300">
              {friendlyError}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => void onGoogleSignIn(effectiveTarget)}
              disabled={authLoading}
              className="w-full py-3 px-4 bg-white hover:bg-slate-50 border border-slate-300 dark:border-transparent text-slate-900 text-sm font-semibold rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2.5 disabled:opacity-50"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                />
                <path
                  fill="#34A853"
                  d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
                />
                <path
                  fill="#EA4335"
                  d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                />
              </svg>
              {authLoading
                ? 'Signing in with Google...'
                : effectiveTarget === 'LIVE'
                  ? 'Continue with Google → Actual Account'
                  : 'Continue with Google → Demo Account'}
            </button>

            <button
              type="button"
              onClick={onContinueDemoGuest}
              disabled={authLoading}
              className="w-full py-2.5 px-4 bg-slate-100 dark:bg-[#152238] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {intent === 'LIVE'
                ? 'Switch to Isolated Demo Account Instead (Paper Only)'
                : 'Launch Demo Account as Guest (Paper Only)'}
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
            <Lock className="w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <span>
              Firebase Authentication protects your account · Press Esc to close.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
