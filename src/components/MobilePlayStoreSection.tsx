import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Smartphone,
  Terminal,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const MobilePlayStoreSection: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [packageId, setPackageId] = useState('com.mytrade.terminal');
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [versionCode, setVersionCode] = useState('1');
  const [sha256Fingerprint, setSha256Fingerprint] = useState('');
  const [hostOrigin, setHostOrigin] = useState(() =>
    typeof window !== 'undefined' ? window.location.origin : 'https://ais-pre-ov3rkxqnf47kszfxixpfxg-346038098512.europe-west2.run.app'
  );
  const [copiedCmd, setCopiedCmd] = useState(false);

  const cleanHost = useMemo(() => {
    try {
      return new URL(hostOrigin).hostname;
    } catch {
      return hostOrigin.replace(/^https?:\/\//, '').split('/')[0] || 'mytrade.app';
    }
  }, [hostOrigin]);

  const twaManifestJson = useMemo(() => {
    const cleanOrigin = hostOrigin.replace(/\/+$/, '');
    return JSON.stringify(
      {
        packageId: packageId.trim() || 'com.mytrade.terminal',
        host: cleanHost,
        name: 'My Trade — AI Trading Terminal',
        launcherName: 'My Trade',
        display: 'standalone',
        themeColor: '#090B0E',
        themeColorDark: '#090B0E',
        navigationColor: '#090B0E',
        navigationColorDark: '#090B0E',
        navigationDividerColor: '#161A22',
        backgroundColor: '#090B0E',
        enableNotifications: true,
        startUrl: '/',
        iconUrl: `${cleanOrigin}/pwa-512x512.png`,
        maskableIconUrl: `${cleanOrigin}/pwa-maskable-512x512.png`,
        monochromeIconUrl: `${cleanOrigin}/pwa-192x192.png`,
        splashScreenFadeOutDuration: 300,
        signingKey: {
          path: './mytrade-upload-key.jks',
          alias: 'mytrade',
        },
        appVersionName: appVersion.trim() || '1.0.0',
        appVersionCode: Number(versionCode) || 1,
        shortcuts: [
          {
            name: 'Live Chart Terminal',
            shortName: 'Terminal',
            url: '/?view=terminal',
            chosenIconUrl: `${cleanOrigin}/pwa-192x192.png`,
          },
        ],
        generatorApp: 'bubblewrap-cli',
        webManifestUrl: `${cleanOrigin}/manifest.webmanifest`,
        fallbackType: 'customtabs',
        features: {
          playBilling: { enabled: false },
          locationDelegation: { enabled: false },
        },
        alphaDependencies: { enabled: false },
        enableSiteSettingsShortcut: true,
        isChromeOSOnly: false,
        isMetaQuest: false,
        orientation: 'default',
        fingerprints: sha256Fingerprint.trim() ? [sha256Fingerprint.trim()] : [],
      },
      null,
      2
    );
  }, [packageId, cleanHost, hostOrigin, appVersion, versionCode, sha256Fingerprint]);

  const assetLinksJson = useMemo(() => {
    const fp =
      sha256Fingerprint.trim() ||
      'REPLACE_WITH_YOUR_UPLOAD_KEY_SHA256_FINGERPRINT_FROM_PLAY_CONSOLE';
    return JSON.stringify(
      [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: packageId.trim() || 'com.mytrade.terminal',
            sha256_cert_fingerprints: [fp],
          },
        },
      ],
      null,
      2
    );
  }, [packageId, sha256Fingerprint]);

  const cliCommands = useMemo(() => {
    const cleanOrigin = hostOrigin.replace(/\/+$/, '');
    return `npm install -g @bubblewrap/cli
mkdir mytrade-android && cd mytrade-android
# Place the downloaded twa-manifest.json in this folder, or initialize directly:
npx @bubblewrap/cli init --manifest=${cleanOrigin}/manifest.webmanifest
npx @bubblewrap/cli build
# Output: app-release-bundle.aab (upload to Google Play Console > Production / Internal Testing)`;
  }, [hostOrigin]);

  const downloadJsonFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCommands = async () => {
    try {
      await navigator.clipboard.writeText(cliCommands);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2500);
    } catch {
      // Clipboard unavailable in insecure context
    }
  };

  return (
    <section className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
      <div className="px-6 py-5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Smartphone className="w-4 h-4 text-[#C9A24D] shrink-0" />
          <div>
            <h3 className="text-base font-semibold text-white">
              Mobile App &amp; Google Play Store Packaging
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Install My Trade as a standalone mobile/desktop app now, or generate the signed Android App Bundle (.aab) configuration for Google Play Console
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isInstalled ? (
            <span className="text-xs font-semibold text-emerald-400 inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Running as Installed App
            </span>
          ) : isInstallable ? (
            <button
              type="button"
              onClick={() => void install()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install App Now</span>
            </button>
          ) : isIOS ? (
            <span className="text-xs text-slate-300">
              iOS Safari: Share -&gt; Add to Home Screen
            </span>
          ) : (
            <span className="text-xs text-slate-400">
              PWA Ready · Open in Chrome/Edge on Android or Desktop to Install
            </span>
          )}
        </div>
      </div>

      {/* Live App Readiness Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 sm:divide-x divide-white/[0.06] border-b border-white/[0.06] text-xs">
        <div className="px-6 py-4">
          <div className="text-slate-400">Web App Manifest</div>
          <div className="font-semibold text-emerald-400 mt-1">Active (/manifest.webmanifest)</div>
        </div>
        <div className="px-6 py-4">
          <div className="text-slate-400">Android Adaptive Icons</div>
          <div className="font-semibold text-emerald-400 mt-1">192px · 512px · Maskable Ready</div>
        </div>
        <div className="px-6 py-4">
          <div className="text-slate-400">Offline Service Worker</div>
          <div className="font-semibold text-emerald-400 mt-1">Workbox Standalone Active</div>
        </div>
        <div className="px-6 py-4">
          <div className="text-slate-400">Digital Asset Links</div>
          <div className="font-semibold text-emerald-400 mt-1">/.well-known/assetlinks.json Live</div>
        </div>
      </div>

      {/* Play Store TWA Configurator */}
      <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
        <div className="lg:col-span-6 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-white">1. Android App Bundle (TWA) Settings</h4>
            <p className="text-slate-400 mt-0.5">
              Google Play Store uses Trusted Web Activity (TWA) to publish full-screen web apps as native Android `.aab` binaries.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Android Package ID</label>
              <input
                type="text"
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
                placeholder="com.mytrade.terminal"
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white focus:outline-none focus:border-[#C9A24D]"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Production App Origin URL</label>
              <input
                type="url"
                value={hostOrigin}
                onChange={(e) => setHostOrigin(e.target.value)}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white focus:outline-none focus:border-[#C9A24D]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Version Name</label>
              <input
                type="text"
                value={appVersion}
                onChange={(e) => setAppVersion(e.target.value)}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white focus:outline-none focus:border-[#C9A24D]"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Version Code</label>
              <input
                type="number"
                min={1}
                value={versionCode}
                onChange={(e) => setVersionCode(e.target.value)}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white focus:outline-none focus:border-[#C9A24D]"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">
              Play App Signing SHA-256 Fingerprint (optional until keystore created)
            </label>
            <input
              type="text"
              value={sha256Fingerprint}
              onChange={(e) => setSha256Fingerprint(e.target.value)}
              placeholder="AA:BB:CC:... (from keytool or Play Console > App Integrity)"
              className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white focus:outline-none focus:border-[#C9A24D]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => downloadJsonFile('twa-manifest.json', twaManifestJson)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold bg-[#C9A24D] hover:bg-[#d8b462] text-[#090B0E] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download twa-manifest.json</span>
            </button>
            <button
              type="button"
              onClick={() => downloadJsonFile('assetlinks.json', assetLinksJson)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download assetlinks.json</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-white">2. Build &amp; Upload to Google Play Console</h4>
              <p className="text-slate-400 mt-0.5">
                Direct Play Store submission requires your Google Play Developer account and signing keystore.
              </p>
            </div>
            <a
              href="https://play.google.com/console"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              <span>Play Console</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="bg-[#090B0E] border border-white/[0.08] rounded-lg p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                Android App Bundle (.aab) Build Commands
              </span>
              <button
                type="button"
                onClick={() => void handleCopyCommands()}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedCmd ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="font-mono-tabular text-[11px] text-slate-300 whitespace-pre-wrap break-all leading-relaxed">
              {cliCommands}
            </pre>
          </div>

          <div className="space-y-1.5 text-[11px] text-slate-400 leading-relaxed">
            <p>
              <strong className="text-slate-200">Step A:</strong> Publish your My Trade app and copy its public HTTPS URL (configured above).
            </p>
            <p>
              <strong className="text-slate-200">Step B:</strong> Run the Bubblewrap commands above locally to compile <span className="font-mono-tabular text-slate-200">app-release-bundle.aab</span> and generate your upload keystore.
            </p>
            <p>
              <strong className="text-slate-200">Step C:</strong> Add your SHA-256 fingerprint via <span className="font-mono-tabular text-slate-200">PLAYSTORE_PACKAGE_NAME</span> &amp; <span className="font-mono-tabular text-slate-200">PLAYSTORE_SHA256_FINGERPRINT</span> (or update <span className="font-mono-tabular text-slate-200">public/.well-known/assetlinks.json</span>) so the app opens borderless without a browser bar.
            </p>
            <p>
              <strong className="text-slate-200">Step D:</strong> Upload the signed <span className="font-mono-tabular text-slate-200">.aab</span> file inside your Google Play Console Developer account.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
