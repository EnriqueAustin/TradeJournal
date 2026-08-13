// S0.2 smoke: schema applies to a fresh DB, seeds instruments, and core tables
// round-trip an insert/read. Runs against an in-memory DB (no market.db writes).
//   node --test src/research/schema.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema, SCHEMA_VERSION, INSTRUMENTS } from './schema.js';
import { validatePrice, validateSeriesPoint, toEpochMs } from './validate.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}

test('applySchema creates all core tables', () => {
  const db = freshDb();
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const t of [
    'meta', 'analytics_cache', 'source_health', 'instruments', 'prices',
    'series', 'series_data', 'cot', 'etf_holdings', 'constituents',
    'earnings', 'calendar_events', 'news', 'alerts', 'briefs', 'context_snapshots',
  ]) {
    assert.ok(names.includes(t), `missing table: ${t}`);
  }
  db.close();
});

test('meta records the schema version', () => {
  const db = freshDb();
  const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value;
  assert.equal(v, SCHEMA_VERSION);
  db.close();
});

test('instruments seeded (XAUUSD + US100), idempotent', () => {
  const db = freshDb();
  applySchema(db); // second run must not duplicate
  const rows = db.prepare('SELECT symbol FROM instruments ORDER BY symbol').all();
  assert.equal(rows.length, INSTRUMENTS.length);
  const symbols = rows.map((r) => r.symbol);
  assert.ok(symbols.includes('XAUUSD'));
  assert.ok(symbols.includes('US100'));
  db.close();
});

test('prices round-trip via validatePrice', () => {
  const db = freshDb();
  const gold = db.prepare("SELECT id FROM instruments WHERE symbol='XAUUSD'").get().id;
  const { value, errors } = validatePrice({
    instrument_id: gold, ts: '2026-08-13T12:00:00Z', timeframe: 'M1',
    o: 2500, h: 2505, l: 2499, c: 2503, v: 1200,
  });
  assert.deepEqual(errors, []);
  db.prepare(
    `INSERT INTO prices (instrument_id, ts, o, h, l, c, v, timeframe)
     VALUES (@instrument_id, @ts, @o, @h, @l, @c, @v, @timeframe)`
  ).run(value);
  const back = db.prepare('SELECT * FROM prices WHERE instrument_id=? AND timeframe=?').get(gold, 'M1');
  assert.equal(back.c, 2503);
  assert.equal(back.ts, toEpochMs('2026-08-13T12:00:00Z'));
  db.close();
});

test('series + series_data round-trip', () => {
  const db = freshDb();
  db.prepare('INSERT INTO series (series_id, source, name, unit) VALUES (?,?,?,?)')
    .run('DFII10', 'fred', '10Y Real Yield', 'percent');
  const { value, errors } = validateSeriesPoint({ series_id: 'DFII10', ts: 1734000000000, value: 1.87 });
  assert.deepEqual(errors, []);
  db.prepare('INSERT INTO series_data (series_id, ts, value) VALUES (@series_id, @ts, @value)').run(value);
  const back = db.prepare('SELECT value FROM series_data WHERE series_id=?').get('DFII10');
  assert.equal(back.value, 1.87);
  db.close();
});

test('validatePrice rejects a bad row', () => {
  const { errors } = validatePrice({ instrument_id: null, ts: 'nope', timeframe: '' });
  assert.ok(errors.length >= 3);
});

test('context_snapshots round-trip (journal fusion bridge)', () => {
  const db = freshDb();
  const payload = JSON.stringify({ real_yield: 1.9, dxy: 104.2, vol_regime: 'expansion' });
  db.prepare('INSERT INTO context_snapshots (trade_id, ts, payload_json) VALUES (?,?,?)')
    .run(42, Date.now(), payload);
  const back = db.prepare('SELECT payload_json FROM context_snapshots WHERE trade_id=?').get(42);
  assert.equal(JSON.parse(back.payload_json).vol_regime, 'expansion');
  db.close();
});
