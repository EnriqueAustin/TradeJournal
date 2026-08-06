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

type Rect = { left: number; top: number; width: number; height: number };
interface BoxGeom {
  left: number;
  width: number;
  entryY: number;
  reward?: Rect;
  risk?: Rect;
  targetY?: number | null;
  stopY?: number | null;
  targetProfitSide?: boolean;
  rr?: number;
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
  height = 380,
  onClickPrice,
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
  height?: number;
  /** clicking the chart yields the bar time (ISO) and the price at cursor y */
  onClickPrice?: (t: string, price: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const clickRef = useRef(onClickPrice);
  clickRef.current = onClickPrice;

  const boxRef = useRef<PositionBox | null | undefined>(positionBox);
  boxRef.current = positionBox;
  const [geom, setGeom] = useState<BoxGeom | null>(null);

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

    const handler = (param: MouseEventParams) => {
      const cb = clickRef.current;
      if (!cb || !param.point || param.time == null) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const t = new Date((param.time as number) * 1000).toISOString();
      cb(t, Number(price));
    };
    chart.subscribeClick(handler);

    return () => {
      chart.unsubscribeClick(handler);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
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

    if (lockRange && deduped.length > 1) {
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: deduped.length - 1 });
    } else if (!lockRange) {
      chart.timeScale().fitContent();
    }
  }, [bars, reveal, revealTime, lockRange]);

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

  // Position box overlay — recompute pixel geometry on data / pan / zoom / resize.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const el = containerRef.current;
    if (!chart || !series || !el) return;

    const recompute = () => {
      const box = boxRef.current;
      if (!box) {
        setGeom(null);
        return;
      }
      const W = el.clientWidth;
      const H = el.clientHeight;
      const ts = chart.timeScale();

      // Time → x, clamped to the pane (off-screen edges pin to a border).
      const toX = (t: UTCTimestamp): number | null => {
        const raw = ts.timeToCoordinate(t);
        let x: number | null = raw == null ? null : (raw as number);
        if (x == null) {
          const vr = ts.getVisibleRange();
          if (!vr) return null;
          x = (t as number) < (vr.from as number) ? 0 : W;
        }
        return Math.max(0, Math.min(W, x));
      };
      const toY = (p: number): number | null => {
        const y = series.priceToCoordinate(p);
        return y == null ? null : Math.max(0, Math.min(H, y as number));
      };

      // Box spans entry → a few bars past exit (rightTime), like TradingView's
      // position tool — it stays stuck to the trade instead of running to the
      // chart edge.
      const x1 = toX(box.entryTime);
      const x2 = toX(box.rightTime);
      const entryY = toY(box.entryPrice);
      if (x1 == null || x2 == null || entryY == null) {
        setGeom(null);
        return;
      }
      const left = Math.min(x1, x2);
      const width = Math.max(2, Math.abs(x2 - x1));

      // Which side of entry is "profit" for this direction.
      const profitUp = box.direction === 'long';

      let reward: Rect | undefined;
      let targetY: number | null = null;
      let targetProfitSide: boolean | undefined;
      if (box.targetPrice != null) {
        targetY = toY(box.targetPrice);
        if (targetY != null) {
          targetProfitSide = profitUp
            ? box.targetPrice >= box.entryPrice
            : box.targetPrice <= box.entryPrice;
          reward = {
            left,
            width,
            top: Math.min(entryY, targetY),
            height: Math.abs(targetY - entryY),
          };
        }
      }
      let risk: Rect | undefined;
      let stopY: number | null = null;
      if (box.stopPrice != null) {
        stopY = toY(box.stopPrice);
        if (stopY != null)
          risk = { left, width, top: Math.min(entryY, stopY), height: Math.abs(stopY - entryY) };
      }
      let rr: number | undefined;
      if (box.targetPrice != null && box.stopPrice != null) {
        const r = Math.abs(box.entryPrice - box.stopPrice);
        if (r > 0) rr = Math.abs(box.targetPrice - box.entryPrice) / r;
      }
      setGeom({ left, width, entryY, reward, risk, targetY, stopY, targetProfitSide, rr });
    };

    // Double rAF so coordinates are read after the chart has laid out.
    const schedule = () =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(recompute));
    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(schedule);
    ts.subscribeVisibleTimeRangeChange(schedule); // fires on the initial auto-fit
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    recompute(); // synchronous first pass (rAF is paused when tab isn't compositing)
    schedule();

    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(schedule);
      ts.unsubscribeVisibleTimeRangeChange(schedule);
      ro.disconnect();
    };
  }, [positionBox, bars, reveal, revealTime, lockRange]);

  const box = positionBox;
  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} style={{ height }} className="w-full" />
      {box && geom && (() => {
        // Reward zone is green for a genuine take-profit (or a profit-side exit
        // fallback); amber when the fallback exit sat on the loss side.
        const rewardGreen = geom.targetProfitSide !== false;
        const rewardRGB = rewardGreen ? '16,185,129' : '245,158,11';
        const targetLabel = box.targetIsTP ? 'TP' : 'Exit';
        const priceTag = (
          top: number,
          rgb: string,
          title: string,
          price: number
        ) => (
          <div
            className="absolute rounded px-1 text-[10px] font-medium tabular-nums text-white"
            style={{
              left: geom.left + geom.width - 2,
              top: top - 8,
              transform: 'translateX(-100%)',
              background: `rgba(${rgb},0.9)`,
            }}
          >
            {title} {price.toFixed(2)}
          </div>
        );
        return (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {geom.reward && (
              <div
                className="absolute"
                style={{
                  left: geom.reward.left,
                  top: geom.reward.top,
                  width: geom.reward.width,
                  height: geom.reward.height,
                  background: `rgba(${rewardRGB},0.14)`,
                  borderTop: `1px solid rgba(${rewardRGB},0.55)`,
                  borderBottom: `1px solid rgba(${rewardRGB},0.55)`,
                }}
              />
            )}
            {geom.risk && (
              <div
                className="absolute"
                style={{
                  left: geom.risk.left,
                  top: geom.risk.top,
                  width: geom.risk.width,
                  height: geom.risk.height,
                  background: 'rgba(239,68,68,0.14)',
                  borderTop: '1px solid rgba(239,68,68,0.55)',
                  borderBottom: '1px solid rgba(239,68,68,0.55)',
                }}
              />
            )}
            {/* left (entry) and right edges of the box */}
            <div
              className="absolute"
              style={{
                left: geom.left,
                top: Math.min(geom.entryY, geom.targetY ?? geom.entryY, geom.stopY ?? geom.entryY),
                width: 1,
                height:
                  Math.max(geom.entryY, geom.targetY ?? geom.entryY, geom.stopY ?? geom.entryY) -
                  Math.min(geom.entryY, geom.targetY ?? geom.entryY, geom.stopY ?? geom.entryY),
                background: 'rgba(148,163,184,0.5)',
              }}
            />
            {/* entry line across the hold */}
            <div
              className="absolute"
              style={{
                left: geom.left,
                top: geom.entryY - 0.5,
                width: geom.width,
                height: 1,
                background: '#6366f1',
              }}
            />
            {/* direction + R:R badge, anchored at entry */}
            <div
              className="absolute rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
              style={{
                left: geom.left + 2,
                top: Math.max(2, geom.entryY - 18),
                background: box.direction === 'long' ? '#059669' : '#dc2626',
              }}
            >
              {box.direction}
              {geom.rr != null && (
                <span className="ml-1 font-normal opacity-90">
                  {geom.rr.toFixed(1)}R
                </span>
              )}
            </div>
            {/* price tags on the right edge */}
            {geom.targetY != null &&
              box.targetPrice != null &&
              priceTag(geom.targetY, rewardRGB, targetLabel, box.targetPrice)}
            {geom.stopY != null &&
              box.stopPrice != null &&
              priceTag(geom.stopY, '239,68,68', 'SL', box.stopPrice)}
          </div>
        );
      })()}
    </div>
  );
}
