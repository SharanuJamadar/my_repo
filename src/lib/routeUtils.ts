import { INSTRUMENTS } from '../types/trading';

export const ACCOUNT_TYPE_STORAGE_KEY = 'mytrade_active_account_type';
export const SOUND_ALERTS_STORAGE_KEY = 'mytrade_sound_alerts';

export type ViewStage = 'landing' | 'onboarding' | 'workspace';

export type NavTab =
  | 'dashboard'
  | 'terminal'
  | 'analyzer'
  | 'journal'
  | 'account'
  | 'settings'
  | 'mobile';

export const VALID_NAV_TABS: NavTab[] = [
  'dashboard',
  'terminal',
  'analyzer',
  'journal',
  'account',
  'settings',
  'mobile',
];

export interface ParsedHashRoute {
  stage: ViewStage;
  tab?: NavTab;
  instrumentId?: string;
  accountMode?: 'LIVE' | 'DEMO';
}

export function parseHashRoute(hashStr: string): ParsedHashRoute | null {
  const cleaned = hashStr.replace(/^#\/?/, '').trim();
  if (!cleaned) return null;
  const parts = cleaned.split('/').filter(Boolean);
  let idx = 0;
  let accountMode: 'LIVE' | 'DEMO' | undefined;

  const first = parts[0]?.toLowerCase();
  if (!first || first === 'landing') return { stage: 'landing' };
  if (first === 'onboarding') return { stage: 'onboarding' };

  if (first === 'demo' || first === 'live') {
    accountMode = first === 'live' ? 'LIVE' : 'DEMO';
    idx = 1;
    if (!parts[idx]) {
      return { stage: 'workspace', tab: 'dashboard', accountMode };
    }
  }

  const head = parts[idx]?.toLowerCase();
  if (head && VALID_NAV_TABS.includes(head as NavTab)) {
    const tab = head as NavTab;
    let instrumentId: string | undefined;
    if (tab === 'terminal' && parts[idx + 1]) {
      const candidate = parts[idx + 1].toUpperCase();
      if (INSTRUMENTS.some((i) => i.id === candidate)) {
        instrumentId = candidate;
      }
    }
    return { stage: 'workspace', tab, instrumentId, accountMode };
  }
  return null;
}

export function playAlertChime(tone: 'emerald' | 'blue' | 'rose'): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const baseFreq = tone === 'emerald' ? 784 : tone === 'blue' ? 659.25 : 440;
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      tone === 'rose' ? 330 : baseFreq * 1.25,
      ctx.currentTime + 0.14
    );
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.23);
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 350);
  } catch {
    // Ignore autoplay restrictions
  }
}
