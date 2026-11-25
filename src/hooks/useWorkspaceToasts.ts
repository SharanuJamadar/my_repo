import { useCallback, useRef, useState } from 'react';
import { playAlertChime, SOUND_ALERTS_STORAGE_KEY } from '../lib/routeUtils';

export interface WorkspaceToast {
  id: string;
  title: string;
  detail: string;
  tone: 'emerald' | 'blue' | 'rose';
}

export function useWorkspaceToasts() {
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(SOUND_ALERTS_STORAGE_KEY);
      return saved === null ? true : saved === '1';
    } catch {
      return true;
    }
  });
  const soundAlertsRef = useRef(soundAlertsEnabled);
  soundAlertsRef.current = soundAlertsEnabled;

  const [toasts, setToasts] = useState<WorkspaceToast[]>([]);

  const pushToast = useCallback(
    (title: string, detail: string, tone: 'emerald' | 'blue' | 'rose' = 'emerald') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [{ id, title, detail, tone }, ...prev].slice(0, 4));
      if (soundAlertsRef.current) {
        playAlertChime(tone);
      }
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 6000);
    },
    []
  );

  return {
    toasts,
    setToasts,
    pushToast,
    soundAlertsEnabled,
    setSoundAlertsEnabled,
  };
}
