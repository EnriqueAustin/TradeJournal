import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// refreshExcursions writes through a db handle; point db.js at a scratch file
// BEFORE importing it (imports are hoisted, hence the dynamic import).
process.env.JOURNAL_DB = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'tj-excursion-')),
  'test.db'
);

const { db, migrate } = await import('./db.js');
const {
  computeExcursion,
  computeExitAnalysis,
  excursionEligible,
  holdToTarget,
  riskDistance,
  refreshExcursions,
  exitAnalysisFor,
} = await import('./excursion.js');
const { aggregateExits } = await import('./stats.js');

// M1 bar helper: minute offset from a base time.
const BASE = Date.parse('2026-08-03T13:00:00.000Z');
const iso = (min) => new Date(BASE + min * 60000).toISOString();
const bar = (min, open, high, low, close) => ({ t: iso(min), open, high, low, close });

const longTrade = {
  id: 1,
  direction: 'long',
  entry_time: iso(1),
  exit_time: iso(4),
  entry_price: 100,
  exit_price: 103,
  gross_pnl: 300, // $100 per point
  net_pnl: 300,
  stop_price: 98, // 1R = 2 points
  r_multiple: 1.5,
  session: 'ny',
};

const bars = [
  bar(0, 99, 99.5, 90, 99), // before entry — must be ignored
  bar(1, 100, 101, 99, 100.5),
  bar(2, 100.5, 104, 99.5, 103),
  bar(3, 103, 103.5, 102, 103),
  bar(4, 103, 103.2, 102.8, 103), // exit minute (overlaps exit instant)
  bar(5, 103, 106, 102.5, 105),
  bar(10, 105, 105.5, 104, 104.5),
  bar(20, 104, 104, 96, 97),
];

test('excursionEligible rejects corrupt and incomplete rows', () => {
  assert.equal(excursionEligible(longTrade), true);
  assert.equal(excursionEligible({ ...longTrade, entry_price: 0 }), false);
  assert.equal(excursionEligible({ ...longTrade, exit_time: null }), false);
  assert.equal(excursionEligible({ ...longTrade, exit_time: iso(0) }), false);
});

test('computeExcursion long: extremes of bars overlapping the hold window', () => {
  const ex = computeExcursion(longTrade, bars, 60000);
  // Bars 1..3 overlap [entry, exit); bar 4 opens at the exit instant → excluded.
  assert.deepEqual(ex, { mae: 1, mfe: 4, bars: 3 });
});

test('bar feed far from the fill prices is rejected', () => {
  // Seed/demo row at a price the bars never printed.
  assert.equal(computeExcursion({ ...longTrade, entry_price: 50, exit_price: 51 }, bars, 60000), null);
  assert.equal(computeExitAnalysis({ ...longTrade, entry_price: 50, exit_price: 51 }, bars, 60000), null);
  // A small broker-vs-mid offset is fine.
  assert.ok(computeExcursion({ ...longTrade, entry_price: 100.3 }, bars, 60000));
});

test('computeExcursion short mirrors direction', () => {
  const t = { ...longTrade, direction: 'short', exit_price: 99.5 };
  const ex = computeExcursion(t, bars, 60000);
  assert.equal(ex.mfe, 1); // 100 - low 99
  assert.equal(ex.mae, 4); // high 104 - 100
});

test('computeExcursion floors at the realized move and handles no bars', () => {
  const t = { ...longTrade, exit_price: 104.3 };
  assert.equal(computeExcursion(t, bars, 60000).mfe, 4.3);
  assert.equal(computeExcursion(longTrade, [], 60000), null);
  assert.equal(computeExcursion({ ...longTrade, entry_price: 0 }, bars, 60000), null);
});

test('riskDistance prefers the stop, else backs out a derived R', () => {
  assert.deepEqual(riskDistance(longTrade), { dist: 2, kind: 'stop' });
  // No stop: risk cash = 300 / 1.5 = 200 → 2 points at $100/pt.
  assert.deepEqual(riskDistance({ ...longTrade, stop_price: null }), { dist: 2, kind: 'derived' });
  assert.equal(riskDistance({ ...longTrade, stop_price: null, r_multiple: null }), null);
});

test('computeExitAnalysis: post-exit horizons, left on table, 1R continuation', () => {
  const a = computeExitAnalysis(longTrade, bars, 60000, { horizons: [5, 15, 60] });
  // Post-exit bars: 4,5,10,20 (t >= exit).
  const [h5, h15, h60] = a.horizons;
  assert.equal(h5.best, 3); // bar 5 high 106 − 103
  assert.equal(h5.move, 2); // bar 5 close 105
  assert.equal(h5.move_usd, 200);
  assert.equal(h5.move_r, 1);
  assert.equal(h15.move, 1.5); // bar 10 close 104.5
  assert.equal(h60.adverse, 7); // bar 20 low 96
  assert.equal(h60.move, -6);
  assert.equal(h60.complete, false); // bars stop at minute 21
  assert.deepEqual(a.left_on_table, { price: 3, usd: 300, r: 1.5, minutes: 60 });
  assert.equal(a.continued_1r, true);
  assert.equal(a.r_kind, 'stop');
});

test('computeExitAnalysis returns null without post-exit data', () => {
  assert.equal(computeExitAnalysis(longTrade, bars.slice(0, 3), 60000), null);
});

test('holdToTarget walks bars for first touch', () => {
  const after = bars.map((b) => ({ ...b, ms: Date.parse(b.t) })).filter((b) => b.ms >= Date.parse(longTrade.exit_time));
  const end = Date.parse(iso(240));
  assert.equal(holdToTarget({ ...longTrade, target_price: 105 }, after, 60000, end), 'target');
  assert.equal(holdToTarget({ ...longTrade, target_price: 110, stop_price: 97 }, after, 60000, end), 'stop');
  assert.equal(holdToTarget({ ...longTrade, target_price: 110, stop_price: 90 }, after, 60000, end), 'neither');
  assert.equal(holdToTarget({ ...longTrade, target_price: 102 }, after, 60000, end), 'already');
  assert.equal(holdToTarget({ ...longTrade, target_price: 105.5, stop_price: 102.6 }, after, 60000, end), 'ambiguous');
  assert.equal(holdToTarget({ ...longTrade, target_price: null }, after, 60000, end), null);
});

test('aggregateExits summarizes by session', () => {
  const a = computeExitAnalysis(longTrade, bars, 60000);
  const b = computeExitAnalysis({ ...longTrade, id: 2, session: 'london', stop_price: null, r_multiple: null }, bars, 60000);
  const agg = aggregateExits([a, b]);
  assert.equal(agg.sample, 2);
  assert.equal(agg.avg_left_usd, 300);
  assert.equal(agg.r_sample, 1);
  assert.equal(agg.continued_1r_pct, 1);
  assert.equal(agg.by_session.length, 2);
  assert.equal(agg.horizons[0].minutes, 5);
  assert.equal(agg.horizons[0].pct_continued, 1);
});

test('refreshExcursions fills null/auto values, never manual ones; S5 preferred', () => {
  migrate();
  db.exec('DELETE FROM trades; DELETE FROM price_bars;');
  const acct = db.prepare('SELECT id FROM accounts LIMIT 1').get().id;
  const ins = db.prepare(
    `INSERT INTO trades (account_id, instrument, direction, entry_time, exit_time,
       entry_price, exit_price, gross_pnl, net_pnl, mae, mfe, mae_auto, mfe_auto)
     VALUES (?, 'XAUUSD', 'long', ?, ?, 100, 103, 300, 300, ?, ?, ?, ?)`
  );
  const auto = ins.run(acct, iso(1), iso(4), null, null, 0, 0).lastInsertRowid;
  const manual = ins.run(acct, iso(1), iso(4), 0.5, null, 0, 0).lastInsertRowid;
  const zero = db
    .prepare(
      `INSERT INTO trades (account_id, instrument, direction, entry_time, exit_time, entry_price, exit_price)
       VALUES (?, 'XAUUSD', 'short', ?, ?, 0, 0)`
    )
    .run(acct, iso(1), iso(4)).lastInsertRowid;
  const bi = db.prepare(
    `INSERT INTO price_bars (instrument, tf, t, open, high, low, close) VALUES ('XAUUSD', ?, ?, ?, ?, ?, ?)`
  );
  for (const b of bars) bi.run('M1', b.t, b.open, b.high, b.low, b.close);

  const all = db.prepare('SELECT * FROM trades').all();
  assert.equal(refreshExcursions(db, all), 2);
  const get = (id) => db.prepare('SELECT mae, mfe, mae_auto, mfe_auto FROM trades WHERE id = ?').get(id);
  assert.deepEqual(get(auto), { mae: 1, mfe: 4, mae_auto: 1, mfe_auto: 1 });
  assert.deepEqual(get(manual), { mae: 0.5, mfe: 4, mae_auto: 0, mfe_auto: 1 });
  assert.deepEqual(get(zero), { mae: null, mfe: null, mae_auto: 0, mfe_auto: 0 });

  // Finer S5 bars spanning the whole trade replace the M1 approximation.
  for (let s = 60; s <= 240; s += 5) {
    const t = new Date(BASE + s * 1000).toISOString();
    bi.run('S5', t, 101, 103, 99.8, 101);
  }
  refreshExcursions(db, db.prepare('SELECT * FROM trades').all());
  assert.deepEqual(get(auto), { mae: 0.2, mfe: 3, mae_auto: 1, mfe_auto: 1 });
  assert.equal(get(manual).mae, 0.5);

  // An edit that makes the trade underivable clears auto values only.
  db.prepare('UPDATE trades SET entry_price = 0 WHERE id IN (?, ?)').run(auto, manual);
  refreshExcursions(db, db.prepare('SELECT * FROM trades').all());
  assert.deepEqual(get(auto), { mae: null, mfe: null, mae_auto: 0, mfe_auto: 0 });
  assert.deepEqual(get(manual), { mae: 0.5, mfe: null, mae_auto: 0, mfe_auto: 0 });
  db.prepare('UPDATE trades SET entry_price = 100 WHERE id IN (?, ?)').run(auto, manual);
  refreshExcursions(db, db.prepare('SELECT * FROM trades').all());

  const ea = exitAnalysisFor(db, db.prepare('SELECT * FROM trades WHERE id = ?').get(auto));
  assert.ok(ea);
  assert.equal(ea.tf, 'M1'); // S5 doesn't cover the post-exit horizon
});
