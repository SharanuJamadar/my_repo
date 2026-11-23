import React, { useState } from 'react';
import { Bell, BellRing, Plus, Trash2 } from 'lucide-react';
import { INSTRUMENTS, type PriceAlertRule } from '../types/trading';

interface Props {
  alerts: PriceAlertRule[];
  defaultInstrumentId?: string;
  livePricesByInstrument: Record<string, number>;
  onAddAlert: (rule: Omit<PriceAlertRule, 'id' | 'active' | 'createdAt'>) => void;
  onDeleteAlert: (id: string) => void;
  onClearTriggered: () => void;
}

export const PriceAlertsPanel: React.FC<Props> = ({
  alerts,
  defaultInstrumentId = 'XAUUSD',
  livePricesByInstrument,
  onAddAlert,
  onDeleteAlert,
  onClearTriggered,
}) => {
  const [instrumentId, setInstrumentId] = useState(defaultInstrumentId);
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [targetPrice, setTargetPrice] = useState('');
  const [note, setNote] = useState('');
  const [sendTelegram, setSendTelegram] = useState(false);

  const selectedInst = INSTRUMENTS.find((i) => i.id === instrumentId) ?? INSTRUMENTS[0];
  const currentPx = livePricesByInstrument[selectedInst.id];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const px = Number(targetPrice);
    if (!Number.isFinite(px) || px <= 0) return;
    onAddAlert({
      instrumentId: selectedInst.id,
      symbol: selectedInst.symbol,
      condition,
      targetPrice: px,
      note: note.trim().slice(0, 80) || undefined,
      sendTelegram,
    });
    setTargetPrice('');
    setNote('');
  };

  const activeAlerts = alerts.filter((a) => a.active);
  const triggeredAlerts = alerts.filter((a) => !a.active);

  return (
    <div className="bg-white dark:bg-[#111722] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Custom Price Alerts
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            · {activeAlerts.length} active
          </span>
        </div>
        {triggeredAlerts.length > 0 && (
          <button
            type="button"
            onClick={onClearTriggered}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            Clear Triggered ({triggeredAlerts.length})
          </button>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-4 border-b border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
      >
        <div className="sm:col-span-3">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Market
          </label>
          <select
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
            className="w-full px-2.5 py-2 rounded-lg text-xs font-medium bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
          >
            {INSTRUMENTS.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.symbol}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Trigger
          </label>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as 'ABOVE' | 'BELOW')}
            className="w-full px-2.5 py-2 rounded-lg text-xs font-medium bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
          >
            <option value="ABOVE">Crosses Above</option>
            <option value="BELOW">Crosses Below</option>
          </select>
        </div>

        <div className="sm:col-span-3">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Target Price {currentPx ? `(Now ${currentPx.toFixed(currentPx > 500 ? 2 : 4)})` : ''}
          </label>
          <input
            type="number"
            step="any"
            required
            placeholder={currentPx ? String(currentPx) : 'Enter target level'}
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            className="w-full px-2.5 py-2 rounded-lg text-xs font-mono-tabular bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Note (Optional)
          </label>
          <input
            type="text"
            maxLength={60}
            placeholder="Breakout level"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-2.5 py-2 rounded-lg text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
          />
        </div>

        <div className="sm:col-span-2 flex items-center gap-2">
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Alert
          </button>
        </div>

        <div className="sm:col-span-12 flex items-center gap-2 pt-0.5">
          <input
            id="alert-tg-check"
            type="checkbox"
            checked={sendTelegram}
            onChange={(e) => setSendTelegram(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-700 text-sky-600"
          />
          <label
            htmlFor="alert-tg-check"
            className="text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer"
          >
            Also forward alert to linked Telegram channel/chat when triggered
          </label>
        </div>
      </form>

      <div className="divide-y divide-slate-100 dark:divide-slate-800/70 max-h-64 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="px-4 py-5 text-xs text-slate-500 dark:text-slate-400 text-center">
            No price alerts configured yet. Set exact breakout or support levels above.
          </div>
        ) : (
          alerts.map((rule) => {
            const livePx = livePricesByInstrument[rule.instrumentId];
            const distPct =
              livePx && livePx > 0
                ? ((rule.targetPrice - livePx) / livePx) * 100
                : null;
            return (
              <div
                key={rule.id}
                className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {rule.active ? (
                    <Bell className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  ) : (
                    <BellRing className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-white truncate">
                      {rule.symbol}{' '}
                      <span
                        className={
                          rule.condition === 'ABOVE'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }
                      >
                        {rule.condition === 'ABOVE' ? '≥' : '≤'}{' '}
                        <span className="font-mono-tabular">{rule.targetPrice}</span>
                      </span>
                      {rule.note && (
                        <span className="font-normal text-slate-500 dark:text-slate-400">
                          {' '}
                          · {rule.note}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                      {rule.active ? (
                        <>
                          {distPct !== null
                            ? `${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}% from live`
                            : 'Watching live stream'}
                          {rule.sendTelegram ? ' · Telegram ON' : ''}
                        </>
                      ) : (
                        `Triggered @ ${rule.triggeredPrice ?? rule.targetPrice} · ${
                          rule.triggeredAt
                            ? new Date(rule.triggeredAt).toLocaleTimeString()
                            : ''
                        }`
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteAlert(rule.id)}
                  className="p-1.5 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  aria-label="Remove price alert"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
