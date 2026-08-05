import { useMemo } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import type { ReplayFrame, ReplayMarkers, Direction } from '../types';
import CandleChart from './CandleChart';
import { buildMarkers, buildPriceLines } from '../utils/replay';

// A 2-up grid of synced candle charts — one per timeframe, all revealed to the
// same wall-clock `revealTime`. Markers are snapped per frame; price lines are
// shared (price-only). Higher TFs naturally show a growing partial candle.
export default function ReplayGrid({
  frames,
  markers,
  direction,
  revealTime,
  primaryTf,
  height = 300,
}: {
  frames: ReplayFrame[];
  markers: ReplayMarkers;
  direction: Direction;
  revealTime?: UTCTimestamp;
  primaryTf?: string;
  height?: number;
}) {
  const priceLines = useMemo(() => buildPriceLines(markers), [markers]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {frames.map((f) => (
        <FrameChart
          key={f.tf}
          frame={f}
          markers={markers}
          direction={direction}
          priceLines={priceLines}
          revealTime={revealTime}
          isPrimary={f.tf === primaryTf}
          height={height}
        />
      ))}
    </div>
  );
}

function FrameChart({
  frame,
  markers,
  direction,
  priceLines,
  revealTime,
  isPrimary,
  height,
}: {
  frame: ReplayFrame;
  markers: ReplayMarkers;
  direction: Direction;
  priceLines: ReturnType<typeof buildPriceLines>;
  revealTime?: UTCTimestamp;
  isPrimary: boolean;
  height: number;
}) {
  const frameMarkers = useMemo(
    () => buildMarkers(frame.bars, markers, direction),
    [frame.bars, markers, direction]
  );

  return (
    <div
      className={`rounded-lg border p-2 ${
        isPrimary ? 'border-indigo-500/60' : 'border-slate-800'
      }`}
    >
      <div className="mb-1 flex items-center justify-between px-1 text-xs">
        <span className="font-semibold text-slate-200">
          {frame.tf}
          {isPrimary && (
            <span className="ml-1.5 text-[10px] font-medium text-indigo-400">
              primary
            </span>
          )}
        </span>
        <span className="text-slate-600">
          {frame.bars.length === 0
            ? 'no bars'
            : frame.source.startsWith('agg:')
            ? `aggregated from ${frame.source.slice(4)}`
            : 'imported'}
        </span>
      </div>
      {frame.bars.length === 0 ? (
        <div
          className="flex items-center justify-center text-xs text-slate-600"
          style={{ height }}
        >
          No {frame.tf} bars for this instrument.
        </div>
      ) : (
        <CandleChart
          bars={frame.bars}
          revealTime={revealTime}
          markers={frameMarkers}
          priceLines={priceLines}
          lockRange
          height={height}
        />
      )}
    </div>
  );
}
