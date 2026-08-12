// SimBroker — simulated execution against the replayed bar stream. It opens a
// position on a market order (filled at the current bar's close), then watches
// each bar the replay cursor crosses and auto-closes on a stop-loss or
// take-profit touch (intrabar, using the bar's high/low). Unrealized PnL tracks
// the cursor bar's close. When a position closes it emits a ClosedTrade the page
// persists via the backtest-trades API.
//
// Phase 2 keeps a single open position at a time (the common focused-backtest
// case); partial closes, break-even, and pending limit/stop orders arrive in
// Phase 3. Pure TypeScript — the UI subscribes to `onChange`.

import type { EngineBar, ReplayEngine } from './engine';
import { rMultiple } from './sizing';

export type Side = 'long' | 'short';
export type CloseReason = 'tp' | 'sl' | 'manual';
export type OrderKind = 'market' | 'limit' | 'stop';

export interface OpenPosition {
  side: Side;
  size: number;
  entryPrice: number;
  entryTime: number; // unix seconds
  sl: number | null;
  tp: number | null;
}

// A resting limit/stop order waiting for price to reach its level.
export interface WorkingOrder {
  id: number;
  side: Side;
  kind: 'limit' | 'stop';
  price: number; // trigger / limit price
  size: number;
  sl: number | null;
  tp: number | null;
  placedTime: number; // unix seconds
}

export interface ClosedTrade {
  side: Side;
  size: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number; // unix seconds
  exitTime: number; // unix seconds
  sl: number | null;
  tp: number | null;
  reason: CloseReason;
  grossPnl: number;
  r: number | null;
}

export interface BrokerState {
  position: OpenPosition | null;
  working: WorkingOrder[];
  currentPrice: number | null;
  unrealized: number | null;
  unrealizedR: number | null;
  closed: ClosedTrade[];
  realized: number;
}

export interface MarketOrder {
  side: Side;
  size: number;
  sl?: number | null;
  tp?: number | null;
}

export interface PendingOrder {
  kind: 'limit' | 'stop';
  side: Side;
  size: number;
  price: number;
  sl?: number | null;
  tp?: number | null;
}

type Listener = (state: BrokerState) => void;
type CloseListener = (trade: ClosedTrade) => void;

const sign = (side: Side) => (side === 'long' ? 1 : -1);

export class SimBroker {
  private engine: ReplayEngine;
  private pointValue: number;
  private position: OpenPosition | null = null;
  private working: WorkingOrder[] = [];
  private orderSeq = 1;
  private closed: ClosedTrade[] = [];
  private realized = 0;
  private listeners = new Set<Listener>();
  private closeListeners = new Set<CloseListener>();
  private unsub: Array<() => void> = [];

  constructor(engine: ReplayEngine, opts: { pointValue?: number } = {}) {
    this.engine = engine;
    this.pointValue = opts.pointValue ?? 1;
    // React to each forward-crossed bar (SL/TP checks) and to cursor moves
    // (unrealized PnL readout).
    this.unsub.push(engine.onBar((bar) => this.onBar(bar)));
    this.unsub.push(engine.onCursor(() => this.emit()));
  }

  /** Price the market is currently trading at = the cursor bar's close. */
  currentPrice(): number | null {
    return this.engine.currentBar()?.close ?? null;
  }

  gross(entry: number, exit: number, size: number, side: Side): number {
    return (exit - entry) * size * sign(side) * this.pointValue;
  }

  /** Open a position at market (fills at the current bar close). No-op if one
   *  is already open. */
  placeMarket(order: MarketOrder): OpenPosition | null {
    if (this.position) return null;
    const bar = this.engine.currentBar();
    if (!bar || order.size <= 0) return null;
    this.position = {
      side: order.side,
      size: order.size,
      entryPrice: bar.close,
      entryTime: bar.sec,
      sl: order.sl ?? null,
      tp: order.tp ?? null,
    };
    this.emit();
    return this.position;
  }

  /** Queue a resting limit/stop order; it fills when a bar reaches its price. */
  placeOrder(order: PendingOrder): WorkingOrder | null {
    if (order.size <= 0) return null;
    const wo: WorkingOrder = {
      id: this.orderSeq++,
      side: order.side,
      kind: order.kind,
      price: order.price,
      size: order.size,
      sl: order.sl ?? null,
      tp: order.tp ?? null,
      placedTime: this.engine.currentBar()?.sec ?? 0,
    };
    this.working.push(wo);
    this.emit();
    return wo;
  }

  cancelOrder(id: number): void {
    const n = this.working.length;
    this.working = this.working.filter((o) => o.id !== id);
    if (this.working.length !== n) this.emit();
  }

  /** Move the stop / target of the open position (drag SL/TP). */
  setStops(sl: number | null | undefined, tp: number | null | undefined): void {
    if (!this.position) return;
    if (sl !== undefined) this.position.sl = sl;
    if (tp !== undefined) this.position.tp = tp;
    this.emit();
  }

  /** Move the stop to entry (lock in break-even). */
  breakEven(): void {
    if (!this.position) return;
    this.position.sl = this.position.entryPrice;
    this.emit();
  }

  /** Close part of the open position at market, realizing that portion's PnL as
   *  its own trade row (shared entry). Full size closes the whole position. */
  partialClose(size: number): void {
    const bar = this.engine.currentBar();
    const p = this.position;
    if (!p || !bar || size <= 0) return;
    if (size >= p.size) {
      this.close(bar.close, bar.sec, 'manual');
      return;
    }
    const grossPnl = this.gross(p.entryPrice, bar.close, size, p.side);
    const trade: ClosedTrade = {
      side: p.side,
      size,
      entryPrice: p.entryPrice,
      exitPrice: bar.close,
      entryTime: p.entryTime,
      exitTime: bar.sec,
      sl: p.sl,
      tp: p.tp,
      reason: 'manual',
      grossPnl,
      r: rMultiple(p.side, p.entryPrice, bar.close, p.sl),
    };
    p.size -= size;
    this.closed.push(trade);
    this.realized += grossPnl;
    this.emit();
    for (const fn of this.closeListeners) fn(trade);
  }

  /** Close the open position at market (current bar close). */
  closeMarket(): void {
    const bar = this.engine.currentBar();
    if (!this.position || !bar) return;
    this.close(bar.close, bar.sec, 'manual');
  }

  // Does a bar reach a resting order's price? Limits fill on a touch toward the
  // level; stops fill on a breakout through it.
  private static triggered(o: WorkingOrder, bar: EngineBar): boolean {
    if (o.kind === 'limit') {
      return o.side === 'long' ? bar.low <= o.price : bar.high >= o.price;
    }
    // stop
    return o.side === 'long' ? bar.high >= o.price : bar.low <= o.price;
  }

  private onBar(bar: EngineBar): void {
    // 1) Fill a resting order if we're flat and price reached it. The order fills
    //    at its own level (optimistic for limits, at the stop for stops). We only
    //    take one per bar, then let subsequent bars manage the position.
    if (!this.position && this.working.length) {
      const idx = this.working.findIndex((o) => SimBroker.triggered(o, bar));
      if (idx !== -1) {
        const o = this.working[idx];
        this.working.splice(idx, 1);
        this.position = {
          side: o.side,
          size: o.size,
          entryPrice: o.price,
          entryTime: bar.sec,
          sl: o.sl,
          tp: o.tp,
        };
        this.emit();
        return; // don't also SL/TP-check the fill bar
      }
    }

    const p = this.position;
    if (!p) {
      this.emit();
      return;
    }
    // Intrabar touch detection. If both stop and target are inside the same bar
    // we resolve conservatively (stop first) — we can't know the tick order.
    if (p.side === 'long') {
      const stopHit = p.sl != null && bar.low <= p.sl;
      const tpHit = p.tp != null && bar.high >= p.tp;
      if (stopHit) return this.close(p.sl as number, bar.sec, 'sl');
      if (tpHit) return this.close(p.tp as number, bar.sec, 'tp');
    } else {
      const stopHit = p.sl != null && bar.high >= p.sl;
      const tpHit = p.tp != null && bar.low <= p.tp;
      if (stopHit) return this.close(p.sl as number, bar.sec, 'sl');
      if (tpHit) return this.close(p.tp as number, bar.sec, 'tp');
    }
    this.emit();
  }

  private close(exitPrice: number, exitTime: number, reason: CloseReason): void {
    const p = this.position;
    if (!p) return;
    const grossPnl = this.gross(p.entryPrice, exitPrice, p.size, p.side);
    const trade: ClosedTrade = {
      side: p.side,
      size: p.size,
      entryPrice: p.entryPrice,
      exitPrice,
      entryTime: p.entryTime,
      exitTime,
      sl: p.sl,
      tp: p.tp,
      reason,
      grossPnl,
      r: rMultiple(p.side, p.entryPrice, exitPrice, p.sl),
    };
    this.position = null;
    this.closed.push(trade);
    this.realized += grossPnl;
    this.emit();
    for (const fn of this.closeListeners) fn(trade);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  onClose(fn: CloseListener): () => void {
    this.closeListeners.add(fn);
    return () => this.closeListeners.delete(fn);
  }

  snapshot(): BrokerState {
    const price = this.currentPrice();
    let unrealized: number | null = null;
    let unrealizedR: number | null = null;
    if (this.position && price != null) {
      unrealized = this.gross(
        this.position.entryPrice,
        price,
        this.position.size,
        this.position.side
      );
      unrealizedR = rMultiple(
        this.position.side,
        this.position.entryPrice,
        price,
        this.position.sl
      );
    }
    return {
      position: this.position,
      working: this.working,
      currentPrice: price,
      unrealized,
      unrealizedR,
      closed: this.closed,
      realized: this.realized,
    };
  }

  private emit(): void {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  destroy(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.listeners.clear();
    this.closeListeners.clear();
    this.position = null;
    this.working = [];
  }
}
