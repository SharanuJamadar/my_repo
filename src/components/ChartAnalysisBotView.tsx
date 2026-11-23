import React, { useRef, useState } from 'react';
import { ImagePlus, ScanSearch, Trash2 } from 'lucide-react';
import {
  INSTRUMENTS,
  type GeneratedSignalPayload,
  type StrategyConfig,
  type Timeframe,
} from '../types/trading';
import { SignalCard } from './SignalCard';

interface ChartAnalysisBotViewProps {
  config: StrategyConfig;
  onSaveSignal: (signal: GeneratedSignalPayload, source: 'CHART_UPLOAD') => Promise<void>;
  onSendTelegram: (signal: GeneratedSignalPayload) => Promise<void>;
  onLogPaperTrade: (signal: GeneratedSignalPayload) => Promise<void>;
  onOpenOrderModal: (signal: GeneratedSignalPayload) => void;
}

export const ChartAnalysisBotView: React.FC<ChartAnalysisBotViewProps> = ({
  config,
  onSaveSignal,
  onSendTelegram,
  onLogPaperTrade,
  onOpenOrderModal,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageBase64, setImageBase64] = useState<string>('');
  const [mimeType, setMimeType] = useState<string>('image/png');
  const [fileName, setFileName] = useState<string>('');
  const [instrumentId, setInstrumentId] = useState<string>('NIFTY50');
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [currentPrice, setCurrentPrice] = useState<string>('');
  const [optionType, setOptionType] = useState<'SPOT_FUT' | 'CE' | 'PE'>('CE');
  const [expiry, setExpiry] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultSignal, setResultSignal] = useState<GeneratedSignalPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingTg, setSendingTg] = useState(false);
  const [tgNote, setTgNote] = useState<string | null>(null);

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid PNG, JPG, or WebP chart screenshot.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Chart image must be under 10 MB.');
      return;
    }
    setError(null);
    setFileName(file.name);
    setMimeType(file.type || 'image/png');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageBase64) {
      setError('Upload a TradingView or candlestick chart screenshot first.');
      return;
    }
    setError(null);
    setTgNote(null);
    setAnalyzing(true);
    try {
      const res = await fetch('/api/ai/analyze-chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType,
          instrumentId,
          timeframe,
          currentPrice: currentPrice ? Number(currentPrice) : undefined,
          optionType,
          expiry: expiry.trim() || undefined,
          strategyConfig: config,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to inspect chart image.');
      }
      setResultSignal(data.signal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chart analysis error');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">AI Chart Analysis BOT</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Upload TradingView or candlestick screenshots for visual market structure, EMA, S/R, and signal extraction. Verified observations are strictly separated from unverified or non-visible values.
        </p>
      </div>

      <form
        onSubmit={handleAnalyze}
        className="bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl p-5 grid grid-cols-1 lg:grid-cols-12 gap-6"
      >
        {/* Upload Zone */}
        <div className="lg:col-span-6 space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
          />

          {!imageBase64 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFileSelect(f);
              }}
              className="w-full h-72 border border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500/60 bg-[#F4F6FA] dark:bg-[#08101E] rounded-xl flex flex-col items-center justify-center p-6 text-center transition-colors"
            >
              <ImagePlus className="w-8 h-8 text-slate-500 dark:text-slate-400 mb-3" />
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                Click or drag & drop TradingView chart screenshot
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                PNG, JPG, WebP up to 10 MB · Candlestick, EMA, VWAP, or Volume charts
              </p>
            </button>
          ) : (
            <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-700 dark:text-slate-300 truncate">{fileName || 'Uploaded Chart'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setImageBase64('');
                    setFileName('');
                    setResultSignal(null);
                  }}
                  className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
              <img
                src={imageBase64}
                alt="Uploaded trading chart screenshot"
                className="w-full max-h-72 object-contain bg-black"
              />
            </div>
          )}
        </div>

        {/* Parameters */}
        <div className="lg:col-span-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Trading Instrument</label>
              <select
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
                className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                {INSTRUMENTS.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.symbol} ({inst.segment})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Screenshot Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="5m">5 Minutes (Entry TF)</option>
                <option value="15m">15 Minutes (Primary Trend TF)</option>
                <option value="1h">1 Hour</option>
                <option value="4h">4 Hours</option>
                <option value="1d">Daily</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                Current Price (Optional)
              </label>
              <input
                type="number"
                step="any"
                placeholder="e.g. 24380"
                value={currentPrice}
                onChange={(e) => setCurrentPrice(e.target.value)}
                className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2.5 text-xs font-mono-tabular text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Contract / Option Type</label>
              <div className="grid grid-cols-3 gap-1 bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-1">
                {(['SPOT_FUT', 'CE', 'PE'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOptionType(t)}
                    className={`py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                      optionType === t
                        ? 'bg-blue-700 dark:bg-slate-800 text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {t === 'SPOT_FUT' ? 'SPOT' : t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Options Expiry</label>
              <input
                type="text"
                placeholder="e.g. 26 NOV 2026"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="w-full bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Strategy Engine Active: Primary Trend {config.trendTimeframe.toUpperCase()} · Entry{' '}
            {config.entryTimeframe.toUpperCase()} · EMA {config.emaFast}/{config.emaMid}/
            {config.emaSlow} · Min Score {config.minSetupScore}/100 · Min R:R 1:
            {config.minRiskReward}
          </div>

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/35 rounded-lg text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={analyzing || !imageBase64}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-40"
          >
            <ScanSearch className="w-4 h-4" />
            {analyzing ? 'Inspecting Chart Structure...' : 'Run AI Chart Inspection'}
          </button>
        </div>
      </form>

      {resultSignal && (
        <SignalCard
          signal={resultSignal}
          savingSignal={saving}
          sendingTelegram={sendingTg}
          telegramStatusNote={tgNote}
          onSaveSignal={async () => {
            setSaving(true);
            try {
              await onSaveSignal(resultSignal, 'CHART_UPLOAD');
              setTgNote('Signal saved to your persistent signal history.');
            } finally {
              setSaving(false);
            }
          }}
          onSendTelegram={async () => {
            setSendingTg(true);
            try {
              await onSendTelegram(resultSignal);
              setTgNote('Telegram dispatch processed and logged.');
            } finally {
              setSendingTg(false);
            }
          }}
          onLogPaperTrade={() => onLogPaperTrade(resultSignal)}
          onOpenOrderModal={() => onOpenOrderModal(resultSignal)}
        />
      )}
    </div>
  );
};
