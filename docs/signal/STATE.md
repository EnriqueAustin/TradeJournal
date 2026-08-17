# STATE — resume pointer

> Read this first every session. Update it last.

## Status
- **Last completed:** **Epic 6 — News & AI (S6.1–S6.3)** ✓ (2026-08-16)
- **Next session:** **Epic 7 — Journal Fusion** (context snapshots, replay, edge analytics)
- **Current epic:** Epic 6 — News & AI ✅ COMPLETE
- **Branch:** `bloomberg-terminal`

## In-progress notes
- **QA pass on Epic 0–2 done** (2026-08-13). 4 bugs fixed. See BUILD-LOG QA entry.
- **Epic 0 complete** (S0.1–S0.5). Terminal UI + OANDA price + WebSocket ticker.
- **Epic 1 complete** (S1.1–S1.7). US100 cockpit fully operational.
- **Epic 2 complete** (S2.1–S2.4). Macro panels (rates/econ/regime) are cross-instrument.
- **Epic 3 complete** (S3.1–S3.5, S3.6 deferred). Gold cockpit fully operational:
  - **S3.1:** DriverScorecard — 7 drivers (real yields, DXY, breakevens, GVZ, HY spread, fed funds) with z-scores, rolling correlation, bullish/neutral/bearish signals, composite tailwind/headwind gauge
  - **S3.2:** RealYieldOverlay — dual-axis SVG (gold amber vs inverted DFII10 cyan) + 60d correlation badge + divergence flag
  - **S3.3:** CotPanel — CFTC disaggregated ingestor (cftc.js), net MM positioning, %long, WoW Δ, 1Y/3Y percentile bar, extreme flag, 52-week area chart
  - **S3.4:** EtfFlowPanel — GLD CSV ingestor (etf.js), tonnes + daily/weekly Δ, trend badge (inflow/flat/outflow), 90-day area chart. IAU deferred.
  - **S3.5:** GoldSilverPanel (XAGUSD added to OANDA + schema), SeasonalityPanel (12-month bar chart + win rates), KeyLevelsPanel (pivots/rounds/structure with distances)
  - **S3.6:** Deferred — free CME gold futures term-structure data unavailable (gap documented in FEATURE-SPEC-epic3-gold.md)
- **Epic 4 complete** (S4.1–S4.3). Events & reaction studies:
  - **S4.1:** CalendarPanel — ForexFactory ingestor into market.db, date-grouped event list, impact filters, countdown timers, session tagging, risk badge
  - **S4.2:** EventReactionPanel — historical reaction stats (5m/15m/30m/60m/1d windows), avg move/bias/up%, beat/miss segmentation, 12 preset events + custom search
  - **S4.3:** Event intelligence — upcoming events risk level (clear/approaching/imminent), chart event markers on PricePanel (arrowUp markers below candles)
- **Docker WS fix** (pre-Epic 4): nginx.conf `/ws/` proxy + LiveTicker same-origin WS URL in production
- Data ingestors need manual trigger: `POST /ingest/fred`, `/ingest/cboe`, `/ingest/cftc`, `/ingest/etf`, `/ingest/calendar`. Scheduled refresh deferred.
- Python compute deferred for: Fed rate probability (S2.2), surprise z-scores (S2.3), regime composite (S2.4), driver z-scores (S3.1), event-reaction (S4.2). Node stubs serve same API shape.
- **Epic 5 complete** (S5.1–S5.3). Correlation, regression, comparison & positioning:
  - **S5.1:** CorrelationPanel (heatmap, 20/60/120/252d windows), RegressionPanel (scatter+OLS), ComparePanel (z-score/% overlay), SpreadPanel (ratio/diff + σ bands). New helpers: getDailyValues, alignByDay, pearson. WTICO_USD added to instrument universe.
  - **S5.2:** Regime-conditional correlation (VIX/HY regime filter on matrix), PositioningPanel (consolidated COT+ETF+contrarian).
  - **S5.3:** Enhanced SeasonalityPanel (monthly/weekly/dow/session granularity, t-stat significance, OpEx effect).
- **Epic 6 complete** (S6.1–S6.3). News & AI:
  - **S6.1:** NewsFeedPanel — GDELT + RSS ingestor (news.js), instrument tagging, LLM sentiment scoring, filtered feed API, full-width panel with sentiment/instrument filters
  - **S6.2:** Enhanced BriefPanel — QUICK/FULL toggle, enhanced mode gathers news+events+regime context, structured BI-style sections
  - **S6.3:** Explain-this-move — WHY? button on PricePanel, gathers nearby news/events/regime/correlatedMoves, LLM explanation with evidence, cached in explanations table
  - **Bug fix:** callLLM return value mismatch in brief endpoint (was destructuring object, callLLM returns string)
- Before Epic 7 (Journal Fusion): plan context snapshot schema and trade-detail integration.

## Dev preview
- `.claude/launch.json` defines the `web` config (Vite :5173) + `server` (:4000) for the preview tools, both with `autoPort: true`. Backend (:4000) + analytics (:8001) run separately. Open `http://localhost:5173/research`.

## Dev run notes (this machine)
- Node: `npm run dev` (server+web, no Python needed). Full stack: `npm run dev:all`.
- **Python is `py` here, not `python`** (Python 3.14; `python` alias not installed). A venv exists at `analytics/.venv` (fastapi+uvicorn installed). To run analytics locally: activate `analytics/.venv` then `npm run dev:analytics`, OR `analytics/.venv/Scripts/python -m uvicorn app.main:app --port 8001`.
- Full `analytics/requirements.txt` (pandas/numpy) not yet installed locally — Docker (`python:3.12-slim`) builds them fine; install locally when S1.2 needs compute. Note: pandas/numpy pinned versions may lack 3.14 wheels — use Docker or a 3.12 venv for the heavy deps.
- Docker: research keys must also be available to `docker compose` (root `.env` or shell env) since compose interpolates `${FRED_API_KEY}` etc.; `server/.env` is read only by the non-docker dev server.

## Keys / setup TODO (user action)
- [x] FRED API key → `server/.env` `FRED_API_KEY` ✓
- [x] Finnhub key → `FINNHUB_KEY` ✓ (+ `FINNHUB_WEBHOOK_SECRET` for inbound webhooks, not needed until we opt into push)
- [x] Alpaca key+secret → `ALPACA_KEY`/`ALPACA_SECRET` ✓ (paper keys). Market-data endpoints: REST `https://data.alpaca.markets/v2`, WS `wss://stream.data.alpaca.markets/v2/iex` (NOT the paper-api trading host shown in the dashboard).
- [x] OANDA token — already configured (`OANDA_API_TOKEN`)

## Open decisions / risks
- Gold intraday sub-15-min free feed = OANDA stream (broker-sourced) — acceptable as "second screen"; note in freshness badge.
- Free gold options chain for OVDV-style skew is thin — S3.5 spec records the gap + paid upgrade path.
- FRED/CBOE ingest not auto-scheduled yet — manual trigger only. Add interval/cron scheduling in Epic 2 or 8.
