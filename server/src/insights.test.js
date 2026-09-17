import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point db.js at a scratch file before anything imports it.
process.env.JOURNAL_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tj-insights-')), 'test.db');

const { db, migrate } = await import('./db.js');
const { agg, afterLossIds, computePsychology, computeInsights, insights, psychology, INSIGHT_THRESHOLDS } =
  await import('./insights.js');
const { monthBounds, mondayOf, monthReport } = await import('./report.js');

migrate();
db.exec('DELETE FROM trade_tags; DELETE FROM tags; DELETE FROM trades; DELETE FROM accounts;');
db.prepare("INSERT INTO accounts (id, name, currency, starting_balance) VALUES (1, 'T', 'USD', 10000)").run();

// Build a row the pure functions accept.
let nextId = 1;
function row(o) {
  const entry = o.entry;
  const hold = o.hold ?? 120;
  const exit = new Date(new Date(entry).getTime() + hold * 1000).toISOString();
  return {
    id: nextId++,
    account_id: 1,
    instrument: 'XAUUSD',
    direction: 'long',
    entry_time: entry,
    exit_time: exit,
    net_pnl: 0,
    r_multiple: null,
    is_be: 0,
    session: 'london',
    hold_time_sec: hold,
    stop_price: 1,
    setup_id: null,
    followed_plan: null,
    emotion: null,
    confidence: null,
    satisfaction: null,
    ...o,
  };
}

test('agg: win rate over all trades, avg R only over trades with R, BE neither', () => {
  const a = agg([
    { net_pnl: 100, r_multiple: 2, is_be: 0 },
    { net_pnl: -50, r_multiple: null, is_be: 0 },
    { net_pnl: 0, r_multiple: 0, is_be: 1 },
  ]);
  assert.equal(a.n, 3);
  assert.equal(a.wins, 1);
  assert.equal(a.losses, 1);
  assert.equal(a.net_pnl, 50);
  assert.equal(a.win_rate, 0.3333);
  assert.equal(a.avg_r, 1);
});

test('afterLossIds: only entries within 30 min of a losing exit, same account', () => {
  const loss = row({ entry: '2026-03-02T08:00:00.000Z', hold: 60, net_pnl: -40 }); // exits 08:01
  const quick = row({ entry: '2026-03-02T08:20:00.000Z', net_pnl: 10 }); // 19 min later
  const late = row({ entry: '2026-03-02T08:40:00.000Z', net_pnl: 10 }); // 39 min later
  const other = row({ entry: '2026-03-02T08:05:00.000Z', net_pnl: 10, account_id: 2 });
  const ids = afterLossIds([loss, quick, late, other]);
  assert.deepEqual([...ids], [quick.id]);
});

test('computePsychology groups by emotion + confidence and splits tilt after loss', () => {
  const rows = [
    row({ entry: '2026-03-02T08:00:00.000Z', hold: 60, net_pnl: -40, emotion: 'fomo', confidence: 2 }),
    row({ entry: '2026-03-02T08:10:00.000Z', net_pnl: -30, emotion: 'revenge', confidence: 2 }),
    row({ entry: '2026-03-03T09:00:00.000Z', net_pnl: 80, emotion: 'calm', confidence: 4 }),
    row({ entry: '2026-03-04T09:00:00.000Z', net_pnl: 20, emotion: 'calm', satisfaction: 5 }),
    row({ entry: '2026-03-05T09:00:00.000Z', net_pnl: 5 }),
  ];
  const p = computePsychology(rows);
  assert.equal(p.total, 5);
  assert.equal(p.rated, 4);
  const calm = p.by_emotion.find((e) => e.key === 'calm');
  assert.equal(calm.n, 2);
  assert.equal(calm.net_pnl, 100);
  assert.deepEqual(p.by_emotion.map((e) => e.key), ['calm', 'fomo', 'revenge'], 'fixed emotion order');
  assert.equal(p.by_confidence.find((c) => c.key === 2).net_pnl, -70);
  assert.equal(p.tilt_after_loss.after_loss.n, 1);
  assert.equal(p.tilt_after_loss.after_loss.net_pnl, -30);
  assert.equal(p.tilt_after_loss.other.n, 4);
});

test('computeInsights: below min_total returns only a low-sample note', () => {
  const rows = [row({ entry: '2026-03-02T08:00:00.000Z', net_pnl: 10 })];
  const r = computeInsights(rows);
  assert.equal(r.insights.length, 0);
  assert.equal(r.low_sample[0].id, 'all');
  assert.match(r.low_sample[0].detail, /low sample/);
});

// A deterministic 20-trade book with planted leaks:
//  - NY loses (-30 each), London wins (+50 each)
//  - shorts are the NY trades
//  - "moved stop" mistake on 3 NY trades
//  - broke plan on the NY trades, followed on London
function plantedBook() {
  const rows = [];
  for (let d = 0; d < 10; d++) {
    const day = `2026-03-${String(2 + d).padStart(2, '0')}`;
    rows.push(
      row({
        entry: `${day}T08:00:00.000Z`,
        net_pnl: 50,
        r_multiple: 1,
        session: 'london',
        followed_plan: 1,
        emotion: 'calm',
        hold: 60,
      })
    );
    rows.push(
      row({
        entry: `${day}T14:00:00.000Z`,
        net_pnl: -30,
        r_multiple: -0.6,
        session: 'ny',
        direction: 'short',
        followed_plan: 0,
        emotion: d < 4 ? 'fomo' : null,
        hold: 600,
        stop_price: d < 7 ? null : 1,
      })
    );
  }
  return rows;
}

test('computeInsights finds the planted leaks and sorts bad first', () => {
  const rows = plantedBook();
  const nyIds = rows.filter((r) => r.session === 'ny').map((r) => r.id);
  const mistakes = new Map(nyIds.slice(0, 3).map((id) => [id, [{ id: 99, name: 'moved stop' }]]));
  const r = computeInsights(rows, { mistakes, setupNames: new Map(), exits: null });
  const by = Object.fromEntries(r.insights.map((i) => [i.id, i]));

  assert.equal(by.session_worst.severity, 'bad');
  assert.deepEqual(by.session_worst.link, { session: 'ny' });
  assert.equal(by.session_worst.sample_n, 10);
  assert.equal(by.session_best.severity, 'good');

  assert.equal(by.direction.severity, 'bad');
  assert.deepEqual(by.direction.link, { direction: 'short' });

  assert.equal(by.mistake_cost.metric.value, -90);
  assert.deepEqual(by.mistake_cost.link, { tag: 99 });

  assert.equal(by.plan_delta.severity, 'bad');
  assert.equal(by.plan_delta.metric.value, 80); // 50 - (-30)

  assert.equal(by.hold_asymmetry.severity, 'warn'); // 600s losers vs 60s winners
  assert.equal(by.emotion_worst.link.emotion, 'fomo');
  assert.equal(by.stopless.severity, 'warn'); // 7/20 = 35%

  // Every insight carries the contract fields.
  for (const i of r.insights) {
    assert.ok(['good', 'warn', 'bad'].includes(i.severity), i.id);
    assert.equal(typeof i.title, 'string');
    assert.equal(typeof i.detail, 'string');
    assert.ok(Number.isFinite(i.sample_n), i.id);
    assert.ok(i.metric && 'value' in i.metric, i.id);
  }
  // Severity-sorted: no 'bad' after a 'warn'/'good'.
  const rank = { bad: 0, warn: 1, good: 2 };
  for (let k = 1; k < r.insights.length; k++)
    assert.ok(rank[r.insights[k - 1].severity] <= rank[r.insights[k].severity]);

  // Checks that couldn't run say so, with the threshold they needed.
  const low = Object.fromEntries(r.low_sample.map((l) => [l.id, l]));
  assert.ok(low.exit_left, 'no exit data → low sample');
  assert.equal(low.exit_left.need, INSIGHT_THRESHOLDS.min_group);
});

test('insights()/psychology() read the DB and respect filters', () => {
  const ins = db.prepare(
    `INSERT INTO trades (id, account_id, instrument, direction, entry_time, exit_time, net_pnl, gross_pnl,
       commission, swap, r_multiple, session, source, is_backtest, hold_time_sec, followed_plan)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'csv', 0, ?, ?)`
  );
  for (const t of plantedBook()) {
    ins.run(t.id, t.instrument, t.direction, t.entry_time, t.exit_time, t.net_pnl, t.net_pnl,
      t.r_multiple, t.session, t.hold_time_sec, t.followed_plan);
    if (t.emotion) db.prepare('INSERT INTO trade_psych (trade_id, emotion) VALUES (?, ?)').run(t.id, t.emotion);
  }
  const all = insights({ account: 1 }, { exits: false });
  assert.equal(all.total, 20);
  assert.ok(all.insights.some((i) => i.id === 'session_worst'));

  // Filtering to London only leaves 10 trades, one session: no session insight.
  const lon = insights({ account: 1, session: 'london' }, { exits: false });
  assert.equal(lon.total, 10);
  assert.ok(!lon.insights.some((i) => i.id === 'session_worst'));

  const p = psychology({ account: 1 });
  assert.equal(p.by_emotion.find((e) => e.key === 'fomo').n, 4);
  assert.equal(p.by_emotion.find((e) => e.key === 'calm').net_pnl, 500);
});

test('monthBounds / mondayOf', () => {
  assert.deepEqual(monthBounds('2026-03'), { from: '2026-03-01', to: '2026-03-31', prev: '2026-02' });
  assert.deepEqual(monthBounds('2026-01'), { from: '2026-01-01', to: '2026-01-31', prev: '2025-12' });
  assert.equal(monthBounds('2028-02').to, '2028-02-29');
  assert.equal(mondayOf('2026-09-17'), '2026-09-14'); // Thu
  assert.equal(mondayOf('2026-09-14'), '2026-09-14'); // Mon
  assert.equal(mondayOf('2026-09-20'), '2026-09-14'); // Sun
});

test('monthReport aggregates the month and keeps week vs day recaps apart', () => {
  db.prepare("INSERT INTO notes (account_id, day, body) VALUES (1, '2026-03-02', 'day recap')").run();
  db.prepare("INSERT INTO notes (account_id, day, kind, body) VALUES (1, '2026-03-02', 'week', 'week recap')").run();
  const m = monthReport(1, '2026-03');
  assert.equal(m.stats.trade_count, 20);
  assert.equal(m.stats.net_pnl, 200); // 10×50 − 10×30
  assert.equal(m.prev_stats.trade_count, 0);
  assert.equal(m.trading_days, 10);
  assert.equal(m.green_days, 10);
  assert.equal(m.by_session[0].key, 'london');
  assert.equal(m.discipline.followed, 10);
  assert.deepEqual(
    m.recaps.map((r) => r.kind).sort(),
    ['day', 'week']
  );
  assert.equal(m.best_trades.length, 5);
  assert.equal(m.worst_trades[0].net_pnl, -30);
});
