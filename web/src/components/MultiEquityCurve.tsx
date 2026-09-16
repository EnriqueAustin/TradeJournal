import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { EquityPoint } from '../types';

export const SERIES_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#84cc16', '#f97316'];

export interface EquitySeries {
  id: number;
  name: string;
  data: EquityPoint[];
}

// One cumulative-P&L line per account on a shared time axis.
export default function MultiEquityCurve({
  series,
  className = 'h-80',
}: {
  series: EquitySeries[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

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
      timeScale: { borderColor: 'rgba(51,65,85,0.6)', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: '#64748b', style: LineStyle.Dashed, labelBackgroundColor: '#334155' },
        horzLine: { color: '#64748b', style: LineStyle.Dashed, labelBackgroundColor: '#334155' },
      },
      autoSize: true,
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const added = series.map((s, i) => {
      const line = chart.addLineSeries({
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: s.name,
      });
      const pts: { time: UTCTimestamp; value: number }[] = [];
      for (const p of s.data) {
        const time = Math.floor(new Date(p.t).getTime() / 1000) as UTCTimestamp;
        if (!Number.isFinite(time)) continue;
        const last = pts[pts.length - 1];
        if (last && last.time === time) last.value = p.cum_pnl;
        else if (!last || time > last.time) pts.push({ time, value: p.cum_pnl });
      }
      line.setData(pts);
      return line;
    });
    chart.timeScale().fitContent();
    return () => {
      if (chartRef.current) for (const l of added) chartRef.current.removeSeries(l);
    };
  }, [series]);

  return <div ref={containerRef} className={`${className} w-full`} />;
}
