import type { UTCTimestamp } from 'lightweight-charts';
import type { Bar, Direction, ReplayMarkers } from '../types';
import type {
  ChartMarker,
  PriceLineSpec,
  PositionBox,
} from '../components/CandleChart';

export function toTime(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

// Ascending, de-duped bar times for a frame.
export function frameTimes(bars: Bar[]): UTCTimestamp[] {
  return bars.map((b) => toTime(b.t)).sort((a, b) => a - b);
}

// Snap a time to the nearest bar at or before it (markers must land on a bar).
export function snapToBar(times: UTCTimestamp[], iso?: string): UTCTimestamp | null {
  if (!iso || times.length === 0) return null;
  const target = toTime(iso);
  let best: UTCTimestamp | null = null;
  for (const bt of times) {
    if (bt <= target) best = bt;
    else break;
  }
  return best ?? times[0];
}

// Entry/exit markers snapped to this frame's bars.
export function buildMarkers(
  bars: Bar[],
  markers: ReplayMarkers,
  direction: Direction
): ChartMarker[] {
  const times = frameTimes(bars);
  const out: ChartMarker[] = [];
  const entrySnap = snapToBar(times, markers.entry?.t);
  const exitSnap = snapToBar(times, markers.exit?.t);
  if (entrySnap != null && markers.entry) {
    out.push({
      time: entrySnap,
      position: direction === 'long' ? 'belowBar' : 'aboveBar',
      color: '#6366f1',
      shape: direction === 'long' ? 'arrowUp' : 'arrowDown',
      text: `Entry ${markers.entry.price}`,
    });
  }
  if (exitSnap != null && markers.exit) {
    out.push({
      time: exitSnap,
      position: direction === 'long' ? 'aboveBar' : 'belowBar',
      color: '#f59e0b',
      shape: 'square',
      text: `Exit ${markers.exit.price}`,
    });
  }
  return out.sort((a, b) => (a.time as number) - (b.time as number));
}

// A long/short position box snapped to this frame's bars (times snapped so
// they land on candles; prices are exact). Null when there's no entry.
export function buildPositionBox(
  bars: Bar[],
  markers: ReplayMarkers,
  direction: Direction
): PositionBox | null {
  if (!markers.entry) return null;
  const times = frameTimes(bars);
  const entryTime = snapToBar(times, markers.entry.t);
  if (entryTime == null) return null;
  const exitTime =
    snapToBar(times, markers.exit?.t) ?? times[times.length - 1] ?? entryTime;
  return {
    direction,
    entryTime,
    exitTime,
    entryPrice: markers.entry.price,
    stopPrice: markers.stop?.price ?? null,
    targetPrice: markers.target?.price ?? null,
  };
}

// Stop / target / entry horizontal lines (price only — identical across TFs).
export function buildPriceLines(markers: ReplayMarkers): PriceLineSpec[] {
  const lines: PriceLineSpec[] = [];
  if (markers.entry)
    lines.push({ price: markers.entry.price, color: '#6366f1', title: 'Entry' });
  if (markers.stop)
    lines.push({ price: markers.stop.price, color: '#ef4444', title: 'Stop' });
  if (markers.target)
    lines.push({ price: markers.target.price, color: '#10b981', title: 'Target' });
  return lines;
}
