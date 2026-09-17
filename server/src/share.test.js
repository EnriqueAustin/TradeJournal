import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JOURNAL_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tj-share-')), 'test.db');

const { db, migrate } = await import('./db.js');
const { createShareLink, listShareLinks, revokeShareLink, publicShare, weekRange, linkStatus, TOKEN_RE } =
  await import('./share.js');

migrate();
db.exec('DELETE FROM trades; DELETE FROM accounts;');
db.prepare("INSERT INTO accounts (id, name, currency, starting_balance) VALUES (1, 'Gold', 'USD', 10000)").run();
db.prepare("INSERT INTO accounts (id, name, currency, starting_balance) VALUES (2, 'Other', 'USD', 10000)").run();
const ins = db.prepare(
  `INSERT INTO trades (id, account_id, instrument, direction, entry_time, exit_time, entry_price, exit_price, net_pnl, source)
   VALUES (?, ?, ?, 'long', ?, ?, 2000, 2005, ?, 'csv')`
);
ins.run(10, 1, 'XAUUSD', '2026-03-03T08:00:00Z', '2026-03-03T08:20:00Z', 120); // Tue
ins.run(11, 1, 'XAUUSD', '2026-03-05T09:00:00Z', '2026-03-05T09:05:00Z', -40); // Thu
ins.run(12, 2, 'US100', '2026-03-03T14:00:00Z', '2026-03-03T14:05:00Z', 999); // other account
db.prepare("INSERT INTO notes (trade_id, body) VALUES (10, 'secret trade note')").run();
db.prepare("INSERT INTO notes (account_id, day, body) VALUES (1, '2026-03-03', 'day recap')").run();
db.prepare("INSERT INTO price_bars (instrument, tf, t, open, high, low, close) VALUES ('XAUUSD', 'M5', '2026-03-03T08:05:00.000Z', 1, 2, 0.5, 1.5)").run();
db.prepare("INSERT INTO price_bars (instrument, tf, t, open, high, low, close) VALUES ('XAUUSD', 'M5', '2026-03-09T08:05:00.000Z', 1, 2, 0.5, 1.5)").run();

test('weekRange is Monday..Sunday', () => {
  assert.deepEqual(weekRange('2026-03-05'), { from: '2026-03-02', to: '2026-03-08' });
  assert.deepEqual(weekRange('2026-03-02'), { from: '2026-03-02', to: '2026-03-08' });
});

test('create validation', () => {
  assert.match(createShareLink({ kind: 'nope' }).error, /kind/);
  assert.equal(createShareLink({ kind: 'trade', ref: '999' }).error, 'trade not found');
  assert.match(createShareLink({ kind: 'day', ref: '03/03/2026', account_id: 1 }).error, /YYYY-MM-DD/);
  assert.match(createShareLink({ kind: 'day', ref: '2026-03-03' }).error, /account_id/);
  assert.match(createShareLink({ kind: 'week', ref: '2026-03-03', account_id: 1, expires_in_days: -1 }).error, /positive/);
});

test('trade link: scoped payload, notes only when opted in, chart window', () => {
  const plain = createShareLink({ kind: 'trade', ref: 10 }).link;
  assert.match(plain.token, TOKEN_RE);
  const r = publicShare(plain.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.trade.id, 10);
  assert.equal(r.body.trade.net_pnl, 120);
  assert.equal(r.body.notes, null);
  assert.equal(r.body.trade.account_id, undefined);
  assert.equal(r.body.chart.tf, 'M5');
  assert.equal(r.body.chart.bars.length, 1); // the far-away bar is outside the window

  const withNotes = createShareLink({ kind: 'trade', ref: 10, include_notes: true }).link;
  assert.deepEqual(publicShare(withNotes.token).body.notes.map((n) => n.body), ['secret trade note']);
});

test('day + week links scope to one account and range', () => {
  const day = createShareLink({ kind: 'day', ref: '2026-03-03', account_id: 1 }).link;
  const d = publicShare(day.token).body;
  assert.deepEqual(d.trades.map((t) => t.id), [10]);
  assert.equal(d.kpis.net_pnl, 120);
  assert.equal(d.recap, null);

  const dayNotes = createShareLink({ kind: 'day', ref: '2026-03-03', account_id: 1, include_notes: 1 }).link;
  assert.equal(publicShare(dayNotes.token).body.recap, 'day recap');

  const week = createShareLink({ kind: 'week', ref: '2026-03-05', account_id: 1 }).link;
  assert.equal(week.ref, '2026-03-02'); // normalised to Monday
  const w = publicShare(week.token).body;
  assert.equal(w.from, '2026-03-02');
  assert.deepEqual(w.trades.map((t) => t.id), [10, 11]);
  assert.equal(w.kpis.net_pnl, 80);
  assert.equal(w.days.length, 7);
  assert.equal(w.days[1].net_pnl, 120);
  assert.equal(w.days[1].recap, null);
});

test('revoke, expiry and unknown tokens', () => {
  const now = new Date('2026-03-10T00:00:00Z');
  const link = createShareLink({ kind: 'trade', ref: 11, expires_in_days: 1 }, now).link;
  assert.equal(link.status, 'active');
  assert.equal(publicShare(link.token, new Date('2026-03-10T12:00:00Z')).status, 200);
  assert.equal(publicShare(link.token, new Date('2026-03-11T00:00:01Z')).status, 410);
  assert.equal(linkStatus({ revoked: 0, expires_at: null }), 'active');

  assert.equal(revokeShareLink(link.token), true);
  assert.equal(publicShare(link.token, now).status, 410);
  assert.equal(listShareLinks(now).find((l) => l.token === link.token).status, 'revoked');

  assert.equal(publicShare('abc').status, 404);
  assert.equal(publicShare('0'.repeat(64)).status, 404);
  assert.equal(revokeShareLink('../etc'), false);
});
