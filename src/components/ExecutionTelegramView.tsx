import React, { useState } from 'react';
import { AlertOctagon, Send } from 'lucide-react';
import type {
  ExecutionOrderRecord,
  SignalStatus,
  StoredTradeSignal,
  StrategyConfig,
  TelegramLogRecord,
} from '../types/trading';

interface DetectedChat {
  id: string;
  title: string;
  type: string;
}

interface ExecutionTelegramViewProps {
  signals: StoredTradeSignal[];
  orders: ExecutionOrderRecord[];
  telegramLogs: TelegramLogRecord[];
  config: StrategyConfig;
  telegramConfigured: boolean;
  telegramChatConfigured: boolean;
  telegramBotUsername: string | null;
  brokerConfigured: boolean;
  onUpdateChannelLabel: (label: string) => Promise<void>;
  onUpdateSignalStatus: (signalId: string, status: SignalStatus) => Promise<void>;
  onDispatchTelegramText: (payload: {
    signalId?: string;
    instrument: string;
    eventType: 'SIGNAL' | 'TARGET_HIT' | 'SL_HIT' | 'MARKET_UPDATE';
    messageText: string;
  }) => Promise<void>;
}

export const ExecutionTelegramView: React.FC<ExecutionTelegramViewProps> = ({
  signals,
  orders,
  telegramLogs,
  config,
  telegramConfigured,
  telegramChatConfigured,
  telegramBotUsername,
  brokerConfigured,
  onUpdateChannelLabel,
  onUpdateSignalStatus,
  onDispatchTelegramText,
}) => {
  const [marketUpdateInstrument, setMarketUpdateInstrument] = useState('NIFTY 50');
  const [marketUpdateText, setMarketUpdateText] = useState('');
  const [sendingUpdate, setSendingUpdate] = useState(false);
  const [channelTargetInput, setChannelTargetInput] = useState(config.telegramChannelLabel || '');
  const [detectedChats, setDetectedChats] = useState<DetectedChat[]>([]);
  const [detectingChats, setDetectingChats] = useState(false);
  const [detectHint, setDetectHint] = useState<string | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);

  const handleDetectChats = async () => {
    setDetectingChats(true);
    setDetectHint(null);
    try {
      const res = await fetch('/api/telegram/chats');
      const data = await res.json();
      const chats: DetectedChat[] = Array.isArray(data.chats) ? data.chats : [];
      setDetectedChats(chats);
      if (chats.length > 0) {
        const latest = chats[chats.length - 1];
        setChannelTargetInput(latest.id);
        await onUpdateChannelLabel(latest.id);
        setDetectHint(`Linked destination: ${latest.title} (${latest.id})`);
      } else {
        setDetectHint(
          `No recent messages found. Send /start to ${data.botUsername || telegramBotUsername || 'your bot'} on Telegram (or post in your channel), then click Detect Chat again.`
        );
      }
    } catch {
      setDetectHint('Could not check Telegram chats right now.');
    } finally {
      setDetectingChats(false);
    }
  };

  const handleSaveChannelTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTarget(true);
    try {
      await onUpdateChannelLabel(channelTargetInput.trim());
      setDetectHint('Destination channel/chat saved.');
    } finally {
      setSavingTarget(false);
    }
  };

  const handleBroadcastUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!marketUpdateText.trim()) return;
    setSendingUpdate(true);
    try {
      await onDispatchTelegramText({
        instrument: marketUpdateInstrument,
        eventType: 'MARKET_UPDATE',
        messageText: `My Trade — MARKET UPDATE\nInstrument: ${marketUpdateInstrument}\n\n${marketUpdateText.trim()}\n\nTRADE SMART • STAY DISCIPLINED • FOLLOW THE CALL.`,
      });
      setMarketUpdateText('');
    } finally {
      setSendingUpdate(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Telegram Broadcast & Order Execution Desk</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Manual signal approval queue, Target/SL alerts, Telegram audit log, and Broker Order audit trail
        </p>
      </div>

      {config.killSwitchActive && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3 text-xs text-red-200">
          <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <div className="font-semibold">Emergency Kill Switch ACTIVE</div>
            <div className="text-red-300/90">
              All paper and live order placements are halted. Disable Kill Switch in Admin Settings to resume execution.
            </div>
          </div>
        </div>
      )}

      {/* Integration Status Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-slate-400">Order Execution Mode</div>
          <div className="text-base font-semibold text-white mt-1">
            {config.paperTradingOnly ? 'PAPER TRADING (Locked Default)' : 'PAPER + LIVE ENABLED'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Broker Auth: {brokerConfigured ? 'Configured on Server' : 'Optional — Paper Trading Ready'}
          </div>
        </div>

        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-slate-400">Telegram Bot Connectivity</div>
          <div className="text-base font-semibold text-white mt-1">
            {telegramConfigured
              ? telegramBotUsername
                ? `Active (${telegramBotUsername})`
                : 'Bot Token Active'
              : 'Optional (Not Connected)'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Target: {config.telegramChannelLabel} ·{' '}
            {telegramChatConfigured ? 'Chat Ready' : 'Select or Detect Chat Below'} · Auto-Send:{' '}
            {config.autoBroadcastTelegram ? 'ON' : 'OFF'}
          </div>
        </div>

        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-slate-400">Published / Logged Signals</div>
          <div className="font-mono-tabular text-base font-semibold text-white mt-1">
            {telegramLogs.length} Telegram Logs · {orders.length} Orders
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Duplicate order guard active (60s cooldown)
          </div>
        </div>
      </div>

      {/* Destination Channel / Chat Selector (No API Key/Token Input) */}
      {telegramConfigured && (
        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Telegram Destination Channel / Chat
              </h3>
              <p className="text-[11px] text-slate-400">
                Bot token is active on the server ({telegramBotUsername || 'Telegram Bot'}). Send /start to the bot or add it as an admin to your channel, then click Detect Chat ID or enter your target @channel / Chat ID.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDetectChats}
              disabled={detectingChats}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {detectingChats ? 'Detecting...' : 'Detect Chat ID'}
            </button>
          </div>

          <form onSubmit={handleSaveChannelTarget} className="flex flex-wrap items-center gap-2 text-xs">
            <input
              value={channelTargetInput}
              onChange={(e) => setChannelTargetInput(e.target.value)}
              placeholder="@your_channel or numeric Chat ID (e.g. -1001234567890)"
              className="flex-1 min-w-[240px] bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white placeholder-slate-500 font-mono-tabular"
            />
            <button
              type="submit"
              disabled={savingTarget}
              className="px-3.5 py-2 bg-[#161A22] hover:bg-slate-800 border border-white/[0.08] text-white font-medium rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {savingTarget ? 'Saving...' : 'Save Target'}
            </button>
          </form>

          {detectedChats.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">Detected chats:</span>
              {detectedChats.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={async () => {
                    setChannelTargetInput(chat.id);
                    await onUpdateChannelLabel(chat.id);
                    setDetectHint(`Selected ${chat.title} (${chat.id})`);
                  }}
                  className="px-2.5 py-1 bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-emerald-300 rounded-md"
                >
                  {chat.title} ({chat.id})
                </button>
              ))}
            </div>
          )}

          {detectHint && <p className="text-[11px] text-amber-300">{detectHint}</p>}
        </div>
      )}

      {/* Signal Management & Manual Telegram Approval Queue */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.08]">
          <h3 className="text-sm font-semibold text-white">Saved Signals & Telegram Notification Queue</h3>
        </div>
        {signals.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No saved signals yet. Generate and save a signal from the Dashboard or Chart Analysis BOT.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Instrument / Contract</th>
                  <th className="py-2.5 px-4 font-medium">Direction</th>
                  <th className="py-2.5 px-4 font-medium text-right">Entry / SL / T1</th>
                  <th className="py-2.5 px-4 font-medium text-right">Score</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Telegram & Status Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
                {signals.slice(0, 20).map((sig) => (
                  <tr key={sig.id} className="hover:bg-white/[0.03]">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{sig.instrument}</div>
                      <div className="text-[11px] text-slate-400">{sig.contract}</div>
                    </td>
                    <td className="py-3 px-4 font-medium">
                      <span
                        className={
                          sig.direction === 'BUY'
                            ? 'text-emerald-400'
                            : sig.direction === 'SELL'
                              ? 'text-red-400'
                              : 'text-amber-300'
                        }
                      >
                        {sig.direction}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-300">
                      {sig.entryPrice} / {sig.stopLoss} / {sig.target1}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-white">
                      {sig.qualityScore}/100
                    </td>
                    <td className="py-3 px-4 text-slate-300">{sig.status}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        <button
                          onClick={() =>
                            onDispatchTelegramText({
                              signalId: sig.id,
                              instrument: sig.instrument,
                              eventType: 'SIGNAL',
                              messageText: `My Trade\n\nInstrument: ${sig.instrument}\nContract: ${sig.contract}\nDirection: ${sig.direction}\nEntry: ${sig.entryPrice}\nT1: ${sig.target1} | T2: ${sig.target2}\nSL: ${sig.stopLoss}\nSTATUS: ${sig.status}\n\nTRADE SMART • STAY DISCIPLINED • FOLLOW THE CALL.`,
                            })
                          }
                          className="px-2.5 py-1 text-[11px] bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-300 rounded-md whitespace-nowrap"
                        >
                          Send Signal
                        </button>
                        {!(sig.status === 'TARGET_HIT' || sig.status === 'SL_HIT' || sig.status === 'INVALIDATED') && (
                          <>
                            <button
                              onClick={async () => {
                                await onUpdateSignalStatus(sig.id, 'TARGET_HIT');
                                await onDispatchTelegramText({
                                  signalId: sig.id,
                                  instrument: sig.instrument,
                                  eventType: 'TARGET_HIT',
                                  messageText: `My Trade — TARGET ACHIEVED\n${sig.instrument} (${sig.contract})\nTarget ${sig.target1} achieved from entry ${sig.entryPrice}.`,
                                });
                              }}
                              className="px-2.5 py-1 text-[11px] bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-md whitespace-nowrap"
                            >
                              Target Hit
                            </button>
                            <button
                              onClick={async () => {
                                await onUpdateSignalStatus(sig.id, 'SL_HIT');
                                await onDispatchTelegramText({
                                  signalId: sig.id,
                                  instrument: sig.instrument,
                                  eventType: 'SL_HIT',
                                  messageText: `My Trade — STOP LOSS HIT\n${sig.instrument} (${sig.contract})\nStop-loss ${sig.stopLoss} triggered. Capital preserved.`,
                                });
                              }}
                              className="px-2.5 py-1 text-[11px] bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-300 rounded-md whitespace-nowrap"
                            >
                              SL Hit
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Manual Market Update Broadcaster */}
        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Send Market Update to Telegram</h3>
          <form onSubmit={handleBroadcastUpdate} className="space-y-3 text-xs">
            <input
              value={marketUpdateInstrument}
              onChange={(e) => setMarketUpdateInstrument(e.target.value)}
              placeholder="Instrument (e.g. NIFTY 50)"
              className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
            />
            <textarea
              rows={3}
              value={marketUpdateText}
              onChange={(e) => setMarketUpdateText(e.target.value)}
              placeholder="Write intraday key level update or volatility warning..."
              className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white placeholder-slate-500"
            />
            <button
              type="submit"
              disabled={sendingUpdate || !marketUpdateText.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
              {sendingUpdate ? 'Sending...' : 'Broadcast Market Update'}
            </button>
          </form>
        </div>

        {/* Telegram Broadcast Audit Log */}
        <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.08]">
            <h3 className="text-sm font-semibold text-white">Telegram Broadcast History</h3>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.06] text-xs">
            {telegramLogs.length === 0 ? (
              <div className="p-6 text-center text-slate-400">No Telegram broadcasts logged yet.</div>
            ) : (
              telegramLogs.map((log) => (
                <div key={log.id} className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">
                      {log.instrument} · {log.eventType}
                    </span>
                    <span
                      className={`font-mono-tabular text-[11px] ${
                        log.deliveryStatus === 'SENT'
                          ? 'text-emerald-400'
                          : log.deliveryStatus === 'NOT_CONFIGURED'
                            ? 'text-amber-300'
                            : 'text-red-400'
                      }`}
                    >
                      {log.deliveryStatus}
                    </span>
                  </div>
                  {log.statusDetail && (
                    <p className="text-[11px] text-slate-400">{log.statusDetail}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Execution Orders Audit Log */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.08]">
          <h3 className="text-sm font-semibold text-white">Order Execution Audit Log</h3>
        </div>
        {orders.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">No orders placed yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] text-slate-400">
                  <th className="py-2.5 px-4">Order ID</th>
                  <th className="py-2.5 px-4">Instrument / Contract</th>
                  <th className="py-2.5 px-4">Mode</th>
                  <th className="py-2.5 px-4 text-right">Qty</th>
                  <th className="py-2.5 px-4 text-right">Entry / SL / Target</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-300">
                      {o.brokerOrderId || o.id}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-white">{o.instrument}</div>
                      <div className="text-[11px] text-slate-400">
                        {o.contract} {o.expiry ? `· ${o.expiry}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">{o.executionMode}</td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular">{o.quantity}</td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular">
                      {o.entryPrice} / {o.stopLoss} / {o.targetPrice}
                    </td>
                    <td className="py-2.5 px-4 text-emerald-400 font-medium">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
