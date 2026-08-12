import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
  type SeriesMarker,
  type MouseEventParams,
} from 'lightweight-charts';
import type { Bar } from '../types';
import { DISPLAY_TZ } from '../utils/format';
import { PositionBoxPrimitive } from './positionBoxPrimitive';

// Format a lightweight-charts UTC timestamp (seconds) in the display timezone.
function tzTime(t: number, withDate: boolean): string {
  return new Date(t * 1000).toLocaleString('en-GB', {
    timeZone: DISPLAY_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    ...(withDate ? { day: '2-digit', month: 'short' } : {}),
  });
}

export interface PriceLineSpec {
  price: number;
  color: string;
  title: string;
}

export type ChartMarker = SeriesMarker<UTCTimestamp>;

// A TradingView-style long/short position overlay: a shaded reward (entry→TP)
// and risk (entry→SL) box bounded on the left at entry and on the right a few
// bars past the exit, drawn from price/time→pixel coordinates.
export interface PositionBox {
  direction: 'long' | 'short';
  entryTime: UTCTimestamp;
  /** right edge of the box (a few bars after exit) */
  rightTime: UTCTimestamp;
  entryPrice: number;
  stopPrice?: number | null;
  /** take-profit price, or the exit level used as a fallback */
  targetPrice?: number | null;
  /** true when targetPrice is a real TP, false when it's the exit fallback */
  targetIsTP?: boolean;
}

function toTime(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

export default function CandleChart({
  bars,
  reveal,
  revealTime,
  markers,
  priceLines,
  positionBox,
  lockRange = false,
  windowSize,
  height = 380,
  onClickPrice,
  onContextPrice,
}: {
  bars: Bar[];
  /** number of leading bars to show (for progressive replay); default all */
  reveal?: number;
  /** reveal every bar with time <= this (wall-clock cursor shared across TFs);
   *  takes precedence over `reveal` when provided */
  revealTime?: UTCTimestamp;
  markers?: ChartMarker[];
  priceLines?: PriceLineSpec[];
  /** shaded long/short position overlay (entry / stop / target zones) */
  positionBox?: PositionBox | null;
  /** keep the x-axis fixed to the full range (replay) instead of fitting */
  lockRange?: boolean;
  /** rolling replay window: keep this many bars visible, newest near the right
   *  edge with a small forward margin (fixed zoom that scrolls as it plays) */
  windowSize?: number;
  height?: number;
  /** clicking the chart yields the bar time (ISO) and the price at cursor y */
  onClickPrice?: (t: string, price: number) => void;
  /** right-clicking yields the price at cursor y plus container-relative x/y
   *  (for positioning a context menu) — used for right-click order execution */
  onContextPrice?: (price: number, pos: { x: number; y: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const clickRef = useRef(onClickPrice);
  clickRef.current = onClickPrice;
  const ctxRef = useRef(onContextPrice);
  ctxRef.current = onContextPrice;
  const boxRef = useRef<PositionBox | null | undefined>(positionBox);
  boxRef.current = positionBox;
  const boxPrimRef = useRef<PositionBoxPrimitive | null>(null);
  // Position-box readout is shown only while the box is "selected" (clicked),
  // TradingView-style, so the chart stays clean until you ask for the numbers.
  const [boxSelected, setBoxSelected] = useState(false);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: 'ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(51,65,85,0.3)' },
        horzLines: { color: 'rgba(51,65,85,0.3)' },
      },
      rightPriceScale: { borderColor: 'rgba(51,65,85,0.6)' },
      timeScale: {
        borderColor: 'rgba(51,65,85,0.6)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (t: number) => tzTime(t, false),
      },
      localization: {
        timeFormatter: (t: number) => tzTime(t, true),
      },
      crosshair: {
        vertLine: {
          color: '#64748b',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#334155',
        },
        horzLine: {
          color: '#64748b',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#334155',
        },
      },
      height,
      autoSize: true,
    });
    const series = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    chartRef.current = chart;
    seriesRef.current = series;

    // Position box drawn on the canvas (redraws with the chart — no resize lag).
    const boxPrim = new PositionBoxPrimitive();
    series.attachPrimitive(boxPrim);
    boxPrim.setBox(boxRef.current ?? null);
    boxPrimRef.current = boxPrim;

    const handler = (param: MouseEventParams) => {
      // Toggle the box readout when the click lands inside the box; clicking
      // elsewhere dismisses it.
      const box = boxRef.current;
      const el = containerRef.current;
      if (param.point && box && el) {
        const ts = chart.timeScale();
        const W = el.clientWidth;
        const x1: number = ts.timeToCoordinate(box.entryTime) ?? 0;
        const x2: number = ts.timeToCoordinate(box.rightTime) ?? W;
        const ys: number[] = [];
        for (const p of [box.entryPrice, box.stopPrice, box.targetPrice]) {
          if (p == null) continue;
          const c = series.priceToCoordinate(p);
          if (c != null) ys.push(c);
        }
        if (ys.length) {
          const left = Math.min(x1, x2) - 6;
          const right = Math.max(x1, x2) + 6;
          const top = Math.min(...ys) - 6;
          const bot = Math.max(...ys) + 6;
          const { x, y } = param.point;
          const inside = x >= left && x <= right && y >= top && y <= bot;
          setBoxSelected((prev) => (inside ? !prev : false));
        }
      }

      const cb = clickRef.current;
      if (!cb || !param.point || param.time == null) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const t = new Date((param.time as number) * 1000).toISOString();
      cb(t, Number(price));
    };
    chart.subscribeClick(handler);

    // Right-click → price under the cursor (for right-click order execution).
    const ctxHandler = (ev: MouseEvent) => {
      const cb = ctxRef.current;
      const box = el.getBoundingClientRect();
      if (!cb) return;
      ev.preventDefault();
      const y = ev.clientY - box.top;
      const price = series.coordinateToPrice(y);
      if (price == null) return;
      cb(Number(price), { x: ev.clientX - box.left, y });
    };
    el.addEventListener('contextmenu', ctxHandler);

    return () => {
      el.removeEventListener('contextmenu', ctxHandler);
      chart.unsubscribeClick(handler);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
      boxPrimRef.current = null;
    };
    // height is intentionally fixed for the lifetime of the chart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data (+ progressive reveal).
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const full = [...bars]
      .map((b) => ({
        time: toTime(b.t),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
      .filter((b) => Number.isFinite(b.time))
      .sort((a, b) => a.time - b.time);

    // de-dupe strictly-ascending timestamps
    const deduped: typeof full = [];
    for (const b of full) {
      const last = deduped[deduped.length - 1];
      if (last && last.time === b.time) deduped[deduped.length - 1] = b;
      else deduped.push(b);
    }

    let count;
    if (revealTime != null) {
      // reveal every bar at or before the shared wall-clock cursor
      count = 0;
      for (const b of deduped) {
        if (b.time <= revealTime) count++;
        else break;
      }
    } else {
      count = reveal == null ? deduped.length : Math.max(0, Math.min(reveal, deduped.length));
    }
    series.setData(deduped.slice(0, count));

    if (windowSize && windowSize > 0 && count > 0) {
      // Rolling replay window: fixed zoom that scrolls so the newest revealed
      // bar sits a few bars from the right edge (room to see price develop).
      const margin = Math.max(2, Math.round(windowSize * 0.12));
      const to = count - 1 + margin;
      const from = to - windowSize - margin;
      chart.timeScale().setVisibleLogicalRange({ from, to });
    } else if (lockRange && deduped.length > 1) {
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: deduped.length - 1 });
    } else if (!lockRange) {
      chart.timeScale().fitContent();
    }
  }, [bars, reveal, revealTime, lockRange, windowSize]);

  // Markers (filtered to the revealed window).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    let ms = markers ?? [];
    if (revealTime != null) {
      ms = ms.filter((m) => (m.time as number) <= (revealTime as number));
    } else if (reveal != null && bars.length) {
      const sorted = [...bars]
        .map((b) => toTime(b.t))
        .sort((a, b) => a - b);
      const idx = Math.max(0, Math.min(reveal, sorted.length)) - 1;
      const cutoff = idx >= 0 ? sorted[idx] : -Infinity;
      ms = ms.filter((m) => (m.time as number) <= (cutoff as number));
    }
    series.setMarkers(ms);
  }, [markers, reveal, revealTime, bars]);

  // Price lines (stop / target).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const l of linesRef.current) series.removePriceLine(l);
    linesRef.current = [];
    for (const spec of priceLines ?? []) {
      linesRef.current.push(
        series.createPriceLine({
          price: spec.price,
          color: spec.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: spec.title,
        })
      );
    }
  }, [priceLines]);

  // Feed the canvas position-box primitive; it redraws with the chart itself.
  useEffect(() => {
    boxPrimRef.current?.setBox(positionBox ?? null);
    if (!positionBox) setBoxSelected(false);
  }, [positionBox]);

  // A falsy height means "fill the parent" (workspace charts); autoSize then
  // tracks the container's measured size in both dimensions.
  const cssHeight = height ? `${height}px` : '100%';
  return (
    <div className="relative w-full" style={{ height: cssHeight }}>
      <div ref={containerRef} style={{ height: cssHeight }} className="w-full" />
      {positionBox && boxSelected && (
        <PositionBoxInfo box={positionBox} onClose={() => setBoxSelected(false)} />
      )}
    </div>
  );
}

// The click-to-reveal readout for the position box: direction, R:R, entry,
// stop, target, and the risk/reward distances (price move + %). Shown only
// while the box is selected.
function PositionBoxInfo({
  box,
  onClose,
}: {
  box: PositionBox;
  onClose: () => void;
}) {
  const { direction, entryPrice, stopPrice, targetPrice } = box;
  const risk = stopPrice != null ? Math.abs(entryPrice - stopPrice) : null;
  const reward = targetPrice != null ? Math.abs(targetPrice - entryPrice) : null;
  const rr = risk && reward ? reward / risk : null;
  const pct = (d: number) => (entryPrice ? (d / entryPrice) * 100 : 0);
  const fmt = (n: number) => n.toFixed(2);

  return (
    <div className="absolute left-2 top-2 z-10 w-52 rounded-lg border border-slate-700 bg-slate-900/95 p-2.5 text-xs shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
              direction === 'long'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-red-500/15 text-red-400'
            }`}
          >
            {direction}
          </span>
          {rr != null && (
            <span className="num font-semibold text-slate-200">
              {rr.toFixed(2)}R
            </span>
          )}
        </span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <dl className="flex flex-col gap-0.5">
        <Row label="Entry" value={fmt(entryPrice)} />
        <Row
          label={box.targetIsTP ? 'Target' : 'Exit'}
          value={targetPrice != null ? fmt(targetPrice) : '—'}
          className="text-emerald-400"
        />
        <Row
          label="Stop"
          value={stopPrice != null ? fmt(stopPrice) : '—'}
          className="text-red-400"
        />
        <div className="my-1 border-t border-slate-800" />
        <Row
          label="Reward"
          value={reward != null ? `${fmt(reward)}  (${pct(reward).toFixed(2)}%)` : '—'}
        />
        <Row
          label="Risk"
          value={risk != null ? `${fmt(risk)}  (${pct(risk).toFixed(2)}%)` : '—'}
        />
      </dl>
      {stopPrice == null && (
        <p className="mt-1.5 text-[10px] leading-tight text-slate-500">
          No stop set — add one in Risk Levels to see risk / R:R.
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`num ${className || 'text-slate-300'}`}>{value}</dd>
    </div>
  );
}
