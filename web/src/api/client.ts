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
  BtSession,
  NewBtSession,
  BtSessionBars,
  AiReview,
  AiConfig,
  NewsEvent,
  NewsStatus,
  ResearchHealth,
  ResearchPriceResponse,
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
  // Backtest Studio — replay sessions
  listBtSessions: (account?: number | null) => {
    const q = account != null ? `?account=${account}` : '';
    return request<BtSession[]>(`/backtest/sessions${q}`);
  },
  getBtSession: (id: number) => request<BtSession>(`/backtest/sessions/${id}`),
  createBtSession: (body: NewBtSession) =>
    request<BtSession>('/backtest/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateBtSession: (id: number, body: Partial<NewBtSession>) =>
    request<BtSession>(`/backtest/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteBtSession: (id: number) =>
    request<void>(`/backtest/sessions/${id}`, { method: 'DELETE' }),
  getBtSessionBars: (id: number, tfs: string[]) =>
    request<BtSessionBars>(
      `/backtest/sessions/${id}/bars?tf=${tfs.join(',')}`
    ),
  getBtSessionStats: (id: number) =>
    request<StatsSummary>(`/backtest/sessions/${id}/stats`),
  getBtSessionTrades: (id: number) =>
    request<TradesResponse>(`/backtest/sessions/${id}/trades`),
  getBtDrawings: (id: number) =>
    request<{ drawings: unknown[] }>(`/backtest/sessions/${id}/drawings`),
  saveBtDrawings: (id: number, drawings: unknown[]) =>
    request<{ drawings: unknown[] }>(`/backtest/sessions/${id}/drawings`, {
      method: 'PUT',
      body: JSON.stringify({ drawings }),
    }),

  // Economic calendar / news
  getNews: (q: {
    from?: string;
    to?: string;
    impact?: string;
    currency?: string;
  } = {}) => {
    const p = new URLSearchParams();
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    if (q.impact) p.set('impact', q.impact);
    if (q.currency) p.set('currency', q.currency);
    const s = p.toString();
    return request<NewsEvent[]>(`/news${s ? `?${s}` : ''}`);
  },
  getNewsStatus: () => request<NewsStatus>('/news/status'),
  refreshNews: (feeds?: string[]) =>
    request<{ inserted: number; feeds: string[]; status: NewsStatus }>(
      '/news/refresh',
      { method: 'POST', body: JSON.stringify(feeds ? { feeds } : {}) }
    ),
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

  // Signal research module (docs/signal/)
  getResearchHealth: () => request<ResearchHealth>('/research/health'),
  getResearchPrice: (instrument: string, tf: string, from?: number, to?: number) => {
    const p = new URLSearchParams({ tf });
    if (from) p.set('from', String(from));
    if (to) p.set('to', String(to));
    return request<ResearchPriceResponse>(`/research/price/${instrument}?${p.toString()}`);
  },
  triggerIngest: (days?: number) =>
    request<unknown>('/research/ingest', {
      method: 'POST',
      body: JSON.stringify(days ? { days } : {}),
    }),
  getConstituents: () =>
    request<import('../types').ConstituentResponse>('/research/constituents/us100'),
  getContribution: () =>
    request<import('../types').ContributionResponse>('/research/contribution/us100'),
  getBreadth: () =>
    request<import('../types').BreadthResponse>('/research/breadth/us100'),
  getSeriesData: (id: string, from?: number, to?: number) => {
    const p = new URLSearchParams();
    if (from) p.set('from', String(from));
    if (to) p.set('to', String(to));
    const q = p.toString();
    return request<import('../types').SeriesDataResponse>(`/research/series/${id}${q ? `?${q}` : ''}`);
  },
  getSeriesList: () =>
    request<import('../types').SeriesMeta[]>('/research/series'),
  getRateOverlay: () =>
    request<import('../types').RateOverlayResponse>('/research/overlay/us100/rates'),
  getEarnings: () =>
    request<import('../types').EarningsResponse>('/research/earnings/us100'),
  triggerFredIngest: () =>
    request<unknown>('/research/ingest/fred', { method: 'POST', body: '{}' }),
  getVol: (instrument: string) =>
    request<import('../types').VolResponse>(`/research/vol/${instrument}`),
  triggerCboeIngest: () =>
    request<unknown>('/research/ingest/cboe', { method: 'POST', body: '{}' }),
  getBrief: (instrument: string, mode?: string) => {
    const q = mode ? `?mode=${mode}` : '';
    return request<import('../types').BriefResponse>(`/research/brief/${instrument}${q}`);
  },
  getRates: () =>
    request<import('../types').RatesResponse>('/research/rates'),
  getEcon: () =>
    request<import('../types').EconResponse>('/research/econ'),
  getRegime: () =>
    request<import('../types').RegimeResponse>('/research/regime'),
  getDrivers: (instrument: string) =>
    request<import('../types').DriversResponse>(`/research/drivers/${instrument}`),
  getRealYieldOverlay: (limit?: number) => {
    const q = limit ? `?limit=${limit}` : '';
    return request<import('../types').RealYieldOverlayResponse>(`/research/overlay/xauusd/realyield${q}`);
  },
  getLevels: (instrument: string) =>
    request<import('../types').LevelsResponse>(`/research/levels/${instrument}`),
  getAdr: (instrument: string, days?: number) =>
    request<import('../types').AdrResponse>(`/research/adr/${instrument}${days ? `?days=${days}` : ''}`),
  getSweeps: (instrument: string, limit?: number) =>
    request<import('../types').SweepsResponse>(`/research/sweeps/${instrument}${limit ? `?limit=${limit}` : ''}`),
  getSeasonality: (instrument: string, granularity?: string) => {
    const q = granularity ? `?granularity=${granularity}` : '';
    return request<import('../types').SeasonalityResponse>(`/research/seasonality/${instrument}${q}`);
  },
  getCot: () =>
    request<import('../types').CotResponse>('/research/cot/gold'),
  getEtfFlows: () =>
    request<import('../types').EtfFlowResponse>('/research/etf-flows/gold'),
  getGoldSilverRatio: () =>
    request<import('../types').GoldSilverResponse>('/research/ratio/gold-silver'),
  triggerCftcIngest: () =>
    request<unknown>('/research/ingest/cftc', { method: 'POST', body: '{}' }),
  triggerEtfIngest: () =>
    request<unknown>('/research/ingest/etf', { method: 'POST', body: '{}' }),
  getResearchCalendar: (impact?: string, country?: string) => {
    const p = new URLSearchParams();
    if (impact) p.set('impact', impact);
    if (country) p.set('country', country);
    const q = p.toString();
    return request<import('../types').CalendarResponse>(`/research/calendar${q ? `?${q}` : ''}`);
  },
  getEventReaction: (instrument: string, event: string) =>
    request<import('../types').EventReactionResponse>(`/research/event-reaction/${instrument}?event=${encodeURIComponent(event)}`),
  getUpcomingEvents: (hours?: number) =>
    request<import('../types').UpcomingResponse>(`/research/events/upcoming${hours ? `?hours=${hours}` : ''}`),
  getEventMarkers: (instrument: string, from?: number, to?: number) => {
    const p = new URLSearchParams();
    if (from) p.set('from', String(from));
    if (to) p.set('to', String(to));
    const q = p.toString();
    return request<{ instrument: string; markers: import('../types').EventMarker[] }>(`/research/events/markers/${instrument}${q ? `?${q}` : ''}`);
  },
  triggerCalendarIngest: () =>
    request<unknown>('/research/ingest/calendar', { method: 'POST', body: '{}' }),
  getCorrelation: (window?: number, series?: string[]) => {
    const p = new URLSearchParams();
    if (window) p.set('window', String(window));
    if (series?.length) p.set('series', series.join(','));
    const q = p.toString();
    return request<import('../types').CorrelationResponse>(`/research/correlation${q ? `?${q}` : ''}`);
  },
  getRegression: (instrument: string, vs: string, window?: number) => {
    const p = new URLSearchParams({ vs });
    if (window) p.set('window', String(window));
    return request<import('../types').RegressionResponse>(`/research/regression/${instrument}?${p.toString()}`);
  },
  getCompare: (series: string[], window?: number, mode?: string) => {
    const p = new URLSearchParams({ series: series.join(',') });
    if (window) p.set('window', String(window));
    if (mode) p.set('mode', mode);
    return request<import('../types').CompareResponse>(`/research/compare?${p.toString()}`);
  },
  getRegimeCorrelation: (window: number, regime: string, series?: string[]) => {
    const p = new URLSearchParams({ window: String(window), regime });
    if (series?.length) p.set('series', series.join(','));
    return request<import('../types').RegimeCorrelationResponse>(`/research/correlation/regime?${p.toString()}`);
  },
  getNewsFeed: (opts?: { instrument?: string; limit?: number; since?: number; sentiment?: string }) => {
    const p = new URLSearchParams();
    if (opts?.instrument) p.set('instrument', opts.instrument);
    if (opts?.limit) p.set('limit', String(opts.limit));
    if (opts?.since) p.set('since', String(opts.since));
    if (opts?.sentiment) p.set('sentiment', opts.sentiment);
    const q = p.toString();
    return request<import('../types').NewsResponse>(`/research/news${q ? `?${q}` : ''}`);
  },
  getNewsSummary: () =>
    request<import('../types').NewsSummary>('/research/news/summary'),
  triggerNewsIngest: () =>
    request<unknown>('/research/ingest/news', { method: 'POST', body: '{}' }),
  explainMove: (body: import('../types').ExplainMoveRequest) =>
    request<import('../types').ExplainMoveResponse>('/research/explain-move', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSnapshot: (tradeId: number) =>
    request<import('../types').ContextSnapshotResponse>(`/research/snapshot/${tradeId}`),
  captureSnapshot: (tradeId: number, instrument?: string, entryTime?: number) =>
    request<{ trade_id: number; ts: number; payload: import('../types').ContextSnapshotPayload; captured: boolean }>(`/research/snapshot/${tradeId}`, {
      method: 'POST',
      body: JSON.stringify({ instrument, entryTime }),
    }),
  captureSnapshotBatch: (trades: Array<{ tradeId: number; instrument: string; entryTime?: number }>) =>
    request<{ captured: number; total: number; results: Array<{ tradeId: number; ok: boolean; error?: string }> }>('/research/snapshot/batch', {
      method: 'POST',
      body: JSON.stringify({ trades }),
    }),
  getEdge: (instrument: string) =>
    request<import('../types').EdgeAnalytics>(`/research/edge/${instrument}`),
  getDebrief: (tradeId: number) =>
    request<import('../types').Debrief>(`/research/debrief/${tradeId}`),
  generateDebrief: (tradeId: number) =>
    request<import('../types').Debrief>(`/research/debrief/${tradeId}`, { method: 'POST' }),
  getPositioning: (instrument: string) =>
    request<import('../types').PositioningResponse>(`/research/positioning/${instrument}`),
  getSpread: (long: string, short: string, mode?: string) => {
    const p = new URLSearchParams({ long, short });
    if (mode) p.set('mode', mode);
    return request<import('../types').SpreadResponse>(`/research/spread?${p.toString()}`);
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
