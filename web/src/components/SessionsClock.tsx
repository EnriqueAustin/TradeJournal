import { useEffect, useMemo, useState } from 'react';
import { DISPLAY_TZ } from '../utils/format';

// Forex-Factory-style session clock. A 24-hour axis in the viewer's timezone,
// one row per major FX market, each drawn where it is open on *your* clock, with
// that market's current local time and a live "now" marker.
//
// All market hours are defined in the market's own local time and projected onto
// the viewer axis via the live UTC offsets, so the bars track DST automatically.

type Market = {
  key: string;
  name: string;
  tz: string;
  open: number; // minutes from local midnight
  close: number;
  color: string; // rgb triplet
};

// Session windows mirror server/src/util.js MKT (local market hours).
const MARKETS: Market[] = [
  { key: 'sydney', name: 'Sydney', tz: 'Australia/Sydney', open: 7 * 60, close: 16 * 60, color: '245,158,11' },
  { key: 'tokyo', name: 'Tokyo', tz: 'Asia/Tokyo', open: 9 * 60, close: 18 * 60, color: '236,72,153' },
  { key: 'london', name: 'London', tz: 'Europe/London', open: 8 * 60, close: 17 * 60, color: '59,130,246' },
  { key: 'newyork', name: 'New York', tz: 'America/New_York', open: 8 * 60, close: 17 * 60, color: '34,197,94' },
];

// Minutes east of UTC for a zone at a given instant (DST-aware).
function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  let hour = parseInt(m.hour, 10);
  if (hour === 24) hour = 0;
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, hour, +m.minute, +m.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

// HH:mm in a zone.
function localTime(date: Date, tz: string): string {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  });
}

const AXIS_TICKS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

export default function SessionsClock({ tz = DISPLAY_TZ }: { tz?: string }) {
  // Re-render each minute so the "now" line and clocks stay live.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const model = useMemo(() => {
    const userOffset = tzOffsetMinutes(now, tz);
    // Viewer-local minutes since midnight, for the "now" marker.
    const nowLocal =
      (parseInt(localTime(now, tz).slice(0, 2), 10) * 60 +
        parseInt(localTime(now, tz).slice(3, 5), 10)) %
      (24 * 60);

    const rows = MARKETS.map((mk) => {
      const delta = userOffset - tzOffsetMinutes(now, mk.tz); // market-local → user-local
      const start = ((mk.open + delta) % 1440 + 1440) % 1440;
      const end = ((mk.close + delta) % 1440 + 1440) % 1440;
      // A window may wrap past viewer midnight → up to two segments.
      const segs: { left: number; width: number }[] =
        start < end
          ? [{ left: start, width: end - start }]
          : [
              { left: start, width: 1440 - start },
              { left: 0, width: end },
            ];
      const mkMin =
        parseInt(localTime(now, mk.tz).slice(0, 2), 10) * 60 +
        parseInt(localTime(now, mk.tz).slice(3, 5), 10);
      const isOpen = mkMin >= mk.open && mkMin < mk.close;
      return { ...mk, segs, localLabel: localTime(now, mk.tz), isOpen };
    });

    return { rows, nowLocal };
  }, [now, tz]);

  const nowPct = (model.nowLocal / 1440) * 100;

  return (
    <div className="select-none">
      {/* hour axis */}
      <div className="relative ml-24 mb-1 h-4">
        {AXIS_TICKS.map((h) => (
          <span
            key={h}
            className="absolute -translate-x-1/2 text-[10px] text-slate-500 num"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
          </span>
        ))}
      </div>

      <div className="relative">
        {/* now marker spanning all rows, aligned to the track (starts at 6rem) */}
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-10 border-l border-amber-400/70"
          style={{ left: `calc(6rem + (100% - 6rem) * ${nowPct / 100})` }}
        >
          <span className="absolute -top-0 left-1 whitespace-nowrap text-[9px] font-semibold text-amber-400">
            now
          </span>
        </div>

        <div className="space-y-1.5">
          {model.rows.map((r) => (
            <div key={r.key} className="flex items-center">
              <div className="flex w-24 shrink-0 items-center gap-1.5 pr-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${r.isOpen ? '' : 'opacity-30'}`}
                  style={{ background: `rgb(${r.color})` }}
                />
                <span className="text-xs text-slate-300">{r.name}</span>
              </div>
              <div className="relative h-6 flex-1 overflow-hidden rounded bg-slate-900/60 ring-1 ring-inset ring-slate-800">
                {/* faint hour gridlines */}
                {AXIS_TICKS.map((h) => (
                  <div
                    key={h}
                    className="absolute bottom-0 top-0 border-l border-slate-800/50"
                    style={{ left: `${(h / 24) * 100}%` }}
                  />
                ))}
                {r.segs.map((s, i) => (
                  <div
                    key={i}
                    className="absolute bottom-0.5 top-0.5 rounded-sm"
                    style={{
                      left: `${(s.left / 1440) * 100}%`,
                      width: `${(s.width / 1440) * 100}%`,
                      background: `rgba(${r.color},${r.isOpen ? 0.55 : 0.28})`,
                      boxShadow: r.isOpen ? `inset 0 0 0 1px rgba(${r.color},0.9)` : 'none',
                    }}
                  />
                ))}
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] num text-slate-400">
                  {r.localLabel} {r.isOpen ? 'open' : 'closed'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
