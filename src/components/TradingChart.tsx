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
  AlignJustify,
  ArrowRightToLine,
  ArrowUpRight,
  BarChart3,
  Bell,
  Calendar,
  CandlestickChart,
  Crosshair,
  ExternalLink,
  FileText,
  Layers,
  List,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Ruler,
  Square,
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
  TradeJournalEntry,
  TradeTrailState,
} from '../types/trading';
import { useTheme } from '../lib/theme';
import { evaluateMrxReversalStrategy } from '../lib/mrxStrategy';

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
  openTrades?: TradeJournalEntry[];
  tradeProtectionMap?: Record<string, TradeTrailState>;
  onLivePriceTick?: (instrumentId: string, price: number) => void;
  onQuickOrder?: (side: 'BUY' | 'SELL', quantity: number) => Promise<void> | void;
  onQuickPriceAlert?: (price: number) => void;
  mrXEnabled?: boolean;
  onToggleMrX?: () => void;
  focusMyTradeChartSignal?: number;
  headerAccessory?: React.ReactNode;
  secondaryStrip?: React.ReactNode;
  compact?: boolean;
}

type ChartMode = 'MY_TRADE_LIVE' | 'TRADING_VIEW';
type ChartStyle = 'CANDLES' | 'AREA';
type DrawingTool =
  | 'CROSSHAIR'
  | 'TRENDLINE'
  | 'RAY'
  | 'FIBONACCI'
  | 'HLINE'
  | 'RECTANGLE'
  | 'MEASURE';
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

interface RayDrawing {
  id: string;
  kind: 'RAY';
  p1: LogicalPoint;
  p2: LogicalPoint;
}

interface FibonacciDrawing {
  id: string;
  kind: 'FIBONACCI';
  p1: LogicalPoint;
  p2: LogicalPoint;
}

interface RectangleDrawing {
  id: string;
  kind: 'RECTANGLE';
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

type UserDrawing =
  | TrendlineDrawing
  | RayDrawing
  | FibonacciDrawing
  | RectangleDrawing
  | MeasureDrawing
  | HLineDrawing;

const FIB_LEVELS = [
  { ratio: 0, label: '0.0%', color: '#94A3B8', band: 'rgba(148, 163, 184, 0.07)' },
  { ratio: 0.236, label: '23.6%', color: '#38BDF8', band: 'rgba(56, 189, 248, 0.08)' },
  { ratio: 0.382, label: '38.2%', color: '#10B981', band: 'rgba(16, 185, 129, 0.09)' },
  { ratio: 0.5, label: '50.0%', color: '#818CF8', band: 'rgba(245, 158, 11, 0.14)' },
  { ratio: 0.618, label: '61.8% GP', color: '#F59E0B', band: 'rgba(236, 72, 153, 0.08)' },
  { ratio: 0.786, label: '78.6%', color: '#EC4899', band: 'rgba(148, 163, 184, 0.06)' },
  { ratio: 1, label: '100.0%', color: '#94A3B8', band: 'transparent' },
] as const;

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

const TV_DEFAULT_WATCHLIST = [
  'OANDA:XAUUSD',
  'OANDA:XAGUSD',
  'NSE:NIFTY',
  'NSE:BANKNIFTY',
  'TVC:USOIL',
  'NASDAQ:NDX',
  'SP:SPX',
  'FX:EURUSD',
  'FX:GBPUSD',
  'BINANCE:BTCUSDT',
  'BINANCE:ETHUSDT',
  'BINANCE:SOLUSDT',
];

interface TradingViewAdvancedEmbedProps {
  symbol: string;
  interval: string;
  theme: 'dark' | 'light';
  showDetails: boolean;
  showWatchlist: boolean;
  showCalendar: boolean;
}

const TradingViewAdvancedEmbed: React.FC<TradingViewAdvancedEmbedProps> = React.memo(
  ({ symbol, interval, theme, showDetails, showWatchlist, showCalendar }) => {
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      host.innerHTML = '';

      const widgetDiv = document.createElement('div');
      widgetDiv.className = 'tradingview-widget-container__widget w-full h-full';
      host.appendChild(widgetDiv);

      const script = document.createElement('script');
      script.src =
        'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      script.type = 'text/javascript';
      script.async = true;
      script.innerHTML = JSON.stringify({
        autosize: true,
        symbol,
        interval,
        timezone: 'Asia/Kolkata',
        theme,
        style: '1',
        locale: 'en',
        backgroundColor: theme === 'dark' ? '#0B1424' : '#FFFFFF',
        gridColor: theme === 'dark' ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.06)',
        allow_symbol_change: true,
        hide_top_toolbar: false,
        hide_side_toolbar: false,
        hide_legend: false,
        hide_volume: false,
        save_image: true,
        withdateranges: true,
        details: showDetails,
        hotlist: false,
        calendar: showCalendar,
        watchlist: showWatchlist ? TV_DEFAULT_WATCHLIST : undefined,
        studies: ['STD;EMA', 'STD;VWAP'],
        support_host: 'https://www.tradingview.com',
      });
      host.appendChild(script);

      return () => {
        host.innerHTML = '';
      };
    }, [symbol, interval, theme, showDetails, showWatchlist, showCalendar]);

    return <div ref={hostRef} className="tradingview-widget-container w-full h-full" />;
  }
);

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
  openTrades,
  tradeProtectionMap,
  onLivePriceTick,
  onQuickOrder,
  onQuickPriceAlert,
  mrXEnabled,
  onToggleMrX,
  focusMyTradeChartSignal,
  headerAccessory,
  secondaryStrip,
  compact = false,
}) => {
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const emaFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const mrxEma9Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const mrxEma15Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const mrxEma30Ref = useRef<ISeriesApi<'Line'> | null>(null);
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

  const [chartMode, setChartMode] = useState<ChartMode>(() =>
    mrXEnabled ? 'MY_TRADE_LIVE' : 'TRADING_VIEW'
  );
  const [chartStyle, setChartStyle] = useState<ChartStyle>('CANDLES');
  const [wsStatus, setWsStatus] = useState<WsConnStatus>('IDLE');
  const [showEmas, setShowEmas] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showLevels, setShowLevels] = useState(true);
  const [internalMrXEnabled, setInternalMrXEnabled] = useState(false);
  const showMrX = mrXEnabled ?? internalMrXEnabled;
  const handleToggleMrX = useCallback(() => {
    const next = !showMrX;
    if (next && chartMode !== 'MY_TRADE_LIVE') {
      setChartMode('MY_TRADE_LIVE');
    }
    if (onToggleMrX) {
      onToggleMrX();
    } else {
      setInternalMrXEnabled(next);
    }
  }, [showMrX, chartMode, onToggleMrX]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (focusMyTradeChartSignal && focusMyTradeChartSignal > 0) {
      setChartMode('MY_TRADE_LIVE');
    }
  }, [focusMyTradeChartSignal]);

  // Full TradingView Advanced Chart panel toggles
  const [tvShowWatchlist, setTvShowWatchlist] = useState(false);
  const [tvShowDetails, setTvShowDetails] = useState(false);
  const [tvShowCalendar, setTvShowCalendar] = useState(false);

  // Interactive TradingView-style Drawing Tools & Crosshair HUD (for My Trade Live mode)
  const [activeTool, setActiveTool] = useState<DrawingTool>('CROSSHAIR');
  const [drawings, setDrawings] = useState<UserDrawing[]>([]);
  const [pendingPoint, setPendingPoint] = useState<LogicalPoint | null>(null);
  const [previewPoint, setPreviewPoint] = useState<LogicalPoint | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [hoveredStats, setHoveredStats] = useState<HoveredBarStats | null>(null);
  const [quickQty, setQuickQty] = useState<string>('1');
  const [quickOrdering, setQuickOrdering] = useState<'BUY' | 'SELL' | null>(null);
  const loadedDrawingsKeyRef = useRef<string>('');

  const supportsBinanceWs = Boolean(instrument.binanceSymbol || instrument.binanceFuturesSymbol);
  const chartHeight = isExpanded ? 780 : compact ? 620 : 700;

  const selectDrawingTool = useCallback(
    (tool: DrawingTool) => {
      if (tool !== 'CROSSHAIR' && chartMode !== 'MY_TRADE_LIVE') {
        setChartMode('MY_TRADE_LIVE');
      }
      setActiveTool(tool);
      setPendingPoint(null);
      setPreviewPoint(null);
    },
    [chartMode]
  );

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

  // Load persisted drawings for the active instrument from localStorage
  useEffect(() => {
    const storageKey = `mytrade_chart_drawings_${instrument.id}`;
    loadedDrawingsKeyRef.current = '';
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setDrawings(parsed.slice(0, 40));
        } else {
          setDrawings([]);
        }
      } else {
        setDrawings([]);
      }
    } catch {
      setDrawings([]);
    }
    loadedDrawingsKeyRef.current = storageKey;
    setPendingPoint(null);
    setPreviewPoint(null);
  }, [instrument.id]);

  // Persist drawings to localStorage whenever they change for the loaded instrument
  useEffect(() => {
    const storageKey = `mytrade_chart_drawings_${instrument.id}`;
    if (loadedDrawingsKeyRef.current !== storageKey) return;
    try {
      if (drawings.length === 0) {
        window.localStorage.removeItem(storageKey);
      } else {
        window.localStorage.setItem(storageKey, JSON.stringify(drawings.slice(0, 40)));
      }
    } catch {
      // Ignore storage quota issues
    }
  }, [drawings, instrument.id]);

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
        background: { type: ColorType.Solid, color: isDark ? '#0B1424' : '#FFFFFF' },
        textColor: isDark ? '#94A3B8' : '#475569',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(148,163,184,0.08)' : '#F1F5F9' },
        horzLines: { color: isDark ? 'rgba(148,163,184,0.08)' : '#F1F5F9' },
      },
      crosshair: {
        vertLine: {
          color: isDark ? 'rgba(56, 189, 248, 0.45)' : 'rgba(29, 78, 216, 0.35)',
          labelBackgroundColor: isDark ? '#1E293B' : '#0F172A',
        },
        horzLine: {
          color: isDark ? 'rgba(56, 189, 248, 0.45)' : 'rgba(29, 78, 216, 0.35)',
          labelBackgroundColor: isDark ? '#1E293B' : '#0F172A',
        },
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(148,163,184,0.16)' : '#E2E8F0',
        scaleMargins: {
          top: 0.08,
          bottom: showVolume ? 0.22 : 0.08,
        },
      },
      timeScale: {
        borderColor: isDark ? 'rgba(148,163,184,0.16)' : '#E2E8F0',
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

    if (showMrX) {
      mrxEma9Ref.current = chart.addSeries(LineSeries, {
        color: '#84CC16',
        lineWidth: 2,
        priceLineVisible: false,
        title: 'MRX EMA 9',
      });
      mrxEma15Ref.current = chart.addSeries(LineSeries, {
        color: '#F97316',
        lineWidth: 2,
        priceLineVisible: false,
        title: 'MRX EMA 15',
      });
      mrxEma30Ref.current = chart.addSeries(LineSeries, {
        color: '#EF4444',
        lineWidth: 2,
        priceLineVisible: false,
        title: 'MRX EMA 30',
      });
      emaFastRef.current = null;
      emaMidRef.current = null;
      emaSlowRef.current = null;
    } else if (showEmas) {
      mrxEma9Ref.current = null;
      mrxEma15Ref.current = null;
      mrxEma30Ref.current = null;
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
      mrxEma9Ref.current = null;
      mrxEma15Ref.current = null;
      mrxEma30Ref.current = null;
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
      mrxEma9Ref.current = null;
      mrxEma15Ref.current = null;
      mrxEma30Ref.current = null;
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
    showMrX,
    showVwap,
    showVolume,
    config.emaFast,
    config.emaMid,
    config.emaSlow,
    chartHeight,
    isDark,
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

    const mrxEval = showMrX ? evaluateMrxReversalStrategy(effectiveCandles) : null;
    const structureKey = `${chartMode}:${chartStyle}:${instrument.id}:${timeframe}:${showEmas}:${showMrX}:${showVwap}:${showVolume}:${config.emaFast}:${config.emaMid}:${config.emaSlow}:${effectiveCandles.length}:${effectiveCandles[0].time}:${effectiveLastBar.time}`;
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
            if (showMrX && mrxEval) {
              const p9 = mrxEval.ema9Series[mrxEval.ema9Series.length - 1];
              const p15 = mrxEval.ema15Series[mrxEval.ema15Series.length - 1];
              const p30 = mrxEval.ema30Series[mrxEval.ema30Series.length - 1];
              if (p9) mrxEma9Ref.current?.update({ time: p9.time as UTCTimestamp, value: p9.value });
              if (p15) mrxEma15Ref.current?.update({ time: p15.time as UTCTimestamp, value: p15.value });
              if (p30) mrxEma30Ref.current?.update({ time: p30.time as UTCTimestamp, value: p30.value });
            } else if (showEmas) {
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

      if (showMrX && mrxEval) {
        mrxEma9Ref.current?.setData(
          mrxEval.ema9Series.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
        );
        mrxEma15Ref.current?.setData(
          mrxEval.ema15Series.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
        );
        mrxEma30Ref.current?.setData(
          mrxEval.ema30Series.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
        );
      } else if (showEmas) {
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

    const normKey = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const instIdNorm = normKey(instrument.id);
    const instSymNorm = normKey(instrument.symbol);
    const matchingOpenTrades = (openTrades || []).filter((t) => {
      if (t.status !== 'OPEN') return false;
      const tNorm = normKey(t.instrument);
      const matches = tNorm === instIdNorm || tNorm === instSymNorm || tNorm.includes(instIdNorm);
      if (!matches) return false;
      const refPrice = effectiveLastBar.close;
      return Math.abs(refPrice - t.entryPrice) / Math.max(t.entryPrice, 1) <= 0.45;
    });

    const openTradesKey = matchingOpenTrades
      .map((t) => {
        const tr = tradeProtectionMap?.[t.id];
        return `${t.id}:${t.entryPrice}:${tr?.currentSl ?? t.stopLoss}:${tr?.tpStage ?? t.tpStage ?? 0}:${tr?.target1 ?? t.target1}:${tr?.target2 ?? t.target2 ?? ''}:${tr?.target3 ?? t.target3 ?? ''}`;
      })
      .join('|');

    const mrxSignalsKey = mrxEval
      ? `${mrxEval.signals.length}:${mrxEval.lastSignal?.time ?? ''}:${mrxEval.lastSignal?.direction ?? ''}`
      : 'off';

    const levelsKey = `${chartStyle}:${showLevels}:${showMrX}:${mrxSignalsKey}:${quote.levels?.immediateResistance ?? ''}:${quote.levels?.immediateSupport ?? ''}:${activeSignal?.instrument ?? ''}:${activeSignal?.direction ?? ''}:${activeSignal?.entryPrice ?? ''}:${activeSignal?.stopLoss ?? ''}:${activeSignal?.target1 ?? ''}:${activeSignal?.target2 ?? ''}:${openTradesKey}:${effectiveLastBar.time}`;

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

      // Overlay active open position Entry, Trailed SL, TP1, TP2, TP3 lines on canvas
      for (const pos of matchingOpenTrades.slice(0, 2)) {
        const trail = tradeProtectionMap?.[pos.id];
        const activeSl = trail ? trail.currentSl : pos.stopLoss;
        const tpStage = trail?.tpStage ?? pos.tpStage ?? 0;
        const tp1Val = trail?.target1 ?? pos.target1;
        const tp2Val = trail?.target2 ?? pos.target2;
        const tp3Val = trail?.target3 ?? pos.target3;

        priceLinesRef.current.push(
          mainSeries.createPriceLine({
            price: pos.entryPrice,
            color: '#2563EB',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `POS ${pos.direction} (${pos.quantity})`,
          })
        );
        if (activeSl > 0) {
          priceLinesRef.current.push(
            mainSeries.createPriceLine({
              price: activeSl,
              color: tpStage > 0 ? '#10B981' : '#EF4444',
              lineWidth: 2,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title:
                tpStage === 2
                  ? 'TRAIL SL (TP1)'
                  : tpStage === 1
                    ? 'TRAIL SL (BE)'
                    : 'POS SL',
            })
          );
        }
        if (tp1Val > 0) {
          priceLinesRef.current.push(
            mainSeries.createPriceLine({
              price: tp1Val,
              color: '#10B981',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: tpStage >= 1 ? 'TP1 ✓' : 'TP1',
            })
          );
        }
        if (tp2Val && tp2Val > 0) {
          priceLinesRef.current.push(
            mainSeries.createPriceLine({
              price: tp2Val,
              color: '#059669',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: tpStage >= 2 ? 'TP2 ✓' : 'TP2',
            })
          );
        }
        if (tp3Val && tp3Val > 0) {
          priceLinesRef.current.push(
            mainSeries.createPriceLine({
              price: tp3Val,
              color: '#0EA5E9',
              lineWidth: 2,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: 'TP3 EXIT',
            })
          );
        }
      }

      if (showMrX && mrxEval && mrxEval.signals.length > 0) {
        for (const sig of mrxEval.signals) {
          markers.push({
            time: sig.markerTime as UTCTimestamp,
            position: sig.direction === 'BUY' ? 'belowBar' : 'aboveBar',
            color: sig.direction === 'BUY' ? '#22C55E' : '#EF4444',
            shape: sig.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
            text: sig.direction,
          });
        }
      }

      markers.sort((a, b) => Number(a.time) - Number(b.time));
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
    instrument.symbol,
    timeframe,
    quote,
    uniqueCandles,
    showEmas,
    showMrX,
    showVwap,
    showVolume,
    showLevels,
    config,
    activeSignal,
    openTrades,
    tradeProtectionMap,
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
            color: isDark ? '#38BDF8' : '#1D4ED8',
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

    if (
      activeTool === 'TRENDLINE' ||
      activeTool === 'RAY' ||
      activeTool === 'FIBONACCI' ||
      activeTool === 'RECTANGLE' ||
      activeTool === 'MEASURE'
    ) {
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

  const priceToY = (price: number): number | null => {
    void renderTick;
    const series = mainSeriesRef.current;
    if (!series) return null;
    const y = series.priceToCoordinate(price);
    return y === null ? null : Number(y);
  };

  const tvInterval = useMemo(() => mapTimeframeToTv(timeframe), [timeframe]);

  const tvExternalChartUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
    instrument.tradingViewSymbol
  )}`;

  const displayStats = hoveredStats ?? latestStats;

  return (
    <div
      className={`bg-white dark:bg-[#0E182A] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col h-full ${
        isExpanded ? 'fixed inset-3 z-50 shadow-2xl' : ''
      }`}
    >
      {/* Top Row: Market Identity + Engine Mode + External TradingView Link */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <span>{quote?.instrument.symbol ?? instrument.symbol}</span>
            {headerAccessory && <span className="inline-flex items-center">{headerAccessory}</span>}
            <span className="text-slate-500">·</span>
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              {quote?.instrument.exchangeLabel ?? instrument.exchangeLabel}
            </span>
            {quote?.available && quote.price !== undefined && (
              <>
                <span className="text-slate-500">·</span>
                <span
                  ref={liveHeaderPriceRef}
                  className="font-mono-tabular text-sm font-semibold text-emerald-700 dark:text-emerald-300"
                >
                  {instrument.currency}
                  {quote.price.toLocaleString()}
                </span>
              </>
            )}
            {liveStreaming && quote?.available && chartMode === 'MY_TRADE_LIVE' && (
              <>
                <span className="text-slate-500">·</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {supportsBinanceWs && wsStatus === 'CONNECTED' ? 'WS 30ms' : 'LIVE'}
                </span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
            {chartMode === 'TRADING_VIEW'
              ? `TradingView Full Advanced Chart (${instrument.tradingViewSymbol}) · All drawing tools, Fibonacci, indicators, compare & symbol search`
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
          {/* Chart Engine Mode Switch: TradingView Full vs My Trade Live */}
          <div className="flex items-center bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setChartMode('TRADING_VIEW')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'TRADING_VIEW'
                  ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              TradingView Pro
            </button>
            <button
              type="button"
              onClick={() => setChartMode('MY_TRADE_LIVE')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'MY_TRADE_LIVE'
                  ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              My Trade Live
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleLiveStreaming}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              liveStreaming
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
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
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Sync
          </button>

          <a
            href={tvExternalChartUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-blue-700 dark:text-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            TradingView
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Second Toolbar: Timeframes, Series Style, Studies & Zoom Controls */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-[#0B1424]/90 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframe Selector */}
          <div className="flex items-center bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  timeframe === tf
                    ? 'bg-blue-700 dark:bg-slate-800 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          {chartMode === 'TRADING_VIEW' && (
            <>
              <button
                type="button"
                onClick={() => setTvShowWatchlist((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  tvShowWatchlist
                    ? 'bg-blue-50 dark:bg-sky-500/15 border-blue-200 dark:border-sky-500/35 text-blue-700 dark:text-sky-300'
                    : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>Watchlist</span>
              </button>

              <button
                type="button"
                onClick={() => setTvShowDetails((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  tvShowDetails
                    ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                    : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Details</span>
              </button>

              <button
                type="button"
                onClick={() => setTvShowCalendar((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  tvShowCalendar
                    ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/35 text-amber-700 dark:text-amber-300'
                    : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Calendar</span>
              </button>

              <button
                type="button"
                onClick={handleToggleMrX}
                title="Switch to My Trade Live Chart with MRX EMA 9/15/30 Continuous Strategy lines & BUY/SELL arrows"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  showMrX
                    ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>MRX 9/15/30</span>
              </button>
            </>
          )}

          {chartMode === 'MY_TRADE_LIVE' && (
            <>
              {/* Chart Style: Candles vs Area */}
              <div className="flex items-center bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setChartStyle('CANDLES')}
                  title="Candlestick Chart"
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    chartStyle === 'CANDLES'
                      ? 'bg-blue-700 dark:bg-slate-800 text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
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
                      ? 'bg-blue-700 dark:bg-slate-800 text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Area</span>
                </button>
              </div>

              {/* Technical Indicator Toggles */}
              <button
                type="button"
                onClick={handleToggleMrX}
                title="Toggle MRX EMA 9 (Lime) / EMA 15 (Orange) / EMA 30 (Red) Continuous Strategy & BUY/SELL Arrows"
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  showMrX
                    ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/45 text-emerald-700 dark:text-emerald-300'
                    : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>MRX 9/15/30</span>
              </button>

              <button
                type="button"
                onClick={() => setShowEmas((v) => !v)}
                className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  showEmas && !showMrX
                    ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/35 text-amber-700 dark:text-amber-300'
                    : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                EMA {config.emaFast}/{config.emaMid}/{config.emaSlow}
              </button>

              <button
                type="button"
                onClick={() => setShowVwap((v) => !v)}
                className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  showVwap
                    ? 'bg-slate-700/40 border-slate-500/40 text-slate-800 dark:text-slate-200'
                    : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                VWAP
              </button>

              <button
                type="button"
                onClick={() => setShowVolume((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  showVolume
                    ? 'bg-blue-50 dark:bg-sky-500/10 border-blue-200 dark:border-sky-500/35 text-blue-700 dark:text-sky-300'
                    : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
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
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                    : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
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
            <div className="flex items-center bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 rounded-lg p-0.5">
              <button
                type="button"
                onClick={handleZoomIn}
                title="Zoom In"
                aria-label="Zoom in chart"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <ZoomIn className="w-3.5 h-3.5" />
                <span>Zoom In</span>
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                title="Zoom Out"
                aria-label="Zoom out chart"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <ZoomOut className="w-3.5 h-3.5" />
                <span>Zoom Out</span>
              </button>
              <button
                type="button"
                onClick={handleResetView}
                title="Fit All Candles"
                aria-label="Fit chart view"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Fit</span>
              </button>
              <button
                type="button"
                onClick={handleScrollToLatest}
                title="Jump to Latest Bar"
                aria-label="Jump to latest candle"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-md transition-colors whitespace-nowrap shrink-0"
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
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isExpanded ? 'Exit' : 'Expand'}</span>
          </button>
        </div>
      </div>

      {/* Custom Drawing Tools Strip (shown in My Trade Live mode; TradingView Pro uses its own full native left drawing sidebar) */}
      {chartMode === 'MY_TRADE_LIVE' && (
        <div className="px-4 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1424]/70 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1.5">
              Draw:
            </span>
            {(
              [
                { id: 'CROSSHAIR', label: 'Cursor', icon: Crosshair, tip: 'Pan & Zoom Cursor' },
                { id: 'TRENDLINE', label: 'Trend Line', icon: TrendingUp, tip: 'Draw Trend Line (2 points)' },
                { id: 'RAY', label: 'Ray', icon: ArrowUpRight, tip: 'Draw Extended Trend Ray (projects right)' },
                { id: 'FIBONACCI', label: 'Fibonacci', icon: AlignJustify, tip: 'Fibonacci Retracement (0% - 100% + 61.8% Golden Pocket)' },
                { id: 'HLINE', label: 'H-Line', icon: Minus, tip: 'Horizontal Support / Resistance Line' },
                { id: 'RECTANGLE', label: 'Zone', icon: Square, tip: 'Supply / Demand Rectangle Zone' },
                { id: 'MEASURE', label: 'Ruler', icon: Ruler, tip: 'Price & Bar Range Ruler' },
              ] as const
            ).map((tool) => {
              const Icon = tool.icon;
              const active = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  title={tool.tip}
                  onClick={() => selectDrawingTool(tool.id)}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? tool.id === 'FIBONACCI'
                        ? 'bg-amber-600 dark:bg-amber-500 border-amber-600 dark:border-amber-500 text-white dark:text-slate-950 font-semibold'
                        : 'bg-blue-700 dark:bg-sky-500 border-blue-700 dark:border-sky-500 text-white dark:text-slate-950 font-semibold'
                      : 'bg-[#F4F6FA] dark:bg-[#08101E] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{tool.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            {drawings.length > 0 && (
              <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 mr-1">
                {drawings.length} saved
              </span>
            )}
            <button
              type="button"
              disabled={drawings.length === 0}
              onClick={() => setDrawings((prev) => prev.slice(0, -1))}
              title="Undo Last Drawing"
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-[#F4F6FA] dark:bg-[#08101E] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Undo2 className="w-3 h-3" />
              <span>Undo</span>
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
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-[#F4F6FA] dark:bg-[#08101E] text-slate-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-400 disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
        </div>
      )}

      {/* Institutional One-Click Quick-Trade Bar OR Symmetrical Secondary MTF Strip */}
      {onQuickOrder && quote?.available && typeof quote.price === 'number' ? (
        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E182A] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={quickOrdering !== null}
              onClick={async () => {
                const qty = Math.max(0.01, Number(quickQty) || 1);
                setQuickOrdering('SELL');
                try {
                  await onQuickOrder('SELL', qty);
                } finally {
                  setQuickOrdering(null);
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <span>{quickOrdering === 'SELL' ? 'Sending...' : 'SELL'}</span>
              <span className="font-mono-tabular text-[11px] opacity-95">
                {instrument.currency}
                {formatPrice(quote.bid ?? quote.price)}
              </span>
            </button>

            <div className="px-2 py-1 rounded-md bg-slate-100 dark:bg-[#08101E] border border-slate-200 dark:border-slate-800 text-[11px] font-mono-tabular text-slate-600 dark:text-slate-300">
              Spread{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {typeof quote.spreadBps === 'number'
                  ? `${quote.spreadBps.toFixed(1)} bps`
                  : typeof quote.spread === 'number'
                    ? formatPrice(quote.spread)
                    : '—'}
              </span>
            </div>

            <button
              type="button"
              disabled={quickOrdering !== null}
              onClick={async () => {
                const qty = Math.max(0.01, Number(quickQty) || 1);
                setQuickOrdering('BUY');
                try {
                  await onQuickOrder('BUY', qty);
                } finally {
                  setQuickOrdering(null);
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <span>{quickOrdering === 'BUY' ? 'Sending...' : 'BUY'}</span>
              <span className="font-mono-tabular text-[11px] opacity-95">
                {instrument.currency}
                {formatPrice(quote.ask ?? quote.price)}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span>Qty</span>
              <input
                type="number"
                min={0.01}
                step="any"
                value={quickQty}
                onChange={(e) => setQuickQty(e.target.value)}
                aria-label="Quick order quantity"
                className="w-16 px-2 py-1 rounded-md bg-[#F4F6FA] dark:bg-[#08101E] border border-slate-200 dark:border-slate-700 font-mono-tabular text-xs font-semibold text-slate-900 dark:text-white text-right"
              />
            </label>
            {onQuickPriceAlert && (
              <button
                type="button"
                onClick={() => onQuickPriceAlert(quote.price!)}
                title="Create quick price alert near current spot"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#F4F6FA] dark:bg-[#08101E] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 transition-colors"
              >
                <Bell className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>+ Alert</span>
              </button>
            )}
          </div>
        </div>
      ) : secondaryStrip ? (
        secondaryStrip
      ) : null}

      {/* Main Chart Surface */}
      {chartMode === 'TRADING_VIEW' ? (
        <div
          className={`w-full bg-white dark:bg-[#0B1424] ${
            isExpanded ? 'flex-1 min-h-0' : compact ? 'h-[620px]' : 'h-[700px]'
          }`}
        >
          <TradingViewAdvancedEmbed
            symbol={instrument.tradingViewSymbol}
            interval={tvInterval}
            theme={isDark ? 'dark' : 'light'}
            showDetails={tvShowDetails}
            showWatchlist={tvShowWatchlist}
            showCalendar={tvShowCalendar}
          />
        </div>
      ) : loading && !quote ? (
        <div
          style={{ height: chartHeight }}
          className="flex items-center justify-center bg-white dark:bg-[#0B1424] text-sm text-slate-500 dark:text-slate-400"
        >
          Connecting to live OHLCV candlestick feed...
        </div>
      ) : quote && !quote.available ? (
        <div
          style={{ height: chartHeight }}
          className="flex flex-col items-center justify-center bg-white dark:bg-[#0B1424] p-6 text-center space-y-3"
        >
          <AlertCircle className="w-8 h-8 text-amber-700 dark:text-amber-400" />
          <div className="text-base font-semibold text-slate-900 dark:text-white">DATA UNAVAILABLE</div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white dark:bg-[#0E182A] hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-blue-700 dark:text-sky-300 rounded-lg transition-colors"
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
            className="w-11 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1424] py-2.5 flex flex-col items-center justify-between"
          >
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => selectDrawingTool('CROSSHAIR')}
                title="Crosshair / Pan & Scroll Zoom"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'CROSSHAIR'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <Crosshair className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => selectDrawingTool('TRENDLINE')}
                title="Trend Line (Click 2 points)"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'TRENDLINE'
                    ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => selectDrawingTool('RAY')}
                title="Extended Trend Ray (Projects forward)"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'RAY'
                    ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <ArrowUpRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => selectDrawingTool('FIBONACCI')}
                title="Fibonacci Retracement (Click Swing 1 & Swing 2)"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'FIBONACCI'
                    ? 'bg-amber-600 dark:bg-amber-500 text-white dark:text-slate-950'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <AlignJustify className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => selectDrawingTool('HLINE')}
                title="Horizontal Price Line (Click chart)"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'HLINE'
                    ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <Minus className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => selectDrawingTool('RECTANGLE')}
                title="Supply / Demand Zone Box (Click 2 corners)"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'RECTANGLE'
                    ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <Square className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => selectDrawingTool('MEASURE')}
                title="Price & Bar Range Ruler (Click 2 points)"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  activeTool === 'MEASURE'
                    ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <Ruler className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col items-center gap-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={drawings.length === 0}
                onClick={() => setDrawings((prev) => prev.slice(0, -1))}
                title="Undo Last Drawing"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors"
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
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Chart Canvas + Floating OHLCV Legend + Synced Vector Overlay */}
          <div
            style={isExpanded ? undefined : { height: chartHeight }}
            className={`relative flex-1 min-w-0 bg-white dark:bg-[#0B1424] ${isExpanded ? 'h-full' : ''}`}
          >
            {/* Floating OHLCV HUD */}
            {displayStats && (
              <div className="pointer-events-none absolute top-2.5 left-3 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-50/95 dark:bg-[#0B1424]/90 backdrop-blur-sm border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1 text-[11px] font-mono-tabular">
                <span className="text-slate-500 dark:text-slate-400">
                  O <span className="text-slate-900 dark:text-white">{formatPrice(displayStats.open)}</span>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  H <span className="text-emerald-700 dark:text-emerald-400">{formatPrice(displayStats.high)}</span>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  L <span className="text-rose-700 dark:text-rose-400">{formatPrice(displayStats.low)}</span>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  C{' '}
                  <span className={displayStats.changePct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}>
                    {formatPrice(displayStats.close)} ({displayStats.changePct >= 0 ? '+' : ''}
                    {displayStats.changePct.toFixed(2)}%)
                  </span>
                </span>
                {typeof displayStats.volume === 'number' && displayStats.volume > 0 && (
                  <span className="text-slate-500 dark:text-slate-400">
                    V <span className="text-blue-700 dark:text-sky-300">{Math.round(displayStats.volume).toLocaleString()}</span>
                  </span>
                )}
              </div>
            )}

            {/* Active Drawing Tool Helper Prompt */}
            {activeTool !== 'CROSSHAIR' && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-20 bg-white/95 dark:bg-[#0E182A]/95 border border-blue-300 dark:border-sky-500/40 rounded-md px-2.5 py-1 text-[11px] text-slate-900 dark:text-slate-100">
                {activeTool === 'HLINE' && 'Horizontal Line: Click chart to place price level · Press Esc to exit'}
                {activeTool === 'TRENDLINE' &&
                  (pendingPoint
                    ? 'Trend Line: Click second anchor point to finish · Press Esc to cancel'
                    : 'Trend Line: Click first anchor point · Press Esc to exit')}
                {activeTool === 'RAY' &&
                  (pendingPoint
                    ? 'Extended Ray: Click second point to project forward · Press Esc to cancel'
                    : 'Extended Ray: Click starting anchor point · Press Esc to exit')}
                {activeTool === 'FIBONACCI' &&
                  (pendingPoint
                    ? 'Fibonacci Retracement: Click Swing Point 2 (End of impulse) · Press Esc to cancel'
                    : 'Fibonacci Retracement: Click Swing Point 1 (Start of impulse) · Press Esc to exit')}
                {activeTool === 'RECTANGLE' &&
                  (pendingPoint
                    ? 'Supply / Demand Zone: Click opposite corner to lock zone · Press Esc to cancel'
                    : 'Supply / Demand Zone: Click first corner · Press Esc to exit')}
                {activeTool === 'MEASURE' &&
                  (pendingPoint
                    ? 'Ruler: Click target price/bar to finish range measurement · Press Esc to cancel'
                    : 'Ruler: Click starting bar/price to measure move % · Press Esc to exit')}
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
                  const drawStroke = isDark ? '#38BDF8' : '#1D4ED8';
                  return (
                    <g key={d.id}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={drawStroke}
                        strokeWidth={2}
                      />
                      <circle cx={a.x} cy={a.y} r={3.5} fill={drawStroke} />
                      <circle cx={b.x} cy={b.y} r={3.5} fill={drawStroke} />
                    </g>
                  );
                }

                if (d.kind === 'RAY') {
                  const rayStroke = isDark ? '#34D399' : '#047857';
                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const canvasWidth = containerRef.current?.clientWidth ?? 1600;
                  let endX = b.x;
                  let endY = b.y;
                  if (Math.abs(dx) > 0.5) {
                    const targetX = dx >= 0 ? Math.max(canvasWidth, b.x) : 0;
                    const t = (targetX - a.x) / dx;
                    endX = a.x + dx * Math.max(t, 1);
                    endY = a.y + dy * Math.max(t, 1);
                  }
                  return (
                    <g key={d.id}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={endX}
                        y2={endY}
                        stroke={rayStroke}
                        strokeWidth={2}
                      />
                      <circle cx={a.x} cy={a.y} r={3.5} fill={rayStroke} />
                      <circle cx={b.x} cy={b.y} r={3.5} fill={rayStroke} />
                    </g>
                  );
                }

                if (d.kind === 'FIBONACCI') {
                  const leftX = Math.min(a.x, b.x);
                  const rightX = Math.max(a.x, b.x, leftX + 120);
                  const width = Math.max(rightX - leftX, 120);
                  const levels = FIB_LEVELS.map((lvl) => {
                    const price = d.p2.price + (d.p1.price - d.p2.price) * lvl.ratio;
                    const y = priceToY(price);
                    return { ...lvl, price, y };
                  }).filter((lvl): lvl is typeof lvl & { y: number } => lvl.y !== null);

                  return (
                    <g key={d.id}>
                      {/* Shaded Fibonacci Zone Bands */}
                      {levels.slice(0, -1).map((lvl, idx) => {
                        const next = levels[idx + 1];
                        const bandY = Math.min(lvl.y, next.y);
                        const bandH = Math.abs(next.y - lvl.y);
                        return (
                          <rect
                            key={`${d.id}-band-${lvl.ratio}`}
                            x={leftX}
                            y={bandY}
                            width={width}
                            height={bandH}
                            fill={lvl.band}
                          />
                        );
                      })}
                      {/* Impulse Diagonal Connector */}
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={isDark ? 'rgba(226,232,240,0.45)' : 'rgba(51,65,85,0.45)'}
                        strokeWidth={1.2}
                        strokeDasharray="4 3"
                      />
                      {/* Horizontal Fibonacci Retracement Levels + Labels */}
                      {levels.map((lvl) => {
                        const isGolden = lvl.ratio === 0.618;
                        return (
                          <g key={`${d.id}-lvl-${lvl.ratio}`}>
                            <line
                              x1={leftX}
                              y1={lvl.y}
                              x2={rightX}
                              y2={lvl.y}
                              stroke={lvl.color}
                              strokeWidth={isGolden ? 1.8 : 1.15}
                            />
                            <rect
                              x={rightX - 118}
                              y={lvl.y - 13}
                              width={116}
                              height={14}
                              rx={3}
                              fill={isDark ? 'rgba(11, 20, 36, 0.90)' : 'rgba(255, 255, 255, 0.92)'}
                              stroke={lvl.color}
                              strokeWidth={0.6}
                            />
                            <text
                              x={rightX - 113}
                              y={lvl.y - 3}
                              fill={lvl.color}
                              fontSize="9.5"
                              fontWeight={isGolden ? '700' : '500'}
                              fontFamily="'JetBrains Mono', monospace"
                            >
                              {`${lvl.label} · ${formatPrice(lvl.price)}`}
                            </text>
                          </g>
                        );
                      })}
                      <circle cx={a.x} cy={a.y} r={3.5} fill="#F59E0B" />
                      <circle cx={b.x} cy={b.y} r={3.5} fill="#F59E0B" />
                    </g>
                  );
                }

                if (d.kind === 'RECTANGLE') {
                  const minX = Math.min(a.x, b.x);
                  const minY = Math.min(a.y, b.y);
                  const w = Math.abs(b.x - a.x);
                  const h = Math.abs(b.y - a.y);
                  const hiPrice = Math.max(d.p1.price, d.p2.price);
                  const loPrice = Math.min(d.p1.price, d.p2.price);
                  const zoneColor = isDark ? '#A78BFA' : '#6D28D9';
                  return (
                    <g key={d.id}>
                      <rect
                        x={minX}
                        y={minY}
                        width={Math.max(w, 2)}
                        height={Math.max(h, 2)}
                        fill={isDark ? 'rgba(139, 92, 246, 0.14)' : 'rgba(109, 40, 217, 0.10)'}
                        stroke={zoneColor}
                        strokeWidth={1.4}
                      />
                      <text
                        x={minX + 6}
                        y={Math.max(12, minY + 13)}
                        fill={zoneColor}
                        fontSize="9.5"
                        fontWeight="600"
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {`ZONE ${formatPrice(loPrice)} – ${formatPrice(hiPrice)}`}
                      </text>
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
                      width={168}
                      height={18}
                      rx={4}
                      fill={isDark ? '#0E182A' : '#FFFFFF'}
                      stroke={accent}
                      strokeWidth={0.8}
                    />
                    <text
                      x={minX + 6}
                      y={Math.max(16, minY - 10)}
                      fill={isDark ? '#F8FAFC' : '#0F172A'}
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
                if (activeTool === 'TRENDLINE' || activeTool === 'RAY') {
                  return (
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={activeTool === 'RAY' ? '#10B981' : isDark ? '#38BDF8' : '#1D4ED8'}
                      strokeWidth={1.6}
                      strokeDasharray="4 3"
                    />
                  );
                }
                if (activeTool === 'FIBONACCI') {
                  const leftX = Math.min(a.x, b.x);
                  const rightX = Math.max(a.x, b.x, leftX + 120);
                  return (
                    <g opacity={0.85}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="#F59E0B"
                        strokeWidth={1.2}
                        strokeDasharray="4 3"
                      />
                      {FIB_LEVELS.map((lvl) => {
                        const price =
                          previewPoint.price + (pendingPoint.price - previewPoint.price) * lvl.ratio;
                        const y = priceToY(price);
                        if (y === null) return null;
                        return (
                          <g key={`preview-fib-${lvl.ratio}`}>
                            <line
                              x1={leftX}
                              y1={y}
                              x2={rightX}
                              y2={y}
                              stroke={lvl.color}
                              strokeWidth={lvl.ratio === 0.618 ? 1.6 : 1}
                              strokeDasharray="3 3"
                            />
                            <text
                              x={rightX - 108}
                              y={y - 3}
                              fill={lvl.color}
                              fontSize="9.5"
                              fontFamily="'JetBrains Mono', monospace"
                            >
                              {`${lvl.label} · ${formatPrice(price)}`}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                }
                if (activeTool === 'RECTANGLE' || activeTool === 'MEASURE') {
                  const minX = Math.min(a.x, b.x);
                  const minY = Math.min(a.y, b.y);
                  const w = Math.abs(b.x - a.x);
                  const h = Math.abs(b.y - a.y);
                  const strokeCol = activeTool === 'RECTANGLE' ? '#A78BFA' : '#38BDF8';
                  return (
                    <rect
                      x={minX}
                      y={minY}
                      width={Math.max(w, 1)}
                      height={Math.max(h, 1)}
                      fill={
                        activeTool === 'RECTANGLE'
                          ? 'rgba(139, 92, 246, 0.12)'
                          : 'rgba(56, 189, 248, 0.10)'
                      }
                      stroke={strokeCol}
                      strokeWidth={1.2}
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
