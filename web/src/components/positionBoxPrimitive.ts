// A TradingView-style position overlay drawn as a lightweight-charts series
// primitive (canvas), NOT an HTML layer. Drawing on the canvas means it redraws
// in lockstep with every chart render — pan, zoom, and especially resize — so it
// never lags behind or detaches. zOrder 'top' paints it above the candles.
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
import type { PositionBox } from './CandleChart';

// Minimal shape of the fancy-canvas draw target (avoids a direct dependency).
interface MediaScope {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface DrawTarget {
  useMediaCoordinateSpace(cb: (scope: MediaScope) => void): void;
}

const GREEN = '16,185,129';
const AMBER = '245,158,11';
const RED = '239,68,68';
const INDIGO = '99,102,241';
const EDGE = '148,163,184';

export class PositionBoxPrimitive implements ISeriesPrimitive<Time> {
  private _box: PositionBox | null = null;
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _requestUpdate?: () => void;
  private _views: PositionBoxPaneView[];

  constructor() {
    this._views = [new PositionBoxPaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }
  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = undefined;
  }

  setBox(box: PositionBox | null): void {
    this._box = box;
    this._requestUpdate?.();
  }

  updateAllViews(): void {}
  paneViews(): ISeriesPrimitivePaneView[] {
    return this._views;
  }

  box(): PositionBox | null {
    return this._box;
  }
  chart(): IChartApi | null {
    return this._chart;
  }
  series(): ISeriesApi<SeriesType> | null {
    return this._series;
  }
}

class PositionBoxPaneView implements ISeriesPrimitivePaneView {
  constructor(private _source: PositionBoxPrimitive) {}
  zOrder(): SeriesPrimitivePaneViewZOrder {
    return 'top';
  }
  renderer(): ISeriesPrimitivePaneRenderer {
    return new PositionBoxRenderer(this._source);
  }
}

class PositionBoxRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(private _source: PositionBoxPrimitive) {}

  draw(target: DrawTarget): void {
    const box = this._source.box();
    const chart = this._source.chart();
    const series = this._source.series();
    if (!box || !chart || !series) return;
    const ts = chart.timeScale();

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width;
      const H = mediaSize.height;

      // Time → x, clamping off-screen edges to the pane border.
      const toX = (t: UTCTimestamp): number | null => {
        const raw = ts.timeToCoordinate(t);
        if (raw != null) return Math.max(0, Math.min(W, raw as number));
        const vr = ts.getVisibleRange();
        if (!vr) return null;
        return (t as number) < (vr.from as number) ? 0 : W;
      };
      const toY = (p: number): number | null => {
        const y = series.priceToCoordinate(p);
        return y == null ? null : Math.max(0, Math.min(H, y as number));
      };

      const entryY = toY(box.entryPrice);
      const x1 = toX(box.entryTime);
      const x2 = toX(box.rightTime);
      if (entryY == null || x1 == null || x2 == null) return;

      const left = Math.min(x1, x2);
      const width = Math.max(2, Math.abs(x2 - x1));
      const profitUp = box.direction === 'long';

      // Reward zone (entry → target): green for a real/near TP, amber when the
      // exit-fallback sits on the loss side.
      let targetY: number | null = null;
      let rewardRGB = GREEN;
      if (box.targetPrice != null) {
        targetY = toY(box.targetPrice);
        if (targetY != null) {
          const profitSide = profitUp
            ? box.targetPrice >= box.entryPrice
            : box.targetPrice <= box.entryPrice;
          rewardRGB = profitSide ? GREEN : AMBER;
          fillBand(ctx, left, width, entryY, targetY, rewardRGB);
        }
      }
      // Risk zone (entry → stop).
      let stopY: number | null = null;
      if (box.stopPrice != null) {
        stopY = toY(box.stopPrice);
        if (stopY != null) fillBand(ctx, left, width, entryY, stopY, RED);
      }

      // Box left edge (entry) — a vertical anchor line spanning the zones.
      const ys = [entryY, targetY, stopY].filter((v): v is number => v != null);
      const top = Math.min(...ys);
      const bot = Math.max(...ys);
      ctx.strokeStyle = `rgba(${EDGE},0.7)`;
      ctx.lineWidth = 1;
      line(ctx, left, top, left, bot);

      // Entry line — bold, across the box.
      ctx.strokeStyle = `rgb(${INDIGO})`;
      ctx.lineWidth = 2;
      line(ctx, left, entryY, left + width, entryY);

      // Price tags on the right edge.
      if (targetY != null && box.targetPrice != null)
        tag(ctx, left + width, targetY, rewardRGB, box.targetIsTP ? 'TP' : 'Exit', box.targetPrice);
      if (stopY != null && box.stopPrice != null)
        tag(ctx, left + width, stopY, RED, 'SL', box.stopPrice);

      // Direction + R:R badge at entry (top-left of the box).
      let rr: number | undefined;
      if (box.targetPrice != null && box.stopPrice != null) {
        const r = Math.abs(box.entryPrice - box.stopPrice);
        if (r > 0) rr = Math.abs(box.targetPrice - box.entryPrice) / r;
      }
      const badge =
        box.direction.toUpperCase() + (rr != null ? `  ${rr.toFixed(1)}R` : '');
      badgeLabel(ctx, left + 2, entryY - 9, profitUp ? `5,150,105` : `220,38,38`, badge);
    });
  }
}

function line(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function fillBand(
  ctx: CanvasRenderingContext2D,
  left: number,
  width: number,
  yA: number,
  yB: number,
  rgb: string
): void {
  const top = Math.min(yA, yB);
  const h = Math.abs(yB - yA);
  ctx.fillStyle = `rgba(${rgb},0.22)`;
  ctx.fillRect(left, top, width, h);
  ctx.strokeStyle = `rgba(${rgb},0.9)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, width - 1, h - 1);
}

// A price tag pinned to the right edge (right-aligned).
function tag(
  ctx: CanvasRenderingContext2D,
  rightX: number,
  y: number,
  rgb: string,
  title: string,
  price: number
): void {
  const text = `${title} ${price.toFixed(2)}`;
  ctx.font = '10px ui-monospace, monospace';
  const padX = 4;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 15;
  const x = rightX - w;
  ctx.fillStyle = `rgba(${rgb},0.95)`;
  roundRect(ctx, x, y - h / 2, w, h, 3);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, y + 0.5);
}

function badgeLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rgb: string,
  text: string
): void {
  ctx.font = '600 10px ui-monospace, monospace';
  const padX = 5;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 15;
  const top = Math.max(1, y - h);
  ctx.fillStyle = `rgb(${rgb})`;
  roundRect(ctx, x, top, w, h, 3);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, top + h / 2 + 0.5);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
