import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client';
import { pivotApi } from '../api/pivot';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { useChartTheme } from '../store/theme';
import { AsyncBoundary } from './states';
import StatTile from './StatTile';
import { runMonteCarlo, type MCInput, type MCResult } from '../utils/monteCarlo';
import { formatMoney, formatPct } from '../utils/format';

// Monte Carlo / risk of ruin: bootstrap the filtered trades' R-multiples (or $
// P&L when too few carry an R) against the account's prop limits. Runs in a
// web worker with a seeded RNG, so the same inputs always give the same answer.

let worker: Worker | null = null;
let workerFailed = false;
let reqId = 0;

function simulate(input: MCInput): Promise<MCResult> {
  if (!workerFailed && typeof Worker !== 'undefined') {
    try {
      worker ??= new Worker(new URL('../utils/monteCarlo.worker.ts', import.meta.url), { type: 'module' });
      const id = ++reqId;
      const w = worker;
      return new Promise((resolve, reject) => {
        const onMsg = (e: MessageEvent<{ id: number; result?: MCResult; error?: string }>) => {
          if (e.data.id !== id) return;
          w.removeEventListener('message', onMsg);
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.result!);
        };
        w.addEventListener('message', onMsg);
        w.postMessage({ id, input });
      });
    } catch {
      workerFailed = true;
    }
  }
  // Fallback: yield a frame first so the "Running…" state paints.
  return new Promise((resolve) => setTimeout(() => resolve(runMonteCarlo(input)), 16));
}

const numOrNull = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export default function MonteCarloCard() {
  const { filters, accounts } = useFilters();
  const key = filterKey(filters);
  const slice = useApi(() => pivotApi.sliceGlobal(filters), [key]);
  const prop = useApi(() => api.getProp(filters), [key]);
  const ct = useChartTheme();

  const account = accounts.find((a) => a.id === (prop.data?.account_id ?? filters.account));
  const [form, setForm] = useState({
    trades: '100',
    runs: '2000',
    seed: '1',
    balance: '',
    riskPct: '',
    maxDd: '',
    dailyLoss: '',
    target: '',
    tpd: '',
    compound: false,
    ddType: 'static' as 'static' | 'trailing',
    unit: 'auto' as 'auto' | 'r' | 'usd',
  });
  const up = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Prefill from the account / prop limits whenever the scope changes.
  const prefilledFor = useRef<string>('');
  useEffect(() => {
    const p = prop.data;
    if (!p || !slice.data) return;
    const k = `${p.account_id}|${key}`;
    if (prefilledFor.current === k) return;
    prefilledFor.current = k;
    const s = slice.data;
    setForm((f) => ({
      ...f,
      balance: String(p.starting_balance || 10000),
      riskPct: String(account?.default_risk_pct ?? 1),
      maxDd: p.max_dd_limit != null ? String(p.max_dd_limit) : '',
      dailyLoss: p.day_loss_limit != null ? String(p.day_loss_limit) : '',
      target: p.target != null ? String(p.target) : '',
      ddType: p.dd_type === 'trailing' ? 'trailing' : 'static',
      tpd: s.days ? String(Math.max(1, Math.round(s.metrics.trades / s.days))) : '3',
    }));
  }, [prop.data, slice.data, key, account?.default_risk_pct]);

  const s = slice.data;
  const rVals = useMemo(() => (s ? s.r.filter((x): x is number => x != null) : []), [s]);
  const autoUnit: 'r' | 'usd' = s && rVals.length >= Math.max(10, s.pnl.length * 0.5) ? 'r' : 'usd';
  const unit = form.unit === 'auto' ? autoUnit : form.unit;
  const sample = unit === 'r' ? rVals : s?.pnl ?? [];

  const input: MCInput | null = useMemo(() => {
    if (!s || !sample.length) return null;
    return {
      sample,
      mode: unit,
      trades: Math.min(2000, Math.max(1, Number(form.trades) || 100)),
      runs: Math.min(10000, Math.max(100, Number(form.runs) || 2000)),
      seed: Number(form.seed) || 1,
      startBalance: Number(form.balance) || 10000,
      riskPct: Number(form.riskPct) || 1,
      compound: form.compound,
      maxDd: numOrNull(form.maxDd),
      ddType: form.ddType,
      dailyLoss: numOrNull(form.dailyLoss),
      tradesPerDay: Math.max(1, Number(form.tpd) || 3),
      target: numOrNull(form.target),
    };
  }, [s, sample, unit, form]);

  const [result, setResult] = useState<MCResult | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputKey = input ? JSON.stringify({ ...input, sample: input.sample.length + ':' + input.sample.slice(0, 5).join(',') + ':' + key }) : '';
  useEffect(() => {
    if (!input) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setRunning(true);
    setErr(null);
    const t = setTimeout(() => {
      simulate(input)
        .then((r) => !cancelled && setResult(r))
        .catch((e) => !cancelled && setErr(e?.message || 'Simulation failed'))
        .finally(() => !cancelled && setRunning(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  const start = Number(form.balance) || 10000;
  const fanData = result?.fan.map((f) => ({ ...f, band90: [f.p5, f.p95], band50: [f.p25, f.p75] })) ?? [];
  const ddHist = result?.maxDd.hist.map((h) => ({ label: `$${Math.round(h.to)}`, count: h.count, from: h.from, to: h.to })) ?? [];
  const maxDdLimit = numOrNull(form.maxDd);
  const ddFloor = maxDdLimit != null && form.ddType === 'static' ? start - maxDdLimit : null;
  const targetLine = numOrNull(form.target) != null ? start + (numOrNull(form.target) as number) : null;

  const field = 'flex flex-col gap-0.5 text-[11px]';
  const lbl = { color: 'var(--term-muted)' };
  const tooltip = {
    contentStyle: { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 4, fontSize: 12 },
    itemStyle: { color: ct.textHi },
    labelStyle: { color: ct.text },
  };
  const pct = (v: number | null | undefined) => (v == null ? '—' : formatPct(v));

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Monte Carlo · risk of ruin</h2>
        <span className="text-[11px] text-slate-500">
          {running ? 'Running…' : result ? `${result.runs.toLocaleString()} runs × ${result.trades} trades · seed ${form.seed}` : ''}
        </span>
      </div>
      <AsyncBoundary
        loading={slice.loading || prop.loading}
        error={slice.error}
        onRetry={slice.reload}
        loadingLabel="Loading trade sample…"
        skeleton="chart"
      >
        {s && s.metrics.trades === 0 && <p className="text-sm text-slate-500">No trades in the current filters to resample.</p>}
        {s && s.metrics.trades > 0 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-slate-500">
              Resamples the {sample.length} filtered trade {unit === 'r' ? 'R-multiples' : '$ results'} with replacement.
              {unit === 'r' ? ' $ per trade = R × risk % × balance.' : ' Risk % is ignored in $ mode.'} Daily loss is a proxy: every{' '}
              {form.tpd || '?'} simulated trades count as one day. Limits prefill from the account's prop settings.
            </p>
            {s.metrics.trades < 30 && (
              <div className="border px-3 py-2 text-xs text-amber-400" style={{ borderColor: 'var(--term-amber)', borderRadius: 2 }}>
                Low sample: only {s.metrics.trades} trades. Bootstrapping this few results will overstate how predictable the edge is.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <label className={field}>
                <span style={lbl}>Trades ahead</span>
                <input className="input" inputMode="numeric" value={form.trades} onChange={(e) => up({ trades: e.target.value })} />
              </label>
              <label className={field}>
                <span style={lbl}>Runs</span>
                <select className="input" value={form.runs} onChange={(e) => up({ runs: e.target.value })}>
                  {['1000', '2000', '5000'].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                <span style={lbl}>Account size $</span>
                <input className="input" inputMode="decimal" value={form.balance} onChange={(e) => up({ balance: e.target.value })} />
              </label>
              <label className={field}>
                <span style={lbl}>Risk / trade %</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={form.riskPct}
                  disabled={unit !== 'r'}
                  onChange={(e) => up({ riskPct: e.target.value })}
                />
              </label>
              <label className={field}>
                <span style={lbl}>Max DD limit $</span>
                <input className="input" inputMode="decimal" placeholder="none" value={form.maxDd} onChange={(e) => up({ maxDd: e.target.value })} />
              </label>
              <label className={field}>
                <span style={lbl}>DD type</span>
                <select className="input" value={form.ddType} onChange={(e) => up({ ddType: e.target.value as 'static' | 'trailing' })}>
                  <option value="static">Static</option>
                  <option value="trailing">Trailing</option>
                </select>
              </label>
              <label className={field}>
                <span style={lbl}>Daily loss $</span>
                <input className="input" inputMode="decimal" placeholder="none" value={form.dailyLoss} onChange={(e) => up({ dailyLoss: e.target.value })} />
              </label>
              <label className={field}>
                <span style={lbl}>Trades / day</span>
                <input className="input" inputMode="numeric" value={form.tpd} onChange={(e) => up({ tpd: e.target.value })} />
              </label>
              <label className={field}>
                <span style={lbl}>Profit target $</span>
                <input className="input" inputMode="decimal" placeholder="none" value={form.target} onChange={(e) => up({ target: e.target.value })} />
              </label>
              <label className={field}>
                <span style={lbl}>Sample</span>
                <select className="input" value={form.unit} onChange={(e) => up({ unit: e.target.value as 'auto' | 'r' | 'usd' })}>
                  <option value="auto">Auto ({autoUnit === 'r' ? 'R' : '$'})</option>
                  <option value="r" disabled={!rVals.length}>
                    R-multiples
                  </option>
                  <option value="usd">$ P&amp;L</option>
                </select>
              </label>
              <label className={field}>
                <span style={lbl}>Seed</span>
                <input className="input" inputMode="numeric" value={form.seed} onChange={(e) => up({ seed: e.target.value })} />
              </label>
              <label className="flex items-center gap-1.5 self-end pb-1 text-[11px]" style={lbl}>
                <input type="checkbox" checked={form.compound} disabled={unit !== 'r'} onChange={(e) => up({ compound: e.target.checked })} />
                Compound
              </label>
            </div>

            {err && <p className="text-sm text-red-400">{err}</p>}
            {result && (
              <div className="flex flex-col gap-4" style={{ opacity: running ? 0.6 : 1 }}>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile
                    label="P(hit max DD)"
                    value={pct(result.pBreachDd)}
                    valueClass={result.pBreachDd != null && result.pBreachDd >= 0.1 ? 'text-red-400' : undefined}
                    sub={maxDdLimit != null ? `${form.ddType} ${formatMoney(maxDdLimit)}` : 'no limit set'}
                  />
                  <StatTile
                    label="P(daily loss hit)"
                    value={pct(result.pBreachDaily)}
                    valueClass={result.pBreachDaily != null && result.pBreachDaily >= 0.1 ? 'text-red-400' : undefined}
                    sub={result.pBreachAny != null ? `any breach ${pct(result.pBreachAny)}` : 'no limit set'}
                  />
                  <StatTile
                    label="P(reach target)"
                    value={pct(result.pTarget)}
                    sub={result.pTargetBeforeBreach != null ? `before any breach ${pct(result.pTargetBeforeBreach)}` : 'no target set'}
                  />
                  <StatTile
                    label="Final P&L p50"
                    value={formatMoney(result.finalPnl.p50)}
                    valueClass={result.finalPnl.p50 >= 0 ? 'text-pos' : 'text-neg'}
                    sub={`p5 ${formatMoney(result.finalPnl.p5)} · p95 ${formatMoney(result.finalPnl.p95)} · P(profit) ${pct(result.pProfit)}`}
                  />
                  <StatTile
                    label="Max DD p50 / p95"
                    value={`${formatMoney(result.maxDd.p50)} / ${formatMoney(result.maxDd.p95)}`}
                    sub={`mean ${formatMoney(result.maxDd.mean)} · p95 ${formatPct(result.maxDd.p95 / start)} of balance`}
                  />
                  <StatTile
                    label="Losing streak p95"
                    value={String(result.streak.p95)}
                    sub={`median ${result.streak.p50} · worst ${result.streak.max}`}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  <div className="xl:col-span-2">
                    <div className="mb-1 text-xs text-slate-400">Equity percentiles (p5–p95 outer, p25–p75 inner, median line)</div>
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={fanData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                        <XAxis dataKey="step" tick={{ fill: ct.muted, fontSize: 10 }} tickLine={false} axisLine={{ stroke: ct.border }} />
                        <YAxis
                          tick={{ fill: ct.muted, fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          width={64}
                          domain={['auto', 'auto']}
                          tickFormatter={(v: number) => `$${Math.round(v).toLocaleString()}`}
                        />
                        <Tooltip
                          {...tooltip}
                          labelFormatter={(n) => `After ${n} trades`}
                          formatter={(v: number | number[], name: string) =>
                            Array.isArray(v) ? [`${formatMoney(v[0])} – ${formatMoney(v[1])}`, name] : [formatMoney(v), name]
                          }
                        />
                        <Area dataKey="band90" name="p5–p95" stroke="none" fill={ct.accent} fillOpacity={0.15} isAnimationActive={false} />
                        <Area dataKey="band50" name="p25–p75" stroke="none" fill={ct.accent} fillOpacity={0.3} isAnimationActive={false} />
                        <Line dataKey="p50" name="median" stroke={ct.accent} dot={false} strokeWidth={2} isAnimationActive={false} />
                        <ReferenceLine y={start} stroke={ct.muted} strokeDasharray="4 4" />
                        {ddFloor != null && (
                          <ReferenceLine y={ddFloor} stroke={ct.neg} strokeDasharray="4 4" label={{ value: 'DD floor', fill: ct.neg, fontSize: 10, position: 'insideBottomLeft' }} />
                        )}
                        {targetLine != null && (
                          <ReferenceLine y={targetLine} stroke={ct.pos} strokeDasharray="4 4" label={{ value: 'target', fill: ct.pos, fontSize: 10, position: 'insideTopLeft' }} />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-400">Max drawdown distribution</div>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={ddHist} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: ct.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: ct.border }} interval={3} />
                        <YAxis tick={{ fill: ct.muted, fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
                        <Tooltip
                          {...tooltip}
                          cursor={{ fill: ct.cursor }}
                          labelFormatter={(_l, p) => {
                            const d = p?.[0]?.payload;
                            return d ? `${formatMoney(d.from)} – ${formatMoney(d.to)}` : '';
                          }}
                          formatter={(v: number) => [`${v} runs`, 'count']}
                        />
                        {maxDdLimit != null && <ReferenceLine x={ddHist.find((h) => h.to >= maxDdLimit)?.label} stroke={ct.neg} strokeDasharray="4 4" />}
                        <Bar dataKey="count" fill={ct.neg} fillOpacity={0.7} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}
