# DATA-SOURCES — free feed registry

All feeds are free. Each sits behind the `Provider` interface (`fetch()`/`normalize()`) so it can be swapped for a licensed feed later. **Every panel shows a freshness badge.**

## Sub-15-min / real-time story (the user's explicit ask)
- **US100 can be genuinely real-time free:** Alpaca IEX websocket (QQQ + Mag-7 + members) + OANDA `NAS100_USD` stream.
- **Gold is near-real-time free:** OANDA `XAU_USD` stream (broker-sourced). Tick-precise consolidated gold is not free — record the gap; paid feed is the upgrade path.
- Honest framing stays in the UI: **analysis "second screen," not a tick-precise execution feed.**

## Registry
| Need | Source | Real-time? | Key env | Endpoint / notes |
|---|---|---|---|---|
| XAUUSD price | **OANDA v20** | near-RT stream (practice) | `OANDA_API_TOKEN` (have) | `XAU_USD`; candles `/v3/instruments/{sym}/candles`; stream `/v3/accounts/{id}/pricing/stream`. Reuse `server/src/marketdata.js`. |
| US100 price | **OANDA v20** | near-RT stream | same | `NAS100_USD`; same pipeline. |
| QQQ + Mag-7 + members | **Alpaca IEX** | **TRUE real-time** (IEX venue) | `ALPACA_KEY`/`ALPACA_SECRET` | WS `wss://stream.data.alpaca.markets/v2/iex`; REST 200 rpm. Single-venue (~2–5% volume). |
| Earnings dates/estimates; backup quotes | **Finnhub** | RT US trades WS (50 sym) | `FINNHUB_KEY` | 60 calls/min. `/calendar/earnings`, `/quote`, WS `wss://ws.finnhub.io`. |
| Real/nominal yields, breakevens, DXY, CPI/PCE/NFP | **FRED** | daily | `FRED_API_KEY` | `api.stlouisfed.org/fred/series/observations`. Series: DFII10, DFII5, DGS2/10/30, T10YIE, T5YIE, DTWEXBGS, CPIAUCSL, PCEPI, PAYEMS. |
| Gold COT | **CFTC** | weekly (Fri 3:30pm ET) | none | Disaggregated futures-only CSV/API; managed-money long/short/OI. |
| Gold ETF flows | **SPDR / iShares** CSV | daily | none | GLD (spdrgoldshares.com) + IAU holdings — tonnes/shares/AUM. |
| VIX / VXN / GVZ | **CBOE** / stooq | daily (delayed intraday) | none | Index history CSV. |
| Put/call ratios | **CBOE** CSV | daily | none | Equity + index P/C. |
| QQQ holdings/weights | **Invesco** CSV / slickcharts | daily | none | Constituent weights + sector. |
| Fed odds | derive from **CME** fed funds futures | daily | none | WIRP-style probability from ZQ futures curve. |
| Yield curve | **US Treasury** API | daily | none | Daily par yield curve. |
| Central-bank / physical gold demand | **World Gold Council** | quarterly | none | goldhub datasets. |
| Economic calendar | **ForexFactory** | scheduled | none | Already ingested via `server/src/calendar.js` (+ `POST /api/news/ingest` fallback path). |
| News | **GDELT** + curated RSS | continuous | none | GDELT DOC 2.0 API; RSS: Kitco, Reuters, FX feeds. |
| SOX (semis tell) | stooq / yahoo | delayed | none | `^SOX` EOD/intraday. |
| Silver, oil (correlation) | OANDA / stooq | near-RT / delayed | — | `XAG_USD`, `WTICO_USD` on OANDA. |
| EOD backup | stooq / yahoo-finance2 | 15-min delayed | none | Fallback only when a primary is down. |

## Rate-limit discipline
- Poll intervals honor each source's limits; ingestors are idempotent + retried + record source health.
- FRED/CFTC/CBOE/ETF: daily or on-release cadence (cheap). Alpaca/OANDA: stream, don't poll. Finnhub: ≤60/min, batch.
- Cache computed analytics by `input_hash + data_version` — recompute only on new data.

## ToS flags
- OANDA practice: personal use fine. Alpaca IEX: fine for personal/single-user. yahoo/stooq: personal use; not for commercial redistribution → isolated behind provider abstraction for a licensed swap in a paid tier.

## Keys checklist (see STATE.md)
FRED ✓free · Alpaca ✓free · Finnhub ✓free · OANDA ✓configured.
