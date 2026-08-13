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
| GET | `/api/research/drivers/:instrument` | S3.1 | Driver scorecard (z-scores, corr, gauge). |
| GET | `/api/research/cot/gold` | S3.3 | COT gauge + percentiles. |
| GET | `/api/research/etf-flows/gold` | S3.4 | GLD/IAU flows + trend. |
| GET | `/api/research/curve/gold` | S3.6 | Futures forward curve + roll. |
| GET | `/api/research/calendar?impact=high` | S4.1 | Forward calendar. |
| GET | `/api/research/event-reaction/:event/:instrument` | S4.2 | Historical reaction stats. |
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
| POST | `/compute/zscores` | S3.1 | z-scores + percentiles + rolling corr per driver. |
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
