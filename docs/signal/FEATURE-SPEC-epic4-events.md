# FEATURE-SPEC — Epic 4: Events & Reaction Studies

> Bloomberg ECO/ECEV parity: forward economic calendar, historical event-reaction analytics, pre-event risk flags, post-event chart annotation. Cross-instrument (XAUUSD + US100).

## Pre-existing infrastructure

| Component | Status | Location |
|---|---|---|
| ForexFactory feed fetcher + parser | **built** | `server/src/calendar.js` (journal module; writes to journal.db `news_events`) |
| `calendar_events` table in market.db | **schema exists** | `schema.js:132` — no ingestor/route yet |
| OANDA price bars (all TFs) | **built** | `prices` table, 7 timeframes per instrument |
| Price chart (PricePanel) | **built** | `PricePanel.tsx` — SVG candle chart with TF switcher |
| Earnings calendar (Finnhub) | **built** | `ingest/finnhub.js` + EarningsPanel |
| FRED econ series (CPI/PCE/NFP/UNRATE) | **built** | `ingest/fred.js` + EconTracker |

## Data source

**ForexFactory** (free, no key needed) — same feed already used by the journal module:
- This week: `https://nfs.faireconomy.media/ff_calendar_thisweek.json`
- Next week: `https://nfs.faireconomy.media/ff_calendar_nextweek.json`
- Last week: `https://nfs.faireconomy.media/ff_calendar_lastweek.json`

Note: Cloudflare blocks the Docker container's outbound IP. Two fallback paths:
1. `POST /api/research/ingest/calendar` with `{source:'proxy'}` — same CDN-bypass approach as journal's `scripts/ingest-news.mjs` (user runs from host)
2. `POST /api/research/ingest/calendar` with body `{events:[...]}` — manual push from host script

The ingestor will mirror `calendar.js`'s fetch+parse logic but write to market.db's `calendar_events` table instead of journal.db.

## Event-instrument relevance

All ForexFactory events tagged `USD` are relevant to both XAUUSD and US100. Key categories:

| Category | Events | Gold impact | US100 impact |
|---|---|---|---|
| Inflation | CPI, Core CPI, PPI, Core PCE | Strong (real-yield driver) | Strong (Fed path) |
| Employment | NFP, ADP, Initial Claims, Unemployment Rate | Strong (Fed path) | Strong (growth signal) |
| Growth | GDP, Retail Sales, ISM Mfg/Services, Durable Goods | Moderate (risk appetite) | Strong (earnings outlook) |
| Fed | FOMC Statement, Chair Speech, Minutes | Very strong (rate expectations) | Very strong (rate expectations) |
| Housing | Housing Starts, Existing Home Sales | Weak | Moderate |

## Sessions

### S4.1 — Research calendar panel

**Ingestor:** `server/src/research/ingest/calendar.js`
1. Reuse ForexFactory fetch/parse logic from existing `calendar.js`
2. Write to market.db `calendar_events` table (id, ts, country, name, impact, consensus, prior, actual)
3. Cloudflare-aware: try direct fetch first, fall back to manual ingest endpoint
4. `POST /api/research/ingest/calendar` triggers ingest
5. Record health in `source_health`

**Route:** `GET /api/research/calendar?impact=&from=&to=&country=&limit=`

**Response:**
```ts
interface CalendarEvent {
  id: string;
  ts: number;           // epoch ms UTC
  country: string;      // USD, EUR, GBP, etc.
  name: string;         // "Non-Farm Employment Change"
  impact: 'high' | 'medium' | 'low' | 'holiday';
  consensus: number | null;
  prior: number | null;
  actual: number | null;
  countdown: string | null;  // "2h 15m" or null if past
  session: 'asia' | 'europe' | 'us' | 'off';
  isPast: boolean;
}
interface CalendarResponse {
  events: CalendarEvent[];
  count: number;
  nextHighImpact: CalendarEvent | null;
  freshness: Freshness;
}
```

**Panel:** `CalendarPanel.tsx`
- Header: "ECONOMIC CALENDAR" + next-event countdown badge
- Filter row: impact toggle (high/medium/low), country chips (USD default)
- Event rows: time (HH:MM UTC), country flag, name, impact dot, consensus/prior/actual
- Past events: muted text, actual filled (green if beat, red if miss)
- Future events: bright text, countdown timer for next 24h
- Session grouping: ASIA (00-08 UTC) | EUROPE (08-13 UTC) | US (13-21 UTC)
- Highlight: next high-impact event gets amber border

---

### S4.2 — Event-reaction engine

**What:** For a given event type + instrument, show how the market historically reacted across multiple time windows after the release.

**Data required:** `calendar_events` (events with `actual` filled) + `prices` (M5/M15/H1/D1 bars).

**Route:** `GET /api/research/event-reaction/:instrument?event=&limit=`

Query params:
- `instrument`: XAUUSD or US100
- `event`: event name pattern (e.g. "Non-Farm", "CPI", "FOMC"). Matched via `LIKE '%pattern%'`
- `limit`: max historical occurrences (default 24)

**Compute (Node stub — Python deferred):**
```
For each historical occurrence where actual IS NOT NULL:
  1. Find the event timestamp
  2. Look up price bars:
     - pre_price: last M5 close before event
     - post_5m:   M5 close at event+5min
     - post_15m:  M15 close at event+15min
     - post_30m:  M30 close at event+30min  
     - post_60m:  H1 close at event+1h
     - post_1d:   D1 close of event day
  3. Compute move = (post_price - pre_price)
     movePct = move / pre_price * 100
  4. Classify surprise:
     beat = actual > consensus (for employment/growth/inflation metrics)
     miss = actual < consensus
     inline = abs(actual - consensus) < threshold
  5. Note: some events are "lower is better" (unemployment, claims) —
     these need inverted surprise logic. Use a simple heuristic:
     if event name contains "Unemployment" or "Claims" → invert.
```

**Aggregate stats:**
```ts
interface WindowStats {
  window: string;          // '5m' | '15m' | '30m' | '60m' | '1d'
  avgMove: number;         // absolute average points
  avgMovePct: number;      // absolute average %
  avgDirectionalMove: number; // signed average (shows bias)
  upPct: number;           // % times price went up
  downPct: number;         // % times price went down
  maxUp: number;           // biggest up move
  maxDown: number;         // biggest down move (negative)
  sampleSize: number;
}

interface ReactionInstance {
  eventDate: number;       // ts of event
  actual: number | null;
  consensus: number | null;
  prior: number | null;
  surprise: 'beat' | 'miss' | 'inline' | null;
  prePrice: number;
  moves: Record<string, number>;  // { '5m': -12.5, '15m': -18.3, ... }
  movesPct: Record<string, number>;
}

interface EventReactionResponse {
  instrument: string;
  event: string;           // matched event name
  stats: WindowStats[];
  byBeat: WindowStats[];   // filtered to beats only
  byMiss: WindowStats[];   // filtered to misses only
  history: ReactionInstance[];
  sampleSize: number;
  freshness: Freshness;
}
```

**Panel:** `EventReactionPanel.tsx`
- Header: "EVENT REACTION" + event name dropdown/search
- Top section: summary table — columns: window (5m, 15m, 30m, 60m, 1d), avg move, avg %, up%, sample n
- Segmented tabs: ALL | BEAT | MISS
- Bottom section: scrollable history table — date, actual, surprise, move per window (color-coded)
- Event selector: dropdown of most common high-impact events

---

### S4.3 — Event intelligence

**What:** Two features that integrate events into the existing workflow:

#### a) Pre-event risk flags

**Route:** `GET /api/research/events/upcoming?hours=24`

Returns upcoming high-impact events within the window. Used by CalendarPanel to show an alert badge, and could later feed the alerts engine (Epic 8).

**Response:**
```ts
interface UpcomingEvent {
  id: string;
  ts: number;
  name: string;
  impact: string;
  countdown: string;
  hoursAway: number;
}
interface UpcomingResponse {
  events: UpcomingEvent[];
  riskLevel: 'clear' | 'approaching' | 'imminent';  // clear (>4h), approaching (1-4h), imminent (<1h)
}
```

**UI:** In CalendarPanel header: risk badge ("CLEAR" green / "EVENT APPROACHING" amber / "IMMINENT" red).

#### b) Chart event markers

**Route:** `GET /api/research/events/markers/:instrument?tf=&from=&to=`

Returns event timestamps that fall within the chart's visible range, for overlay on PricePanel.

**Response:**
```ts
interface EventMarker {
  ts: number;
  name: string;
  impact: string;
  actual: number | null;
  surprise: 'beat' | 'miss' | 'inline' | null;
}
```

**PricePanel integration:** Small triangle/diamond markers at the bottom of the chart at event timestamps. Color: red (high), amber (medium). Click/hover shows event name. Only high+medium impact USD events shown.

## Build order

| Step | Session | Deliverables | New data needed? |
|---|---|---|---|
| 1 | S4.1 | Calendar ingestor + route + panel | Yes (ForexFactory → market.db) |
| 2 | S4.2 | Event-reaction route + panel | No (joins existing calendar + prices) |
| 3 | S4.3a | Upcoming events route + risk badge | No (reads calendar_events) |
| 4 | S4.3b | Event markers route + PricePanel overlay | No (reads calendar_events) |
| 5 | — | Wire panels into Signal.tsx, tsc, docs | — |

Steps 2-4 all depend on step 1 populating `calendar_events`. Step 2 additionally needs historical events with `actual` filled — which requires past week data.

## New types needed in `web/src/types.ts`

```ts
// S4.1
interface CalendarEvent { id: string; ts: number; country: string; name: string; impact: 'high' | 'medium' | 'low' | 'holiday'; consensus: number | null; prior: number | null; actual: number | null; countdown: string | null; session: 'asia' | 'europe' | 'us' | 'off'; isPast: boolean; }
interface CalendarResponse { events: CalendarEvent[]; count: number; nextHighImpact: CalendarEvent | null; freshness: Freshness; }

// S4.2
interface WindowStats { window: string; avgMove: number; avgMovePct: number; avgDirectionalMove: number; upPct: number; downPct: number; maxUp: number; maxDown: number; sampleSize: number; }
interface ReactionInstance { eventDate: number; actual: number | null; consensus: number | null; prior: number | null; surprise: 'beat' | 'miss' | 'inline' | null; prePrice: number; moves: Record<string, number>; movesPct: Record<string, number>; }
interface EventReactionResponse { instrument: string; event: string; stats: WindowStats[]; byBeat: WindowStats[]; byMiss: WindowStats[]; history: ReactionInstance[]; sampleSize: number; freshness: Freshness; }

// S4.3
interface UpcomingEvent { id: string; ts: number; name: string; impact: string; countdown: string; hoursAway: number; }
interface UpcomingResponse { events: UpcomingEvent[]; riskLevel: 'clear' | 'approaching' | 'imminent'; }
interface EventMarker { ts: number; name: string; impact: string; actual: number | null; surprise: 'beat' | 'miss' | 'inline' | null; }
```

## UI layout (both tabs, after Epic 4)

CalendarPanel and EventReactionPanel are cross-instrument (both XAUUSD and US100 care about USD events). Display them on both tabs.

```
┌─ Both tabs ──────────────────────────────────────────────┐
│ PricePanel (col-8) [+event markers]  │ LiveTicker (col-4)│
│ CalendarPanel (col-6)  │ EventReactionPanel (col-6)      │
│ ... existing instrument-specific panels ...               │
│ ... existing macro panels ...                             │
└──────────────────────────────────────────────────────────┘
```

## Acceptance criteria

- **S4.1:** `POST /ingest/calendar` stores ForexFactory events in market.db. `GET /calendar?impact=high` returns filtered events. Panel renders with countdown timers, session grouping, impact colors.
- **S4.2:** `GET /event-reaction/XAUUSD?event=CPI` returns historical reaction stats across time windows. Panel shows avg-move table + history. Beat/miss segmentation works.
- **S4.3a:** `GET /events/upcoming?hours=24` returns imminent events with risk level. CalendarPanel shows risk badge.
- **S4.3b:** `GET /events/markers/XAUUSD?tf=H1` returns event timestamps for chart overlay. PricePanel shows event markers on the chart.
- **All:** `tsc --noEmit` clean. Docs updated. No console errors in browser.
