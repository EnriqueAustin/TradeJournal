// Bar-derived trade analytics: automatic MAE/MFE and "price after exit".
//
// Pure functions take a trade row and ascending OHLC bars ({ t, high, low,
// close }, t = bar-open ISO UTC) plus the bar span in ms. The loaders at the
// bottom take the db handle as an argument (no db.js import) so db.js can run
// the one-shot backfill from migrate() without a circular import.
//
// Semantics match stats.js: `mae` / `mfe` are POSITIVE PRICE DISTANCES from the
// entry price (adverse / favorable), not dollars and not R.
//
// Partial-bar approximation: a bar is used when its span overlaps the holding
// window, so the entry bar can contain movement from before the fill and the
// exit bar movement from after it. On M1 that can overstate MAE/MFE by up to a
// minute of range; on S5 by up to 5 seconds. S5 is preferred whenever it covers
// the whole trade. The realized exit move is always within the true excursion,
// so MFE/MAE are floored at it (keeps exit efficiency ≤ 1 even when mid-price
// bars didn't print the broker's fill).

export const EXIT_HORIZONS_MIN = [5, 15, 30, 60];
// How long after exit to keep walking bars for the hold-to-target check.
export const HOLD_HORIZON_MIN = 240;
// Max relative gap between a trade's fill price and the bar feed before the
// bars are judged to be a different price series (seed/demo rows, a broker
// CFD quoting far off the OANDA mid, a mis-mapped symbol). Broker-vs-mid spread
// and feed differences are well inside 0.5% for XAUUSD / US100.
export const PRICE_TOLERANCE = 0.005;

// Is `price` within tolerance of the [lo, hi] range the bars printed?
export function priceMatchesBars(price, lo, hi, tol = PRICE_TOLERANCE) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  return price >= lo * (1 - tol) && price <= hi * (1 + tol);
}

const toMs = (v) => {
  if (v == null) return NaN;
  return new Date(v).getTime();
};

const round = (n, dp = 4) => {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// Is this trade row usable for bar analytics at all? Rejects the corrupt
// entry_price=0 rows some broker exports produce, missing times, and inverted
// windows.
export function excursionEligible(t) {
  if (!t) return false;
  if (!(Number(t.entry_price) > 0)) return false;
  if (!(Number(t.exit_price) > 0)) return false;
  if (t.direction !== 'long' && t.direction !== 'short') return false;
  const e = toMs(t.entry_time);
  const x = toMs(t.exit_time);
  if (!Number.isFinite(e) || !Number.isFinite(x) || x < e) return false;
  return true;
}

// Do `bars` (span `spanMs`) cover the whole [entry, exit] window? Used to decide
// whether the fine S5 series can replace M1 for a trade.
export function barsCover(bars, spanMs, fromMs, toMsV) {
  if (!bars.length) return false;
  const first = toMs(bars[0].t);
  const last = toMs(bars[bars.length - 1].t);
  return first <= fromMs && last + spanMs >= toMsV;
}

// MAE/MFE for one trade from bars. Returns { mae, mfe, bars } (price distances,
// ≥ 0) or null when the trade is ineligible or no bar overlaps its window.
export function computeExcursion(trade, bars, spanMs = 60000) {
  if (!excursionEligible(trade) || !Array.isArray(bars)) return null;
  const entry = Number(trade.entry_price);
  const exit = Number(trade.exit_price);
  const eMs = toMs(trade.entry_time);
  const xMs = toMs(trade.exit_time);
  let hi = -Infinity;
  let lo = Infinity;
  let n = 0;
  for (const b of bars) {
    const bMs = toMs(b.t);
    if (!Number.isFinite(bMs)) continue;
    // Overlap test: bar [bMs, bMs+span) intersects [eMs, xMs].
    // A bar opening exactly at the exit instant is entirely post-exit (unless
    // the trade opened and closed in the same instant).
    if (bMs > xMs || (bMs === xMs && xMs > eMs) || bMs + spanMs <= eMs) continue;
    if (b.high > hi) hi = b.high;
    if (b.low < lo) lo = b.low;
    n++;
  }
  if (!n) return null;
  // Fills far outside what the bars printed → not the same price series.
  if (!priceMatchesBars(entry, lo, hi) || !priceMatchesBars(exit, lo, hi)) return null;
  const long = trade.direction === 'long';
  const realized = long ? exit - entry : entry - exit;
  let mfe = Math.max(0, long ? hi - entry : entry - lo);
  let mae = Math.max(0, long ? entry - lo : hi - entry);
  if (realized > 0) mfe = Math.max(mfe, realized);
  if (realized < 0) mae = Math.max(mae, -realized);
  return { mae: round(mae, 5), mfe: round(mfe, 5), bars: n };
}

// Cash per 1.0 price point for this trade (size × contract multiplier), from the
// realized P&L — same derivation computeRMultiple uses. null when unknowable.
export function cashPerPoint(t) {
  const move = Math.abs(Number(t.exit_price) - Number(t.entry_price));
  const g = Number(t.gross_pnl);
  if (move > 0 && Number.isFinite(g) && g !== 0) return Math.abs(g) / move;
  return null;
}

// Price distance that equals 1R for this trade, and whether it is a real stop
// ('stop') or backed out of a modeled R ('derived'). null when neither exists.
export function riskDistance(t) {
  const entry = Number(t.entry_price);
  if (t.stop_price != null) {
    const d = Math.abs(entry - Number(t.stop_price));
    if (d > 0) return { dist: d, kind: 'stop' };
  }
  // Derived R: riskCash = |net / R|; distance = riskCash / cashPerPoint.
  const cpp = cashPerPoint(t);
  const r = Number(t.r_multiple);
  const net = Number(t.net_pnl);
  if (cpp && Number.isFinite(r) && r !== 0 && Number.isFinite(net) && net !== 0) {
    const d = Math.abs(net / r) / cpp;
    if (d > 0) return { dist: d, kind: 'derived' };
  }
  return null;
}

// "Price after exit" for one trade. Only bars that open at or after the exit
// time are used, so the exit bar's pre-exit range never inflates the result (on
// M1 the first up-to-59s after exit are skipped; on S5 up to 4s).
//
// → {
//     trade_id, tf, exit_time, exit_price, cash_per_point, risk_dist, r_kind,
//     horizons: [{ minutes, move, move_usd, move_r, best, best_usd, best_r,
//                  adverse, adverse_r, complete }],
//     left_on_table: { price, usd, r } (best favorable move within the longest horizon),
//     continued_1r: bool|null,
//     hold_to_target: 'target'|'stop'|'neither'|'ambiguous'|'already'|null,
//   }  or null when ineligible / no post-exit bars.
export function computeExitAnalysis(trade, bars, spanMs = 60000, opts = {}) {
  if (!excursionEligible(trade) || !Array.isArray(bars)) return null;
  const horizons = opts.horizons || EXIT_HORIZONS_MIN;
  const holdMin = opts.holdHorizonMin ?? HOLD_HORIZON_MIN;
  const long = trade.direction === 'long';
  const dir = long ? 1 : -1;
  const exit = Number(trade.exit_price);
  const xMs = toMs(trade.exit_time);

  const after = [];
  for (const b of bars) {
    const bMs = toMs(b.t);
    if (!Number.isFinite(bMs) || bMs < xMs) continue;
    after.push({ ms: bMs, high: b.high, low: b.low, close: b.close });
  }
  after.sort((a, b) => a.ms - b.ms);
  if (!after.length) return null;
  // Nothing within the first horizon → the data doesn't really start at exit.
  if (after[0].ms - xMs > horizons[0] * 60000) return null;
  if (!priceMatchesBars(exit, after[0].low, after[0].high)) return null;

  const cpp = cashPerPoint(trade);
  const risk = riskDistance(trade);
  const usd = (p) => (cpp == null || p == null ? null : round(p * cpp, 2));
  const inR = (p) => (risk == null || p == null ? null : round(p / risk.dist, 3));
  const lastMs = after[after.length - 1].ms;

  const out = [];
  for (const m of horizons) {
    const endMs = xMs + m * 60000;
    let best = -Infinity;
    let adverse = -Infinity;
    let close = null;
    let n = 0;
    for (const b of after) {
      // Bar must finish within the horizon.
      if (b.ms + spanMs > endMs) break;
      const fav = long ? b.high - exit : exit - b.low;
      const adv = long ? exit - b.low : b.high - exit;
      if (fav > best) best = fav;
      if (adv > adverse) adverse = adv;
      close = b.close;
      n++;
    }
    if (!n) {
      out.push({ minutes: m, move: null, move_usd: null, move_r: null, best: null, best_usd: null, best_r: null, adverse: null, adverse_r: null, complete: false });
      continue;
    }
    const move = dir * (close - exit);
    const bestP = Math.max(0, best);
    const advP = Math.max(0, adverse);
    out.push({
      minutes: m,
      move: round(move, 5),
      move_usd: usd(move),
      move_r: inR(move),
      best: round(bestP, 5),
      best_usd: usd(bestP),
      best_r: inR(bestP),
      adverse: round(advP, 5),
      adverse_r: inR(advP),
      // False when the stored bars end before the horizon does.
      complete: lastMs + spanMs >= endMs,
    });
  }

  const longest = [...out].reverse().find((h) => h.best != null) || null;
  const left = longest
    ? { price: longest.best, usd: longest.best_usd, r: longest.best_r, minutes: longest.minutes }
    : { price: null, usd: null, r: null, minutes: null };
  const continued_1r = risk && longest ? longest.best >= risk.dist : null;

  return {
    trade_id: trade.id ?? null,
    exit_time: trade.exit_time,
    exit_price: exit,
    direction: trade.direction,
    session: trade.session ?? null,
    cash_per_point: cpp == null ? null : round(cpp, 4),
    risk_dist: risk ? round(risk.dist, 5) : null,
    r_kind: risk ? risk.kind : null,
    horizons: out,
    left_on_table: left,
    continued_1r,
    hold_to_target: holdToTarget(trade, after, spanMs, xMs + holdMin * 60000),
  };
}

// Had the trade been held from exit toward its target, which level would price
// have reached first (stop or target)? Walks post-exit bars up to `endMs`.
// 'already' = the exit was at/beyond target; 'ambiguous' = both touched within
// one bar; null = no stop or no target recorded.
export function holdToTarget(trade, after, spanMs, endMs) {
  if (trade.stop_price == null || trade.target_price == null) return null;
  const long = trade.direction === 'long';
  const exit = Number(trade.exit_price);
  const stop = Number(trade.stop_price);
  const target = Number(trade.target_price);
  if (long ? exit >= target : exit <= target) return 'already';
  // Exited beyond the stop (e.g. slippage): holding means already stopped.
  if (long ? exit <= stop : exit >= stop) return 'stop';
  for (const b of after) {
    if (b.ms + spanMs > endMs) break;
    const hitT = long ? b.high >= target : b.low <= target;
    const hitS = long ? b.low <= stop : b.high >= stop;
    if (hitT && hitS) return 'ambiguous';
    if (hitT) return 'target';
    if (hitS) return 'stop';
  }
  return 'neither';
}

// ---------------------------------------------------------------------------
// DB loaders (db handle passed in).
// ---------------------------------------------------------------------------

const SPAN = { S5: 5000, M1: 60000 };

function queryWindow(db, inst, tf, fromMs, toMsV) {
  return db
    .prepare(
      `SELECT t, open, high, low, close FROM price_bars
       WHERE instrument = ? AND tf = ? AND t >= ? AND t <= ? ORDER BY t ASC`
    )
    .all(inst, tf, new Date(fromMs).toISOString(), new Date(toMsV).toISOString());
}

// Finest stored bars covering [fromMs, toMs]: S5 when it covers the whole span,
// else M1. → { tf, span, bars }.
export function loadCoveringBars(db, instrument, fromMs, toMsV) {
  const s5 = queryWindow(db, instrument, 'S5', fromMs - SPAN.S5, toMsV);
  if (barsCover(s5, SPAN.S5, fromMs, toMsV)) return { tf: 'S5', span: SPAN.S5, bars: s5 };
  const m1 = queryWindow(db, instrument, 'M1', fromMs - SPAN.M1, toMsV);
  return { tf: 'M1', span: SPAN.M1, bars: m1 };
}

// Recompute and store auto MAE/MFE for the given trade rows. A value is written
// only when the column is null or was itself auto-derived (mae_auto/mfe_auto),
// so user-entered excursions are never overwritten. → number of trades updated.
export function refreshExcursions(db, trades, normalizeInstrument = (s) => s) {
  const upd = db.prepare(
    `UPDATE trades SET
       mae = CASE WHEN mae IS NULL OR mae_auto = 1 THEN @mae ELSE mae END,
       mae_auto = CASE WHEN mae IS NULL OR mae_auto = 1 THEN 1 ELSE mae_auto END,
       mfe = CASE WHEN mfe IS NULL OR mfe_auto = 1 THEN @mfe ELSE mfe END,
       mfe_auto = CASE WHEN mfe IS NULL OR mfe_auto = 1 THEN 1 ELSE mfe_auto END
     WHERE id = @id AND ((mae IS NULL OR mae_auto = 1) OR (mfe IS NULL OR mfe_auto = 1))`
  );
  const clear = db.prepare(
    `UPDATE trades SET
       mae = CASE WHEN mae_auto = 1 THEN NULL ELSE mae END,
       mfe = CASE WHEN mfe_auto = 1 THEN NULL ELSE mfe END,
       mae_auto = 0, mfe_auto = 0
     WHERE id = @id AND (mae_auto = 1 OR mfe_auto = 1)`
  );
  let n = 0;
  const run = db.transaction((list) => {
    for (const t of list) {
      if (!t || t.id == null) continue;
      if (!excursionEligible(t)) {
        if (t.mae_auto || t.mfe_auto) n += clear.run({ id: t.id }).changes;
        continue;
      }
      if (!(t.mae == null || t.mae_auto) && !(t.mfe == null || t.mfe_auto)) continue;
      const { span, bars } = loadCoveringBars(
        db,
        normalizeInstrument(t.instrument),
        toMs(t.entry_time),
        toMs(t.exit_time)
      );
      const ex = computeExcursion(t, bars, span);
      if (!ex) {
        // No longer derivable (e.g. an edited price no longer matches the bars):
        // drop stale auto values rather than keep a wrong number.
        if (t.mae_auto || t.mfe_auto) n += clear.run({ id: t.id }).changes;
        continue;
      }
      n += upd.run({ id: t.id, mae: ex.mae, mfe: ex.mfe }).changes;
    }
  });
  run(trades);
  return n;
}

// Load post-exit bars and run computeExitAnalysis for one trade row.
export function exitAnalysisFor(db, trade, normalizeInstrument = (s) => s, opts = {}) {
  if (!excursionEligible(trade)) return null;
  const horizons = opts.horizons || EXIT_HORIZONS_MIN;
  const holdMin = opts.holdHorizonMin ?? HOLD_HORIZON_MIN;
  const xMs = toMs(trade.exit_time);
  const endMs = xMs + Math.max(Math.max(...horizons), holdMin) * 60000;
  const inst = normalizeInstrument(trade.instrument);
  // S5 only if it covers the longest horizon; the hold check can fall short.
  const hEnd = xMs + Math.max(...horizons) * 60000;
  const s5 = queryWindow(db, inst, 'S5', xMs, endMs);
  let tf = 'S5';
  let span = SPAN.S5;
  let bars = s5;
  if (!barsCover(s5, SPAN.S5, xMs + SPAN.S5, hEnd - SPAN.S5)) {
    tf = 'M1';
    span = SPAN.M1;
    bars = queryWindow(db, inst, 'M1', xMs, endMs);
  }
  const res = computeExitAnalysis(trade, bars, span, opts);
  return res ? { ...res, tf } : null;
}
