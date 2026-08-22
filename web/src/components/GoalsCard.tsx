import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Goal, GoalMetric, GoalPeriod } from '../types';
import { formatMoney, formatPct, formatNumber, signClass } from '../utils/format';

const METRIC_LABELS: Record<GoalMetric, string> = {
  net_pnl: 'Net P&L',
  win_rate: 'Win rate',
  trade_count: 'Trade count',
  avg_r: 'Avg R',
  profit_factor: 'Profit factor',
};
const PERIOD_LABELS: Record<GoalPeriod, string> = {
  month: 'This month',
  week: 'This week',
  all: 'All time',
};

// Format a metric value in its natural unit.
function fmtMetric(metric: GoalMetric, v: number | null, currency: string): string {
  if (v == null) return '—';
  if (metric === 'net_pnl') return formatMoney(v, currency);
  if (metric === 'win_rate') return formatPct(v);
  if (metric === 'trade_count') return String(Math.round(v));
  return formatNumber(v, 2);
}

function GoalRow({
  g,
  currency,
  onDelete,
}: {
  g: Goal;
  currency: string;
  onDelete: (id: number) => void;
}) {
  const pct = g.progress == null ? 0 : Math.max(0, Math.min(1, g.progress));
  const reached = g.progress != null && g.progress >= 1;
  const barColor = reached ? 'bg-emerald-500' : pct >= 0.6 ? 'bg-indigo-500' : 'bg-slate-500';
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-200">{METRIC_LABELS[g.metric]}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {PERIOD_LABELS[g.period]}
          </span>
          {g.account_id == null && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">all accts</span>
          )}
          {reached && <span className="text-[10px] font-semibold text-emerald-400">✓ reached</span>}
        </div>
        <button
          onClick={() => onDelete(g.id)}
          className="text-[11px] text-slate-600 hover:text-red-400"
          title="Delete goal"
        >
          ✕
        </button>
      </div>
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className={`num ${signClass(g.current ?? 0)}`}>{fmtMetric(g.metric, g.current, currency)}</span>
        <span className="num text-slate-500">
          target {fmtMetric(g.metric, g.target, currency)} ·{' '}
          {g.progress == null ? '—' : `${Math.round(g.progress * 100)}%`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

export default function GoalsCard({
  account,
  currency,
}: {
  account: number | '';
  currency: string;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [adding, setAdding] = useState(false);
  const [metric, setMetric] = useState<GoalMetric>('net_pnl');
  const [period, setPeriod] = useState<GoalPeriod>('month');
  const [target, setTarget] = useState('');
  const [scopeAll, setScopeAll] = useState(false);

  const load = useCallback(() => {
    api.getGoals(account).then(setGoals).catch(() => setGoals([]));
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    const t = Number(target);
    if (!Number.isFinite(t)) return;
    // win_rate is entered as a percent; store as a 0-1 fraction.
    const stored = metric === 'win_rate' ? t / 100 : t;
    await api.createGoal({
      metric,
      period,
      target: stored,
      account_id: scopeAll || !account ? null : Number(account),
    });
    setTarget('');
    setAdding(false);
    load();
  };

  const remove = async (id: number) => {
    await api.deleteGoal(id);
    load();
  };

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Goals</h2>
        <button className="btn text-xs" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ Add goal'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div>
            <label className="label">Metric</label>
            <select className="input" value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
              {(Object.keys(METRIC_LABELS) as GoalMetric[]).map((m) => (
                <option key={m} value={m}>{METRIC_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Period</label>
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as GoalPeriod)}>
              {(Object.keys(PERIOD_LABELS) as GoalPeriod[]).map((p) => (
                <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Target{metric === 'win_rate' ? ' (%)' : ''}</label>
            <input
              className="input w-28"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={metric === 'net_pnl' ? '1000' : metric === 'win_rate' ? '55' : '2'}
              inputMode="decimal"
            />
          </div>
          {account !== '' && (
            <label className="flex items-center gap-1.5 pb-2 text-[11px] text-slate-400">
              <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
              all accounts
            </label>
          )}
          <button className="btn btn-primary text-xs" onClick={submit}>Save</button>
        </div>
      )}

      {goals.length === 0 ? (
        <p className="text-sm text-slate-500">
          No goals yet. Set a monthly P&L, win-rate or trade-count target to track progress here.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {goals.map((g) => (
            <GoalRow key={g.id} g={g} currency={currency} onDelete={remove} />
          ))}
        </div>
      )}
    </div>
  );
}
