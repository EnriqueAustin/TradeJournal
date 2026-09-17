import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { METRIC_META, pivotApi, type MetricValues, type PivotMetric, type PivotResult } from '../api/pivot';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { useChartTheme } from '../store/theme';
import { AsyncBoundary } from '../components/states';
import { SERIES_COLORS } from '../components/MultiEquityCurve';
import { FIXED_DIMENSIONS, drillParam, formatMetric, groupLabel } from '../utils/metrics';
import type { FieldDef } from '../types';

const ALL_METRICS = Object.keys(METRIC_META) as PivotMetric[];
const VIEWS_KEY = 'trade-journal:report-views';
const LAST_KEY = 'trade-journal:report-last';

interface ReportConfig {
  metrics: PivotMetric[];
  rows: string;
  cols: string;
  view: 'table' | 'chart';
  cellMetric: PivotMetric;
}
interface SavedView extends ReportConfig {
  name: string;
}

const DEFAULT_CONFIG: ReportConfig = {
  metrics: ['net_pnl', 'trades', 'win_rate', 'profit_factor', 'avg_r'],
  rows: 'session',
  cols: '',
  view: 'table',
  cellMetric: 'net_pnl',
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

// Neutral point per metric for diverging colour; others shade by range.
const CENTRE: Partial<Record<PivotMetric, number>> = {
  net_pnl: 0,
  expectancy: 0,
  avg_r: 0,
  total_r: 0,
  profit_factor: 1,
  win_rate: 0.5,
};

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

function useCellColour(values: Record<PivotMetric, (number | null | undefined)[]>) {
  const ct = useChartTheme();
  return useMemo(() => {
    const ranges = {} as Record<PivotMetric, { min: number; max: number }>;
    for (const m of Object.keys(values) as PivotMetric[]) {
      const v = values[m].filter((x): x is number => x != null && Number.isFinite(x));
      ranges[m] = { min: v.length ? Math.min(...v) : 0, max: v.length ? Math.max(...v) : 0 };
    }
    return (m: PivotMetric, v: number | null | undefined): React.CSSProperties | undefined => {
      if (v == null || !ranges[m] || METRIC_META[m].kind === 'count') return undefined;
      const { min, max } = ranges[m];
      const c = CENTRE[m];
      let score: number; // -1..1, positive = good
      if (c != null) {
        const span = Math.max(Math.abs(max - c), Math.abs(min - c)) || 1;
        score = (v - c) / span;
      } else {
        if (max === min) return undefined;
        score = ((v - min) / (max - min)) * 2 - 1;
        if (!METRIC_META[m].higherBetter) score = -score;
      }
      if (!Number.isFinite(score) || Math.abs(score) < 0.02) return undefined;
      return { background: hexA(score > 0 ? ct.pos : ct.neg, Math.min(1, Math.abs(score)) * 0.3) };
    };
  }, [values, ct]);
}

function csvCell(s: string | number | null | undefined): string {
  const v = s == null ? '' : String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function Reports() {
  const { filters } = useFilters();
  const navigate = useNavigate();
  const ct = useChartTheme();
  const [cfg, setCfg] = useState<ReportConfig>(() => ({ ...DEFAULT_CONFIG, ...readJson(LAST_KEY, {}) }));
  const [views, setViews] = useState<SavedView[]>(() => readJson<SavedView[]>(VIEWS_KEY, []));
  const [viewName, setViewName] = useState('');
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);

  useEffect(() => writeJson(LAST_KEY, cfg), [cfg]);
  useEffect(() => writeJson(VIEWS_KEY, views), [views]);
  useEffect(() => {
    api.getFieldDefs().then(setFieldDefs).catch(() => setFieldDefs([]));
  }, []);

  const dims = useMemo(
    () => [...FIXED_DIMENSIONS, ...fieldDefs.map((f) => ({ value: `field:${f.id}`, label: `Field: ${f.name}` }))],
    [fieldDefs]
  );
  const dimLabel = (d: string) => dims.find((x) => x.value === d)?.label ?? d;

  const up = (patch: Partial<ReportConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const metrics = cfg.metrics.length ? cfg.metrics : ['net_pnl' as PivotMetric];
  const cols = cfg.cols && cfg.cols !== cfg.rows ? cfg.cols : null;
  const cellMetric = metrics.includes(cfg.cellMetric) ? cfg.cellMetric : metrics[0];

  const res = useApi<PivotResult>(
    () => pivotApi.pivot(filters, metrics, cfg.rows, cols),
    [filterKey(filters), metrics.join(','), cfg.rows, cols]
  );
  const data = res.data;

  // Column value lists for conditional colour scaling (row totals only).
  const colourValues = useMemo(() => {
    const out = {} as Record<PivotMetric, (number | null | undefined)[]>;
    if (!data) return out;
    if (data.cols) {
      out[cellMetric] = data.rows.flatMap((r) => data.cols!.map((c) => r.cells?.[c.key]?.[cellMetric]));
    } else {
      for (const m of data.metrics) out[m] = data.rows.map((r) => r.total[m]);
    }
    return out;
  }, [data, cellMetric]);
  const colour = useCellColour(colourValues);

  const drill = (rowKey: string, colKey?: string) => {
    const a = drillParam(cfg.rows, rowKey);
    if (!a) return null;
    const p = new URLSearchParams([a]);
    if (cols && colKey != null) {
      const b = drillParam(cols, colKey);
      if (!b || b[0] === a[0]) return null;
      p.set(b[0], b[1]);
    }
    return `/trades?${p.toString()}`;
  };

  const exportCsv = () => {
    if (!data) return;
    const rowsLabel = dimLabel(cfg.rows);
    const lines: string[] = [];
    if (data.cols) {
      lines.push([rowsLabel, ...data.cols.map((c) => groupLabel(cols!, c.key, c.label)), 'Total'].map(csvCell).join(','));
      for (const r of data.rows)
        lines.push(
          [
            groupLabel(cfg.rows, r.key, r.label),
            ...data.cols.map((c) => r.cells?.[c.key]?.[cellMetric] ?? ''),
            r.total[cellMetric] ?? '',
          ]
            .map(csvCell)
            .join(',')
        );
      lines.push(['Total', ...data.cols.map((c) => data.col_totals?.[c.key]?.[cellMetric] ?? ''), data.total[cellMetric] ?? ''].map(csvCell).join(','));
    } else {
      lines.push([rowsLabel, ...data.metrics.map((m) => METRIC_META[m].label)].map(csvCell).join(','));
      for (const r of [...data.rows, { key: '__total', label: 'Total', total: data.total }])
        lines.push(
          [r.key === '__total' ? 'Total' : groupLabel(cfg.rows, r.key, r.label), ...data.metrics.map((m) => r.total[m] ?? '')]
            .map(csvCell)
            .join(',')
        );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${cfg.rows}${cols ? `-by-${cols}` : ''}.csv`.replace(/:/g, '_');
    a.click();
    URL.revokeObjectURL(url);
  };

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.rows.map((r) => {
      const o: Record<string, string | number | null> = { g: groupLabel(cfg.rows, r.key, r.label) };
      if (data.cols) for (const c of data.cols.slice(0, 8)) o[c.key] = r.cells?.[c.key]?.[cellMetric] ?? null;
      else o.v = r.total[cellMetric] ?? null;
      return o;
    });
  }, [data, cfg.rows, cellMetric]);

  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    setViews((vs) => [...vs.filter((v) => v.name !== name), { ...cfg, name }]);
    setViewName('');
  };

  const numCell = (m: PivotMetric, v: number | null | undefined, href: string | null, key: string) => (
    <td key={key} className="num p-0 text-right" style={colour(m, v)}>
      {href ? (
        <button
          className="w-full px-3 py-1.5 text-right text-slate-200 hover:underline"
          title="Open matching trades"
          onClick={() => navigate(href)}
        >
          {formatMetric(m, v)}
        </button>
      ) : (
        <span className="block px-3 py-1.5 text-slate-200">{formatMetric(m, v)}</span>
      )}
    </td>
  );

  const totalCells = (vals: MetricValues, ms: PivotMetric[]) =>
    ms.map((m) => (
      <td key={m} className="num px-3 py-1.5 text-right font-semibold text-slate-100">
        {formatMetric(m, vals[m])}
      </td>
    ));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Reports</h1>
        <p className="text-sm text-slate-500">
          Pick metrics and group-by dimensions. Respects the filter bar. Click a value to open the matching trades.
        </p>
      </div>

      <div className="card flex flex-col gap-3 p-3">
        <div>
          <span className="label">Metrics</span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_METRICS.map((m) => {
              const on = cfg.metrics.includes(m);
              return (
                <button
                  key={m}
                  className={`btn px-2 normal-case ${on ? 'btn-primary' : ''}`}
                  aria-pressed={on}
                  onClick={() => up({ metrics: on ? cfg.metrics.filter((x) => x !== m) : [...cfg.metrics, m] })}
                  title={m === 'left_on_table' ? 'Avg $ of favourable move after exit (needs stored bars; slower)' : undefined}
                >
                  {METRIC_META[m].label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col">
            <span className="label">Rows</span>
            <select className="input" value={cfg.rows} onChange={(e) => up({ rows: e.target.value })}>
              {dims.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Columns</span>
            <select className="input" value={cfg.cols} onChange={(e) => up({ cols: e.target.value })}>
              <option value="">None</option>
              {dims
                .filter((d) => d.value !== cfg.rows)
                .map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
            </select>
          </label>
          {(cols || cfg.view === 'chart') && (
            <label className="flex flex-col">
              <span className="label">{cols ? 'Cell metric' : 'Chart metric'}</span>
              <select className="input" value={cellMetric} onChange={(e) => up({ cellMetric: e.target.value as PivotMetric })}>
                {metrics.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_META[m].label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex gap-1" role="group" aria-label="View">
            {(['table', 'chart'] as const).map((v) => (
              <button key={v} className={`btn ${cfg.view === v ? 'btn-primary' : ''}`} aria-pressed={cfg.view === v} onClick={() => up({ view: v })}>
                {v}
              </button>
            ))}
          </div>
          <button className="btn" onClick={exportCsv} disabled={!data}>
            Export CSV
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
          <span className="label mb-0">Saved views</span>
          {views.length === 0 && <span className="text-xs text-slate-500">none yet</span>}
          {views.map((v) => (
            <span key={v.name} className="inline-flex items-center">
              <button className="btn rounded-r-none normal-case" onClick={() => setCfg({ ...DEFAULT_CONFIG, ...v })}>
                {v.name}
              </button>
              <button
                className="btn rounded-l-none border-l-0 px-1.5"
                aria-label={`Delete view ${v.name}`}
                onClick={() => setViews((vs) => vs.filter((x) => x.name !== v.name))}
              >
                ✕
              </button>
            </span>
          ))}
          <input
            className="input w-40"
            placeholder="View name"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveView()}
          />
          <button className="btn" onClick={saveView} disabled={!viewName.trim()}>
            Save view
          </button>
        </div>
      </div>

      <AsyncBoundary loading={res.loading && !data} error={res.error} onRetry={res.reload} skeleton="table">
        {data && data.rows.length === 0 && <div className="card p-4 text-sm text-slate-500">No trades match the current filters.</div>}
        {data && data.rows.length > 0 && cfg.view === 'table' && (
          <div className="card overflow-x-auto p-0" aria-busy={res.loading}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">
                    {dimLabel(cfg.rows)}
                    {cols ? ` ╲ ${dimLabel(cols)} · ${METRIC_META[cellMetric].label}` : ''}
                  </th>
                  {data.cols
                    ? data.cols.map((c) => (
                        <th key={c.key} className="px-3 py-2 text-right font-medium">
                          {groupLabel(cols!, c.key, c.label)}
                        </th>
                      ))
                    : data.metrics.map((m) => (
                        <th key={m} className="px-3 py-2 text-right font-medium">
                          {METRIC_META[m].label}
                        </th>
                      ))}
                  {data.cols && <th className="px-3 py-2 text-right font-medium">Total</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className="border-t border-slate-800/60">
                    <td className="px-3 py-1.5 text-slate-300">{groupLabel(cfg.rows, r.key, r.label)}</td>
                    {data.cols
                      ? data.cols.map((c) =>
                          numCell(cellMetric, r.cells?.[c.key]?.[cellMetric], r.cells?.[c.key] ? drill(r.key, c.key) : null, c.key)
                        )
                      : data.metrics.map((m) => numCell(m, r.total[m], drill(r.key), m))}
                    {data.cols && (
                      <td className="num px-3 py-1.5 text-right font-semibold text-slate-100">{formatMetric(cellMetric, r.total[cellMetric])}</td>
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-700">
                  <td className="px-3 py-1.5 font-semibold text-slate-200">Total</td>
                  {data.cols
                    ? data.cols.map((c) => (
                        <td key={c.key} className="num px-3 py-1.5 text-right font-semibold text-slate-100">
                          {formatMetric(cellMetric, data.col_totals?.[c.key]?.[cellMetric])}
                        </td>
                      ))
                    : totalCells(data.total, data.metrics)}
                  {data.cols && (
                    <td className="num px-3 py-1.5 text-right font-semibold text-slate-100">{formatMetric(cellMetric, data.total[cellMetric])}</td>
                  )}
                </tr>
              </tbody>
            </table>
            {(cfg.rows.startsWith('tag') || cfg.rows === 'grade' || (cols ?? '').startsWith('tag') || cols === 'grade') && (
              <p className="px-3 py-2 text-[11px] text-slate-500">A trade with several tags counts in each tag's group, so tag groups can sum past the total.</p>
            )}
          </div>
        )}
        {data && data.rows.length > 0 && cfg.view === 'chart' && (
          <div className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">
              {METRIC_META[cellMetric].label} by {dimLabel(cfg.rows).toLowerCase()}
              {cols ? ` × ${dimLabel(cols).toLowerCase()}` : ''}
            </h2>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                <XAxis dataKey="g" tick={{ fill: ct.muted, fontSize: 10 }} tickLine={false} axisLine={{ stroke: ct.border }} />
                <YAxis
                  tick={{ fill: ct.muted, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={60}
                  tickFormatter={(v: number) => formatMetric(cellMetric, v)}
                />
                <Tooltip
                  cursor={{ fill: ct.cursor }}
                  contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 4, fontSize: 12 }}
                  itemStyle={{ color: ct.textHi }}
                  labelStyle={{ color: ct.text }}
                  formatter={(v: number) => formatMetric(cellMetric, v)}
                />
                {data.cols ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: 11, color: ct.text }} />
                    {data.cols.slice(0, 8).map((c, i) => (
                      <Bar
                        key={c.key}
                        dataKey={c.key}
                        name={groupLabel(cols!, c.key, c.label)}
                        fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                        isAnimationActive={false}
                      />
                    ))}
                  </>
                ) : (
                  <Bar dataKey="v" name={METRIC_META[cellMetric].label} isAnimationActive={false} radius={[2, 2, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={
                          CENTRE[cellMetric] != null
                            ? Number(d.v) >= (CENTRE[cellMetric] as number)
                              ? ct.pos
                              : ct.neg
                            : ct.accent
                        }
                      />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
            {data.cols && data.cols.length > 8 && (
              <p className="text-[11px] text-slate-500">Showing the first 8 of {data.cols.length} columns.</p>
            )}
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}
