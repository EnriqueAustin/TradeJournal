import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Break-even classification: the is_be triggers (manual override + the
// account's R band) and how summary() treats BE trades.
process.env.JOURNAL_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tj-be-')), 'test.db');

const { db, migrate } = await import('./db.js');
const { summary } = await import('./stats.js');

migrate();
db.exec('DELETE FROM trades; DELETE FROM accounts;');
db.prepare("INSERT INTO accounts (id, name, starting_balance) VALUES (1, 'Test', 10000)").run();

const ins = db.prepare(
  `INSERT INTO trades (account_id, instrument, direction, entry_time, exit_time, net_pnl, r_multiple)
   VALUES (1, 'XAUUSD', 'long', '2026-03-02T08:00:00Z', '2026-03-02T09:00:00Z', ?, ?)`
);
const win = ins.run(100, 2).lastInsertRowid;
const scratch = ins.run(4, 0.05).lastInsertRowid;
const flat = ins.run(0, 0).lastInsertRowid;
const loss = ins.run(-50, -1).lastInsertRowid;
const isBe = (id) => db.prepare('SELECT is_be FROM trades WHERE id = ?').get(id).is_be;

test('only exact-zero P&L is BE with no band', () => {
  assert.deepEqual([win, scratch, flat, loss].map(isBe), [0, 0, 1, 0]);
});

test('account R band reclassifies existing trades', () => {
  db.prepare('UPDATE accounts SET be_band_r = 0.1 WHERE id = 1').run();
  assert.deepEqual([win, scratch, flat, loss].map(isBe), [0, 1, 1, 0]);
  const s = summary({ account: 1 });
  assert.equal(s.be_count, 2);
  assert.equal(s.win_rate, 0.25); // 1 win of 4 trades
  assert.equal(s.avg_win, 100); // the +4 scratch no longer dilutes avg win
});

test('manual override beats the band both ways', () => {
  db.prepare('UPDATE trades SET be_override = 1 WHERE id = ?').run(loss);
  db.prepare('UPDATE trades SET be_override = 0 WHERE id = ?').run(scratch);
  assert.equal(isBe(loss), 1);
  assert.equal(isBe(scratch), 0);
  db.prepare('UPDATE trades SET be_override = NULL WHERE id IN (?, ?)').run(loss, scratch);
  assert.equal(isBe(loss), 0);
  assert.equal(isBe(scratch), 1);
});

test('editing R re-evaluates against the band', () => {
  db.prepare('UPDATE trades SET r_multiple = 0.5 WHERE id = ?').run(scratch);
  assert.equal(isBe(scratch), 0);
});
