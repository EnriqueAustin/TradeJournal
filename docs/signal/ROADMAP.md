# ROADMAP — build sessions

Each session = one ~5-hour Opus session, a vertical slice that ends green. Tick the box on completion. Order after Epic 0 reflects the "US100 first" decision. Heavy sessions (S3.1, S4.2, S5.1, S8.2) may split — STATE.md carries partial state.

**Before each epic:** run the deep-research pass, write `FEATURE-SPEC-<epic>.md`, update `BLOOMBERG-PARITY.md`.

## Epic 0 — Foundation & pipe
- [x] **S0.1 Docs + scaffolds** — `docs/signal/*`; `analytics/` FastAPI `/health`; add analytics to `docker-compose.yml`; `market.db` + research `migrate()`; server→analytics proxy. **Accept:** `GET /api/research/health` = `{server:ok, analytics:ok}` ✓ (verified 2026-08-13). Docker service wired (not yet built-run).
- [x] **S0.2 Schema + contract** — all core `market.db` tables via migrate pattern; runtime validators; mirror types into `web/src/types.ts`; fill SCHEMA.md. **Accept:** tables exist; smoke insert/read round-trips ✓ (7 tests green, schema_version 0.2.0, verified 2026-08-13).
- [x] **S0.3 Terminal shell + route** — `web/src/features/signal/terminal/` theme tokens (black/green/amber, mono, dense) + primitives (Panel, DataRow, StatusBadge, TickerCell); `/research` route + Sidebar link. **Accept:** `/research` renders terminal chrome ✓ (browser-verified: live health badges, 0 console errors, theme scoped to `.sig`; 2026-08-13).
- [x] **S0.4 Price pipeline** — OANDA ingest `XAU_USD`+`NAS100_USD` → `prices`; `GET /api/research/price/:instrument?tf=`; terminal CandleChart for both; HP CSV export. **Accept:** both instruments chart from stored bars w/ TF switch ✓ (browser-verified: M1/M5/M15/M30/H1/H4/D1 all render, CSV export, freshness badge, 0 console errors; 2026-08-13).
- [x] **S0.5 Real-time transport** — `ws` server (`server/src/research/ws.js`); OANDA pricing stream → `/ws/research`; live-price ticker + last-price on chart. **Accept:** ticks update live without refresh ✓ (browser-verified: both instruments tick live, chart updates, LIVE badge, 0 console errors; 2026-08-13).

## Epic 1 — US100 cockpit
- [x] **S1.1 Constituents + live quotes** — QQQ top-40 constituents → `constituents`; Alpaca IEX REST snapshots for all members. **Accept:** table populated; live quotes stream ✓ (browser-verified: 40 members, Alpaca prices + volume; 2026-08-13).
- [x] **S1.2 Contribution grid + leaderboard** — Node contribution calc (weight×changePct); sortable grid with Mag-7 summary + bar sparklines. **Accept:** live grid shows broad-vs-narrow ✓ (browser-verified: Total/Mag-7/Broad contrib, Impact/Weight/Chg%/A-Z sort; 2026-08-13).
- [x] **S1.3 Breadth + sector treemap** — Node breadth (A/D, advancers/decliners/unchanged); mini treemap heatmap (top-20 by weight). **Accept:** breadth panel + treemap render ✓ (browser-verified; 2026-08-13).
- [x] **S1.4 Rate overlay + SOX + global board** — FRED ingestor (8 series: DGS2/10/30, DFII5/10, T10YIE/T5YIE, DTWEXBGS); rate overlay panel. **Accept:** overlay renders ✓ (browser-verified; 2026-08-13). SOX ratio + WEI deferred.
- [x] **S1.5 Vol & expected move** — CBOE CSV ingestor (VIX/VXN/GVZ); vol panel with percentile rank + expected move bands + sparkline. **Accept:** expected-move in panel ✓ (browser-verified; 2026-08-13).
- [x] **S1.6 Earnings + RV + screener** — Finnhub earnings → `earnings`; weight-adjusted importance table. **Accept:** earnings ranked by importance ✓ (browser-verified: 2 reports, FRESH badge; 2026-08-13). RV board + EQS screener deferred.
- [x] **S1.7 Put/call + sector + brief + OMON** — Sector rotation panel; US100 daily AI brief (`callLLM`). **Accept:** sector panel + cached brief ✓ (browser-verified; 2026-08-13). Put/call + OMON deferred to data availability.

## Epic 2 — Macro core
- [x] **S2.1 FRED ingest engine** — series registry expanded to 18 series (rates/real/breakevens/spread/dollar/econ/fed/credit); generic ingestor. **Accept:** series stored + freshness badge ✓ (verified 2026-08-13).
- [x] **S2.2 Rates board + Fed odds + YCRV** — rates board (real/nominal/2s10s/breakevens/policy/FX); SVG yield curve; sectioned display. **Accept:** rates panel renders ✓ (verified 2026-08-13). Fed odds deferred (needs Python compute).
- [x] **S2.3 Econ tracker + surprise monitor** — CPI/PCE/PAYEMS/UNRATE with MoM/YoY + sparkline trends. **Accept:** tracker renders ✓ (verified 2026-08-13). Surprise z-scores deferred (needs Python compute).
- [x] **S2.4 Risk regime classifier** — Node composite (VIX/HY-spread/breadth/DXY) → regime label + factors. **Accept:** regime badge renders ✓ (verified 2026-08-13). Python compute deferred.

## Epic 3 — Gold cockpit
- [x] **S3.1 Driver scorecard** — z-scores (60d) + rolling corr for 7 drivers (DFII10/5, DXY, T10YIE, GVZ, HY spread, Fed funds); composite tailwind/headwind/neutral gauge. **Accept:** flagship scorecard live ✓ (browser-verified 2026-08-13). **Python compute DONE (2026-08-20, S3.1b):** `POST /compute/drivers` — returns-based corr + p-value, OLS β/R², β·Δ contribution, corr-weighted composite + confidence; Node stub is now the offline fallback.
- [x] **S3.2 Real-yield inverse overlay** — gold vs inverted DFII10 dual-axis SVG + 60d rolling correlation + divergence flag. **Accept:** overlay renders ✓ (browser-verified 2026-08-13).
- [x] **S3.3 COT positioning gauge** — CFTC disaggregated ingestor (`cftc.js`); `POST /ingest/cftc`; `GET /cot/gold` with net MM, %long, WoW Δ, 1Y/3Y percentile, extreme flag + area chart. **Accept:** COT gauge renders ✓ (browser-verified; data pending ingest trigger 2026-08-13).
- [x] **S3.4 ETF flows + CB demand** — GLD CSV ingestor (`etf.js`); `POST /ingest/etf`; `GET /etf-flows/gold` with tonnes, daily/weekly Δ, trend badge + area chart. **Accept:** flow panel renders ✓ (browser-verified; data pending ingest trigger 2026-08-13). IAU + WGC deferred.
- [x] **S3.5 Vol/ratio/seasonality/levels/brief** — GVZ already built (S1.5); gold/silver ratio (`XAGUSD` added to OANDA ingest) + 1Y percentile/range; seasonality (12-month avg returns + win rate bar chart); auto key levels (classic pivots + $50 rounds + prev day/week H/L); gold AI brief already built (S1.7). **Accept:** gold cockpit complete ✓ (browser-verified 2026-08-13). Silver data pending ingest.
- [ ] **S3.6 Futures forward curve** — **gap** (free CME term-structure data unavailable). Deferred; spec recorded in FEATURE-SPEC-epic3-gold.md.

## Epic 4 — Events & reaction studies
- [x] **S4.1 Research calendar** — forward calendar (reuse `calendar.js`) + consensus/prior + countdowns + session-aware + high-impact filter. **Accept:** calendar panel ✓ (browser-verified 2026-08-13).
- [x] **S4.2 Event-reaction engine** — Node stub `/event-reaction/:instrument` (join events↔prices; 5/15/30/60m+1d; avg move, hit-rate, bias; beat/miss segmented). **Accept:** per-event/instrument reaction stats ✓ (browser-verified 2026-08-13). Python compute deferred.
- [x] **S4.3 Event intelligence** — pre-event risk-flag alerts (`/events/upcoming`) + post-event chart markers (`/events/markers/:instrument`) on PricePanel. **Accept:** risk badge + markers plotted ✓ (browser-verified 2026-08-13).

## Epic 5 — Positioning, correlation, seasonality
- [x] **S5.1 Correlation matrix + regression** — Node `/correlation` (configurable window, 6 default series incl WTICO_USD), CorrelationPanel heatmap; `/regression/:instrument` OLS scatter+line, RegressionPanel; `/compare` z-score/% overlay, ComparePanel; `/spread` ratio/diff + σ bands, SpreadPanel. **Accept:** interactive matrix ✓ (browser-verified 2026-08-16).
- [x] **S5.2 Regime-conditional corr + flow module** — `/correlation/regime` filters matrix by VIX/HY risk regime; `/positioning/:instrument` consolidated COT+ETF+contrarian; PositioningPanel. **Accept:** regime toggle changes matrix ✓ (browser-verified 2026-08-16).
- [x] **S5.3 Seasonality module** — Node monthly/weekly/dow/session granularity + t-stat/p-value significance + OpEx week effect; enhanced SeasonalityPanel with 4 tabs + ★ markers. **Accept:** seasonality strips w/ n ✓ (browser-verified 2026-08-16).

## Epic 6 — News & AI
- [x] **S6.1 News ingest** — GDELT + RSS ingestors (news.js); instrument tagging + LLM sentiment; NewsFeedPanel (span 12, filters, sentiment dots); 3 new routes. **Accept:** filtered per-instrument feed ✓ (browser-verified 2026-08-17; RSS inserted 40 items).
- [x] **S6.2 Daily briefs** — Enhanced brief mode (`?mode=enhanced`); gathers news+events+regime context; structured BI-style sections; QUICK/FULL toggle on BriefPanel. **Accept:** briefs render with sections ✓ (browser-verified 2026-08-17).
- [x] **S6.3 Explain-this-move** — `POST /api/research/explain-move`; WHY? button on PricePanel; gathers news/events/regime/correlatedMoves; LLM explanation + evidence; cached in `explanations` table. **Accept:** click WHY?, get grounded explanation ✓ (browser-verified 2026-08-17).

## Epic 7 — Journal fusion ★★
- [ ] **S7.1 Context snapshots** — on trade log, capture full market state → `context_snapshots`. **Accept:** new trades get a snapshot row.
- [ ] **S7.2 Context tab + replay** — "Market Context" tab on TradeDetail; condition-replay reloads the picture. **Accept:** tab renders snapshot; replay works.
- [ ] **S7.3 Edge analytics + debrief** — Python aggregate journal setups × driver states; AI debrief note per closed trade. **Accept:** edge table + coaching note.

## Epic 8 — Alerts, backtesting, launchpad, polish
- [ ] **S8.1 Alerts engine** — price/indicator/driver/event/positioning/vol/correlation → toast/email/Telegram; history + snooze. **Accept:** driver-threshold alert fires end-to-end.
- [ ] **S8.2 Backtesting** — Python engine (technical + event-driven + driver-conditional) → equity curve/win-rate/expectancy/drawdown. **Accept:** driver-conditional backtest returns metrics. *(may split)*
- [ ] **S8.3 Launchpad** — `react-grid-layout` saved layouts + `cmdk` command palette. **Accept:** rearrange panels, jump via palette.
- [ ] **S8.4 Hardening + deploy** — freshness UX everywhere; provider-abstraction cleanup; perf pass; compliance footer; docker-compose deploy. **Accept:** one `docker-compose up` brings stack green.
