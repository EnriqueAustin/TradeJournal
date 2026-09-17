import { describe, expect, it } from 'vitest';
import { defaultLayout, mergeLayout, moveWidget, stepWidget, layoutStorageKey } from './layout';

const defs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd', defaultHidden: true }];

describe('dashboard layout', () => {
  it('defaults to registry order with defaultHidden applied', () => {
    expect(defaultLayout(defs)).toEqual({ order: ['a', 'b', 'c', 'd'], hidden: ['d'], wide: [] });
  });

  it('falls back to default for junk', () => {
    expect(mergeLayout(null, defs)).toEqual(defaultLayout(defs));
    expect(mergeLayout({ order: 'x' }, defs)).toEqual(defaultLayout(defs));
    expect(mergeLayout({ order: ['zzz'] }, defs)).toEqual(defaultLayout(defs));
  });

  it('drops unknown ids, dedupes, and slots new widgets after their neighbour', () => {
    const merged = mergeLayout({ order: ['c', 'a', 'a', 'gone'], hidden: ['a', 'gone'], wide: ['c', 'gone'] }, defs);
    // b follows a (its default predecessor); d follows c.
    expect(merged.order).toEqual(['c', 'd', 'a', 'b']);
    expect(merged.hidden).toEqual(['a', 'd']);
    expect(merged.wide).toEqual(['c']);
  });

  it('moves and steps widgets, skipping hidden ones', () => {
    const s = { order: ['a', 'b', 'c', 'd'], hidden: ['b'], wide: [] };
    expect(moveWidget(s, 'd', 'a').order).toEqual(['d', 'a', 'b', 'c']);
    expect(moveWidget(s, 'a', 'c', true).order).toEqual(['b', 'c', 'a', 'd']);
    expect(stepWidget(s, 'c', -1).order).toEqual(['c', 'a', 'b', 'd']);
    expect(stepWidget(s, 'a', 1).order).toEqual(['b', 'c', 'a', 'd']);
    expect(stepWidget(s, 'a', -1)).toBe(s);
  });

  it('keys storage per profile', () => {
    expect(layoutStorageKey(null)).toBe('trade-journal:dashboard-layout:all');
    expect(layoutStorageKey(3)).toBe('trade-journal:dashboard-layout:3');
  });
});
