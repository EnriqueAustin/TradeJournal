import { db } from './db.js';

// Profiles — a lightweight owner grouping over accounts (no auth). Two traders
// sharing one local app each pick their profile; stats/trades endpoints then
// accept ?profile=<id>, resolved centrally in buildFilter / tradesQuery.

const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

// Validate + normalise a create/patch body. Returns { error } or { values }
// holding only the keys present (so PATCH stays partial).
export function cleanProfileBody(b = {}, { partial = false } = {}) {
  const values = {};
  if (!partial || 'name' in b) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return { error: 'name is required' };
    if (name.length > 40) return { error: 'name is too long' };
    values.name = name;
  }
  if ('colour' in b) {
    if (b.colour == null || b.colour === '') values.colour = null;
    else if (!COLOUR_RE.test(String(b.colour))) return { error: 'colour must be #rrggbb' };
    else values.colour = String(b.colour).toLowerCase();
  }
  if ('default_instrument' in b) {
    const inst = b.default_instrument == null ? '' : String(b.default_instrument).trim();
    values.default_instrument = inst && inst !== 'All' ? inst.toUpperCase() : null;
  }
  return { values };
}

const withCount = `SELECT p.*, (SELECT COUNT(*) FROM accounts a WHERE a.profile_id = p.id) AS account_count
  FROM profiles p`;

export function listProfiles() {
  return db.prepare(`${withCount} ORDER BY p.id`).all();
}

export function getProfile(id) {
  return db.prepare(`${withCount} WHERE p.id = ?`).get(Number(id)) ?? null;
}

export function createProfile(body) {
  const { error, values } = cleanProfileBody(body);
  if (error) return { error };
  const info = db
    .prepare('INSERT INTO profiles (name, colour, default_instrument) VALUES (?, ?, ?)')
    .run(values.name, values.colour ?? null, values.default_instrument ?? null);
  return { profile: getProfile(info.lastInsertRowid) };
}

export function updateProfile(id, body) {
  if (!getProfile(id)) return { notFound: true };
  const { error, values } = cleanProfileBody(body, { partial: true });
  if (error) return { error };
  const keys = Object.keys(values);
  if (keys.length) {
    db.prepare(`UPDATE profiles SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({
      ...values,
      id: Number(id),
    });
  }
  return { profile: getProfile(id) };
}

// Deleting a profile never touches accounts or trades — its accounts just
// become unassigned.
export function deleteProfile(id) {
  const tx = db.transaction((pid) => {
    db.prepare('UPDATE accounts SET profile_id = NULL WHERE profile_id = ?').run(pid);
    return db.prepare('DELETE FROM profiles WHERE id = ?').run(pid).changes;
  });
  return tx(Number(id)) > 0;
}

export function registerProfileRoutes(app) {
  app.get('/api/profiles', (req, res) => res.json(listProfiles()));
  app.post('/api/profiles', (req, res) => {
    const r = createProfile(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json(r.profile);
  });
  app.patch('/api/profiles/:id', (req, res) => {
    const r = updateProfile(req.params.id, req.body || {});
    if (r.notFound) return res.status(404).json({ error: 'profile not found' });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r.profile);
  });
  app.delete('/api/profiles/:id', (req, res) => {
    if (!deleteProfile(req.params.id)) return res.status(404).json({ error: 'profile not found' });
    res.status(204).end();
  });
}
