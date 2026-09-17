import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JOURNAL_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tj-pivot-')), 'test.db');

const { db, migrate } = await import('./db.js');
const { computeMetrics, dimValues, pivotTrades, parsePivotQuery, isValidDim, isoWeekMonday, pivot, slice } =
  await import('./pivot.js');

migrate();
db.exec('DELETE FROM trade_tags; DELETE FROM tags; DELETE FROM trades; DELETE FROM accounts; DELETE FROM setups;');
db.prepare("INSERT INTO accounts (id, name, currency, starting_balance) VALUES (1, 'A', 'USD', 10000)").run();
db.prepare("INSERT INTO setups (id, name, instrument) VALUES (7, 'Wick fill', 'XAUUSD')").run();
const ins = db.prepare(
  `INSERT INTO trades (id, account_id, instrument, direction, entry_time, exit_time, entry_price, exit_price,
     stop_price, net_pnl, gross_pnl, r_multiple, mae, mfe, hold_time_sec, session, setup_id, followed_plan, source)
   VALUES (?, 1, ?, ?, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv')`
);
// id, inst, dir, entry, exit, exit_px, stop, net, gross, r, mae, mfe, hold, session, setup, followed
ins.run(1, 'XAUUSD', 'long', '2026-03-02T08:00:00Z', '2026-03-02T08:10:00Z', 102, 99, 200, 200, 2, 0.5, 2.5, 600, 'london', 7, 1);
ins.run(2, 'XAUUSD', 'short', '2026-03-02T14:00:00Z', '2026-03-02T14:05:00Z', 101, 101, -100, -100, -1, 1, 0.2, 300, 'ny', 7, 0);
ins.run(3, 'US100', 'long', '2026-03-10T14:30:00Z', '2026-03-10T15:00:00Z', 101, 99, 50, 50, 0.5, 0.2, 1, 1800, 'ny', null, 1);
ins.run(4, 'US100', 'short', '2026-03-11T09:00:00Z', '2026-03-11T09:02:00Z', 100.5, 101, -150, -150, -1.5, 1, 0, 120, 'london', null, null);
db.prepare("INSERT INTO tags (id, category, name) VALUES (1, 'mistake', 'FOMO'), (2, 'grade', 'A')").run();
db.prepare('INSERT INTO trade_tags (trade_id, tag_id) VALUES (2, 1), (4, 1), (1, 2)').run();

test('computeMetrics: P&L, win rate, PF, R, DD, hold, MAE/MFE in R', () => {
  const rows = db.prepare('SELECT * FROM trades ORDER BY id').all();
  const m = computeMetrics(rows);
  assert.equal(m.trades, 4);
  assert.equal(m.net_pnl, 0);
  assert.equal(m.win_rate, 0.5);
  assert.equal(m.profit_factor, 1); // 250 / 250
  assert.equal(m.expectancy, 0);
  assert.equal(m.avg_r, 0);
  assert.equal(m.total_r, 0);
  assert.equal(m.avg_win, 125);
  assert.equal(m.avg_loss, -125);
  // cum: 200, 100, 150, 0 → peak 200, trough 0 → DD 200
  assert.equal(m.max_dd, 200);
  assert.equal(m.avg_hold, 705);
  // risk dist = 1 for every trade (stop 1 away) → MAE R avg (0.5+1+0.2+1)/4
  assert.equal(m.avg_mae_r, 0.675);
  assert.equal(m.left_on_table, null);
  assert.deepEqual(computeMetrics([]).trades, 0);
  assert.equal(computeMetrics([]).win_rate, null);
});

test('dimValues + isoWeekMonday', () => {
  const t = { entry_time: '2026-03-11T09:00:00Z', exit_time: '2026-03-11T09:02:00Z', session: 'london', followed_plan: 0,
    tags: [{ id: 1, category: 'mistake', name: 'FOMO' }] };
  assert.deepEqual(dimValues(t, 'hour').map((v) => v.key), ['9']);
  assert.deepEqual(dimValues(t, 'weekday').map((v) => v.label), ['Wed']);
  assert.deepEqual(dimValues(t, 'week').map((v) => v.key), ['2026-03-09']);
  assert.deepEqual(dimValues(t, 'month').map((v) => v.key), ['2026-03']);
  assert.deepEqual(dimValues(t, 'followed').map((v) => v.label), ['Broke plan']);
  assert.deepEqual(dimValues(t, 'tag:mistake').map((v) => v.key), ['1']);
  assert.deepEqual(dimValues(t, 'grade').map((v) => v.key), ['__none']);
  assert.equal(isoWeekMonday('2026-03-15'), '2026-03-09'); // Sunday → prior Monday
});

test('dimension/metric whitelist rejects injection attempts', () => {
  assert.ok(isValidDim('tag:grade'));
  assert.ok(isValidDim('field:12'));
  assert.ok(!isValidDim('tag:foo'));
  assert.ok(!isValidDim("session; DROP TABLE trades"));
  assert.ok(!isValidDim('field:1 OR 1=1'));
  assert.match(parsePivotQuery({ metrics: 'net_pnl,sql()' }).error, /unknown metric/);
  assert.match(parsePivotQuery({ rows: 'x' }).error, /row dimension/);
  assert.match(parsePivotQuery({ rows: 'session', cols: 'session' }).error, /differ/);
});

test('pivotTrades: rows × cols, totals, multi-valued tags', () => {
  const rows = db.prepare('SELECT * FROM trades ORDER BY id').all();
  const p = pivotTrades(rows, { metrics: ['net_pnl', 'trades'], rows: 'session', cols: 'instrument' });
  assert.deepEqual(p.rows.map((r) => r.key), ['london', 'ny']);
  assert.deepEqual(p.cols.map((c) => c.key), ['US100', 'XAUUSD']);
  const london = p.rows[0];
  assert.deepEqual(london.total, { net_pnl: 50, trades: 2 });
  assert.deepEqual(london.cells.XAUUSD, { net_pnl: 200, trades: 1 });
  assert.deepEqual(london.cells.US100, { net_pnl: -150, trades: 1 });
  assert.deepEqual(p.col_totals.US100, { net_pnl: -100, trades: 2 });
  assert.deepEqual(p.total, { net_pnl: 0, trades: 4 });
});

test('pivot(): DB-backed, respects filters incl. direction + tag dims', () => {
  const p = pivot({ metrics: 'net_pnl,trades', rows: 'tag:mistake', direction: 'short' });
  assert.equal(p.error, undefined);
  assert.deepEqual(p.rows.map((r) => [r.label, r.total.trades, r.total.net_pnl]), [['FOMO', 2, -250]]);
  const s = pivot({ metrics: 'win_rate', rows: 'setup', instrument: 'XAUUSD' });
  assert.deepEqual(s.rows.map((r) => [r.label, r.total.win_rate]), [['Wick fill', 0.5]]);
  const f = pivot({ metrics: 'trades', rows: 'followed', account: 1 });
  assert.deepEqual(f.rows.map((r) => [r.key, r.total.trades]), [['1', 2], ['0', 1], ['__none', 1]]);
  assert.match(pivot({ rows: 'bogus' }).error, /unknown/);
});

test('slice(): equity, R list, by_session, followed filter', () => {
  const s = slice({ followed: '1' });
  assert.equal(s.metrics.trades, 2);
  assert.equal(s.metrics.net_pnl, 250);
  assert.deepEqual(s.r, [2, 0.5]);
  assert.deepEqual(s.equity.map((e) => e.cum_pnl), [200, 250]);
  assert.equal(s.days, 2);
  assert.deepEqual(s.by_session.map((r) => r.key), ['london', 'ny']);
});
