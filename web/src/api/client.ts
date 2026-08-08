import type {
  Screenshot,
  LivePositionsResponse,
  OptimizerStats,
  DailyPlan,
  PortfolioStats,
  Account,
  NewAccount,
  TimeCheck,
  Trade,
  TradesResponse,
  TradeDetail,
  StatsSummary,
  EquityPoint,
  CalendarDay,
  SessionStat,
  HourlyStat,
  ImportResult,
  Tag,
  Note,
  Filters,
  Setup,
  NewSetup,
  SetupStat,
  HoldTimeStats,
  ExcursionStats,
  PropStats,
  AdherenceStats,
  StreakStats,
  TiltStats,
  Bar,
  BarsImportResult,
  BarsFetchResult,
  BarSeriesInfo,
  ReplayResponse,
  BacktestResponse,
  NewBacktestTrade,
  AiReview,
  AiConfig,
} from '../types';

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
      ...opts,
    });
  } catch (e) {
    throw new ApiError(
      'Cannot reach the API server. Is it running on http://localhost:4000?',
      0
    );
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Build query string from global filters (+ extras). Skips 'All'/empty.
export function filterParams(
  f: Filters,
  extra?: Record<string, string | number | undefined>
): string {
  const p = new URLSearchParams();
  if (f.account != null) p.set('account', String(f.account));
  if (f.instrument && f.instrument !== 'All') p.set('instrument', f.instrument);
  if (f.session && f.session !== 'All') p.set('session', f.session);
  if (f.setup && f.setup !== 'All') p.set('setup', f.setup);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    }
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // Accounts
  getAccounts: () => request<Account[]>('/accounts'),
  createAccount: (body: NewAccount) =>
    request<Account>('/accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateAccount: (id: number, body: Partial<NewAccount>) =>
    request<Account>(`/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAccount: (id: number) =>
    request<void>(`/accounts/${id}`, { method: 'DELETE' }),
  checkAccountTime: (id: number) =>
    request<TimeCheck>(`/accounts/${id}/time-check`),
  realignAccountTimes: (id: number) =>
    request<{ realigned: number; broker_tz: string; note?: string }>(
      `/accounts/${id}/realign-times`,
      { method: 'POST' }
    ),

  // Trades
  getTrades: (f: Filters, limit: number, offset: number) =>
    request<TradesResponse>(`/trades${filterParams(f, { limit, offset })}`),
  getTrade: (id: number) => request<TradeDetail>(`/trades/${id}`),
  patchTrade: (id: number, body: Record<string, unknown>) =>
    request<TradeDetail>(`/trades/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  addTag: (id: number, category: string, name: string) =>
    request<Tag>(`/trades/${id}/tags`, {
      method: 'POST',
      body: JSON.stringify({ category, name }),
    }),
  removeTag: (id: number, tagId: number) =>
    request<void>(`/trades/${id}/tags/${tagId}`, { method: 'DELETE' }),
  addNote: (id: number, body: string, rules_followed: 0 | 1) =>
    request<Note>(`/trades/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body, rules_followed }),
    }),
  uploadScreenshot: async (id: number, file: File): Promise<Screenshot> => {
    const fd = new FormData();
    fd.append('file', file);
    let res: Response;
    try {
      res = await fetch(`${BASE}/trades/${id}/screenshots`, { method: 'POST', body: fd });
    } catch {
      throw new ApiError(
        'Cannot reach the API server. Is it running on http://localhost:4000?',
        0
      );
    }
    if (!res.ok) {
      let msg = `Screenshot upload failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        /* ignore */
      }
      throw new ApiError(msg, res.status);
    }
    return (await res.json()) as Screenshot;
  },
  deleteScreenshot: (id: number, sid: number) =>
    request<void>(`/trades/${id}/screenshots/${sid}`, { method: 'DELETE' }),

  // Setups (Playbook)
  getSetups: () => request<Setup[]>('/setups'),
  createSetup: (body: NewSetup) =>
    request<Setup>('/setups', { method: 'POST', body: JSON.stringify(body) }),
  updateSetup: (id: number, body: Partial<NewSetup>) =>
    request<Setup>(`/setups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteSetup: (id: number) =>
    request<void>(`/setups/${id}`, { method: 'DELETE' }),

  // Stats
  getSummary: (f: Filters) =>
    request<StatsSummary>(`/stats/summary${filterParams(f)}`),
  getEquity: (f: Filters) => request<EquityPoint[]>(`/stats/equity${filterParams(f)}`),
  getCalendar: (f: Filters, month: string) =>
    request<CalendarDay[]>(`/stats/calendar${filterParams(f, { month })}`),
  getSession: (f: Filters) => request<SessionStat[]>(`/stats/session${filterParams(f)}`),
  getHourly: (f: Filters) => request<HourlyStat[]>(`/stats/hourly${filterParams(f)}`),
  getSetupStats: (f: Filters) =>
    request<SetupStat[]>(`/stats/setup${filterParams(f)}`),
  getHoldtime: (f: Filters) =>
    request<HoldTimeStats>(`/stats/holdtime${filterParams(f)}`),
  getExcursion: (f: Filters) =>
    request<ExcursionStats>(`/stats/excursion${filterParams(f)}`),
  getProp: (f: Filters) => request<PropStats>(`/stats/prop${filterParams(f)}`),
  getAdherence: (f: Filters) =>
    request<AdherenceStats>(`/stats/adherence${filterParams(f)}`),
  getStreaks: (f: Filters) =>
    request<StreakStats>(`/stats/streaks${filterParams(f)}`),
  getTilt: (f: Filters) => request<TiltStats>(`/stats/tilt${filterParams(f)}`),
  getOptimizer: (f: Filters, sl?: string, tp?: string) =>
    request<OptimizerStats>(
      `/stats/optimizer${filterParams(f, { sl, tp })}`
    ),
  getPortfolio: (f: Filters) => {
    // Portfolio spans every account — drop the account filter.
    const p = new URLSearchParams();
    if (f.instrument && f.instrument !== 'All') p.set('instrument', f.instrument);
    if (f.session && f.session !== 'All') p.set('session', f.session);
    if (f.setup && f.setup !== 'All') p.set('setup', f.setup);
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    const s = p.toString();
    return request<PortfolioStats>(`/stats/portfolio${s ? `?${s}` : ''}`);
  },

  // Phase 3 — Bars / Replay / Backtest / AI
  getBarSeries: () => request<BarSeriesInfo[]>('/bars/instruments'),
  getBarsStatus: () => request<{ oanda: boolean }>('/bars/status'),
  fetchBars: (body: {
    instrument?: string;
    instruments?: string[];
    from?: string;
    to?: string;
    days?: number;
  }) =>
    request<BarsFetchResult>('/bars/fetch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getBars: (
    instrument: string,
    tf: string,
    from?: string,
    to?: string
  ): Promise<Bar[]> => {
    const p = new URLSearchParams({ instrument, tf });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return request<Bar[]>(`/bars?${p.toString()}`);
  },
  getReplay: (tradeId: number, tfs: string[] = ['M5', 'M15', 'M30', 'H1'], pad?: number) => {
    const p = new URLSearchParams({ tf: tfs.join(',') });
    if (pad != null) p.set('pad', String(pad));
    return request<ReplayResponse>(`/trades/${tradeId}/replay?${p.toString()}`);
  },
  refetchTradeBars: (tradeId: number) =>
    request<{ trade_id: number; bars: unknown }>(
      `/trades/${tradeId}/bars/refetch`,
      { method: 'POST' }
    ),
  runBacktest: (body: {
    instrument: string;
    tf: string;
    from?: string;
    to?: string;
    setup_id?: number | null;
  }) =>
    request<BacktestResponse>('/backtest', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  saveBacktestTrade: (body: NewBacktestTrade) =>
    request<Trade>('/backtest/trades', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getBacktestTrades: (params?: {
    account?: number | null;
    instrument?: string;
    setup?: string;
  }) => {
    const p = new URLSearchParams();
    if (params?.account != null) p.set('account', String(params.account));
    if (params?.instrument) p.set('instrument', params.instrument);
    if (params?.setup && params.setup !== 'All') p.set('setup', params.setup);
    const s = p.toString();
    return request<TradesResponse>(`/backtest/trades${s ? `?${s}` : ''}`);
  },
  deleteBacktestTrade: (id: number) =>
    request<void>(`/backtest/trades/${id}`, { method: 'DELETE' }),
  getBacktestStats: (params?: { account?: number | null; instrument?: string }) => {
    const p = new URLSearchParams();
    if (params?.account != null) p.set('account', String(params.account));
    if (params?.instrument) p.set('instrument', params.instrument);
    const s = p.toString();
    return request<StatsSummary>(`/backtest/stats${s ? `?${s}` : ''}`);
  },
  getAiConfig: () => request<AiConfig>('/ai/config'),
  aiReview: (body: Record<string, unknown>) =>
    request<AiReview>('/ai/review', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getLivePositions: (account: number | null) => {
    const q = account != null ? `?account=${account}` : '';
    return request<LivePositionsResponse>(`/live/positions${q}`);
  },
  getPlan: (account: number | null, day: string) => {
    const p = new URLSearchParams({ day });
    if (account != null) p.set('account', String(account));
    return request<DailyPlan>(`/plans?${p.toString()}`);
  },
  savePlan: (body: {
    account_id?: number | null;
    day: string;
    bias?: string | null;
    key_levels?: string | null;
    risk_cap?: number | null;
    notes?: string | null;
    checklist_json?: string | null;
  }) => request<DailyPlan>('/plans', { method: 'PUT', body: JSON.stringify(body) }),
  autoTag: (body: {
    trade_ids?: number[];
    account_id?: number | null;
    since?: string;
    all_untagged?: boolean;
  }) =>
    request<{ tagged: number; skipped: number; requested: number; error?: string }>(
      '/ai/autotag',
      { method: 'POST', body: JSON.stringify(body) }
    ),
  importBars: async (
    file: File,
    instrument: string,
    tf: string
  ): Promise<BarsImportResult> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('instrument', instrument);
    fd.append('tf', tf);
    let res: Response;
    try {
      res = await fetch(`${BASE}/bars/import`, { method: 'POST', body: fd });
    } catch {
      throw new ApiError(
        'Cannot reach the API server. Is it running on http://localhost:4000?',
        0
      );
    }
    if (!res.ok) {
      let msg = `Bars import failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        /* ignore */
      }
      throw new ApiError(msg, res.status);
    }
    return (await res.json()) as BarsImportResult;
  },

  // Import (multipart, field name `file`)
  importFile: async (
    file: File,
    account?: number | null
  ): Promise<ImportResult> => {
    const fd = new FormData();
    fd.append('file', file);
    if (account != null) fd.append('account', String(account));
    let res: Response;
    try {
      res = await fetch(`${BASE}/import`, { method: 'POST', body: fd });
    } catch {
      throw new ApiError(
        'Cannot reach the API server. Is it running on http://localhost:4000?',
        0
      );
    }
    if (!res.ok) {
      let msg = `Import failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        /* ignore */
      }
      throw new ApiError(msg, res.status);
    }
    return (await res.json()) as ImportResult;
  },
};
