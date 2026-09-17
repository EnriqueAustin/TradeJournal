import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  Cell,
  ComposedChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CalendarDay, EquityPoint } from '../../types';
import { useChartTheme, type ChartTheme } from '../../store/theme';
import { DISPLAY_TZ, formatMoney, formatR } from '../../utils/format';

type Unit = 'money' | 'r';

function fmtVal(v: number, unit: Unit, currency: string) {
  return unit === 'r' ? formatR(v) : formatMoney(v, currency);
}

function compact(v: number, unit: Unit) {
  if (unit === 'r') return `${v.toFixed(1)}R`;
  const a = Math.abs(v);
  return a >= 1000 ? `${(v / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : v.toFixed(0);
}

function tooltipProps(ct: ChartTheme) {
  return {
    contentStyle: {
      background: ct.tooltipBg,
      border: `1px solid ${ct.tooltipBorder}`,
      borderRadius: 8,
      fontSize: 12,
    },
    itemStyle: { color: ct.textHi },
    labelStyle: { color: ct.text },
  };
}

/** Gradient stop where the value crosses zero (0 = top of the plot, 1 = bottom). */
export function zeroOffset(values: number[]): number {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  if (max === min) return 1;
  return max / (max - min);
}

/**
 * TradeZella-style intraday curve: cumulative net P&L through one trading day,
 * starting from zero, green above the line and red below.
 */
export function IntradayPnlChart({
  points,
  unit,
  currency,
  height = 220,
}: {
  points: EquityPoint[];
  unit: Unit;
  currency: string;
  height?: number;
}) {
  const ct = useChartTheme();
  const gid = useId().replace(/:/g, '');
  const data = useMemo(() => {
    const rows = points
      .map((p) => ({ t: new Date(p.t).getTime(), v: unit === 'r' ? p.cum_r ?? 0 : p.cum_pnl }))
      .filter((p) => Number.isFinite(p.t));
    if (!rows.length) return [];
    // Anchor at zero a few minutes before the first close so the first trade
    // reads as a step off the baseline.
    const span = rows[rows.length - 1].t - rows[0].t;
    const pad = Math.max(5 * 60_000, span * 0.04);
    return [{ t: rows[0].t - pad, v: 0 }, ...rows];
  }, [points, unit]);
  const off = zeroOffset(data.map((d) => d.v));
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TZ });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset={0} stopColor={ct.pos} stopOpacity={0.35} />
            <stop offset={off} stopColor={ct.pos} stopOpacity={0.05} />
            <stop offset={off} stopColor={ct.neg} stopOpacity={0.05} />
            <stop offset={1} stopColor={ct.neg} stopOpacity={0.35} />
          </linearGradient>
          <linearGradient id={`${gid}-line`} x1="0" y1="0" x2="0" y2="1">
            <stop offset={off} stopColor={ct.pos} />
            <stop offset={off} stopColor={ct.neg} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={time}
          tick={{ fill: ct.muted, fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: ct.border }}
          minTickGap={30}
        />
        <YAxis
          tickFormatter={(v) => compact(v, unit)}
          tick={{ fill: ct.muted, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <ReferenceLine y={0} stroke={ct.border} />
        <Tooltip
          {...tooltipProps(ct)}
          labelFormatter={(ms) => time(Number(ms))}
          formatter={(v: number) => [fmtVal(v, unit, currency), 'Cumulative']}
        />
        <Area
          type="linear"
          dataKey="v"
          stroke={`url(#${gid}-line)`}
          strokeWidth={2}
          fill={`url(#${gid}-fill)`}
          baseValue={0}
          dot={{ r: 2.5, strokeWidth: 0, fill: ct.muted }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Daily net P&L bars with the running cumulative total as an area behind them
 * (its own right-hand axis, so a big equity number doesn't flatten the bars).
 */
export function DailyNetPnlChart({
  days,
  unit,
  currency,
  onPickDay,
  height = 240,
}: {
  days: CalendarDay[];
  unit: Unit;
  currency: string;
  onPickDay?: (day: string) => void;
  height?: number;
}) {
  const ct = useChartTheme();
  const gid = useId().replace(/:/g, '');
  const data = useMemo(() => {
    let cum = 0;
    return days
      .filter((d) => d.trade_count > 0)
      .map((d) => {
        const v = unit === 'r' ? d.r ?? 0 : d.net_pnl;
        cum += v;
        return { day: d.day, v: Math.round(v * 100) / 100, cum: Math.round(cum * 100) / 100, n: d.trade_count };
      });
  }, [days, unit]);
  const off = zeroOffset(data.map((d) => d.cum));
  const label = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        onClick={(s: any) => {
          const day = s?.activePayload?.[0]?.payload?.day;
          if (day && onPickDay) onPickDay(day);
        }}
        style={onPickDay ? { cursor: 'pointer' } : undefined}
      >
        <defs>
          <linearGradient id={`${gid}-cum`} x1="0" y1="0" x2="0" y2="1">
            <stop offset={0} stopColor={ct.accent} stopOpacity={0.28} />
            <stop offset={off} stopColor={ct.accent} stopOpacity={0.04} />
            <stop offset={off} stopColor={ct.neg} stopOpacity={0.04} />
            <stop offset={1} stopColor={ct.neg} stopOpacity={0.22} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={label}
          tick={{ fill: ct.muted, fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: ct.border }}
          minTickGap={24}
        />
        <YAxis
          yAxisId="bar"
          tickFormatter={(v) => compact(v, unit)}
          tick={{ fill: ct.muted, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <YAxis
          yAxisId="cum"
          orientation="right"
          tickFormatter={(v) => compact(v, unit)}
          tick={{ fill: ct.accent, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <ReferenceLine yAxisId="bar" y={0} stroke={ct.border} />
        <Tooltip
          {...tooltipProps(ct)}
          cursor={{ fill: ct.cursor }}
          labelFormatter={(d) => label(String(d))}
          formatter={(v: number, name: string, p: any) =>
            name === 'cum'
              ? [fmtVal(v, unit, currency), 'Cumulative']
              : [`${fmtVal(v, unit, currency)} · ${p?.payload?.n ?? 0}t`, 'Day']
          }
        />
        <Area
          yAxisId="cum"
          type="monotone"
          dataKey="cum"
          stroke={ct.accent}
          strokeWidth={1.5}
          fill={`url(#${gid}-cum)`}
          baseValue={0}
          isAnimationActive={false}
        />
        <Bar yAxisId="bar" dataKey="v" maxBarSize={18} radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.day} fill={d.v >= 0 ? ct.pos : ct.neg} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
