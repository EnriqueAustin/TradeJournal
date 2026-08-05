import { db } from './db.js';

// Build a WHERE clause + params from common query filters.
// Date range (from/to) applies to the realized date = date(exit_time).
// By default only real trades are included; opts.backtest selects the
// hypothetical (is_backtest=1) set, opts.backtest==='any' includes both.
export function buildFilter(q, opts = {}) {
  const clauses = [];
  const params = {};
  if (opts.backtest === true) {
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
      `SELECT COALESCE(exit_time, entry_time) AS t, net_pnl FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) ASC, id ASC`
    )
    .all(params);
  let cum = 0;
  return rows.map((r) => {
    cum += r.net_pnl || 0;
    return { t: r.t, cum_pnl: round(cum) };
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
      `SELECT COALESCE(exit_time, entry_time) AS t, net_pnl FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) ASC, id ASC`
    )
    .all(params);

  const starting_balance = account.starting_balance || 0;
  let cum = 0;
  let peak = 0; // peak equity delta above starting balance
  let max_dd = 0; // largest peak-to-trough drop in account currency
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

  // "Current day" = most recent trading day in the (filtered) data.
  const days = [...dayMap.keys()].sort();
  const currentDay = days.length ? days[days.length - 1] : null;
  const day_pnl = currentDay ? dayMap.get(currentDay) : 0;

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

  const breaches = [];
  if (day_loss_used_pct != null && day_loss_used_pct >= 1)
    breaches.push('daily_loss');
  if (max_dd_used_pct != null && max_dd_used_pct >= 1) breaches.push('max_dd');

  // Overall status: worst of the two loss-limit meters (target doesn't breach).
  const statuses = [pctStatus(day_loss_used_pct), pctStatus(max_dd_used_pct)];
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
    target,
    target_progress_pct,
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

function round(n, dp = 2) {
  if (n === null || n === undefined || isNaN(n)) return n;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
