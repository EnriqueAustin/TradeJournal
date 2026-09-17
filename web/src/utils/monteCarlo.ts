// Monte Carlo / risk-of-ruin over a trade sample (pure, worker-safe).
//
// Bootstrap-resamples the sample (R-multiples, or $ P&L as a fallback) with a
// seeded RNG so a given input always yields the same result, then measures the
// paths against prop-style limits: max drawdown (static or trailing), a daily
// loss proxy (trades grouped into days of `tradesPerDay`) and a profit target.

export interface MCInput {
  /** R-multiples (mode 'r') or $ P&L per trade (mode 'usd'). */
  sample: number[];
  mode: 'r' | 'usd';
  /** Trades simulated per run. */
  trades: number;
  runs: number;
  seed: number;
  startBalance: number;
  /** Risk per trade, % of balance (mode 'r' only). */
  riskPct: number;
  /** Size off current equity instead of the starting balance (mode 'r' only). */
  compound: boolean;
  /** Max drawdown limit in $ (null = none). */
  maxDd: number | null;
  ddType: 'static' | 'trailing';
  /** Daily loss limit in $ (null = none). */
  dailyLoss: number | null;
  tradesPerDay: number;
  /** Profit target in $ above the start (null = none). */
  target: number | null;
}

export interface FanPoint {
  step: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface MCResult {
  runs: number;
  trades: number;
  fan: FanPoint[];
  pBreachDd: number | null;
  pBreachDaily: number | null;
  pBreachAny: number | null;
  pTarget: number | null;
  pTargetBeforeBreach: number | null;
  pProfit: number;
  finalPnl: { p5: number; p50: number; p95: number };
  maxDd: { mean: number; p50: number; p95: number; hist: { from: number; to: number; count: number }[] };
  streak: { p50: number; p95: number; max: number };
}

/** mulberry32 — tiny, fast, seedable PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nearest-rank percentile of an ascending-sorted array (p in 0..1). */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[idx];
}

export function runMonteCarlo(input: MCInput): MCResult {
  const sample = input.sample.filter((x) => Number.isFinite(x));
  const N = Math.max(1, Math.floor(input.trades));
  const runs = Math.max(1, Math.floor(input.runs));
  const rng = mulberry32(input.seed);
  const start = input.startBalance;
  const riskFrac = input.riskPct / 100;
  const tpd = Math.max(1, Math.round(input.tradesPerDay));
  const cols = N + 1;
  const eq = new Float64Array(runs * cols);
  const maxDds = new Float64Array(runs);
  const streaks = new Float64Array(runs);
  const finals = new Float64Array(runs);
  let ddHits = 0,
    dailyHits = 0,
    anyHits = 0,
    targetHits = 0,
    targetFirst = 0,
    profits = 0;

  for (let r = 0; r < runs; r++) {
    let equity = start;
    let peak = start;
    let maxDd = 0;
    let streak = 0;
    let worstStreak = 0;
    let dayPnl = 0;
    let breachedDd = false;
    let breachedDaily = false;
    let hitTarget = false;
    let breachStep = Infinity;
    let targetStep = Infinity;
    eq[r * cols] = equity;
    for (let i = 1; i <= N; i++) {
      const x = sample.length ? sample[Math.floor(rng() * sample.length)] : 0;
      const pnl = input.mode === 'r' ? x * riskFrac * (input.compound ? equity : start) : x;
      equity += pnl;
      eq[r * cols + i] = equity;
      if (equity > peak) peak = equity;
      if (peak - equity > maxDd) maxDd = peak - equity;
      if (pnl < 0) {
        streak++;
        if (streak > worstStreak) worstStreak = streak;
      } else streak = 0;

      if (input.maxDd != null && !breachedDd) {
        const breach =
          input.ddType === 'trailing' ? peak - equity >= input.maxDd : start - equity >= input.maxDd;
        if (breach) {
          breachedDd = true;
          breachStep = Math.min(breachStep, i);
        }
      }
      dayPnl += pnl;
      if (input.dailyLoss != null && !breachedDaily && dayPnl <= -input.dailyLoss) {
        breachedDaily = true;
        breachStep = Math.min(breachStep, i);
      }
      if (i % tpd === 0) dayPnl = 0;
      if (input.target != null && !hitTarget && equity - start >= input.target) {
        hitTarget = true;
        targetStep = i;
      }
    }
    maxDds[r] = maxDd;
    streaks[r] = worstStreak;
    finals[r] = equity - start;
    if (breachedDd) ddHits++;
    if (breachedDaily) dailyHits++;
    if (breachedDd || breachedDaily) anyHits++;
    if (hitTarget) targetHits++;
    if (hitTarget && targetStep < breachStep) targetFirst++;
    if (equity > start) profits++;
  }

  const fan: FanPoint[] = [];
  const col = new Float64Array(runs);
  for (let i = 0; i < cols; i++) {
    for (let r = 0; r < runs; r++) col[r] = eq[r * cols + i];
    col.sort();
    fan.push({
      step: i,
      p5: percentileSorted(col, 0.05),
      p25: percentileSorted(col, 0.25),
      p50: percentileSorted(col, 0.5),
      p75: percentileSorted(col, 0.75),
      p95: percentileSorted(col, 0.95),
    });
  }

  maxDds.sort();
  streaks.sort();
  finals.sort();
  const ddMax = maxDds[runs - 1] || 0;
  const bins = 20;
  const width = ddMax > 0 ? ddMax / bins : 1;
  const hist = Array.from({ length: bins }, (_, b) => ({ from: b * width, to: (b + 1) * width, count: 0 }));
  let ddSum = 0;
  for (let r = 0; r < runs; r++) {
    ddSum += maxDds[r];
    hist[Math.min(bins - 1, Math.floor(maxDds[r] / width))].count++;
  }

  const frac = (n: number) => n / runs;
  return {
    runs,
    trades: N,
    fan,
    pBreachDd: input.maxDd != null ? frac(ddHits) : null,
    pBreachDaily: input.dailyLoss != null ? frac(dailyHits) : null,
    pBreachAny: input.maxDd != null || input.dailyLoss != null ? frac(anyHits) : null,
    pTarget: input.target != null ? frac(targetHits) : null,
    pTargetBeforeBreach: input.target != null ? frac(targetFirst) : null,
    pProfit: frac(profits),
    finalPnl: {
      p5: percentileSorted(finals, 0.05),
      p50: percentileSorted(finals, 0.5),
      p95: percentileSorted(finals, 0.95),
    },
    maxDd: {
      mean: ddSum / runs,
      p50: percentileSorted(maxDds, 0.5),
      p95: percentileSorted(maxDds, 0.95),
      hist,
    },
    streak: {
      p50: percentileSorted(streaks, 0.5),
      p95: percentileSorted(streaks, 0.95),
      max: streaks[runs - 1] || 0,
    },
  };
}
