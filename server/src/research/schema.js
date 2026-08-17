// Signal research module — its own SQLite DB (market.db), separate from the
// journal's journal.db. Node is the single writer (WAL); the Python analytics
// service reads it read-only. Schema grows via the same guarded-migrate pattern
// as server/src/db.js. See docs/signal/SCHEMA.md.
//
// Time convention: all `ts`/`date`/`report_date` columns are epoch MILLISECONDS
// (INTEGER, UTC). Convert on ingest; render tz on the client.
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same data dir as journal.db so both live in the mounted volume (/app/data).
const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
export const MARKET_DB_PATH = path.join(dataDir, 'market.db');

export const marketDb = new Database(MARKET_DB_PATH);
marketDb.pragma('journal_mode = WAL');
marketDb.pragma('foreign_keys = ON');

export const SCHEMA_VERSION = '0.2.0';

// The two instruments v1 ships, complete. Architecture is instrument-generic.
export const INSTRUMENTS = [
  { symbol: 'XAUUSD', name: 'Gold Spot / US Dollar', type: 'commodity' },
  { symbol: 'US100', name: 'Nasdaq 100', type: 'index' },
  { symbol: 'XAGUSD', name: 'Silver Spot / US Dollar', type: 'commodity' },
  { symbol: 'WTICO_USD', name: 'WTI Crude Oil', type: 'commodity' },
];

// Apply the full schema to a given DB handle. Pure (no module state) so tests
// can pass an in-memory Database. Idempotent: CREATE TABLE IF NOT EXISTS +
// guarded ALTER for later columns (mirrors server/src/db.js).
export function applySchema(db) {
  db.exec(`
    -- Cross-cutting (bootstrapped in S0.1) ---------------------------------
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Analytics result cache (Python compute), keyed by input_hash + data_version.
    CREATE TABLE IF NOT EXISTS analytics_cache (
      key TEXT PRIMARY KEY,
      input_hash TEXT,
      data_version TEXT,
      payload TEXT,
      ts INTEGER
    );

    -- Per-source freshness / health for the data-freshness badges.
    CREATE TABLE IF NOT EXISTS source_health (
      source TEXT PRIMARY KEY,
      last_ok INTEGER,
      last_error TEXT,
      status TEXT
    );

    -- Domain (S0.2) --------------------------------------------------------
    -- Instruments we cover.
    CREATE TABLE IF NOT EXISTS instruments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      name TEXT,
      type TEXT
    );

    -- OHLCV, multi-timeframe. ts = epoch ms of the bar open.
    CREATE TABLE IF NOT EXISTS prices (
      instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
      ts INTEGER NOT NULL,
      o REAL, h REAL, l REAL, c REAL, v REAL,
      timeframe TEXT NOT NULL,
      PRIMARY KEY (instrument_id, timeframe, ts)
    );
    CREATE INDEX IF NOT EXISTS idx_prices_lookup ON prices(instrument_id, timeframe, ts);

    -- Generic time-series metadata (FRED/CBOE/Treasury/etc.).
    CREATE TABLE IF NOT EXISTS series (
      series_id TEXT PRIMARY KEY,     -- e.g. DFII10, DXY, VIX, VXN, GVZ
      source TEXT,                    -- fred | cboe | treasury | ...
      name TEXT,
      unit TEXT
    );
    CREATE TABLE IF NOT EXISTS series_data (
      series_id TEXT NOT NULL REFERENCES series(series_id) ON DELETE CASCADE,
      ts INTEGER NOT NULL,
      value REAL,
      PRIMARY KEY (series_id, ts)
    );

    -- CFTC gold positioning (weekly). report_date = epoch ms of the Tuesday.
    CREATE TABLE IF NOT EXISTS cot (
      report_date INTEGER NOT NULL,
      market TEXT NOT NULL,           -- e.g. GOLD - COMMODITY EXCHANGE INC.
      mm_long INTEGER, mm_short INTEGER,
      comm_long INTEGER, comm_short INTEGER,
      oi INTEGER,
      PRIMARY KEY (report_date, market)
    );

    -- Gold ETF holdings (daily).
    CREATE TABLE IF NOT EXISTS etf_holdings (
      etf TEXT NOT NULL,              -- GLD | IAU
      date INTEGER NOT NULL,
      tonnes REAL, shares REAL, aum REAL,
      PRIMARY KEY (etf, date)
    );

    -- Index constituents + weights (QQQ). asof = epoch ms of the snapshot day.
    CREATE TABLE IF NOT EXISTS constituents (
      index_id TEXT NOT NULL,         -- QQQ | NDX
      symbol TEXT NOT NULL,
      weight REAL,
      sector TEXT,
      asof INTEGER NOT NULL,
      PRIMARY KEY (index_id, symbol, asof)
    );

    -- Constituent earnings.
    CREATE TABLE IF NOT EXISTS earnings (
      symbol TEXT NOT NULL,
      report_date INTEGER NOT NULL,
      time TEXT,                      -- bmo | amc | dmt
      eps_est REAL, eps_act REAL,
      rev_est REAL, rev_act REAL,
      PRIMARY KEY (symbol, report_date)
    );

    -- Economic calendar events.
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,            -- stable hash of country+ts+name
      ts INTEGER NOT NULL,
      country TEXT,
      name TEXT,
      impact TEXT,                    -- high | medium | low | holiday
      consensus REAL, prior REAL, actual REAL
    );
    CREATE INDEX IF NOT EXISTS idx_cal_ts ON calendar_events(ts);

    -- News, tagged to instruments (instruments = CSV of symbols).
    CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      source TEXT,
      headline TEXT,
      url TEXT,
      instruments TEXT,
      sentiment REAL
    );
    CREATE INDEX IF NOT EXISTS idx_news_ts ON news(ts);

    -- Alerts config.
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT DEFAULT 'local',
      type TEXT,                      -- price | indicator | driver | event | positioning | vol | correlation
      config_json TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_fired INTEGER,
      created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );

    -- AI briefs cache (one per instrument per day per type).
    CREATE TABLE IF NOT EXISTS briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument TEXT NOT NULL,
      date INTEGER NOT NULL,
      content TEXT,
      model TEXT,
      brief_type TEXT DEFAULT 'basic',
      UNIQUE(instrument, date)
    );

    -- Cached explain-this-move results.
    CREATE TABLE IF NOT EXISTS explanations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument TEXT NOT NULL,
      ts INTEGER NOT NULL,
      timeframe TEXT NOT NULL,
      explanation TEXT,
      evidence_json TEXT,
      model TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      UNIQUE(instrument, ts, timeframe)
    );

    -- JOURNAL FUSION bridge. trade_id references journal.db trades(id) (logical,
    -- cross-DB, not an FK). payload_json = full market-state snapshot at entry.
    CREATE TABLE IF NOT EXISTS context_snapshots (
      trade_id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      payload_json TEXT
    );
  `);

  seedInstruments(db);

  // Additive migrations for existing tables
  const briefCols = db.prepare("PRAGMA table_info(briefs)").all().map(c => c.name);
  if (!briefCols.includes('brief_type')) {
    db.exec("ALTER TABLE briefs ADD COLUMN brief_type TEXT DEFAULT 'basic'");
  }

  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SCHEMA_VERSION);
}

function seedInstruments(db) {
  const stmt = db.prepare(
    `INSERT INTO instruments (symbol, name, type) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO NOTHING`
  );
  for (const i of INSTRUMENTS) stmt.run(i.symbol, i.name, i.type);
}

export function migrateResearch() {
  applySchema(marketDb);
}

// Resolve a canonical symbol → instruments.id (cached). Returns null if unknown.
const _idCache = new Map();
export function instrumentId(symbol) {
  if (_idCache.has(symbol)) return _idCache.get(symbol);
  const row = marketDb.prepare('SELECT id FROM instruments WHERE symbol = ?').get(symbol);
  const id = row?.id ?? null;
  if (id != null) _idCache.set(symbol, id);
  return id;
}
