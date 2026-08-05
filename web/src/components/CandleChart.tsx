import { useEffect, useRef } from 'react';
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

export interface PriceLineSpec {
  price: number;
  color: string;
  title: string;
}

export type ChartMarker = SeriesMarker<UTCTimestamp>;

function toTime(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

export default function CandleChart({
  bars,
  reveal,
  markers,
  priceLines,
  lockRange = false,
  height = 380,
  onClickPrice,
}: {
  bars: Bar[];
  /** number of leading bars to show (for progressive replay); default all */
  reveal?: number;
  markers?: ChartMarker[];
  priceLines?: PriceLineSpec[];
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

    const count = reveal == null ? deduped.length : Math.max(0, Math.min(reveal, deduped.length));
    series.setData(deduped.slice(0, count));

    if (lockRange && deduped.length > 1) {
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: deduped.length - 1 });
    } else if (!lockRange) {
      chart.timeScale().fitContent();
    }
  }, [bars, reveal, lockRange]);

  // Markers (filtered to the revealed window).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    let ms = markers ?? [];
    if (reveal != null && bars.length) {
      const sorted = [...bars]
        .map((b) => toTime(b.t))
        .sort((a, b) => a - b);
      const idx = Math.max(0, Math.min(reveal, sorted.length)) - 1;
      const cutoff = idx >= 0 ? sorted[idx] : -Infinity;
      ms = ms.filter((m) => (m.time as number) <= (cutoff as number));
    }
    series.setMarkers(ms);
  }, [markers, reveal, bars]);

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

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
