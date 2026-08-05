import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  `);

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

  // Seed default account if none exists
  const count = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  if (count === 0) {
    db.prepare(
      `INSERT INTO accounts (name, platform, currency, starting_balance)
       VALUES (?, ?, ?, ?)`
    ).run('Main', 'mt5', 'USD', 10000);
  }
}
