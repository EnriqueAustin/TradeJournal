# CONVENTIONS — mirror the existing app

New code must read like the code already here. Reuse before writing new.

## Backend (plain-JS ESM, `server/`)
- **Migrations:** add tables/columns in `server/src/research/schema.js` via `migrate()` — base `CREATE TABLE IF NOT EXISTS`, then guarded `ALTER TABLE ADD COLUMN` after `PRAGMA table_info(...)` checks. **No** migration framework. (Pattern: existing `server/src/db.js`.)
- **DB access:** direct `better-sqlite3` prepared statements. Research DB handle exported from `schema.js` (separate `market.db`). Single writer, WAL.
- **Routes:** `index.js` is already 1676 lines — put research routes in `server/src/research/routes.js` and mount once (`app.use('/api/research', researchRouter)`). Keep the `/api` prefix.
- **Ingestion:** each source = a module in `server/src/research/ingest/` implementing the `Provider` interface (`fetch()`, `normalize()`, `id`). Idempotent, retried, writes `source_health`.
- **Scheduler:** follow `calendar.js` `setInterval` + overlap-guarded `safeRefresh()` + `.unref()`. If a real cron matrix is needed later, add `node-cron` (not present today) — note it in BUILD-LOG.
- **AI:** reuse `ai.js` `callLLM(...)` (dual Anthropic/Ollama, default `claude-opus-4-8`). Prompt for strict JSON, parse with resilient extractor. AI narrates provided data only — never invents numbers/levels.
- **Prices:** reuse `marketdata.js` (OANDA fetch) + `bars.js` (`price_bars`, `TF_MINUTES`, `aggregateBars`, `getBarsForTf`).
- **WS:** none exists — add `ws` in `server/src/research/ws.js` (first realtime transport). Widen CORS beyond the single dev origin when the WS/client surface grows.

## Python (`analytics/`)
- FastAPI + pandas/numpy/statsmodels. Stateless endpoints under `/compute/*`. Read `market.db` **read-only**.
- Pure functions in `analytics/app/compute/`, thin routers in `analytics/app/routers/`. Unit-test each compute against a fixture slice of `market.db`.
- Return plain JSON; let Node own caching.

## Frontend (React+TS, `web/`)
- **Feature module** lives in `web/src/features/signal/` — mirror the `web/src/backtest/` template: business logic in tested `.ts` files, thin React components, a chart bound to a domain engine.
- **Terminal theme** in `web/src/features/signal/terminal/` — dense mono, black/green/amber tokens, base primitives (Panel, DataRow, StatusBadge, TickerCell). This is a **new** aesthetic, scoped to `/research` — don't disturb the slate+indigo app theme.
- **Data layer:** `useApi(fetcher, deps)` + `filterKey(...)` (existing `hooks/useApi.ts`); add endpoints to `web/src/api/client.ts` `api` object. Wrap async UI in existing `<AsyncBoundary>` (`components/states.tsx`).
- **Charts:** reuse `components/CandleChart.tsx` (lightweight-charts) for price; recharts for analytics overlays. New heavy grids: TanStack Table (add dep in S1.2). Treemap/heatmaps: recharts or a small custom SVG.
- **Types:** hand-mirror server contract into `web/src/types.ts` (single types file).
- **Routing:** add a `<Route>` in `App.tsx` + one entry in `components/Sidebar.tsx` `links` array.

## Cross-cutting (every session)
- **Freshness badge** on every panel (source + age). **Compliance footer** "Analysis, not financial advice" persistent.
- **Time:** store UTC; render user-tz with Asia/London/NY session shading.
- **Cache:** analytics keyed by `input_hash + data_version`; recompute only on new data.
- **Green rule:** every session ends compiling + running + with a visible result. Add `*.test.js`/`*.test.ts` for pure logic (mirror `backtest/` discipline).
- **Docs rule:** update SCHEMA/API-CONTRACT/BUILD-LOG/STATE/ROADMAP at session end.
