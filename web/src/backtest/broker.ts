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

export interface OpenPosition {
  side: Side;
  size: number;
  entryPrice: number;
  entryTime: number; // unix seconds
  sl: number | null;
  tp: number | null;
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

type Listener = (state: BrokerState) => void;
type CloseListener = (trade: ClosedTrade) => void;

const sign = (side: Side) => (side === 'long' ? 1 : -1);

export class SimBroker {
  private engine: ReplayEngine;
  private pointValue: number;
  private position: OpenPosition | null = null;
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

  /** Move the stop / target of the open position (drag SL/TP). */
  setStops(sl: number | null | undefined, tp: number | null | undefined): void {
    if (!this.position) return;
    if (sl !== undefined) this.position.sl = sl;
    if (tp !== undefined) this.position.tp = tp;
    this.emit();
  }

  /** Close the open position at market (current bar close). */
  closeMarket(): void {
    const bar = this.engine.currentBar();
    if (!this.position || !bar) return;
    this.close(bar.close, bar.sec, 'manual');
  }

  private onBar(bar: EngineBar): void {
    const p = this.position;
    if (!p) return;
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
  }
}
