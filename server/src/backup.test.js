import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  isValidBackupName,
  backupStamp,
  resolveBackupDir,
  resolveBackupKeep,
  createBackup,
  listBackups,
  pruneBackups,
  lastBackupTime,
  exportAll,
  startBackupScheduler,
} from './backup.js';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `tj-${p}-`));

function scratchDb(dir) {
  const db = new Database(path.join(dir, 'journal.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE trades (id INTEGER PRIMARY KEY, instrument TEXT);
    CREATE TABLE screenshots (id INTEGER PRIMARY KEY, trade_id INTEGER, url TEXT);
    CREATE TABLE price_bars (t TEXT);
    CREATE TABLE goals (id INTEGER PRIMARY KEY, name TEXT);
  `);
  db.prepare('INSERT INTO trades (instrument) VALUES (?)').run('XAUUSD');
  db.prepare('INSERT INTO goals (name) VALUES (?)').run('green week');
  db.prepare('INSERT INTO price_bars VALUES (?)').run('2026-01-01');
  return db;
}

test('backup name validation rejects traversal and foreign names', () => {
  assert.ok(isValidBackupName('journal-20260917-081500.db'));
  assert.ok(isValidBackupName('journal-20260917-081500-2.db'));
  for (const bad of [
    '../journal.db',
    'journal-20260917-081500.db/../../x',
    '..%2Fjournal-20260917-081500.db',
    'journal-20260917-081500.db.partial',
    'journal.db',
    'journal-2026-09-17.db',
    'sub/journal-20260917-081500.db',
    'sub\\journal-20260917-081500.db',
    '',
    null,
  ]) {
    assert.equal(isValidBackupName(bad), false, String(bad));
  }
});

test('stamp, dir and keep resolution', () => {
  assert.equal(backupStamp(new Date('2026-09-17T08:05:03Z')), '20260917-080503');
  assert.equal(resolveBackupDir('/x/data/journal.db', {}), path.join(path.resolve('/x/data'), 'backups'));
  assert.equal(resolveBackupDir('/x/data/journal.db', { BACKUP_DIR: '/b' }), path.resolve('/b'));
  assert.equal(resolveBackupKeep({}), 14);
  assert.equal(resolveBackupKeep({ BACKUP_KEEP: '3' }), 3);
  assert.equal(resolveBackupKeep({ BACKUP_KEEP: 'abc' }), 14);
});

test('createBackup snapshots the db and copies referenced screenshots', async () => {
  const root = tmp('backup');
  const db = scratchDb(root);
  const shots = path.join(root, 'screenshots');
  fs.mkdirSync(shots);
  fs.writeFileSync(path.join(shots, 'a.png'), 'png-a');
  fs.writeFileSync(path.join(shots, 'orphan.png'), 'not referenced');
  db.prepare('INSERT INTO screenshots (trade_id, url) VALUES (1, ?)').run('/screenshots/a.png');
  db.prepare('INSERT INTO screenshots (trade_id, url) VALUES (1, ?)').run('/screenshots/gone.png');
  db.prepare('INSERT INTO screenshots (trade_id, url) VALUES (1, ?)').run('https://example.com/x.png');

  const dir = path.join(root, 'backups');
  const r = await createBackup({ db, dir, screenshotsDir: shots, keep: 5, now: new Date('2026-09-17T08:00:00Z') });
  assert.equal(r.name, 'journal-20260917-080000.db');
  assert.equal(r.screenshots, 1);
  assert.equal(r.missing_screenshots, 1);

  const copy = new Database(path.join(dir, r.name), { readonly: true });
  assert.equal(copy.prepare('SELECT instrument FROM trades').get().instrument, 'XAUUSD');
  copy.close();
  const shotDir = path.join(dir, 'journal-20260917-080000-screenshots');
  assert.deepEqual(fs.readdirSync(shotDir), ['a.png']);

  // Same second → suffixed, not overwritten.
  const r2 = await createBackup({ db, dir, screenshotsDir: shots, keep: 5, now: new Date('2026-09-17T08:00:00Z') });
  assert.equal(r2.name, 'journal-20260917-080000-1.db');

  const list = listBackups(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, r2.name);
  assert.equal(list[1].screenshots, 1);
  assert.ok(lastBackupTime(dir));
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.partial')));
  db.close();
});

test('retention keeps the newest N backups and their screenshot folders', async () => {
  const root = tmp('prune');
  const db = scratchDb(root);
  const dir = path.join(root, 'backups');
  for (let d = 1; d <= 5; d++) {
    await createBackup({ db, dir, keep: 3, now: new Date(`2026-09-0${d}T00:00:00Z`) });
    fs.mkdirSync(path.join(dir, `journal-2026090${d}-000000-screenshots`), { recursive: true });
  }
  const names = listBackups(dir).map((b) => b.name);
  assert.deepEqual(names, [
    'journal-20260905-000000.db',
    'journal-20260904-000000.db',
    'journal-20260903-000000.db',
  ]);
  // Folders for the pruned ones (1,2) removed during later runs; unrelated files untouched.
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
  pruneBackups(dir, 1);
  assert.deepEqual(listBackups(dir).map((b) => b.name), ['journal-20260905-000000.db']);
  assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'journal-20260904-000000-screenshots')));
  db.close();
});

test('exportAll includes journal tables and skips market/derived tables', () => {
  const db = scratchDb(tmp('export'));
  const out = exportAll(db);
  assert.equal(out.format, 'trade-journal-export');
  assert.deepEqual(Object.keys(out.tables).sort(), ['goals', 'screenshots', 'trades']);
  assert.equal(out.tables.trades[0].instrument, 'XAUUSD');
  assert.equal(out.tables.goals[0].name, 'green week');
  db.close();
});

test('scheduler runs on startup only when the last backup is stale', async () => {
  const dir = tmp('sched');
  let runs = 0;
  const run = async () => {
    runs++;
    return { name: 'x', screenshots: 0 };
  };
  const quiet = { log() {}, error() {} };
  let stop = startBackupScheduler({ dir, run, log: quiet });
  stop();
  await new Promise((r) => setImmediate(r));
  assert.equal(runs, 1, 'no backups yet → runs');

  fs.writeFileSync(path.join(dir, 'journal-20260917-000000.db'), 'x'); // mtime = now
  stop = startBackupScheduler({ dir, run, log: quiet });
  stop();
  await new Promise((r) => setImmediate(r));
  assert.equal(runs, 1, 'fresh backup → skipped');
});
