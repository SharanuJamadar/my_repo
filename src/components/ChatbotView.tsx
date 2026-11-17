import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Send, Trash2, X } from 'lucide-react';
import {
  INSTRUMENTS,
  type ChatMessageRecord,
  type StrategyConfig,
} from '../types/trading';

interface ChatbotViewProps {
  messages: ChatMessageRecord[];
  config: StrategyConfig;
  selectedInstrumentId: string;
  onInstrumentChange: (id: string) => void;
  onSendUserMessage: (content: string, instrumentContext: string) => Promise<void>;
  onSaveAssistantMessage: (content: string, instrumentContext: string) => Promise<void>;
  onClearHistory: () => Promise<void>;
}

const QUICK_PROMPTS = [
  'Analyse NIFTY now.',
  'Find the best CE or PE setup.',
  "Give me today's support and resistance.",
  'Is the 15-minute trend bullish or bearish?',
  'Find a 5-minute breakout.',
  'Analyse MCX crude oil using EMA 9.',
  'Give me a trade signal with stop-loss and targets.',
  'Should I wait or enter?',
];

export const ChatbotView: React.FC<ChatbotViewProps> = ({
  messages,
  config,
  selectedInstrumentId,
  onInstrumentChange,
  onSendUserMessage,
  onSaveAssistantMessage,
  onClearHistory,
}) => {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedImage, setAttachedImage] = useState<string>('');
  const [attachedMime, setAttachedMime] = useState<string>('image/png');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const handleAttach = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setAttachedMime(file.type || 'image/png');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setAttachedImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const sendPrompt = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    setInput('');
    setSending(true);

    const imgToSend = attachedImage;
    const mimeToSend = attachedMime;
    setAttachedImage('');

    try {
      await onSendUserMessage(trimmed, selectedInstrumentId);
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          instrumentId: selectedInstrumentId,
          imageBase64: imgToSend || undefined,
          mimeType: imgToSend ? mimeToSend : undefined,
          strategyConfig: config,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Trading assistant request failed.');
      }
      await onSaveAssistantMessage(data.reply, selectedInstrumentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach trading assistant.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">My Trade — AI Trading Assistant</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Enforces {config.trendTimeframe} Trend + {config.entryTimeframe} Entry · EMA {config.emaFast}/{config.emaMid}/{config.emaSlow} · Min Score {config.minSetupScore}/100
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedInstrumentId}
            onChange={(e) => onInstrumentChange(e.target.value)}
            className="bg-[#11141A] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
          >
            {INSTRUMENTS.map((inst) => (
              <option key={inst.id} value={inst.id}>
                Context: {inst.symbol}
              </option>
            ))}
          </select>

          {messages.length > 0 && (
            <button
              onClick={onClearHistory}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Chat
            </button>
          )}
        </div>
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={sending}
            onClick={() => sendPrompt(q)}
            className="px-3 py-1.5 text-xs bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-slate-300 hover:text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Chat Viewport */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl flex flex-col h-[520px] overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-2">
              <div className="text-sm font-semibold text-white">Strategy-Aligned Trading Desk Ready</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ask for live multi-timeframe NIFTY, BANK NIFTY, SENSEX, MCX Crude Oil (EMA 9), Gold, or Crypto setups. You can also attach a TradingView screenshot directly in your message.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-emerald-600/20 border border-emerald-500/30 text-white'
                      : 'bg-[#090B0E] border border-white/[0.08] text-slate-200 font-mono-tabular'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-[#090B0E] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-slate-400">
                Evaluating {selectedInstrumentId} across {config.trendTimeframe} & {config.entryTimeframe}...
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {error && (
          <div className="mx-4 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300">
            {error}
          </div>
        )}

        {attachedImage && (
          <div className="mx-4 mb-2 p-2 bg-[#090B0E] border border-white/[0.08] rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src={attachedImage}
                alt="Attached chart preview"
                className="w-10 h-10 object-cover rounded"
              />
              <span className="text-xs text-slate-300">Chart screenshot attached</span>
            </div>
            <button
              type="button"
              onClick={() => setAttachedImage('')}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendPrompt(input);
          }}
          className="p-3 border-t border-white/[0.08] bg-[#0C0F14] flex items-center gap-2"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAttach(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Attach chart screenshot"
            className="p-2.5 bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-slate-300 rounded-lg transition-colors shrink-0"
          >
            <ImagePlus className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about NIFTY CE/PE, MCX Crude Oil EMA 9, 15m trend, or S/R levels..."
            className="flex-1 bg-[#11141A] border border-white/[0.08] rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />

          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
