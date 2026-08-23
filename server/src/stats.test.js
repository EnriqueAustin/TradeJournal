import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// stats.js reads the shared db singleton, so point it at a scratch file BEFORE
// importing anything that pulls in db.js. Imports are hoisted, hence the
// dynamic import below rather than a top-level one.
const tmpDb = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'tj-stats-')),
  'test.db'
);
process.env.JOURNAL_DB = tmpDb;

const { db, migrate } = await import('./db.js');
const { summary, equity, reportCard, tagStats, calendar, streaks, discipline } =
  await import('./stats.js');

migrate();
// migrate() seeds a default account; start from a clean slate so the numbers
// below are the only thing the assertions see.
db.exec('DELETE FROM trade_tags; DELETE FROM tags; DELETE FROM trades; DELETE FROM accounts;');

// One account, then a hand-picked set of trades whose stats are easy to verify
// by hand: 3 winners (+100, +50, +25) and 2 losers (-40, -60).
db.prepare(
  `INSERT INTO accounts (id, name, currency, starting_balance)
   VALUES (1, 'Test', 'USD', 10000)`
).run();

const T = [
  // net,  r,    entry_time (UTC),        instrument, direction
  [100, 2.0, '2026-03-02T08:00:00.000Z', 'XAUUSD', 'long'], // Mon
  [-40, -1.0, '2026-03-02T13:00:00.000Z', 'XAUUSD', 'short'], // Mon
  [50, 1.0, '2026-03-03T09:00:00.000Z', 'US100', 'long'], // Tue
  [-60, -1.5, '2026-03-04T14:00:00.000Z', 'XAUUSD', 'short'], // Wed
  [25, 0.5, '2026-03-05T10:00:00.000Z', 'US100', 'long'], // Thu
];
const ins = db.prepare(
  `INSERT INTO trades
     (account_id, instrument, direction, entry_time, exit_time, net_pnl,
      gross_pnl, commission, swap, r_multiple, session, source, is_backtest)
   VALUES (1, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'london', 'csv', 0)`
);
for (const [net, r, t, inst, dir] of T) ins.run(inst, dir, t, t, net, net, r);

// A backtest row that every real-trade stat must ignore.
db.prepare(
  `INSERT INTO trades
     (account_id, instrument, direction, entry_time, exit_time, net_pnl,
      gross_pnl, commission, swap, r_multiple, session, source, is_backtest)
   VALUES (1,'XAUUSD','long','2026-03-06T10:00:00.000Z','2026-03-06T10:00:00.000Z',
           9999, 9999, 0, 0, 50, 'london', 'csv', 1)`
).run();

test('summary computes P&L, win rate, profit factor and expectancy', () => {
  const s = summary({ account: 1 });
  assert.equal(s.trade_count, 5, 'excludes the is_backtest row');
  assert.equal(s.net_pnl, 75); // 100-40+50-60+25
  assert.equal(s.win_rate, 0.6); // 3 of 5
  assert.equal(s.profit_factor, 1.75); // 175 / 100
  assert.equal(s.expectancy, 15); // 75 / 5
  assert.equal(s.largest_win, 100);
  assert.equal(s.largest_loss, -60);
  assert.equal(s.total_r, 1); // 2 -1 +1 -1.5 +0.5
});

test('summary of an empty set does not divide by zero', () => {
  const s = summary({ account: 1, from: '2030-01-01', to: '2030-01-02' });
  assert.equal(s.trade_count, 0);
  assert.equal(s.net_pnl, 0);
  assert.equal(s.win_rate, 0);
  assert.equal(s.expectancy, 0);
  assert.equal(s.profit_factor, null, 'no losses means PF is undefined, not Infinity');
});

test('equity accumulates net P&L and R in chronological order', () => {
  const e = equity({ account: 1 });
  assert.equal(e.length, 5);
  assert.deepEqual(e.map((p) => p.cum_pnl), [100, 60, 110, 50, 75]);
  assert.equal(e.at(-1).cum_r, 1);
});

test('reportCard drawdown measures the worst peak-to-trough decline', () => {
  const rc = reportCard({ account: 1 });
  assert.equal(rc.trade_count, 5);
  // Peak 110 (after trade 3) down to 50 (after trade 4) = 60.
  assert.equal(rc.drawdown.max_dd, 60);
  assert.equal(rc.drawdown.recovery_factor, 1.25); // 75 / 60
  assert.ok(rc.drawdown.series.every((p) => p.dd <= 0), 'underwater series is <= 0');
});

test('reportCard scores stay in range and grade follows the total', () => {
  const { score } = reportCard({ account: 1 });
  assert.ok(score.total >= 0 && score.total <= 100);
  for (const c of score.components) {
    assert.ok(c.score >= 0 && c.score <= 100, `${c.key} out of range`);
  }
  const weights = score.components.reduce((s, c) => s + c.weight, 0);
  assert.ok(Math.abs(weights - 1) < 1e-9, 'component weights sum to 1');
  assert.equal(score.reliable, false, 'only 5 trades — not yet reliable');
});

test('reportCard bins R-multiples and splits by weekday', () => {
  const rc = reportCard({ account: 1 });
  const binned = rc.r_distribution.reduce((s, b) => s + b.count, 0);
  assert.equal(binned, 5, 'every trade with an R lands in exactly one bin');
  const mon = rc.by_dow.find((d) => d.label === 'Mon');
  assert.equal(mon.count, 2);
  assert.equal(mon.net_pnl, 60); // +100 -40
});

test('tagStats groups by category and sorts worst first', () => {
  db.prepare("INSERT INTO tags (id, category, name) VALUES (1,'mistake','fomo')").run();
  db.prepare("INSERT INTO tags (id, category, name) VALUES (2,'mistake','early exit')").run();
  // fomo on the -60 loser, early exit on the +25 winner.
  const idOf = (net) => db.prepare('SELECT id FROM trades WHERE net_pnl = ?').get(net).id;
  db.prepare('INSERT INTO trade_tags (trade_id, tag_id) VALUES (?, 1)').run(idOf(-60));
  db.prepare('INSERT INTO trade_tags (trade_id, tag_id) VALUES (?, 2)').run(idOf(25));

  const t = tagStats({ account: 1 });
  assert.equal(t.total_tagged, 2);
  const m = t.by_category.mistake;
  assert.equal(m.length, 2);
  assert.equal(m[0].name, 'fomo', 'most costly tag leads');
  assert.equal(m[0].net_pnl, -60);
  assert.equal(m[1].net_pnl, 25);
});

test('calendar and streaks agree with the daily totals', () => {
  const days = calendar({ account: 1 });
  assert.equal(days.length, 4, 'four distinct trading days');
  assert.equal(days.find((d) => d.day === '2026-03-02').net_pnl, 60);

  const s = streaks({ account: 1 });
  assert.equal(s.trading_days, 4);
  assert.equal(s.total_net, 75);
  assert.equal(s.best_day, '2026-03-02');
  assert.equal(s.best_day_net, 60);
});

test('discipline tallies plan adherence, per-bucket P&L and grades', () => {
  const idOf = (net) => db.prepare('SELECT id FROM trades WHERE net_pnl = ?').get(net).id;
  // +100 & +50 followed the plan; -40 broke it. Leave the rest unreviewed.
  db.prepare('UPDATE trades SET followed_plan = 1 WHERE id = ?').run(idOf(100));
  db.prepare('UPDATE trades SET followed_plan = 1 WHERE id = ?').run(idOf(50));
  db.prepare('UPDATE trades SET followed_plan = 0 WHERE id = ?').run(idOf(-40));
  // Grade the +100 trade an A (grade lives in the tags table).
  db.prepare("INSERT INTO tags (id, category, name) VALUES (3,'grade','A')").run();
  db.prepare('INSERT INTO trade_tags (trade_id, tag_id) VALUES (?, 3)').run(idOf(100));

  const d = discipline({ account: 1 });
  assert.equal(d.total, 5, 'excludes the is_backtest row');
  assert.equal(d.reviewed, 3);
  assert.equal(d.followed, 2);
  assert.equal(d.broken, 1);
  assert.equal(d.followed_pct, 0.6667); // 2/3 rounded to 4dp
  assert.equal(d.avg_net_followed, 75); // (100+50)/2
  assert.equal(d.avg_net_broken, -40);
  assert.equal(d.graded, 1);
  assert.equal(d.grades.A, 1);
});

test('date filters are inclusive on both ends', () => {
  const s = summary({ account: 1, from: '2026-03-02', to: '2026-03-03' });
  assert.equal(s.trade_count, 3); // both Mon trades + Tue
  assert.equal(s.net_pnl, 110);
});

test.after(() => {
  db.close();
  fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
});
