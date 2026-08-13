# BUILD-LOG (append-only)

Newest entries at the top. One block per session: what shipped, decisions, gotchas, files touched.

---

## 2026-08-13 — Epic 1: US100 Cockpit (S1.1–S1.7) ✓
**By:** Claude. **Status:** shipped + browser-verified.

**Shipped (S1.1 — Constituents + live quotes):**
- `server/src/research/ingest/constituents.js`: QQQ top-40 constituents with weights + sectors. `ingestConstituents()` stores to `constituents` table; `getConstituents()` queries latest snapshot; `isMag7()` for Mag-7 tagging.
- `server/src/research/ingest/alpaca.js`: Alpaca IEX REST API `fetchSnapshots(symbols)` — returns price/bid/ask/OHLCV/prevClose/change/changePct per symbol. Chunks >50 symbols.
- Route: `GET /api/research/constituents/us100` — members + weights + live Alpaca quotes + freshness.
- `web/src/features/signal/panels/ConstituentTable.tsx`: full member table (40 rows) with symbol, sector, weight, price, change, change%, volume. Mag-7 tagged with purple M7 badge.

**Shipped (S1.2 — Contribution grid + leaderboard):**
- Route: `GET /api/research/contribution/us100` — weight×move = contribution per member + sector aggregation + Mag-7 summary (totalContrib, mag7Contrib, broadContrib, mag7Weight, broadVsNarrow).
- `web/src/features/signal/panels/ContributionGrid.tsx`: sortable grid (Impact/Weight/Chg%/A-Z), summary bar, contribution bar sparklines, Show All toggle. Replaces S0.3 placeholder.

**Shipped (S1.3 — Breadth + sector treemap):**
- Route: `GET /api/research/breadth/us100` — advancers/decliners/unchanged/A:D ratio + treemap data.
- `web/src/features/signal/panels/BreadthPanel.tsx`: A/D stats, A/D bar, mini heatmap treemap (top-20 by weight, color-coded green/red).

**Shipped (S1.4 — Rate overlay + FRED ingest):**
- `server/src/research/ingest/fred.js`: FRED series ingestor — registry of 8 series (DGS2/10/30, DFII5/10, T10YIE/T5YIE, DTWEXBGS). `ingestFredSeries()`, `ingestAllFred()`, `getSeriesData()`, `getSeriesMeta()`, `listSeries()`.
- Routes: `GET /api/research/series/:id`, `GET /api/research/series`, `POST /api/research/ingest/fred`, `GET /api/research/overlay/us100/rates`.
- `web/src/features/signal/panels/RateOverlay.tsx`: 10Y yield + real yield + US100 close, yield change with directional coloring.

**Shipped (S1.5 — Vol & expected move):**
- `server/src/research/ingest/cboe.js`: CBOE CSV ingestor for VIX/VXN/GVZ history. `ingestAllVol()`, `getLatestVol()`, `getVolHistory()`.
- Route: `GET /api/research/vol/:instrument` — current IV, 60d percentile rank, range, avg, expected move (daily/weekly 1σ bands).
- `web/src/features/signal/panels/VolPanel.tsx`: VXN/GVZ current + percentile + range + expected move bands + mini SVG sparkline.

**Shipped (S1.6 — Earnings):**
- `server/src/research/ingest/finnhub.js`: Finnhub earnings calendar ingestor. `ingestEarnings(symbols)` — fetches ±3 months, filters to QQQ members, stores to `earnings` table. `getUpcomingEarnings()`, `getRecentEarnings()`.
- Route: `GET /api/research/earnings/us100` — constituent earnings enriched with weight + importance + mag7 flag.
- `web/src/features/signal/panels/EarningsPanel.tsx`: upcoming/recent earnings table with EPS surprise calculation, Mag-7 highlighting, freshness badge.

**Shipped (S1.7 — Sector rotation + AI brief):**
- `web/src/features/signal/panels/SectorPanel.tsx`: sector breakdown table from contribution data — weight%, contribution, member count per sector.
- Route: `GET /api/research/brief/:instrument` — generates AI daily brief via `callLLM()` with recent bars + vol + constituent context, caches in `briefs` table (one per instrument per day).
- `web/src/features/signal/panels/BriefPanel.tsx`: AI-generated daily brief with bullet-point formatting, model/date/cached metadata.

**Shared changes:**
- `web/src/types.ts`: added AlpacaQuote, ConstituentMember, ConstituentResponse, ContributionMember, ContributionResponse, BreadthItem, BreadthResponse, OverlayPoint, RateOverlayResponse, EnrichedEarning, EarningsResponse, SeriesDataResponse, VolResponse, BriefResponse.
- `web/src/api/client.ts`: added getConstituents, getContribution, getBreadth, getSeriesData, getSeriesList, getRateOverlay, getEarnings, triggerFredIngest, getVol, triggerCboeIngest, getBrief.
- `web/src/features/signal/terminal/terminal.css`: added .sig-table, .sig-scroll, .sig-symbol, .sig-tag-mag7, .sig-mag7, .sig-contrib-summary, .sig-sort-bar, .sig-bar-track, .sig-bar-fill, .sig-ad-bar, .sig-treemap, .sig-brief-content styles.
- `web/src/features/signal/pages/Signal.tsx`: wired all 8 new panels (instrument-conditional: US100 shows cockpit, XAUUSD shows vol + brief + driver placeholder). Replaced Epic 1 placeholder.
- `server/src/research/routes.js`: added 10 new routes + 5 ingest module imports.
- `server/src/env.js`: changed PORT precedence (process.env > .env file) for autoPort compatibility.

**Verified (2026-08-13, browser):** `/research` US100 tab renders all panels: Contribution grid with live Alpaca quotes (NVDA +3.06%, MSFT -2.25%, META -3.39%); Breadth 50/50 A/D with treemap; Sectors (Tech 44.2%); Rates (US100 close 29765.50); Vol (VXN — needs CBOE ingest); Earnings (CEG Nov 4, AMAT Nov 12); Brief (generating via LLM); Members (40 rows with prices + volume). `read_console_messages(onlyErrors)` = none. `tsc --noEmit` clean.

**Decisions/gotchas:**
- Used curated top-40 QQQ constituents rather than web-scraping slickcharts — stable weights, no parsing fragility. Can add scraper later for auto-updates.
- Contribution computed as `(weight/100) × changePct` — a simplified approximation since QQQ uses modified market-cap weighting; sufficient for the "broad vs narrow" signal.
- FRED/CBOE/Finnhub data requires manual ingest trigger initially (`POST /ingest/fred`, `/ingest/cboe`); scheduled ingest deferred to when cron/interval scheduling is added.
- AI brief degrades gracefully when no LLM provider is configured — shows error message, doesn't crash.
- Panels are instrument-conditional: US100 tab shows full cockpit, XAUUSD tab shows vol + brief only (gold-specific panels in Epic 3).

**Next:** Epic 2 — Macro core (FRED ingest engine, rates board, econ tracker, risk regime).

---

## 2026-08-13 — S0.5 Real-time transport ✓
**By:** Claude. **Status:** shipped + browser-verified.

**Shipped:**
- `server/src/research/ws.js`: WebSocket server using `ws` package. Attaches to the HTTP server via `noServer` + upgrade handler on `/ws/research`. Polls OANDA latest S5 candle every 2s for both instruments (XAUUSD, US100), broadcasts `{type:'price', instrument, ts, bid, ask, mid}` to all connected clients. On new connection, sends latest cached prices immediately. Supports `ping/pong` keepalive.
- `server/src/index.js`: switched from `app.listen()` to `http.createServer(app)` + `server.listen()` to expose the HTTP server for WS attachment. Imports + calls `initResearchWs(server)`.
- `web/src/features/signal/panels/LiveTicker.tsx`: real-time ticker panel with auto-reconnecting WebSocket client. Shows primary instrument prominently + secondary instrument below. Displays mid price, change, change%, session high/low. Connection status badge (LIVE/CONNECTING/OFFLINE). Passes ticks up via `onTick` callback.
- `web/src/features/signal/panels/PricePanel.tsx`: accepts `livePrice` prop — updates the last chart bar's close/high/low in real-time, shows live price + delta in the panel header.
- `web/src/features/signal/pages/Signal.tsx`: wires LiveTicker → PricePanel via `livePrice` state; replaced S0.5 placeholder.
- `web/src/features/signal/terminal/terminal.css`: added `.sig-ticker-*` styles (ticker grid, rows, symbol, price, high/low).
- `web/src/types.ts`: added `PriceTick` interface.
- `server/package.json`: added `ws` dependency.
- `.claude/launch.json`: added `server` config (node :4000).

**Verified (2026-08-13, browser):** `/research` renders live ticker with LIVE badge. Both instruments receive ticks (US100: 29763.5, XAUUSD: 4368.88). Price chart header shows live price + delta. Switching instruments updates both panels. `read_console_messages(onlyErrors)` = none. `tsc --noEmit` clean.

**Decisions/gotchas:**
- Used S5 candle polling (2s interval) rather than OANDA streaming endpoint — streaming requires account ID which isn't configured, and polling the latest S5 candle gives near-real-time updates without extra env vars. Can be upgraded to true streaming later by adding `OANDA_ACCOUNT_ID`.
- WebSocket attached via `noServer` mode to coexist with Express on the same port (4000). No CORS needed for WS upgrade on the same origin.
- Live price updates the chart's last bar in-place (close/high/low) rather than appending new bars — this keeps the chart stable while showing the latest tick.
- Auto-reconnect with 3s backoff on disconnect.

**Next:** Epic 1 — US100 cockpit (run deep-research pass → write FEATURE-SPEC-epic1-us100.md first).

---

## 2026-08-13 — S0.4 Price pipeline ✓
**By:** Claude. **Status:** shipped + browser-verified.

**Shipped:**
- `server/src/research/ingest/oanda.js`: OANDA price ingestor — fetches M1 candles via existing `fetchOandaM1()` from `marketdata.js`, writes to market.db `prices` table using `instrumentId()`. Aggregates M1 → M5/M15/M30/H1/H4/D1 in-process. Overlap-guarded `safeIngestOanda()`. Updates `source_health` per instrument.
- `server/src/research/routes.js`: added `GET /api/research/price/:instrument?tf=&from=&to=&limit=` (OHLCV + freshness), `GET .../export?tf=` (CSV download), `POST /api/research/ingest` (manual trigger).
- `server/src/index.js`: imports `safeIngestOanda`; runs initial ingest on startup (3 days), then every `PRICE_REFRESH_SEC` (default 300s) with `.unref()`.
- `web/src/features/signal/panels/PricePanel.tsx`: terminal-styled price panel — reuses `CandleChart.tsx`, adds 7-TF switcher bar, freshness `StatusBadge`, CSV export button, reload. Replaces S0.4 placeholder in Signal.tsx.
- `web/src/features/signal/terminal/terminal.css`: added `.sig-tf-bar`, `.sig-tf-btn` (cyan active), `.sig-chart-wrap` styles.
- `web/src/api/client.ts`: added `getResearchPrice()`, `triggerIngest()`.
- `web/src/types.ts`: updated `ResearchPriceBar` (dropped `instrument_id`/`timeframe` from bar shape), added `ResearchPriceResponse`.

**Verified (2026-08-13, browser):** `/research` renders price chart for both instruments. Initial ingest: XAUUSD 4128 M1 bars, US100 4140 M1 bars, all aggregated (M5: 829, M15: 277, M30: 139, H1: 70, H4: 19, D1: 4). TF switching works across all 7 timeframes. Freshness badge shows "OANDA · Xm ago". CSV export button present. `read_console_messages(onlyErrors)` = none. `tsc --noEmit` clean.

**Decisions/gotchas:**
- Ingest writes M1 directly + aggregates all TFs in one pass (no separate aggregation job). This means all TFs are immediately available after ingest.
- Chart reuses the existing `CandleChart.tsx` component — same lightweight-charts engine as the journal/replay/backtest charts. Terminal theme provides the dark background; chart uses its own transparent background.
- `PRICE_REFRESH_SEC=0` disables auto-ingest (mirrors `NEWS_REFRESH_SEC` pattern).
- Session shading (GIP-style) deferred — the chart renders intraday data fine, but visual session bands are a UI-only enhancement for a future pass.

**Next:** S0.5 — Real-time WebSocket transport (OANDA pricing stream → `/ws/research` → live ticker + last-price on chart).

---

## 2026-08-13 — S0.3 Terminal shell + route ✓
**By:** Claude. **Status:** shipped + browser-verified.

**Shipped:**
- `web/src/features/signal/terminal/terminal.css`: full Bloomberg-style theme, ALL selectors scoped under `.sig` (black/green/amber/cyan, mono, dense 12-col grid). Does not touch the app's slate+indigo theme.
- Terminal primitives: `Panel.tsx` (titled bordered panel + span), `DataRow.tsx` (label→value), `StatusBadge.tsx` (ok/warn/err/muted pill), `TickerCell.tsx` (tabular signed numeric), `index.ts` barrel.
- `web/src/features/signal/pages/Signal.tsx`: terminal screen — header (brand + XAUUSD/US100 tabs + UTC clock), System-Status panel (live `/api/research/health`), Data-Feeds panel (4 provider badges), placeholder panels (Price S0.4, Ticker S0.5, US100 Contribution Epic1, Gold Scorecard Epic3), persistent compliance footer.
- Wiring: `api.getResearchHealth()` + `ResearchHealth` import in `web/src/api/client.ts`; `/research` route in `App.tsx`; "Signal" link (◉) in `Sidebar.tsx`.
- `.claude/launch.json`: `web` preview config (Vite :5173).

**Verified (2026-08-13, browser):** `/research` renders; `location.pathname=/research`, `.sig` present, brand shows, badges live = Server OK / Market DB ok·v0.2.0 / Analytics ok / oanda+fred+finnhub+alpaca ON. `read_console_messages(onlyErrors)` = none. `tsc --noEmit` clean.

**Decisions/gotchas:**
- Theme scoping via a single `.sig` root class + CSS vars (no Tailwind config changes) — keeps the terminal aesthetic isolated to `/research`.
- Reused existing `useApi` hook (not AsyncBoundary, whose slate styling would clash) — page renders its own terminal-styled loading/error states.
- Browser pane wasn't displayed so image screenshots time out; verified via `javascript_tool` DOM inspection + console-error check instead (text-based per <verification_workflow>).

**Next:** S0.4 — OANDA price pipeline into market.db + terminal CandleChart panel.

---

## 2026-08-13 — S0.2 Schema + contract ✓
**By:** Claude. **Status:** shipped + verified.

**Shipped:**
- `server/src/research/schema.js`: refactored to pure `applySchema(db)` (idempotent) + `migrateResearch()` wrapper; `SCHEMA_VERSION='0.2.0'`; `INSTRUMENTS` seed; `instrumentId(symbol)` cached resolver. Full domain schema created: instruments, prices, series, series_data, cot, etf_holdings, constituents, earnings, calendar_events, news, alerts, briefs, context_snapshots (+ S0.1 meta/analytics_cache/source_health). Extra cols beyond the doc sketch: cot.comm_long/short, earnings.rev_est/act, alerts.created_at, briefs UNIQUE(instrument,date).
- `server/src/research/validate.js`: plain-JS guards — `num/str/toEpochMs` + row validators `validatePrice/validateSeriesPoint/validateCalendarEvent` + generic `require()`.
- `server/src/research/schema.test.js`: 7 node:test cases (in-memory DB) — table presence, version, idempotent seed, prices/series/context_snapshots round-trips, bad-row rejection.
- `web/src/types.ts`: appended Signal contract mirror (ResearchHealth, ResearchInstrument, ResearchPriceBar, SeriesMeta/Point, CotRow, EtfHolding, Constituent, EarningsRow, ResearchCalendarEvent, NewsItem, ResearchAlert, Brief, ContextSnapshot). Time fields = epoch ms.

**Verified (2026-08-13):** `node --test schema.test.js` → 7 pass / 0 fail. Migrated real `market.db` → schema_version 0.2.0, 16 tables, instruments {XAUUSD:1, US100:2}. `npx tsc --noEmit` clean.

**Decisions/gotchas:**
- Time convention locked: all ts/date columns are epoch **ms** UTC (differs from journal.db `price_bars.t` which is ISO text — market.db is separate).
- `applySchema(db)` made pure specifically so tests use `:memory:` and never touch market.db.
- context_snapshots.trade_id → journal.db trades(id) is a **logical** cross-DB link, not an FK (two separate SQLite files).

**Next:** S0.3 — terminal theme shell + `/research` route (first browser-observable UI; verify with preview tools).

---

## 2026-08-13 — S0.1 Docs + scaffolds ✓
**By:** Claude. **Status:** shipped + verified.

**Shipped:**
- Python `analytics/` FastAPI service (`app/main.py` `/health` + `/`), `requirements.txt` (fastapi/uvicorn/pandas/numpy), `Dockerfile` (python:3.12-slim), `.dockerignore`, `README.md`.
- Server research module `server/src/research/`: `schema.js` (separate `market.db`, WAL, `migrateResearch()` → `meta`/`analytics_cache`/`source_health`), `analyticsClient.js` (fail-soft `analyticsHealth()` + `compute()` helper), `routes.js` (`GET /health`).
- Wired into `server/src/index.js`: import + `migrateResearch()` + `app.use('/api/research', researchRouter)`.
- `server/src/env.js`: added `FRED_API_KEY`, `FINNHUB_KEY`, `FINNHUB_WEBHOOK_SECRET`, `ALPACA_KEY`, `ALPACA_SECRET`, `ANALYTICS_URL`, `ANALYTICS_TIMEOUT_MS`.
- `docker-compose.yml`: new `analytics` service (build ./analytics, port 8001, `journal-data:/data:ro`, `MARKET_DB_PATH`); server gets `ANALYTICS_URL=http://analytics:8001` + research keys; `depends_on: analytics`.
- Root `package.json`: `dev:all` (server+web+analytics), `dev:analytics`, `install:analytics`.
- `.gitignore`: added `.venv/ venv/ __pycache__/ *.pyc .pytest_cache/`.

**Verified (2026-08-13):**
- `node --check` clean on all new modules.
- `GET http://localhost:4000/api/research/health` → `{server:ok, marketDb:ok, schema_version:0.1.0, analytics:ok, providers:{oanda:true, fred:true, finnhub:true, alpaca:true}}`.
- `GET http://localhost:8001/health` → `{ok:true, market_db_visible:true}`. End-to-end pipe (server→Python→market.db) green.

**Decisions/gotchas:**
- Analytics health **fails soft** — server reports `analytics:'unreachable'` (not 500) when Python is down, so `npm run dev` works without Python.
- This machine has `py` (Python 3.14), no `python` alias → created `analytics/.venv` with fastapi+uvicorn for the health check. Full pandas/numpy deferred to Docker or a 3.12 venv (3.14 wheels may lag). Noted in STATE.md.
- Docker key-passing: compose interpolates `${FRED_API_KEY}` etc. from a root `.env`/shell, separate from `server/.env` (which only the dev server reads). Noted in STATE.md.
- `market.db` lives in `server/data/` (gitignored via `server/data/`), same dir as `journal.db`, so both sit in the `journal-data` volume.

**Next:** S0.2 — full domain schema + validators + `web/src/types.ts` contract mirror.

---

## 2026-08-13 — Planning + docs scaffold
**By:** Claude (PM/architecture pass). **Status:** pre-build.

**Shipped:**
- Approved master plan (`~/.claude/plans/product-plan-polished-patterson.md`).
- Explored the real stack (frontend + backend) — findings captured in ARCHITECTURE.md / CONVENTIONS.md.
- Researched free sub-15-min data feeds (DATA-SOURCES.md) and Bloomberg function parity for XAUUSD/US100 (BLOOMBERG-PARITY.md).
- Created the full `docs/signal/` tracking set: README, STATE, ROADMAP, ARCHITECTURE, DATA-SOURCES, SCHEMA, API-CONTRACT, CONVENTIONS, BLOOMBERG-PARITY, this log.

**Locked decisions:**
- Python FastAPI analytics service from Phase 0 + docker-compose.
- Full Bloomberg terminal theme, scoped to `/research`.
- Data keys: FRED + Alpaca + Finnhub (all free) + OANDA (already configured).
- First feature epic after foundation: US100 cockpit.

**PM overrides (vs product brief):** no `/apps/**` restructure; server stays plain-JS ESM; Redis + Postgres deferred; `analytics/` added as a sibling; separate `market.db`.

**Key technical finds:**
- App already pulls OANDA v20 M1 candles for `XAU_USD` + `NAS100_USD` (`server/src/marketdata.js`) → backbone price feed; `/pricing/stream` gives near-real-time.
- No WebSocket / node-cron / Python / research code exists yet — greenfield.
- Reusable: `bars.js`, `calendar.js` (ingest+scheduler pattern), `ai.js` `callLLM`, `stats.js`, `CandleChart.tsx`, `useApi.ts`, `api/client.ts`, `backtest/` module template.

**Gotchas noted:** CORS is hard-coded to `http://localhost:5173` — widen when WS lands (S0.5). `index.js` is 1676 lines — mount research routes via a separate router.

**Next:** S0.1 — scaffold `analytics/` FastAPI `/health`, docker-compose wiring, `market.db` bootstrap, server→analytics proxy, `GET /api/research/health`.

---
_(template for next entry)_
## YYYY-MM-DD — Sx.y <title>
**Shipped:** …
**Decisions:** …
**Gotchas:** …
**Files:** …
**Next:** …
