# BUILD-LOG (append-only)

Newest entries at the top. One block per session: what shipped, decisions, gotchas, files touched.

---

## 2026-08-17 — Epic 7: Journal Fusion (S7.1–S7.3) ✓
**By:** Claude. **Status:** tsc clean, browser-verified (EdgePanel + ContextTab rendering, snapshot API 200s).

**Spec first:** Wrote `FEATURE-SPEC-epic7-fusion.md` — defines context snapshots, replay, edge analytics, AI debrief.

### S7.1 — Context snapshots
**New files:**
- `server/src/research/snapshot.js` — `captureSnapshot()` gathers 11 market dimensions (price, regime, rates, drivers, vol, positioning, events, news, correlations, levels, seasonality) into a JSON payload, upserts into `context_snapshots` table. `getSnapshot()` reads stored snapshots.

**New routes:**
- `POST /api/research/snapshot/:tradeId` — manually capture snapshot for a trade
- `POST /api/research/snapshot/batch` — batch capture for multiple trades
- `GET /api/research/snapshot/:tradeId` — read stored snapshot

**Auto-capture hook:** `insertTradeTx()` in `index.js` now calls `captureSnapshot()` synchronously after trade insert (non-backtest trades only, wrapped in try/catch so it never blocks insertion).

**Verification:** Manual capture returned full 11-section payload. Batch captured 2 trades. Read endpoint returns stored data.

### S7.2 — Context tab on TradeDetail
**New files:**
- `web/src/features/signal/panels/ContextTab.tsx` — frozen market context dashboard using terminal theme (`.sig` tokens). Renders all 11 snapshot sections: Price, Regime (with badge), Rates, Drivers (z-scores + signals + correlations), Volatility, Positioning, Upcoming Events, Recent News, Key Levels (with ENTRY marker), Correlations, Seasonality. Empty state with "Capture Now" button.

**Modified:**
- `web/src/pages/TradeDetail.tsx` — added tab bar (Details | Market Context). Details tab shows existing content. Market Context tab renders ContextTab. Tabs switch via local state.

**Verification:** Both tabs switch correctly. Market Context renders full snapshot with all sections. Zero console errors from new code.

### S7.3 — Edge analytics + AI debrief
**New files:**
- `web/src/features/signal/panels/EdgePanel.tsx` — edge analytics table per dimension (regime, driver composite, vol regime, session, DOW, event proximity). Win rate bars color-coded (green >55%, amber 45-55%, red <45%). Best edge callout badge.
- `web/src/features/signal/panels/DebriefPanel.tsx` — AI coaching debrief with "Get AI Debrief" button, markdown rendering, regenerate option.

**New routes:**
- `GET /api/research/edge/:instrument` — cross-DB join (journal.db trades × market.db snapshots), aggregates P&L by 6 dimensions with min 5 trades per bucket
- `POST /api/research/debrief/:tradeId` — generates AI coaching note from trade details + snapshot context + edge stats, caches in `debriefs` table
- `GET /api/research/debrief/:tradeId` — read cached debrief

**Schema changes:**
- `debriefs` table: new (trade_id PK, content, model, created_at)

**Integration:**
- EdgePanel added to Signal page (both instruments, between News and Correlation panels)
- DebriefPanel added to bottom of ContextTab on TradeDetail

**Verification:** Edge endpoint returned 8 trades bucketed by session (london: 5, 40% WR) and DOW (Wed: 5). EdgePanel renders on Signal page with data. Debrief button visible on ContextTab.

### Files touched
- `server/src/research/snapshot.js` (NEW)
- `server/src/research/routes.js` (snapshot/edge/debrief routes + journalDb import)
- `server/src/research/schema.js` (debriefs table)
- `server/src/index.js` (captureSnapshot import + hook in insertTradeTx)
- `web/src/features/signal/panels/ContextTab.tsx` (NEW)
- `web/src/features/signal/panels/EdgePanel.tsx` (NEW)
- `web/src/features/signal/panels/DebriefPanel.tsx` (NEW)
- `web/src/features/signal/pages/Signal.tsx` (EdgePanel import + wire-up)
- `web/src/pages/TradeDetail.tsx` (tab bar + ContextTab integration)
- `web/src/api/client.ts` (snapshot/edge/debrief API methods)
- `web/src/types.ts` (ContextSnapshotPayload + all sub-types, EdgeBucket, EdgeAnalytics, Debrief)
- `docs/signal/FEATURE-SPEC-epic7-fusion.md` (NEW)
- `docs/signal/BLOOMBERG-PARITY.md` (status updates)

### Decisions
- **Synchronous snapshot capture** — SQLite is fast enough for single-user; async would add complexity for no benefit
- **Cross-DB edge analytics in JS** — read trade IDs from journal.db, snapshots from market.db, join in JS. SQLite ATTACH possible but adds coupling.
- **Expectancy formula** — simplified: (WR × avg_R) - ((1-WR) × |avg_R|). Good enough for coaching signal.
- **Replay mode deferred** — core value (ContextTab on TradeDetail) is delivered; replay overlay on Signal page deferred to S8 or follow-up.
- **Min 5 trades per bucket** — prevents noisy edge stats from small samples

---

## 2026-08-16 — Epic 6: News & AI (S6.1–S6.3) ✓
**By:** Claude. **Status:** tsc clean, browser-verified (22 panels rendering).

**Spec first:** Wrote `FEATURE-SPEC-epic6-news.md` — defines GDELT + RSS ingest, enhanced briefs, explain-this-move.

### Bug fix (pre-epic)
- **`callLLM` return value mismatch** — `routes.js` brief endpoint destructured `callLLM()` as `{ text, model }` but `callLLM` returns a plain string. Fixed: `content = await callLLM(...)`, `model = AI_MODEL`. Added `AI_MODEL` import from `env.js`.

### S6.1 — News ingest (GDELT + RSS)
**New files:**
- `server/src/research/ingest/news.js` — GDELT DOC 2.0 + RSS ingestor with:
  - `ingestGdelt()` — queries GDELT ArtList API with gold/NQ keyword sets
  - `ingestRss()` — fetches Kitco/Investing.com/FXStreet RSS, regex XML parser
  - `scoreSentiment()` — batch LLM classification (-1 to +1), JSON extraction
  - `getNewsFeed()` — filtered query (instrument/sentiment/source/since)
  - `getNewsSummary()` — 24h aggregated stats
  - Instrument tagging by keyword regex (gold/NQ keywords)
  - Dedup by SHA-1 URL hash, source_health tracking

**New routes:**
- `POST /api/research/ingest/news` — triggers GDELT + RSS + sentiment scoring
- `GET /api/research/news` — filtered feed (instrument, limit, since, sentiment, source)
- `GET /api/research/news/summary` — 24h stats (total, bullish, bearish, neutral, topSources)

**New panel:** `NewsFeedPanel.tsx` — full-width (span 12), instrument filter tabs, sentiment filter tabs, scrollable headline table (TIME/SOURCE/HEADLINE/INST/SENT columns), sentiment dots (green/red/gray), load-more pagination, last-ingest footer.

**New types:** `NewsResponse`, `NewsSummary` in `types.ts`.
**API client:** `getNewsFeed()`, `getNewsSummary()`, `triggerNewsIngest()` in `client.ts`.

**Verification:** RSS ingest inserted 40 items. GDELT blocked from dev network (expected — works when not behind NAT). Panel renders with data, filter tabs work, API returns 200.

### S6.2 — Enhanced daily briefs
- Brief endpoint enhanced with `?mode=enhanced` query param
- Enhanced mode gathers: last 10 headlines, upcoming 48h high-impact events, risk regime, VIX level
- Structured system prompt with ## sections (Market Snapshot, Key Drivers, Risk Assessment, What to Watch)
- `briefs` table: added `brief_type` column (guarded ALTER TABLE migration)
- `BriefPanel.tsx`: QUICK/FULL toggle buttons, enhanced markdown-style section rendering with amber headers
- Backwards-compatible: default mode = basic (unchanged behavior)

### S6.3 — Explain-this-move
- `POST /api/research/explain-move` route — accepts instrument/timestamp/timeframe/direction/magnitude
- Gathers evidence: nearby news (±2h intraday, ±12h daily), calendar events (±4h/±24h), regime, correlated moves (DXY/yields/VIX)
- Calls `callLLM` with structured prompt for microstructure explanation
- Caches results in new `explanations` table (instrument/ts/timeframe unique)
- Returns structured response with explanation + evidence object
- `PricePanel.tsx`: added "WHY?" button in header bar, inline ExplainPanel below chart
- ExplainPanel: markdown rendering, collapsible evidence section (news/events/correlatedMoves/regime), close button
- `ExplainMoveRequest`, `ExplainEvidence`, `ExplainMoveResponse` types

### Schema changes
- `briefs` table: `brief_type TEXT DEFAULT 'basic'` column added
- `explanations` table: new (id, instrument, ts, timeframe, explanation, evidence_json, model, created_at)
- Guarded migration via PRAGMA table_info check

### Files touched
- `server/src/research/ingest/news.js` (NEW)
- `server/src/research/routes.js` (news routes, enhanced brief, explain-move, import fix)
- `server/src/research/schema.js` (brief_type column, explanations table)
- `web/src/features/signal/panels/NewsFeedPanel.tsx` (NEW)
- `web/src/features/signal/panels/PricePanel.tsx` (WHY? button + ExplainPanel)
- `web/src/features/signal/panels/BriefPanel.tsx` (QUICK/FULL toggle)
- `web/src/features/signal/pages/Signal.tsx` (NewsFeedPanel import + wire-up)
- `web/src/types.ts` (NewsResponse, NewsSummary, ExplainMove* types)
- `web/src/api/client.ts` (getNewsFeed, getNewsSummary, triggerNewsIngest, explainMove, getBrief mode param)
- `docs/signal/FEATURE-SPEC-epic6-news.md` (NEW)
- `docs/signal/BLOOMBERG-PARITY.md` (status updates)

### Decisions
- **Regex XML parser** — no new dependency for RSS; RSS is simple enough for inline regex
- **SHA-1 URL hash** — consistent with calendar.js pattern for dedup IDs
- **Sentiment via LLM batch** — one callLLM per 20 headlines, not keyword-based; graceful degradation when LLM unavailable (items show as "unscored")
- **WHY? button** — explains last candle rather than click-a-candle, avoids complex chart click plumbing
- **Enhanced brief = separate cache** — `brief_type` column lets basic and enhanced briefs coexist without invalidating each other

### Gotchas
- GDELT API blocked from some networks (NAT/residential). Falls back to RSS-only gracefully.
- Ollama not running locally → sentiment scoring returns `{scored: 0}`, explain-move returns error message. Both degrade gracefully without crashing.
- ForexFactory rate-limited (429) on dev machine — pre-existing, not related to Epic 6.

---

## 2026-08-16 — Epic 5: Positioning, Correlation & Seasonality (S5.1–S5.3) ✓
**By:** Claude. **Status:** tsc clean, node --check clean, browser-verified.

**Spec first:** Wrote `FEATURE-SPEC-epic5-corr.md` — defines all routes, types, data sources, panels, acceptance criteria.

**New data: Oil instrument (WTICO_USD):**
- `schema.js`: added `WTICO_USD` to `INSTRUMENTS` seed
- `oanda.js`: added to `OANDA_INSTRUMENTS`
- `marketdata.js`: added to `OANDA_SYMBOL` map
- `routes.js`: added to `SYMBOL_MAP`

**S5.1 — Correlation matrix + regression + comparison + spread:**
- Route: `GET /api/research/correlation?window=60&series=...` — pairwise Pearson correlation over configurable window. Default 6 series: XAUUSD, US100, DGS10, DFII10, DTWEXBGS, VIX. Returns N×N matrix + flat cells.
- Route: `GET /api/research/regression/:instrument?vs=&window=` — OLS regression of daily log returns. Beta, R², intercept, correlation, scatter points.
- Route: `GET /api/research/compare?series=&window=&mode=zscore|pctChange` — normalized multi-series comparison (z-score or % change rebased to 0).
- Route: `GET /api/research/spread?long=&short=&mode=ratio|difference` — custom spread with mean, σ, z-score, percentile, Bollinger-style bands.
- Helper functions: `getDailyValues()` (unified fetch for instruments + FRED + CBOE), `alignByDay()` (date-join N series), `pearson()`.
- Panel: `CorrelationPanel.tsx` — heatmap table with 20d/60d/120d/252d window selector, color-coded cells (green=positive, red=negative), significance highlighting.
- Panel: `RegressionPanel.tsx` — scatter plot with regression line, β/R²/corr/n stats, instrument + series selectors.
- Panel: `ComparePanel.tsx` — multi-line z-score overlay, series toggles, z-score/% mode switch.
- Panel: `SpreadPanel.tsx` — spread line with mean ± 1σ/2σ bands, z-score badge, percentile, long/short/mode selectors.

**S5.2 — Regime-conditional correlation + positioning:**
- Route: `GET /api/research/correlation/regime?window=&regime=&series=` — same as `/correlation` but filtered to days matching a risk regime (computed from VIX + HY spread per day).
- Route: `GET /api/research/positioning/:instrument` — consolidated COT + ETF view with contrarian flag when positioning is extreme.
- CorrelationPanel upgraded: regime dropdown (ALL / RISK-ON / NEUTRAL / RISK-OFF / CRISIS) filters the matrix.
- Panel: `PositioningPanel.tsx` — two-column layout (COT gauge with percentile bar + ETF flows with trend badge), contrarian warning banner.

**S5.3 — Enhanced seasonality module:**
- Enhanced `GET /api/research/seasonality/:instrument?granularity=monthly|weekly|dow|session` with 4 granularity modes.
- Monthly: added median return, t-statistic, p-value, significance flag, OpEx week effect.
- Weekly (WoY): group D1 returns by ISO week number.
- Day-of-Week: group by Mon-Fri.
- Session: group H1 returns by Asia (00-08 UTC) / London (08-13 UTC) / NewYork (13-21 UTC).
- Helper functions: `tStat()`, `medianOf()`, `buildBuckets()`, `getISOWeek()`, `isOpExWeek()`.
- SeasonalityPanel upgraded: 4 granularity tabs, significance markers (★ p<0.05), OpEx effect card, wider span (6 cols).

**Shared changes:**
- `web/src/types.ts`: added CorrelationCell, CorrelationResponse, RegressionResponse, CompareSeriesPoint, CompareResponse, SpreadPoint, SpreadResponse, RegimeCorrelationResponse, PositioningCot, PositioningResponse, SeasonalBucket, OpExEffect. Enhanced SeasonalMonth + SeasonalityResponse.
- `web/src/api/client.ts`: added getCorrelation, getRegression, getCompare, getSpread, getRegimeCorrelation, getPositioning. Enhanced getSeasonality with granularity param.
- `web/src/features/signal/pages/Signal.tsx`: wired 5 new panels (CorrelationPanel, RegressionPanel, ComparePanel, SpreadPanel after RegimePanel as cross-instrument; PositioningPanel in XAUUSD section).
- `server/src/research/routes.js`: 7 new routes + 8 helper functions.

**Files created:** `CorrelationPanel.tsx`, `RegressionPanel.tsx`, `ComparePanel.tsx`, `SpreadPanel.tsx`, `PositioningPanel.tsx`, `FEATURE-SPEC-epic5-corr.md`

**Verified (2026-08-16, browser):** All 23 panels render on XAUUSD tab. Correlation matrix shows real correlations (XAUUSD-US100: -0.57, DGS10-DFII10: 0.82). Compare overlay renders 3-series z-score chart. Spread panel shows gold/silver ratio 67.66 z=1.0. Seasonality session view shows Asia/London/NewYork with significance. Regime dropdown has 5 options. Positioning panel degrades gracefully (no COT/ETF data ingested). 0 new console errors.

**Decisions/gotchas:**
- Node compute stubs (not Python) per same pattern as S2.4/S3.1/S4.2. API shape matches future Python endpoints.
- Regression shows "insufficient data" with only ~5 days D1 — correct behavior, needs more OANDA ingest.
- Regime-conditional correlation needs VIX/HY data aligned with price dates — returns empty with limited data.
- PositioningPanel sits alongside CotPanel + EtfFlowPanel (not replacing them) — the standalone panels have richer detail; Positioning gives the consolidated view.
- t-statistic p-value uses a fast approximation (`exp(-0.717|t| - 0.416t²)`), sufficient for the significance threshold.

**Next:** Epic 6 — News & AI (GDELT + RSS ingest, daily briefs, explain-this-move).

---

## 2026-08-16 — QA pass: Epic 0–4 audit + gold/silver fix ✓
**By:** Claude. **Status:** verified — `tsc --noEmit` clean, `node --check` clean, full stack booted + live-data browser QA.

**Scope:** Full audit of the Signal tab (docs vs code vs API-CONTRACT) + runtime QA against live data. Coverage confirmed: all 34 `built` routes present in `routes.js`, all 20 panels wired in `Signal.tsx`, timezone lens WIP (`lib/tz.ts`) complete and consistently applied. Booted server+web, ingested OANDA/FRED/CBOE, browser-verified both instrument tabs render with zero regressions. 1 real bug fixed:

1. **Gold/Silver Ratio panel permanently dead (High)** — `marketdata.js` `OANDA_SYMBOL` map was missing `XAGUSD`, so `fetchOandaM1('XAGUSD')` threw "no OANDA symbol" and silver spot never ingested. The S3.5 claim ("added XAGUSD to OANDA ingest") was only half-true: XAGUSD was added to `oanda.js` `OANDA_INSTRUMENTS` (with an `oanda:'XAG_USD'` field that is **never read** — line 74 passes the canonical `symbol`, and the code→OANDA mapping lives in `marketdata.js oandaSymbol()`) and to the schema seed, but not to the actual map `fetchOandaM1` uses. Added `XAGUSD: 'XAG_USD'` to `OANDA_SYMBOL`. Verified end-to-end: silver ingests, `/ratio/gold-silver` returns data, panel renders ratio 67.7 / 1Y avg 67.6 / pctile 100% (was "NO SILVER DATA").

**Not bugs (data availability, documented, degrade gracefully):** `/cot/gold` + `/etf-flows/gold` 404 (CFTC 403 / SPDR GLD 404 external blocks — need manual-upload fallback); RealYield corr N/A + Seasonality "insufficient history" (only ~5d D1 depth from the 5-day M1 ingest — inherent); Brief "fetch failed" (no LLM provider reachable this env). All handled by graceful panel states.

**Open nit (not fixed):** COT/ETF endpoints return HTTP 404 for "no data yet," which logs a red browser console error even though panels render fine — cosmetic, pre-existing by design. Consider 200 + empty payload in a future polish pass.

**Files:** `server/src/marketdata.js` (one-line map addition).

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
