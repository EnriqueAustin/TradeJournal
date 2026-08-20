# API-CONTRACT

Two surfaces: **Node** (`/api/research/*`, client-facing, also serves cached Python results) and **Python** (`/compute/*`, internal, Node→Python only). Keep in sync as endpoints land. Status: `planned` until the owning session ships it.

## Node → Web (`/api/research/*`)
| Method | Path | Session | Purpose |
|---|---|---|---|
| GET | `/api/research/health` | S0.1 | **built** — `{server, marketDb, schema_version, analytics, providers{oanda,fred,finnhub,alpaca}}`. |
| GET | `/api/research/price/:instrument?tf=&from=&to=&limit=` | S0.4 | **built** — OHLCV bars for a timeframe. Returns `{instrument, timeframe, count, bars[], freshness}`. |
| GET | `/api/research/price/:instrument/export?tf=&from=&to=` | S0.4 | **built** — CSV export (HP-style). |
| POST | `/api/research/ingest` | S0.4 | **built** — Trigger manual OANDA ingest `{days?}`. |
| WS | `/ws/research` | S0.5 | **built** — Live price ticks `{type:'price', instrument, ts, bid, ask, mid}`. On connect: sends latest cached prices. Supports ping/pong. |
| GET | `/api/research/constituents/us100` | S1.1 | **built** — QQQ top-40 members + weights + Alpaca quotes + freshness. |
| GET | `/api/research/contribution/us100` | S1.2 | **built** — weight×changePct contribution per member; summary (total/mag7/broad); sector aggregation. |
| GET | `/api/research/breadth/us100` | S1.3 | **built** — advancers/decliners/unchanged/A:D ratio + treemap data. |
| GET | `/api/research/overlay/us100/rates` | S1.4 | **built** — US100 D1 bars + DGS10 + DFII10 series data. |
| GET | `/api/research/vol/:instrument` | S1.5/S3.5 | **built** — VXN/GVZ current, 60d pctile/range/avg, expected move (daily/weekly 1σ), history. |
| GET | `/api/research/earnings/us100` | S1.6 | **built** — constituent earnings enriched with weight + importance + mag7 flag; freshness. |
| GET | `/api/research/putcall/us100` | S1.7 | P/C ratios + percentile. |
| GET | `/api/research/brief/:instrument` | S1.7/S3.5/S6.2 | **built** — AI daily brief via callLLM, cached per instrument per day in briefs table. |
| GET | `/api/research/series/:id?from=&to=&limit=` | S1.4 | **built** — FRED/CBOE series data + meta + freshness. |
| GET | `/api/research/series` | S1.4 | **built** — list all known series. |
| POST | `/api/research/ingest/fred` | S1.4 | **built** — trigger FRED ingest (all 8 registered series). |
| POST | `/api/research/ingest/cboe` | S1.5 | **built** — trigger CBOE vol ingest (VIX/VXN/GVZ). |
| GET | `/api/research/rates` | S2.2 | **built** — Rates board (18 series sectioned: nominal/real/breakevens/spreads/policy) + yield curve points. |
| GET | `/api/research/econ` | S2.3 | **built** — Econ tracker: CPI/PCE/PAYEMS/UNRATE with value/MoM/YoY + 12-point sparkline. |
| GET | `/api/research/regime` | S2.4 | **built** — Risk regime label (risk-on/neutral/risk-off/crisis) + composite score + factor breakdown. |
| GET | `/api/research/drivers/:instrument` | S3.1 | **built + Python compute** — 7 drivers with z-score (level), z-change, returns-based correlation + p-value, OLS β + R², contribution (β·Δ), signal; corr-weighted composite tailwind/headwind + confidence. `engine:'python'`, falls back to `'node'` stub if analytics offline. Cached in `analytics_cache` by data-version. |
| GET | `/api/research/overlay/xauusd/realyield?limit=` | S3.2 | **built** — Gold D1 close + DFII10 + 60d rolling correlation. |
| GET | `/api/research/cot/gold` | S3.3 | **built** — COT net MM, %long, WoW Δ, 1Y/3Y percentile, extreme flag + 52-week history. |
| POST | `/api/research/ingest/cftc` | S3.3 | **built** — Trigger CFTC disaggregated report ingest (gold rows). |
| GET | `/api/research/etf-flows/gold` | S3.4 | **built** — GLD tonnes, daily/weekly Δ, trend (inflow/flat/outflow) + 90-day history. |
| POST | `/api/research/ingest/etf` | S3.4 | **built** — Trigger GLD CSV ingest from SPDR. |
| POST | `/api/research/ingest/etf/upload` | S3.4 | **built** — Manual GLD CSV import (raw text body); fallback when SPDR URL blocks. |
| GET | `/api/research/ratio/gold-silver?limit=` | S3.5 | **built** — Gold/silver ratio, 1Y avg/high/low/percentile + history. |
| GET | `/api/research/seasonality/:instrument` | S3.5 | **built** — 12-month avg returns + win rate + sample size. |
| GET | `/api/research/levels/:instrument` | S3.5 | **built** — Classic pivots (PP/R1-R3/S1-S3) + round numbers + prev day/week H/L. |
| GET | `/api/research/curve/gold` | S3.6 | gap (free-data unavailable; deferred). |
| GET | `/api/research/calendar?impact=&country=&from=&to=&limit=` | S4.1 | **built** — Forward calendar (date-grouped, enriched with countdown/session/isPast). Returns `{events[], count, nextHighImpact, freshness}`. |
| POST | `/api/research/ingest/calendar` | S4.1 | **built** — Trigger ForexFactory calendar ingest; also accepts `{events:[...]}` payload for manual push. |
| GET | `/api/research/event-reaction/:instrument?event=&limit=` | S4.2 | **built** — Historical reaction stats across 5 windows (5m/15m/30m/60m/1d). Returns `{stats[], byBeat[], byMiss[], history[], sampleSize, freshness}`. |
| GET | `/api/research/events/upcoming?hours=` | S4.3 | **built** — Upcoming high-impact events with risk level (clear/approaching/imminent). |
| GET | `/api/research/events/markers/:instrument?from=&to=` | S4.3 | **built** — Event markers for chart overlay (high+medium impact USD events with surprise classification). |
| GET | `/api/research/correlation?window=&assets=` | S5.1 | Rolling corr matrix + regression. |
| GET | `/api/research/seasonality/:instrument` | S5.3 | Seasonality with sample size. |
| GET | `/api/research/news/:instrument` | S6.1 | Tagged, sentiment-scored feed. |
| POST | `/api/research/explain-move` | S6.3 | `{instrument, ts}` → Claude narrative. |
| GET | `/api/journal/:tradeId/context` | S7.2 | Context snapshot for a trade. |
| GET | `/api/research/edge/:instrument` | S7.3 | Edge analytics (setups × driver states). |
| GET/POST/DELETE | `/api/research/alerts` | S8.1 | Alerts CRUD. |
| POST | `/api/research/backtest` | S8.2 | Run backtest → metrics (proxies Python). |

## Python `/compute/*` (internal)
| Method | Path | Session | Returns |
|---|---|---|---|
| GET | `/health` | S0.1 | `{ok:true}`. |
| POST | `/compute/indicators` | S0.4+ | MA/RSI/MACD/BB/ATR/VWAP/etc. for bars. |
| POST | `/compute/contribution` | S1.2 | weight×move → index points per member. |
| POST | `/compute/breadth` | S1.3 | %>MA, A/D, new H/L, thrust. |
| POST | `/compute/expected-move` | S1.5 | daily/weekly bands from IV; IV/RV. |
| POST | `/compute/drivers` | S3.1 | **built** — per-driver z-score/z-change, returns-based corr + p-value, OLS β/R², β·Δ contribution, corr-weighted composite + confidence. (Was planned as `/compute/zscores`.) |
| POST | `/compute/fed-probability` | S2.2 | implied hike/hold/cut by meeting. |
| POST | `/compute/surprise` | S2.3 | actual−consensus z-scored. |
| POST | `/compute/regime` | S2.4 | composite risk-on/off label. |
| POST | `/compute/cot` | S3.3 | percentile bands + extreme flags. |
| POST | `/compute/curve` | S3.6 | contango/backwardation + roll yield. |
| POST | `/compute/event-reaction` | S4.2 | windowed move/hit-rate/vol-expansion by surprise. |
| POST | `/compute/correlation` | S5.1 | matrix + lead/lag + regression + beta. |
| POST | `/compute/seasonality` | S5.3 | monthly/WoY/DoW/session + significance. |
| POST | `/compute/backtest` | S8.2 | equity curve/win-rate/expectancy/drawdown. |
| POST | `/compute/edge-analytics` | S7.3 | journal setups × driver-state performance. |

## Conventions
- Node validates params with plain-JS guards before proxying; caches Python responses in `analytics_cache` (`input_hash + data_version`).
- Errors: consistent `{error, detail}` shape; every response carries a `freshness` field (source + age).
- Client uses existing `web/src/api/client.ts` `request<T>()` wrapper + `useApi` hook; add methods to the `api` object.
