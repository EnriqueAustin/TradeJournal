// Chart drawings for the Backtest Studio — trendlines, rays, horizontal &
// vertical lines, rectangles, and Fibonacci retracements — rendered as a
// lightweight-charts canvas series primitive (same approach as
// positionBoxPrimitive: draws in lockstep with the chart, survives pan/zoom/
// resize). Geometry is shared between the renderer and hit-testing so a click
// selects exactly what you see.

import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesPrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
  IChartApi,
  ISeriesApi,
  SeriesType,
  UTCTimestamp,
} from 'lightweight-charts';

export type DrawTool = 'trendline' | 'ray' | 'hline' | 'vline' | 'rect' | 'fib';

export interface DrawPoint {
  time: number; // unix seconds
  price: number;
}

export interface Drawing {
  id: string;
  type: DrawTool;
  points: DrawPoint[];
  color?: string;
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Clicks a tool needs before the drawing is complete. */
export function pointsNeeded(t: DrawTool): number {
  return t === 'hline' || t === 'vline' ? 1 : 2;
}

const DEFAULT = '#eab308'; // amber
const SELECTED = '#6366f1'; // indigo

interface MediaScope {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface DrawTarget {
  useMediaCoordinateSpace(cb: (scope: MediaScope) => void): void;
}

// Pixel-space coordinate converters bound to the current chart view.
export interface Coords {
  W: number;
  H: number;
  toX: (t: number) => number | null;
  toY: (p: number) => number | null;
}

export function makeCoords(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  W: number,
  H: number
): Coords {
  const ts = chart.timeScale();
  const toX = (t: number): number | null => {
    const raw = ts.timeToCoordinate(t as UTCTimestamp);
    if (raw != null) return raw as number;
    const vr = ts.getVisibleRange();
    if (!vr) return null;
    return t < (vr.from as number) ? 0 : W;
  };
  const toY = (p: number): number | null => {
    const y = series.priceToCoordinate(p);
    return y == null ? null : (y as number);
  };
  return { W, H, toX, toY };
}

// Resolve a drawing to the pixel segments/levels used to both draw and hit-test.
// Returns a list of line segments {x1,y1,x2,y2} plus optional fib labels.
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  labelY?: number;
}

export function drawingSegments(d: Drawing, c: Coords): Segment[] {
  const { W, H, toX, toY } = c;
  const a = d.points[0];
  const b = d.points[1];
  switch (d.type) {
    case 'hline': {
      const y = toY(a.price);
      if (y == null) return [];
      return [{ x1: 0, y1: y, x2: W, y2: y }];
    }
    case 'vline': {
      const x = toX(a.time);
      if (x == null) return [];
      return [{ x1: x, y1: 0, x2: x, y2: H }];
    }
    case 'trendline': {
      if (!b) return [];
      const x1 = toX(a.time), y1 = toY(a.price), x2 = toX(b.time), y2 = toY(b.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return [];
      return [{ x1, y1, x2, y2 }];
    }
    case 'ray': {
      if (!b) return [];
      const x1 = toX(a.time), y1 = toY(a.price), x2 = toX(b.time), y2 = toY(b.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return [];
      // Extend past B to the right edge along the same slope.
      const dx = x2 - x1;
      const ex = W;
      const ey = dx === 0 ? y2 : y1 + ((y2 - y1) * (ex - x1)) / dx;
      return [{ x1, y1, x2: ex, y2: ey }];
    }
    case 'rect': {
      if (!b) return [];
      const x1 = toX(a.time), y1 = toY(a.price), x2 = toX(b.time), y2 = toY(b.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return [];
      const L = Math.min(x1, x2), R = Math.max(x1, x2), T = Math.min(y1, y2), Bt = Math.max(y1, y2);
      return [
        { x1: L, y1: T, x2: R, y2: T },
        { x1: R, y1: T, x2: R, y2: Bt },
        { x1: R, y1: Bt, x2: L, y2: Bt },
        { x1: L, y1: Bt, x2: L, y2: T },
      ];
    }
    case 'fib': {
      if (!b) return [];
      const xa = toX(a.time), xb = toX(b.time);
      if (xa == null || xb == null) return [];
      const left = Math.min(xa, xb);
      const segs: Segment[] = [];
      for (const lvl of FIB_LEVELS) {
        const price = a.price + (b.price - a.price) * lvl;
        const y = toY(price);
        if (y == null) continue;
        segs.push({ x1: left, y1: y, x2: W, y2: y, label: `${(lvl * 100).toFixed(1)}% ${price.toFixed(2)}`, labelY: y });
      }
      return segs;
    }
    default:
      return [];
  }
}

function distToSeg(px: number, py: number, s: Segment): number {
  const { x1, y1, x2, y2 } = s;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** True if (px,py) is within `tol` px of any of the drawing's segments. */
export function hitTest(d: Drawing, px: number, py: number, c: Coords, tol = 6): boolean {
  const segs = drawingSegments(d, c);
  for (const s of segs) if (distToSeg(px, py, s) <= tol) return true;
  return false;
}

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private _drawings: Drawing[] = [];
  private _selected: string | null = null;
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _requestUpdate?: () => void;
  private _views: DrawingsPaneView[];

  constructor() {
    this._views = [new DrawingsPaneView(this)];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this._chart = p.chart;
    this._series = p.series;
    this._requestUpdate = p.requestUpdate;
  }
  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = undefined;
  }

  set(drawings: Drawing[], selected: string | null): void {
    this._drawings = drawings;
    this._selected = selected;
    this._requestUpdate?.();
  }

  updateAllViews(): void {}
  paneViews(): ISeriesPrimitivePaneView[] {
    return this._views;
  }

  drawings(): Drawing[] {
    return this._drawings;
  }
  selected(): string | null {
    return this._selected;
  }
  chart(): IChartApi | null {
    return this._chart;
  }
  series(): ISeriesApi<SeriesType> | null {
    return this._series;
  }
}

class DrawingsPaneView implements ISeriesPrimitivePaneView {
  constructor(private _src: DrawingsPrimitive) {}
  zOrder(): SeriesPrimitivePaneViewZOrder {
    return 'top';
  }
  renderer(): ISeriesPrimitivePaneRenderer {
    return new DrawingsRenderer(this._src);
  }
}

class DrawingsRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(private _src: DrawingsPrimitive) {}
  draw(target: DrawTarget): void {
    const chart = this._src.chart();
    const series = this._src.series();
    if (!chart || !series) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const c = makeCoords(chart, series, mediaSize.width, mediaSize.height);
      for (const d of this._src.drawings()) {
        const selected = d.id === this._src.selected();
        const color = selected ? SELECTED : d.color || DEFAULT;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = selected ? 2 : 1;
        ctx.font = '10px ui-monospace, monospace';
        const segs = drawingSegments(d, c);
        // Light fill for rectangles.
        if (d.type === 'rect' && segs.length === 4) {
          const xs = segs.flatMap((s) => [s.x1, s.x2]);
          const ys = segs.flatMap((s) => [s.y1, s.y2]);
          const L = Math.min(...xs), R = Math.max(...xs), T = Math.min(...ys), B = Math.max(...ys);
          ctx.globalAlpha = 0.08;
          ctx.fillRect(L, T, R - L, B - T);
          ctx.globalAlpha = 1;
        }
        for (const s of segs) {
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
          if (s.label && s.labelY != null) {
            ctx.fillText(s.label, s.x1 + 4, s.labelY - 2);
          }
        }
      }
    });
  }
}
