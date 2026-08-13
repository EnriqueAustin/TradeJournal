# BUILD-LOG (append-only)

Newest entries at the top. One block per session: what shipped, decisions, gotchas, files touched.

---

## 2026-08-13 — Epic 4: Events & reaction studies (S4.1–S4.3) ✓
**By:** Claude. **Status:** tsc clean. Docker WS fix included.

**Pre-build fix — Docker WebSocket connectivity:**
- `web/nginx.conf`: added `/ws/` location block with WebSocket upgrade headers (`Upgrade`, `Connection: "upgrade"`, 86400s read timeout) proxying to `server:4000`.
- `web/src/features/signal/panels/LiveTicker.tsx`: WS URL now uses same-origin in production (`ws://${location.host}/ws/research`) instead of hardcoded `:4000`; dev mode still connects directly to `:4000`.

**Spec first:** Wrote `FEATURE-SPEC-epic4-events.md` — defines all routes, types, data sources, event-instrument relevance, UI layout, acceptance criteria.

**S4.1 — Research calendar panel:**
- Ingestor: `server/src/research/ingest/calendar.js` — ForexFactory feed fetcher (mirrors `calendar.js` logic), writes to market.db `calendar_events` table. Supports direct fetch + manual payload push (`POST /ingest/calendar` with body). `parseNumeric()` for consensus/prior/actual.
- Routes: `GET /api/research/calendar?impact=&country=&from=&to=&limit=` — returns enriched events (countdown, session tag, isPast flag). `POST /api/research/ingest/calendar`.
- Panel: `CalendarPanel.tsx` — date-grouped event list, impact dot (red/amber/green), countdown timers, consensus/prior/actual columns, surprise coloring (beat=green, miss=red), impact filter (ALL/H+M/HIGH), risk badge from upcoming events.

**S4.2 — Event-reaction engine:**
- Route: `GET /api/research/event-reaction/:instrument?event=&limit=` — joins historical calendar events (where actual IS NOT NULL) with price bars at 5 windows (5m/15m/30m/60m/1d). Computes avg move, avg %, directional bias, up%, sample size. Segments by beat/miss.
- Handles inverted events (unemployment, claims, jobless) — surprise direction flipped.
- Panel: `EventReactionPanel.tsx` — event selector (12 preset events + custom search), segment tabs (ALL/BEAT/MISS), summary stats table, scrollable history table with per-window move coloring.

**S4.3 — Event intelligence:**
- Route: `GET /api/research/events/upcoming?hours=24` — upcoming high-impact events with risk level (clear/approaching/imminent).
- Route: `GET /api/research/events/markers/:instrument?from=&to=` — event markers for chart overlay (high+medium impact USD events).
- CalendarPanel integration: risk badge in header (CLEAR/EVENT APPROACHING/IMMINENT).
- PricePanel integration: event markers rendered as `arrowUp` markers below candles on the chart (red=high impact, amber=medium), with event name labels.

**Shared changes:**
- `web/src/types.ts`: added CalendarEvent, CalendarResponse, WindowStats, ReactionInstance, EventReactionResponse, UpcomingEvent, UpcomingResponse, EventMarker (8 new interfaces).
- `web/src/api/client.ts`: added getCalendar, getEventReaction, getUpcomingEvents, getEventMarkers, triggerCalendarIngest (5 new methods).
- `web/src/features/signal/pages/Signal.tsx`: wired CalendarPanel + EventReactionPanel as cross-instrument panels (shown on both tabs, after LiveTicker, before macro panels).
- `server/src/research/routes.js`: added calendar import + 5 new routes + helper functions (toSession, formatCountdown).

**Files created:** `CalendarPanel.tsx`, `EventReactionPanel.tsx`, `ingest/calendar.js`, `FEATURE-SPEC-epic4-events.md`

**Decisions/gotchas:**
- Calendar data requires manual ingest (same Cloudflare CDN block as journal calendar); `POST /ingest/calendar` with empty body tries direct fetch, with JSON body accepts pushed data.
- Event-reaction engine is Node-only (Python deferred per architecture rule — stub pattern consistent with drivers/regime/surprise).
- Event markers on chart use lightweight-charts `SeriesMarker` API — already supported by CandleChart.
- CalendarPanel + EventReactionPanel are cross-instrument (USD events affect both XAUUSD and US100).
- Inverted event surprise logic (unemployment/claims): lower actual = beat (economy stronger than expected).

---

## 2026-08-13 — QA pass: Epic 2–3 ✓
**By:** Claude. **Status:** verified — `tsc --noEmit` clean, `node --check` clean on all server modules.

**Scope:** Audit of Epic 2 (macro) + Epic 3 (gold cockpit) — docs vs code vs API-CONTRACT. Feature coverage confirmed: all 9 gold routes present and matching spec response shapes, all 9 gold panels wired into `Signal.tsx` (placeholder removed), types + client methods complete, ingestors align with schema PK conflict targets (`cot(report_date,market)`, `etf_holdings(etf,date)`), XAGUSD added to OANDA ingest + INSTRUMENTS seed. 2 gaps closed:

1. **ETF manual-upload fallback missing (spec gap)** — FEATURE-SPEC S3.4 specifies `POST /ingest/etf/upload` as the fallback when the SPDR CSV URL blocks. `parseAndStoreGld()` was already written and imported into `routes.js` but never wired to a route (dead import). Added `POST /api/research/ingest/etf/upload` (route-level `express.text()`, raw CSV body). Also dropped two genuinely-unused imports (`getLatestCot`, `getLatestEtf`).
2. **BLOOMBERG-PARITY.md stale (docs out of sync)** — gold-desk rows (COT/SEAG/driver/ETF/gold-silver) still read `spec` from the pre-build spec pass; STATE/BUILD-LOG/API-CONTRACT all had them `built`. Bumped to `built` with panel notes; added the key-levels row.

**Files:** `server/src/research/routes.js`, `docs/signal/API-CONTRACT.md`, `docs/signal/BLOOMBERG-PARITY.md`.

---

## 2026-08-13 — Epic 3: Gold cockpit (S3.1–S3.5) ✓
**By:** Claude. **Status:** browser-verified, tsc clean. S3.6 deferred (free-data gap).

**Spec first:** Wrote `FEATURE-SPEC-epic3-gold.md` before building — defines all routes, types, data sources, UI layout, acceptance criteria. Updated `BLOOMBERG-PARITY.md` with `spec`/`built`/`gap` status.

**S3.1 — Driver Scorecard:**
- Route: `GET /drivers/XAUUSD` — 7 drivers (DFII10, DFII5, DTWEXBGS, T10YIE, GVZ, BAMLH0A0HYM2, FEDFUNDS)
- Node compute: 60d z-score + 60d rolling Pearson correlation with gold D1 close
- Signal logic: inverse drivers (real yields, DXY, fed funds) = z<−0.5 → bullish for gold; direct drivers (breakevens, GVZ, HY spread) = z>0.5 → bullish
- Composite: weighted tally → tailwind/neutral/headwind
- Panel: DriverScorecard.tsx — z-score bar visualization, signal coloring, composite badge

**S3.2 — Real-Yield Inverse Overlay:**
- Route: `GET /overlay/xauusd/realyield` — gold D1 + DFII10 + 60d correlation
- Panel: RealYieldOverlay.tsx — dual-axis SVG (gold=amber, inverted DFII10=cyan dashed), correlation badge, divergence flag when |corr|<0.4

**S3.3 — COT Positioning:**
- Ingestor: `server/src/research/ingest/cftc.js` — parses CFTC disaggregated futures-only report (f_disagg.txt), filters gold rows (CFTC code 088691), upserts into `cot` table
- Route: `GET /cot/gold` + `POST /ingest/cftc`
- Compute: net MM, %long, WoW Δ, percentile rank (1Y/3Y), extreme flag (>90 or <10 pctile)
- Panel: CotPanel.tsx — percentile bar with extreme markers, net MM area chart

**S3.4 — ETF Flows:**
- Ingestor: `server/src/research/ingest/etf.js` — fetches GLD CSV from SPDR, flexible column detection, multiple date format support
- Route: `GET /etf-flows/gold` + `POST /ingest/etf`
- Compute: daily/weekly Δ, trend from 20-day SMA slope (inflow/flat/outflow)
- Panel: EtfFlowPanel.tsx — tonnes, Δ, trend badge, 90-day area chart

**S3.5 — Completion panels:**
- **Gold/Silver Ratio:** Added XAGUSD (XAG_USD) to OANDA ingest + schema seed. Route: `GET /ratio/gold-silver`. Panel: GoldSilverPanel.tsx — current ratio, 1Y percentile, range bar, line chart.
- **Seasonality:** Route: `GET /seasonality/:instrument`. Computes monthly avg returns from D1 bars. Panel: SeasonalityPanel.tsx — 12-month bar chart (green/red), win rates, current month highlighted amber.
- **Key Levels:** Route: `GET /levels/:instrument`. Classic pivots from prior D1, $50 round numbers (gold), prev day/week H/L. Panel: KeyLevelsPanel.tsx — sorted table with color-coded distances.

**S3.6 — Deferred:** Forward curve requires paid CME data. Gap documented in FEATURE-SPEC and BLOOMBERG-PARITY.

**Shared changes:**
- `types.ts`: 10 new interfaces (DriverScore, DriversResponse, RealYieldOverlayResponse, CotSummary, CotResponse, EtfFlowResponse, GoldSilverResponse, SeasonalMonth, SeasonalityResponse, KeyLevel, LevelsResponse)
- `client.ts`: 10 new api methods
- `Signal.tsx`: replaced placeholder panel with 9 gold cockpit panels (DriverScorecard, RealYieldOverlay, VolPanel, CotPanel, EtfFlowPanel, GoldSilverPanel, SeasonalityPanel, KeyLevelsPanel, BriefPanel)
- `schema.js`: XAGUSD added to INSTRUMENTS seed
- `routes.js`: 9 new routes + helper functions (zScore, rollingCorrelation)
- `SYMBOL_MAP` extended with XAGUSD

**Files created:** `DriverScorecard.tsx`, `RealYieldOverlay.tsx`, `CotPanel.tsx`, `EtfFlowPanel.tsx`, `GoldSilverPanel.tsx`, `SeasonalityPanel.tsx`, `KeyLevelsPanel.tsx`, `cftc.js`, `etf.js`, `FEATURE-SPEC-epic3-gold.md`

**Gotchas / decisions:**
- COT/ETF/Gold-Silver panels return 404 gracefully when no data ingested — panels show helpful "run ingest" messages
- Seasonality needs multi-year D1 data to be useful; shows "insufficient history" when sample size is 0
- CFTC f_disagg.txt uses YYMMDD date format — parser handles both YY<50→20xx and YY≥50→19xx
- GLD CSV parser handles variable header position (preamble rows) and multiple date formats
- TickerCell prop is `dp` not `digits` — caught and fixed before tsc

---

## 2026-08-13 — QA pass: Epic 0–2 ✓
**By:** Claude. **Status:** bugs fixed + runtime-verified against live data.

**Scope:** Full audit of Phase 0–2 shipped work (docs vs code vs contract). `tsc --noEmit` + `node --check` clean before and after. 4 bugs fixed:

1. **Regime factor colors dead (High)** — `/regime` emitted factor `signal` values (`risk-on/caution/risk-off/info`) that never matched `RegimePanel`'s `SIGNAL_COLOR` map (`bullish/neutral/bearish`); every non-neutral factor rendered muted. Backend now emits `bullish/neutral/bearish`.
2. **Regime label mismatch (High)** — `/regime` emitted `constructive` (unmapped→muted) and never `crisis` (mapped but unreachable). Rescored to the API-CONTRACT vocabulary `risk-on/neutral/risk-off/crisis`; `crisis` now reachable (score < -2).
3. **Econ "YoY" was a 5-month change (Med)** — `/econ` fetched only `LIMIT 6` monthly points, computing YoY from 6 months back. Now fetches 13 points → true 12-month YoY; sparkline is a proper 12 points (matching the BUILD-LOG claim).
4. **GVZ ingest returned 0 rows (Med)** — `cboe.js` hard-coded `cols[4]` + required ≥5 columns, but GVZ's CSV is 2-column (`DATE,GVZ`) vs VIX/VXN 5-column (`DATE,OPEN,HIGH,LOW,CLOSE`). Every GVZ row was skipped, starving the XAUUSD Vol panel + gold brief. Now reads the last column and requires only ≥2 — GVZ ingests 250 rows.

**Polish:** `RatesBoard` + `EconTracker` value columns were sign-colorized (every positive yield/index showed green); set `colorize={false}` so only change/MoM/YoY columns color.

**Verified (2026-08-13, live data):** Ingested all 18 FRED series (~498 pts each) + CBOE (VIX 257, VXN 250, GVZ 250). `/regime` → `risk-on` score 3, factors VIX 14.55 bullish / HY 2.71 bullish / DXY neutral / VXN neutral. `/econ` → CPI YoY 3.54% + PCE YoY 3.67% (correct 12-mo) with 12-pt sparklines. `/vol/XAUUSD` → GVZ 25.58, pctRank 50, expected move ±70.6/day. `/rates` board fully populated.

**Files:** `server/src/research/routes.js` (regime + econ), `server/src/research/ingest/cboe.js`, `web/src/features/signal/panels/RatesBoard.tsx`, `EconTracker.tsx`.

**Note:** ingest remains manual-trigger (`POST /ingest/fred`, `/ingest/cboe`) — scheduled refresh still deferred (Epic 8). GVZ/VIX/VXN/all-FRED now confirmed populating market.db.

---

## 2026-08-13 — Epic 2: Macro Core (S2.1–S2.4) ✓
**By:** Claude. **Status:** shipped + tsc-verified.

**Shipped (S2.1 — FRED ingest engine):**
- `server/src/research/ingest/fred.js`: expanded `SERIES_REGISTRY` from 8 to 18 series — added DGS5/DGS1/DGS3MO (short-end rates), DFII5 (5Y TIPS), T5YIE (5Y breakeven), T10Y2Y (2s10s spread), CPIAUCSL/PCEPI (inflation), PAYEMS/UNRATE (labor), FEDFUNDS, BAMLH0A0HYM2 (HY OAS credit spread).

**Shipped (S2.2 — Rates board + yield curve):**
- Route: `GET /api/research/rates` — rates board with 18 FRED series organized by category + yield curve points (3M→30Y).
- `web/src/features/signal/panels/RatesBoard.tsx`: sectioned display (Nominal Yields, Real Yields, Breakevens, Spreads, Policy/FX) with value + change coloring. SVG yield curve chart with amber polyline + tenor labels.

**Shipped (S2.3 — Econ tracker):**
- Route: `GET /api/research/econ` — CPI/PCE/PAYEMS/UNRATE with latest value, MoM/YoY change, 12-point sparkline history.
- `web/src/features/signal/panels/EconTracker.tsx`: table with unit-aware formatting (percent/index/thousands), MoM/YoY with signed colorized values, SVG sparkline per indicator (green=trending up, red=trending down).

**Shipped (S2.4 — Risk regime classifier):**
- Route: `GET /api/research/regime` — composite risk regime (risk-on/neutral/risk-off/crisis) from VIX + HY spread + breadth + DXY signals.
- `web/src/features/signal/panels/RegimePanel.tsx`: regime badge (color-coded: ok/muted/warn/err), composite score, factor breakdown with signal coloring (bullish/neutral/bearish).

**Shared changes:**
- `web/src/types.ts`: added RateBoardEntry, YieldCurvePoint, RatesResponse, EconIndicator, EconResponse, RegimeFactor, RegimeResponse.
- `web/src/api/client.ts`: added getRates, getEcon, getRegime.
- `web/src/features/signal/pages/Signal.tsx`: wired RatesBoard + EconTracker + RegimePanel as cross-instrument panels (shown on both US100 and XAUUSD tabs).
- `web/src/features/signal/terminal/terminal.css`: added `.sig-section-label` style.

**Verified (2026-08-13):** `tsc --noEmit` clean (zero errors). All three panels render in both instrument tabs.

**Decisions/gotchas:**
- Macro panels placed outside instrument-conditional blocks — they're cross-instrument context, relevant to both US100 and XAUUSD.
- Python compute deferred for Fed probability (WIRP-style), surprise z-scores (ECSU), and regime composite. Node implementations serve as functional stubs with the same API shape.
- Yield curve uses inline SVG (no charting library) — lightweight, terminal-aesthetic consistent.

**Next:** Epic 3 — Gold cockpit (driver scorecard, real-yield overlay, COT, ETF flows).

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
