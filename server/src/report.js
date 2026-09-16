import { db } from './db.js';
import { summary, equity, calendar, setupStats, discipline, tagStats, exitStats } from './stats.js';
import { psychology, agg } from './insights.js';

const iso = (d) => d.toISOString().slice(0, 10);

// First / last day (YYYY-MM-DD) of a YYYY-MM month, plus the previous month key.
export function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return { from: iso(first), to: iso(last), prev: prev.toISOString().slice(0, 7) };
}

// Monday (YYYY-MM-DD) of the week containing `date`.
export function mondayOf(date) {
  const base = new Date(`${date}T00:00:00Z`);
  const dow = (base.getUTCDay() + 6) % 7;
  base.setUTCDate(base.getUTCDate() - dow);
  return iso(base);
}

const round = (n, dp = 2) => (n == null || !Number.isFinite(n) ? n : Math.round(n * 10 ** dp) / 10 ** dp);

function groupAgg(rows, keyFn) {
  const m = new Map();
  for (const t of rows) {
    const k = keyFn(t) ?? 'unknown';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return [...m.entries()].map(([key, l]) => ({ key, ...agg(l) })).sort((a, b) => b.net_pnl - a.net_pnl);
}

// Everything the printable monthly report needs in one call. Mirrors the week
// report (/api/report/week/:date) but adds month-over-month deltas, breakdowns,
// discipline, mistakes, exit analysis and psychology.
export function monthReport(accountId, ym) {
  const { from, to, prev } = monthBounds(ym);
  const pb = monthBounds(prev);
  const q = { account: accountId, from, to };

  const stats = summary(q);
  const prevStats = summary({ account: accountId, from: pb.from, to: pb.to });
  const days = calendar(q);
  const rows = db
    .prepare(
      `SELECT id, instrument, direction, entry_time, exit_time, net_pnl, r_multiple, r_derived,
              session, is_be, followed_plan
       FROM trades
       WHERE account_id = ? AND COALESCE(is_backtest,0) = 0
         AND date(COALESCE(exit_time, entry_time)) BETWEEN date(?) AND date(?)
       ORDER BY net_pnl DESC`
    )
    .all(accountId, from, to);

  const tradedDays = days.filter((d) => d.trade_count > 0);
  const sortedDays = [...tradedDays].sort((a, b) => b.net_pnl - a.net_pnl);
  const green = tradedDays.filter((d) => d.net_pnl > 0).length;

  const mistakes = (tagStats(q).by_category.mistake || [])
    .filter((m) => m.net_pnl < 0)
    .slice(0, 5);

  let exits = null;
  try {
    const e = exitStats(q);
    exits = {
      sample: e.sample,
      avg_left_usd: e.avg_left_usd,
      avg_left_r: e.avg_left_r,
      continued_1r_pct: e.continued_1r_pct,
      horizons: e.horizons,
      hold_to_target: e.hold_to_target,
      top_left: (e.trades || []).slice(0, 3),
    };
  } catch {
    exits = null;
  }

  const recaps = db
    .prepare(
      `SELECT day, kind, body FROM notes
       WHERE account_id = ? AND trade_id IS NULL AND day BETWEEN ? AND ?
         AND body IS NOT NULL AND TRIM(body) <> ''
       ORDER BY day, kind`
    )
    .all(accountId, from, to)
    .map((n) => ({ day: n.day, kind: n.kind === 'week' ? 'week' : 'day', body: n.body }));

  const account = db.prepare('SELECT id, name, currency FROM accounts WHERE id = ?').get(accountId);
  const psych = psychology(q);

  return {
    month: ym,
    from,
    to,
    prev_month: prev,
    account,
    stats,
    prev_stats: prevStats,
    equity: equity(q),
    days,
    trading_days: tradedDays.length,
    green_days: green,
    best_days: sortedDays.filter((d) => d.net_pnl > 0).slice(0, 3),
    worst_days: sortedDays.filter((d) => d.net_pnl < 0).slice(-3).reverse(),
    best_trades: rows.filter((t) => t.net_pnl > 0 && !t.is_be).slice(0, 5),
    worst_trades: rows.filter((t) => t.net_pnl < 0 && !t.is_be).slice(-5).reverse(),
    by_setup: setupStats(q),
    by_session: groupAgg(rows, (t) => t.session),
    by_instrument: groupAgg(rows, (t) => t.instrument),
    discipline: discipline(q),
    mistakes,
    exits,
    psychology: { rated: psych.rated, by_emotion: psych.by_emotion, tilt_after_loss: psych.tilt_after_loss },
    recaps,
    avg_day: tradedDays.length ? round(stats.net_pnl / tradedDays.length) : null,
  };
}
