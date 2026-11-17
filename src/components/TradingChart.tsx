import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  AlertCircle,
  ExternalLink,
  Layers,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';
import type {
  CandleBar,
  GeneratedSignalPayload,
  InstrumentMeta,
  MarketQuoteResponse,
  StrategyConfig,
  Timeframe,
} from '../types/trading';

interface TradingChartProps {
  instrument: InstrumentMeta;
  quote: MarketQuoteResponse | null;
  loading: boolean;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  onRefresh: () => void;
  liveStreaming: boolean;
  onToggleLiveStreaming: () => void;
  config: StrategyConfig;
  activeSignal?: GeneratedSignalPayload | null;
}

type ChartMode = 'SHARAN_LIVE' | 'STREAM_WIDGET';

function calcEmaPoints(candles: CandleBar[], period: number) {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  let prev = candles[0].close;
  return candles.map((c, idx) => {
    const val = idx === 0 ? c.close : c.close * k + prev * (1 - k);
    prev = val;
    return { time: c.time as UTCTimestamp, value: Number(val.toFixed(4)) };
  });
}

function calcVwapPoints(candles: CandleBar[]) {
  let pv = 0;
  let vol = 0;
  return candles.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    const v = c.volume > 0 ? c.volume : 1;
    pv += typical * v;
    vol += v;
    return { time: c.time as UTCTimestamp, value: Number((pv / vol).toFixed(4)) };
  });
}

function mapTimeframeToTv(tf: Timeframe): string {
  switch (tf) {
    case '5m':
      return '5';
    case '15m':
      return '15';
    case '1h':
      return '60';
    case '4h':
      return '240';
    case '1d':
      return 'D';
  }
}

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

export const TradingChart: React.FC<TradingChartProps> = ({
  instrument,
  quote,
  loading,
  timeframe,
  onTimeframeChange,
  onRefresh,
  liveStreaming,
  onToggleLiveStreaming,
  config,
  activeSignal,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const hasFitRef = useRef<boolean>(false);
  const lastStructureKeyRef = useRef<string>('');
  const lastLevelsKeyRef = useRef<string>('');

  const [chartMode, setChartMode] = useState<ChartMode>('SHARAN_LIVE');
  const [showEmas, setShowEmas] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const [showLevels, setShowLevels] = useState(true);

  const uniqueCandles = useMemo(() => {
    if (!quote?.candles?.length) return [];
    const seen = new Set<number>();
    const out: CandleBar[] = [];
    for (const c of [...quote.candles].sort((a, b) => a.time - b.time)) {
      if (!seen.has(c.time)) {
        seen.add(c.time);
        out.push(c);
      }
    }
    return out;
  }, [quote]);

  const hasChartData = Boolean(quote?.available && uniqueCandles.length > 0);

  // Reset initial viewport fit and incremental keys when switching instrument or timeframe
  useEffect(() => {
    hasFitRef.current = false;
    lastStructureKeyRef.current = '';
    lastLevelsKeyRef.current = '';
  }, [instrument.id, timeframe, chartMode]);

  // 1. Initialize chart instance only when structural layout changes (prevents 4s live-tick flicker)
  useEffect(() => {
    if (chartMode !== 'SHARAN_LIVE' || !containerRef.current || !hasChartData) return;

    const el = containerRef.current;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 410,
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
      crosshair: {
        vertLine: { color: 'rgba(148, 163, 184, 0.35)', labelBackgroundColor: '#1E293B' },
        horzLine: { color: 'rgba(148, 163, 184, 0.35)', labelBackgroundColor: '#1E293B' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderUpColor: '#10B981',
      borderDownColor: '#EF4444',
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    markersPluginRef.current = createSeriesMarkers(candleSeries, []);

    if (showEmas) {
      emaFastRef.current = chart.addSeries(LineSeries, {
        color: '#F59E0B',
        lineWidth: 2,
        priceLineVisible: false,
        title: `EMA ${config.emaFast}`,
      });
      emaMidRef.current = chart.addSeries(LineSeries, {
        color: '#38BDF8',
        lineWidth: 1,
        priceLineVisible: false,
        title: `EMA ${config.emaMid}`,
      });
      emaSlowRef.current = chart.addSeries(LineSeries, {
        color: '#A855F7',
        lineWidth: 1,
        priceLineVisible: false,
        title: `EMA ${config.emaSlow}`,
      });
    } else {
      emaFastRef.current = null;
      emaMidRef.current = null;
      emaSlowRef.current = null;
    }

    if (showVwap) {
      vwapSeriesRef.current = chart.addSeries(LineSeries, {
        color: '#E2E8F0',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        title: 'VWAP',
      });
    } else {
      vwapSeriesRef.current = null;
    }

    const observer = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      priceLinesRef.current = [];
      markersPluginRef.current = null;
      candleSeriesRef.current = null;
      emaFastRef.current = null;
      emaMidRef.current = null;
      emaSlowRef.current = null;
      vwapSeriesRef.current = null;
      chartRef.current = null;
      lastStructureKeyRef.current = '';
      lastLevelsKeyRef.current = '';
      chart.remove();
    };
  }, [
    chartMode,
    hasChartData,
    instrument.id,
    timeframe,
    showEmas,
    showVwap,
    config.emaFast,
    config.emaMid,
    config.emaSlow,
  ]);

  // 2. Fast O(1) incremental live tick update vs full dataset reset on instrument/timeframe change
  useEffect(() => {
    if (
      chartMode !== 'SHARAN_LIVE' ||
      !chartRef.current ||
      !candleSeriesRef.current ||
      !quote?.available ||
      uniqueCandles.length === 0
    ) {
      return;
    }

    const candleSeries = candleSeriesRef.current;
    const lastBar = uniqueCandles[uniqueCandles.length - 1];
    const structureKey = `${chartMode}:${instrument.id}:${timeframe}:${showEmas}:${showVwap}:${config.emaFast}:${config.emaMid}:${config.emaSlow}:${uniqueCandles.length}:${uniqueCandles[0].time}:${lastBar.time}`;

    if (lastStructureKeyRef.current === structureKey) {
      // O(1) single-bar update on live tick — zero layout thrash
      candleSeries.update({
        time: lastBar.time as UTCTimestamp,
        open: lastBar.open,
        high: lastBar.high,
        low: lastBar.low,
        close: lastBar.close,
      });

      if (showEmas) {
        const fastPts = calcEmaPoints(uniqueCandles, config.emaFast);
        const midPts = calcEmaPoints(uniqueCandles, config.emaMid);
        const slowPts = calcEmaPoints(uniqueCandles, config.emaSlow);
        if (fastPts.length) emaFastRef.current?.update(fastPts[fastPts.length - 1]);
        if (midPts.length) emaMidRef.current?.update(midPts[midPts.length - 1]);
        if (slowPts.length) emaSlowRef.current?.update(slowPts[slowPts.length - 1]);
      }

      if (showVwap) {
        const vwapPts = calcVwapPoints(uniqueCandles);
        if (vwapPts.length) vwapSeriesRef.current?.update(vwapPts[vwapPts.length - 1]);
      }
    } else {
      candleSeries.setData(
        uniqueCandles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );

      if (showEmas) {
        emaFastRef.current?.setData(calcEmaPoints(uniqueCandles, config.emaFast));
        emaMidRef.current?.setData(calcEmaPoints(uniqueCandles, config.emaMid));
        emaSlowRef.current?.setData(calcEmaPoints(uniqueCandles, config.emaSlow));
      }

      if (showVwap) {
        vwapSeriesRef.current?.setData(calcVwapPoints(uniqueCandles));
      }

      lastStructureKeyRef.current = structureKey;
    }

    const levelsKey = `${showLevels}:${quote.levels?.immediateResistance ?? ''}:${quote.levels?.immediateSupport ?? ''}:${activeSignal?.instrument ?? ''}:${activeSignal?.direction ?? ''}:${activeSignal?.entryPrice ?? ''}:${activeSignal?.stopLoss ?? ''}:${activeSignal?.target1 ?? ''}:${activeSignal?.target2 ?? ''}:${lastBar.time}`;

    if (lastLevelsKeyRef.current !== levelsKey) {
      for (const line of priceLinesRef.current) {
        try {
          candleSeries.removePriceLine(line);
        } catch {
          // ignore if already removed
        }
      }
      priceLinesRef.current = [];

      if (showLevels && quote.levels) {
        priceLinesRef.current.push(
          candleSeries.createPriceLine({
            price: quote.levels.immediateResistance,
            color: 'rgba(239, 68, 68, 0.65)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'R1',
          }),
          candleSeries.createPriceLine({
            price: quote.levels.immediateSupport,
            color: 'rgba(16, 185, 129, 0.65)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'S1',
          })
        );
      }

      const markers: SeriesMarker<Time>[] = [];
      if (
        activeSignal &&
        activeSignal.instrument === quote.instrument.symbol &&
        activeSignal.direction !== 'NO_TRADE' &&
        activeSignal.entryPrice > 0
      ) {
        priceLinesRef.current.push(
          candleSeries.createPriceLine({
            price: activeSignal.entryPrice,
            color: '#38BDF8',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `${activeSignal.direction} ENTRY`,
          })
        );

        if (activeSignal.stopLoss > 0) {
          priceLinesRef.current.push(
            candleSeries.createPriceLine({
              price: activeSignal.stopLoss,
              color: '#EF4444',
              lineWidth: 2,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: 'SL',
            })
          );
        }
        if (activeSignal.target1 > 0) {
          priceLinesRef.current.push(
            candleSeries.createPriceLine({
              price: activeSignal.target1,
              color: '#10B981',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: 'T1',
            })
          );
        }
        if (activeSignal.target2 > 0) {
          priceLinesRef.current.push(
            candleSeries.createPriceLine({
              price: activeSignal.target2,
              color: '#10B981',
              lineWidth: 2,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: 'T2',
            })
          );
        }

        markers.push({
          time: lastBar.time as UTCTimestamp,
          position: activeSignal.direction === 'BUY' ? 'belowBar' : 'aboveBar',
          color: activeSignal.direction === 'BUY' ? '#10B981' : '#EF4444',
          shape: activeSignal.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `${activeSignal.direction} @ ${activeSignal.entryPrice}`,
        });
      }

      markersPluginRef.current?.setMarkers(markers);
      lastLevelsKeyRef.current = levelsKey;
    }

    if (!hasFitRef.current) {
      chartRef.current.timeScale().fitContent();
      hasFitRef.current = true;
    }
  }, [
    chartMode,
    instrument.id,
    timeframe,
    quote,
    uniqueCandles,
    showEmas,
    showVwap,
    showLevels,
    config,
    activeSignal,
  ]);

  const tvEmbedUrl = useMemo(() => {
    const tvSymbol = instrument.tradingViewSymbol;
    const tvInterval = mapTimeframeToTv(timeframe);
    return `https://s.tradingview.com/widgetembed/?frameElementId=sharan_tv_widget&symbol=${encodeURIComponent(
      tvSymbol
    )}&interval=${tvInterval}&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=0C0F14&studies=%5B%22MAExp%40tv-basicstudies%22%2C%22VWAP%40tv-basicstudies%22%2C%22RSI%40tv-basicstudies%22%5D&theme=dark&style=1&timezone=Asia%2FKolkata&withdateranges=1&showpopupbutton=0&locale=en`;
  }, [instrument.tradingViewSymbol, timeframe]);

  return (
    <div className="bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <span>{quote?.instrument.symbol ?? instrument.symbol}</span>
              <span className="text-slate-500">·</span>
              <span className="text-xs font-normal text-slate-400">
                {quote?.instrument.exchangeLabel ?? instrument.exchangeLabel}
              </span>
              {liveStreaming && quote?.available && (
                <>
                  <span className="text-slate-500">·</span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    LIVE
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate">
              {chartMode === 'STREAM_WIDGET'
                ? `Real-Time Stream Widget (${instrument.tradingViewSymbol}) · Timeframe ${timeframe.toUpperCase()}`
                : quote?.available
                  ? `${quote.provider} · Updated ${new Date(quote.marketTimestamp).toLocaleTimeString()}`
                  : quote?.statusText || 'Connecting to live feed'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Chart Engine Mode Switch */}
          <div className="flex items-center bg-[#090B0E] border border-white/[0.08] rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setChartMode('SHARAN_LIVE')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'SHARAN_LIVE'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              SHARAN Live
            </button>
            <button
              type="button"
              onClick={() => setChartMode('STREAM_WIDGET')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'STREAM_WIDGET'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Stream Widget
            </button>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center bg-[#090B0E] border border-white/[0.08] rounded-lg p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  timeframe === tf
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          {chartMode === 'SHARAN_LIVE' && (
            <>
              <button
                type="button"
                onClick={() => setShowEmas((v) => !v)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  showEmas
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-[#090B0E] border-white/[0.08] text-slate-400'
                }`}
              >
                EMA {config.emaFast}/{config.emaMid}/{config.emaSlow}
              </button>

              <button
                type="button"
                onClick={() => setShowVwap((v) => !v)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  showVwap
                    ? 'bg-slate-700/40 border-slate-500/40 text-slate-200'
                    : 'bg-[#090B0E] border-white/[0.08] text-slate-400'
                }`}
              >
                VWAP
              </button>

              <button
                type="button"
                onClick={() => setShowLevels((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  showLevels
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-[#090B0E] border-white/[0.08] text-slate-400'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                S/R Levels
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onToggleLiveStreaming}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              liveStreaming
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-[#090B0E] border-white/[0.08] text-slate-400'
            }`}
          >
            {liveStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {liveStreaming ? 'Live 1.5s' : 'Paused'}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh chart data"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Sync
          </button>

          <a
            href={instrument.investingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Investing.com
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {chartMode === 'STREAM_WIDGET' ? (
        <div className="w-full h-[410px] bg-[#0C0F14]">
          <iframe
            key={`${instrument.id}-${timeframe}`}
            src={tvEmbedUrl}
            title={`${instrument.symbol} Live Chart`}
            className="w-full h-full border-0"
            allow="fullscreen"
          />
        </div>
      ) : loading && !quote ? (
        <div className="h-[410px] flex items-center justify-center bg-[#0C0F14] text-sm text-slate-400">
          Connecting to live OHLCV candlestick feed...
        </div>
      ) : quote && !quote.available ? (
        <div className="h-[410px] flex flex-col items-center justify-center bg-[#0C0F14] p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-amber-400" />
          <div className="text-base font-semibold text-white">DATA UNAVAILABLE</div>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            {quote.unavailableReason ||
              'Live OHLCV feed is currently unavailable. No simulated prices are shown.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setChartMode('STREAM_WIDGET')}
              className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
            >
              Switch to Stream Widget
            </button>
            <a
              href={instrument.investingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-sky-300 rounded-lg transition-colors"
            >
              Open Investing.com Chart
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-[410px] bg-[#0C0F14]" />
      )}
    </div>
  );
};
