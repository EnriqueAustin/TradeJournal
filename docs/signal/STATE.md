# STATE — resume pointer

> Read this first every session. Update it last.

## Status
- **Last completed:** **Epic 3 — Gold cockpit (S3.1–S3.5)** ✓ (2026-08-13)
- **Next session:** **Epic 4 — Events & reaction studies** (run deep-research pass first → write `FEATURE-SPEC-epic4-events.md`)
- **Current epic:** Epic 3 — Gold cockpit ✅ COMPLETE (S3.6 deferred — free-data gap)
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
- Data ingestors need manual trigger: `POST /ingest/fred`, `/ingest/cboe`, `/ingest/cftc`, `/ingest/etf`. Scheduled refresh deferred.
- Python compute deferred for: Fed rate probability (S2.2), surprise z-scores (S2.3), regime composite (S2.4), driver z-scores (S3.1). Node stubs serve same API shape.
- Before Epic 4 (Events): run deep-research pass → write `FEATURE-SPEC-epic4-events.md`, update BLOOMBERG-PARITY.md.

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
