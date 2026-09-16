import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createImportWatcher, accountFromFilename } from './importWatch.js';

const quiet = { log() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tj-watch-'));

test('accountFromFilename convention', () => {
  assert.equal(accountFromFilename('acc3_ReportHistory.html'), 3);
  assert.equal(accountFromFilename('ACC12-closed.csv'), 12);
  assert.equal(accountFromFilename('acc7.xlsx'), 7);
  assert.equal(accountFromFilename('account3.csv'), null);
  assert.equal(accountFromFilename('ReportHistory-acc3.html'), null);
  assert.equal(accountFromFilename('acc3x.csv'), null);
});

test('scan imports report files, moves them, logs failures', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'acc2_good.csv'), 'ok');
  fs.writeFileSync(path.join(dir, 'plain.html'), 'ok');
  fs.writeFileSync(path.join(dir, 'broken.xml'), 'bad');
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'ignored');
  fs.writeFileSync(path.join(dir, '~$lock.xlsx'), 'ignored');

  const calls = [];
  const w = createImportWatcher({
    getConfig: () => ({ dir, accountId: 5 }),
    importFile: async (buf, { filename, accountId }) => {
      calls.push({ filename, accountId, body: buf.toString() });
      if (buf.toString() === 'bad') throw new Error('unrecognised report');
      return { inserted: 3, skipped: 1, account_id: accountId };
    },
    settleMs: 0,
    log: quiet,
  });

  const { results } = await w.scanOnce();
  assert.equal(results.length, 3);
  const byFile = Object.fromEntries(calls.map((c) => [c.filename, c.accountId]));
  assert.deepEqual(byFile, { 'acc2_good.csv': 2, 'plain.html': 5, 'broken.xml': 5 });

  assert.deepEqual(fs.readdirSync(path.join(dir, 'processed')).sort(), ['acc2_good.csv', 'plain.html']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'failed')).sort(), ['broken.xml', 'broken.xml.log']);
  assert.match(fs.readFileSync(path.join(dir, 'failed', 'broken.xml.log'), 'utf8'), /unrecognised report/);
  // Non-report files are left alone.
  assert.ok(fs.existsSync(path.join(dir, 'readme.txt')));
  assert.ok(fs.existsSync(path.join(dir, '~$lock.xlsx')));

  const st = w.status();
  assert.ok(st.last_scan);
  assert.equal(st.recent.length, 3);
  assert.equal(st.recent.find((r) => r.file === 'broken.xml').ok, false);
  assert.equal(st.recent.find((r) => r.file === 'plain.html').inserted, 3);

  // Re-dropping a same-named file doesn't clobber the earlier processed copy.
  fs.writeFileSync(path.join(dir, 'plain.html'), 'ok');
  await w.scanOnce();
  assert.equal(fs.readdirSync(path.join(dir, 'processed')).length, 3);

  // Nothing new → no calls.
  const n = calls.length;
  await w.scanOnce();
  assert.equal(calls.length, n);
});

test('files still being written (recent mtime) wait for a later scan', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'fresh.csv'), 'ok');
  let called = 0;
  const w = createImportWatcher({
    getConfig: () => ({ dir, accountId: null }),
    importFile: async () => {
      called++;
      return { inserted: 0, skipped: 0 };
    },
    settleMs: 60_000,
    log: quiet,
  });
  await w.scanOnce();
  assert.equal(called, 0);
  assert.ok(fs.existsSync(path.join(dir, 'fresh.csv')));
});

test('a file that parses to zero trades goes to failed/', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'empty.csv'), 'a,b');
  const w = createImportWatcher({
    getConfig: () => ({ dir, accountId: 1 }),
    importFile: async () => ({ parsed: 0, inserted: 0, skipped: 0, account_id: 1 }),
    settleMs: 0,
    log: quiet,
  });
  const { results } = await w.scanOnce();
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /no trades/);
  assert.ok(fs.existsSync(path.join(dir, 'failed', 'empty.csv.log')));
});

test('disabled or unreadable dir is a no-op with status', async () => {
  const w = createImportWatcher({
    getConfig: () => ({ dir: null }),
    importFile: async () => assert.fail('should not import'),
    log: quiet,
  });
  assert.equal((await w.scanOnce()).skipped, 'disabled');

  const missing = path.join(tmp(), 'nope');
  const w2 = createImportWatcher({
    getConfig: () => ({ dir: missing }),
    importFile: async () => assert.fail('should not import'),
    log: quiet,
  });
  assert.equal((await w2.scanOnce()).skipped, 'unreadable');
  assert.match(w2.status().last_error, /cannot read/);
});
