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

export interface TradeDetail extends Trade {
  executions: Execution[];
  tags: Tag[];
  notes: Note[];
  screenshots: Screenshot[];
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
