import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Download, ShieldCheck, Smartphone } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const MobilePlayStoreSection: React.FC = () => {
  const [apkSize, setApkSize] = useState<string>('');
  const [apkReady, setApkReady] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    fetch('/MyTrade.apk', { method: 'HEAD' })
      .then((res) => {
        if (!active) return;
        if (!res.ok) {
          setApkReady(false);
          return;
        }
        const len = Number(res.headers.get('content-length') || 0);
        if (len > 0) setApkSize(formatBytes(len));
        setApkReady(true);
      })
      .catch(() => {
        if (active) setApkReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Smartphone className="w-4 h-4 text-blue-700 dark:text-sky-400 shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">
              App Download
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Download the official My Trade Android APK directly to your mobile device
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-sky-400">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>In Play Store · Coming Soon</span>
        </span>
      </div>

      {/* Main Content */}
      <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Direct APK Download Card */}
        <div className="lg:col-span-7 bg-white dark:bg-[#0B1424] border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between gap-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt="My Trade App Icon"
                  className="w-11 h-11 rounded-xl border border-slate-300 dark:border-slate-700 object-cover shrink-0"
                />
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">My Trade</h3>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                    MyTrade.apk · v1.0.0 · Android 8.0+{apkSize ? ` · ${apkSize}` : ''}
                  </div>
                </div>
              </div>

              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Signed APK</span>
              </span>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Full-screen Android trading terminal with live charts, TradingView view, analyzer, watchlist, trade journal, and live free market news.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            {apkReady ? (
              <a
                href="/MyTrade.apk"
                download="MyTrade.apk"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Download APK (MyTrade.apk)</span>
              </a>
            ) : (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                APK package is currently preparing. Please refresh in a moment.
              </span>
            )}

            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>Direct install · No external store required</span>
            </span>
          </div>
        </div>

        {/* Play Store Status & Quick Android Install Steps */}
        <div className="lg:col-span-5 flex flex-col justify-between gap-4">
          <div className="bg-white dark:bg-[#0B1424] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-sky-400">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Google Play Store</span>
            </div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              In Play Store — Coming Soon
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Official Google Play Store listing is coming soon. Android users can install My Trade right away using the direct APK download.
            </p>
          </div>

          <div className="bg-white dark:bg-[#0B1424] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">How to Install APK on Android</div>
            <ol className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 list-decimal list-inside leading-relaxed">
              <li>
                Tap <strong className="text-slate-800 dark:text-slate-200">Download APK</strong> above to save <span className="font-mono-tabular text-slate-800 dark:text-slate-200">MyTrade.apk</span>.
              </li>
              <li>
                Open the downloaded file from your notification bar or Files app.
              </li>
              <li>
                Allow <strong className="text-slate-800 dark:text-slate-200">Install unknown apps</strong> if prompted, then tap <strong className="text-slate-800 dark:text-slate-200">Install</strong>.
              </li>
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
};
