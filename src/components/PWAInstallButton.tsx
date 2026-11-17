import React, { useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  onOpenMobileHub?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
  onOpenMobileHub,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={`${
          compact ? 'px-3 py-1.5 text-xs' : 'w-full px-3.5 py-2.5 text-xs'
        } inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors whitespace-nowrap shrink-0`}
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Install My Trade App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`${
            compact ? 'px-3 py-1.5 text-xs' : 'w-full px-3.5 py-2 text-xs'
          } inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.1] bg-[#161A22] hover:bg-slate-800 text-slate-200 font-medium transition-colors whitespace-nowrap shrink-0`}
        >
          <Smartphone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-sm rounded-xl bg-[#11141A] border border-white/[0.1] p-6 shadow-2xl">
              <h3 className="text-base font-semibold text-white">Install My Trade on iPhone / iPad</h3>
              <p className="mt-2.5 text-xs leading-relaxed text-slate-300">
                1. Tap the <strong className="text-white">Share</strong> button in the Safari toolbar.
                <br />
                2. Scroll down and tap <strong className="text-white">Add to Home Screen</strong>.
                <br />
                3. Tap <strong className="text-white">Add</strong> to launch My Trade as a standalone mobile app.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 py-2 text-xs font-semibold text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  if (onOpenMobileHub) {
    return (
      <button
        type="button"
        onClick={onOpenMobileHub}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-[#161A22] hover:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
      >
        <Smartphone className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
        <span>Mobile App &amp; Play Store</span>
      </button>
    );
  }

  return null;
};
