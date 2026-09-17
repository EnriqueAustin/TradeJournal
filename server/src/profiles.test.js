import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JOURNAL_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tj-profiles-')), 'test.db');

const { db, migrate } = await import('./db.js');
const { buildFilter, summary, portfolio, propStats } = await import('./stats.js');
const { cleanProfileBody, createProfile, updateProfile, deleteProfile, listProfiles } =
  await import('./profiles.js');

migrate();
migrate(); // idempotent: re-running must not fail or duplicate columns
db.exec('DELETE FROM trades; DELETE FROM accounts;');

const acct = db.prepare('INSERT INTO accounts (id, name, currency, starting_balance) VALUES (?, ?, ?, ?)');
acct.run(1, 'Gold A', 'USD', 10000);
acct.run(2, 'Gold B', 'USD', 5000);
acct.run(3, 'Nas', 'USD', 20000);
const ins = db.prepare(
  `INSERT INTO trades (account_id, instrument, direction, entry_time, exit_time, net_pnl, source)
   VALUES (?, ?, 'long', ?, ?, ?, 'csv')`
);
ins.run(1, 'XAUUSD', '2026-03-02T08:00:00Z', '2026-03-02T08:10:00Z', 100);
ins.run(2, 'XAUUSD', '2026-03-02T09:00:00Z', '2026-03-02T09:10:00Z', -30);
ins.run(3, 'US100', '2026-03-02T14:00:00Z', '2026-03-02T14:10:00Z', 500);

test('accounts.profile_id column exists after migrate', () => {
  const cols = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  assert.ok(cols.includes('profile_id'));
});

test('profile body validation', () => {
  assert.equal(cleanProfileBody({}).error, 'name is required');
  assert.equal(cleanProfileBody({ name: 'x', colour: 'red' }).error, 'colour must be #rrggbb');
  assert.deepEqual(cleanProfileBody({ name: ' Ant ', colour: '#AABBCC', default_instrument: 'xauusd' }).values, {
    name: 'Ant',
    colour: '#aabbcc',
    default_instrument: 'XAUUSD',
  });
  assert.equal(cleanProfileBody({ default_instrument: 'All' }, { partial: true }).values.default_instrument, null);
});

test('profile CRUD + account scoping through buildFilter/summary/portfolio', () => {
  const gold = createProfile({ name: 'Antonio', colour: '#f59e0b', default_instrument: 'XAUUSD' }).profile;
  const nas = createProfile({ name: 'Friend', colour: '#22d3ee', default_instrument: 'US100' }).profile;
  db.prepare('UPDATE accounts SET profile_id = ? WHERE id IN (1, 2)').run(gold.id);
  db.prepare('UPDATE accounts SET profile_id = ? WHERE id = 3').run(nas.id);

  assert.equal(listProfiles().find((p) => p.id === gold.id).account_count, 2);

  const f = buildFilter({ profile: gold.id });
  assert.match(f.where, /profile_id = @profile/);
  // An explicit account wins over the profile.
  assert.doesNotMatch(buildFilter({ profile: gold.id, account: 3 }).where, /profile_id/);

  assert.equal(summary({ profile: gold.id }).net_pnl, 70);
  assert.equal(summary({ profile: gold.id }).trade_count, 2);
  assert.equal(summary({ profile: nas.id }).net_pnl, 500);
  assert.equal(summary({}).net_pnl, 570);

  const pf = portfolio({ profile: gold.id });
  assert.equal(pf.account_count, 2);
  assert.deepEqual(pf.accounts.map((a) => a.name), ['Gold A', 'Gold B']);
  assert.equal(portfolio({}).account_count, 3);

  // Account-level stats resolve to the profile's first account.
  assert.equal(propStats({ profile: nas.id }).starting_balance, 20000);

  const renamed = updateProfile(nas.id, { name: 'Mate' });
  assert.equal(renamed.profile.name, 'Mate');
  assert.equal(renamed.profile.default_instrument, 'US100');
  assert.equal(updateProfile(9999, { name: 'x' }).notFound, true);

  assert.equal(deleteProfile(gold.id), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE profile_id IS NULL').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM trades').get().c, 3);
  assert.equal(deleteProfile(gold.id), false);
});
