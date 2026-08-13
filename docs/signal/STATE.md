# STATE — resume pointer

> Read this first every session. Update it last.

## Status
- **Last completed:** **Epic 1 — US100 cockpit (S1.1–S1.7)** ✓ (2026-08-13)
- **Next session:** **Epic 2 — Macro core** (run deep-research pass first → write `FEATURE-SPEC-epic2-macro.md`)
- **Current epic:** Epic 1 — US100 cockpit ✅ COMPLETE
- **Branch:** `bloomberg-terminal`

## In-progress notes
- **Epic 0 complete** (S0.1–S0.5 all done + verified). Terminal UI live at `/research` with OANDA price charts + real-time WebSocket ticker.
- **Epic 1 complete** (S1.1–S1.7 all done + browser-verified). US100 cockpit fully operational:
  - **S1.1:** QQQ top-40 constituents in DB + Alpaca IEX live quotes
  - **S1.2:** Mag-7 contribution grid + sector contribution + summary bar (Total/Mag-7/Broad)
  - **S1.3:** Breadth A/D + treemap heatmap
  - **S1.4:** FRED ingestor (8 rate series) + rate overlay panel
  - **S1.5:** CBOE VXN/GVZ ingestor + vol/expected-move panel
  - **S1.6:** Finnhub earnings ingestor + weight-ranked earnings table
  - **S1.7:** Sector rotation panel + AI daily brief via callLLM
- Data ingestors need manual trigger: `POST /api/research/ingest/fred`, `/ingest/cboe`. Scheduled refresh deferred.
- Gold tab shows vol + brief panels; driver scorecard placeholder remains (Epic 3).
- Before Epic 2 (Macro): run deep-research pass → write `FEATURE-SPEC-epic2-macro.md`, update BLOOMBERG-PARITY.md.

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
