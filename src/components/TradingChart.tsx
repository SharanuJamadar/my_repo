import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
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
  ArrowRightToLine,
  BarChart3,
  CandlestickChart,
  Crosshair,
  ExternalLink,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Ruler,
  Trash2,
  TrendingUp,
  Undo2,
  ZoomIn,
  ZoomOut,
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
  onLivePriceTick?: (instrumentId: string, price: number) => void;
}

type ChartMode = 'MY_TRADE_LIVE' | 'TRADING_VIEW';
type ChartStyle = 'CANDLES' | 'AREA';
type DrawingTool = 'CROSSHAIR' | 'TRENDLINE' | 'HLINE' | 'MEASURE';
type WsConnStatus = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

interface LogicalPoint {
  logical: number;
  price: number;
}

interface TrendlineDrawing {
  id: string;
  kind: 'TRENDLINE';
  p1: LogicalPoint;
  p2: LogicalPoint;
}

interface MeasureDrawing {
  id: string;
  kind: 'MEASURE';
  p1: LogicalPoint;
  p2: LogicalPoint;
}

interface HLineDrawing {
  id: string;
  kind: 'HLINE';
  price: number;
}

type UserDrawing = TrendlineDrawing | MeasureDrawing | HLineDrawing;

interface HoveredBarStats {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  changePct: number;
}

function timeframeToSeconds(tf: Timeframe): number {
  switch (tf) {
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '1h':
      return 3600;
    case '4h':
      return 14400;
    case '1d':
      return 86400;
  }
}

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

function formatPrice(val: number): string {
  if (!Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  const decimals = abs >= 1000 ? 2 : abs >= 10 ? 2 : 4;
  return val.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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
  onLivePriceTick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const emaFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const userHLineRefs = useRef<IPriceLine[]>([]);

  const hasFitRef = useRef<boolean>(false);
  const lastStructureKeyRef = useRef<string>('');
  const lastLevelsKeyRef = useRef<string>('');
  const lastRestBarHashRef = useRef<string>('');
  const lastPlottedTimeRef = useRef<number>(0);
  const lastIndicatorTimeRef = useRef<number>(0);
  const latestBarRef = useRef<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);
  const pendingTickRef = useRef<{ price: number; ts: number } | null>(null);
  const lastUiNotifyAtRef = useRef<number>(0);
  const onLivePriceTickRef = useRef(onLivePriceTick);
  onLivePriceTickRef.current = onLivePriceTick;
  const liveHeaderPriceRef = useRef<HTMLSpanElement | null>(null);

  const [chartMode, setChartMode] = useState<ChartMode>('MY_TRADE_LIVE');
  const [chartStyle, setChartStyle] = useState<ChartStyle>('CANDLES');
  const [wsStatus, setWsStatus] = useState<WsConnStatus>('IDLE');
  const [showEmas, setShowEmas] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showLevels, setShowLevels] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  // Interactive TradingView-style Drawing Tools & Crosshair HUD
  const [activeTool, setActiveTool] = useState<DrawingTool>('CROSSHAIR');
  const [drawings, setDrawings] = useState<UserDrawing[]>([]);
  const [pendingPoint, setPendingPoint] = useState<LogicalPoint | null>(null);
  const [previewPoint, setPreviewPoint] = useState<LogicalPoint | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [hoveredStats, setHoveredStats] = useState<HoveredBarStats | null>(null);

  const supportsBinanceWs = Boolean(instrument.binanceSymbol || instrument.binanceFuturesSymbol);
  const chartHeight = isExpanded ? 580 : 450;

  const uniqueCandles = useMemo(() => {
    if (!quote?.candles?.length) return [];
    const seen = new Set<number>();
    const normalized: CandleBar[] = [];
    for (const c of quote.candles) {
      const t = Math.floor(Number(c.time));
      if (
        !Number.isFinite(t) ||
        t <= 0 ||
        !Number.isFinite(c.open) ||
        !Number.isFinite(c.high) ||
        !Number.isFinite(c.low) ||
        !Number.isFinite(c.close)
      ) {
        continue;
      }
      normalized.push({ ...c, time: t });
    }
    normalized.sort((a, b) => a.time - b.time);
    const out: CandleBar[] = [];
    for (const c of normalized) {
      if (!seen.has(c.time)) {
        seen.add(c.time);
        out.push(c);
      }
    }
    return out;
  }, [quote]);

  const hasChartData = Boolean(quote?.available && uniqueCandles.length > 0);

  const latestStats = useMemo<HoveredBarStats | null>(() => {
    if (uniqueCandles.length === 0) return null;
    const last = uniqueCandles[uniqueCandles.length - 1];
    const changePct = last.open ? ((last.close - last.open) / last.open) * 100 : 0;
    return {
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: last.volume,
      changePct,
    };
  }, [uniqueCandles]);

  // Escape exits fullscreen or active drawing tool
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingPoint) {
          setPendingPoint(null);
          setPreviewPoint(null);
        } else if (activeTool !== 'CROSSHAIR') {
          setActiveTool('CROSSHAIR');
        } else if (isExpanded) {
          setIsExpanded(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingPoint, activeTool, isExpanded]);

  // Clear instrument-specific drawings & reset viewport refs on instrument/timeframe change
  useEffect(() => {
    hasFitRef.current = false;
    lastStructureKeyRef.current = '';
    lastLevelsKeyRef.current = '';
    lastRestBarHashRef.current = '';
    lastPlottedTimeRef.current = 0;
    lastIndicatorTimeRef.current = 0;
    latestBarRef.current = null;
    pendingTickRef.current = null;
    setPendingPoint(null);
    setPreviewPoint(null);
    setHoveredStats(null);
  }, [instrument.id, timeframe, chartMode]);

  useEffect(() => {
    setDrawings([]);
    setPendingPoint(null);
    setPreviewPoint(null);
  }, [instrument.id]);

  // Zoom & Viewport Controls
  const handleZoomIn = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const span = range.to - range.from;
    if (span <= 8) return;
    const nextSpan = Math.max(8, span * 0.72);
    const rightAnchor = range.to;
    ts.setVisibleLogicalRange({
      from: rightAnchor - nextSpan,
      to: rightAnchor,
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const span = range.to - range.from;
    const maxBars = Math.max(uniqueCandles.length + 20, 120);
    const nextSpan = Math.min(maxBars, Math.max(12, span * 1.4));
    const rightAnchor = range.to;
    ts.setVisibleLogicalRange({
      from: rightAnchor - nextSpan,
      to: rightAnchor,
    });
  }, [uniqueCandles.length]);

  const handleResetView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().fitContent();
  }, []);

  const handleScrollToLatest = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().scrollToRealTime();
  }, []);

  // 1. Initialize Lightweight Charts canvas
  useEffect(() => {
    if (chartMode !== 'MY_TRADE_LIVE' || !containerRef.current || !hasChartData) return;

    const el = containerRef.current;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: chartHeight,
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
        vertLine: { color: 'rgba(201, 162, 77, 0.45)', labelBackgroundColor: '#1E293B' },
        horzLine: { color: 'rgba(201, 162, 77, 0.45)', labelBackgroundColor: '#1E293B' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        scaleMargins: {
          top: 0.08,
          bottom: showVolume ? 0.22 : 0.08,
        },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 8,
        minBarSpacing: 1.5,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
    });

    const mainSeries =
      chartStyle === 'AREA'
        ? chart.addSeries(AreaSeries, {
            lineColor: '#10B981',
            topColor: 'rgba(16, 185, 129, 0.28)',
            bottomColor: 'rgba(16, 185, 129, 0.02)',
            lineWidth: 2,
          })
        : chart.addSeries(CandlestickSeries, {
            upColor: '#10B981',
            downColor: '#EF4444',
            borderUpColor: '#10B981',
            borderDownColor: '#EF4444',
            wickUpColor: '#10B981',
            wickDownColor: '#EF4444',
          });

    chartRef.current = chart;
    mainSeriesRef.current = mainSeries;
    markersPluginRef.current = createSeriesMarkers(mainSeries, []);

    if (showVolume) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.82,
          bottom: 0,
        },
      });
      volumeSeriesRef.current = volSeries;
    } else {
      volumeSeriesRef.current = null;
    }

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

    // Re-project SVG drawings cleanly when panning/zooming
    const handleRangeChange = () => {
      setRenderTick((t) => (t + 1) % 1_000_000);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);

    // Update OHLCV HUD on crosshair hover
    const handleCrosshair = (param: any) => {
      if (!param || !param.time) {
        setHoveredStats(null);
        return;
      }
      const data = param.seriesData?.get(mainSeries);
      if (!data) {
        setHoveredStats(null);
        return;
      }
      const volData = volumeSeriesRef.current ? param.seriesData?.get(volumeSeriesRef.current) : null;
      if (typeof data.open === 'number') {
        const changePct = data.open ? ((data.close - data.open) / data.open) * 100 : 0;
        setHoveredStats({
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: typeof volData?.value === 'number' ? volData.value : undefined,
          changePct,
        });
      } else if (typeof data.value === 'number') {
        setHoveredStats({
          open: data.value,
          high: data.value,
          low: data.value,
          close: data.value,
          volume: typeof volData?.value === 'number' ? volData.value : undefined,
          changePct: 0,
        });
      }
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    const observer = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || chartHeight,
        });
        setRenderTick((t) => (t + 1) % 1_000_000);
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      priceLinesRef.current = [];
      userHLineRefs.current = [];
      markersPluginRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      emaFastRef.current = null;
      emaMidRef.current = null;
      emaSlowRef.current = null;
      vwapSeriesRef.current = null;
      chartRef.current = null;
      lastStructureKeyRef.current = '';
      lastLevelsKeyRef.current = '';
      lastRestBarHashRef.current = '';
      lastPlottedTimeRef.current = 0;
      lastIndicatorTimeRef.current = 0;
      chart.remove();
    };
  }, [
    chartMode,
    chartStyle,
    hasChartData,
    instrument.id,
    timeframe,
    showEmas,
    showVwap,
    showVolume,
    config.emaFast,
    config.emaMid,
    config.emaSlow,
    chartHeight,
  ]);

  // Apply chartHeight dynamically when toggling expanded mode without recreating series data
  useEffect(() => {
    if (chartRef.current && containerRef.current) {
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: chartHeight,
      });
    }
  }, [chartHeight]);

  // 2. Sync Candles, Indicators, Volume & S/R Levels
  useEffect(() => {
    if (
      chartMode !== 'MY_TRADE_LIVE' ||
      !chartRef.current ||
      !mainSeriesRef.current ||
      !quote?.available ||
      uniqueCandles.length === 0
    ) {
      return;
    }

    const mainSeries = mainSeriesRef.current;
    const rawLastBar = uniqueCandles[uniqueCandles.length - 1];

    const existingLiveBar = latestBarRef.current;
    let effectiveCandles = uniqueCandles;
    if (existingLiveBar && existingLiveBar.time > rawLastBar.time) {
      effectiveCandles = [
        ...uniqueCandles,
        {
          time: existingLiveBar.time,
          open: existingLiveBar.open,
          high: existingLiveBar.high,
          low: existingLiveBar.low,
          close: existingLiveBar.close,
          volume: rawLastBar.volume,
        },
      ];
    } else if (existingLiveBar && existingLiveBar.time === rawLastBar.time) {
      effectiveCandles = [
        ...uniqueCandles.slice(0, -1),
        {
          ...rawLastBar,
          high: Math.max(rawLastBar.high, existingLiveBar.high),
          low: Math.min(rawLastBar.low, existingLiveBar.low),
          close: existingLiveBar.close,
        },
      ];
    }

    const effectiveLastBar = effectiveCandles[effectiveCandles.length - 1];
    if (!existingLiveBar || effectiveLastBar.time >= existingLiveBar.time) {
      latestBarRef.current = {
        time: effectiveLastBar.time,
        open: effectiveLastBar.open,
        high: effectiveLastBar.high,
        low: effectiveLastBar.low,
        close: effectiveLastBar.close,
        volume: effectiveLastBar.volume,
      };
    }

    if (liveHeaderPriceRef.current && quote.price !== undefined) {
      liveHeaderPriceRef.current.textContent = `${instrument.currency}${quote.price.toLocaleString()}`;
    }

    const structureKey = `${chartMode}:${chartStyle}:${instrument.id}:${timeframe}:${showEmas}:${showVwap}:${showVolume}:${config.emaFast}:${config.emaMid}:${config.emaSlow}:${effectiveCandles.length}:${effectiveCandles[0].time}:${effectiveLastBar.time}`;
    const restBarHash = `${rawLastBar.time}:${rawLastBar.open}:${rawLastBar.high}:${rawLastBar.low}:${rawLastBar.close}`;

    if (lastStructureKeyRef.current === structureKey) {
      if (
        lastRestBarHashRef.current !== restBarHash &&
        effectiveLastBar.time >= lastPlottedTimeRef.current
      ) {
        try {
          if (chartStyle === 'AREA') {
            (mainSeries as ISeriesApi<'Area'>).update({
              time: effectiveLastBar.time as UTCTimestamp,
              value: effectiveLastBar.close,
            });
          } else {
            (mainSeries as ISeriesApi<'Candlestick'>).update({
              time: effectiveLastBar.time as UTCTimestamp,
              open: effectiveLastBar.open,
              high: effectiveLastBar.high,
              low: effectiveLastBar.low,
              close: effectiveLastBar.close,
            });
          }
          if (showVolume && volumeSeriesRef.current) {
            volumeSeriesRef.current.update({
              time: effectiveLastBar.time as UTCTimestamp,
              value: effectiveLastBar.volume || 0,
              color:
                effectiveLastBar.close >= effectiveLastBar.open
                  ? 'rgba(16, 185, 129, 0.32)'
                  : 'rgba(239, 68, 68, 0.32)',
            });
          }
          lastPlottedTimeRef.current = effectiveLastBar.time;
        } catch {
          // Ignore out-of-order edge case safely
        }

        if (effectiveLastBar.time >= lastIndicatorTimeRef.current) {
          try {
            if (showEmas) {
              const fastPts = calcEmaPoints(effectiveCandles, config.emaFast);
              const midPts = calcEmaPoints(effectiveCandles, config.emaMid);
              const slowPts = calcEmaPoints(effectiveCandles, config.emaSlow);
              if (fastPts.length) emaFastRef.current?.update(fastPts[fastPts.length - 1]);
              if (midPts.length) emaMidRef.current?.update(midPts[midPts.length - 1]);
              if (slowPts.length) emaSlowRef.current?.update(slowPts[slowPts.length - 1]);
            }

            if (showVwap) {
              const vwapPts = calcVwapPoints(effectiveCandles);
              if (vwapPts.length) vwapSeriesRef.current?.update(vwapPts[vwapPts.length - 1]);
            }
            lastIndicatorTimeRef.current = effectiveLastBar.time;
          } catch {
            // Ignore indicator ordering edge case safely
          }
        }
        lastRestBarHashRef.current = restBarHash;
      }
    } else {
      if (chartStyle === 'AREA') {
        (mainSeries as ISeriesApi<'Area'>).setData(
          effectiveCandles.map((c) => ({
            time: c.time as UTCTimestamp,
            value: c.close,
          }))
        );
      } else {
        (mainSeries as ISeriesApi<'Candlestick'>).setData(
          effectiveCandles.map((c) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }))
        );
      }

      if (showVolume && volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(
          effectiveCandles.map((c) => ({
            time: c.time as UTCTimestamp,
            value: c.volume || 0,
            color:
              c.close >= c.open ? 'rgba(16, 185, 129, 0.32)' : 'rgba(239, 68, 68, 0.32)',
          }))
        );
      }

      if (showEmas) {
        emaFastRef.current?.setData(calcEmaPoints(effectiveCandles, config.emaFast));
        emaMidRef.current?.setData(calcEmaPoints(effectiveCandles, config.emaMid));
        emaSlowRef.current?.setData(calcEmaPoints(effectiveCandles, config.emaSlow));
      }

      if (showVwap) {
        vwapSeriesRef.current?.setData(calcVwapPoints(effectiveCandles));
      }

      lastPlottedTimeRef.current = effectiveLastBar.time;
      lastIndicatorTimeRef.current = effectiveLastBar.time;
      lastRestBarHashRef.current = restBarHash;
      lastStructureKeyRef.current = structureKey;
    }

    const levelsKey = `${chartStyle}:${showLevels}:${quote.levels?.immediateResistance ?? ''}:${quote.levels?.immediateSupport ?? ''}:${activeSignal?.instrument ?? ''}:${activeSignal?.direction ?? ''}:${activeSignal?.entryPrice ?? ''}:${activeSignal?.stopLoss ?? ''}:${activeSignal?.target1 ?? ''}:${activeSignal?.target2 ?? ''}:${effectiveLastBar.time}`;

    if (lastLevelsKeyRef.current !== levelsKey) {
      for (const line of priceLinesRef.current) {
        try {
          mainSeries.removePriceLine(line);
        } catch {
          // Ignore already removed price line
        }
      }
      priceLinesRef.current = [];

      if (showLevels && quote.levels) {
        priceLinesRef.current.push(
          mainSeries.createPriceLine({
            price: quote.levels.immediateResistance,
            color: 'rgba(239, 68, 68, 0.65)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'R1',
          }),
          mainSeries.createPriceLine({
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
          mainSeries.createPriceLine({
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
            mainSeries.createPriceLine({
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
            mainSeries.createPriceLine({
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
            mainSeries.createPriceLine({
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
          time: effectiveLastBar.time as UTCTimestamp,
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
    chartStyle,
    instrument.id,
    timeframe,
    quote,
    uniqueCandles,
    showEmas,
    showVwap,
    showVolume,
    showLevels,
    config,
    activeSignal,
  ]);

  // Sync User Horizontal Price Lines onto Lightweight Charts series
  useEffect(() => {
    const series = mainSeriesRef.current;
    if (!series) return;

    for (const line of userHLineRefs.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // Ignore already removed price line
      }
    }
    userHLineRefs.current = [];

    for (const d of drawings) {
      if (d.kind === 'HLINE') {
        userHLineRefs.current.push(
          series.createPriceLine({
            price: d.price,
            color: '#C9A24D',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: 'LEVEL',
          })
        );
      }
    }
  }, [drawings, chartMode, chartStyle, hasChartData]);

  // 3. Real 30ms Binance Spot/Futures WebSocket stream
  useEffect(() => {
    if (chartMode !== 'MY_TRADE_LIVE' || !liveStreaming || !supportsBinanceWs) {
      setWsStatus('IDLE');
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let retryMs = 1200;
    const tfSec = timeframeToSeconds(timeframe);

    const connect = () => {
      if (disposed) return;
      setWsStatus(retryMs > 1200 ? 'RECONNECTING' : 'CONNECTING');
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${wsProto}//${window.location.host}/ws/market?instrument=${encodeURIComponent(
        instrument.id
      )}`;

      try {
        socket = new WebSocket(url);
      } catch {
        reconnectTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 1.5, 8000);
        return;
      }

      socket.onopen = () => {
        if (disposed) {
          socket?.close();
          return;
        }
        retryMs = 1200;
        setWsStatus('CONNECTED');
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as {
            type?: string;
            price?: number;
            ts?: number;
          };
          if (payload?.type === 'tick' && typeof payload.price === 'number' && payload.price > 0) {
            pendingTickRef.current = {
              price: payload.price,
              ts: typeof payload.ts === 'number' ? payload.ts : Date.now(),
            };
          }
        } catch {
          // Ignore invalid WS payloads
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        setWsStatus('RECONNECTING');
        reconnectTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 1.5, 8000);
      };

      socket.onerror = () => {
        try {
          socket?.close();
        } catch {
          // Ignore close error
        }
      };
    };

    connect();

    const flushTimer = window.setInterval(() => {
      const tick = pendingTickRef.current;
      if (!tick || !mainSeriesRef.current || !latestBarRef.current) return;
      pendingTickRef.current = null;

      const tickBucket = Math.floor(tick.ts / 1000 / tfSec) * tfSec;
      if (!Number.isFinite(tickBucket) || tickBucket <= 0) return;

      const curBar = latestBarRef.current;
      const anchorTime = Math.max(curBar.time, lastPlottedTimeRef.current);
      const nextBar =
        tickBucket > anchorTime
          ? {
              time: tickBucket,
              open: tick.price,
              high: tick.price,
              low: tick.price,
              close: tick.price,
              volume: curBar.volume,
            }
          : {
              time: anchorTime,
              open: curBar.open,
              high: Math.max(curBar.high, tick.price),
              low: Math.min(curBar.low, tick.price),
              close: tick.price,
              volume: curBar.volume,
            };

      latestBarRef.current = nextBar;
      try {
        if (chartStyle === 'AREA') {
          (mainSeriesRef.current as ISeriesApi<'Area'>).update({
            time: nextBar.time as UTCTimestamp,
            value: nextBar.close,
          });
        } else {
          (mainSeriesRef.current as ISeriesApi<'Candlestick'>).update({
            time: nextBar.time as UTCTimestamp,
            open: nextBar.open,
            high: nextBar.high,
            low: nextBar.low,
            close: nextBar.close,
          });
        }
        lastPlottedTimeRef.current = nextBar.time;
      } catch {
        // Guard async interval from throwing on out-of-order ticks
      }

      if (liveHeaderPriceRef.current) {
        liveHeaderPriceRef.current.textContent = `${instrument.currency}${tick.price.toLocaleString()}`;
      }

      const now = Date.now();
      if (onLivePriceTickRef.current && now - lastUiNotifyAtRef.current >= 250) {
        lastUiNotifyAtRef.current = now;
        onLivePriceTickRef.current(instrument.id, tick.price);
      }
    }, 30);

    return () => {
      disposed = true;
      window.clearInterval(flushTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // Ignore cleanup close
      }
    };
  }, [
    chartMode,
    chartStyle,
    liveStreaming,
    supportsBinanceWs,
    instrument.id,
    instrument.currency,
    timeframe,
  ]);

  // Convert pointer event to chart logical/price coords for Drawing Tools
  const eventToLogicalPoint = (e: React.MouseEvent<SVGSVGElement>): LogicalPoint | null => {
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    if (!chart || !series) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const logical = chart.timeScale().coordinateToLogical(x);
    const price = series.coordinateToPrice(y);
    if (logical === null || price === null) return null;
    return { logical: Number(logical), price: Number(price) };
  };

  const handleOverlayClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === 'CROSSHAIR') return;
    const pt = eventToLogicalPoint(e);
    if (!pt) return;

    if (activeTool === 'HLINE') {
      setDrawings((prev) => [
        ...prev,
        { id: `hl-${Date.now()}`, kind: 'HLINE', price: Number(pt.price.toFixed(4)) },
      ]);
      return;
    }

    if (activeTool === 'TRENDLINE' || activeTool === 'MEASURE') {
      if (!pendingPoint) {
        setPendingPoint(pt);
        setPreviewPoint(pt);
      } else {
        setDrawings((prev) => [
          ...prev,
          {
            id: `${activeTool.toLowerCase()}-${Date.now()}`,
            kind: activeTool,
            p1: pendingPoint,
            p2: pt,
          },
        ]);
        setPendingPoint(null);
        setPreviewPoint(null);
      }
    }
  };

  const handleOverlayMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!pendingPoint) return;
    const pt = eventToLogicalPoint(e);
    if (pt) setPreviewPoint(pt);
  };

  const projectPoint = (pt: LogicalPoint): { x: number; y: number } | null => {
    void renderTick;
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    if (!chart || !series) return null;
    const x = chart.timeScale().logicalToCoordinate(pt.logical as any);
    const y = series.priceToCoordinate(pt.price);
    if (x === null || y === null) return null;
    return { x: Number(x), y: Number(y) };
  };

  const tvEmbedUrl = useMemo(() => {
    const tvSymbol = instrument.tradingViewSymbol;
    const tvInterval = mapTimeframeToTv(timeframe);
    return `https://s.tradingview.com/widgetembed/?frameElementId=mytrade_tv_widget&symbol=${encodeURIComponent(
      tvSymbol
    )}&interval=${tvInterval}&hidesidetoolbar=0&hidetoptoolbar=0&symboledit=1&saveimage=1&toolbarbg=0C0F14&studies=%5B%22MAExp%40tv-basicstudies%22%2C%22VWAP%40tv-basicstudies%22%2C%22RSI%40tv-basicstudies%22%5D&theme=dark&style=1&timezone=Asia%2FKolkata&withdateranges=1&details=0&showpopupbutton=0&locale=en`;
  }, [instrument.tradingViewSymbol, timeframe]);

  const tvExternalChartUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
    instrument.tradingViewSymbol
  )}`;

  const displayStats = hoveredStats ?? latestStats;

  return (
    <div
      className={`bg-[#11141A] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col ${
        isExpanded ? 'fixed inset-3 z-50 shadow-2xl' : ''
      }`}
    >
      {/* Top Row: Market Identity + Engine Mode + External TradingView Link */}
      <div className="px-4 py-3 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
            <span>{quote?.instrument.symbol ?? instrument.symbol}</span>
            <span className="text-slate-500">·</span>
            <span className="text-xs font-normal text-slate-400">
              {quote?.instrument.exchangeLabel ?? instrument.exchangeLabel}
            </span>
            {quote?.available && quote.price !== undefined && (
              <>
                <span className="text-slate-500">·</span>
                <span
                  ref={liveHeaderPriceRef}
                  className="font-mono-tabular text-sm font-semibold text-emerald-300"
                >
                  {instrument.currency}
                  {quote.price.toLocaleString()}
                </span>
              </>
            )}
            {liveStreaming && quote?.available && chartMode === 'MY_TRADE_LIVE' && (
              <>
                <span className="text-slate-500">·</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {supportsBinanceWs && wsStatus === 'CONNECTED' ? 'WS 30ms' : 'LIVE'}
                </span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-400 truncate mt-0.5">
            {chartMode === 'TRADING_VIEW'
              ? `TradingView Interactive Chart (${instrument.tradingViewSymbol}) · Drawing tools, indicators & zoom enabled`
              : quote?.available
                ? `${quote.provider} · ${
                    supportsBinanceWs
                      ? wsStatus === 'CONNECTED'
                        ? 'Binance WS 30ms stream'
                        : 'Binance WS connecting...'
                      : '1.5s Live Poll'
                  } · Updated ${new Date(quote.marketTimestamp).toLocaleTimeString()}`
                : quote?.statusText || 'Connecting to live feed'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Chart Engine Mode Switch: My Trade Live vs TradingView */}
          <div className="flex items-center bg-[#090B0E] border border-white/[0.08] rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setChartMode('MY_TRADE_LIVE')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'MY_TRADE_LIVE'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              My Trade Live
            </button>
            <button
              type="button"
              onClick={() => setChartMode('TRADING_VIEW')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'TRADING_VIEW'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              TradingView
            </button>
          </div>

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
            {liveStreaming ? (supportsBinanceWs ? 'WS 30ms' : 'Live 1.5s') : 'Paused'}
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
            href={tvExternalChartUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            TradingView
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Second Toolbar: Timeframes, Series Style, Studies & Zoom Controls */}
      <div className="px-4 py-2 border-b border-white/[0.06] bg-[#0C0F14]/80 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframe Selector */}
          <div className="flex items-center bg-[#090B0E] border border-white/[0.08] rounded-lg p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  timeframe === tf
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          {chartMode === 'MY_TRADE_LIVE' && (
            <>
              {/* Chart Style: Candles vs Area */}
              <div className="flex items-center bg-[#090B0E] border border-white/[0.08] rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setChartStyle('CANDLES')}
                  title="Candlestick Chart"
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    chartStyle === 'CANDLES'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <CandlestickChart className="w-3.5 h-3.5" />
                  <span>Candles</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChartStyle('AREA')}
                  title="Line / Area Chart"
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    chartStyle === 'AREA'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Area</span>
                </button>
              </div>

              {/* Technical Indicator Toggles */}
              <button
                type="button"
                onClick={() => setShowEmas((v) => !v)}
                className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  showEmas
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-[#090B0E] border-white/[0.08] text-slate-400 hover:text-slate-200'
                }`}
              >
                EMA {config.emaFast}/{config.emaMid}/{config.emaSlow}
              </button>

              <button
                type="button"
                onClick={() => setShowVwap((v) => !v)}
                className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  showVwap
                    ? 'bg-slate-700/40 border-slate-500/40 text-slate-200'
                    : 'bg-[#090B0E] border-white/[0.08] text-slate-400 hover:text-slate-200'
                }`}
              >
                VWAP
              </button>

              <button
                type="button"
                onClick={() => setShowVolume((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  showVolume
                    ? 'bg-sky-500/10 border-sky-500/30 text-sky-300'
                    : 'bg-[#090B0E] border-white/[0.08] text-slate-400 hover:text-slate-200'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Vol</span>
              </button>

              <button
                type="button"
                onClick={() => setShowLevels((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  showLevels
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-[#090B0E] border-white/[0.08] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>S/R</span>
              </button>
            </>
          )}
        </div>

        {/* Zoom In, Zoom Out, Fit & Expand Controls */}
        <div className="flex items-center gap-1.5">
          {chartMode === 'MY_TRADE_LIVE' && (
            <div className="flex items-center bg-[#090B0E] border border-white/[0.08] rounded-lg p-0.5">
              <button
                type="button"
                onClick={handleZoomIn}
                title="Zoom In"
                aria-label="Zoom in chart"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <ZoomIn className="w-3.5 h-3.5" />
                <span>Zoom In</span>
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                title="Zoom Out"
                aria-label="Zoom out chart"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <ZoomOut className="w-3.5 h-3.5" />
                <span>Zoom Out</span>
              </button>
              <button
                type="button"
                onClick={handleResetView}
                title="Fit All Candles"
                aria-label="Fit chart view"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Fit</span>
              </button>
              <button
                type="button"
                onClick={handleScrollToLatest}
                title="Jump to Latest Bar"
                aria-label="Jump to latest candle"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowRightToLine className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            title={isExpanded ? 'Exit Fullscreen' : 'Expand Chart'}
            aria-label={isExpanded ? 'Exit fullscreen chart' : 'Expand chart'}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-[#090B0E] hover:bg-slate-800 border border-white/[0.08] text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isExpanded ? 'Exit' : 'Expand'}</span>
          </button>
        </div>
      </div>

      {/* Main Chart Surface */}
      {chartMode === 'TRADING_VIEW' ? (
        <div
          className={`w-full bg-[#0C0F14] ${
            isExpanded ? 'flex-1 min-h-0' : 'h-[490px]'
          }`}
        >
          <iframe
            key={`${instrument.id}-${timeframe}`}
            src={tvEmbedUrl}
            title={`${instrument.symbol} TradingView Chart`}
            className="w-full h-full border-0"
            allow="fullscreen"
          />
        </div>
      ) : loading && !quote ? (
        <div
          style={{ height: chartHeight }}
          className="flex items-center justify-center bg-[#0C0F14] text-sm text-slate-400"
        >
          Connecting to live OHLCV candlestick feed...
        </div>
      ) : quote && !quote.available ? (
        <div
          style={{ height: chartHeight }}
          className="flex flex-col items-center justify-center bg-[#0C0F14] p-6 text-center space-y-3"
        >
          <AlertCircle className="w-8 h-8 text-amber-400" />
          <div className="text-base font-semibold text-white">DATA UNAVAILABLE</div>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            {quote.unavailableReason ||
              'Live OHLCV feed is currently unavailable. Switch to the interactive TradingView chart below.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setChartMode('TRADING_VIEW')}
              className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
            >
              Open TradingView Chart
            </button>
            <a
              href={tvExternalChartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#11141A] hover:bg-slate-800 border border-white/[0.08] text-sky-300 rounded-lg transition-colors"
            >
              Launch TradingView.com
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      ) : (
        <div className={`flex ${isExpanded ? 'flex-1 min-h-0' : ''}`}>
          {/* TradingView-style Left Vertical Drawing Tool Rail */}
          <div
            aria-label="Chart drawing tools"
            className="w-11 shrink-0 border-r border-white/[0.08] bg-[#0C0F14] py-2.5 flex flex-col items-center justify-between"
          >
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setActiveTool('CROSSHAIR');
                  setPendingPoint(null);
                  setPreviewPoint(null);
                }}
                title="Crosshair / Pan & Scroll Zoom"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'CROSSHAIR'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Crosshair className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTool('TRENDLINE');
                  setPendingPoint(null);
                  setPreviewPoint(null);
                }}
                title="Trend Line (Click 2 points)"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'TRENDLINE'
                    ? 'bg-[#C9A24D] text-[#090B0E]'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTool('HLINE');
                  setPendingPoint(null);
                  setPreviewPoint(null);
                }}
                title="Horizontal Price Line (Click chart)"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'HLINE'
                    ? 'bg-[#C9A24D] text-[#090B0E]'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Minus className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTool('MEASURE');
                  setPendingPoint(null);
                  setPreviewPoint(null);
                }}
                title="Price & Bar Range Ruler (Click 2 points)"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'MEASURE'
                    ? 'bg-[#C9A24D] text-[#090B0E]'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Ruler className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col items-center gap-1.5 pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                disabled={drawings.length === 0}
                onClick={() => setDrawings((prev) => prev.slice(0, -1))}
                title="Undo Last Drawing"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={drawings.length === 0}
                onClick={() => {
                  setDrawings([]);
                  setPendingPoint(null);
                  setPreviewPoint(null);
                }}
                title="Clear All Drawings"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Chart Canvas + Floating OHLCV Legend + Synced Vector Overlay */}
          <div
            style={isExpanded ? undefined : { height: chartHeight }}
            className={`relative flex-1 min-w-0 bg-[#0C0F14] ${isExpanded ? 'h-full' : ''}`}
          >
            {/* Floating OHLCV HUD */}
            {displayStats && (
              <div className="pointer-events-none absolute top-2.5 left-3 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#0C0F14]/85 backdrop-blur-sm border border-white/[0.06] rounded-md px-2.5 py-1 text-[11px] font-mono-tabular">
                <span className="text-slate-400">
                  O <span className="text-white">{formatPrice(displayStats.open)}</span>
                </span>
                <span className="text-slate-400">
                  H <span className="text-emerald-400">{formatPrice(displayStats.high)}</span>
                </span>
                <span className="text-slate-400">
                  L <span className="text-red-400">{formatPrice(displayStats.low)}</span>
                </span>
                <span className="text-slate-400">
                  C{' '}
                  <span className={displayStats.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {formatPrice(displayStats.close)} ({displayStats.changePct >= 0 ? '+' : ''}
                    {displayStats.changePct.toFixed(2)}%)
                  </span>
                </span>
                {typeof displayStats.volume === 'number' && displayStats.volume > 0 && (
                  <span className="text-slate-400">
                    V <span className="text-sky-300">{Math.round(displayStats.volume).toLocaleString()}</span>
                  </span>
                )}
              </div>
            )}

            {/* Active Drawing Tool Helper Prompt */}
            {activeTool !== 'CROSSHAIR' && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-20 bg-[#11141A]/95 border border-[#C9A24D]/40 rounded-md px-2.5 py-1 text-[11px] text-[#E6EDF3]">
                {activeTool === 'HLINE' && 'Click chart to place horizontal level · Press Esc to exit'}
                {activeTool === 'TRENDLINE' &&
                  (pendingPoint
                    ? 'Click second point to complete trendline · Press Esc to cancel'
                    : 'Click first anchor point for trendline · Press Esc to exit')}
                {activeTool === 'MEASURE' &&
                  (pendingPoint
                    ? 'Click target price/bar to finish range measurement · Press Esc to cancel'
                    : 'Click starting bar/price to measure move % · Press Esc to exit')}
              </div>
            )}

            {/* Lightweight Charts Host Container */}
            <div ref={containerRef} className="w-full h-full" />

            {/* Interactive SVG Overlay synced to Chart LogicalRange & PriceScale */}
            <svg
              onClick={handleOverlayClick}
              onMouseMove={handleOverlayMove}
              className={`absolute inset-0 w-full h-full z-10 ${
                activeTool === 'CROSSHAIR'
                  ? 'pointer-events-none'
                  : 'pointer-events-auto cursor-crosshair'
              }`}
            >
              {drawings.map((d) => {
                if (d.kind === 'HLINE') return null;
                const a = projectPoint(d.p1);
                const b = projectPoint(d.p2);
                if (!a || !b) return null;

                if (d.kind === 'TRENDLINE') {
                  return (
                    <g key={d.id}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="#C9A24D"
                        strokeWidth={2}
                      />
                      <circle cx={a.x} cy={a.y} r={3.5} fill="#C9A24D" />
                      <circle cx={b.x} cy={b.y} r={3.5} fill="#C9A24D" />
                    </g>
                  );
                }

                // Measure box
                const minX = Math.min(a.x, b.x);
                const minY = Math.min(a.y, b.y);
                const w = Math.abs(b.x - a.x);
                const h = Math.abs(b.y - a.y);
                const priceDiff = d.p2.price - d.p1.price;
                const pctDiff = d.p1.price ? (priceDiff / d.p1.price) * 100 : 0;
                const barCount = Math.abs(Math.round(d.p2.logical - d.p1.logical));
                const isUp = priceDiff >= 0;
                const accent = isUp ? '#10B981' : '#EF4444';

                return (
                  <g key={d.id}>
                    <rect
                      x={minX}
                      y={minY}
                      width={Math.max(w, 1)}
                      height={Math.max(h, 1)}
                      fill={isUp ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)'}
                      stroke={accent}
                      strokeWidth={1.2}
                      strokeDasharray="4 3"
                    />
                    <rect
                      x={minX}
                      y={Math.max(4, minY - 22)}
                      width={164}
                      height={18}
                      rx={4}
                      fill="#11141A"
                      stroke={accent}
                      strokeWidth={0.8}
                    />
                    <text
                      x={minX + 6}
                      y={Math.max(16, minY - 10)}
                      fill="#F8FAFC"
                      fontSize="10"
                      fontFamily="'JetBrains Mono', monospace"
                    >
                      {`${priceDiff >= 0 ? '+' : ''}${formatPrice(priceDiff)} (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(2)}%) · ${barCount}b`}
                    </text>
                  </g>
                );
              })}

              {/* Live Rubber-Band Preview while drawing Point 2 */}
              {pendingPoint && previewPoint && (() => {
                const a = projectPoint(pendingPoint);
                const b = projectPoint(previewPoint);
                if (!a || !b) return null;
                if (activeTool === 'TRENDLINE') {
                  return (
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#C9A24D"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  );
                }
                if (activeTool === 'MEASURE') {
                  const minX = Math.min(a.x, b.x);
                  const minY = Math.min(a.y, b.y);
                  const w = Math.abs(b.x - a.x);
                  const h = Math.abs(b.y - a.y);
                  return (
                    <rect
                      x={minX}
                      y={minY}
                      width={Math.max(w, 1)}
                      height={Math.max(h, 1)}
                      fill="rgba(56, 189, 248, 0.10)"
                      stroke="#38BDF8"
                      strokeWidth={1}
                      strokeDasharray="4 3"
                    />
                  );
                }
                return null;
              })()}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
};
