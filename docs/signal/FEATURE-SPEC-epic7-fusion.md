# FEATURE-SPEC — Epic 7: Journal Fusion

> Bloomberg has no equivalent. This is the moat — the only system that captures **full market context at trade entry**, replays it for post-trade review, and statistically correlates your edge with driver/regime states. Signal-only features: context snapshots, condition replay, edge analytics, AI debrief coach.

## Pre-existing infrastructure

| Component | Status | Location |
|---|---|---|
| `context_snapshots` table (trade_id PK, ts, payload_json) | **schema exists, empty** | `schema.js` line 190 |
| `ContextSnapshot` TypeScript type | **built** | `types.ts` line 897 |
| `context_snapshots` round-trip test | **built** | `schema.test.js` line 86 |
| `insertTradeTx()` — central trade insertion (CSV/EA/backtest) | **built** | `index.js` line 86 |
| `TradeDetail` page (header/chart/tags/notes/screenshots/partials) | **built** | `TradeDetail.tsx` |
| Regime classifier (`/regime`) | **built** | `routes.js` line 681 |
| Driver scorecard (`/drivers/XAUUSD`) | **built** | `routes.js` line 777 |
| Vol panel data (`/vol/:instrument`) | **built** | `routes.js` line 403 |
| Calendar events (`/calendar`, `/events/upcoming`) | **built** | `routes.js` lines 1393/1434 |
| COT positioning (`/cot/gold`) | **built** | `routes.js` line 1170 |
| ETF flows (`/etf-flows/gold`) | **built** | `routes.js` line 1255 |
| Rates board (`/rates`) | **built** | `routes.js` line 593 |
| Correlation matrix (`/correlation`) | **built** | `routes.js` line 1709 |
| Positioning consolidated (`/positioning/:instrument`) | **built** | `routes.js` line 1987 |
| News feed (`/news`) | **built** | `routes.js` line 2074 |
| `callLLM()` — Ollama + Anthropic dual-provider | **built** | `ai.js` |
| `market.db` + `journal.db` — two-DB architecture | **built** | `ARCHITECTURE.md` |

## What gets captured (snapshot payload schema)

A context snapshot is a **point-in-time JSON object** saved when a trade is logged. It must be self-contained — replay should not need to re-query live APIs. The payload captures every Signal dimension that was available at entry time.

### Payload shape (`payload_json`)

```jsonc
{
  "version": 1,
  "captured_at": 1692300000000,    // epoch ms when snapshot was taken
  "instrument": "XAUUSD",

  // Price context
  "price": {
    "last": 2425.30,
    "daily_open": 2418.50,
    "daily_high": 2430.10,
    "daily_low": 2415.20,
    "prev_close": 2420.00
  },

  // Regime
  "regime": {
    "label": "risk-off",           // risk-on/neutral/risk-off/crisis
    "score": -1,
    "factors": [
      { "name": "VIX", "value": 22.5, "signal": "bearish" },
      { "name": "HY Spread", "value": 4.2, "signal": "neutral" }
    ]
  },

  // Macro rates snapshot
  "rates": {
    "DGS2": 4.85, "DGS10": 4.25, "DGS30": 4.45,
    "DFII5": 1.95, "DFII10": 1.90,
    "T10YIE": 2.35, "T5YIE": 2.30,
    "DTWEXBGS": 104.2,
    "FEDFUNDS": 5.33,
    "BAMLH0A0HYM2": 4.2,
    "spread_2s10s": -0.60
  },

  // Drivers (XAUUSD only — null for US100)
  "drivers": {
    "composite": { "score": 0.14, "label": "neutral" },
    "items": [
      { "id": "DFII10", "value": 1.90, "zScore": 0.45, "signal": "neutral", "correlation": -0.72 }
      // ... all 7 drivers
    ]
  },

  // Vol
  "vol": {
    "vix": 22.5, "vxn": 24.1, "gvz": 15.8,
    "instrument_iv": 15.8,        // GVZ for gold, VXN for US100
    "percentile_60d": 42,
    "expected_move_1d": 28.5
  },

  // Positioning (XAUUSD only)
  "positioning": {
    "cot_net_mm": 185000,
    "cot_pct_long": 68.5,
    "cot_wow_delta": -5200,
    "cot_percentile_1y": 72,
    "etf_tonnes": 878.5,
    "etf_daily_delta": 1.2,
    "etf_trend": "inflow"
  },

  // Calendar (next 24h high-impact events)
  "upcoming_events": [
    { "name": "CPI MoM", "ts": 1692350000000, "impact": "high", "consensus": 0.2, "prior": 0.2 }
  ],

  // Recent news (last 6h, top 5 by relevance)
  "recent_news": [
    { "headline": "Fed officials signal September pause", "source": "Reuters", "sentiment": -0.3, "ts": 1692290000000 }
  ],

  // Correlations (60d window, key pairs)
  "correlations": {
    "window": 60,
    "pairs": {
      "XAUUSD_DGS10": -0.72,
      "XAUUSD_DTWEXBGS": -0.68,
      "XAUUSD_US100": 0.15
    }
  },

  // Key levels (nearest 3 above + below)
  "key_levels": {
    "above": [{ "price": 2450, "label": "R1" }, { "price": 2475, "label": "$50 round" }],
    "below": [{ "price": 2400, "label": "S1" }, { "price": 2380, "label": "prev week low" }]
  },

  // Seasonality (current month/dow stats)
  "seasonality": {
    "month": { "name": "Aug", "avg_return": -0.8, "win_rate": 42 },
    "dow": { "name": "Thu", "avg_return": 0.12, "win_rate": 55 }
  }
}
```

Fields are **nullable** — if a data source has no data (e.g., COT not ingested), that section is `null` rather than omitted. Version field supports future schema evolution.

## Sessions

### S7.1 — Context snapshots

**Goal:** When a trade is logged (any path: CSV import, EA webhook, API), automatically capture a full market-state snapshot into `context_snapshots`.

**Implementation:**

1. **Server-side `captureSnapshot(tradeId, instrument, entryTime)` function** in `server/src/research/snapshot.js`:
   - Queries all available Signal data sources (regime, drivers, vol, rates, positioning, calendar, news, correlations, levels, seasonality) using the same DB queries the API routes use
   - Builds the payload object above
   - Inserts into `context_snapshots` (upsert by trade_id)
   - Returns the payload for immediate use
   - Best-effort: if market.db has no data for a section, that section = null (never blocks trade insertion)

2. **Hook into `insertTradeTx()`**: after successful trade insert, call `captureSnapshot()` asynchronously (fire-and-forget — trade insert must never fail due to snapshot capture). Only for non-backtest trades (`is_backtest = 0`).

3. **Manual capture endpoint**: `POST /api/research/snapshot/:tradeId` — for retroactive capture on existing trades (useful for already-logged trades that predate the feature).

4. **Read endpoint**: `GET /api/research/snapshot/:tradeId` — returns the stored snapshot.

5. **Batch capture**: `POST /api/research/snapshot/batch` — accepts `{ tradeIds: number[] }`, captures snapshots for multiple trades. For backfilling existing trades.

**Accept:** New trades get a `context_snapshots` row automatically. Manual trigger works for existing trades. Payload contains all available market dimensions.

### S7.2 — Context tab + replay on TradeDetail

**Goal:** Add a "Market Context" tab to TradeDetail showing the frozen market state at trade entry, with visual replay of all key panels.

**Implementation:**

1. **`ContextTab` component** (`web/src/features/signal/panels/ContextTab.tsx`):
   - Fetches `GET /api/research/snapshot/:tradeId`
   - Renders the snapshot as a dense terminal-themed dashboard (reuses `.sig` terminal tokens)
   - Sections match the Signal panels but render from frozen data, not live:
     - **Header**: instrument, entry price, entry time, regime badge, composite driver label
     - **Rates snapshot**: compact key rates grid (2Y/10Y/30Y real/nominal, DXY, fed funds, HY spread)
     - **Drivers mini-scorecard** (XAUUSD only): 7 drivers with z-score bars + signals
     - **Vol snapshot**: IV + percentile + expected move
     - **Positioning snapshot** (XAUUSD only): COT net/pct/percentile + ETF tonnes/trend
     - **Upcoming events**: list of high-impact events that were approaching at entry
     - **Recent news**: top headlines with sentiment at entry time
     - **Key levels**: nearest levels above/below entry price with distance
     - **Correlations**: compact heatmap row for key pairs
     - **Seasonality**: month + dow stats
   - "No snapshot" empty state with "Capture Now" button (calls manual endpoint)

2. **Integration into `TradeDetail.tsx`**:
   - Add tab bar to TradeDetail: **Details** (existing content) | **Market Context** (new)
   - Tab state via URL search param `?tab=context` or local state
   - Context tab lazy-loads only when selected

3. **Condition replay**:
   - "Replay in Signal" button on ContextTab — navigates to `/research?replay=<tradeId>`
   - Signal page detects `?replay=` param, loads the snapshot, overlays frozen data on all panels with an amber "REPLAY" badge and the trade's entry time
   - "Exit Replay" button returns to live mode

**Accept:** TradeDetail has a Market Context tab. Snapshot renders all available sections. Replay mode shows frozen state on Signal page.

### S7.3 — Edge analytics + AI debrief

**Goal:** Statistical analysis of how your trading performance correlates with market conditions, plus AI coaching notes on closed trades.

**Implementation:**

1. **Edge analytics endpoint**: `GET /api/research/edge/:instrument`
   - Joins `context_snapshots` with journal.db `trades` (cross-DB read)
   - Aggregates P&L by:
     - **Regime**: win rate / avg R / expectancy per regime (risk-on/neutral/risk-off/crisis)
     - **Driver composite**: performance when tailwind vs headwind vs neutral
     - **Vol regime**: performance in high-vol (>75th pctl) vs low-vol (<25th pctl)
     - **Session**: performance by asia/london/overlap/ny
     - **Day of week**: performance by dow
     - **Event proximity**: performance within 2h of high-impact event vs clean
     - **Positioning extreme**: performance when COT at extreme vs normal
   - Returns arrays of `{ category, bucket, trades_n, win_rate, avg_r, expectancy, avg_pnl }` per dimension
   - Minimum sample size: 5 trades per bucket (below that = "insufficient data")

2. **`EdgePanel` component** (`web/src/features/signal/panels/EdgePanel.tsx`):
   - Lives on the Signal page (new cockpit section) AND on a new "Edge" tab in TradeDetail
   - Renders edge table per dimension: bars showing win rate by bucket, color-coded (green >55%, amber 45-55%, red <45%)
   - "Best edge" callout: highlights the condition combo with highest expectancy
   - Sample size badge per bucket

3. **AI debrief endpoint**: `POST /api/research/debrief/:tradeId`
   - Reads the trade from journal.db (direction, entry/exit, P&L, R, setup, tags, notes)
   - Reads the context snapshot from market.db
   - Reads the edge analytics for this instrument
   - Calls `callLLM()` with a structured coaching prompt:
     - "You are a trading coach reviewing this trade with full market context."
     - Includes: trade details, market snapshot at entry, edge stats for the conditions
     - Asks: Was this a good setup given the conditions? What did the trader do well? What could improve? Does the edge data support this type of trade?
   - Caches result in a new `debriefs` table (trade_id PK, content, model, created_at)
   - Returns the debrief text

4. **`DebriefPanel` component** on TradeDetail's Market Context tab:
   - "Get AI Debrief" button (calls debrief endpoint)
   - Renders markdown-style coaching note
   - Shows cached debrief if already generated
   - "Regenerate" button for fresh analysis

**Accept:** Edge table shows performance by regime/drivers/vol/session/dow/events. AI debrief gives grounded coaching note per trade.

## Schema changes

### market.db additions
```sql
-- Already exists:
-- context_snapshots(trade_id INTEGER PK, ts INTEGER NOT NULL, payload_json TEXT)

-- New for S7.3:
CREATE TABLE IF NOT EXISTS debriefs (
  trade_id INTEGER PRIMARY KEY,
  content TEXT,
  model TEXT,
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);
```

### No journal.db changes
The bridge is one-directional: market.db references journal.db trade IDs. Journal.db stays untouched.

## API routes

| Method | Path | Session | Description |
|---|---|---|---|
| POST | `/api/research/snapshot/:tradeId` | S7.1 | Manually capture snapshot for a trade |
| POST | `/api/research/snapshot/batch` | S7.1 | Batch capture for multiple trades |
| GET | `/api/research/snapshot/:tradeId` | S7.1 | Read stored snapshot |
| GET | `/api/research/edge/:instrument` | S7.3 | Edge analytics by condition |
| POST | `/api/research/debrief/:tradeId` | S7.3 | Generate AI debrief for a trade |
| GET | `/api/research/debrief/:tradeId` | S7.3 | Read cached debrief |

## TypeScript types (additions to `types.ts`)

```typescript
export interface SnapshotPrice {
  last: number; daily_open: number; daily_high: number;
  daily_low: number; prev_close: number;
}
export interface SnapshotRegime {
  label: string; score: number;
  factors: Array<{ name: string; value: number; signal: string }>;
}
export interface SnapshotDriver {
  id: string; value: number | null; zScore: number | null;
  signal: string; correlation: number | null;
}
export interface SnapshotDrivers {
  composite: { score: number; label: string };
  items: SnapshotDriver[];
}
export interface SnapshotVol {
  vix: number | null; vxn: number | null; gvz: number | null;
  instrument_iv: number | null; percentile_60d: number | null;
  expected_move_1d: number | null;
}
export interface SnapshotPositioning {
  cot_net_mm: number | null; cot_pct_long: number | null;
  cot_wow_delta: number | null; cot_percentile_1y: number | null;
  etf_tonnes: number | null; etf_daily_delta: number | null;
  etf_trend: string | null;
}
export interface SnapshotEvent {
  name: string; ts: number; impact: string;
  consensus: number | null; prior: number | null;
}
export interface SnapshotNews {
  headline: string; source: string; sentiment: number | null; ts: number;
}
export interface SnapshotCorrelations {
  window: number; pairs: Record<string, number>;
}
export interface SnapshotLevel {
  price: number; label: string;
}
export interface SnapshotSeasonality {
  month: { name: string; avg_return: number; win_rate: number } | null;
  dow: { name: string; avg_return: number; win_rate: number } | null;
}

export interface ContextSnapshotPayload {
  version: number;
  captured_at: number;
  instrument: string;
  price: SnapshotPrice | null;
  regime: SnapshotRegime | null;
  rates: Record<string, number> | null;
  drivers: SnapshotDrivers | null;
  vol: SnapshotVol | null;
  positioning: SnapshotPositioning | null;
  upcoming_events: SnapshotEvent[] | null;
  recent_news: SnapshotNews[] | null;
  correlations: SnapshotCorrelations | null;
  key_levels: { above: SnapshotLevel[]; below: SnapshotLevel[] } | null;
  seasonality: SnapshotSeasonality | null;
}

export interface EdgeBucket {
  category: string;
  bucket: string;
  trades_n: number;
  win_rate: number;
  avg_r: number | null;
  expectancy: number | null;
  avg_pnl: number;
}

export interface EdgeAnalytics {
  instrument: string;
  dimensions: Record<string, EdgeBucket[]>;
  best_edge: { dimension: string; bucket: string; expectancy: number } | null;
  total_trades: number;
}

export interface Debrief {
  trade_id: number;
  content: string;
  model: string;
  created_at: number;
}
```

## File plan

| File | Action | Session |
|---|---|---|
| `server/src/research/snapshot.js` | NEW — captureSnapshot(), gatherPrice/Regime/Drivers/Vol/etc helpers | S7.1 |
| `server/src/research/routes.js` | ADD snapshot/edge/debrief routes | S7.1 + S7.3 |
| `server/src/research/schema.js` | ADD debriefs table | S7.3 |
| `server/src/index.js` | HOOK captureSnapshot into insertTradeTx | S7.1 |
| `web/src/features/signal/panels/ContextTab.tsx` | NEW — frozen market context dashboard | S7.2 |
| `web/src/features/signal/panels/EdgePanel.tsx` | NEW — edge analytics bars | S7.3 |
| `web/src/features/signal/panels/DebriefPanel.tsx` | NEW — AI coaching note | S7.3 |
| `web/src/pages/TradeDetail.tsx` | ADD tab bar (Details / Market Context) | S7.2 |
| `web/src/features/signal/pages/Signal.tsx` | ADD replay mode (frozen panels from snapshot) | S7.2 |
| `web/src/api/client.ts` | ADD snapshot/edge/debrief API methods | S7.1–S7.3 |
| `web/src/types.ts` | ADD snapshot payload types, EdgeBucket, Debrief | S7.1 |
| `docs/signal/BLOOMBERG-PARITY.md` | UPDATE fusion rows to `built` | S7.3 |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Snapshot capture slows trade insertion | Fire-and-forget async; never blocks insertTradeTx |
| Cross-DB join for edge analytics | Attach journal.db as read-only in market.db queries (SQLite ATTACH), or read trade IDs from journal.db first then join in JS |
| Snapshot payload grows large | Version field allows migration; compress with gzip if >50KB (unlikely) |
| Edge analytics meaningless with few trades | Minimum 5 trades per bucket; "insufficient data" badge |
| AI debrief hallucinates | Ground with full context + edge stats; structured prompt limits creativity |
| Replay mode complexity | Replay only overrides data, not panel components — panels check for replay context and render frozen data |
