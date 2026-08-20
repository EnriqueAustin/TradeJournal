import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionFromTime } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'journal.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      broker TEXT,
      platform TEXT,
      account_type TEXT,
      currency TEXT DEFAULT 'USD',
      starting_balance REAL DEFAULT 0,
      prop_daily_loss REAL,
      prop_max_dd REAL,
      prop_target REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      instrument TEXT,
      direction TEXT CHECK(direction IN ('long','short')),
      entry_time TEXT,
      exit_time TEXT,
      entry_price REAL,
      exit_price REAL,
      size REAL,
      gross_pnl REAL,
      commission REAL,
      swap REAL,
      net_pnl REAL,
      r_multiple REAL,
      stop_price REAL,
      target_price REAL,
      mae REAL,
      mfe REAL,
      hold_time_sec INTEGER,
      session TEXT,
      source TEXT CHECK(source IN ('csv','html','ea','api')),
      ext_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_account_ext
      ON trades(account_id, ext_id) WHERE ext_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);

    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      exec_time TEXT,
      price REAL,
      size REAL,
      side TEXT CHECK(side IN ('in','out'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT CHECK(category IN ('setup','session','emotion','mistake','grade')),
      name TEXT,
      UNIQUE(category, name)
    );

    CREATE TABLE IF NOT EXISTS trade_tags (
      trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (trade_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER REFERENCES trades(id) ON DELETE CASCADE,
      day TEXT,
      body TEXT,
      rules_followed INTEGER CHECK(rules_followed IN (0,1)),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER REFERENCES trades(id) ON DELETE CASCADE,
      url TEXT
    );

    -- Phase 1: named trading setups / playbook
    CREATE TABLE IF NOT EXISTS setups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      instrument TEXT,
      rules TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Phase 3: OHLC price bars for replay / backtest charts
    CREATE TABLE IF NOT EXISTS price_bars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument TEXT NOT NULL,
      tf TEXT NOT NULL,
      t TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume REAL,
      UNIQUE(instrument, tf, t)
    );
    CREATE INDEX IF NOT EXISTS idx_bars_lookup ON price_bars(instrument, tf, t);

    -- Daily plan / pre-trade checklist per (account, day).
    CREATE TABLE IF NOT EXISTS daily_plans (
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      bias TEXT,
      key_levels TEXT,
      risk_cap REAL,
      checklist_json TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, day)
    );

    -- Live open positions from the MT5 EA. Snapshot per (account, ext_id).
    CREATE TABLE IF NOT EXISTS live_positions (
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      ext_id TEXT NOT NULL,
      instrument TEXT,
      direction TEXT CHECK(direction IN ('long','short')),
      size REAL,
      entry_price REAL,
      entry_time TEXT,
      current_price REAL,
      unrealized_pnl REAL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, ext_id)
    );

    CREATE TABLE IF NOT EXISTS news_events (
      id TEXT PRIMARY KEY,           -- stable hash of currency+dt+title
      dt TEXT NOT NULL,              -- event time, ISO UTC
      currency TEXT,                 -- affected currency, e.g. USD
      impact TEXT,                   -- high | medium | low | holiday
      title TEXT,
      forecast TEXT,
      previous TEXT,
      actual TEXT,
      source TEXT DEFAULT 'forexfactory',
      fetched_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_news_dt ON news_events(dt);

    -- Backtest Studio: one FXReplay-style replay workspace.
    CREATE TABLE IF NOT EXISTS bt_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      name TEXT,
      instrument TEXT NOT NULL,
      base_tf TEXT NOT NULL DEFAULT 'M1',
      start_time TEXT,          -- replay anchor (ISO): cursor starts here
      cursor_time TEXT,         -- last cursor position (ISO), for resume
      speed REAL DEFAULT 1,
      risk_pct REAL,            -- default per-trade risk % of balance
      layout_json TEXT,         -- chart count / TFs / symbols / indicator configs
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Working / filled / cancelled orders placed within a session.
    CREATE TABLE IF NOT EXISTS bt_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES bt_sessions(id) ON DELETE CASCADE,
      trade_id INTEGER REFERENCES trades(id) ON DELETE SET NULL,
      kind TEXT CHECK(kind IN ('market','limit','stop')),
      side TEXT CHECK(side IN ('long','short')),
      size REAL,
      limit_price REAL,
      stop_trigger REAL,
      sl_price REAL,
      tp_price REAL,
      status TEXT CHECK(status IN ('working','filled','cancelled')) DEFAULT 'working',
      placed_time TEXT,
      fill_time TEXT,
      fill_price REAL
    );
    CREATE INDEX IF NOT EXISTS idx_bt_orders_session ON bt_orders(session_id);

    -- Persisted chart drawings for a session (per instrument+tf).
    CREATE TABLE IF NOT EXISTS bt_drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES bt_sessions(id) ON DELETE CASCADE,
      instrument TEXT,
      tf TEXT,
      type TEXT,
      points_json TEXT,
      style_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bt_drawings_session ON bt_drawings(session_id);
  `);

  // Per-event ForexFactory permalink (from the browser userscript scrape) so
  // the calendar can open an event's page on FF. Nullable + guarded.
  const newsCols = db.prepare('PRAGMA table_info(news_events)').all();
  if (!newsCols.some((c) => c.name === 'url')) {
    db.exec('ALTER TABLE news_events ADD COLUMN url TEXT');
  }

  // Phase 1: add trades.setup_id (guarded so re-running the migration is safe).
  const tradeCols = db.prepare('PRAGMA table_info(trades)').all();
  if (!tradeCols.some((c) => c.name === 'setup_id')) {
    db.exec('ALTER TABLE trades ADD COLUMN setup_id INTEGER REFERENCES setups(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_trades_setup ON trades(setup_id)');

  // Phase 3: is_backtest flag — hypothetical trades excluded from real stats.
  if (!tradeCols.some((c) => c.name === 'is_backtest')) {
    db.exec('ALTER TABLE trades ADD COLUMN is_backtest INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_trades_backtest ON trades(is_backtest)');

  // Preferred replay/chart timeframe remembered per trade (e.g. 'M30').
  if (!tradeCols.some((c) => c.name === 'preferred_tf')) {
    db.exec('ALTER TABLE trades ADD COLUMN preferred_tf TEXT');
  }

  // Backtest Studio: which replay session a hypothetical trade belongs to.
  if (!tradeCols.some((c) => c.name === 'bt_session_id')) {
    db.exec('ALTER TABLE trades ADD COLUMN bt_session_id INTEGER REFERENCES bt_sessions(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_trades_bt_session ON trades(bt_session_id)');

  // Per-execution P&L — lets the journal show each partial close's own result
  // (MT5 deals carry a profit/commission/swap per fill). Nullable + guarded.
  const execCols = db.prepare('PRAGMA table_info(executions)').all();
  for (const col of ['profit', 'commission', 'swap']) {
    if (!execCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE executions ADD COLUMN ${col} REAL`);
    }
  }

  // Broker server timezone (MT5 times are in this zone). Convert to UTC on
  // import so trades share a clock with UTC price bars. times_realigned guards
  // the one-shot bulk conversion of pre-existing (mislabeled) trade times.
  const acctCols = db.prepare('PRAGMA table_info(accounts)').all();
  if (!acctCols.some((c) => c.name === 'broker_tz')) {
    db.exec("ALTER TABLE accounts ADD COLUMN broker_tz TEXT DEFAULT 'Europe/London'");
  }
  if (!acctCols.some((c) => c.name === 'times_realigned')) {
    db.exec('ALTER TABLE accounts ADD COLUMN times_realigned INTEGER NOT NULL DEFAULT 0');
  }

  // Prop-firm preset metadata on accounts.
  for (const col of [
    ['prop_firm', 'TEXT'],
    ['prop_plan', 'TEXT'],
    ['prop_phase', 'INTEGER NOT NULL DEFAULT 0'],
    ['prop_dd_type', 'TEXT'],
    ['prop_min_days', 'INTEGER'],
    ['prop_profit_split', 'REAL'],
    ['prop_news_window_min', 'INTEGER'],
    ['prop_weekend_hold', 'INTEGER'],
    ['prop_consistency_pct', 'REAL'],
    ['prop_min_hold_sec', 'INTEGER'],
    ['prop_hold_deduct_threshold_pct', 'REAL'],
    ['prop_safety_buffer_pct', 'REAL'],
    ['prop_max_inactivity_days', 'INTEGER'],
  ]) {
    if (!acctCols.some((c) => c.name === col[0])) {
      db.exec(`ALTER TABLE accounts ADD COLUMN ${col[0]} ${col[1]}`);
    }
  }

  // One-shot backfill: recompute `session` for every trade under the new
  // DST-aware, "NY-wins" rule in util.js sessionFromTime (retires the old fixed
  // UTC "overlap" band). Guarded by user_version so it runs once per DB.
  if (db.pragma('user_version', { simple: true }) < 1) {
    const rows = db.prepare('SELECT id, entry_time FROM trades WHERE entry_time IS NOT NULL').all();
    const upd = db.prepare('UPDATE trades SET session = ? WHERE id = ?');
    const backfill = db.transaction((list) => {
      for (const r of list) upd.run(sessionFromTime(r.entry_time), r.id);
    });
    backfill(rows);
    db.pragma('user_version = 1');
  }

  // Seed default account if none exists
  const count = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  if (count === 0) {
    db.prepare(
      `INSERT INTO accounts (name, platform, currency, starting_balance)
       VALUES (?, ?, ?, ?)`
    ).run('Main', 'mt5', 'USD', 10000);
  }
}
