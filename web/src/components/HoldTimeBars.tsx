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
import { useChartTheme } from '../store/theme';


export default function HoldTimeBars({ data }: { data: HoldTimeBucket[] }) {
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={ct.grid}
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fill: ct.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: ct.border }}
        />
        <YAxis
          tick={{ fill: ct.muted, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          cursor={{ fill: ct.cursor }}
          contentStyle={{
            background: ct.tooltipBg,
            border: `1px solid ${ct.tooltipBorder}`,
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: ct.text }}
          formatter={(v: number, _n, p: any) => [
            `${formatMoney(v)} · ${p?.payload?.trade_count ?? 0}t · ${(
              (p?.payload?.win_rate ?? 0) * 100
            ).toFixed(0)}% win`,
            'Net P&L',
          ]}
        />
        <Bar dataKey="net_pnl" radius={[2, 2, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.bucket} fill={d.net_pnl >= 0 ? ct.pos : ct.neg} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
