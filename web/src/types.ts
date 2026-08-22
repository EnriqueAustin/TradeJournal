// API types mirroring docs/CONTRACT.md

export type Instrument = 'XAUUSD' | 'US100' | string;
export type Direction = 'long' | 'short';
export type Session = 'asia' | 'london' | 'overlap' | 'ny' | 'off';
export type TagCategory = 'setup' | 'session' | 'emotion' | 'mistake' | 'grade';

export interface Account {
  id: number;
  name: string;
  broker: string;
  platform: string;
  account_type: string;
  currency: string;
  starting_balance: number;
  prop_daily_loss: number | null;
  prop_max_dd: number | null;
  prop_target: number | null;
  prop_firm: string | null;
  prop_plan: string | null;
  prop_phase: number;
  prop_dd_type: 'trailing' | 'static' | null;
  prop_min_days: number | null;
  prop_profit_split: number | null;
  prop_news_window_min: number | null;
  prop_weekend_hold: number | null;
  prop_consistency_pct: number | null;
  prop_min_hold_sec: number | null;
  prop_hold_deduct_threshold_pct: number | null;
  prop_safety_buffer_pct: number | null;
  prop_max_inactivity_days: number | null;
  broker_tz: string | null;
  times_realigned: number;
  created_at: string;
}

export interface TimeCheck {
  checked: number;
  scores: Record<string, number>;
  fit_at_best: number;
  best_offset_min: number | null;
  fit_at_zero: number;
  aligned: boolean | null;
}

export interface NewAccount {
  name: string;
  broker: string;
  platform: string;
  account_type: string;
  currency: string;
  starting_balance: number;
  prop_daily_loss?: number | null;
  prop_max_dd?: number | null;
  prop_target?: number | null;
  prop_firm?: string | null;
  prop_plan?: string | null;
  prop_phase?: number;
  prop_dd_type?: 'trailing' | 'static' | null;
  prop_min_days?: number | null;
  prop_profit_split?: number | null;
  prop_news_window_min?: number | null;
  prop_weekend_hold?: number | null;
  prop_consistency_pct?: number | null;
  prop_min_hold_sec?: number | null;
  prop_hold_deduct_threshold_pct?: number | null;
  prop_safety_buffer_pct?: number | null;
  prop_max_inactivity_days?: number | null;
  broker_tz?: string | null;
}

export interface Trade {
  id: number;
  account_id: number;
  instrument: string;
  direction: Direction;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  size: number;
  gross_pnl: number;
  commission: number;
  swap: number;
  net_pnl: number;
  r_multiple: number | null;
  stop_price: number | null;
  target_price: number | null;
  mae: number | null;
  mfe: number | null;
  hold_time_sec: number | null;
  session: Session;
  source: string;
  ext_id: string | null;
  setup_id: number | null;
  is_backtest?: number;
  preferred_tf?: string | null;
  created_at: string;
}

export interface Setup {
  id: number;
  name: string;
  instrument: string | null;
  rules: string | null;
  created_at: string;
}

export interface NewSetup {
  name: string;
  instrument?: string | null;
  rules?: string | null;
}

export interface Execution {
  id: number;
  trade_id: number;
  exec_time: string;
  price: number;
  size: number;
  side: 'in' | 'out';
  profit?: number | null;
  commission?: number | null;
  swap?: number | null;
}

export interface Tag {
  id: number;
  category: TagCategory;
  name: string;
}

export interface Note {
  id: number;
  trade_id: number | null;
  day: string | null;
  body: string;
  rules_followed: 0 | 1;
  created_at: string;
}

export interface Screenshot {
  id: number;
  trade_id: number;
  url: string;
}

export type WickLevel =
  | 'asian_high' | 'asian_low' | 'london_high' | 'london_low'
  | 'pdh' | 'pdl' | 'ny_open' | 'equal_highs' | 'equal_lows' | 'other';
export type WickSession = 'asia' | 'london' | 'ny' | 'off';
export interface WickSuggestResponse {
  trade_id: number;
  suggestion: {
    swept_level: WickLevel | null;
    strat_session: WickSession | null;
    matched: boolean;
  };
  detail?: { level: string; price: number; entry: number; direction: string } | null;
  candidates?: { level: string; price: number }[];
  reason?: string;
}

export interface WickTag {
  trade_id: number;
  swept_level: WickLevel | null;
  strat_session: WickSession | null;
  fill_pct: number | null;
  fakeout: number | null;
  updated_at?: string;
}

export interface TradeDetail extends Trade {
  executions: Execution[];
  tags: Tag[];
  notes: Note[];
  screenshots: Screenshot[];
  wick?: WickTag | null;
}

export interface WickEdgeRow {
  key: string;
  count: number;
  win_rate: number;
  net_pnl: number;
  avg_r: number | null;
  avg_fill: number | null;
}
export interface WickEdgeStats {
  total: number;
  by_level: WickEdgeRow[];
  by_session: WickEdgeRow[];
  by_fakeout: WickEdgeRow[];
}

export interface ScoreComponent {
  key: string;
  label: string;
  weight: number;
  score: number; // 0-100
  detail: string | number;
}
export interface EdgeScore {
  total: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  components: ScoreComponent[];
  reliable: boolean;
}
export interface DrawdownStats {
  max_dd: number;
  max_dd_pct: number | null;
  recovery_factor: number | null;
  starting_balance: number;
  series: { t: string; dd: number }[]; // dd <= 0 (underwater)
}
export interface RDistBin {
  label: string;
  count: number;
  net_pnl: number;
}
export interface DowRow {
  dow: number;
  label: string;
  count: number;
  net_pnl: number;
  win_rate: number;
}
export interface ReportKeyNumbers {
  net_pnl: number;
  payoff_ratio: number | null;
  recovery_factor: number | null;
  max_consec_wins: number;
  max_consec_losses: number;
  trading_days: number;
  avg_daily_pnl: number;
  best_day: { day: string; net: number } | null;
  worst_day: { day: string; net: number } | null;
  r_sample: number;
}
export interface ReportCard {
  trade_count: number;
  score: EdgeScore | null;
  drawdown: DrawdownStats | null;
  r_distribution: RDistBin[];
  by_dow: DowRow[];
  key: ReportKeyNumbers | null;
}

export interface TagStatRow {
  name: string;
  count: number;
  win_rate: number;
  net_pnl: number;
  avg_r: number | null;
}
export interface TagStats {
  total_tagged: number;
  by_category: Record<string, TagStatRow[]>;
}

export interface TradesResponse {
  rows: Trade[];
  total: number;
}

export interface StatsSummary {
  net_pnl: number;
  gross_pnl: number;
  trade_count: number;
  win_rate: number;
  profit_factor: number;
  expectancy: number;
  avg_win: number;
  avg_loss: number;
  avg_r: number | null;
  largest_win: number;
  largest_loss: number;
  commission: number;
  swap: number;
}

export interface EquityPoint {
  t: string;
  cum_pnl: number;
}

export interface CalendarDay {
  day: string; // YYYY-MM-DD
  net_pnl: number;
  trade_count: number;
  r: number | null;
}

export interface SessionStat {
  session: Session;
  instrument: string;
  net_pnl: number;
  trade_count: number;
  win_rate: number;
  avg_r: number | null;
}

export interface HourlyStat {
  hour: number; // 0-23 UTC
  instrument: string;
  net_pnl: number;
  trade_count: number;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  account_id: number;
}

export interface SetupStat {
  setup_id: number | null;
  name: string;
  net_pnl: number;
  trade_count: number;
  win_rate: number;
  avg_r: number | null;
  expectancy: number;
}

export interface HoldTimeBucket {
  bucket: string;
  label: string;
  net_pnl: number;
  trade_count: number;
  win_rate: number;
}

export interface HoldTimeStats {
  buckets: HoldTimeBucket[];
  avg_hold_winners_sec: number | null;
  avg_hold_losers_sec: number | null;
}

export interface ExcursionStats {
  avg_mae_winners: number | null;
  avg_mae_losers: number | null;
  avg_mfe_winners: number | null;
  avg_mfe_losers: number | null;
  mae_sample: number;
  mfe_sample: number;
  hit_1r_mfe: number;
  hit_1r_mfe_then_lost: number;
  hit_1r_mfe_then_lost_pct: number | null;
}

export interface PropStats {
  account_id: number;
  currency: string;
  starting_balance: number;
  current_equity: number;
  total_pnl: number;
  current_day: string | null;
  day_pnl: number;
  day_loss_limit: number | null;
  day_loss_used_pct: number | null;
  max_dd: number;
  max_dd_limit: number | null;
  max_dd_used_pct: number | null;
  dd_type: 'trailing' | 'static' | null;
  target: number | null;
  target_progress_pct: number | null;
  phase: number;
  total_phases: number;
  min_trading_days: number | null;
  trading_days_count: number;
  profit_split: number | null;
  news_window_min: number | null;
  weekend_hold: boolean | null;
  consistency_pct: number | null;
  consistency_used_pct: number | null;
  best_day_pnl: number;
  best_day_pct_of_total: number | null;
  largest_single_win: number;
  largest_single_loss: number;
  prop_firm: string | null;
  prop_plan: string | null;
  min_hold_sec: number | null;
  hold_deduct_threshold_pct: number | null;
  avg_hold_sec: number | null;
  avg_hold_ok: boolean | null;
  avg_first_close_sec: number | null;
  avg_first_close_ok: boolean | null;
  first_close_count: number;
  sub_hold_count: number;
  sub_hold_profit: number;
  sub_hold_pct_of_profit: number | null;
  sub_hold_at_risk: boolean;
  safety_buffer_pct: number | null;
  safety_buffer_amount: number | null;
  safety_buffer_met: boolean | null;
  max_inactivity_days: number | null;
  last_trade_date: string | null;
  days_since_last_trade: number | null;
  breaches: string[];
  status: 'ok' | 'warn' | 'breach';
}

export interface GradeCount {
  grade: string;
  trade_count: number;
  net_pnl: number;
}

export interface AdherenceStats {
  rules_followed_pct: number | null;
  followed_count: number;
  broken_count: number;
  graded_count: number;
  avg_pnl_followed: number | null;
  avg_pnl_broken: number | null;
  grades: GradeCount[];
}

export interface StreakDay {
  day: string;
  net_pnl: number;
  trade_count: number;
}

export interface StreakStats {
  current_win_streak: number;
  current_loss_streak: number;
  max_win_streak: number;
  max_loss_streak: number;
  total_net: number;
  best_day: string | null;
  best_day_net: number | null;
  best_day_pct: number | null;
  trading_days: number;
  by_day: StreakDay[];
}

export interface TiltEvent {
  time: string;
  instrument: string;
  gap_sec: number;
  pnl: number;
}

export interface TiltDay {
  day: string;
  tilt_count: number;
}

export interface TiltStats {
  threshold_sec: number;
  count: number;
  tilt_pnl: number;
  events: TiltEvent[];
  by_day: TiltDay[];
}

// ---------- Phase 3 ----------
export interface Bar {
  t: string; // ISO
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface BarsImportResult {
  inserted: number;
  skipped: number;
  instrument: string;
  tf: string;
  total: number;
}

export interface BarsFetchItem {
  instrument: string;
  fetched?: number;
  upserted?: number;
  error?: string;
}

export interface BarsFetchResult {
  from: string;
  to: string;
  results: BarsFetchItem[];
}

export interface BarSeriesInfo {
  instrument: string;
  tf: string;
  bar_count: number;
  first_t: string;
  last_t: string;
}

export interface ReplayMarker {
  t?: string;
  price: number;
}

export interface ReplayFrame {
  tf: string;
  /** 'stored' | `agg:<baseTf>` | 'none' */
  source: string;
  bars: Bar[];
}

export interface ReplayMarkers {
  entry: ReplayMarker | null;
  exit: ReplayMarker | null;
  stop: ReplayMarker | null;
  target: ReplayMarker | null;
}

export interface ReplayResponse {
  trade_id: number;
  instrument: string;
  direction: Direction;
  primary_tf: string;
  frames: ReplayFrame[];
  markers: ReplayMarkers;
}

export interface BacktestResponse {
  instrument: string;
  tf: string;
  from: string | null;
  to: string | null;
  setup_id: number | null;
  bars: Bar[];
}

export interface NewBacktestTrade {
  instrument: string;
  tf?: string;
  direction: Direction;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  size: number;
  stop_price?: number | null;
  target_price?: number | null;
  setup_id?: number | null;
  account_id?: number | null;
  bt_session_id?: number | null;
}

export interface AiReview {
  summary: string;
  patterns: string[];
  suggestions: string[];
}

export interface AiConfig {
  provider: string;
  model: string;
  fallbackModel: string;
  ollamaBaseUrl: string;
  configured: boolean;
}

export type NewsImpact = 'high' | 'medium' | 'low' | 'holiday';

export interface NewsEvent {
  id: string;
  dt: string; // ISO UTC
  currency: string;
  impact: NewsImpact;
  title: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  url?: string | null; // ForexFactory event permalink (from the browser scrape)
}

export interface NewsStatus {
  count: number;
  earliest: string | null;
  latest: string | null;
  last_refresh: string | null;
  refreshing?: boolean;
  auto?: boolean;
  last_error?: string | null;
}

export interface PortfolioAccount extends PropStats {
  name: string;
  broker: string | null;
}

export interface PortfolioStats {
  accounts: PortfolioAccount[];
  account_count: number;
  breach_count: number;
  warn_count: number;
  status: 'ok' | 'warn' | 'breach';
  total_pnl: number;
  day_pnl: number;
  current_equity: number;
  max_dd: number;
}

export interface LivePosition {
  account_id: number;
  ext_id: string;
  instrument: string;
  direction: Direction;
  size: number | null;
  entry_price: number | null;
  entry_time: string | null;
  current_price: number | null;
  unrealized_pnl: number | null;
  updated_at: string;
}

export interface ChecklistItem {
  item: string;
  done: boolean;
}

export interface DailyPlan {
  account_id: number;
  day: string;
  bias: string | null;
  key_levels: string | null;
  risk_cap: number | null;
  checklist_json: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface OptimizerCell {
  sl_r: number;
  tp_r: number;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  total_r: number;
  avg_r: number;
  win_rate: number;
}

export interface OptimizerStats {
  sample_size: number;
  total_scanned: number;
  sl_r: number[];
  tp_r: number[];
  cells: OptimizerCell[];
  best: OptimizerCell | null;
  baseline_r: number;
  baseline_avg_r: number;
  uplift_r: number | null;
}

export interface LivePositionsResponse {
  positions: LivePosition[];
  count: number;
  unrealized_pnl: number;
  last_update: string | null;
}

// ---------- Backtest Studio ----------
export interface BtSession {
  id: number;
  account_id: number | null;
  name: string | null;
  instrument: string;
  base_tf: string;
  start_time: string | null;
  cursor_time: string | null;
  speed: number;
  risk_pct: number | null;
  layout_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewBtSession {
  instrument: string;
  base_tf?: string;
  name?: string | null;
  account_id?: number | null;
  start_time?: string | null;
  cursor_time?: string | null;
  speed?: number;
  risk_pct?: number | null;
  layout_json?: unknown;
}

export interface BtSessionBars {
  session_id: number;
  instrument: string;
  frames: ReplayFrame[];
}

export interface Filters {
  account: number | null;
  instrument: string; // 'All' | 'XAUUSD' | 'US100'
  session: string; // 'All' | session
  setup: string; // 'All' | setup id (as string)
  from: string; // YYYY-MM-DD or ''
  to: string;
}

// ============================================================================
// Signal research module — contract mirror of server/src/research + market.db.
// All `ts`/`date`/`report_date` fields are epoch MILLISECONDS (UTC). See
// docs/signal/SCHEMA.md and API-CONTRACT.md.
// ============================================================================

export type ResearchProvider = 'oanda' | 'fred' | 'finnhub' | 'alpaca';

export interface ResearchHealth {
  server: 'ok';
  marketDb: 'ok' | 'error';
  schema_version: string | null;
  market_db_path: string;
  analytics: 'ok' | 'unreachable' | 'error';
  analytics_detail: unknown;
  providers: Record<ResearchProvider, boolean>;
}

export interface ResearchInstrument {
  id: number;
  symbol: string; // 'XAUUSD' | 'US100'
  name: string;
  type: string; // 'commodity' | 'index'
}

export interface ResearchPriceBar {
  ts: number;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  v: number | null;
}

export interface Freshness {
  source: string;
  last_ok: number | null;
  status: string;
}

export interface ResearchPriceResponse {
  instrument: string;
  timeframe: string;
  count: number;
  bars: ResearchPriceBar[];
  freshness: Freshness;
}

export interface SeriesMeta {
  series_id: string; // 'DFII10' | 'DXY' | 'VIX' | ...
  source: string;
  name: string;
  unit: string;
}

export interface SeriesPoint {
  series_id: string;
  ts: number;
  value: number | null;
}

export interface CotRow {
  report_date: number;
  market: string;
  mm_long: number | null;
  mm_short: number | null;
  comm_long: number | null;
  comm_short: number | null;
  oi: number | null;
}

export interface EtfHolding {
  etf: string; // 'GLD' | 'IAU'
  date: number;
  tonnes: number | null;
  shares: number | null;
  aum: number | null;
}

// --- Epic 3: Gold cockpit ---

export interface DriverScore {
  id: string;
  name: string;
  value: number | null;
  zScore: number | null;
  zChange: number | null;         // z-score of the latest change (Python compute)
  signal: 'bullish' | 'neutral' | 'bearish';
  correlation: number | null;     // returns-based (Python) or level-based (Node fallback)
  beta: number | null;            // OLS: gold return per unit driver change
  r2: number | null;              // regression fit
  pValue: number | null;          // significance of the correlation
  contribution: number | null;    // beta × latest driver change, in % gold push
  relationship: 'direct' | 'inverse';
}
export interface DriversResponse {
  instrument: string;
  drivers: DriverScore[];
  composite: { score: number; label: 'tailwind' | 'neutral' | 'headwind'; confidence: number | null };
  engine?: 'python' | 'node';     // which compute engine produced the scores
  freshness: Freshness;
}

export interface RealYieldOverlayResponse {
  gold: { ts: number; c: number }[];
  realYield: { ts: number; value: number }[];
  correlation60d: number | null;
}

export interface CotSummary {
  reportDate: number;
  mmLong: number;
  mmShort: number;
  mmNet: number;
  pctLong: number;
  commLong: number;
  commShort: number;
  commNet: number;
  oi: number;
  wowChange: number;
  percentile1y: number;
  percentile3y: number;
  extreme: boolean;
}
export interface CotResponse {
  current: CotSummary;
  history: CotRow[];
  freshness: Freshness;
}

export interface EtfFlowResponse {
  etf: string;
  latestDate: number;
  tonnes: number;
  dailyChangeTonnes: number;
  weeklyChangeTonnes: number;
  trend: 'inflow' | 'flat' | 'outflow';
  history: { date: number; tonnes: number }[];
  freshness: Freshness;
}

export interface GoldSilverResponse {
  ratio: number;
  avg1y: number;
  high1y: number;
  low1y: number;
  percentile1y: number;
  history: { ts: number; ratio: number }[];
  freshness: Freshness;
}

export interface SeasonalMonth {
  month: number;
  label: string;
  avgReturn: number;
  medianReturn?: number;
  winRate: number;
  sampleSize: number;
  tStat?: number;
  pValue?: number;
  significant?: boolean;
}

export interface SeasonalBucket {
  label: string;
  avgReturn: number;
  medianReturn: number;
  winRate: number;
  sampleSize: number;
  tStat: number;
  pValue: number;
  significant: boolean;
}

export interface OpExEffect {
  opexWeekAvg: number;
  nonOpexWeekAvg: number;
  significant: boolean;
}

export interface SeasonalityResponse {
  instrument: string;
  granularity?: string;
  months?: SeasonalMonth[];
  buckets?: SeasonalBucket[];
  currentMonth?: number;
  opexEffect?: OpExEffect | null;
  freshness: Freshness;
}

export interface KeyLevel {
  label: string;
  price: number;
  type: 'pivot' | 'round' | 'structure' | 'session' | 'liquidity';
}
export interface StructureShift {
  type: 'BOS' | 'CHoCH';
  direction: 'bullish' | 'bearish';
  ts: number;
  level: number;
}
export interface StructureSwing {
  ts: number;
  price: number;
  type: 'H' | 'L';
}
export interface EqualPool {
  price: number;
  count: number;
  lastTs: number;
}
export interface StructureResponse {
  instrument: string;
  tf: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  shift: StructureShift | null;
  swings: StructureSwing[];
  equalHighs: EqualPool[];
  equalLows: EqualPool[];
  freshness?: Freshness;
}
export interface AdrResponse {
  instrument: string;
  adr: number | null;
  samples: number;
  today?: { open: number; high: number; low: number; range: number };
  pctUsed?: number | null;
  projectedHigh?: number;
  projectedLow?: number;
  freshness?: Freshness;
}
export interface LiquiditySweep {
  ts: number;
  level: string;
  price: number;
  direction: 'bullish' | 'bearish';
  wick: number;
  rejection: number;
}
export interface SweepsResponse {
  instrument: string;
  sweeps: LiquiditySweep[];
  freshness?: Freshness;
}
export interface LevelsResponse {
  instrument: string;
  currentPrice: number;
  levels: KeyLevel[];
  freshness: Freshness;
}
export type RadarSeverity = 'hot' | 'warn' | 'info';
export interface RadarSignal {
  severity: RadarSeverity;
  kind: string;
  title: string;
  detail: string;
  level?: string;
  price?: number;
  distance?: number;
  direction?: 'bullish' | 'bearish';
  ts?: number;
}
export interface RadarResponse {
  instrument: string;
  price: number | null;
  adr: number | null;
  session: string;
  killzone?: string | null;
  bias?: 'bullish' | 'bearish' | 'neutral';
  signals: RadarSignal[];
  freshness?: Freshness;
}

export interface Constituent {
  index_id: string; // 'QQQ' | 'NDX'
  symbol: string;
  weight: number | null;
  sector: string | null;
  asof: number;
}

export interface EarningsRow {
  symbol: string;
  report_date: number;
  time: string | null; // 'bmo' | 'amc' | 'dmt'
  eps_est: number | null;
  eps_act: number | null;
  rev_est: number | null;
  rev_act: number | null;
}

export interface ResearchCalendarEvent {
  id: string;
  ts: number;
  country: string | null;
  name: string | null;
  impact: 'high' | 'medium' | 'low' | 'holiday' | null;
  consensus: number | null;
  prior: number | null;
  actual: number | null;
}

export interface NewsItem {
  id: string;
  ts: number;
  source: string | null;
  headline: string | null;
  url: string | null;
  instruments: string | null; // CSV of symbols
  sentiment: number | null;
}

export interface NewsResponse {
  items: NewsItem[];
  total: number;
  asOf: number;
}

export interface NewsSummary {
  total24h: number;
  bullish: number;
  bearish: number;
  neutral: number;
  topSources: { source: string; count: number }[];
  lastIngest: number | null;
}

export interface ExplainMoveRequest {
  instrument: string;
  timestamp: number;
  timeframe: string;
  direction: 'up' | 'down';
  magnitude: number;
}

export interface ExplainEvidence {
  nearbyNews: { id: string; ts: number; headline: string | null; source: string | null; sentiment: number | null }[];
  nearbyEvents: { ts: number; name: string; country: string; impact: string; actual: number | null; consensus: number | null }[];
  regime: string;
  correlatedMoves: { symbol: string; move: number }[];
}

export interface ExplainMoveResponse {
  instrument: string;
  timestamp: number;
  explanation: string | null;
  evidence: ExplainEvidence;
  model: string | null;
  cached: boolean;
  error?: string;
}

export type AlertType =
  | 'price' | 'indicator' | 'driver' | 'event' | 'positioning' | 'vol' | 'correlation';

export interface ResearchAlert {
  id: number;
  user: string;
  type: AlertType;
  config_json: unknown;
  active: number; // 0 | 1
  last_fired: number | null;
  created_at: number;
}

export interface Brief {
  id: number;
  instrument: string;
  date: number;
  content: string | null;
  model: string | null;
}

export interface ContextSnapshot {
  trade_id: number;
  ts: number;
  payload_json: unknown;
}

export interface SnapshotPrice {
  last: number; daily_open: number; daily_high: number;
  daily_low: number; prev_close: number;
}
export interface SnapshotRegime {
  label: string; score: number;
  factors: Array<{ name: string; value: number; signal: string }>;
}
export interface SnapshotDriver {
  id: string; name?: string; value: number | null; zScore: number | null;
  signal: string; correlation: number | null;
}
export interface SnapshotDrivers {
  composite: { score: number; label: string };
  items: SnapshotDriver[];
}
export interface SnapshotVol {
  vix: number | null; vxn: number | null; gvz: number | null;
  instrument_iv: number | null; percentile_60d: number | null;
  expected_move_1d: number | null;
}
export interface SnapshotPositioning {
  cot_net_mm: number | null; cot_pct_long: number | null;
  cot_wow_delta: number | null; cot_percentile_1y: number | null;
  etf_tonnes: number | null; etf_daily_delta: number | null;
  etf_trend: string | null;
}
export interface SnapshotEvent {
  name: string; ts: number; impact: string;
  consensus: number | null; prior: number | null;
}
export interface SnapshotNews {
  headline: string; source: string; sentiment: number | null; ts: number;
}
export interface SnapshotLevel {
  price: number; label: string;
}
export interface SnapshotSeasonality {
  month: { name: string; avg_return: number; win_rate: number } | null;
  dow: { name: string; avg_return: number; win_rate: number } | null;
}
export interface ContextSnapshotPayload {
  version: number;
  captured_at: number;
  instrument: string;
  price: SnapshotPrice | null;
  regime: SnapshotRegime | null;
  rates: Record<string, number> | null;
  drivers: SnapshotDrivers | null;
  vol: SnapshotVol | null;
  positioning: SnapshotPositioning | null;
  upcoming_events: SnapshotEvent[] | null;
  recent_news: SnapshotNews[] | null;
  correlations: { window: number; pairs: Record<string, number> } | null;
  key_levels: { above: SnapshotLevel[]; below: SnapshotLevel[] } | null;
  seasonality: SnapshotSeasonality | null;
}
export interface ContextSnapshotResponse {
  trade_id: number;
  ts: number;
  payload: ContextSnapshotPayload;
}

export interface EdgeBucket {
  category: string;
  bucket: string;
  trades_n: number;
  win_rate: number;
  avg_r: number | null;
  expectancy: number | null;
  avg_pnl: number;
}
export interface EdgeAnalytics {
  instrument: string;
  dimensions: Record<string, EdgeBucket[]>;
  best_edge: { dimension: string; bucket: string; expectancy: number } | null;
  total_trades: number;
}
export interface Debrief {
  trade_id: number;
  content: string;
  model: string;
  created_at: number;
}

// S0.5 — real-time WebSocket tick
export interface PriceTick {
  type: 'price';
  instrument: string;
  ts: number;
  bid: number;
  ask: number;
  mid: number;
}

// S1.1 — Alpaca snapshot quote
export interface AlpacaQuote {
  price: number | null;
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  ts: number | null;
}

export interface ConstituentMember {
  symbol: string;
  weight: number | null;
  sector: string | null;
  mag7: boolean;
  quote: AlpacaQuote | null;
}

export interface ConstituentResponse {
  index: string;
  count: number;
  members: ConstituentMember[];
  freshness: Freshness;
}

// S1.2 — Contribution grid
export interface ContributionMember {
  symbol: string;
  weight: number;
  sector: string | null;
  mag7: boolean;
  price: number | null;
  change: number | null;
  changePct: number | null;
  contribution: number;
}

export interface ContributionResponse {
  members: ContributionMember[];
  summary: {
    totalContrib: number;
    mag7Contrib: number;
    mag7Weight: number;
    broadContrib: number;
    broadVsNarrow: number | null;
  };
  sectors: Record<string, { weight: number; contribution: number; count: number }>;
}

// S1.3 — Breadth + treemap
export interface BreadthItem {
  symbol: string;
  weight: number;
  sector: string | null;
  changePct: number | null;
  price: number | null;
  mag7: boolean;
}

export interface BreadthResponse {
  breadth: {
    advancers: number;
    decliners: number;
    unchanged: number;
    total: number;
    advPct: number;
    decPct: number;
    adRatio: number;
  };
  treemap: BreadthItem[];
}

// S1.4 — Rate overlay
export interface OverlayPoint {
  ts: number;
  c: number | null;
}

export interface RateOverlayResponse {
  us100: OverlayPoint[];
  dgs10: SeriesPoint[];
  dfii10: SeriesPoint[];
}

// S1.6 — Earnings
export interface EnrichedEarning {
  symbol: string;
  report_date: number;
  time: string | null;
  eps_est: number | null;
  eps_act: number | null;
  rev_est: number | null;
  rev_act: number | null;
  weight: number;
  importance: number;
  mag7: boolean;
}

export interface EarningsResponse {
  count: number;
  earnings: EnrichedEarning[];
  freshness: Freshness;
}

// S1.4 — Series list
export interface SeriesListResponse extends Array<SeriesMeta> {}

export interface SeriesDataResponse {
  meta: SeriesMeta;
  count: number;
  data: SeriesPoint[];
  freshness: Freshness;
}

// S1.5 — Vol & expected move
export interface VolResponse {
  instrument: string;
  volIndex: string;
  current: number | null;
  pctRank: number | null;
  avg60d: number | null;
  high60d: number | null;
  low60d: number | null;
  expectedMove: {
    daily: number | null;
    weekly: number | null;
  };
  history: SeriesPoint[];
}

// S2.2 — Rates board
export interface RateBoardEntry {
  name: string;
  unit: string;
  value: number | null;
  ts: number | null;
  prev: number | null;
  change: number | null;
}

export interface YieldCurvePoint {
  tenor: string;
  yield: number | null;
}

export interface RatesResponse {
  board: Record<string, RateBoardEntry>;
  yieldCurve: YieldCurvePoint[];
}

// S2.3 — Econ tracker
export interface EconIndicator {
  id: string;
  name: string;
  unit: string;
  value: number | null;
  ts: number | null;
  prev: number | null;
  mom: number | null;
  yoy: number | null;
  sparkline: (number | null)[];
}

export interface EconResponse {
  indicators: EconIndicator[];
}

// S2.4 — Risk regime
export interface RegimeFactor {
  name: string;
  value: number;
  signal: string;
}

export interface RegimeResponse {
  regime: string;
  score: number;
  factors: RegimeFactor[];
}

// S1.7 — AI brief
export interface BriefResponse {
  instrument: string;
  date: number;
  content: string | null;
  model: string | null;
  cached?: boolean;
  error?: string;
}

// --- Epic 4: Events & reaction studies ---

export interface CalendarEvent {
  id: string;
  ts: number;
  country: string;
  name: string;
  impact: 'high' | 'medium' | 'low' | 'holiday';
  consensus: number | null;
  prior: number | null;
  actual: number | null;
  countdown: string | null;
  session: 'asia' | 'europe' | 'us' | 'off';
  isPast: boolean;
}

export interface CalendarResponse {
  events: CalendarEvent[];
  count: number;
  nextHighImpact: CalendarEvent | null;
  freshness: Freshness;
}

export interface WindowStats {
  window: string;
  avgMove: number;
  avgMovePct: number;
  avgDirectionalMove: number;
  upPct: number;
  downPct: number;
  maxUp: number;
  maxDown: number;
  sampleSize: number;
}

export interface ReactionInstance {
  eventDate: number;
  actual: number | null;
  consensus: number | null;
  prior: number | null;
  surprise: 'beat' | 'miss' | 'inline' | null;
  prePrice: number;
  moves: Record<string, number>;
  movesPct: Record<string, number>;
}

export interface EventReactionResponse {
  instrument: string;
  event: string;
  stats: WindowStats[];
  byBeat: WindowStats[];
  byMiss: WindowStats[];
  history: ReactionInstance[];
  sampleSize: number;
  freshness: Freshness;
}

export interface UpcomingEvent {
  id: string;
  ts: number;
  name: string;
  impact: string;
  countdown: string;
  hoursAway: number;
}

export interface UpcomingResponse {
  events: UpcomingEvent[];
  riskLevel: 'clear' | 'approaching' | 'imminent';
}

export interface EventMarker {
  ts: number;
  name: string;
  impact: string;
  actual: number | null;
  surprise: 'beat' | 'miss' | 'inline' | null;
}

// --- Epic 5: Correlation, regression, comparison, spread ---

export interface CorrelationCell {
  pair: [string, string];
  corr: number | null;
  n: number;
}

export interface CorrelationResponse {
  window: number;
  labels: string[];
  matrix: (number | null)[][];
  cells: CorrelationCell[];
  asOf: number;
}

export interface RegressionResponse {
  instrument: string;
  vs: string;
  window: number;
  beta: number;
  r2: number | null;
  intercept: number;
  correlation: number | null;
  n: number;
  scatter: { x: number; y: number }[];
  asOf: number;
  error?: string;
}

export interface CompareSeriesPoint {
  ts: number;
  values: Record<string, number>;
}

export interface CompareResponse {
  series: string[];
  mode: 'zscore' | 'pctChange';
  window: number;
  data: CompareSeriesPoint[];
  asOf: number;
}

export interface SpreadPoint {
  ts: number;
  value: number | null;
  longPrice: number;
  shortPrice: number;
}

export interface RegimeCorrelationResponse extends CorrelationResponse {
  regime: string;
  regimeDays: number;
}

export interface PositioningCot {
  mmNet: number;
  pctLong: number;
  wowChange: number;
  percentile1y: number;
  extreme: boolean;
}

export interface PositioningResponse {
  instrument: string;
  cot: PositioningCot | null;
  etf: { tonnes: number; delta: number; trend: string } | null;
  contrarian: { flag: boolean; reason: string };
  asOf: number;
}

export interface SpreadResponse {
  long: string;
  short: string;
  mode: 'ratio' | 'difference';
  current: number;
  mean: number;
  stddev: number;
  zScore: number;
  percentile: number;
  data: SpreadPoint[];
  asOf: number;
  error?: string;
}
