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
- [ ] **S2.1 FRED ingest engine** — series registry + generic ingestor → `series`/`series_data` (DFII10/5, DGS2/10/30, T10YIE, DTWEXBGS, CPI/PCE/PAYEMS). **Accept:** series stored + freshness badge.
- [ ] **S2.2 Rates board + Fed odds + YCRV** — rates board (real/nominal/2s10s/breakevens); Python Fed rate-probability (WIRP-style); Treasury yield curve. **Accept:** rates panel + implied odds by meeting.
- [ ] **S2.3 Econ tracker + surprise monitor** — actual vs consensus vs prior + Python surprise index (ECSU) + sparkline. **Accept:** tracker with surprise z-scores.
- [ ] **S2.4 Risk regime classifier** — Python composite (VIX/credit-proxy/breadth/DXY) → regime label + per-instrument behavior. **Accept:** regime badge.

## Epic 3 — Gold cockpit
- [ ] **S3.1 Driver scorecard** — Python `/compute/zscores` + rolling corr per driver; composite tailwind/headwind gauge; impact arrows. **Accept:** flagship scorecard live. *(may split)*
- [ ] **S3.2 Real-yield inverse overlay** — gold vs inverted DFII10 + live corr + divergence flag. **Accept:** overlay + decoupling flag.
- [ ] **S3.3 COT positioning gauge** — CFTC ingest → `cot`; Python percentile bands + WoW Δ + extreme flags. **Accept:** COT gauge with pctile flags.
- [ ] **S3.4 ETF flows + CB demand** — GLD/IAU CSV → `etf_holdings` + Python trend; WGC quarterly context. **Accept:** flow panel + cumulative trend.
- [ ] **S3.5 Vol/ratio/seasonality/levels/brief** — GVZ+ATR/RV + expected move; gold/silver ratio + pctile; seasonality; auto key levels; gold AI brief. **Accept:** gold cockpit complete.
- [ ] **S3.6 Futures forward curve** — CME/stooq term structure (GC1..GCn); contango/backwardation + roll-yield read. **Accept:** curve panel + regime label.

## Epic 4 — Events & reaction studies
- [ ] **S4.1 Research calendar** — forward calendar (reuse `calendar.js`) + consensus/prior + countdowns + session-aware + high-impact filter. **Accept:** calendar panel.
- [ ] **S4.2 Event-reaction engine** — Python `/compute/event-reaction` (join events↔prices; 5/15/30/60m+1d; avg move, hit-rate, vol expansion; beat/miss segmented). **Accept:** per-event/instrument reaction stats. *(may split)*
- [ ] **S4.3 Event intelligence** — pre-event risk-flag alerts + post-event chart auto-annotation. **Accept:** flags fire + markers plotted.

## Epic 5 — Positioning, correlation, seasonality
- [ ] **S5.1 Correlation matrix + regression** — Python `/compute/correlation` (configurable window) + ratio charts + lead/lag; HRA regression + beta; COMP compare; CIX custom-spread builder. **Accept:** interactive matrix. *(may split)*
- [ ] **S5.2 Regime-conditional corr + flow module** — regime-conditioned correlations; consolidate COT/put-call/flow + contrarian flags. **Accept:** regime toggle changes matrix.
- [ ] **S5.3 Seasonality module** — Python monthly/WoY/DoW/session + OpEx/quad-witching + sample size + significance. **Accept:** seasonality strips w/ n.

## Epic 6 — News & AI
- [ ] **S6.1 News ingest** — GDELT + curated RSS → `news`, dedupe + instrument tagging + sentiment. **Accept:** filtered per-instrument feed.
- [ ] **S6.2 Daily briefs** — both-instrument grounded briefs via `callLLM`, cached in `briefs`, scheduled. **Accept:** briefs regenerate on schedule.
- [ ] **S6.3 Explain-this-move** — `POST /api/research/explain-move` → click candle → correlate news/events/drivers → Claude. **Accept:** click a spike, get grounded explanation.

## Epic 7 — Journal fusion ★★
- [ ] **S7.1 Context snapshots** — on trade log, capture full market state → `context_snapshots`. **Accept:** new trades get a snapshot row.
- [ ] **S7.2 Context tab + replay** — "Market Context" tab on TradeDetail; condition-replay reloads the picture. **Accept:** tab renders snapshot; replay works.
- [ ] **S7.3 Edge analytics + debrief** — Python aggregate journal setups × driver states; AI debrief note per closed trade. **Accept:** edge table + coaching note.

## Epic 8 — Alerts, backtesting, launchpad, polish
- [ ] **S8.1 Alerts engine** — price/indicator/driver/event/positioning/vol/correlation → toast/email/Telegram; history + snooze. **Accept:** driver-threshold alert fires end-to-end.
- [ ] **S8.2 Backtesting** — Python engine (technical + event-driven + driver-conditional) → equity curve/win-rate/expectancy/drawdown. **Accept:** driver-conditional backtest returns metrics. *(may split)*
- [ ] **S8.3 Launchpad** — `react-grid-layout` saved layouts + `cmdk` command palette. **Accept:** rearrange panels, jump via palette.
- [ ] **S8.4 Hardening + deploy** — freshness UX everywhere; provider-abstraction cleanup; perf pass; compliance footer; docker-compose deploy. **Accept:** one `docker-compose up` brings stack green.
