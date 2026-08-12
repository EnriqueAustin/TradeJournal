import { useEffect, useState } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import CandleChart, {
  type ChartMarker,
  type PriceLineSpec,
  type PositionBox,
} from '../../components/CandleChart';
import type { ReplayEngine } from '../engine';

// StudioChart binds a CandleChart to a ReplayEngine: it feeds the full bar set
// but reveals only bars at/before the engine cursor, so the chart plays forward
// candle-by-candle. This is the seam where later phases hang indicators, drawing
// tools, and order/position overlays — the page talks to one engine and every
// chart in the layout stays in sync through it.
export default function StudioChart({
  engine,
  height = 460,
  windowSize = 120,
  markers,
  priceLines,
  positionBox,
  onClickPrice,
  onContextPrice,
}: {
  engine: ReplayEngine;
  height?: number;
  /** rolling replay window (bars kept visible); see CandleChart */
  windowSize?: number;
  markers?: ChartMarker[];
  priceLines?: PriceLineSpec[];
  positionBox?: PositionBox | null;
  onClickPrice?: (t: string, price: number) => void;
  onContextPrice?: (price: number, pos: { x: number; y: number }) => void;
}) {
  const [revealTime, setRevealTime] = useState<UTCTimestamp | undefined>(
    engine.cursorTime() != null ? (engine.cursorTime() as UTCTimestamp) : undefined
  );

  useEffect(() => {
    return engine.onCursor((s) => setRevealTime(s.time as UTCTimestamp));
  }, [engine]);

  return (
    <CandleChart
      bars={engine.allBars()}
      revealTime={revealTime}
      windowSize={windowSize}
      height={height}
      markers={markers}
      priceLines={priceLines}
      positionBox={positionBox}
      onClickPrice={onClickPrice}
      onContextPrice={onContextPrice}
    />
  );
}
