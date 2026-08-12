import { describe, it, expect } from 'vitest';
import { ReplayEngine } from './engine';
import { SimBroker, type ClosedTrade } from './broker';
import type { Bar } from '../types';

// OHLC bar `min` minutes past the anchor.
function ohlc(min: number, o: number, h: number, l: number, c: number): Bar {
  const t = new Date(Date.UTC(2024, 0, 1, 0, min)).toISOString();
  return { t, open: o, high: h, low: l, close: c, volume: 0 };
}

function setup(bars: Bar[]) {
  const engine = new ReplayEngine(bars);
  const broker = new SimBroker(engine);
  const closes: ClosedTrade[] = [];
  broker.onClose((t) => closes.push(t));
  return { engine, broker, closes };
}

describe('SimBroker market orders', () => {
  it('fills a long at the current bar close', () => {
    const { broker } = setup([ohlc(0, 100, 100, 100, 100)]);
    const pos = broker.placeMarket({ side: 'long', size: 2, sl: 95, tp: 110 });
    expect(pos?.entryPrice).toBe(100);
    expect(pos?.size).toBe(2);
  });

  it('auto-closes a long at take-profit when a later bar trades through it', () => {
    const { engine, broker, closes } = setup([
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 101, 105, 100, 104), // does not reach TP 110
      ohlc(2, 104, 112, 103, 108), // high 112 ≥ TP 110 → close at 110
    ]);
    broker.placeMarket({ side: 'long', size: 1, sl: 95, tp: 110 });
    engine.seekIndex(2);
    expect(closes).toHaveLength(1);
    expect(closes[0].reason).toBe('tp');
    expect(closes[0].exitPrice).toBe(110);
    expect(closes[0].grossPnl).toBe(10); // (110-100)*1
    expect(closes[0].r).toBe(2); // risk 5 → 10/5
    expect(broker.snapshot().position).toBeNull();
  });

  it('auto-closes a long at stop-loss on a downward wick', () => {
    const { engine, broker, closes } = setup([
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 100, 101, 94, 96), // low 94 ≤ SL 95 → close at 95
    ]);
    broker.placeMarket({ side: 'long', size: 3, sl: 95, tp: 110 });
    engine.seekIndex(1);
    expect(closes[0].reason).toBe('sl');
    expect(closes[0].exitPrice).toBe(95);
    expect(closes[0].grossPnl).toBe(-15); // (95-100)*3
    expect(closes[0].r).toBe(-1);
  });

  it('resolves stop first when one bar spans both SL and TP', () => {
    const { engine, broker, closes } = setup([
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 100, 111, 94, 100), // spans SL 95 and TP 110
    ]);
    broker.placeMarket({ side: 'long', size: 1, sl: 95, tp: 110 });
    engine.seekIndex(1);
    expect(closes[0].reason).toBe('sl');
  });

  it('handles a short: profit is downward, stop is above', () => {
    const { engine, broker, closes } = setup([
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 100, 101, 89, 90), // low 89 ≤ TP 90 → close at 90
    ]);
    broker.placeMarket({ side: 'short', size: 2, sl: 105, tp: 90 });
    engine.seekIndex(1);
    expect(closes[0].reason).toBe('tp');
    expect(closes[0].exitPrice).toBe(90);
    expect(closes[0].grossPnl).toBe(20); // (90-100)*2*-1
  });

  it('closes at market on demand and tracks realized PnL', () => {
    const { engine, broker, closes } = setup([
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 102, 103, 101, 102),
    ]);
    broker.placeMarket({ side: 'long', size: 1, sl: 90, tp: 200 });
    engine.step(1); // now at bar 1, close 102, no SL/TP hit
    broker.closeMarket();
    expect(closes[0].reason).toBe('manual');
    expect(closes[0].exitPrice).toBe(102);
    expect(broker.snapshot().realized).toBe(2);
  });

  it('reports unrealized PnL against the cursor bar', () => {
    const { engine, broker } = setup([
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 105, 106, 104, 105),
    ]);
    broker.placeMarket({ side: 'long', size: 2, sl: 90, tp: 200 });
    engine.step(1);
    const s = broker.snapshot();
    expect(s.currentPrice).toBe(105);
    expect(s.unrealized).toBe(10); // (105-100)*2
  });

  it('rejects a second position while one is open', () => {
    const { broker } = setup([ohlc(0, 100, 100, 100, 100)]);
    broker.placeMarket({ side: 'long', size: 1, sl: 95, tp: 110 });
    const second = broker.placeMarket({ side: 'short', size: 1, sl: 105, tp: 90 });
    expect(second).toBeNull();
  });
});

describe('SimBroker working orders', () => {
  it('fills a buy-limit when a bar dips to its price, at the limit', () => {
    const { engine, broker } = setup([
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 100, 101, 97, 99), // low 97 ≤ limit 98 → fill at 98
    ]);
    broker.placeOrder({ kind: 'limit', side: 'long', size: 1, price: 98, sl: 95, tp: 110 });
    expect(broker.snapshot().working).toHaveLength(1);
    engine.seekIndex(1);
    const s = broker.snapshot();
    expect(s.working).toHaveLength(0);
    expect(s.position?.entryPrice).toBe(98);
  });

  it('fills a buy-stop only on a breakout above its trigger', () => {
    const { engine, broker } = setup([
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 100, 101, 99, 100), // high 101 < trigger 105 → no fill
      ohlc(2, 101, 106, 100, 105), // high 106 ≥ 105 → fill at 105
    ]);
    broker.placeOrder({ kind: 'stop', side: 'long', size: 1, price: 105, sl: 100, tp: 120 });
    engine.seekIndex(1);
    expect(broker.snapshot().position).toBeNull();
    engine.seekIndex(2);
    expect(broker.snapshot().position?.entryPrice).toBe(105);
  });

  it('cancels a resting order', () => {
    const { broker } = setup([ohlc(0, 100, 100, 100, 100)]);
    const o = broker.placeOrder({ kind: 'limit', side: 'long', size: 1, price: 90 });
    broker.cancelOrder(o!.id);
    expect(broker.snapshot().working).toHaveLength(0);
  });
});

describe('SimBroker partial close & break-even', () => {
  it('partial close realizes part of the size and keeps the rest', () => {
    const { engine, broker, closes } = setup([
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 110, 110, 110, 110),
    ]);
    broker.placeMarket({ side: 'long', size: 4, sl: 90, tp: 200 });
    engine.step(1); // price 110
    broker.partialClose(1);
    expect(closes).toHaveLength(1);
    expect(closes[0].size).toBe(1);
    expect(closes[0].grossPnl).toBe(10); // (110-100)*1
    expect(broker.snapshot().position?.size).toBe(3);
    expect(broker.snapshot().realized).toBe(10);
  });

  it('break-even moves the stop to entry', () => {
    const { broker } = setup([ohlc(0, 100, 100, 100, 100)]);
    broker.placeMarket({ side: 'long', size: 1, sl: 90, tp: 120 });
    broker.breakEven();
    expect(broker.snapshot().position?.sl).toBe(100);
  });
});
