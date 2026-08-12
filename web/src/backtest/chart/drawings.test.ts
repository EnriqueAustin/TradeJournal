import { describe, it, expect } from 'vitest';
import {
  drawingSegments,
  hitTest,
  pointsNeeded,
  FIB_LEVELS,
  type Coords,
  type Drawing,
} from './drawings';

// Identity coordinates: time→x and price→y map 1:1 so geometry is easy to assert.
const coords: Coords = { W: 100, H: 100, toX: (t) => t, toY: (p) => p };

describe('pointsNeeded', () => {
  it('is 1 for h/v lines and 2 otherwise', () => {
    expect(pointsNeeded('hline')).toBe(1);
    expect(pointsNeeded('vline')).toBe(1);
    expect(pointsNeeded('trendline')).toBe(2);
    expect(pointsNeeded('fib')).toBe(2);
  });
});

describe('drawingSegments', () => {
  it('horizontal line spans the full width at the price', () => {
    const d: Drawing = { id: '1', type: 'hline', points: [{ time: 0, price: 40 }] };
    const [s] = drawingSegments(d, coords);
    expect(s).toMatchObject({ x1: 0, y1: 40, x2: 100, y2: 40 });
  });

  it('rectangle yields four edges', () => {
    const d: Drawing = { id: '2', type: 'rect', points: [{ time: 10, price: 20 }, { time: 40, price: 60 }] };
    expect(drawingSegments(d, coords)).toHaveLength(4);
  });

  it('fib emits one level per ratio with labels', () => {
    const d: Drawing = { id: '3', type: 'fib', points: [{ time: 0, price: 0 }, { time: 50, price: 100 }] };
    const segs = drawingSegments(d, coords);
    expect(segs).toHaveLength(FIB_LEVELS.length);
    // 0.5 level of a 0→100 range sits at price 50.
    expect(segs.some((s) => Math.round(s.y1) === 50)).toBe(true);
    expect(segs[0].label).toContain('%');
  });
});

describe('hitTest', () => {
  const line: Drawing = { id: '4', type: 'trendline', points: [{ time: 0, price: 0 }, { time: 100, price: 100 }] };
  it('hits a point on the line', () => {
    expect(hitTest(line, 50, 50, coords)).toBe(true);
  });
  it('misses a point far from the line', () => {
    expect(hitTest(line, 10, 90, coords)).toBe(false);
  });
});
