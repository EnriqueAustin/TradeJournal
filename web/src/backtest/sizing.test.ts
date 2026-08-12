import { describe, it, expect } from 'vitest';
import { computeSize, rMultiple } from './sizing';

describe('computeSize', () => {
  it('sizes so the stop distance risks the chosen % of balance', () => {
    const r = computeSize({ balance: 10000, riskPct: 1, entry: 2000, stop: 1990 });
    // risk $100, stop distance 10 → size 10
    expect(r.riskMoney).toBe(100);
    expect(r.riskPerUnit).toBe(10);
    expect(r.size).toBe(10);
  });

  it('applies pointValue to the per-unit risk', () => {
    const r = computeSize({ balance: 10000, riskPct: 2, entry: 100, stop: 98, pointValue: 5 });
    // risk $200, distance 2 × pv 5 = 10 → size 20
    expect(r.size).toBe(20);
  });

  it('returns size 0 when entry equals stop (no distance)', () => {
    const r = computeSize({ balance: 10000, riskPct: 1, entry: 100, stop: 100 });
    expect(r.size).toBe(0);
  });
});

describe('rMultiple', () => {
  it('is +1 when a long exits exactly at +1R', () => {
    expect(rMultiple('long', 2000, 2010, 1990)).toBe(1);
  });
  it('is -1 when a long is stopped out', () => {
    expect(rMultiple('long', 2000, 1990, 1990)).toBe(-1);
  });
  it('handles shorts (profit is downward)', () => {
    expect(rMultiple('short', 2000, 1980, 2010)).toBe(2);
  });
  it('is null without a stop', () => {
    expect(rMultiple('long', 2000, 2010, null)).toBeNull();
  });
});
