# STATE — resume pointer

> Read this first every session. Update it last.

## Status
- **Last completed:** **Epic 2 — Macro core (S2.1–S2.4)** ✓ (2026-08-13)
- **Next session:** **Epic 3 — Gold cockpit** (run deep-research pass first → write `FEATURE-SPEC-epic3-gold.md`)
- **Current epic:** Epic 2 — Macro core ✅ COMPLETE
- **Branch:** `bloomberg-terminal`

## In-progress notes
- **QA pass on Epic 0–2 done** (2026-08-13). 4 bugs fixed + runtime-verified against live data: (1) regime factor colors dead — signal vocab mismatch; (2) regime labels off-contract (`constructive`/no `crisis`); (3) econ "YoY" was a 5-mo change; (4) GVZ ingested 0 rows (2-col CSV vs 5-col parser) — gold vol panel was empty. See BUILD-LOG QA entry. market.db now has all 18 FRED series + VIX/VXN/GVZ populated.
- **Epic 0 complete** (S0.1–S0.5 all done + verified). Terminal UI live at `/research` with OANDA price charts + real-time WebSocket ticker.
- **Epic 1 complete** (S1.1–S1.7 all done + browser-verified). US100 cockpit fully operational.
- **Epic 2 complete** (S2.1–S2.4 all done + tsc-verified). Macro panels are cross-instrument (shown on both tabs):
  - **S2.1:** FRED registry expanded to 18 series (rates/real/breakevens/spread/dollar/econ/fed/credit)
  - **S2.2:** RatesBoard panel — sectioned display (nominal/real/breakevens/spreads/policy) + SVG yield curve
  - **S2.3:** EconTracker panel — CPI/PCE/PAYEMS/UNRATE with value/MoM/YoY + sparkline trends
  - **S2.4:** RegimePanel — composite risk regime badge (risk-on/neutral/risk-off/crisis) + factor breakdown
- Data ingestors need manual trigger: `POST /api/research/ingest/fred`, `/ingest/cboe`. Scheduled refresh deferred.
- Gold tab shows vol + brief + macro panels; driver scorecard placeholder remains (Epic 3).
- Python compute deferred for: Fed rate probability (S2.2), surprise z-scores (S2.3), regime composite (S2.4). Node implementations serve as functional stubs.
- Before Epic 3 (Gold cockpit): run deep-research pass → write `FEATURE-SPEC-epic3-gold.md`, update BLOOMBERG-PARITY.md.

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
