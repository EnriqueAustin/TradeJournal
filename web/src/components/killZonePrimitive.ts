// Vertical kill-zone shading drawn as a lightweight-charts series primitive
// (canvas), painted BELOW the candles (zOrder 'bottom'). Each zone is a UTC time
// window (London / NY kill zone) rendered as a translucent vertical band, so the
// higher-probability session windows are visible behind price without clutter.
import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesPrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
  IChartApi,
  UTCTimestamp,
} from 'lightweight-charts';

export interface KillZone {
  start: UTCTimestamp;
  end: UTCTimestamp;
  /** 'LON' | 'NY' — picks the band colour */
  kind: 'LON' | 'NY';
}

interface MediaScope {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface DrawTarget {
  useMediaCoordinateSpace(cb: (scope: MediaScope) => void): void;
}

const COLOR: Record<KillZone['kind'], string> = {
  LON: '96,165,250', // blue
  NY: '245,158,11', // amber
};

export class KillZonePrimitive implements ISeriesPrimitive<Time> {
  private _zones: KillZone[] = [];
  private _chart: IChartApi | null = null;
  private _requestUpdate?: () => void;
  private _views: KillZonePaneView[];

  constructor() {
    this._views = [new KillZonePaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
  }
  detached(): void {
    this._chart = null;
    this._requestUpdate = undefined;
  }

  setZones(zones: KillZone[]): void {
    this._zones = zones;
    this._requestUpdate?.();
  }

  updateAllViews(): void {}
  paneViews(): ISeriesPrimitivePaneView[] {
    return this._views;
  }

  zones(): KillZone[] {
    return this._zones;
  }
  chart(): IChartApi | null {
    return this._chart;
  }
}

class KillZonePaneView implements ISeriesPrimitivePaneView {
  constructor(private _source: KillZonePrimitive) {}
  zOrder(): SeriesPrimitivePaneViewZOrder {
    return 'bottom';
  }
  renderer(): ISeriesPrimitivePaneRenderer {
    return new KillZoneRenderer(this._source);
  }
}

class KillZoneRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(private _source: KillZonePrimitive) {}

  draw(target: DrawTarget): void {
    const zones = this._source.zones();
    const chart = this._source.chart();
    if (!zones.length || !chart) return;
    const ts = chart.timeScale();
    const vr = ts.getVisibleRange();
    if (!vr) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width;
      const H = mediaSize.height;
      const toX = (t: UTCTimestamp): number => {
        const raw = ts.timeToCoordinate(t);
        if (raw != null) return Math.max(0, Math.min(W, raw as number));
        return (t as number) < (vr.from as number) ? 0 : W;
      };
      for (const z of zones) {
        // Skip zones entirely outside the visible range.
        if ((z.end as number) < (vr.from as number) || (z.start as number) > (vr.to as number)) continue;
        const x1 = toX(z.start);
        const x2 = toX(z.end);
        const w = Math.abs(x2 - x1);
        if (w < 1) continue;
        const rgb = COLOR[z.kind];
        ctx.fillStyle = `rgba(${rgb},0.07)`;
        ctx.fillRect(Math.min(x1, x2), 0, w, H);
        // Faint left/right edges.
        ctx.strokeStyle = `rgba(${rgb},0.25)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.min(x1, x2) + 0.5, 0);
        ctx.lineTo(Math.min(x1, x2) + 0.5, H);
        ctx.moveTo(Math.max(x1, x2) - 0.5, 0);
        ctx.lineTo(Math.max(x1, x2) - 0.5, H);
        ctx.stroke();
      }
    });
  }
}

// Build the London (07–10 UTC) and NY (12–15 UTC) kill-zone windows that fall
// within [fromSec, toSec] (lightweight-charts UTC seconds). These are the
// higher-probability windows of the two sessions the strategy trades.
export function buildKillZones(fromSec: number, toSec: number): KillZone[] {
  const WINDOWS: { kind: 'LON' | 'NY'; startH: number; endH: number }[] = [
    { kind: 'LON', startH: 7, endH: 10 },
    { kind: 'NY', startH: 12, endH: 15 },
  ];
  const zones: KillZone[] = [];
  const dayMs = 86400;
  const firstDay = Math.floor(fromSec / dayMs) * dayMs;
  for (let day = firstDay; day <= toSec; day += dayMs) {
    for (const w of WINDOWS) {
      const start = day + w.startH * 3600;
      const end = day + w.endH * 3600;
      if (end < fromSec || start > toSec) continue;
      zones.push({ start: start as UTCTimestamp, end: end as UTCTimestamp, kind: w.kind });
    }
  }
  return zones;
}
