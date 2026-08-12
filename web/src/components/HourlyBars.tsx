import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { HourlyStat } from '../types';
import { formatMoney } from '../utils/format';

const POS = '#22c55e';
const NEG = '#ef4444';

interface Row {
  hour: number;
  net_pnl: number;
  trade_count: number;
}

function HourChart({ instrument, rows }: { instrument: string; rows: Row[] }) {
  // fill all 24 hours
  const data = useMemo(() => {
    const map = new Map(rows.map((r) => [r.hour, r]));
    return Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      net_pnl: map.get(h)?.net_pnl ?? 0,
      trade_count: map.get(h)?.trade_count ?? 0,
    }));
  }, [rows]);

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-400">{instrument}</div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.3)" vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fill: '#64748b', fontSize: 10 }}
            interval={2}
            tickLine={false}
            axisLine={{ stroke: 'rgba(51,65,85,0.6)' }}
          />
          <YAxis
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.08)' }}
            contentStyle={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              fontSize: 12,
            }}
            itemStyle={{ color: '#e2e8f0' }}
            labelStyle={{ color: '#94a3b8' }}
            labelFormatter={(h) => `${String(h).padStart(2, '0')}:00 UTC`}
            formatter={(v: number, _n, p: any) => [
              `${formatMoney(v)} · ${p?.payload?.trade_count ?? 0}t`,
              'Net P&L',
            ]}
          />
          <Bar dataKey="net_pnl" radius={[2, 2, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.hour} fill={d.net_pnl >= 0 ? POS : NEG} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function HourlyBars({ data }: { data: HourlyStat[] }) {
  const byInstrument = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const d of data) {
      if (!m.has(d.instrument)) m.set(d.instrument, []);
      m.get(d.instrument)!.push({
        hour: d.hour,
        net_pnl: d.net_pnl,
        trade_count: d.trade_count,
      });
    }
    return Array.from(m.entries());
  }, [data]);

  return (
    <div className="flex flex-col gap-4">
      {byInstrument.map(([inst, rows]) => (
        <HourChart key={inst} instrument={inst} rows={rows} />
      ))}
    </div>
  );
}
