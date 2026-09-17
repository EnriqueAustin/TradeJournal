import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client';
import { emptySet, pivotApi, setParams, METRIC_META, type FilterSet, type PivotMetric, type SliceResult } from '../api/pivot';
import { useFilters } from '../store/FilterContext';
import { useChartTheme } from '../store/theme';
import { EMOTIONS } from '../components/trade/PsychCard';
import { formatMetric, groupLabel } from '../utils/metrics';
import { DISPLAY_TZ, formatMoney, formatPct, sessionLabel } from '../utils/format';
import type { TagWithUses } from '../types';

export const SET_COLORS = ['#6366f1', '#f59e0b', '#10b981'];
const STORAGE_KEY = 'trade-journal:compare-sets';
const SESSIONS = ['asia', 'london', 'ny', 'off'];

const KPI_ROWS: PivotMetric[] = [
  'net_pnl',
  'trades',
  'win_rate',
  'profit_factor',
  'expectancy',
  'avg_r',
  'total_r',
  'avg_win',
  'avg_loss',
  'max_dd',
  'avg_hold',
];

function ymd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ }).format(d);
}

function monthRange(offset: number): { from: string; to: string } {
  const [y, m] = ymd(new Date()).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(y, m + offset, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

type Base = Pick<FilterSet, 'account' | 'profile'>;
const PRESETS: { name: string; build: (b: Base) => FilterSet[] }[] = [
  { name: 'London vs NY', build: (b) => [emptySet('London', { ...b, session: 'london' }), emptySet('New York', { ...b, session: 'ny' })] },
  { name: 'Followed vs Broke plan', build: (b) => [emptySet('Followed', { ...b, followed: '1' }), emptySet('Broke plan', { ...b, followed: '0' })] },
  {
    name: 'This month vs last',
    build: (b) => [emptySet('This month', { ...b, ...monthRange(0) }), emptySet('Last month', { ...b, ...monthRange(-1) })],
  },
  { name: 'Long vs Short', build: (b) => [emptySet('Long', { ...b, direction: 'long' }), emptySet('Short', { ...b, direction: 'short' })] },
  { name: 'XAUUSD vs US100', build: (b) => [emptySet('XAUUSD', { ...b, instrument: 'XAUUSD' }), emptySet('US100', { ...b, instrument: 'US100' })] },
];

function loadSets(): FilterSet[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as FilterSet[]) : null;
    return Array.isArray(v) && v.length >= 2 && v.length <= 3 ? v.map((s, i) => emptySet(s.label || 'ABC'[i], s)) : null;
  } catch {
    return null;
  }
}

function SetEditor({
  set,
  index,
  onChange,
  onRemove,
  tags,
}: {
  set: FilterSet;
  index: number;
  onChange: (s: FilterSet) => void;
  onRemove?: () => void;
  tags: TagWithUses[];
}) {
  const { allAccounts, profiles, setups } = useFilters();
  const up = (patch: Partial<FilterSet>) => onChange({ ...set, ...patch });
  const scope = set.account != null ? `a:${set.account}` : set.profile != null ? `p:${set.profile}` : '';
  const field = 'flex flex-col gap-0.5 text-[11px]';
  const lbl = { color: 'var(--term-muted)' };
  return (
    <div className="card p-3" style={{ borderTop: `3px solid ${SET_COLORS[index]}` }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-bold" style={{ color: SET_COLORS[index] }}>
          {'ABC'[index]}
        </span>
        <input
          className="input flex-1"
          value={set.label}
          aria-label={`Set ${'ABC'[index]} name`}
          onChange={(e) => up({ label: e.target.value })}
        />
        {onRemove && (
          <button className="btn px-2" onClick={onRemove} aria-label={`Remove set ${'ABC'[index]}`}>
            ✕
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className={`${field} col-span-2 sm:col-span-1`}>
          <span style={lbl}>Account</span>
          <select
            className="input"
            value={scope}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('a:')) up({ account: Number(v.slice(2)), profile: null });
              else if (v.startsWith('p:')) up({ account: null, profile: Number(v.slice(2)) });
              else up({ account: null, profile: null });
            }}
          >
            <option value="">All accounts</option>
            {profiles.map((p) => (
              <option key={`p${p.id}`} value={`p:${p.id}`}>
                Profile: {p.name}
              </option>
            ))}
            {allAccounts.map((a) => (
              <option key={a.id} value={`a:${a.id}`}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span style={lbl}>Instrument</span>
          <select className="input" value={set.instrument} onChange={(e) => up({ instrument: e.target.value })}>
            <option value="">Any</option>
            <option value="XAUUSD">XAUUSD</option>
            <option value="US100">US100</option>
          </select>
        </label>
        <label className={field}>
          <span style={lbl}>Session</span>
          <select className="input" value={set.session} onChange={(e) => up({ session: e.target.value })}>
            <option value="">Any</option>
            {SESSIONS.map((s) => (
              <option key={s} value={s}>
                {sessionLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span style={lbl}>Setup</span>
          <select className="input" value={set.setup} onChange={(e) => up({ setup: e.target.value })}>
            <option value="">Any</option>
            {setups.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span style={lbl}>Direction</span>
          <select
            className="input"
            value={set.direction}
            onChange={(e) => up({ direction: e.target.value as FilterSet['direction'] })}
          >
            <option value="">Any</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
        <label className={field}>
          <span style={lbl}>Followed plan</span>
          <select
            className="input"
            value={set.followed}
            onChange={(e) => up({ followed: e.target.value as FilterSet['followed'] })}
          >
            <option value="">Any</option>
            <option value="1">Followed</option>
            <option value="0">Broke plan</option>
          </select>
        </label>
        <label className={field}>
          <span style={lbl}>Emotion</span>
          <select className="input" value={set.emotion} onChange={(e) => up({ emotion: e.target.value })}>
            <option value="">Any</option>
            {EMOTIONS.map((em) => (
              <option key={em.value} value={em.value}>
                {em.label}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span style={lbl}>Tag</span>
          <select className="input" value={set.tag} onChange={(e) => up({ tag: e.target.value })}>
            <option value="">Any</option>
            {tags.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.category}: {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span style={lbl}>From</span>
          <input type="date" className="input" value={set.from} onChange={(e) => up({ from: e.target.value })} />
        </label>
        <label className={field}>
          <span style={lbl}>To</span>
          <input type="date" className="input" value={set.to} onChange={(e) => up({ to: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

function deltaText(m: PivotMetric, a: number | null | undefined, b: number | null | undefined, currency: string) {
  if (a == null || b == null) return { text: '—', cls: 'text-slate-500' };
  const d = b - a;
  const kind = METRIC_META[m].kind;
  let text: string;
  if (kind === 'pct') text = `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`;
  else if (kind === 'money') text = `${d >= 0 ? '+' : '-'}${formatMoney(Math.abs(d), currency)}`;
  else if (kind === 'count') text = `${d >= 0 ? '+' : ''}${d}`;
  else if (kind === 'dur') text = `${d >= 0 ? '+' : '-'}${formatMetric(m, Math.abs(d))}`;
  else text = `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
  if (d === 0 || kind === 'count') return { text, cls: 'text-slate-400' };
  const good = METRIC_META[m].higherBetter ? d > 0 : d < 0;
  return { text, cls: good ? 'text-pos' : 'text-neg' };
}

function useChartProps() {
  const ct = useChartTheme();
  return {
    ct,
    axis: { tick: { fill: ct.muted, fontSize: 10 }, tickLine: false, axisLine: { stroke: ct.border } },
    tooltip: {
      contentStyle: { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 4, fontSize: 12 },
      itemStyle: { color: ct.textHi },
      labelStyle: { color: ct.text },
      cursor: { fill: ct.cursor },
    },
  };
}

const R_BINS = (() => {
  const out: { lo: number; hi: number; label: string }[] = [{ lo: -Infinity, hi: -2, label: '≤-2' }];
  for (let x = -2; x < 3; x += 0.5) out.push({ lo: x, hi: x + 0.5, label: `${x >= 0 ? '+' : ''}${x}` });
  out.push({ lo: 3, hi: Infinity, label: '≥+3' });
  return out;
})();

export default function Compare() {
  const { filters } = useFilters();
  const base: Base = { account: filters.account, profile: filters.account == null ? filters.profile ?? null : null };
  const [sets, setSets] = useState<FilterSet[]>(() => loadSets() ?? PRESETS[0].build(base));
  const [data, setData] = useState<(SliceResult | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<'usd' | 'r'>('usd');
  const [tags, setTags] = useState<TagWithUses[]>([]);
  const { ct, axis, tooltip } = useChartProps();

  useEffect(() => {
    api.getTags().then(setTags).catch(() => setTags([]));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
    } catch {
      /* ignore */
    }
  }, [sets]);

  const queryKey = sets.map(setParams).join('|');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      Promise.all(sets.map((s) => pivotApi.slice(s)))
        .then((d) => !cancelled && setData(d))
        .catch((e) => !cancelled && setError(e?.message || 'Failed to load'))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const ready = data.length === sets.length && data.every(Boolean) && !error;
  const slices = ready ? (data as SliceResult[]) : [];

  const equityData = useMemo(() => {
    if (!ready) return [];
    const n = Math.max(0, ...slices.map((s) => s.equity.length));
    return Array.from({ length: n + 1 }, (_, i) => {
      const row: Record<string, number | null> = { n: i };
      slices.forEach((s, k) => {
        row[`s${k}`] = i === 0 ? 0 : s.equity[i - 1] ? (unit === 'usd' ? s.equity[i - 1].cum_pnl : s.equity[i - 1].cum_r) : null;
      });
      return row;
    });
  }, [ready, slices, unit]);

  const rDist = useMemo(() => {
    if (!ready) return [];
    return R_BINS.map((b) => {
      const row: Record<string, number | string> = { bin: b.label };
      slices.forEach((s, k) => {
        const rs = s.r.filter((x): x is number => x != null);
        const c = rs.filter((x) => x >= b.lo && x < b.hi).length;
        row[`s${k}`] = rs.length ? c / rs.length : 0;
      });
      return row;
    });
  }, [ready, slices]);

  const groupData = (which: 'by_session' | 'by_hour', metric: 'net_pnl' | 'win_rate' | 'trades') => {
    if (!ready) return [];
    const keys = new Map<string, number>();
    for (const s of slices)
      for (const r of s[which]) if (r.key !== '__none') keys.set(r.key, which === 'by_hour' ? Number(r.key) : SESSIONS.indexOf(r.key));
    return [...keys.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => {
        const row: Record<string, number | string | null> = {
          g: groupLabel(which === 'by_hour' ? 'hour' : 'session', key, key),
        };
        slices.forEach((s, k) => {
          row[`s${k}`] = s[which].find((r) => r.key === key)?.total[metric] ?? null;
        });
        return row;
      });
  };

  const bars = () =>
    sets.map((s, k) => (
      <Bar key={k} dataKey={`s${k}`} name={s.label} fill={SET_COLORS[k]} radius={[2, 2, 0, 0]} isAnimationActive={false} />
    ));

  const smallFmt = (metric: 'net_pnl' | 'win_rate' | 'trades') => (v: number) =>
    metric === 'win_rate' ? formatPct(v) : metric === 'net_pnl' ? formatMoney(v) : String(v);

  const lowSample = ready && slices.some((s) => s.metrics.trades > 0 && s.metrics.trades < 30);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Compare</h1>
          <p className="text-sm text-slate-500">
            Side-by-side filter sets, independent of the global filter bar. Δ is each set vs A.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.name} className="btn" onClick={() => setSets(p.build(base))}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${sets.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        {sets.map((s, i) => (
          <SetEditor
            key={i}
            index={i}
            set={s}
            tags={tags}
            onChange={(ns) => setSets((prev) => prev.map((x, j) => (j === i ? ns : x)))}
            onRemove={i === 2 ? () => setSets((prev) => prev.slice(0, 2)) : undefined}
          />
        ))}
      </div>
      {sets.length < 3 && (
        <div>
          <button className="btn" onClick={() => setSets((prev) => [...prev, emptySet('C', base)])}>
            + Add set C
          </button>
        </div>
      )}

      {error && (
        <div className="card p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {loading && !ready && <div className="card p-4 text-sm text-slate-500">Loading…</div>}

      {ready && (
        <>
          {lowSample && (
            <div className="text-xs text-amber-400">Low sample: one or more sets have fewer than 30 trades — differences may be noise.</div>
          )}
          <div className="card overflow-x-auto p-0" aria-busy={loading}>
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Metric</th>
                  {sets.map((s, k) => (
                    <th key={k} className="px-3 py-2 text-right font-medium" style={{ color: SET_COLORS[k] }}>
                      {s.label}
                    </th>
                  ))}
                  {sets.slice(1).map((s, k) => (
                    <th key={`d${k}`} className="px-3 py-2 text-right font-medium">
                      Δ {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KPI_ROWS.map((m) => (
                  <tr key={m} className="border-t border-slate-800/60">
                    <td className="px-3 py-1.5 text-slate-300">{METRIC_META[m].label}</td>
                    {slices.map((s, k) => (
                      <td key={k} className="num px-3 py-1.5 text-right text-slate-200">
                        {formatMetric(m, s.metrics[m as keyof SliceResult['metrics']])}
                      </td>
                    ))}
                    {slices.slice(1).map((s, k) => {
                      const d = deltaText(
                        m,
                        slices[0].metrics[m as keyof SliceResult['metrics']],
                        s.metrics[m as keyof SliceResult['metrics']],
                        'USD'
                      );
                      return (
                        <td key={`d${k}`} className={`num px-3 py-1.5 text-right ${d.cls}`}>
                          {d.text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="card p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Equity by trade #</h2>
                <div className="flex gap-1" role="group" aria-label="Equity unit">
                  {(['usd', 'r'] as const).map((u) => (
                    <button
                      key={u}
                      className={`btn px-2 ${unit === u ? 'btn-primary' : ''}`}
                      aria-pressed={unit === u}
                      onClick={() => setUnit(u)}
                    >
                      {u === 'usd' ? '$' : 'R'}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={equityData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="n" {...axis} />
                  <YAxis {...axis} width={56} tickFormatter={(v: number) => (unit === 'usd' ? `$${Math.round(v)}` : `${v}R`)} />
                  <Tooltip
                    {...tooltip}
                    cursor={{ stroke: ct.crosshair }}
                    labelFormatter={(n) => `Trade #${n}`}
                    formatter={(v: number) => (unit === 'usd' ? formatMoney(v) : `${v.toFixed(2)}R`)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: ct.text }} />
                  {sets.map((s, k) => (
                    <Line
                      key={k}
                      type="linear"
                      dataKey={`s${k}`}
                      name={s.label}
                      stroke={SET_COLORS[k]}
                      dot={false}
                      strokeWidth={2}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="card p-3">
              <h2 className="mb-2 text-sm font-semibold text-slate-200">R distribution (% of trades with R)</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={rDist} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="bin" {...axis} interval={0} fontSize={9} />
                  <YAxis {...axis} width={40} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                  <Tooltip {...tooltip} formatter={(v: number) => formatPct(v)} labelFormatter={(l) => `R ${l}`} />
                  <Legend wrapperStyle={{ fontSize: 11, color: ct.text }} />
                  {bars()}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(
              [
                ['by_session', 'net_pnl', 'Net P&L by session'],
                ['by_session', 'win_rate', 'Win rate by session'],
                ['by_hour', 'net_pnl', 'Net P&L by hour (SAST)'],
                ['by_hour', 'trades', 'Trades by hour (SAST)'],
              ] as const
            ).map(([which, metric, title]) => (
              <div key={title} className="card p-3">
                <h2 className="mb-2 text-sm font-semibold text-slate-200">{title}</h2>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={groupData(which, metric)} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                    <XAxis dataKey="g" {...axis} />
                    <YAxis
                      {...axis}
                      width={52}
                      tickFormatter={(v: number) =>
                        metric === 'win_rate' ? `${Math.round(v * 100)}%` : metric === 'net_pnl' ? `$${Math.round(v)}` : String(v)
                      }
                    />
                    <Tooltip {...tooltip} formatter={smallFmt(metric)} />
                    {bars()}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
