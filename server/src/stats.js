import { db } from './db.js';

// Build a WHERE clause + params from common query filters.
// Date range (from/to) applies to the realized date = date(exit_time).
// By default only real trades are included; opts.backtest selects the
// hypothetical (is_backtest=1) set, opts.backtest==='any' includes both.
export function buildFilter(q, opts = {}) {
  const clauses = [];
  const params = {};
  // A bt_session filter scopes to one replay session's trades (all is_backtest=1),
  // so it implies the "any" backtest set — never the default real-only clause.
  if (opts.btSession != null) {
    clauses.push('bt_session_id = @btSession');
    params.btSession = Number(opts.btSession);
  } else if (opts.backtest === true) {
    clauses.push('COALESCE(is_backtest, 0) = 1');
  } else if (opts.backtest !== 'any') {
    clauses.push('COALESCE(is_backtest, 0) = 0');
  }
  if (q.account) {
    clauses.push('account_id = @account');
    params.account = Number(q.account);
  }
  if (q.instrument) {
    clauses.push('instrument = @instrument');
    params.instrument = q.instrument;
  }
  if (q.session) {
    clauses.push('session = @session');
    params.session = q.session;
  }
  if (q.setup) {
    clauses.push('setup_id = @setup');
    params.setup = Number(q.setup);
  }
  if (q.from) {
    clauses.push("date(COALESCE(exit_time, entry_time)) >= date(@from)");
    params.from = q.from;
  }
  if (q.to) {
    clauses.push("date(COALESCE(exit_time, entry_time)) <= date(@to)");
    params.to = q.to;
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return { where, params };
}

export function summary(q, opts = {}) {
  const { where, params } = buildFilter(q, opts);
  const rows = db
    .prepare(`SELECT net_pnl, gross_pnl, commission, swap, r_multiple FROM trades ${where}`)
    .all(params);

  const count = rows.length;
  let net_pnl = 0,
    gross_pnl = 0,
    commission = 0,
    swap = 0;
  let wins = 0,
    losses = 0;
  let grossWins = 0,
    grossLosses = 0;
  let largest_win = null,
    largest_loss = null;
  let rSum = 0,
    rCount = 0;

  for (const t of rows) {
    net_pnl += t.net_pnl || 0;
    gross_pnl += t.gross_pnl || 0;
    commission += t.commission || 0;
    swap += t.swap || 0;
    const n = t.net_pnl || 0;
    if (n > 0) {
      wins++;
      grossWins += n;
    } else if (n < 0) {
      losses++;
      grossLosses += n;
    }
    if (largest_win === null || n > largest_win) largest_win = n;
    if (largest_loss === null || n < largest_loss) largest_loss = n;
    if (t.r_multiple !== null && t.r_multiple !== undefined) {
      rSum += t.r_multiple;
      rCount++;
    }
  }

  return {
    net_pnl: round(net_pnl),
    gross_pnl: round(gross_pnl),
    trade_count: count,
    win_rate: count ? round(wins / count, 4) : 0,
    profit_factor: grossLosses !== 0 ? round(grossWins / Math.abs(grossLosses), 4) : null,
    expectancy: count ? round(net_pnl / count) : 0,
    avg_win: wins ? round(grossWins / wins) : 0,
    avg_loss: losses ? round(grossLosses / losses) : 0,
    avg_r: rCount ? round(rSum / rCount, 4) : null,
    total_r: rCount ? round(rSum, 2) : null,
    largest_win: largest_win === null ? 0 : round(largest_win),
    largest_loss: largest_loss === null ? 0 : round(largest_loss),
    commission: round(commission),
    swap: round(swap),
  };
}

export function equity(q, opts = {}) {
  const { where, params } = buildFilter(q, opts);
  const rows = db
    .prepare(
      `SELECT COALESCE(exit_time, entry_time) AS t, net_pnl, r_multiple FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) ASC, id ASC`
    )
    .all(params);
  let cum = 0;
  let cumR = 0;
  return rows.map((r) => {
    cum += r.net_pnl || 0;
    if (r.r_multiple != null && !isNaN(r.r_multiple)) cumR += r.r_multiple;
    return { t: r.t, cum_pnl: round(cum), cum_r: round(cumR, 2) };
  });
}

export function calendar(q) {
  const filter = { ...q };
  const { where, params } = buildFilter(filter);
  // month filter (YYYY-MM) on realized date
  let extra = where;
  if (q.month) {
    extra += (where ? ' AND ' : 'WHERE ') +
      "strftime('%Y-%m', COALESCE(exit_time, entry_time)) = @month";
    params.month = q.month;
  }
  const rows = db
    .prepare(
      `SELECT date(COALESCE(exit_time, entry_time)) AS day,
              SUM(net_pnl) AS net_pnl,
              COUNT(*) AS trade_count,
              SUM(r_multiple) AS r
       FROM trades ${extra}
       GROUP BY day ORDER BY day ASC`
    )
    .all(params);
  return rows.map((r) => ({
    day: r.day,
    net_pnl: round(r.net_pnl || 0),
    trade_count: r.trade_count,
    r: r.r === null ? null : round(r.r, 4),
  }));
}

export function sessionStats(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(`SELECT session, instrument, net_pnl, r_multiple FROM trades ${where}`)
    .all(params);
  const groups = new Map();
  for (const t of rows) {
    const key = `${t.session}|${t.instrument}`;
    if (!groups.has(key))
      groups.set(key, {
        session: t.session,
        instrument: t.instrument,
        net_pnl: 0,
        trade_count: 0,
        wins: 0,
        rSum: 0,
        rCount: 0,
      });
    const g = groups.get(key);
    g.net_pnl += t.net_pnl || 0;
    g.trade_count++;
    if ((t.net_pnl || 0) > 0) g.wins++;
    if (t.r_multiple !== null && t.r_multiple !== undefined) {
      g.rSum += t.r_multiple;
      g.rCount++;
    }
  }
  return [...groups.values()].map((g) => ({
    session: g.session,
    instrument: g.instrument,
    net_pnl: round(g.net_pnl),
    trade_count: g.trade_count,
    win_rate: g.trade_count ? round(g.wins / g.trade_count, 4) : 0,
    avg_r: g.rCount ? round(g.rSum / g.rCount, 4) : null,
  }));
}

export function hourly(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(`SELECT entry_time, instrument, net_pnl FROM trades ${where}`)
    .all(params);
  const groups = new Map();
  for (const t of rows) {
    if (!t.entry_time) continue;
    const hour = new Date(t.entry_time).getUTCHours();
    const key = `${hour}|${t.instrument}`;
    if (!groups.has(key))
      groups.set(key, { hour, instrument: t.instrument, net_pnl: 0, trade_count: 0 });
    const g = groups.get(key);
    g.net_pnl += t.net_pnl || 0;
    g.trade_count++;
  }
  return [...groups.values()]
    .map((g) => ({
      hour: g.hour,
      instrument: g.instrument,
      net_pnl: round(g.net_pnl),
      trade_count: g.trade_count,
    }))
    .sort((a, b) => a.hour - b.hour);
}

// Per-setup performance. NULL setup_id trades are grouped as "Unassigned".
export function setupStats(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(
      `SELECT t.setup_id, s.name AS setup_name, t.net_pnl, t.r_multiple
       FROM trades t LEFT JOIN setups s ON s.id = t.setup_id ${where}`
    )
    .all(params);
  const groups = new Map();
  for (const t of rows) {
    const key = t.setup_id == null ? 'null' : String(t.setup_id);
    if (!groups.has(key))
      groups.set(key, {
        setup_id: t.setup_id ?? null,
        name: t.setup_id == null ? 'Unassigned' : t.setup_name,
        net_pnl: 0,
        trade_count: 0,
        wins: 0,
        rSum: 0,
        rCount: 0,
      });
    const g = groups.get(key);
    g.net_pnl += t.net_pnl || 0;
    g.trade_count++;
    if ((t.net_pnl || 0) > 0) g.wins++;
    if (t.r_multiple !== null && t.r_multiple !== undefined) {
      g.rSum += t.r_multiple;
      g.rCount++;
    }
  }
  return [...groups.values()]
    .map((g) => ({
      setup_id: g.setup_id,
      name: g.name,
      net_pnl: round(g.net_pnl),
      trade_count: g.trade_count,
      win_rate: g.trade_count ? round(g.wins / g.trade_count, 4) : 0,
      avg_r: g.rCount ? round(g.rSum / g.rCount, 4) : null,
      expectancy: g.trade_count ? round(g.net_pnl / g.trade_count) : 0,
    }))
    .sort((a, b) => b.net_pnl - a.net_pnl);
}

// Hold-time buckets by hold_time_sec, plus winners/losers avg hold time.
const HOLD_BUCKETS = [
  { bucket: 'lt30s', label: '<30s', max: 30 },
  { bucket: '30_60s', label: '30-60s', max: 60 },
  { bucket: '1_2m', label: '1-2m', max: 120 },
  { bucket: '2_5m', label: '2-5m', max: 300 },
  { bucket: '5_15m', label: '5-15m', max: 900 },
  { bucket: 'gt15m', label: '>15m', max: Infinity },
];

export function holdtime(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(`SELECT hold_time_sec, net_pnl FROM trades ${where}`)
    .all(params);

  const acc = HOLD_BUCKETS.map((b) => ({
    ...b,
    net_pnl: 0,
    trade_count: 0,
    wins: 0,
  }));
  let winHoldSum = 0,
    winHoldCount = 0,
    lossHoldSum = 0,
    lossHoldCount = 0;

  for (const t of rows) {
    if (t.hold_time_sec == null) continue;
    const sec = t.hold_time_sec;
    const idx = HOLD_BUCKETS.findIndex((b) => sec < b.max);
    const b = acc[idx === -1 ? acc.length - 1 : idx];
    b.net_pnl += t.net_pnl || 0;
    b.trade_count++;
    if ((t.net_pnl || 0) > 0) {
      b.wins++;
      winHoldSum += sec;
      winHoldCount++;
    } else if ((t.net_pnl || 0) < 0) {
      lossHoldSum += sec;
      lossHoldCount++;
    }
  }

  return {
    buckets: acc.map((b) => ({
      bucket: b.bucket,
      label: b.label,
      net_pnl: round(b.net_pnl),
      trade_count: b.trade_count,
      win_rate: b.trade_count ? round(b.wins / b.trade_count, 4) : 0,
    })),
    avg_hold_winners_sec: winHoldCount ? round(winHoldSum / winHoldCount, 1) : null,
    avg_hold_losers_sec: lossHoldCount ? round(lossHoldSum / lossHoldCount, 1) : null,
  };
}

// MAE/MFE excursion aggregates.
export function excursion(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(
      `SELECT net_pnl, r_multiple, mae, mfe, entry_price, stop_price, size
       FROM trades ${where}`
    )
    .all(params);

  let winMaeSum = 0,
    winMaeCount = 0,
    winMfeSum = 0,
    winMfeCount = 0;
  let lossMaeSum = 0,
    lossMaeCount = 0,
    lossMfeSum = 0,
    lossMfeCount = 0;
  let hitMfe1R = 0,
    hitMfe1RThenLost = 0;

  for (const t of rows) {
    const isWin = (t.net_pnl || 0) > 0;
    if (t.mae != null) {
      if (isWin) {
        winMaeSum += t.mae;
        winMaeCount++;
      } else {
        lossMaeSum += t.mae;
        lossMaeCount++;
      }
    }
    if (t.mfe != null) {
      if (isWin) {
        winMfeSum += t.mfe;
        winMfeCount++;
      } else {
        lossMfeSum += t.mfe;
        lossMfeCount++;
      }
    }
    // Did MFE reach >=1R of favorable excursion? Requires a stop to define risk (in price terms).
    if (t.mfe != null && t.stop_price != null && t.entry_price != null) {
      const riskDist = Math.abs(t.entry_price - t.stop_price);
      if (riskDist > 0 && t.mfe >= riskDist) {
        hitMfe1R++;
        if ((t.net_pnl || 0) <= 0) hitMfe1RThenLost++;
      }
    }
  }

  return {
    avg_mae_winners: winMaeCount ? round(winMaeSum / winMaeCount, 4) : null,
    avg_mae_losers: lossMaeCount ? round(lossMaeSum / lossMaeCount, 4) : null,
    avg_mfe_winners: winMfeCount ? round(winMfeSum / winMfeCount, 4) : null,
    avg_mfe_losers: lossMfeCount ? round(lossMfeSum / lossMfeCount, 4) : null,
    mae_sample: winMaeCount + lossMaeCount,
    mfe_sample: winMfeCount + lossMfeCount,
    hit_1r_mfe: hitMfe1R,
    hit_1r_mfe_then_lost: hitMfe1RThenLost,
    hit_1r_mfe_then_lost_pct: hitMfe1R ? round(hitMfe1RThenLost / hitMfe1R, 4) : null,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — discipline & prop-firm
// ---------------------------------------------------------------------------

// Resolve the target account: explicit ?account, else the first account.
function resolveAccount(q) {
  if (q.account) return db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(q.account));
  return db.prepare('SELECT * FROM accounts ORDER BY id LIMIT 1').get();
}

// Classify a used-% into a traffic-light status. warn ~80% of a limit.
function pctStatus(pct) {
  if (pct == null) return 'ok';
  if (pct >= 1) return 'breach';
  if (pct >= 0.8) return 'warn';
  return 'ok';
}

// GET /api/stats/prop — prop-firm guardrails for one account.
// Equity vs starting balance, day P&L vs daily-loss limit, running max
// drawdown vs max-DD limit, and profit-target progress. Each as used_pct.
export function propStats(q) {
  const account = resolveAccount(q);
  if (!account) return { error: 'no account' };

  const { where, params } = buildFilter({ ...q, account: account.id });
  const rows = db
    .prepare(
      `SELECT COALESCE(exit_time, entry_time) AS t, net_pnl, hold_time_sec FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) ASC, id ASC`
    )
    .all(params);

  const starting_balance = account.starting_balance || 0;
  const ddType = account.prop_dd_type || 'static';
  let cum = 0;
  let peak = 0;
  let max_dd = 0; // largest peak-to-trough (static) or trailing high-water mark drop
  let trailingFloor = 0; // for trailing DD: floor = hwm - limit (rises, never falls)
  const dayMap = new Map();
  for (const r of rows) {
    cum += r.net_pnl || 0;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > max_dd) max_dd = dd;
    const day = (r.t || '').slice(0, 10);
    if (day) dayMap.set(day, (dayMap.get(day) || 0) + (r.net_pnl || 0));
  }
  const total_pnl = cum;
  const current_equity = starting_balance + total_pnl;

  // For trailing DD the effective drawdown is how far equity is below the high-water mark.
  // The limit itself trails up, so used_pct = (hwm - equity) / limit.
  // For static DD it's peak-to-trough vs the fixed dollar limit.

  const days = [...dayMap.keys()].sort();
  // "Today" must be the actual calendar day, not the most recent trading day —
  // otherwise on a day with no trades yet (e.g. Monday) the last session's P&L
  // (Friday's) leaks through as today's day P&L. If nothing traded today, it's 0.
  const now = new Date();
  const currentDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const day_pnl = dayMap.get(currentDay) || 0;

  const day_loss_limit = account.prop_daily_loss ?? null;
  const max_dd_limit = account.prop_max_dd ?? null;
  const target = account.prop_target ?? null;

  const day_loss_used_pct =
    day_loss_limit && day_loss_limit > 0 && day_pnl < 0
      ? round(Math.abs(day_pnl) / day_loss_limit, 4)
      : day_loss_limit
        ? 0
        : null;
  const max_dd_used_pct =
    max_dd_limit && max_dd_limit > 0 ? round(max_dd / max_dd_limit, 4) : null;
  const target_progress_pct =
    target && target > 0 ? round(Math.max(0, total_pnl) / target, 4) : null;

  // Consistency: largest single day profit vs total profit
  let consistency_used_pct = null;
  let best_day_pnl = 0;
  const consistencyLimit = account.prop_consistency_pct ?? null;
  for (const [, dp] of dayMap) {
    if (dp > best_day_pnl) best_day_pnl = dp;
  }
  const best_day_pct_of_total = total_pnl > 0 ? round(best_day_pnl / total_pnl, 4) : null;
  if (consistencyLimit && total_pnl > 0) {
    consistency_used_pct = round((best_day_pnl / total_pnl) * 100 / consistencyLimit, 4);
  }

  // Largest single trade win/loss for loss-size rule
  let largest_single_win = 0;
  let largest_single_loss = 0;
  for (const r of rows) {
    const pnl = r.net_pnl || 0;
    if (pnl > largest_single_win) largest_single_win = pnl;
    if (pnl < largest_single_loss) largest_single_loss = pnl;
  }

  // Hold time analysis for min-hold-sec rule
  const minHoldSec = account.prop_min_hold_sec ?? null;
  const holdDeductPct = account.prop_hold_deduct_threshold_pct ?? null;
  let totalHoldSec = 0;
  let holdCount = 0;
  let subHoldCount = 0;
  let subHoldProfit = 0;
  for (const r of rows) {
    if (r.hold_time_sec != null) {
      totalHoldSec += r.hold_time_sec;
      holdCount++;
      if (minHoldSec != null && r.hold_time_sec < minHoldSec && (r.net_pnl || 0) > 0) {
        subHoldCount++;
        subHoldProfit += r.net_pnl || 0;
      }
    }
  }
  const avgHoldSec = holdCount > 0 ? round(totalHoldSec / holdCount, 1) : null;
  const avgHoldOk = minHoldSec != null && avgHoldSec != null ? avgHoldSec >= minHoldSec : null;

  // Time-to-first-close: duration from position open until the FIRST close event
  // (first partial close, or full close if no partials) — whichever happens first.
  const firstCloseRows = db
    .prepare(
      `SELECT entry_time,
              (SELECT MIN(e.exec_time) FROM executions e
                 WHERE e.trade_id = trades.id AND e.side = 'out') AS first_out
         FROM trades ${where}`
    )
    .all(params);
  let totalFirstCloseSec = 0;
  let firstCloseCount = 0;
  for (const r of firstCloseRows) {
    if (r.entry_time && r.first_out) {
      const sec = Math.round(
        (new Date(r.first_out).getTime() - new Date(r.entry_time).getTime()) / 1000
      );
      if (sec >= 0) {
        totalFirstCloseSec += sec;
        firstCloseCount++;
      }
    }
  }
  const avgFirstCloseSec = firstCloseCount > 0 ? round(totalFirstCloseSec / firstCloseCount, 1) : null;
  const avgFirstCloseOk =
    minHoldSec != null && avgFirstCloseSec != null ? avgFirstCloseSec >= minHoldSec : null;
  const subHoldPctOfProfit = total_pnl > 0 ? round(subHoldProfit / total_pnl, 4) : null;
  const subHoldAtRisk = holdDeductPct != null && subHoldPctOfProfit != null
    ? subHoldPctOfProfit * 100 >= holdDeductPct
    : false;

  // Safety buffer
  const safetyBufferPct = account.prop_safety_buffer_pct ?? null;
  const safetyBufferAmount = safetyBufferPct != null ? round(starting_balance * (safetyBufferPct / 100)) : null;
  const safetyBufferMet = safetyBufferAmount != null ? total_pnl >= safetyBufferAmount : null;

  // Inactivity
  const maxInactivityDays = account.prop_max_inactivity_days ?? null;
  const lastTradeDate = days.length ? days[days.length - 1] : null;
  let daysSinceLastTrade = null;
  if (lastTradeDate) {
    const now = new Date();
    const last = new Date(lastTradeDate + 'T00:00:00Z');
    daysSinceLastTrade = Math.floor((now - last) / 86400000);
  }

  // Trading days count for min-days rule
  const trading_days_count = dayMap.size;

  const breaches = [];
  if (day_loss_used_pct != null && day_loss_used_pct >= 1)
    breaches.push('daily_loss');
  if (max_dd_used_pct != null && max_dd_used_pct >= 1) breaches.push('max_dd');
  if (consistency_used_pct != null && consistency_used_pct >= 1)
    breaches.push('consistency');

  const statuses = [pctStatus(day_loss_used_pct), pctStatus(max_dd_used_pct)];
  if (consistency_used_pct != null) statuses.push(pctStatus(consistency_used_pct));
  const status = statuses.includes('breach')
    ? 'breach'
    : statuses.includes('warn')
      ? 'warn'
      : 'ok';

  return {
    account_id: account.id,
    currency: account.currency || 'USD',
    starting_balance: round(starting_balance),
    current_equity: round(current_equity),
    total_pnl: round(total_pnl),
    current_day: currentDay,
    day_pnl: round(day_pnl || 0),
    day_loss_limit,
    day_loss_used_pct,
    max_dd: round(max_dd),
    max_dd_limit,
    max_dd_used_pct,
    dd_type: ddType,
    target,
    target_progress_pct,
    phase: account.prop_phase || 0,
    total_phases: account.prop_plan ? (account.prop_phase || 0) : 0,
    min_trading_days: account.prop_min_days ?? null,
    trading_days_count,
    profit_split: account.prop_profit_split ?? null,
    news_window_min: account.prop_news_window_min ?? null,
    weekend_hold: account.prop_weekend_hold != null ? !!account.prop_weekend_hold : null,
    consistency_pct: consistencyLimit,
    consistency_used_pct,
    best_day_pnl: round(best_day_pnl),
    best_day_pct_of_total,
    largest_single_win: round(largest_single_win),
    largest_single_loss: round(largest_single_loss),
    prop_firm: account.prop_firm ?? null,
    prop_plan: account.prop_plan ?? null,
    min_hold_sec: minHoldSec,
    hold_deduct_threshold_pct: holdDeductPct,
    avg_hold_sec: avgHoldSec,
    avg_hold_ok: avgHoldOk,
    avg_first_close_sec: avgFirstCloseSec,
    avg_first_close_ok: avgFirstCloseOk,
    first_close_count: firstCloseCount,
    sub_hold_count: subHoldCount,
    sub_hold_profit: round(subHoldProfit),
    sub_hold_pct_of_profit: subHoldPctOfProfit,
    sub_hold_at_risk: subHoldAtRisk,
    safety_buffer_pct: safetyBufferPct,
    safety_buffer_amount: safetyBufferAmount,
    safety_buffer_met: safetyBufferMet,
    max_inactivity_days: maxInactivityDays,
    last_trade_date: lastTradeDate,
    days_since_last_trade: daysSinceLastTrade,
    breaches,
    status,
  };
}

// GET /api/stats/portfolio — roll-up propStats across all accounts.
// Ignores q.account (portfolio spans them all). Other filters pass through.
export function portfolio(q = {}) {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY id').all();
  const rest = { ...q };
  delete rest.account;
  const rows = accounts.map((a) => {
    const stats = propStats({ ...rest, account: a.id });
    return { name: a.name, broker: a.broker, ...stats };
  });
  const totals = rows.reduce(
    (acc, r) => {
      acc.total_pnl += r.total_pnl || 0;
      acc.day_pnl += r.day_pnl || 0;
      acc.current_equity += r.current_equity || 0;
      acc.max_dd += r.max_dd || 0;
      return acc;
    },
    { total_pnl: 0, day_pnl: 0, current_equity: 0, max_dd: 0 }
  );
  const rank = { ok: 0, warn: 1, breach: 2 };
  const worst = rows.reduce(
    (w, r) => (rank[r.status] > rank[w] ? r.status : w),
    'ok'
  );
  return {
    accounts: rows,
    account_count: rows.length,
    breach_count: rows.filter((r) => r.status === 'breach').length,
    warn_count: rows.filter((r) => r.status === 'warn').length,
    status: worst,
    total_pnl: round(totals.total_pnl),
    day_pnl: round(totals.day_pnl),
    current_equity: round(totals.current_equity),
    max_dd: round(totals.max_dd),
  };
}

// GET /api/stats/adherence — rule discipline.
// rules_followed % from notes, grade-tag distribution, avg P&L when rules
// were followed vs broken.
export function adherence(q) {
  const { where, params } = buildFilter(q);

  // One rules_followed verdict per trade (latest non-null note), + net_pnl.
  const rows = db
    .prepare(
      `SELECT t.net_pnl,
              (SELECT n.rules_followed FROM notes n
               WHERE n.trade_id = t.id AND n.rules_followed IS NOT NULL
               ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS rf
       FROM trades t ${where}`
    )
    .all(params);

  let followed = 0,
    broken = 0;
  let pnlFollowedSum = 0,
    pnlFollowedCount = 0,
    pnlBrokenSum = 0,
    pnlBrokenCount = 0;
  for (const r of rows) {
    if (r.rf == null) continue;
    if (r.rf === 1) {
      followed++;
      pnlFollowedSum += r.net_pnl || 0;
      pnlFollowedCount++;
    } else {
      broken++;
      pnlBrokenSum += r.net_pnl || 0;
      pnlBrokenCount++;
    }
  }
  const graded = followed + broken;

  // Grade-tag distribution (category = 'grade').
  const gradeRows = db
    .prepare(
      `SELECT tg.name AS grade, COUNT(*) AS trade_count, SUM(t.net_pnl) AS net_pnl
       FROM trades t
       JOIN trade_tags tt ON tt.trade_id = t.id
       JOIN tags tg ON tg.id = tt.tag_id AND tg.category = 'grade'
       ${where ? where + ' AND' : 'WHERE'} 1=1
       GROUP BY tg.name`
    )
    .all(params);
  const ORDER = ['A+', 'A', 'B', 'C', 'D', 'F'];
  const grades = gradeRows
    .map((g) => ({
      grade: g.grade,
      trade_count: g.trade_count,
      net_pnl: round(g.net_pnl || 0),
    }))
    .sort((a, b) => {
      const ia = ORDER.indexOf(a.grade);
      const ib = ORDER.indexOf(b.grade);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  return {
    rules_followed_pct: graded ? round(followed / graded, 4) : null,
    followed_count: followed,
    broken_count: broken,
    graded_count: graded,
    avg_pnl_followed: pnlFollowedCount
      ? round(pnlFollowedSum / pnlFollowedCount)
      : null,
    avg_pnl_broken: pnlBrokenCount ? round(pnlBrokenSum / pnlBrokenCount) : null,
    grades,
  };
}

// GET /api/stats/streaks — win/loss streaks + consistency + per-day table.
export function streaks(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(
      `SELECT COALESCE(exit_time, entry_time) AS t, net_pnl FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) ASC, id ASC`
    )
    .all(params);

  let curWin = 0,
    curLoss = 0,
    maxWin = 0,
    maxLoss = 0;
  const dayMap = new Map();
  for (const r of rows) {
    const n = r.net_pnl || 0;
    if (n > 0) {
      curWin++;
      curLoss = 0;
      if (curWin > maxWin) maxWin = curWin;
    } else if (n < 0) {
      curLoss++;
      curWin = 0;
      if (curLoss > maxLoss) maxLoss = curLoss;
    } else {
      curWin = 0;
      curLoss = 0;
    }
    const day = (r.t || '').slice(0, 10);
    if (day) {
      if (!dayMap.has(day)) dayMap.set(day, { net_pnl: 0, trade_count: 0 });
      const d = dayMap.get(day);
      d.net_pnl += n;
      d.trade_count++;
    }
  }

  const by_day = [...dayMap.entries()]
    .map(([day, d]) => ({
      day,
      net_pnl: round(d.net_pnl),
      trade_count: d.trade_count,
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const total_net = by_day.reduce((s, d) => s + d.net_pnl, 0);
  const best_day = by_day.reduce(
    (best, d) => (best == null || d.net_pnl > best.net_pnl ? d : best),
    null
  );
  const best_day_pct =
    best_day && total_net > 0 ? round(best_day.net_pnl / total_net, 4) : null;

  return {
    current_win_streak: curWin,
    current_loss_streak: curLoss,
    max_win_streak: maxWin,
    max_loss_streak: maxLoss,
    total_net: round(total_net),
    best_day: best_day ? best_day.day : null,
    best_day_net: best_day ? best_day.net_pnl : null,
    best_day_pct,
    trading_days: by_day.length,
    by_day,
  };
}

// GET /api/stats/tilt — revenge / rapid re-entry clusters.
// Flags a trade whose entry is <120s after the exit of a losing trade.
export function tilt(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(
      `SELECT instrument, entry_time, exit_time, net_pnl FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) ASC, id ASC`
    )
    .all(params);

  const GAP = 120; // seconds
  const events = [];
  const dayMap = new Map();
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if ((prev.net_pnl || 0) >= 0) continue;
    if (!prev.exit_time || !cur.entry_time) continue;
    const gap = Math.round(
      (new Date(cur.entry_time).getTime() - new Date(prev.exit_time).getTime()) /
        1000
    );
    if (gap < 0 || gap >= GAP) continue;
    events.push({
      time: cur.entry_time,
      instrument: cur.instrument,
      gap_sec: gap,
      pnl: round(cur.net_pnl || 0),
    });
    const day = cur.entry_time.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }

  const by_day = [...dayMap.entries()]
    .map(([day, count]) => ({ day, tilt_count: count }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const tilt_pnl = events.reduce((s, e) => s + e.pnl, 0);
  return {
    threshold_sec: GAP,
    count: events.length,
    tilt_pnl: round(tilt_pnl),
    events,
    by_day,
  };
}

// GET /api/stats/optimizer — sweep hypothetical (SL, TP) grid using MAE/MFE.
// For each trade with a stop_price + MAE + MFE, define risk_dist = |entry-stop|.
// Compute mae_r = mae/risk_dist, mfe_r = mfe/risk_dist. Then for each cell:
//   if mae_r >= sl_r: outcome = -sl_r  (stopped out)
//   else if mfe_r >= tp_r: outcome = +tp_r  (target hit)
//   else: outcome = realized r_multiple  (no exit rule matched → keep actual)
// Baseline is the sum of realized r_multiple over the same sample.
export function optimizer(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(
      `SELECT id, entry_price, stop_price, mae, mfe, r_multiple, net_pnl
       FROM trades ${where}`
    )
    .all(params);

  const sample = [];
  for (const t of rows) {
    if (
      t.entry_price == null ||
      t.stop_price == null ||
      t.mae == null ||
      t.mfe == null ||
      t.r_multiple == null
    )
      continue;
    const risk = Math.abs(t.entry_price - t.stop_price);
    if (risk <= 0) continue;
    sample.push({
      id: t.id,
      mae_r: t.mae / risk,
      mfe_r: t.mfe / risk,
      realized_r: t.r_multiple,
    });
  }

  const parseGrid = (v, fallback) => {
    if (!v) return fallback;
    const list = String(v)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return list.length ? list : fallback;
  };
  const sl_r = parseGrid(q.sl, [0.5, 0.75, 1, 1.25, 1.5, 2]);
  const tp_r = parseGrid(q.tp, [1, 1.5, 2, 2.5, 3, 4]);

  const cells = [];
  let best = null;
  for (const s of sl_r) {
    for (const t of tp_r) {
      let total_r = 0,
        wins = 0,
        losses = 0,
        breakeven = 0;
      for (const tr of sample) {
        let out;
        if (tr.mae_r >= s) out = -s;
        else if (tr.mfe_r >= t) out = t;
        else out = tr.realized_r;
        total_r += out;
        if (out > 0) wins++;
        else if (out < 0) losses++;
        else breakeven++;
      }
      const trades = sample.length;
      const cell = {
        sl_r: s,
        tp_r: t,
        trades,
        wins,
        losses,
        breakeven,
        total_r: round(total_r, 4),
        avg_r: trades ? round(total_r / trades, 4) : 0,
        win_rate: trades ? round(wins / trades, 4) : 0,
      };
      cells.push(cell);
      if (!best || cell.total_r > best.total_r) best = cell;
    }
  }

  const baseline_r = round(
    sample.reduce((s, t) => s + t.realized_r, 0),
    4
  );

  return {
    sample_size: sample.length,
    total_scanned: rows.length,
    sl_r,
    tp_r,
    cells,
    best,
    baseline_r,
    baseline_avg_r: sample.length ? round(baseline_r / sample.length, 4) : 0,
    uplift_r:
      best && sample.length ? round(best.total_r - baseline_r, 4) : null,
  };
}

// GET /api/stats/wick — edge breakdown of the structured wick-fill setup tags.
// Groups tagged trades by which liquidity was swept and by clean-vs-fakeout,
// so you can see which variant of the setup actually pays.
export function wickEdge(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(
      `SELECT w.swept_level, w.strat_session, w.fill_pct, w.fakeout,
              t.net_pnl, t.r_multiple
       FROM trades t JOIN trade_wick w ON w.trade_id = t.id
       ${where}`
    )
    .all(params);

  const bucket = (map, key) => {
    if (!map.has(key)) map.set(key, { count: 0, wins: 0, net: 0, rSum: 0, rN: 0, fillSum: 0, fillN: 0 });
    return map.get(key);
  };
  const tally = (g, r) => {
    g.count++;
    if ((r.net_pnl || 0) > 0) g.wins++;
    g.net += r.net_pnl || 0;
    if (r.r_multiple != null) { g.rSum += r.r_multiple; g.rN++; }
    if (r.fill_pct != null) { g.fillSum += r.fill_pct; g.fillN++; }
  };

  const byLevel = new Map();
  const bySession = new Map();
  const byFakeout = new Map();
  for (const r of rows) {
    tally(bucket(byLevel, r.swept_level || 'unset'), r);
    tally(bucket(bySession, r.strat_session || 'unset'), r);
    tally(bucket(byFakeout, r.fakeout === 1 ? 'fakeout' : r.fakeout === 0 ? 'clean' : 'unset'), r);
  }
  const toRows = (map) =>
    [...map.entries()]
      .map(([key, g]) => ({
        key,
        count: g.count,
        win_rate: g.count ? round(g.wins / g.count, 4) : 0,
        net_pnl: round(g.net),
        avg_r: g.rN ? round(g.rSum / g.rN, 4) : null,
        avg_fill: g.fillN ? round(g.fillSum / g.fillN, 1) : null,
      }))
      .sort((a, b) => b.net_pnl - a.net_pnl);

  return {
    total: rows.length,
    by_level: toRows(byLevel),
    by_session: toRows(bySession),
    by_fakeout: toRows(byFakeout),
  };
}

// --- Report Card ------------------------------------------------------------
// GET /api/stats/reportcard — the consolidated performance report every rival
// journal leads with, which we lacked: a composite Edge Score (Zella-style),
// drawdown analysis with an underwater curve, the R-multiple distribution, and
// a day-of-week breakdown. One pass over the filtered trades feeds all four.
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const R_BINS = [
  { max: -2, label: '≤ -2R' },
  { max: -1, label: '-2 to -1R' },
  { max: 0, label: '-1 to 0R' },
  { max: 1, label: '0 to 1R' },
  { max: 2, label: '1 to 2R' },
  { max: 3, label: '2 to 3R' },
  { max: Infinity, label: '≥ 3R' },
];

const clamp100 = (x) => Math.max(0, Math.min(100, x));

export function reportCard(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(
      `SELECT COALESCE(exit_time, entry_time) AS t, net_pnl, r_multiple
       FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) ASC, id ASC`
    )
    .all(params);

  const account = resolveAccount(q);
  const starting_balance = account?.starting_balance || 0;

  const n = rows.length;
  if (n === 0) {
    return { trade_count: 0, score: null, drawdown: null, r_distribution: [], by_dow: [], key: null };
  }

  // Single pass: cumulative equity + drawdown, streaks, day/DOW aggregation.
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let wins = 0,
    losses = 0,
    grossWin = 0,
    grossLoss = 0;
  let curWin = 0,
    curLoss = 0,
    maxConsecWin = 0,
    maxConsecLoss = 0;
  const rawSeries = [];
  const dayMap = new Map(); // 'YYYY-MM-DD' -> net
  const dowMap = new Map(); // 0..6 -> { net, count, wins }

  for (const r of rows) {
    const p = r.net_pnl || 0;
    cum += p;
    if (cum > peak) peak = cum;
    const dd = peak - cum; // >= 0
    if (dd > maxDd) maxDd = dd;
    rawSeries.push({ t: r.t, dd });

    if (p > 0) {
      wins++;
      grossWin += p;
      curWin++;
      curLoss = 0;
      if (curWin > maxConsecWin) maxConsecWin = curWin;
    } else if (p < 0) {
      losses++;
      grossLoss += p;
      curLoss++;
      curWin = 0;
      if (curLoss > maxConsecLoss) maxConsecLoss = curLoss;
    } else {
      curWin = 0;
      curLoss = 0;
    }

    const day = (r.t || '').slice(0, 10);
    if (day) dayMap.set(day, (dayMap.get(day) || 0) + p);
    if (r.t) {
      const d = new Date(r.t);
      if (!isNaN(d)) {
        const dow = d.getUTCDay();
        const g = dowMap.get(dow) || { net: 0, count: 0, wins: 0 };
        g.net += p;
        g.count++;
        if (p > 0) g.wins++;
        dowMap.set(dow, g);
      }
    }
  }

  const net_pnl = cum;
  const win_rate = n ? wins / n : 0;
  const profit_factor = grossLoss !== 0 ? grossWin / Math.abs(grossLoss) : null;
  const avg_win = wins ? grossWin / wins : 0;
  const avg_loss = losses ? grossLoss / losses : 0; // negative
  const payoff_ratio = avg_loss !== 0 ? avg_win / Math.abs(avg_loss) : null;
  const recovery_factor = maxDd > 0 ? net_pnl / maxDd : null;

  // Days for consistency + best/worst + averages.
  const days = [...dayMap.entries()].map(([day, net]) => ({ day, net: round(net) }));
  const trading_days = days.length;
  let best_day = null,
    worst_day = null;
  for (const d of days) {
    if (best_day == null || d.net > best_day.net) best_day = d;
    if (worst_day == null || d.net < worst_day.net) worst_day = d;
  }
  // Consistency: how little the single best day dominates total profit.
  const maxDayShare =
    net_pnl > 0 && best_day && best_day.net > 0 ? best_day.net / net_pnl : 1;
  const consistency = net_pnl > 0 ? clamp100((1 - maxDayShare) * 100) : 0;

  // --- Edge Score components (each 0-100), weighted ---
  const sWin = clamp100((win_rate / 0.6) * 100); // 60% win rate = full marks
  const sPf =
    profit_factor == null ? 100 : clamp100((profit_factor - 1) * 50 + 50); // PF 2 = 100, 1 = 50
  const sPayoff =
    payoff_ratio == null ? 100 : clamp100((payoff_ratio - 1) * 50 + 50); // 2:1 = 100
  const sRecovery =
    recovery_factor == null ? 100 : clamp100((recovery_factor / 3) * 100); // RF 3 = 100
  const sConsistency = consistency;

  const components = [
    { key: 'winrate', label: 'Win rate', weight: 0.2, score: round(sWin, 0), detail: formatPctRaw(win_rate) },
    { key: 'profit_factor', label: 'Profit factor', weight: 0.25, score: round(sPf, 0), detail: profit_factor == null ? '∞' : round(profit_factor, 2) },
    { key: 'payoff', label: 'Payoff (win/loss)', weight: 0.15, score: round(sPayoff, 0), detail: payoff_ratio == null ? '∞' : round(payoff_ratio, 2) },
    { key: 'recovery', label: 'Recovery factor', weight: 0.2, score: round(sRecovery, 0), detail: recovery_factor == null ? '∞' : round(recovery_factor, 2) },
    { key: 'consistency', label: 'Consistency', weight: 0.2, score: round(sConsistency, 0), detail: `${round(consistency, 0)}/100` },
  ];
  const total = components.reduce((acc, c) => acc + c.score * c.weight, 0);
  const grade = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : total >= 40 ? 'D' : 'F';
  const score = { total: round(total, 0), grade, components, reliable: n >= 20 };

  // --- Drawdown, with a downsampled underwater series (<=120 points) ---
  const peakEquity = starting_balance + peak;
  const max_dd_pct = peakEquity > 0 ? round(maxDd / peakEquity, 4) : null;
  const step = Math.max(1, Math.ceil(rawSeries.length / 120));
  const series = rawSeries
    .filter((_, i) => i % step === 0 || i === rawSeries.length - 1)
    .map((s) => ({ t: s.t, dd: -round(s.dd) })); // negative = underwater
  const drawdown = {
    max_dd: round(maxDd),
    max_dd_pct,
    recovery_factor: recovery_factor == null ? null : round(recovery_factor, 2),
    starting_balance,
    series,
  };

  // --- R-multiple distribution ---
  const rTrades = rows.filter((r) => r.r_multiple != null && !isNaN(r.r_multiple));
  const r_distribution = R_BINS.map((b) => ({ label: b.label, count: 0, net_pnl: 0 }));
  for (const r of rTrades) {
    const idx = R_BINS.findIndex((b) => r.r_multiple < b.max);
    const bin = idx === -1 ? r_distribution.length - 1 : idx;
    r_distribution[bin].count++;
    r_distribution[bin].net_pnl += r.net_pnl || 0;
  }
  for (const d of r_distribution) d.net_pnl = round(d.net_pnl);

  // --- Day-of-week (Mon..Sun order, only days that traded) ---
  const by_dow = [1, 2, 3, 4, 5, 6, 0]
    .filter((dow) => dowMap.has(dow))
    .map((dow) => {
      const g = dowMap.get(dow);
      return {
        dow,
        label: DOW_LABELS[dow],
        count: g.count,
        net_pnl: round(g.net),
        win_rate: g.count ? round(g.wins / g.count, 4) : 0,
      };
    });

  const key = {
    net_pnl: round(net_pnl),
    payoff_ratio: payoff_ratio == null ? null : round(payoff_ratio, 2),
    recovery_factor: recovery_factor == null ? null : round(recovery_factor, 2),
    max_consec_wins: maxConsecWin,
    max_consec_losses: maxConsecLoss,
    trading_days,
    avg_daily_pnl: trading_days ? round(net_pnl / trading_days) : 0,
    best_day,
    worst_day,
    r_sample: rTrades.length,
  };

  return { trade_count: n, score, drawdown, r_distribution, by_dow, key };
}

function formatPctRaw(x) {
  return x == null ? '—' : `${round(x * 100, 1)}%`;
}

// GET /api/stats/tags — P&L broken down by journal tag, per category. This is
// the Edgewonk-style "leak finder": which mistakes / emotions / grades actually
// cost (or make) money. Rows are sorted worst-first so leaks surface at the top.
// Joins trades -> trade_tags -> tags; buildFilter's WHERE applies to trades
// (its bare column names — account_id, instrument, session, is_backtest, exit_time
// — don't collide with the tags/trade_tags columns, so no alias is needed).
export function tagStats(q) {
  const { where, params } = buildFilter(q);
  const rows = db
    .prepare(
      `SELECT tags.category AS category, tags.name AS name,
              trades.net_pnl AS net_pnl, trades.r_multiple AS r_multiple
       FROM trades
       JOIN trade_tags ON trade_tags.trade_id = trades.id
       JOIN tags ON tags.id = trade_tags.tag_id
       ${where}`
    )
    .all(params);

  const groups = new Map(); // `${category} ${name}` -> agg
  for (const r of rows) {
    const k = `${r.category} ${r.name}`;
    let g = groups.get(k);
    if (!g) {
      g = { category: r.category, name: r.name, count: 0, wins: 0, net: 0, rSum: 0, rN: 0 };
      groups.set(k, g);
    }
    const p = r.net_pnl || 0;
    g.count++;
    if (p > 0) g.wins++;
    g.net += p;
    if (r.r_multiple != null && !isNaN(r.r_multiple)) {
      g.rSum += r.r_multiple;
      g.rN++;
    }
  }

  const byCategory = {};
  for (const g of groups.values()) {
    const cat = g.category || 'other';
    (byCategory[cat] ||= []).push({
      name: g.name,
      count: g.count,
      win_rate: g.count ? round(g.wins / g.count, 4) : 0,
      net_pnl: round(g.net),
      avg_r: g.rN ? round(g.rSum / g.rN, 4) : null,
    });
  }
  // Worst-first within each category so costly tags lead.
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => a.net_pnl - b.net_pnl);
  }

  return { total_tagged: rows.length, by_category: byCategory };
}

function round(n, dp = 2) {
  if (n === null || n === undefined || isNaN(n)) return n;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
