# ARCHITECTURE

## Principle
Fit the app's **real** stack, not the product brief's idealized one. The brief assumes an `/apps /packages` monorepo, Python, Docker, Redis, Postgres. Reality: two sibling dirs (`server/` plain-JS ESM Express + SQLite, `web/` React+TS Vite) run by `concurrently`. We extend, we don't refactor.

## Layout (additions in **bold**)
```
TradeJournal/
├── docs/signal/            ← build-tracking docs (this folder)
├── server/                 existing Express (JS)
│   └── src/research/        ← NEW: ingest/*, routes.js, analyticsClient.js, ws.js, schema.js
├── web/                    existing React (TS)
│   └── src/features/signal/ ← NEW: pages/, panels/, terminal/ (theme+shell), api additions
├── analytics/              ← NEW: Python FastAPI + pandas (heavy quant)
│   └── app/ (main.py, routers/, compute/)  reads data/market.db read-only
├── data/market.db          ← NEW: research SQLite (separate from journal.db)
└── docker-compose.yml       extend: add analytics service
```

## Service split
- **Node / Express** — orchestration & I/O: ingestion scheduler, all writes to `market.db` (single writer, WAL), REST gateway (`/api/research/*`), WebSocket push (`/ws/research`), Anthropic SDK (`ai.js callLLM`), proxy to Python + cache.
- **Python / FastAPI** — heavy quant only: indicators, rolling correlation/regression, z-scores/percentiles, COT analytics, seasonality, expected-move, breadth, event-reaction studies, backtesting. Stateless HTTP; reads `market.db` read-only; returns JSON; Node caches by input-hash + data-version.

**Compute placement rule:** pandas/numpy/statsmodels/backtesting/seasonality/event-reaction/correlation/z-scores → **Python**. Scheduling, I/O, WS, serving, AI-SDK, simple queries → **Node**.

## Data flow
`free sources → Node ingest (scheduler) → market.db → (a) Node serves raw/simple to web; (b) Python reads market.db → compute → JSON → Node caches in analytics_cache → web`. Live prices: `OANDA stream → Node → WebSocket → web`.

## PM overrides vs the brief (with rationale)
- **No `/apps/**` restructure** — high-risk whole-app refactor, zero feature value. Add `analytics/` as a sibling; keep `server/`+`web/` in place.
- **Server stays plain-JS ESM** — no TS migration; Zod-style validation = plain-JS runtime guards; contract types hand-mirrored into `web/src/types.ts`.
- **Redis deferred** — cache in SQLite `analytics_cache` until concurrency demands it.
- **Postgres/Timescale deferred** — SQLite (WAL) is correct for solo/single-node; migration is future-only.

## Provider abstraction
Every feed implements a common `fetch()/normalize()` interface in `server/src/research/ingest/`. ToS-restricted free sources are isolated so a licensed feed (Twelve Data/Polygon/Finnhub paid) can be swapped in a commercial tier without touching feature code.

## Two DBs
`journal.db` (existing journal) stays untouched. `market.db` (new) holds research data. Journal-fusion (`context_snapshots`) is the bridge: written by the server when a trade is logged, joining the two worlds.
