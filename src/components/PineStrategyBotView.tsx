import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  Activity,
  Bot,
  Code2,
  Pause,
  Play,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  INSTRUMENTS,
  type PineBacktestResult,
  type PineBotActivityLog,
  type PineBotEvaluationResult,
  type PineStrategyRecord,
  type Timeframe,
  type TradeMode,
} from '../types/trading';
import { PINE_STRATEGY_TEMPLATES } from '../lib/pineTemplates';

interface PineStrategyBotViewProps {
  strategies: PineStrategyRecord[];
  onSaveStrategy: (
    item: Omit<PineStrategyRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => Promise<void>;
  onDeleteStrategy: (strategyId: string) => Promise<void>;
  onToggleBot: (strategy: PineStrategyRecord) => Promise<void>;
  onCheckLiveBotNow: (strategy: PineStrategyRecord) => Promise<PineBotEvaluationResult | null>;
  botLogs: PineBotActivityLog[];
  killSwitchActive: boolean;
}

export const PineStrategyBotView: React.FC<PineStrategyBotViewProps> = ({
  strategies,
  onSaveStrategy,
  onDeleteStrategy,
  onToggleBot,
  onCheckLiveBotNow,
  botLogs,
  killSwitchActive,
}) => {
  const [selectedId, setSelectedId] = useState<string>(strategies[0]?.id || '');
  const [name, setName] = useState(strategies[0]?.name || PINE_STRATEGY_TEMPLATES[0].name);
  const [description, setDescription] = useState(
    strategies[0]?.description || PINE_STRATEGY_TEMPLATES[0].description
  );
  const [instrumentId, setInstrumentId] = useState(
    strategies[0]?.instrumentId || PINE_STRATEGY_TEMPLATES[0].instrumentId
  );
  const [timeframe, setTimeframe] = useState<Timeframe>(
    strategies[0]?.timeframe || PINE_STRATEGY_TEMPLATES[0].timeframe
  );
  const [quantity, setQuantity] = useState(strategies[0]?.quantity || 2);
  const [initialCapital, setInitialCapital] = useState(strategies[0]?.initialCapital || 100000);
  const [stopLossPct, setStopLossPct] = useState(strategies[0]?.stopLossPct || 0.45);
  const [takeProfitPct, setTakeProfitPct] = useState(strategies[0]?.takeProfitPct || 0.9);
  const [executionMode, setExecutionMode] = useState<TradeMode>(
    strategies[0]?.executionMode || 'PAPER'
  );
  const [autoExecute, setAutoExecute] = useState(strategies[0]?.autoExecute ?? true);
  const [pineCode, setPineCode] = useState(
    strategies[0]?.pineCode || PINE_STRATEGY_TEMPLATES[0].pineCode
  );

  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [backtesting, setBacktesting] = useState(false);
  const [backtestResult, setBacktestResult] = useState<PineBacktestResult | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [chartView, setChartView] = useState<'PINE_CHART' | 'EQUITY_CURVE'>('PINE_CHART');
  const [ledgerTab, setLedgerTab] = useState<'BACKTEST_TRADES' | 'BOT_LOGS'>('BACKTEST_TRADES');
  const [checkingBot, setCheckingBot] = useState(false);

  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeStrategy = useMemo(
    () => strategies.find((s) => s.id === selectedId) ?? null,
    [strategies, selectedId]
  );

  const loadIntoForm = (s: PineStrategyRecord) => {
    setSelectedId(s.id);
    setName(s.name);
    setDescription(s.description || '');
    setInstrumentId(s.instrumentId);
    setTimeframe(s.timeframe);
    setQuantity(s.quantity);
    setInitialCapital(s.initialCapital);
    setStopLossPct(s.stopLossPct);
    setTakeProfitPct(s.takeProfitPct);
    setExecutionMode(s.executionMode);
    setAutoExecute(s.autoExecute);
    setPineCode(s.pineCode);
  };

  useEffect(() => {
    if (!selectedId && strategies.length > 0) {
      loadIntoForm(strategies[0]);
    }
  }, [strategies, selectedId]);

  const handleCreateBlank = () => {
    setSelectedId('');
    setName('My Custom Pine Strategy');
    setDescription('Custom Pine Script v5 entry & exit rules');
    setInstrumentId('XAUUSD');
    setTimeframe('5m');
    setQuantity(1);
    setInitialCapital(100000);
    setStopLossPct(0.5);
    setTakeProfitPct(1.0);
    setExecutionMode('PAPER');
    setAutoExecute(true);
    setPineCode(PINE_STRATEGY_TEMPLATES[0].pineCode);
    setSaveNote(null);
  };

  const handleLoadTemplate = (tplId: string) => {
    const tpl = PINE_STRATEGY_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    setName(tpl.name);
    setDescription(tpl.description);
    setInstrumentId(tpl.instrumentId);
    setTimeframe(tpl.timeframe);
    setQuantity(tpl.quantity);
    setStopLossPct(tpl.stopLossPct);
    setTakeProfitPct(tpl.takeProfitPct);
    setPineCode(tpl.pineCode);
  };

  const handleImportPineFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPineCode(reader.result);
        setName(file.name.replace(/\.(pine|txt)$/i, ''));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveNote(null);
    try {
      await onSaveStrategy({
        ...(selectedId ? { id: selectedId } : {}),
        name,
        description,
        instrumentId,
        timeframe,
        pineCode,
        quantity,
        initialCapital,
        stopLossPct,
        takeProfitPct,
        executionMode,
        botEnabled: activeStrategy?.botEnabled ?? false,
        autoExecute,
      });
      setSaveNote('Strategy saved cleanly.');
      setTimeout(() => setSaveNote(null), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleRunBacktest = async () => {
    setBacktesting(true);
    setBacktestError(null);
    try {
      const res = await fetch('/api/pine/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyName: name,
          instrumentId,
          timeframe,
          pineCode,
          quantity,
          initialCapital,
          stopLossPct,
          takeProfitPct,
        }),
      });
      const json = (await res.json()) as PineBacktestResult;
      if (!json.available) {
        setBacktestError(json.error || 'Backtest market feed unavailable.');
        setBacktestResult(null);
      } else {
        setBacktestResult(json);
      }
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : 'Backtest request failed.');
    } finally {
      setBacktesting(false);
    }
  };

  // Run initial backtest once on mount so Pine Chart renders immediately
  useEffect(() => {
    void handleRunBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render Lightweight-Charts Pine Chart (Candles + Parsed Pine Indicator Overlays + Entry/Exit Markers OR Equity Curve)
  useEffect(() => {
    if (!chartHostRef.current || !backtestResult?.available || backtestResult.candles.length === 0) {
      return;
    }

    const host = chartHostRef.current;
    const chart = createChart(host, {
      width: host.clientWidth,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: '#0C0F14' },
        textColor: '#94A3B8',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true },
    });
    chartApiRef.current = chart;

    if (chartView === 'EQUITY_CURVE') {
      const eqSeries = chart.addSeries(LineSeries, {
        color: '#10B981',
        lineWidth: 2,
        title: 'Strategy Equity',
      });
      const seen = new Set<number>();
      const eqData = backtestResult.equityCurve
        .filter((p) => {
          if (seen.has(p.time)) return false;
          seen.add(p.time);
          return true;
        })
        .sort((a, b) => a.time - b.time)
        .map((p) => ({ time: p.time as UTCTimestamp, value: p.equity }));
      eqSeries.setData(eqData);
    } else {
      const candleSeries: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
        upColor: '#10B981',
        downColor: '#EF4444',
        borderUpColor: '#10B981',
        borderDownColor: '#EF4444',
        wickUpColor: '#10B981',
        wickDownColor: '#EF4444',
      });

      const seen = new Set<number>();
      const uniqueCandles = [...backtestResult.candles]
        .sort((a, b) => a.time - b.time)
        .filter((c) => {
          if (seen.has(c.time)) return false;
          seen.add(c.time);
          return true;
        });

      candleSeries.setData(
        uniqueCandles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );

      for (const ov of backtestResult.overlays) {
        const line = chart.addSeries(LineSeries, {
          color: ov.color,
          lineWidth: 1,
          priceLineVisible: false,
          title: ov.label,
        });
        const ovSeen = new Set<number>();
        const pts = ov.points
          .filter((p) => {
            if (ovSeen.has(p.time)) return false;
            ovSeen.add(p.time);
            return true;
          })
          .sort((a, b) => a.time - b.time)
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
        line.setData(pts);
      }

      const markers = backtestResult.trades
        .flatMap((t) => [
          {
            time: t.entryTime as UTCTimestamp,
            position: (t.side === 'BUY' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
            color: t.side === 'BUY' ? '#10B981' : '#EF4444',
            shape: (t.side === 'BUY' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
            text: `${t.side} @ ${t.entryPrice}`,
          },
          {
            time: t.exitTime as UTCTimestamp,
            position: (t.side === 'BUY' ? 'aboveBar' : 'belowBar') as 'belowBar' | 'aboveBar',
            color: t.pnl >= 0 ? '#38BDF8' : '#F59E0B',
            shape: 'circle' as const,
            text: `${t.pnl >= 0 ? '+' : ''}${t.pnl}`,
          },
        ])
        .sort((a, b) => (a.time as number) - (b.time as number));

      const markersPlugin = createSeriesMarkers(candleSeries, []);
      markersPlugin.setMarkers(markers as { time: Time; position: any; color: string; shape: any; text: string }[]);
    }

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (chartHostRef.current && chartApiRef.current) {
        chartApiRef.current.applyOptions({ width: chartHostRef.current.clientWidth });
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      chartApiRef.current = null;
      chart.remove();
    };
  }, [backtestResult, chartView]);

  const runningBotsCount = strategies.filter((s) => s.botEnabled).length;
  const activeCurrency =
    INSTRUMENTS.find((i) => i.id === instrumentId)?.currency ?? '$';

  const handleRunLiveCheckNow = async () => {
    setCheckingBot(true);
    try {
      const target: PineStrategyRecord = activeStrategy
        ? {
            ...activeStrategy,
            name,
            description,
            instrumentId,
            timeframe,
            pineCode,
            quantity,
            initialCapital,
            stopLossPct,
            takeProfitPct,
            executionMode,
            autoExecute,
          }
        : {
            id: 'unsaved-pine-bot',
            userId: 'local',
            name,
            description,
            instrumentId,
            timeframe,
            pineCode,
            quantity,
            initialCapital,
            stopLossPct,
            takeProfitPct,
            executionMode,
            botEnabled: false,
            autoExecute,
            createdAt: '',
            updatedAt: '',
          };
      await onCheckLiveBotNow(target);
      setLedgerTab('BOT_LOGS');
    } finally {
      setCheckingBot(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Studio Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-semibold text-white">Pine Chart, Strategy Backtest & Bot</h2>
            {runningBotsCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {runningBotsCount} Bot Active
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Write or upload TradingView Pine Script v5 strategies, backtest over real OHLCV candles, and run live automated trade execution bots
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pine,.txt"
            onChange={handleImportPineFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            Import .pine
          </button>

          <button
            type="button"
            onClick={handleCreateBlank}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Strategy
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Strategy'}
          </button>

          <button
            type="button"
            onClick={handleRunBacktest}
            disabled={backtesting}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Activity className="w-3.5 h-3.5" />
            {backtesting ? 'Backtesting...' : 'Run Backtest'}
          </button>
        </div>
      </div>

      {saveNote && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300">
          {saveNote}
        </div>
      )}

      {killSwitchActive && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300">
          Emergency Kill Switch is ACTIVE in Settings. Pine bots can evaluate live candles, but automated order execution is paused until disabled.
        </div>
      )}

      {/* Saved Strategies Library Strip */}
      <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold text-white">Saved Pine Strategies ({strategies.length})</div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Load Template:</span>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) handleLoadTemplate(e.target.value);
                e.target.value = '';
              }}
              className="bg-[#090B0E] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="" disabled>
                Choose Pine v5 starter...
              </option>
              {PINE_STRATEGY_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {strategies.map((s) => {
            const selected = s.id === selectedId;
            const instMeta = INSTRUMENTS.find((i) => i.id === s.instrumentId);
            return (
              <div
                key={s.id}
                className={`p-3 rounded-lg border transition-colors flex flex-col justify-between gap-2.5 ${
                  selected
                    ? 'bg-emerald-500/[0.07] border-emerald-500/40'
                    : 'bg-[#090B0E] border-white/[0.06] hover:border-white/[0.14]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => loadIntoForm(s)}
                    className="text-left min-w-0 flex-1"
                  >
                    <div className="text-xs font-semibold text-white truncate">{s.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {instMeta?.symbol ?? s.instrumentId} · {s.timeframe.toUpperCase()} · {s.executionMode}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteStrategy(s.id)}
                    aria-label={`Delete ${s.name}`}
                    className="p-1 text-slate-500 hover:text-red-400 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                  <span className="text-[11px] text-slate-400">
                    SL {s.stopLossPct}% · TP {s.takeProfitPct}% · Qty {s.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleBot(s)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      s.botEnabled
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#11141A] border border-white/[0.08] text-slate-300 hover:text-white'
                    }`}
                  >
                    {s.botEnabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    {s.botEnabled ? 'Bot ON' : 'Start Bot'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Split: Pine Editor & Bot Params (5 cols) + Chart & Results (7 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Strategy Code & Parameters */}
        <div className="xl:col-span-5 bg-[#11141A] border border-white/[0.08] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">Pine Script & Bot Parameters</h3>
            </div>
            <button
              type="button"
              onClick={handleRunLiveCheckNow}
              disabled={checkingBot}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Bot className="w-3.5 h-3.5" />
              {checkingBot ? 'Evaluating...' : 'Check Live Bar Now'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="sm:col-span-2">
              <label className="block text-slate-400 mb-1">Strategy Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Market Instrument</label>
              <select
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
              >
                {INSTRUMENTS.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.symbol} · {inst.segment}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
              >
                <option value="5m">5M</option>
                <option value="15m">15M</option>
                <option value="1h">1H</option>
                <option value="4h">4H</option>
                <option value="1d">1D</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Order Qty / Units</label>
              <input
                type="number"
                min={0.01}
                step="0.1"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Backtest Capital</label>
              <input
                type="number"
                min={100}
                step="1000"
                value={initialCapital}
                onChange={(e) => setInitialCapital(Number(e.target.value))}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Stop Loss (%)</label>
              <input
                type="number"
                min={0.05}
                step="0.05"
                value={stopLossPct}
                onChange={(e) => setStopLossPct(Number(e.target.value))}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Take Profit (%)</label>
              <input
                type="number"
                min={0.05}
                step="0.05"
                value={takeProfitPct}
                onChange={(e) => setTakeProfitPct(Number(e.target.value))}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 font-mono-tabular text-white"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Bot Execution Mode</label>
              <select
                value={executionMode}
                onChange={(e) => setExecutionMode(e.target.value as TradeMode)}
                className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg px-3 py-2 text-white"
              >
                <option value="PAPER">Paper Trading Engine</option>
                <option value="LIVE">Live Broker Adapter</option>
              </select>
            </div>

            <label className="flex items-center justify-between gap-2 p-2.5 bg-[#090B0E] border border-white/[0.06] rounded-lg cursor-pointer self-end">
              <span className="text-xs text-slate-200">Auto-Execute Bot Signals</span>
              <input
                type="checkbox"
                checked={autoExecute}
                onChange={(e) => setAutoExecute(e.target.checked)}
                className="rounded border-slate-600 bg-[#11141A] text-emerald-500"
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-400">Pine Script v5 Source Code</label>
              <span className="text-[11px] text-slate-500 font-mono-tabular">
                Supports ta.ema, ta.sma, ta.rsi, ta.macd, ta.vwap, ta.crossover/under
              </span>
            </div>
            <textarea
              value={pineCode}
              onChange={(e) => setPineCode(e.target.value)}
              rows={15}
              spellCheck={false}
              className="w-full bg-[#090B0E] border border-white/[0.08] rounded-lg p-3 font-mono-tabular text-[12px] leading-relaxed text-emerald-200 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Right: Interactive Pine Chart, Backtest Metrics & Trade Ledger */}
        <div className="xl:col-span-7 space-y-5">
          <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">
                  {backtestResult?.instrument.symbol ?? instrumentId} · Pine Chart & Signal Markers
                </div>
                <p className="text-xs text-slate-400">
                  {backtestResult?.available
                    ? `${backtestResult.provider} · ${backtestResult.candlesCount} historical candles (${backtestResult.timeframe.toUpperCase()})`
                    : 'Click Run Backtest to evaluate over live historical OHLCV bars'}
                </p>
              </div>

              <div className="flex items-center bg-[#090B0E] border border-white/[0.08] rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setChartView('PINE_CHART')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    chartView === 'PINE_CHART'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Candles + Signals
                </button>
                <button
                  type="button"
                  onClick={() => setChartView('EQUITY_CURVE')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    chartView === 'EQUITY_CURVE'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Equity Curve
                </button>
              </div>
            </div>

            {backtestError ? (
              <div className="h-[360px] flex items-center justify-center p-6 text-center text-xs text-amber-300 bg-[#0C0F14]">
                {backtestError}
              </div>
            ) : backtesting && !backtestResult ? (
              <div className="h-[360px] flex items-center justify-center text-xs text-slate-400 bg-[#0C0F14]">
                Compiling Pine Script and running bar-by-bar simulation...
              </div>
            ) : (
              <div ref={chartHostRef} className="w-full h-[360px] bg-[#0C0F14]" />
            )}
          </div>

          {backtestResult?.available && (
            <>
              {/* Backtest KPI Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">Net Profit</div>
                  <div
                    className={`font-mono-tabular text-sm font-bold mt-1 ${
                      backtestResult.metrics.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {backtestResult.metrics.netProfit >= 0 ? '+' : ''}
                    {activeCurrency}
                    {backtestResult.metrics.netProfit.toLocaleString()}
                  </div>
                </div>
                <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">Return %</div>
                  <div
                    className={`font-mono-tabular text-sm font-bold mt-1 ${
                      backtestResult.metrics.netProfitPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {backtestResult.metrics.netProfitPct >= 0 ? '+' : ''}
                    {backtestResult.metrics.netProfitPct}%
                  </div>
                </div>
                <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">Win Rate</div>
                  <div className="font-mono-tabular text-sm font-bold text-white mt-1">
                    {backtestResult.metrics.winRatePct}%
                  </div>
                </div>
                <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">Profit Factor</div>
                  <div className="font-mono-tabular text-sm font-bold text-sky-300 mt-1">
                    {backtestResult.metrics.profitFactor}
                  </div>
                </div>
                <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">Max Drawdown</div>
                  <div className="font-mono-tabular text-sm font-bold text-amber-300 mt-1">
                    {backtestResult.metrics.maxDrawdownPct}%
                  </div>
                </div>
                <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">Total Trades</div>
                  <div className="font-mono-tabular text-sm font-bold text-white mt-1">
                    {backtestResult.metrics.totalTrades}
                  </div>
                </div>
              </div>

              {/* Parsed Pine Rules Transparency */}
              <div className="bg-[#11141A] border border-white/[0.08] rounded-xl p-4 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">
                    Parsed Pine Rules ({backtestResult.parsed.pineVersion})
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono-tabular">
                    Indicators:{' '}
                    {backtestResult.parsed.indicatorsDetected.length > 0
                      ? backtestResult.parsed.indicatorsDetected.join(', ')
                      : 'Price Action / Default EMA'}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-300">
                  <div className="bg-[#090B0E] border border-white/[0.06] rounded-lg p-2.5 font-mono-tabular truncate">
                    LONG: {backtestResult.parsed.buyRuleSummary}
                  </div>
                  <div className="bg-[#090B0E] border border-white/[0.06] rounded-lg p-2.5 font-mono-tabular truncate">
                    SHORT: {backtestResult.parsed.sellRuleSummary}
                  </div>
                </div>
                {backtestResult.parsed.unsupportedConstructs.length > 0 && (
                  <div className="text-[11px] text-amber-300">
                    Note: {backtestResult.parsed.unsupportedConstructs.join(' · ')}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Backtest Trades Ledger & Live Bot Execution Logs */}
          <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 bg-[#090B0E] border border-white/[0.08] rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setLedgerTab('BACKTEST_TRADES')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    ledgerTab === 'BACKTEST_TRADES'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Backtest Trades ({backtestResult?.trades.length ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setLedgerTab('BOT_LOGS')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    ledgerTab === 'BOT_LOGS'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Live Bot Log ({botLogs.length})
                </button>
              </div>
            </div>

            {ledgerTab === 'BACKTEST_TRADES' ? (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-[#11141A] border-b border-white/[0.06] text-[11px] text-slate-400">
                    <tr>
                      <th className="py-2 px-3 font-medium">Side</th>
                      <th className="py-2 px-3 font-medium">Entry Time</th>
                      <th className="py-2 px-3 font-medium text-right">Entry</th>
                      <th className="py-2 px-3 font-medium text-right">Exit</th>
                      <th className="py-2 px-3 font-medium">Reason</th>
                      <th className="py-2 px-3 font-medium text-right">Net P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {!backtestResult?.trades.length ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400">
                          No historical triggers fired on the current candle window. Adjust Pine conditions or SL/TP parameters.
                        </td>
                      </tr>
                    ) : (
                      [...backtestResult.trades].reverse().map((t) => (
                        <tr key={t.id} className="hover:bg-white/[0.02]">
                          <td
                            className={`py-2 px-3 font-semibold ${
                              t.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {t.side}
                          </td>
                          <td className="py-2 px-3 font-mono-tabular text-slate-300">
                            {new Date(t.entryTime * 1000).toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-tabular text-white">
                            {t.entryPrice}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-tabular text-white">
                            {t.exitPrice}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-400">
                            {t.exitReason.replace('_', ' ')}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-mono-tabular font-semibold ${
                              t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {t.pnl >= 0 ? '+' : ''}
                            {t.pnl.toLocaleString()} ({t.returnPct}%)
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-[#11141A] border-b border-white/[0.06] text-[11px] text-slate-400">
                    <tr>
                      <th className="py-2 px-3 font-medium">Time</th>
                      <th className="py-2 px-3 font-medium">Strategy · Market</th>
                      <th className="py-2 px-3 font-medium">Verdict</th>
                      <th className="py-2 px-3 font-medium text-right">Price</th>
                      <th className="py-2 px-3 font-medium">Execution Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {botLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          Click &ldquo;Start Bot&rdquo; on any Pine strategy or &ldquo;Check Live Bar Now&rdquo; to evaluate real-time candles.
                        </td>
                      </tr>
                    ) : (
                      botLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-white/[0.02]">
                          <td className="py-2 px-3 font-mono-tabular text-slate-400 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="py-2 px-3 text-white">
                            <div className="font-medium truncate max-w-[180px]">{log.strategyName}</div>
                            <div className="text-[11px] text-slate-400">
                              {log.instrumentSymbol} · {log.timeframe.toUpperCase()}
                            </div>
                          </td>
                          <td
                            className={`py-2 px-3 font-semibold ${
                              log.action === 'BUY'
                                ? 'text-emerald-400'
                                : log.action === 'SELL'
                                  ? 'text-red-400'
                                  : log.action === 'ERROR'
                                    ? 'text-amber-400'
                                    : 'text-slate-400'
                            }`}
                          >
                            {log.action}
                            {log.executed ? ' · SENT' : ''}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-tabular text-white">
                            {log.price ? log.price.toLocaleString() : '—'}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-300 max-w-[260px] truncate">
                            {log.detail}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
