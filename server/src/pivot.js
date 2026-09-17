// Report builder / pivot + compare "slice" stats.
//
// GET /api/stats/pivot?metrics=net_pnl,win_rate&rows=session&cols=direction + filters
// GET /api/stats/slice + filters  → one filter set's KPIs, equity, R list, by session/hour
//
// Dimensions and metrics are whitelisted and resolved in JS over the filtered
// trade rows — nothing from the query string is ever interpolated into SQL.
import { db } from './db.js';
import { buildFilter } from './stats.js';
import { riskDistance, exitAnalysisFor } from './excursion.js';
import { normalizeInstrument } from './util.js';
import { INSIGHT_THRESHOLDS } from './insights.js';

export const PIVOT_METRICS = [
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
  'avg_mae_r',
  'avg_mfe_r',
  'left_on_table',
];

const TAG_CATEGORIES = ['setup', 'session', 'emotion', 'mistake', 'grade'];
const FIXED_DIMS = [
  'session',
  'setup',
  'instrument',
  'direction',
  'hour',
  'weekday',
  'month',
  'week',
  'tag',
  'grade',
  'emotion',
  'followed',
];

// Whitelist check for a dimension name: fixed dims, tag:<category>, field:<id>.
export function isValidDim(d) {
  if (typeof d !== 'string') return false;
  if (FIXED_DIMS.includes(d)) return true;
  const m = /^tag:([a-z]+)$/.exec(d);
  if (m) return TAG_CATEGORIES.includes(m[1]);
  return /^field:\d{1,9}$/.test(d);
}

const SESSION_ORDER = ['asia', 'london', 'overlap', 'ny', 'off'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function round(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

const realized = (t) => t.exit_time || t.entry_time || '';

// Monday (UTC) of the realized date, as YYYY-MM-DD.
export function isoWeekMonday(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// Group memberships of one trade under a dimension → [{ key, label, sort }].
// Multi-valued dims (tags) return several; a missing value lands in "—".
export function dimValues(t, dim) {
  const none = [{ key: '__none', label: '—', sort: '~' }];
  switch (dim) {
    case 'session': {
      const s = t.session || 'off';
      const i = SESSION_ORDER.indexOf(s);
      return [{ key: s, label: s, sort: i < 0 ? 99 : i }];
    }
    case 'setup':
      return t.setup_id == null
        ? [{ key: '__none', label: 'Unassigned', sort: '~' }]
        : [{ key: String(t.setup_id), label: t.setup_name || `Setup ${t.setup_id}`, sort: t.setup_name || '' }];
    case 'instrument':
      return t.instrument ? [{ key: t.instrument, label: t.instrument, sort: t.instrument }] : none;
    case 'direction':
      return t.direction ? [{ key: t.direction, label: t.direction, sort: t.direction }] : none;
    case 'hour': {
      if (!t.entry_time) return none;
      const h = new Date(t.entry_time).getUTCHours();
      return Number.isFinite(h) ? [{ key: String(h), label: String(h), sort: h }] : none;
    }
    case 'weekday': {
      if (!t.entry_time) return none;
      const w = new Date(t.entry_time).getUTCDay();
      return Number.isFinite(w) ? [{ key: String(w), label: DOW[w], sort: (w + 6) % 7 }] : none;
    }
    case 'month': {
      const m = realized(t).slice(0, 7);
      return m ? [{ key: m, label: m, sort: m }] : none;
    }
    case 'week': {
      const w = isoWeekMonday(realized(t));
      return w ? [{ key: w, label: w, sort: w }] : none;
    }
    case 'followed':
      if (t.followed_plan == null) return [{ key: '__none', label: 'Not reviewed', sort: 2 }];
      return t.followed_plan
        ? [{ key: '1', label: 'Followed', sort: 0 }]
        : [{ key: '0', label: 'Broke plan', sort: 1 }];
    case 'emotion':
      return t.emotion ? [{ key: t.emotion, label: t.emotion, sort: t.emotion }] : none;
    case 'grade':
      return dimValues(t, 'tag:grade');
    case 'tag': {
      const tags = t.tags || [];
      return tags.length
        ? tags.map((g) => ({ key: String(g.id), label: `${g.category}: ${g.name}`, sort: `${g.category}|${g.name}` }))
        : none;
    }
    default: {
      if (dim.startsWith('tag:')) {
        const cat = dim.slice(4);
        const tags = (t.tags || []).filter((g) => g.category === cat);
        return tags.length
          ? tags.map((g) => ({ key: String(g.id), label: g.name, sort: g.name }))
          : none;
      }
      if (dim.startsWith('field:')) {
        const f = (t.fields || {})[dim.slice(6)];
        if (!f) return none;
        if (f.value_text != null && f.value_text !== '')
          return [{ key: String(f.value_text), label: String(f.value_text), sort: String(f.value_text) }];
        if (f.value_num != null)
          return [{ key: String(f.value_num), label: String(f.value_num), sort: f.value_num }];
        return none;
      }
      return none;
    }
  }
}

// All metrics over a set of trade rows (pure). Trades must be chronological for
// max_dd; win/loss classification matches summary() (is_be is neither).
export function computeMetrics(trades) {
  const n = trades.length;
  let net = 0,
    wins = 0,
    losses = 0,
    gw = 0,
    gl = 0,
    rSum = 0,
    rN = 0,
    holdSum = 0,
    holdN = 0,
    maeSum = 0,
    maeN = 0,
    mfeSum = 0,
    mfeN = 0,
    leftSum = 0,
    leftN = 0,
    cum = 0,
    peak = 0,
    dd = 0;
  for (const t of trades) {
    const p = Number(t.net_pnl) || 0;
    net += p;
    if (!t.is_be && p > 0) {
      wins++;
      gw += p;
    } else if (!t.is_be && p < 0) {
      losses++;
      gl += p;
    }
    if (t.r_multiple != null && Number.isFinite(Number(t.r_multiple))) {
      rSum += Number(t.r_multiple);
      rN++;
    }
    if (t.hold_time_sec != null && Number.isFinite(Number(t.hold_time_sec))) {
      holdSum += Number(t.hold_time_sec);
      holdN++;
    }
    if (t.mae != null || t.mfe != null) {
      const rd = riskDistance(t);
      if (rd) {
        if (t.mae != null) {
          maeSum += Number(t.mae) / rd.dist;
          maeN++;
        }
        if (t.mfe != null) {
          mfeSum += Number(t.mfe) / rd.dist;
          mfeN++;
        }
      }
    }
    if (t.left_usd != null && Number.isFinite(t.left_usd)) {
      leftSum += t.left_usd;
      leftN++;
    }
    cum += p;
    if (cum > peak) peak = cum;
    if (peak - cum > dd) dd = peak - cum;
  }
  return {
    net_pnl: round(net),
    trades: n,
    win_rate: n ? round(wins / n, 4) : null,
    profit_factor: gl !== 0 ? round(gw / Math.abs(gl), 3) : null,
    expectancy: n ? round(net / n) : null,
    avg_r: rN ? round(rSum / rN, 3) : null,
    total_r: rN ? round(rSum, 2) : null,
    avg_win: wins ? round(gw / wins) : null,
    avg_loss: losses ? round(gl / losses) : null,
    max_dd: round(dd),
    avg_hold: holdN ? round(holdSum / holdN, 0) : null,
    avg_mae_r: maeN ? round(maeSum / maeN, 3) : null,
    avg_mfe_r: mfeN ? round(mfeSum / mfeN, 3) : null,
    left_on_table: leftN ? round(leftSum / leftN) : null,
  };
}

function pick(m, metrics) {
  const o = {};
  for (const k of metrics) o[k] = m[k] ?? null;
  return o;
}

function cmpSort(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

// Pure pivot over trade rows: rows × optional cols, each cell = selected metrics.
export function pivotTrades(trades, { metrics, rows, cols }) {
  const rowMap = new Map(); // key -> { key, label, sort, trades, cells: Map }
  const colMap = new Map(); // key -> { key, label, sort }
  for (const t of trades) {
    const rv = dimValues(t, rows);
    const cv = cols ? dimValues(t, cols) : null;
    for (const r of rv) {
      let row = rowMap.get(r.key);
      if (!row) {
        row = { ...r, trades: [], cells: new Map() };
        rowMap.set(r.key, row);
      }
      row.trades.push(t);
      if (cv) {
        for (const c of cv) {
          if (!colMap.has(c.key)) colMap.set(c.key, c);
          if (!row.cells.has(c.key)) row.cells.set(c.key, []);
          row.cells.get(c.key).push(t);
        }
      }
    }
  }
  const colList = [...colMap.values()].sort((a, b) => cmpSort(a.sort, b.sort));
  const colTotals = {};
  if (cols) {
    const byCol = new Map();
    for (const t of trades)
      for (const c of dimValues(t, cols)) {
        if (!byCol.has(c.key)) byCol.set(c.key, []);
        byCol.get(c.key).push(t);
      }
    for (const c of colList) colTotals[c.key] = pick(computeMetrics(byCol.get(c.key) || []), metrics);
  }
  const rowList = [...rowMap.values()]
    .sort((a, b) => cmpSort(a.sort, b.sort))
    .map((r) => {
      const out = { key: r.key, label: r.label, total: pick(computeMetrics(r.trades), metrics) };
      if (cols) {
        out.cells = {};
        for (const c of colList) {
          const list = r.cells.get(c.key);
          if (list) out.cells[c.key] = pick(computeMetrics(list), metrics);
        }
      }
      return out;
    });
  return {
    metrics,
    rows: rowList,
    cols: cols ? colList.map((c) => ({ key: c.key, label: c.label })) : null,
    col_totals: cols ? colTotals : null,
    total: pick(computeMetrics(trades), metrics),
  };
}

// buildFilter + the extra Trades-page filters (direction, outcome, tag, hour,
// dow, emotion, followed, after_loss) so Compare/Reports slice the same way the
// trade list does. Unqualified column names resolve to `trades`.
export function extendedFilter(q) {
  const { where, params } = buildFilter(q);
  const clauses = where ? [where.replace(/^WHERE /, '')] : [];
  if (q.direction === 'long' || q.direction === 'short') {
    clauses.push('trades.direction = @direction');
    params.direction = q.direction;
  }
  if (q.outcome === 'win') clauses.push('trades.net_pnl > 0 AND trades.is_be = 0');
  else if (q.outcome === 'loss') clauses.push('trades.net_pnl < 0 AND trades.is_be = 0');
  else if (q.outcome === 'be') clauses.push('trades.is_be = 1');
  if (q.tag !== undefined && q.tag !== '' && Number.isFinite(Number(q.tag))) {
    clauses.push('EXISTS (SELECT 1 FROM trade_tags tt WHERE tt.trade_id = trades.id AND tt.tag_id = @tag)');
    params.tag = Number(q.tag);
  }
  if (q.hour !== undefined && q.hour !== '' && Number.isFinite(Number(q.hour))) {
    clauses.push("CAST(strftime('%H', trades.entry_time) AS INTEGER) = @hour");
    params.hour = Number(q.hour);
  }
  if (q.dow !== undefined && q.dow !== '' && Number.isFinite(Number(q.dow))) {
    clauses.push("CAST(strftime('%w', trades.entry_time) AS INTEGER) = @dow");
    params.dow = Number(q.dow);
  }
  if (q.emotion) {
    clauses.push('EXISTS (SELECT 1 FROM trade_psych p WHERE p.trade_id = trades.id AND p.emotion = @emotion)');
    params.emotion = String(q.emotion);
  }
  if (q.followed === '0' || q.followed === '1') {
    clauses.push('trades.followed_plan = @followed');
    params.followed = Number(q.followed);
  } else if (q.followed === 'none') {
    clauses.push('trades.followed_plan IS NULL');
  }
  if (q.after_loss === '1') {
    clauses.push(
      `EXISTS (SELECT 1 FROM trades p
               WHERE p.account_id = trades.account_id AND p.id <> trades.id
                 AND COALESCE(p.is_backtest, 0) = 0 AND p.net_pnl < 0 AND p.is_be = 0
                 AND p.exit_time IS NOT NULL
                 AND julianday(trades.entry_time) >= julianday(p.exit_time)
                 AND (julianday(trades.entry_time) - julianday(p.exit_time)) * 1440 <= @after_loss_min)`
    );
    params.after_loss_min = INSIGHT_THRESHOLDS.after_loss_min;
  }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

// Load filtered trades (chronological) with whatever joins the dims/metrics need.
export function loadTrades(q, { tags = false, emotion = false, fields = false, left = false } = {}) {
  const { where, params } = extendedFilter(q);
  const rows = db
    .prepare(
      `SELECT trades.* FROM trades
       ${where}
       ORDER BY COALESCE(trades.exit_time, trades.entry_time) ASC, trades.id ASC`
    )
    .all(params);
  if (!rows.length) return rows;
  // Setup names separately: joining setups would make buildFilter's bare
  // `instrument` ambiguous (setups has one too).
  const setupNames = new Map(db.prepare('SELECT id, name FROM setups').all().map((s) => [s.id, s.name]));
  for (const r of rows) r.setup_name = r.setup_id == null ? null : setupNames.get(r.setup_id) ?? null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Chunked IN lists keep us under SQLite's bound-parameter limit.
  const chunks = (ids, size = 500) => {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
    return out;
  };
  const ids = rows.map((r) => r.id);
  if (tags) {
    for (const r of rows) r.tags = [];
    for (const c of chunks(ids)) {
      const ph = c.map(() => '?').join(',');
      for (const g of db
        .prepare(
          `SELECT tt.trade_id, tg.id, tg.category, tg.name FROM trade_tags tt
           JOIN tags tg ON tg.id = tt.tag_id WHERE tt.trade_id IN (${ph})`
        )
        .all(...c))
        byId.get(g.trade_id)?.tags.push({ id: g.id, category: g.category, name: g.name });
    }
  }
  if (emotion) {
    for (const c of chunks(ids)) {
      const ph = c.map(() => '?').join(',');
      for (const p of db.prepare(`SELECT trade_id, emotion FROM trade_psych WHERE trade_id IN (${ph})`).all(...c)) {
        const t = byId.get(p.trade_id);
        if (t) t.emotion = p.emotion;
      }
    }
  }
  if (fields) {
    for (const r of rows) r.fields = {};
    for (const c of chunks(ids)) {
      const ph = c.map(() => '?').join(',');
      for (const f of db
        .prepare(`SELECT trade_id, def_id, value_num, value_text FROM trade_fields WHERE trade_id IN (${ph})`)
        .all(...c))
        byId.get(f.trade_id).fields[String(f.def_id)] = { value_num: f.value_num, value_text: f.value_text };
    }
  }
  if (left) {
    for (const r of rows) {
      const a = exitAnalysisFor(db, r, normalizeInstrument);
      r.left_usd = a?.left_on_table?.usd ?? null;
    }
  }
  return rows;
}

const needsFor = (dims) => ({
  tags: dims.some((d) => d === 'tag' || d === 'grade' || d.startsWith('tag:')),
  emotion: dims.includes('emotion'),
  fields: dims.some((d) => d.startsWith('field:')),
});

// Parse + validate pivot query → { error } | { metrics, rows, cols }.
export function parsePivotQuery(q) {
  const metrics = String(q.metrics || 'net_pnl,trades,win_rate')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!metrics.length) return { error: 'at least one metric is required' };
  const bad = metrics.find((m) => !PIVOT_METRICS.includes(m));
  if (bad) return { error: `unknown metric: ${bad}` };
  const rows = String(q.rows || 'session');
  if (!isValidDim(rows)) return { error: `unknown row dimension: ${rows}` };
  const cols = q.cols ? String(q.cols) : null;
  if (cols && !isValidDim(cols)) return { error: `unknown column dimension: ${cols}` };
  if (cols && cols === rows) return { error: 'row and column dimensions must differ' };
  return { metrics: [...new Set(metrics)], rows, cols };
}

export function pivot(q) {
  const p = parsePivotQuery(q);
  if (p.error) return p;
  const dims = [p.rows, p.cols].filter(Boolean);
  const trades = loadTrades(q, { ...needsFor(dims), left: p.metrics.includes('left_on_table') });
  return { ...pivotTrades(trades, p), rows_dim: p.rows, cols_dim: p.cols };
}

// Everything the Compare page (and Monte Carlo) needs for one filter set.
export function slice(q) {
  const trades = loadTrades(q);
  const equity = [];
  let cum = 0,
    cumR = 0;
  const days = new Set();
  for (const t of trades) {
    cum += Number(t.net_pnl) || 0;
    if (t.r_multiple != null && Number.isFinite(Number(t.r_multiple))) cumR += Number(t.r_multiple);
    equity.push({ t: realized(t), cum_pnl: round(cum), cum_r: round(cumR, 2) });
    days.add(realized(t).slice(0, 10));
  }
  const all = PIVOT_METRICS.filter((m) => m !== 'left_on_table');
  return {
    metrics: pick(computeMetrics(trades), all),
    equity,
    r: trades.map((t) => (t.r_multiple == null ? null : round(Number(t.r_multiple), 3))),
    pnl: trades.map((t) => round(Number(t.net_pnl) || 0)),
    days: days.size,
    by_session: pivotTrades(trades, { metrics: ['net_pnl', 'trades', 'win_rate', 'avg_r'], rows: 'session' }).rows,
    by_hour: pivotTrades(trades, { metrics: ['net_pnl', 'trades', 'win_rate', 'avg_r'], rows: 'hour' }).rows,
  };
}

export function registerPivotRoutes(app) {
  app.get('/api/stats/pivot', (req, res) => {
    const r = pivot(req.query);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });
  app.get('/api/stats/slice', (req, res) => res.json(slice(req.query)));
}
