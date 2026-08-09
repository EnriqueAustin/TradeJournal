import type { UTCTimestamp } from 'lightweight-charts';
import type { ChartMarker } from '../components/CandleChart';
import type { NewsEvent, NewsImpact } from '../types';

// Impact → colour used for chart markers and list badges.
export const IMPACT_COLOR: Record<NewsImpact, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#64748b',
  holiday: '#6366f1',
};

export const IMPACT_RANK: Record<NewsImpact, number> = {
  high: 3,
  medium: 2,
  low: 1,
  holiday: 0,
};

// Which currencies are relevant to a traded instrument, so overlays aren't
// swamped by unrelated events. XAUUSD/US100 are USD-driven.
export function currenciesForInstrument(instrument: string): string[] | null {
  const s = (instrument || '').toUpperCase();
  if (s.includes('XAU') || s.includes('GOLD')) return ['USD'];
  if (s.includes('US100') || s.includes('NAS') || s.includes('US30') || s.includes('SPX'))
    return ['USD'];
  // forex: both legs (EURUSD → EUR, USD)
  const m = s.match(/^([A-Z]{3})([A-Z]{3})/);
  if (m) return [m[1], m[2]];
  return null; // unknown → don't filter
}

function toTs(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

/**
 * Convert news events into below-bar chart markers, coloured by impact.
 * Only high/medium by default keeps the timeline readable.
 */
export function newsToMarkers(
  events: NewsEvent[],
  minImpact: NewsImpact = 'medium'
): ChartMarker[] {
  const floor = IMPACT_RANK[minImpact];
  return events
    .filter((e) => IMPACT_RANK[e.impact] >= floor)
    .map((e) => ({
      time: toTs(e.dt),
      position: 'belowBar' as const,
      color: IMPACT_COLOR[e.impact],
      shape: 'circle' as const,
      text: e.currency || '•',
    }));
}
