# FEATURE-SPEC — Epic 6: News & AI

> Bloomberg N/TOP/NI/CN + BI-style intelligence parity: instrument-tagged news feed with sentiment, grounded daily briefs with full market context, and explain-this-move (click a candle → AI-correlated explanation). Signal-only moat: no Bloomberg desk has explain-this-move.

## Pre-existing infrastructure

| Component | Status | Location |
|---|---|---|
| `news` table (id, ts, source, headline, url, instruments, sentiment) | **schema exists, empty** | `schema.js` line 144 |
| `briefs` table (instrument, date, content, model) | **built** | `schema.js` line 167 |
| `callLLM()` — Ollama + Anthropic dual-provider | **built** | `ai.js` line 129 |
| `BriefPanel` — renders daily brief per instrument | **built** | `BriefPanel.tsx` |
| `GET /api/research/brief/:instrument` | **built (bug fixed)** | `routes.js` line 466 |
| Ingestor pattern (fetch → parse → upsert → source_health) | **built** | `ingest/*.js` |
| Calendar events (ForexFactory) | **built** | `calendar.js` + `calendar_events` table |
| Event-reaction stats | **built** | `routes.js` event-reaction routes |
| Driver scorecard (7 gold drivers) | **built** | `routes.js` driver-scorecard route |
| Regime classifier | **built** | `routes.js` regime route |
| Correlation matrix | **built** | `routes.js` correlation route |
| Positioning (COT + ETF) | **built** | `routes.js` positioning route |
| `NewsItem` TypeScript type | **built** | `types.ts` line 826 |
| Journal-side `NewsPanel` + `news.ts` utils | **built** | `components/NewsPanel.tsx`, `utils/news.ts` |

## Data sources

| Source | Type | Rate limit | Coverage | Notes |
|---|---|---|---|---|
| **GDELT DOC 2.0 API** | REST JSON | ~250 req/hr (undocumented soft) | Rolling 3 months, 65 languages | `api.gdeltproject.org/api/v2/doc/doc?query=...&mode=ArtList&format=json&maxrecords=250` |
| **Kitco RSS** | RSS/XML | polite (1/min) | Gold/silver/PGM news | `kitco.com/feed` |
| **Investing.com RSS** | RSS/XML | polite | Commodities, forex, indices | `investing.com/rss/news.rss` |
| **FXStreet RSS** | RSS/XML | polite | Forex analysis, XAUUSD focus | `fxstreet.com/rss` |
| **Nasdaq Trader RSS** | RSS/XML | polite | Index/market structure news | `nasdaqtrader.com/rss.aspx` |

No API keys required. All free, personal-use compliant.

## Architecture decisions

### Node-first compute (consistent with S2.4/S3.1/S4.2/S5.1)

News ingestion, instrument tagging, and brief generation run in Node. Sentiment scoring uses `callLLM` for batch classification rather than a Python NLP pipeline — keeps the stack simple and the briefs are already LLM-generated.

### Polling, not streaming

GDELT and RSS are polled on intervals (15-min for GDELT, 30-min for RSS). No WebSocket push for news — the feed updates infrequently enough that polling is fine. Manual ingest trigger for initial backfill.

### Dedupe by URL hash

News items are deduped by `id = SHA-256(url)`. Same story from multiple sources keeps the first seen. The `source` field records provenance.

### Sentiment: LLM batch classification

Rather than a keyword/VADER approach, batch 10-20 headlines through `callLLM` with a structured JSON prompt returning `{url_hash, sentiment: -1..1, instruments: [...]}`. This gives instrument tagging + sentiment in one call. Batched to stay within rate limits.

---

## Sessions

### S6.1 — News ingest (GDELT + RSS)

**Scope:** GDELT and RSS ingestors → `news` table, instrument tagging, sentiment scoring, news feed panel, news API routes.

#### Ingestor: `server/src/research/ingest/news.js`

```js
// Exports:
ingestGdelt(queries)    // fetch GDELT for each query term set, upsert into news
ingestRss(feeds)        // fetch + parse RSS feeds, upsert into news
scoreSentiment(items)   // batch LLM sentiment + instrument tagging
getNewsFeed(opts)       // query news table with filters
```

**GDELT fetch flow:**
1. Build query URL per instrument:
   - Gold: `query="gold price" OR "XAUUSD" OR "gold futures" OR "precious metals" OR "gold market" OR "gold rally" OR "gold selloff"&mode=ArtList&format=json&maxrecords=75&timespan=15min`
   - US100: `query="nasdaq" OR "nasdaq 100" OR "tech stocks" OR "QQQ" OR "S&P 500 technology"&mode=ArtList&format=json&maxrecords=75&timespan=15min`
2. Parse JSON response → extract `{url, title, seendate, domain, sourcecountry, language}`.
3. Filter: English only (`language === 'English'`), dedupe by `id = sha256(url)`.
4. Upsert into `news` table with `instruments = 'XAUUSD'` or `instruments = 'US100'` based on which query matched. Articles matching both get CSV `'XAUUSD,US100'`.

**RSS fetch flow:**
1. Fetch each RSS feed URL, parse XML → extract `{title, link, pubDate, description}`.
2. Use a simple XML parser (inline regex or `fast-xml-parser` if already in deps — check first).
3. Map to news schema: `id = sha256(link)`, `ts = Date.parse(pubDate)`, `source = domain`, `headline = title`, `url = link`.
4. Instrument tagging by keyword scan of headline+description:
   - Gold keywords: gold, XAUUSD, XAU, precious metal, bullion, GLD, gold futures
   - US100 keywords: nasdaq, QQQ, US100, NAS100, tech stocks, S&P 500, Mag-7, AAPL, MSFT, NVDA, AMZN, GOOG, META, TSLA
   - Both if both match; skip if neither (general market news kept with `instruments = NULL`)
5. Upsert into `news`.

**Sentiment scoring (deferred batch):**
After ingest, items with `sentiment IS NULL` get batched through `callLLM`:
```
System: Score sentiment of each headline for its financial market impact.
Return JSON array: [{id, sentiment, instruments}]
- sentiment: -1.0 (very bearish) to 1.0 (very bullish), 0 = neutral
- instruments: array of affected symbols from [XAUUSD, US100]

User: [batch of 15 headlines with ids]
```
Update `news` rows with sentiment scores. If LLM unavailable, leave sentiment NULL (panel shows "unscored").

#### Route: `POST /api/research/ingest/news`

Triggers GDELT + RSS ingest. Returns `{gdelt: {inserted, skipped}, rss: {inserted, skipped}, scored: number}`.

#### Route: `GET /api/research/news`

Query params: `?instrument=XAUUSD&limit=50&since=<epoch_ms>&sentiment=bearish|bullish|neutral&source=gdelt|rss`

```ts
interface NewsResponse {
  items: NewsItem[];    // existing type from types.ts
  total: number;
  asOf: number;
}
```

Filters:
- `instrument`: filter where `instruments LIKE '%XAUUSD%'`
- `sentiment=bearish`: `sentiment < -0.2`, `bullish`: `> 0.2`, `neutral`: `-0.2..0.2`
- `since`: `ts > ?`
- `source`: exact match on source column
- Default sort: `ts DESC`

#### Route: `GET /api/research/news/summary`

Returns aggregated stats for the header badge:
```ts
interface NewsSummary {
  total24h: number;
  bullish: number;
  bearish: number;
  neutral: number;
  topSources: {source: string; count: number}[];
  lastIngest: number;   // epoch ms
}
```

#### Panel: `NewsFeedPanel.tsx`

Full-width panel (span 12). Sections:
- **Header:** "NEWS FEED" + instrument filter tabs (ALL / XAUUSD / US100) + sentiment badge (net sentiment arrow) + count badge
- **Feed:** scrollable list of headlines, newest first
  - Each row: `[timestamp] [source badge] [headline] [sentiment dot: green/red/gray]`
  - Sentiment dot: green = bullish (>0.2), red = bearish (<-0.2), gray = neutral/unscored
  - Click headline → opens URL in new tab
  - Hover → shows full headline if truncated
- **Footer:** last ingest time + manual refresh button

Uses existing `Panel` terminal component. Max 50 items displayed, "load more" button for pagination.

#### API client additions (`web/src/api/client.ts`)

```ts
getNewsFeed: (opts: {instrument?: string; limit?: number; since?: number}) =>
  request<NewsResponse>(`/research/news?${qs(opts)}`),

getNewsSummary: () =>
  request<NewsSummary>('/research/news/summary'),

triggerNewsIngest: () =>
  request<unknown>('/research/ingest/news', { method: 'POST', body: '{}' }),
```

#### Types additions (`web/src/types.ts`)

```ts
interface NewsResponse {
  items: NewsItem[];
  total: number;
  asOf: number;
}

interface NewsSummary {
  total24h: number;
  bullish: number;
  bearish: number;
  neutral: number;
  topSources: {source: string; count: number}[];
  lastIngest: number;
}
```

---

### S6.2 — Enhanced daily briefs

**Scope:** Upgrade the existing brief endpoint from 3-5 bullet points to a structured, grounded daily brief that includes news, events, positioning, drivers, regime — the "BI-style morning note."

#### Route changes: `GET /api/research/brief/:instrument` (enhance existing)

Context gathering (expand current):
1. **Price:** last 10 D1 bars (existing)
2. **Vol:** latest VXN/GVZ + percentile (existing)
3. **Mag-7 weights** for US100 (existing)
4. **News:** last 24h headlines for this instrument (NEW — from `news` table, top 10 by recency)
5. **Calendar:** upcoming 48h events with high/medium impact (NEW — from `calendar_events`)
6. **Regime:** current risk regime label + factor scores (NEW — from regime route logic)
7. **Positioning:** latest COT/ETF summary for XAUUSD (NEW — from positioning data)
8. **Drivers:** latest driver scorecard composite for XAUUSD (NEW — from driver scorecard logic)
9. **Correlation:** notable correlation shifts >0.3 in 20d vs 60d window (NEW)

Enhanced system prompt:
```
You are a senior market analyst at a Bloomberg-style terminal. Write a structured daily brief for {instrument}.

Format:
## Market Snapshot
1-2 sentences: price, trend direction, key level proximity.

## Key Drivers Today
2-3 bullets: what's moving the market (news, events, macro).

## Risk Assessment
1-2 bullets: regime, vol read, positioning extremes.

## What to Watch
2-3 bullets: upcoming events, levels, catalysts.

Rules: Use ONLY the data provided. Never invent numbers. Be specific with prices and levels. If data is missing, say "data unavailable" for that section.
```

#### Schema change: `briefs` table

Add `brief_type` column to distinguish basic vs enhanced:
```sql
ALTER TABLE briefs ADD COLUMN brief_type TEXT DEFAULT 'basic';
```

Cache key changes from `(instrument, date)` to `(instrument, date, brief_type)`.

New upsert uses `brief_type = 'enhanced'`. Old basic briefs remain readable.

#### BriefPanel changes

- Add a "style" toggle: "Quick" (existing 3-5 bullets) vs "Full" (enhanced structured brief)
- Full mode renders with markdown-style section headers (## → bold + underline in terminal theme)
- Loading state shows "Generating brief..." with a subtle animation
- Brief sections rendered with proper spacing and terminal styling

---

### S6.3 — Explain-this-move

**Scope:** Click a candle on the chart → server correlates price move with news/events/drivers/regime → Claude generates a grounded explanation. This is the Signal-only moat — Bloomberg has no equivalent.

#### Route: `POST /api/research/explain-move`

Request body:
```ts
interface ExplainMoveRequest {
  instrument: string;         // XAUUSD or US100
  timestamp: number;          // epoch ms of the candle
  timeframe: string;          // M5, M15, H1, H4, D1
  direction: 'up' | 'down';  // inferred from O vs C
  magnitude: number;          // absolute % move
}
```

Response:
```ts
interface ExplainMoveResponse {
  instrument: string;
  timestamp: number;
  explanation: string;        // AI-generated markdown
  evidence: ExplainEvidence;  // structured data backing the explanation
  model: string;
  cached: boolean;
}

interface ExplainEvidence {
  nearbyNews: NewsItem[];           // ±2h window
  nearbyEvents: CalendarEvent[];    // ±4h window
  regimeAtTime: string;            // risk-on/off/neutral
  driverChanges: {driver: string; before: number; after: number}[];
  correlatedMoves: {symbol: string; move: number}[];
}
```

Server logic:
1. Validate instrument + timestamp. Resolve candle OHLC from `prices`.
2. Compute move stats: `direction`, `magnitude = abs((c-o)/o * 100)`, `range = (h-l)/o * 100`.
3. Gather evidence window:
   - **News:** `SELECT * FROM news WHERE instruments LIKE ? AND ts BETWEEN ? AND ? ORDER BY ts` (±2h for intraday, ±12h for D1)
   - **Events:** `SELECT * FROM calendar_events WHERE ts BETWEEN ? AND ?` (±4h for intraday, ±24h for D1)
   - **Regime:** compute regime state at that timestamp (use nearest daily VIX/HY values)
   - **Correlated moves:** fetch same-window OHLC for correlated instruments (DXY, yields, VIX for gold; VIX, yields for US100)
4. Build prompt with all evidence + price action context.
5. `callLLM` with structured prompt requesting explanation.
6. Cache in a new `explanations` table (keyed by `instrument + timestamp + timeframe`).

System prompt:
```
You are a market microstructure analyst. Explain why {instrument} moved {direction} {magnitude}% at {time}.

Use ONLY the evidence provided. Structure your response:
1. **Most likely driver** (1-2 sentences) — the single biggest factor
2. **Supporting factors** (2-3 bullets) — other contributors
3. **Context** (1 sentence) — regime/positioning backdrop

If the evidence doesn't clearly explain the move, say so — "this appears to be a positioning/flow-driven move without a clear news catalyst."
```

#### Schema: `explanations` table (new)

```sql
CREATE TABLE IF NOT EXISTS explanations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument TEXT NOT NULL,
  ts INTEGER NOT NULL,
  timeframe TEXT NOT NULL,
  explanation TEXT,
  evidence_json TEXT,
  model TEXT,
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  UNIQUE(instrument, ts, timeframe)
);
```

#### PricePanel integration

Add click handler to candle chart:
- Click a candle → show a small "Explain this move" button/tooltip
- Button triggers `POST /explain-move` with candle data
- Opens an inline expandable panel below the chart (or a modal) showing the explanation
- Evidence items are clickable (news headlines link out, events show detail)
- Loading state: "Analyzing move..." with pulse animation

#### API client additions

```ts
explainMove: (body: ExplainMoveRequest) =>
  request<ExplainMoveResponse>('/research/explain-move', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
```

#### ExplainMovePanel.tsx (inline panel)

Renders below PricePanel when an explanation is active:
- Terminal-styled markdown rendering of the explanation
- Collapsible "Evidence" section showing the raw data:
  - News headlines with timestamps
  - Calendar events with actual vs consensus
  - Correlated instrument moves
  - Regime state
- "Close" button to dismiss
- Cached indicator badge

---

## Wire-up in Signal.tsx

```tsx
// New imports
import NewsFeedPanel from '../panels/NewsFeedPanel';

// In the panel grid, after correlation panels (cross-instrument):
<NewsFeedPanel instrument={instrument} />
```

BriefPanel already exists in both instrument sections — the S6.2 changes are internal to the component.

ExplainMovePanel is rendered conditionally inside/below PricePanel, not as a standalone grid panel.

## Accept criteria

| Session | Green when |
|---|---|
| S6.1 | `POST /ingest/news` fetches GDELT + RSS; `GET /news?instrument=XAUUSD` returns tagged, sentiment-scored items; `NewsFeedPanel` renders in terminal |
| S6.2 | `GET /brief/XAUUSD` returns structured multi-section brief with news/events/regime context; BriefPanel renders sections with proper formatting |
| S6.3 | Click candle → "Explain" button → `POST /explain-move` → grounded explanation with evidence; explanation renders inline below chart |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| GDELT rate limiting (undocumented) | 15-min polling interval; cache aggressively; fall back to RSS-only if blocked |
| RSS feed format changes | Robust XML parsing with fallback; source_health tracking per feed |
| LLM unavailable for sentiment | Sentiment column stays NULL; panel shows "unscored" items without blocking |
| LLM cost for explain-move | Cache explanations; only generate on explicit user click, never auto |
| Stale news (3-month GDELT window) | `timespan=15min` on polling queries; only show last 48h in panel by default |
| No news for a candle's time window | Explanation says "no clear news catalyst — likely flow/positioning driven" |
