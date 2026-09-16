import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useChartTheme, lwcThemeOptions } from '../store/theme';
import type { EquityPoint } from '../types';

export default function EquityCurve({
  data,
  unit = 'money',
  className = 'h-80',
}: {
  data: EquityPoint[];
  unit?: 'money' | 'r';
  /** Height class — the chart autosizes to it, so a parent must not clip it. */
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const ct = useChartTheme();
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  // Create chart once
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
        vertLine: { color: '#64748b', style: LineStyle.Dashed, labelBackgroundColor: '#334155' },
        horzLine: { color: '#64748b', style: LineStyle.Dashed, labelBackgroundColor: '#334155' },
      },
      height: 320,
      autoSize: true,
    });

    const series = chart.addAreaSeries({
      lineColor: '#6366f1',
      topColor: 'rgba(99,102,241,0.35)',
      bottomColor: 'rgba(99,102,241,0.02)',
      lineWidth: 2,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Canvas charts don't see CSS vars — push the palette on mount and on toggle.
  useEffect(() => {
    chartRef.current?.applyOptions(lwcThemeOptions(ct));
  }, [ct]);

  // Update data
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const points = [...data]
      .map((p) => ({
        time: Math.floor(new Date(p.t).getTime() / 1000) as UTCTimestamp,
        value: unit === 'r' ? p.cum_r ?? 0 : p.cum_pnl,
      }))
      .filter((p) => Number.isFinite(p.time))
      .sort((a, b) => a.time - b.time);

    // de-dupe timestamps (lightweight-charts requires strictly ascending)
    const deduped: typeof points = [];
    for (const p of points) {
      const last = deduped[deduped.length - 1];
      if (last && last.time === p.time) deduped[deduped.length - 1] = p;
      else deduped.push(p);
    }

    series.setData(deduped);
    chart.timeScale().fitContent();
  }, [data, unit]);

  return <div ref={containerRef} className={`${className} w-full`} />;
}
