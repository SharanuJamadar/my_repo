import React, { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Server, ShieldCheck, Terminal, XCircle } from 'lucide-react';
import { authFetch } from '../lib/authFetch';

interface ExnessStatusResponse {
  configured: boolean;
  bridgeUrlValid: boolean;
  bridgeHost: string | null;
  serverName: string | null;
  accountMasked: string | null;
}

interface ExnessGuidePanelProps {
  compact?: boolean;
  onConnected?: () => void;
  onBalanceSync?: (info: { balance: number; currency: string; serverName?: string }) => void;
}

export const ExnessGuidePanel: React.FC<ExnessGuidePanelProps> = ({
  compact = false,
  onConnected,
  onBalanceSync,
}) => {
  const [status, setStatus] = useState<ExnessStatusResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    connected: boolean;
    message: string;
    balance?: number;
    currency?: string;
  } | null>(null);

  const loadStatus = async () => {
    try {
      const res = await authFetch('/api/brokers/exness/status');
      if (res.ok) {
        const data = (await res.json()) as ExnessStatusResponse;
        setStatus(data);
      }
    } catch {
      // ignore transient errors
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleTestBridge = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await authFetch('/api/brokers/exness/test', { method: 'POST' });
      const data = await res.json();
      setTestResult({
        connected: Boolean(data.connected),
        message: data.message || (data.connected ? 'Connected to Exness MT5 Bridge.' : 'Connection failed.'),
        balance: data.balance,
        currency: data.currency,
      });
      if (data.connected) {
        if (typeof data.balance === 'number' && onBalanceSync) {
          onBalanceSync({
            balance: data.balance,
            currency: typeof data.currency === 'string' ? data.currency : 'USD',
            serverName: typeof data.serverName === 'string' ? data.serverName : undefined,
          });
        }
        if (onConnected) {
          onConnected();
        }
      }
    } catch (err) {
      setTestResult({
        connected: false,
        message: err instanceof Error ? err.message : 'Unable to reach server test route.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-blue-700 dark:text-sky-400 font-medium">
            Actual Account · Exness API Integration
          </div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white mt-1">
            Connect Exness Web / App Trading Account via MT5 Execution Bridge
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed max-w-2xl">
            Exness Web Terminal and Exness Trade App do not expose a direct retail REST API key. Automated orders from My Trade connect securely to your exact Exness MT5 trading account (which syncs live inside Exness Web &amp; App) through an HTTPS MT5 Bridge.
          </p>
        </div>

        <button
          type="button"
          onClick={handleTestBridge}
          disabled={testing}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
          {testing ? 'Testing Bridge...' : 'Test Exness Connection'}
        </button>
      </div>

      {/* Live Server Secret Status Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-3">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Server Secret Status</div>
          <div
            className={`font-semibold mt-1 flex items-center gap-1.5 ${
              status?.configured ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            {status?.configured ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Server className="w-3.5 h-3.5 shrink-0" />
            )}
            {status?.configured ? 'Configured & Valid HTTPS' : 'Pending Server Secrets'}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-3">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Bridge Endpoint Host</div>
          <div className="font-mono-tabular text-slate-900 dark:text-white mt-1 truncate">
            {status?.bridgeHost || 'Not configured'}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-3">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Exness MT5 Server / Account</div>
          <div className="font-mono-tabular text-slate-900 dark:text-white mt-1 truncate">
            {status?.serverName || 'Exness-MT5Real*'}
            {status?.accountMasked ? ` · ${status.accountMasked}` : ''}
          </div>
        </div>
      </div>

      {testResult && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
            testResult.connected
              ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/35 text-emerald-800 dark:text-emerald-200'
              : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/35 text-amber-800 dark:text-amber-200'
          }`}
        >
          {testResult.connected ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700 dark:text-emerald-400" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          )}
          <div>
            <div>{testResult.message}</div>
            {testResult.balance !== undefined && (
              <div className="font-mono-tabular text-emerald-700 dark:text-emerald-300 mt-1">
                Verified Exness Equity: {testResult.currency || 'USD'}{' '}
                {testResult.balance.toLocaleString()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4-Step Guide */}
      <div className={`grid grid-cols-1 ${compact ? 'md:grid-cols-2' : 'lg:grid-cols-4'} gap-3 text-xs`}>
        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-1.5">
          <div className="font-mono-tabular text-[11px] text-blue-700 dark:text-sky-400">STEP 01</div>
          <div className="font-semibold text-slate-900 dark:text-white">Get Exness MT5 Credentials</div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            In Exness Personal Area (Web or App), open your Real or Trial <strong className="text-slate-800 dark:text-slate-200">MT5</strong> account → Account Information → copy your <strong className="text-slate-800 dark:text-slate-200">MT5 Login</strong>, <strong className="text-slate-800 dark:text-slate-200">Server</strong> (e.g. <span className="font-mono-tabular">Exness-MT5Real14</span>), and Trading Password.
          </p>
        </div>

        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-1.5">
          <div className="font-mono-tabular text-[11px] text-blue-700 dark:text-sky-400">STEP 02</div>
          <div className="font-semibold text-slate-900 dark:text-white">Launch an HTTPS MT5 Bridge</div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Connect your Exness MT5 login to a managed cloud bridge (such as <strong className="text-slate-800 dark:text-slate-200">MetaApi.cloud</strong>) or run a lightweight Python <span className="font-mono-tabular">MetaTrader5 + FastAPI</span> bridge on a Windows VPS exposing <span className="font-mono-tabular">/health</span>, <span className="font-mono-tabular">/orders</span>, and <span className="font-mono-tabular">/orders/modify-sl</span> over HTTPS.
          </p>
        </div>

        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-1.5">
          <div className="font-mono-tabular text-[11px] text-blue-700 dark:text-sky-400">STEP 03</div>
          <div className="font-semibold text-slate-900 dark:text-white">Add Server Secrets</div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            In app <strong className="text-slate-800 dark:text-slate-200">Settings → Secrets</strong> (never in the browser), add <span className="font-mono-tabular text-slate-800 dark:text-slate-200">EXNESS_BRIDGE_URL</span> (https://...), <span className="font-mono-tabular text-slate-800 dark:text-slate-200">EXNESS_API_TOKEN</span>, <span className="font-mono-tabular text-slate-800 dark:text-slate-200">EXNESS_ACCOUNT_ID</span>, and <span className="font-mono-tabular text-slate-800 dark:text-slate-200">EXNESS_SERVER</span>.
          </p>
        </div>

        <div className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-1.5">
          <div className="font-mono-tabular text-[11px] text-blue-700 dark:text-sky-400">STEP 04</div>
          <div className="font-semibold text-slate-900 dark:text-white">Verify &amp; Execute Live</div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Click <strong className="text-slate-800 dark:text-slate-200">Test Exness Connection</strong> above, switch to your signed-in <strong className="text-slate-800 dark:text-slate-200">Actual Account (LIVE)</strong>, and test with 0.01 lot first. Every trade appears instantly in Exness Web &amp; App with automatic 3-TP SL trailing.
          </p>
        </div>
      </div>

      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span>
              Security enforced: HTTPS-only bridge validation, private/local IP blocking, Bearer token stays strictly server-side.
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono-tabular text-slate-500">
            <Terminal className="w-3.5 h-3.5" />
            <span>POST /orders · POST /orders/modify-sl · GET /health</span>
          </div>
        </div>
      )}
    </div>
  );
};
