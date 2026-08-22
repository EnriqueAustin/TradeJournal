import type {
  ReportCard as ReportCardData,
  EdgeScore,
  DrawdownStats,
  RDistBin,
  DowRow,
  ReportKeyNumbers,
} from '../types';
import { formatMoney, formatPct, formatNumber, signClass } from '../utils/format';

// Zella-style composite score gauge + the drawdown / R-distribution / day-of-week
// breakdowns that every rival journal leads with. Single API call (getReportCard).

const GRADE_COLOR: Record<string, string> = {
  A: 'text-emerald-400',
  B: 'text-emerald-400',
  C: 'text-amber-400',
  D: 'text-orange-400',
  F: 'text-red-400',
};

function scoreColor(v: number): string {
  if (v >= 70) return '#34d399'; // emerald
  if (v >= 55) return '#fbbf24'; // amber
  if (v >= 40) return '#fb923c'; // orange
  return '#f87171'; // red
}

function EdgeScoreGauge({ score }: { score: EdgeScore }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = score.total / 100;
  const col = scoreColor(score.total);
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
      <div className="relative shrink-0" style={{ width: 132, height: 132 }}>
        <svg width={132} height={132} viewBox="0 0 132 132">
          <circle cx={66} cy={66} r={r} fill="none" stroke="#1e293b" strokeWidth={12} />
          <circle
            cx={66}
            cy={66}
            r={r}
            fill="none"
            stroke={col}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform="rotate(-90 66 66)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-3xl font-bold" style={{ color: col }}>
            {score.total}
          </span>
          <span className={`text-sm font-semibold ${GRADE_COLOR[score.grade]}`}>
            Grade {score.grade}
          </span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        {score.components.map((c) => (
          <div key={c.key} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-[11px] text-slate-400">{c.label}</span>
            <div className="h-1.5 flex-1 rounded-full bg-slate-800">
              <div
                className="h-full rounded-full"
                style={{ width: `${c.score}%`, background: scoreColor(c.score) }}
              />
            </div>
            <span className="num w-14 shrink-0 text-right text-[11px] text-slate-400">
              {c.detail}
            </span>
          </div>
        ))}
        {!score.reliable && (
          <p className="pt-1 text-[11px] text-amber-500/80">
            Under 20 trades — score is directional, not yet reliable.
          </p>
        )}
      </div>
    </div>
  );
}

function UnderwaterCurve({ d, currency }: { d: DrawdownStats; currency: string }) {
  const w = 640;
  const h = 120;
  const pts = d.series;
  if (pts.length < 2) {
    return <p className="text-sm text-slate-500">Not enough trades to chart drawdown.</p>;
  }
  const minDd = Math.min(...pts.map((p) => p.dd), 0); // most negative
  const range = minDd === 0 ? 1 : Math.abs(minDd);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (dd: number) => (Math.abs(dd) / range) * (h - 8); // 0 at top
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.dd).toFixed(1)}`).join(' ');
  const area = `M0,0 ${pts.map((p, i) => `L${x(i).toFixed(1)},${y(p.dd).toFixed(1)}`).join(' ')} L${w},0 Z`;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Max Drawdown</div>
          <div className="num mt-0.5 text-lg font-semibold text-red-400">
            {formatMoney(-d.max_dd, currency)}
          </div>
          {d.max_dd_pct != null && (
            <div className="num text-[11px] text-slate-500">{formatPct(d.max_dd_pct)} of peak</div>
          )}
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Recovery Factor</div>
          <div className="num mt-0.5 text-lg font-semibold text-slate-100">
            {d.recovery_factor == null ? '—' : formatNumber(d.recovery_factor, 2)}
          </div>
          <div className="text-[11px] text-slate-500">net ÷ max DD</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Starting Bal.</div>
          <div className="num mt-0.5 text-lg font-semibold text-slate-100">
            {d.starting_balance ? formatMoney(d.starting_balance, currency) : '—'}
          </div>
          <div className="text-[11px] text-slate-500">{d.starting_balance ? 'set on account' : 'not set'}</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
          <path d={area} fill="rgba(248,113,113,0.12)" />
          <path d={line} fill="none" stroke="#f87171" strokeWidth={1.5} />
          <line x1={0} y1={0} x2={w} y2={0} stroke="#334155" strokeWidth={1} />
        </svg>
      </div>
      <p className="text-[11px] text-slate-500">
        Underwater curve — distance below the equity high-water mark, trade by trade.
      </p>
    </div>
  );
}

function RDistribution({ bins, currency }: { bins: RDistBin[]; currency: string }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  const totalN = bins.reduce((s, b) => s + b.count, 0);
  if (totalN === 0) {
    return (
      <p className="text-sm text-slate-500">
        No trades have an R-multiple. Set a stop price on trades (or import it) to build this.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {bins.map((b) => {
        const isWinBin = /^(0 to 1|1|2|≥)/.test(b.label);
        const barCol = isWinBin ? 'bg-emerald-500/70' : 'bg-red-500/70';
        return (
          <div key={b.label} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-right text-slate-400">{b.label}</span>
            <div className="h-4 flex-1 rounded bg-slate-900">
              <div
                className={`h-full rounded ${barCol}`}
                style={{ width: `${(b.count / max) * 100}%` }}
              />
            </div>
            <span className="num w-8 shrink-0 text-right text-slate-400">{b.count}</span>
            <span className={`num w-20 shrink-0 text-right ${signClass(b.net_pnl)}`}>
              {formatMoney(b.net_pnl, currency)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DowBreakdown({ rows, currency }: { rows: DowRow[]; currency: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">No day-of-week data.</p>;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net_pnl)));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const w = (Math.abs(r.net_pnl) / maxAbs) * 50; // half-width each side of center
        const pos = r.net_pnl >= 0;
        return (
          <div key={r.dow} className="flex items-center gap-2 text-xs">
            <span className="w-10 shrink-0 text-slate-400">{r.label}</span>
            <div className="relative h-4 flex-1 rounded bg-slate-900">
              <div className="absolute inset-y-0 left-1/2 w-px bg-slate-700" />
              <div
                className={`absolute inset-y-0 ${pos ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                style={{
                  left: pos ? '50%' : `${50 - w}%`,
                  width: `${w}%`,
                  borderRadius: 3,
                }}
              />
            </div>
            <span className={`num w-20 shrink-0 text-right ${signClass(r.net_pnl)}`}>
              {formatMoney(r.net_pnl, currency)}
            </span>
            <span className="num w-16 shrink-0 text-right text-slate-500">
              {r.count}t · {formatPct(r.win_rate)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function KeyNumbers({ k, currency }: { k: ReportKeyNumbers; currency: string }) {
  const items: { label: string; value: React.ReactNode; cls?: string }[] = [
    { label: 'Avg daily P&L', value: formatMoney(k.avg_daily_pnl, currency), cls: signClass(k.avg_daily_pnl) },
    { label: 'Trading days', value: k.trading_days },
    { label: 'Payoff ratio', value: k.payoff_ratio == null ? '—' : formatNumber(k.payoff_ratio, 2) },
    { label: 'Max win streak', value: k.max_consec_wins, cls: 'text-emerald-400' },
    { label: 'Max loss streak', value: k.max_consec_losses, cls: 'text-red-400' },
    {
      label: 'Best day',
      value: k.best_day ? formatMoney(k.best_day.net, currency) : '—',
      cls: 'text-emerald-400',
    },
    {
      label: 'Worst day',
      value: k.worst_day ? formatMoney(k.worst_day.net, currency) : '—',
      cls: 'text-red-400',
    },
    { label: 'R sample', value: k.r_sample },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{it.label}</div>
          <div className={`num mt-0.5 text-sm font-semibold ${it.cls ?? 'text-slate-100'}`}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
      {children}
    </div>
  );
}

export default function ReportCard({ data, currency }: { data: ReportCardData; currency: string }) {
  if (data.trade_count === 0 || !data.score) {
    return <p className="text-sm text-slate-500">No trades match the filters.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <EdgeScoreGauge score={data.score} />
      {data.key && <KeyNumbers k={data.key} currency={currency} />}
      {data.drawdown && (
        <Block title="Drawdown">
          <UnderwaterCurve d={data.drawdown} currency={currency} />
        </Block>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Block title="R-Multiple Distribution">
          <RDistribution bins={data.r_distribution} currency={currency} />
        </Block>
        <Block title="Day of Week (UTC)">
          <DowBreakdown rows={data.by_dow} currency={currency} />
        </Block>
      </div>
    </div>
  );
}
