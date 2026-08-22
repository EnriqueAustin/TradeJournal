import { db } from './db.js';
import { summary } from './stats.js';

// Performance goals — a target for one metric over the current period, with live
// progress computed from the same stats the dashboard uses. Rivals (TradeZella,
// Edgewonk) surface goals prominently; we had none.

const METRICS = new Set(['net_pnl', 'win_rate', 'trade_count', 'avg_r', 'profit_factor']);
const PERIODS = new Set(['month', 'week', 'all']);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// From/to (inclusive, YYYY-MM-DD) for a period, or null bounds for 'all'.
function periodBounds(period, now = new Date()) {
  if (period === 'all') return { from: null, to: null, label: 'all time' };
  if (period === 'week') {
    // ISO week: Monday..Sunday, in UTC to match how trades are filtered by date.
    const day = now.getUTCDay(); // 0 Sun..6 Sat
    const diffToMon = (day + 6) % 7;
    const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMon));
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return { from: ymd(mon), to: ymd(sun), label: 'this week' };
  }
  // month
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: ymd(first), to: ymd(last), label: 'this month' };
}

function currentValue(goal) {
  const { from, to } = periodBounds(goal.period);
  const q = {};
  if (goal.account_id != null) q.account = goal.account_id;
  if (from) q.from = from;
  if (to) q.to = to;
  const s = summary(q);
  const v = s[goal.metric];
  return v == null ? null : v;
}

export function listGoals(q = {}) {
  let rows;
  if (q.account) {
    // Account-specific goals plus portfolio-wide (NULL) goals.
    rows = db
      .prepare('SELECT * FROM goals WHERE account_id = ? OR account_id IS NULL ORDER BY id')
      .all(Number(q.account));
  } else {
    rows = db.prepare('SELECT * FROM goals ORDER BY id').all();
  }
  return rows.map((g) => {
    const current = currentValue(g);
    const { label } = periodBounds(g.period);
    const progress =
      current == null || !g.target ? null : Math.round((current / g.target) * 1000) / 1000;
    return { ...g, current, period_label: label, progress };
  });
}

export function createGoal(body = {}) {
  const metric = String(body.metric || '');
  const period = String(body.period || 'month');
  const target = Number(body.target);
  if (!METRICS.has(metric)) return { error: 'invalid metric' };
  if (!PERIODS.has(period)) return { error: 'invalid period' };
  if (!Number.isFinite(target)) return { error: 'invalid target' };
  const account_id =
    body.account_id == null || body.account_id === '' ? null : Number(body.account_id);
  const info = db
    .prepare('INSERT INTO goals (account_id, metric, period, target) VALUES (?, ?, ?, ?)')
    .run(account_id, metric, period, target);
  const g = db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid);
  const current = currentValue(g);
  const { label } = periodBounds(g.period);
  return {
    ...g,
    current,
    period_label: label,
    progress: current == null || !g.target ? null : Math.round((current / g.target) * 1000) / 1000,
  };
}

export function deleteGoal(id) {
  const info = db.prepare('DELETE FROM goals WHERE id = ?').run(Number(id));
  return { deleted: info.changes };
}
