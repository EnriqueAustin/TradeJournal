import { describe, it, expect } from 'vitest';
import { ReplayEngine, normalizeBars } from './engine';
import type { Bar } from '../types';

// Build a bar a `min` minutes past the epoch anchor with a given close.
function bar(min: number, close: number, extra: Partial<Bar> = {}): Bar {
  const t = new Date(Date.UTC(2024, 0, 1, 0, min)).toISOString();
  return { t, open: close, high: close, low: close, close, volume: 0, ...extra };
}

describe('normalizeBars', () => {
  it('sorts ascending and de-dupes equal timestamps (keeping the last)', () => {
    const out = normalizeBars([bar(2, 20), bar(0, 10), bar(1, 15), bar(1, 99)]);
    expect(out.map((b) => b.close)).toEqual([10, 99, 20]);
    expect(out.every((b, i) => i === 0 || b.sec > out[i - 1].sec)).toBe(true);
  });
});

describe('ReplayEngine cursor', () => {
  const bars = [bar(0, 10), bar(1, 11), bar(2, 12), bar(3, 13), bar(4, 14)];

  it('starts at index 0 with no start time', () => {
    const e = new ReplayEngine(bars);
    expect(e.index).toBe(0);
    expect(e.length).toBe(5);
    expect(e.currentBar()?.close).toBe(10);
  });

  it('step(1) advances exactly one bar', () => {
    const e = new ReplayEngine(bars);
    e.step(1);
    expect(e.index).toBe(1);
    e.step(1);
    expect(e.index).toBe(2);
  });

  it('clamps at the ends', () => {
    const e = new ReplayEngine(bars);
    e.step(-1);
    expect(e.index).toBe(0);
    e.seekIndex(99);
    expect(e.index).toBe(4);
    expect(e.atEnd).toBe(true);
  });

  it('seek(time) lands on the bar at/just before the time', () => {
    const e = new ReplayEngine(bars);
    const midSec = Math.floor(new Date(bar(2, 0).t).getTime() / 1000);
    e.seek(midSec);
    expect(e.index).toBe(2);
    e.seek(midSec + 30); // between bar 2 and 3
    expect(e.index).toBe(2);
  });

  it('emits each forward-crossed bar exactly once', () => {
    const e = new ReplayEngine(bars);
    const seen: number[] = [];
    e.onBar((b) => seen.push(b.close));
    e.seekIndex(3); // cross bars 1,2,3
    expect(seen).toEqual([11, 12, 13]);
  });

  it('starts at a given start time', () => {
    const startSec = Math.floor(new Date(bar(3, 0).t).getTime() / 1000);
    const e = new ReplayEngine(bars, startSec);
    expect(e.index).toBe(3);
  });
});
