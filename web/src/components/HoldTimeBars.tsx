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
import type { HoldTimeBucket } from '../types';
import { formatMoney } from '../utils/format';

const POS = '#22c55e';
const NEG = '#ef4444';

export default function HoldTimeBars({ data }: { data: HoldTimeBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(51,65,85,0.3)"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fill: '#64748b', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'rgba(51,65,85,0.6)' }}
        />
        <YAxis
          tick={{ fill: '#64748b', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          cursor={{ fill: 'rgba(148,163,184,0.08)' }}
          contentStyle={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: '#94a3b8' }}
          formatter={(v: number, _n, p: any) => [
            `${formatMoney(v)} · ${p?.payload?.trade_count ?? 0}t · ${(
              (p?.payload?.win_rate ?? 0) * 100
            ).toFixed(0)}% win`,
            'Net P&L',
          ]}
        />
        <Bar dataKey="net_pnl" radius={[2, 2, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.bucket} fill={d.net_pnl >= 0 ? POS : NEG} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
