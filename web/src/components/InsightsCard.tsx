import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from './states';
import type { Insight, InsightLink } from '../types';
import { formatMoney, formatPct, formatR } from '../utils/format';

const SEV = {
  bad: { dot: 'bg-red-500', border: 'border-red-500/40', text: 'text-red-400', label: 'Leak' },
  warn: { dot: 'bg-amber-500', border: 'border-amber-500/40', text: 'text-amber-400', label: 'Watch' },
  good: { dot: 'bg-emerald-500', border: 'border-emerald-500/40', text: 'text-emerald-400', label: 'Edge' },
} as const;

export function insightHref(link: InsightLink | null): string | null {
  if (!link) return null;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(link)) if (v != null && v !== '') p.set(k, String(v));
  return `/trades?${p.toString()}`;
}

function metricText(m: Insight['metric']): string {
  if (m.value == null) return '—';
  switch (m.unit) {
    case 'usd':
      return formatMoney(m.value);
    case 'r':
      return formatR(m.value);
    case 'pct':
      return formatPct(m.value);
    case 'x':
      return `${m.value.toFixed(1)}×`;
    default:
      return String(m.value);
  }
}

function InsightRow({ i, compact }: { i: Insight; compact?: boolean }) {
  const sev = SEV[i.severity];
  const href = insightHref(i.link);
  const inner = (
    <div className={`flex items-start gap-3 rounded-lg border ${sev.border} bg-slate-900/40 p-3 transition ${href ? 'hover:bg-slate-800/50' : ''}`}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev.dot}`} aria-label={sev.label} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-slate-100">{i.title}</span>
          <span className={`num shrink-0 text-sm font-semibold ${sev.text}`} title={i.metric.label}>
            {metricText(i.metric)}
          </span>
        </div>
        <p className={`mt-0.5 text-xs text-slate-400 ${compact ? 'line-clamp-2' : ''}`}>{i.detail}</p>
        <div className="mt-1 flex gap-3 text-[11px] text-slate-500">
          <span>n={i.sample_n}</span>
          {href && <span className="text-cyan-400">View trades →</span>}
        </div>
      </div>
    </div>
  );
  return href ? (
    <Link to={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/**
 * Deterministic insight cards over the current filters. `limit` shows the top N
 * (severity-sorted server-side); `full` also lists checks skipped for low sample.
 */
export default function InsightsCard({ limit, full = false }: { limit?: number; full?: boolean }) {
  const { filters } = useFilters();
  const { data, loading, error, reload } = useApi(() => api.getInsights(filters), [filterKey(filters)]);
  const list = data ? (limit ? data.insights.slice(0, limit) : data.insights) : [];

  return (
    <AsyncBoundary
      loading={loading}
      error={error}
      onRetry={reload}
      isEmpty={!data || (data.insights.length === 0 && !full)}
      emptyMessage={
        data && data.total < (data.thresholds.min_total ?? 10)
          ? `Low sample — insights need at least ${data.thresholds.min_total ?? 10} trades (have ${data.total}).`
          : 'No notable patterns in this range.'
      }
      loadingLabel="Running checks…"
      skeleton="table"
    >
      {data && (
        <div className="flex flex-col gap-2">
          {list.map((i) => (
            <InsightRow key={i.id} i={i} compact={!full} />
          ))}
          {full && data.insights.length === 0 && (
            <p className="text-sm text-slate-500">No notable patterns in this range.</p>
          )}
          {full && data.low_sample.length > 0 && (
            <div className="mt-2">
              <div className="label mb-1">
                Not enough data yet{' '}
                <span className="font-normal normal-case text-slate-600">
                  (buckets need ≥{data.thresholds.min_group}, tags ≥{data.thresholds.min_tagged})
                </span>
              </div>
              <ul className="grid gap-x-6 gap-y-0.5 text-xs text-slate-500 sm:grid-cols-2">
                {data.low_sample.map((l) => (
                  <li key={l.id}>
                    {l.title} — <span className="num">{l.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </AsyncBoundary>
  );
}
