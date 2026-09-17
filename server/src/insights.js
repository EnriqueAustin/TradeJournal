import { db } from './db.js';
import { buildFilter, exitStats } from './stats.js';

// Deterministic "coach" checks + the psychology breakdown. Everything here runs
// over plain trade rows so the logic is unit-testable without a database; the
// exported psychology()/insights() wrappers only load rows and hand them over.

export const EMOTIONS = ['calm', 'anxious', 'fomo', 'revenge', 'bored', 'confident'];

// Sample thresholds. An insight only fires when its sample clears these; a check
// that ran but fell short is reported as "low sample" instead of guessing.
export const INSIGHT_THRESHOLDS = {
  min_total: 10, // trades in the filtered set before any check runs
  min_group: 5, // trades per bucket (session, hour, side, setup, …)
  min_tagged: 3, // manual annotations (mistake tags, plan flag, emotion)
  min_days: 5, // trading days for the per-day checks
  after_loss_min: 30, // "tilt" window after a losing exit, minutes
};

const WINDOW_MS = INSIGHT_THRESHOLDS.after_loss_min * 60 * 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SESSION_NAMES = { asia: 'Asia', london: 'London', ny: 'New York', overlap: 'Overlap', off: 'Off-hours' };

const round = (n, dp = 2) => {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const ts = (iso) => (iso ? new Date(iso).getTime() : NaN);
const isWin = (t) => !t.is_be && (t.net_pnl || 0) > 0;
const isLoss = (t) => !t.is_be && (t.net_pnl || 0) < 0;

export function usd(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${v < 0 ? '-' : v > 0 ? '+' : ''}$${s}`;
}
const rStr = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`);
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

// Group aggregate: count, net, win rate (wins / all trades, like summary()),
// average net per trade and average R over the trades that have one.
export function agg(list) {
  let net = 0, wins = 0, losses = 0, rSum = 0, rN = 0;
  for (const t of list) {
    net += t.net_pnl || 0;
    if (isWin(t)) wins++;
    else if (isLoss(t)) losses++;
    if (t.r_multiple != null && Number.isFinite(t.r_multiple)) {
      rSum += t.r_multiple;
      rN++;
    }
  }
  const n = list.length;
  return {
    n,
    net_pnl: round(net),
    wins,
    losses,
    win_rate: n ? round(wins / n, 4) : null,
    avg_net: n ? round(net / n) : null,
    avg_r: rN ? round(rSum / rN, 3) : null,
  };
}

function groupBy(list, keyFn) {
  const m = new Map();
  for (const t of list) {
    const k = keyFn(t);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return m;
}

// Trades entered within `windowMs` after a losing trade's exit on the same
// account. Returns a Set of trade ids. O(n²) worst case, fine for a journal.
export function afterLossIds(rows, windowMs = WINDOW_MS) {
  const losers = rows
    .filter((t) => isLoss(t) && t.exit_time)
    .map((t) => ({ id: t.id, account_id: t.account_id, exit: ts(t.exit_time) }));
  const out = new Set();
  for (const t of rows) {
    const entry = ts(t.entry_time);
    if (!Number.isFinite(entry)) continue;
    for (const l of losers) {
      if (l.id === t.id || l.account_id !== t.account_id) continue;
      const gap = entry - l.exit;
      if (gap >= 0 && gap <= windowMs) {
        out.add(t.id);
        break;
      }
    }
  }
  return out;
}

// ---------- Psychology ----------
// P&L / win rate / avg R by pre-trade emotional state, confidence and post-trade
// satisfaction, plus "tilt after loss" (trades taken within 30 min of a loss).
export function computePsychology(rows) {
  const rated = rows.filter((t) => t.emotion || t.confidence != null || t.satisfaction != null);
  const byEmotion = groupBy(rows, (t) => t.emotion || null);
  const byConf = groupBy(rows, (t) => t.confidence ?? null);
  const bySat = groupBy(rows, (t) => t.satisfaction ?? null);
  const after = afterLossIds(rows);
  return {
    total: rows.length,
    rated: rated.length,
    by_emotion: EMOTIONS.filter((e) => byEmotion.has(e)).map((e) => ({ key: e, ...agg(byEmotion.get(e)) })),
    by_confidence: [1, 2, 3, 4, 5].filter((c) => byConf.has(c)).map((c) => ({ key: c, ...agg(byConf.get(c)) })),
    by_satisfaction: [1, 2, 3, 4, 5].filter((c) => bySat.has(c)).map((c) => ({ key: c, ...agg(bySat.get(c)) })),
    tilt_after_loss: {
      window_min: INSIGHT_THRESHOLDS.after_loss_min,
      after_loss: agg(rows.filter((t) => after.has(t.id))),
      other: agg(rows.filter((t) => !after.has(t.id))),
    },
  };
}

// ---------- Insights ----------
const SEV_RANK = { bad: 0, warn: 1, good: 2 };

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Run every check over the rows. ctx:
 *  - mistakes: Map<trade_id, {id,name}[]> (mistake-category tags)
 *  - setupNames: Map<setup_id, name>
 *  - exits: aggregateExits() result or null
 * Returns { insights, low_sample, thresholds, total }.
 */
export function computeInsights(rows, ctx = {}) {
  const T = INSIGHT_THRESHOLDS;
  const mistakes = ctx.mistakes || new Map();
  const setupNames = ctx.setupNames || new Map();
  const insights = [];
  const low = [];
  const add = (i) => insights.push({ link: null, impact: 0, ...i });
  const skip = (id, title, n, need) =>
    low.push({ id, title, sample_n: n, need, detail: `low sample (n=${n}, need ${need})` });

  const total = rows.length;
  if (total < T.min_total) {
    skip('all', 'Not enough trades for insights', total, T.min_total);
    return { total, insights, low_sample: low, thresholds: T };
  }
  const overall = agg(rows);

  // Worst / best bucket among groups that clear min_group (by avg net per trade).
  const bucketCheck = (groups, label) => {
    const ok = [...groups.entries()]
      .filter(([, l]) => l.length >= T.min_group)
      .map(([k, l]) => ({ key: k, ...agg(l) }));
    return { ok, largest: Math.max(0, ...[...groups.values()].map((l) => l.length)), label };
  };

  // 1+2. Sessions: worst and best.
  {
    const { ok, largest } = bucketCheck(groupBy(rows, (t) => t.session || null));
    if (ok.length < 2) skip('session', 'Session performance', largest, T.min_group);
    else {
      ok.sort((a, b) => a.avg_net - b.avg_net);
      const worst = ok[0];
      const best = ok[ok.length - 1];
      if (worst.net_pnl < 0)
        add({
          id: 'session_worst',
          severity: 'bad',
          title: `${SESSION_NAMES[worst.key] ?? worst.key} session is losing money`,
          detail: `${usd(worst.net_pnl)} over ${worst.n} trades (${usd(worst.avg_net)}/trade, win ${pct(worst.win_rate)}) vs ${SESSION_NAMES[best.key] ?? best.key} at ${usd(best.avg_net)}/trade.`,
          metric: { label: 'Net', value: worst.net_pnl, unit: 'usd' },
          sample_n: worst.n,
          impact: Math.abs(worst.net_pnl),
          link: { session: worst.key },
        });
      if (best.net_pnl > 0 && best.key !== worst.key)
        add({
          id: 'session_best',
          severity: 'good',
          title: `${SESSION_NAMES[best.key] ?? best.key} is your best session`,
          detail: `${usd(best.net_pnl)} over ${best.n} trades, ${usd(best.avg_net)}/trade, win ${pct(best.win_rate)}${best.avg_r != null ? `, avg ${rStr(best.avg_r)}` : ''}.`,
          metric: { label: 'Net', value: best.net_pnl, unit: 'usd' },
          sample_n: best.n,
          impact: Math.abs(best.net_pnl),
          link: { session: best.key },
        });
    }
  }

  // 3. Worst entry hour (UTC).
  {
    const { ok, largest } = bucketCheck(
      groupBy(rows, (t) => (t.entry_time ? new Date(t.entry_time).getUTCHours() : null))
    );
    if (!ok.length) skip('hour_worst', 'Worst hour of day', largest, T.min_group);
    else {
      ok.sort((a, b) => a.net_pnl - b.net_pnl);
      const w = ok[0];
      if (w.net_pnl < 0)
        add({
          id: 'hour_worst',
          severity: w.avg_net < (overall.avg_net ?? 0) ? 'bad' : 'warn',
          title: `${String(w.key).padStart(2, '0')}:00 UTC is your worst hour`,
          detail: `${usd(w.net_pnl)} across ${w.n} trades entered in that hour (win ${pct(w.win_rate)}).`,
          metric: { label: 'Net', value: w.net_pnl, unit: 'usd' },
          sample_n: w.n,
          impact: Math.abs(w.net_pnl),
          link: { hour: w.key },
        });
    }
  }

  // 4. Revenge: trades within 30 min after a loss vs the rest.
  {
    const ids = afterLossIds(rows);
    const after = agg(rows.filter((t) => ids.has(t.id)));
    const rest = agg(rows.filter((t) => !ids.has(t.id)));
    if (after.n < T.min_group) skip('after_loss', 'Trading after a loss', after.n, T.min_group);
    else {
      const worse = after.avg_net < rest.avg_net;
      add({
        id: 'after_loss',
        severity: worse ? (after.net_pnl < 0 ? 'bad' : 'warn') : 'good',
        title: worse
          ? `Trades within ${T.after_loss_min} min of a loss underperform`
          : `You stay composed after losses`,
        detail: `${after.n} trades taken ≤${T.after_loss_min} min after a losing exit: ${usd(after.avg_net)}/trade, win ${pct(after.win_rate)} vs ${usd(rest.avg_net)}/trade otherwise.`,
        metric: { label: 'Avg/trade', value: after.avg_net, unit: 'usd' },
        sample_n: after.n,
        impact: worse ? Math.abs(after.net_pnl) : 0,
        link: { after_loss: 1 },
      });
    }
  }

  // Per-day sequences (by account + UTC day of entry), used by 5 and 6.
  const days = groupBy(rows, (t) => (t.entry_time ? `${t.account_id}|${t.entry_time.slice(0, 10)}` : null));
  for (const l of days.values()) l.sort((a, b) => ts(a.entry_time) - ts(b.entry_time));

  // 5. Nth trade of the day decay: 1st–2nd vs 3rd+.
  {
    const early = [], late = [];
    for (const l of days.values()) l.forEach((t, i) => (i < 2 ? early : late).push(t));
    const e = agg(early), la = agg(late);
    if (la.n < T.min_group) skip('nth_trade', '3rd+ trade of the day', la.n, T.min_group);
    else if (la.avg_net < e.avg_net)
      add({
        id: 'nth_trade',
        severity: la.net_pnl < 0 ? 'bad' : 'warn',
        title: 'Performance decays after your 2nd trade of the day',
        detail: `3rd+ trades: ${usd(la.avg_net)}/trade, win ${pct(la.win_rate)} (${la.n}) vs first two: ${usd(e.avg_net)}/trade (${e.n}).`,
        metric: { label: '3rd+ avg/trade', value: la.avg_net, unit: 'usd' },
        sample_n: la.n,
        impact: Math.abs(Math.min(0, la.net_pnl)),
      });
    else
      add({
        id: 'nth_trade',
        severity: 'good',
        title: 'Later trades in the day hold up',
        detail: `3rd+ trades: ${usd(la.avg_net)}/trade (${la.n}) vs first two: ${usd(e.avg_net)}/trade.`,
        metric: { label: '3rd+ avg', value: la.avg_net, unit: 'usd' },
        sample_n: la.n,
      });
  }

  // 6. Overtrading days: more trades than usual (> max(1.5×median, median+2)).
  {
    const list = [...days.values()];
    if (list.length < T.min_days) skip('overtrading', 'Overtrading days', list.length, T.min_days);
    else {
      const med = median(list.map((l) => l.length));
      const cut = Math.max(med * 1.5, med + 2);
      const heavy = list.filter((l) => l.length > cut);
      const normal = list.filter((l) => l.length <= cut);
      const dayNet = (l) => l.reduce((s, t) => s + (t.net_pnl || 0), 0);
      if (heavy.length < 2) skip('overtrading', 'Overtrading days', heavy.length, 2);
      else {
        const hAvg = heavy.reduce((s, l) => s + dayNet(l), 0) / heavy.length;
        const nAvg = normal.length ? normal.reduce((s, l) => s + dayNet(l), 0) / normal.length : 0;
        const tradesN = heavy.reduce((s, l) => s + l.length, 0);
        if (hAvg < nAvg)
          add({
            id: 'overtrading',
            severity: hAvg < 0 ? 'bad' : 'warn',
            title: 'Overtrading days cost you',
            detail: `${heavy.length} days with more than ${Math.floor(cut)} trades (usual ${med}) averaged ${usd(hAvg)}/day vs ${usd(nAvg)}/day on normal days.`,
            metric: { label: 'Avg heavy day', value: round(hAvg), unit: 'usd' },
            sample_n: tradesN,
            impact: Math.abs(Math.min(0, hAvg * heavy.length)),
          });
      }
    }
  }

  // 7. Hold-time asymmetry: holding losers longer than winners.
  {
    const w = rows.filter((t) => isWin(t) && t.hold_time_sec != null);
    const l = rows.filter((t) => isLoss(t) && t.hold_time_sec != null);
    const n = Math.min(w.length, l.length);
    if (n < T.min_group) skip('hold_asymmetry', 'Hold time winners vs losers', n, T.min_group);
    else {
      // Medians: one position held over a weekend would swamp a mean.
      const aw = median(w.map((t) => t.hold_time_sec));
      const al = median(l.map((t) => t.hold_time_sec));
      const mins = (s) => (s >= 5400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 60).toFixed(1)}m`);
      const ratio = aw > 0 ? al / aw : null;
      if (ratio != null && ratio >= 1.5)
        add({
          id: 'hold_asymmetry',
          severity: 'warn',
          title: 'You hold losers longer than winners',
          detail: `Median loser held ${mins(al)} vs ${mins(aw)} for winners (${ratio.toFixed(1)}×) — cutting winners early or hoping on losers.`,
          metric: { label: 'Loser/winner hold', value: round(ratio, 2), unit: 'x' },
          sample_n: w.length + l.length,
          link: { outcome: 'loss' },
        });
      else if (ratio != null && ratio <= 0.8)
        add({
          id: 'hold_asymmetry',
          severity: 'good',
          title: 'You cut losers faster than winners',
          detail: `Losers held ${mins(al)} vs ${mins(aw)} for winners.`,
          metric: { label: 'Loser/winner hold', value: round(ratio, 2), unit: 'x' },
          sample_n: w.length + l.length,
        });
    }
  }

  // 8. Long vs short asymmetry.
  {
    const L = agg(rows.filter((t) => t.direction === 'long'));
    const S = agg(rows.filter((t) => t.direction === 'short'));
    const n = Math.min(L.n, S.n);
    if (n < T.min_group) skip('direction', 'Long vs short', n, T.min_group);
    else {
      const [bad, good, badKey] = L.avg_net < S.avg_net ? [L, S, 'long'] : [S, L, 'short'];
      if (bad.net_pnl < 0 || good.avg_net - bad.avg_net > Math.abs(overall.avg_net ?? 0))
        add({
          id: 'direction',
          severity: bad.net_pnl < 0 ? 'bad' : 'warn',
          title: `Your ${badKey}s lag your ${badKey === 'long' ? 'shorts' : 'longs'}`,
          detail: `${badKey === 'long' ? 'Longs' : 'Shorts'}: ${usd(bad.net_pnl)} (${bad.n}, ${usd(bad.avg_net)}/trade, win ${pct(bad.win_rate)}) vs ${usd(good.net_pnl)} (${good.n}, ${usd(good.avg_net)}/trade).`,
          metric: { label: 'Net', value: bad.net_pnl, unit: 'usd' },
          sample_n: bad.n,
          impact: Math.abs(Math.min(0, bad.net_pnl)),
          link: { direction: badKey },
        });
    }
  }

  // 9. Instrument asymmetry.
  {
    const { ok, largest } = bucketCheck(groupBy(rows, (t) => t.instrument || null));
    if (ok.length < 2) skip('instrument', 'Instrument comparison', ok.length ? ok[0].n : largest, T.min_group);
    else {
      ok.sort((a, b) => a.avg_net - b.avg_net);
      const w = ok[0], b = ok[ok.length - 1];
      if (w.net_pnl < 0)
        add({
          id: 'instrument',
          severity: 'bad',
          title: `${w.key} is dragging your results`,
          detail: `${w.key}: ${usd(w.net_pnl)} over ${w.n} trades (${usd(w.avg_net)}/trade) vs ${b.key}: ${usd(b.net_pnl)} (${b.n}).`,
          metric: { label: 'Net', value: w.net_pnl, unit: 'usd' },
          sample_n: w.n,
          impact: Math.abs(w.net_pnl),
          link: { instrument: w.key },
        });
    }
  }

  // 10. Setup with negative expectancy.
  {
    const groups = groupBy(rows, (t) => t.setup_id ?? null);
    const { ok, largest } = bucketCheck(groups);
    if (!ok.length) skip('setup_negative', 'Setup expectancy', largest, T.min_group);
    else {
      const neg = ok.filter((g) => g.avg_net < 0).sort((a, b) => a.net_pnl - b.net_pnl);
      if (neg.length) {
        const g = neg[0];
        const name = setupNames.get(g.key) ?? `Setup #${g.key}`;
        add({
          id: 'setup_negative',
          severity: 'bad',
          title: `"${name}" has negative expectancy`,
          detail: `${usd(g.avg_net)}/trade over ${g.n} trades (${usd(g.net_pnl)} total, win ${pct(g.win_rate)}${g.avg_r != null ? `, avg ${rStr(g.avg_r)}` : ''}).`,
          metric: { label: 'Expectancy', value: g.avg_net, unit: 'usd' },
          sample_n: g.n,
          impact: Math.abs(g.net_pnl),
          link: { setup: g.key },
        });
      }
    }
  }

  // 11. Costliest mistake tag.
  {
    const byTag = new Map();
    for (const t of rows)
      for (const m of mistakes.get(t.id) || []) {
        if (!byTag.has(m.id)) byTag.set(m.id, { tag: m, list: [] });
        byTag.get(m.id).list.push(t);
      }
    const ok = [...byTag.values()].filter((g) => g.list.length >= T.min_tagged);
    if (!ok.length)
      skip('mistake_cost', 'Costliest mistake', Math.max(0, ...[...byTag.values()].map((g) => g.list.length)), T.min_tagged);
    else {
      const scored = ok.map((g) => ({ ...g, a: agg(g.list) })).sort((x, y) => x.a.net_pnl - y.a.net_pnl);
      const top = scored[0];
      if (top.a.net_pnl < 0)
        add({
          id: 'mistake_cost',
          severity: 'bad',
          title: `"${top.tag.name}" is your costliest mistake`,
          detail: `${usd(top.a.net_pnl)} across ${top.a.n} tagged trades (${usd(top.a.avg_net)}/trade).`,
          metric: { label: 'Cost', value: top.a.net_pnl, unit: 'usd' },
          sample_n: top.a.n,
          impact: Math.abs(top.a.net_pnl),
          link: { tag: top.tag.id },
        });
    }
  }

  // 12. Followed vs broke plan.
  {
    const f = agg(rows.filter((t) => t.followed_plan === 1));
    const b = agg(rows.filter((t) => t.followed_plan === 0));
    const n = Math.min(f.n, b.n);
    if (n < T.min_tagged) skip('plan_delta', 'Followed vs broke plan', n, T.min_tagged);
    else {
      const delta = f.avg_net - b.avg_net;
      add({
        id: 'plan_delta',
        severity: delta > 0 ? (b.net_pnl < 0 ? 'bad' : 'warn') : 'good',
        title: delta > 0 ? 'Breaking your plan costs you' : 'Plan breaks are not hurting (yet)',
        detail: `Broke plan: ${usd(b.avg_net)}/trade over ${b.n} (${usd(b.net_pnl)}) vs followed: ${usd(f.avg_net)}/trade over ${f.n}.`,
        metric: { label: 'Delta/trade', value: round(delta), unit: 'usd' },
        sample_n: b.n + f.n,
        impact: delta > 0 ? Math.abs(Math.min(0, b.net_pnl)) + delta * b.n : 0,
        link: { followed: 0 },
      });
    }
  }

  // 13. Exit left on table (from stored-bar exit analysis).
  {
    const ex = ctx.exits;
    const n = ex?.sample ?? 0;
    if (n < T.min_group) skip('exit_left', 'Money left on the table', n, T.min_group);
    else {
      const leftR = ex.avg_left_r;
      const cont = ex.continued_1r_pct;
      if ((leftR != null && leftR >= 0.5) || (cont != null && cont >= 0.4))
        add({
          id: 'exit_left',
          severity: 'warn',
          title: 'You exit early — price keeps going',
          detail: `After exit, price ran a further ${leftR != null ? rStr(leftR) : usd(ex.avg_left_usd)} on average${cont != null ? `; ${pct(cont)} of trades continued ≥1R` : ''} (${n} trades with bars).`,
          metric: leftR != null ? { label: 'Avg left', value: leftR, unit: 'r' } : { label: 'Avg left', value: ex.avg_left_usd, unit: 'usd' },
          sample_n: n,
          impact: Math.abs((ex.avg_left_usd || 0) * n) / 2,
        });
      else
        add({
          id: 'exit_left',
          severity: 'good',
          title: 'Your exits capture most of the move',
          detail: `Average post-exit run ${leftR != null ? rStr(leftR) : usd(ex.avg_left_usd)} over ${n} trades.`,
          metric: leftR != null ? { label: 'Avg left', value: leftR, unit: 'r' } : { label: 'Avg left', value: ex.avg_left_usd, unit: 'usd' },
          sample_n: n,
        });
    }
  }

  // 14. Stop-less trades.
  {
    const none = rows.filter((t) => t.stop_price == null);
    const share = none.length / total;
    if (share >= 0.3) {
      const a = agg(none);
      add({
        id: 'stopless',
        severity: share >= 0.6 ? 'bad' : 'warn',
        title: `${pct(share)} of trades have no stop recorded`,
        detail: `${none.length} of ${total} trades have no stop — R is modeled, not real. Their net: ${usd(a.net_pnl)}. Set the stop you actually used.`,
        metric: { label: 'Stop-less', value: round(share, 4), unit: 'pct' },
        sample_n: none.length,
        impact: Math.abs(Math.min(0, a.net_pnl)),
        link: { needs: 'stop' },
      });
    }
  }

  // 15. Worst weekday.
  {
    const { ok, largest } = bucketCheck(
      groupBy(rows, (t) => (t.entry_time ? new Date(t.entry_time).getUTCDay() : null))
    );
    if (ok.length < 2) skip('weekday_worst', 'Worst weekday', largest, T.min_group);
    else {
      ok.sort((a, b) => a.net_pnl - b.net_pnl);
      const w = ok[0];
      if (w.net_pnl < 0)
        add({
          id: 'weekday_worst',
          severity: 'warn',
          title: `${DOW[w.key]} is your worst day`,
          detail: `${usd(w.net_pnl)} over ${w.n} trades (${usd(w.avg_net)}/trade, win ${pct(w.win_rate)}).`,
          metric: { label: 'Net', value: w.net_pnl, unit: 'usd' },
          sample_n: w.n,
          impact: Math.abs(w.net_pnl),
          link: { dow: w.key },
        });
    }
  }

  // 16. Worst emotional state.
  {
    const groups = groupBy(rows, (t) => t.emotion || null);
    const ok = [...groups.entries()]
      .filter(([, l]) => l.length >= T.min_tagged)
      .map(([k, l]) => ({ key: k, ...agg(l) }));
    if (!ok.length)
      skip('emotion_worst', 'Emotional state', Math.max(0, ...[...groups.values()].map((l) => l.length)), T.min_tagged);
    else {
      ok.sort((a, b) => a.avg_net - b.avg_net);
      const w = ok[0];
      if (w.net_pnl < 0)
        add({
          id: 'emotion_worst',
          severity: 'bad',
          title: `Trading while ${w.key} loses money`,
          detail: `${usd(w.net_pnl)} over ${w.n} trades rated "${w.key}" (${usd(w.avg_net)}/trade, win ${pct(w.win_rate)}).`,
          metric: { label: 'Net', value: w.net_pnl, unit: 'usd' },
          sample_n: w.n,
          impact: Math.abs(w.net_pnl),
          link: { emotion: w.key },
        });
    }
  }

  // 17. Big-loss outliers: the worst 10% of losers (min 1) vs total loss.
  {
    const losers = rows.filter(isLoss).sort((a, b) => a.net_pnl - b.net_pnl);
    if (losers.length < 10) skip('big_losses', 'Outsized losses', losers.length, 10);
    else {
      const k = Math.max(1, Math.round(losers.length * 0.1));
      const totalLoss = losers.reduce((s, t) => s + t.net_pnl, 0);
      const topLoss = losers.slice(0, k).reduce((s, t) => s + t.net_pnl, 0);
      const share = totalLoss ? topLoss / totalLoss : 0;
      if (share >= 0.3)
        add({
          id: 'big_losses',
          severity: share >= 0.45 ? 'bad' : 'warn',
          title: `${k} outsized loss${k === 1 ? '' : 'es'} = ${pct(share)} of all losses`,
          detail: `Your worst ${k} of ${losers.length} losing trades total ${usd(topLoss)} of ${usd(totalLoss)} lost. Cap the downside per trade.`,
          metric: { label: 'Share', value: round(share, 4), unit: 'pct' },
          sample_n: losers.length,
          impact: Math.abs(topLoss),
          link: { outcome: 'loss', sort: 'net_pnl', dir: 'asc' },
        });
    }
  }

  insights.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (b.impact || 0) - (a.impact || 0));
  return { total, insights, low_sample: low, thresholds: T };
}

// ---------- DB wrappers ----------
function loadRows(q) {
  const { where, params } = buildFilter(q);
  return db
    .prepare(
      `SELECT trades.id, trades.account_id, trades.instrument, trades.direction,
              trades.entry_time, trades.exit_time, trades.net_pnl, trades.r_multiple,
              trades.is_be, trades.session, trades.hold_time_sec, trades.stop_price,
              trades.setup_id, trades.followed_plan,
              p.emotion, p.confidence, p.satisfaction
       FROM trades LEFT JOIN trade_psych p ON p.trade_id = trades.id
       ${where}
       ORDER BY trades.entry_time`
    )
    .all(params);
}

export function psychology(q) {
  return computePsychology(loadRows(q));
}

export function insights(q, opts = {}) {
  const rows = loadRows(q);
  const ids = new Set(rows.map((r) => r.id));
  const mistakes = new Map();
  for (const m of db
    .prepare(
      `SELECT tt.trade_id, tg.id, tg.name FROM trade_tags tt
       JOIN tags tg ON tg.id = tt.tag_id WHERE tg.category = 'mistake'`
    )
    .all()) {
    if (!ids.has(m.trade_id)) continue;
    if (!mistakes.has(m.trade_id)) mistakes.set(m.trade_id, []);
    mistakes.get(m.trade_id).push({ id: m.id, name: m.name });
  }
  const setupNames = new Map(db.prepare('SELECT id, name FROM setups').all().map((s) => [s.id, s.name]));
  let exits = null;
  if (opts.exits !== false && rows.length >= INSIGHT_THRESHOLDS.min_total) {
    try {
      const { trades: _t, ...rest } = exitStats(q);
      exits = rest;
    } catch {
      exits = null;
    }
  }
  return computeInsights(rows, { mistakes, setupNames, exits });
}
