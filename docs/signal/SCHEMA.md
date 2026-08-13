# SCHEMA — market.db

Separate SQLite DB from `journal.db`. WAL mode. Added via idempotent `migrate()` in `server/src/research/schema.js` (base `CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE ADD COLUMN` for later columns — mirrors the existing `server/src/db.js` pattern). **Keep this file in sync as tables land.**

Status legend: `planned` = designed here, not yet created · `live` = created by a shipped session.

**Status: LIVE as of S0.2** (schema_version `0.2.0`). All tables below exist in `market.db`. Actual DDL is `applySchema(db)` in `server/src/research/schema.js` — a few columns were added beyond the sketch below: `cot.comm_long/comm_short`, `earnings.rev_est/rev_act`, `alerts.created_at`, `briefs UNIQUE(instrument,date)`. Time columns are epoch **milliseconds** UTC.

## Core tables (LIVE — see schema.js for exact DDL)
```sql
-- Instruments we cover
instruments(id INTEGER PK, symbol TEXT UNIQUE, name TEXT, type TEXT)         -- XAUUSD, US100

-- OHLCV, multi-timeframe (reuse existing bars aggregation logic)
prices(instrument_id INT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL, timeframe TEXT,
       UNIQUE(instrument_id, timeframe, ts))

-- Generic time-series metadata (FRED/CBOE/Treasury/etc.)
series(series_id TEXT PK, source TEXT, name TEXT, unit TEXT)                  -- DFII10, DXY, VIX...
series_data(series_id TEXT, ts INTEGER, value REAL, UNIQUE(series_id, ts))

-- CFTC gold positioning (weekly)
cot(report_date INTEGER, market TEXT, mm_long INT, mm_short INT, oi INT,
    comm_long INT, comm_short INT, PRIMARY KEY(report_date, market))

-- Gold ETF holdings (daily)
etf_holdings(etf TEXT, date INTEGER, tonnes REAL, shares REAL, aum REAL, PRIMARY KEY(etf, date))

-- Index constituents + weights (QQQ)
constituents(index_id TEXT, symbol TEXT, weight REAL, sector TEXT, asof INTEGER,
             PRIMARY KEY(index_id, symbol, asof))

-- Constituent earnings
earnings(symbol TEXT, report_date INTEGER, time TEXT, eps_est REAL, eps_act REAL,
         PRIMARY KEY(symbol, report_date))

-- Economic calendar events
calendar_events(id TEXT PK, ts INTEGER, country TEXT, name TEXT, impact TEXT,
                consensus REAL, prior REAL, actual REAL)

-- News, tagged to instruments
news(id TEXT PK, ts INTEGER, source TEXT, headline TEXT, url TEXT, instruments TEXT, sentiment REAL)

-- Alerts config
alerts(id INTEGER PK, user TEXT, type TEXT, config_json TEXT, active INT, last_fired INTEGER)

-- AI briefs cache
briefs(id INTEGER PK, instrument TEXT, date INTEGER, content TEXT, model TEXT)

-- JOURNAL FUSION bridge (references journal.db trade ids)
context_snapshots(trade_id INTEGER PK, ts INTEGER, payload_json TEXT)

-- Analytics result cache (Python compute)
analytics_cache(key TEXT PK, input_hash TEXT, data_version TEXT, payload TEXT, ts INTEGER)

-- Source health / freshness
source_health(source TEXT PK, last_ok INTEGER, last_error TEXT, status TEXT)
```

## Indexes (planned)
- `prices`: covered by UNIQUE(instrument_id, timeframe, ts).
- `series_data`: covered by UNIQUE(series_id, ts).
- `calendar_events`: `idx_cal_ts (ts)`.
- `news`: `idx_news_ts (ts)`.

## Change log
- **S0.2 (2026-08-13):** All domain tables created (schema_version → `0.2.0`): instruments (+ seeded XAUUSD id=1, US100 id=2), prices, series, series_data, cot, etf_holdings, constituents, earnings, calendar_events, news, alerts, briefs, context_snapshots. `applySchema(db)` refactored to be pure/testable; `validate.js` added (num/str/toEpochMs + row validators); contract mirrored into `web/src/types.ts`. 7 unit tests green (`schema.test.js`).
- **S0.1 (2026-08-13):** `market.db` created (WAL). Bootstrapped `meta` (schema_version=0.1.0), `analytics_cache`, `source_health`.
