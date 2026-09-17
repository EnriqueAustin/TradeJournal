// Report builder (pivot), Compare slices and their shared filter-set model.
// Kept apart from client.ts so these features stay self-contained.
import { ApiError, filterParams } from './client';
import type { Filters } from '../types';

export type PivotMetric =
  | 'net_pnl'
  | 'trades'
  | 'win_rate'
  | 'profit_factor'
  | 'expectancy'
  | 'avg_r'
  | 'total_r'
  | 'avg_win'
  | 'avg_loss'
  | 'max_dd'
  | 'avg_hold'
  | 'avg_mae_r'
  | 'avg_mfe_r'
  | 'left_on_table';

export type MetricValues = Partial<Record<PivotMetric, number | null>>;

export interface PivotRow {
  key: string;
  label: string;
  total: MetricValues;
  cells?: Record<string, MetricValues>;
}

export interface PivotResult {
  metrics: PivotMetric[];
  rows: PivotRow[];
  cols: { key: string; label: string }[] | null;
  col_totals: Record<string, MetricValues> | null;
  total: MetricValues;
  rows_dim: string;
  cols_dim: string | null;
}

export interface SliceResult {
  metrics: Record<Exclude<PivotMetric, 'left_on_table' | 'trades'>, number | null> & { trades: number };
  equity: { t: string; cum_pnl: number; cum_r: number }[];
  r: (number | null)[];
  pnl: number[];
  days: number;
  by_session: PivotRow[];
  by_hour: PivotRow[];
}

/** One independent filter set (Compare page side). */
export interface FilterSet {
  label: string;
  account: number | null;
  profile: number | null;
  instrument: string; // '' = any
  session: string;
  setup: string;
  from: string;
  to: string;
  direction: '' | 'long' | 'short';
  tag: string;
  followed: '' | '1' | '0';
  emotion: string;
}

export const emptySet = (label: string, base?: Partial<FilterSet>): FilterSet => ({
  label,
  account: null,
  profile: null,
  instrument: '',
  session: '',
  setup: '',
  from: '',
  to: '',
  direction: '',
  tag: '',
  followed: '',
  emotion: '',
  ...base,
});

export function setParams(s: FilterSet): string {
  const p = new URLSearchParams();
  if (s.account != null) p.set('account', String(s.account));
  else if (s.profile != null) p.set('profile', String(s.profile));
  for (const k of ['instrument', 'session', 'setup', 'from', 'to', 'direction', 'tag', 'followed', 'emotion'] as const) {
    if (s[k]) p.set(k, s[k]);
  }
  const q = p.toString();
  return q ? `?${q}` : '';
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`);
  } catch {
    throw new ApiError('Cannot reach the API server.', 0);
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export const pivotApi = {
  pivot: (f: Filters, metrics: PivotMetric[], rows: string, cols: string | null) =>
    get<PivotResult>(
      `/stats/pivot${filterParams(f, { metrics: metrics.join(','), rows, cols: cols ?? undefined })}`
    ),
  slice: (s: FilterSet) => get<SliceResult>(`/stats/slice${setParams(s)}`),
  sliceGlobal: (f: Filters) => get<SliceResult>(`/stats/slice${filterParams(f)}`),
};

export const METRIC_META: Record<PivotMetric, { label: string; kind: 'money' | 'count' | 'pct' | 'ratio' | 'r' | 'dur'; higherBetter: boolean }> = {
  net_pnl: { label: 'Net P&L', kind: 'money', higherBetter: true },
  trades: { label: 'Trades', kind: 'count', higherBetter: true },
  win_rate: { label: 'Win rate', kind: 'pct', higherBetter: true },
  profit_factor: { label: 'Profit factor', kind: 'ratio', higherBetter: true },
  expectancy: { label: 'Expectancy', kind: 'money', higherBetter: true },
  avg_r: { label: 'Avg R', kind: 'r', higherBetter: true },
  total_r: { label: 'Total R', kind: 'r', higherBetter: true },
  avg_win: { label: 'Avg win', kind: 'money', higherBetter: true },
  avg_loss: { label: 'Avg loss', kind: 'money', higherBetter: true },
  max_dd: { label: 'Max DD', kind: 'money', higherBetter: false },
  avg_hold: { label: 'Avg hold', kind: 'dur', higherBetter: false },
  avg_mae_r: { label: 'Avg MAE (R)', kind: 'ratio', higherBetter: false },
  avg_mfe_r: { label: 'Avg MFE (R)', kind: 'ratio', higherBetter: true },
  left_on_table: { label: 'Left on table', kind: 'money', higherBetter: false },
};
