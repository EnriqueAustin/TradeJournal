import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JOURNAL_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tj-notebook-')), 'test.db');

const { db, migrate } = await import('./db.js');
const nb = await import('./notebook.js');

migrate();
migrate(); // idempotent

db.exec('DELETE FROM trades; DELETE FROM accounts; DELETE FROM profiles;');
db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Antonio'), (2, 'Friend')").run();
const acct = db.prepare('INSERT INTO accounts (id, name, currency, starting_balance, profile_id) VALUES (?, ?, ?, ?, ?)');
acct.run(1, 'Gold', 'USD', 10000, 1);
acct.run(2, 'Nas', 'USD', 10000, 2);
db.prepare(
  `INSERT INTO trades (id, account_id, instrument, direction, entry_time, exit_time, net_pnl, source)
   VALUES (7, 1, 'XAUUSD', 'long', '2026-03-02T08:00:00Z', '2026-03-02T08:10:00Z', 50, 'csv')`
).run();

test('migrate creates tables and seeds default templates exactly once', () => {
  const names = nb.listTemplates().map((t) => t.name);
  for (const n of ['Pre-market plan', 'Session recap', 'Weekly review', 'Trade post-mortem'])
    assert.ok(names.includes(n), n);
  const before = nb.listTemplates().length;
  const pm = nb.listTemplates().find((t) => t.name === 'Pre-market plan');
  assert.ok(nb.deleteTemplate(pm.id));
  migrate();
  assert.equal(nb.listTemplates().length, before - 1, 'deleted default is not re-seeded');
});

test('note CRUD, validation, profile scoping, search, pin ordering', () => {
  assert.equal(nb.cleanNoteBody({ day: '2026/03/02' }).error, 'day must be YYYY-MM-DD');
  assert.equal(nb.cleanNoteBody({ trade_id: 999 }).error, 'trade not found');

  const a = nb.createNote({ account: 1, title: 'Gold plan', body: 'Sweep of **Asia** high', folder: 'Trading Plan', trade_id: 7 }).note;
  assert.equal(a.profile_id, 1);
  assert.equal(a.account_id, 1);
  assert.equal(a.trade_id, 7);
  const b = nb.createNote({ profile: 2, title: 'Nas lesson', body: '100% of the time', folder: 'Lessons' }).note;
  const shared = nb.createNote({ title: 'Shared', body: 'both see this' }).note;
  assert.equal(shared.profile_id, null);
  assert.equal(shared.folder, null);

  assert.deepEqual(nb.listNotes({ profile: 1 }).map((n) => n.id).sort(), [a.id, shared.id].sort());
  assert.deepEqual(nb.listNotes({ account: 2 }).map((n) => n.id).sort(), [b.id, shared.id].sort());
  assert.equal(nb.listNotes().length, 3);
  assert.deepEqual(nb.listNotes({ q: 'asia' }).map((n) => n.id), [a.id]);
  // LIKE wildcards are literal.
  assert.deepEqual(nb.listNotes({ q: '100%' }).map((n) => n.id), [b.id]);
  assert.deepEqual(nb.listNotes({ folder: '__unfiled' }).map((n) => n.id), [shared.id]);

  const u = nb.updateNote(shared.id, { pinned: true });
  assert.equal(u.note.pinned, 1);
  assert.equal(nb.listNotes()[0].id, shared.id, 'pinned first');
  assert.equal(nb.updateNote(9999, { title: 'x' }).notFound, true);
  assert.equal(nb.updateNote(a.id, {}).error, 'nothing to update');

  assert.ok(nb.deleteNote(b.id));
  assert.equal(nb.getNote(b.id), null);
});

test('folders: defaults, custom create/rename/delete keeps notes', () => {
  const f = nb.listFolders({ profile: 1 });
  assert.deepEqual(
    f.folders.slice(0, 4).map((x) => x.name),
    ['Trading Plan', 'Session Recaps', 'Lessons', 'Playbook Ideas']
  );
  assert.equal(f.folders.find((x) => x.name === 'Trading Plan').count, 1);

  const c = nb.createFolder({ profile: 1, name: 'Wicks' }).folder;
  assert.equal(nb.createFolder({ profile: 1, name: 'wicks' }).error, 'folder already exists');
  assert.equal(nb.createFolder({ profile: 1, name: 'Lessons' }).error, 'folder already exists');
  const n = nb.createNote({ profile: 1, title: 'w', folder: 'Wicks' }).note;
  nb.renameFolder(c.id, { name: 'Wick study' });
  assert.equal(nb.getNote(n.id).folder, 'Wick study');
  assert.ok(nb.deleteFolder(c.id));
  assert.equal(nb.getNote(n.id).folder, null, 'notes survive folder delete as unfiled');
  // Friend doesn't see Antonio's folder.
  assert.ok(!nb.listFolders({ profile: 2 }).folders.some((x) => x.name === 'Wick study'));
});

test('templates CRUD', () => {
  assert.equal(nb.createTemplate({ name: '' }).error, 'name is required');
  const t = nb.createTemplate({ profile: 1, name: 'NY open', body: '## NY' }).template;
  assert.equal(t.profile_id, 1);
  assert.ok(nb.listTemplates({ profile: 1 }).some((x) => x.id === t.id));
  assert.ok(!nb.listTemplates({ profile: 2 }).some((x) => x.id === t.id));
  assert.equal(nb.updateTemplate(t.id, { body: '## NY open' }).template.body, '## NY open');
  assert.ok(nb.deleteTemplate(t.id));
});

test('recaps: day + week recaps read from notes, trade notes excluded', () => {
  db.prepare("INSERT INTO notes (account_id, day, body) VALUES (1, '2026-03-02', 'Day **recap**')").run();
  db.prepare("INSERT INTO notes (account_id, day, kind, body) VALUES (1, '2026-03-02', 'week', 'Week recap')").run();
  db.prepare("INSERT INTO notes (account_id, day, body) VALUES (2, '2026-03-03', 'Friend day')").run();
  db.prepare("INSERT INTO notes (trade_id, body) VALUES (7, 'trade note')").run();
  db.prepare("INSERT INTO notes (account_id, day, body) VALUES (1, '2026-03-04', '   ')").run();

  const all = nb.listRecaps();
  assert.equal(all.length, 3);
  const mine = nb.listRecaps({ profile: 1 });
  assert.deepEqual(mine.map((r) => r.kind).sort(), ['day', 'week']);
  assert.equal(mine[0].account_name, 'Gold');
  assert.equal(nb.listRecaps({ account: 2 }).length, 1);
  assert.equal(nb.listRecaps({ q: 'week' }).length, 1);
});
