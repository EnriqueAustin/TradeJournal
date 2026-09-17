import { describe, expect, it } from 'vitest';
import { mulberry32, percentileSorted, runMonteCarlo, type MCInput } from './monteCarlo';

const base: MCInput = {
  sample: [2, -1, -1, 1.5, -1, 3, -1, 0.5],
  mode: 'r',
  trades: 50,
  runs: 500,
  seed: 42,
  startBalance: 10000,
  riskPct: 1,
  compound: false,
  maxDd: 1000,
  ddType: 'static',
  dailyLoss: 500,
  tradesPerDay: 3,
  target: 800,
};

describe('monteCarlo', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toEqual(xs[0]);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('percentileSorted uses nearest rank', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileSorted(s, 0.5)).toBe(5);
    expect(percentileSorted(s, 0.95)).toBe(10);
    expect(percentileSorted(s, 0.05)).toBe(1);
  });

  it('same seed → identical result; fan starts at the balance and is ordered', () => {
    const r1 = runMonteCarlo(base);
    const r2 = runMonteCarlo(base);
    expect(r2).toEqual(r1);
    expect(r1.fan).toHaveLength(51);
    expect(r1.fan[0]).toMatchObject({ p5: 10000, p50: 10000, p95: 10000 });
    for (const f of r1.fan) {
      expect(f.p5).toBeLessThanOrEqual(f.p25);
      expect(f.p25).toBeLessThanOrEqual(f.p50);
      expect(f.p50).toBeLessThanOrEqual(f.p75);
      expect(f.p75).toBeLessThanOrEqual(f.p95);
    }
    expect(r1.pTargetBeforeBreach!).toBeLessThanOrEqual(r1.pTarget!);
    expect(r1.pBreachAny!).toBeGreaterThanOrEqual(Math.max(r1.pBreachDd!, r1.pBreachDaily!));
    expect(r1.maxDd.hist.reduce((s, h) => s + h.count, 0)).toBe(500);
  });

  it('all-losing sample always breaches and never profits', () => {
    const r = runMonteCarlo({ ...base, sample: [-1], trades: 20, runs: 50 });
    // 20 × -$100 = -$2000 → static DD 1000 hit; day of 3 = -$300 < 500 limit
    expect(r.pBreachDd).toBe(1);
    expect(r.pBreachDaily).toBe(0);
    expect(r.pProfit).toBe(0);
    expect(r.pTarget).toBe(0);
    expect(r.streak.p95).toBe(20);
    expect(r.maxDd.p50).toBeCloseTo(2000);
    expect(r.finalPnl.p50).toBeCloseTo(-2000);
  });

  it('usd mode uses the sample as $ directly; trailing DD measured from the peak', () => {
    // +600 then -600 forever alternating is impossible to force with bootstrap,
    // so use a single value: +100 each → never breaches, target hit at trade 8.
    const r = runMonteCarlo({ ...base, mode: 'usd', sample: [100], ddType: 'trailing', trades: 10, runs: 10 });
    expect(r.pBreachDd).toBe(0);
    expect(r.pTarget).toBe(1);
    expect(r.pTargetBeforeBreach).toBe(1);
    expect(r.finalPnl.p50).toBe(1000);
  });

  it('null limits report null probabilities', () => {
    const r = runMonteCarlo({ ...base, maxDd: null, dailyLoss: null, target: null, runs: 10 });
    expect(r.pBreachDd).toBeNull();
    expect(r.pBreachAny).toBeNull();
    expect(r.pTarget).toBeNull();
  });
});
