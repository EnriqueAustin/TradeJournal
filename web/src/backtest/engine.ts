// ReplayEngine — the beating heart of the Backtest Studio. It holds an ordered
// array of base-timeframe bars and a cursor (an index into them). Playing the
// engine advances the cursor forward one bar at a time on a timer whose interval
// scales with `speed`; the chart reveals every bar at or before the cursor time
// (via CandleChart's `revealTime`), so the trader sees price unfold candle by
// candle without knowing what comes next — exactly like FXReplay's bar replay.
//
// Pure TypeScript, React-free, and unit-testable: the UI subscribes to cursor
// changes and re-renders. All the market/PnL logic lives in the SimBroker, which
// listens to the same bar stream.

import type { Bar } from '../types';

export type Seconds = number; // unix seconds (lightweight-charts UTCTimestamp)

export interface EngineBar extends Bar {
  /** unix seconds — precomputed from `t` for fast comparisons */
  sec: Seconds;
}

export type CursorListener = (state: CursorState) => void;
export type BarListener = (bar: EngineBar, index: number) => void;

export interface CursorState {
  index: number; // 0-based index of the current (last revealed) bar
  time: Seconds; // cursor time = current bar's time
  playing: boolean;
  speed: number;
  atEnd: boolean;
  total: number;
}

// One base tick = this many ms at 1×. Higher speed → shorter interval. Capped so
// very high speeds still yield to the event loop.
const BASE_TICK_MS = 900;
const MIN_TICK_MS = 8;

function toSec(iso: string): Seconds {
  return Math.floor(new Date(iso).getTime() / 1000);
}

// Sort ascending by time and drop duplicate timestamps (keeping the last), the
// same normalization CandleChart does before setData.
export function normalizeBars(bars: Bar[]): EngineBar[] {
  const mapped = bars
    .map((b) => ({ ...b, sec: toSec(b.t) }))
    .filter((b) => Number.isFinite(b.sec))
    .sort((a, b) => a.sec - b.sec);
  const out: EngineBar[] = [];
  for (const b of mapped) {
    const last = out[out.length - 1];
    if (last && last.sec === b.sec) out[out.length - 1] = b;
    else out.push(b);
  }
  return out;
}

export class ReplayEngine {
  private bars: EngineBar[] = [];
  private idx = 0;
  private playing = false;
  private speed = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cursorListeners = new Set<CursorListener>();
  private barListeners = new Set<BarListener>();

  constructor(bars: Bar[] = [], startTime?: Seconds | null) {
    this.setBars(bars, startTime);
  }

  /** Replace the bar set. Keeps the cursor at `startTime` if given, else start. */
  setBars(bars: Bar[], startTime?: Seconds | null): void {
    this.pause();
    this.bars = normalizeBars(bars);
    this.idx = startTime != null ? this.indexAt(startTime) : 0;
    if (this.idx < 0) this.idx = 0;
    this.emitCursor();
  }

  /** Largest index whose bar time <= `time` (or 0 if all are later). */
  indexAt(time: Seconds): number {
    const b = this.bars;
    if (!b.length) return 0;
    let lo = 0;
    let hi = b.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (b[mid].sec <= time) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  get length(): number {
    return this.bars.length;
  }
  get index(): number {
    return this.idx;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get currentSpeed(): number {
    return this.speed;
  }
  get atEnd(): boolean {
    return this.idx >= this.bars.length - 1;
  }

  /** Current cursor time (seconds), or null if there are no bars. */
  cursorTime(): Seconds | null {
    return this.bars.length ? this.bars[this.idx].sec : null;
  }

  currentBar(): EngineBar | null {
    return this.bars.length ? this.bars[this.idx] : null;
  }

  /** All revealed bars (0..idx inclusive). */
  revealed(): EngineBar[] {
    return this.bars.slice(0, this.idx + 1);
  }

  allBars(): EngineBar[] {
    return this.bars;
  }

  play(): void {
    if (this.playing || !this.bars.length || this.atEnd) return;
    this.playing = true;
    this.emitCursor();
    this.schedule();
  }

  pause(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.playing) {
      this.playing = false;
      this.emitCursor();
    }
  }

  toggle(): void {
    this.playing ? this.pause() : this.play();
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, speed);
    this.emitCursor();
    if (this.playing) this.schedule(); // re-time with the new interval
  }

  /** Step by ±n bars (default +1); pauses playback. Emits the newly-crossed bars. */
  step(n = 1): void {
    this.pause();
    this.moveTo(this.idx + n);
  }

  /** Jump the cursor to the bar at/just before `time`. */
  seek(time: Seconds): void {
    this.pause();
    this.moveTo(this.indexAt(time));
  }

  seekIndex(index: number): void {
    this.pause();
    this.moveTo(index);
  }

  private moveTo(target: number): void {
    const clamped = Math.max(0, Math.min(target, this.bars.length - 1));
    if (clamped === this.idx) {
      this.emitCursor();
      return;
    }
    // Emit each forward-crossed bar so the broker can process fills bar-by-bar.
    if (clamped > this.idx) {
      for (let i = this.idx + 1; i <= clamped; i++) this.emitBar(this.bars[i], i);
    }
    this.idx = clamped;
    this.emitCursor();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const interval = Math.max(MIN_TICK_MS, BASE_TICK_MS / this.speed);
    this.timer = setTimeout(() => this.tick(), interval);
  }

  private tick(): void {
    if (!this.playing) return;
    if (this.atEnd) {
      this.pause();
      return;
    }
    this.idx += 1;
    this.emitBar(this.bars[this.idx], this.idx);
    this.emitCursor();
    if (this.atEnd) {
      this.pause();
      return;
    }
    this.schedule();
  }

  onCursor(fn: CursorListener): () => void {
    this.cursorListeners.add(fn);
    fn(this.snapshot());
    return () => this.cursorListeners.delete(fn);
  }

  /** Fires once per bar the cursor advances over (forward only). */
  onBar(fn: BarListener): () => void {
    this.barListeners.add(fn);
    return () => this.barListeners.delete(fn);
  }

  snapshot(): CursorState {
    return {
      index: this.idx,
      time: this.cursorTime() ?? 0,
      playing: this.playing,
      speed: this.speed,
      atEnd: this.atEnd,
      total: this.bars.length,
    };
  }

  private emitCursor(): void {
    const s = this.snapshot();
    for (const fn of this.cursorListeners) fn(s);
  }
  private emitBar(bar: EngineBar, index: number): void {
    for (const fn of this.barListeners) fn(bar, index);
  }

  destroy(): void {
    this.pause();
    this.cursorListeners.clear();
    this.barListeners.clear();
    this.bars = [];
  }
}
