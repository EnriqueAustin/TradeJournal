import { db } from './db.js';
import { DEFAULT_NOTEBOOK_FOLDERS } from './notebookTemplates.js';

// Notebook — markdown notes in folders, saved templates, and a read-only view
// of the journal's day/week recaps. Notes are scoped by profile: a request with
// ?profile=<id> (or an ?account=<id> belonging to a profile) sees that
// profile's notes plus shared ones (profile_id NULL); no scope sees everything.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE = 200;
const MAX_FOLDER = 60;

function num(v) {
  if (v == null || v === '' || v === 'null') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Profile id a request is scoped to, or null (= all). Account wins. */
export function scopeProfile(q = {}) {
  const account = num(q.account ?? q.account_id);
  if (account) {
    return db.prepare('SELECT profile_id FROM accounts WHERE id = ?').get(account)?.profile_id ?? null;
  }
  return num(q.profile ?? q.profile_id);
}

function likeEscape(s) {
  return `%${String(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ---------- notes ----------

/** Validate a create/patch body. Returns { error } or { values }. */
export function cleanNoteBody(b = {}, { partial = false } = {}) {
  const values = {};
  if (!partial || 'title' in b) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (title.length > MAX_TITLE) return { error: 'title is too long' };
    values.title = title;
  }
  if (!partial || 'body' in b) {
    if (b.body != null && typeof b.body !== 'string') return { error: 'body must be text' };
    values.body = b.body ?? '';
  }
  if (!partial || 'folder' in b) {
    const folder = typeof b.folder === 'string' ? b.folder.trim() : '';
    if (folder.length > MAX_FOLDER) return { error: 'folder name is too long' };
    values.folder = folder || null;
  }
  if ('pinned' in b) values.pinned = b.pinned ? 1 : 0;
  if ('trade_id' in b) {
    const t = num(b.trade_id);
    if (b.trade_id != null && b.trade_id !== '' && !t) return { error: 'trade_id must be a trade id' };
    if (t && !db.prepare('SELECT 1 FROM trades WHERE id = ?').get(t)) return { error: 'trade not found' };
    values.trade_id = t;
  }
  if ('day' in b) {
    if (b.day != null && b.day !== '' && !DAY_RE.test(String(b.day))) return { error: 'day must be YYYY-MM-DD' };
    values.day = b.day || null;
  }
  return { values };
}

export function listNotes(q = {}) {
  const clauses = [];
  const params = {};
  const profile = scopeProfile(q);
  if (profile) {
    clauses.push('(profile_id = @profile OR profile_id IS NULL)');
    params.profile = profile;
  }
  if (q.folder === '__unfiled') clauses.push('folder IS NULL');
  else if (q.folder) {
    clauses.push('folder = @folder');
    params.folder = String(q.folder);
  }
  if (q.pinned === '1' || q.pinned === true) clauses.push('pinned = 1');
  if (q.q && String(q.q).trim()) {
    clauses.push("(title LIKE @q ESCAPE '\\' OR body LIKE @q ESCAPE '\\')");
    params.q = likeEscape(String(q.q).trim());
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM notebook_notes ${where} ORDER BY pinned DESC, updated_at DESC, id DESC`)
    .all(params);
}

export function getNote(id) {
  return db.prepare('SELECT * FROM notebook_notes WHERE id = ?').get(Number(id)) ?? null;
}

export function createNote(b = {}) {
  const { error, values } = cleanNoteBody(b);
  if (error) return { error };
  const account = num(b.account ?? b.account_id);
  if (account && !db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(account))
    return { error: 'account not found' };
  const profile = account ? scopeProfile({ account }) : num(b.profile ?? b.profile_id);
  const info = db
    .prepare(
      `INSERT INTO notebook_notes (profile_id, account_id, folder, title, body, pinned, trade_id, day)
       VALUES (@profile_id, @account_id, @folder, @title, @body, @pinned, @trade_id, @day)`
    )
    .run({
      profile_id: profile,
      account_id: account,
      folder: values.folder,
      title: values.title,
      body: values.body,
      pinned: values.pinned ?? 0,
      trade_id: values.trade_id ?? null,
      day: values.day ?? null,
    });
  return { note: getNote(info.lastInsertRowid) };
}

export function updateNote(id, b = {}) {
  if (!getNote(id)) return { notFound: true };
  const { error, values } = cleanNoteBody(b, { partial: true });
  if (error) return { error };
  const keys = Object.keys(values);
  if (!keys.length) return { error: 'nothing to update' };
  // Pinning is not an edit — don't bump the note up the "recently edited" list.
  const touch = keys.some((k) => k !== 'pinned') ? ", updated_at = datetime('now')" : '';
  db.prepare(
    `UPDATE notebook_notes SET ${keys.map((k) => `${k} = @${k}`).join(', ')}${touch} WHERE id = @id`
  ).run({ ...values, id: Number(id) });
  return { note: getNote(id) };
}

export function deleteNote(id) {
  return db.prepare('DELETE FROM notebook_notes WHERE id = ?').run(Number(id)).changes > 0;
}

// ---------- folders ----------

/**
 * Folder list for a scope: the four defaults, user-created folders, and any
 * folder name still carried by a note (e.g. after a profile switch), each with
 * its note count. Plus an "unfiled" count.
 */
export function listFolders(q = {}) {
  const profile = scopeProfile(q);
  const scope = profile ? 'WHERE (profile_id = @profile OR profile_id IS NULL)' : '';
  const params = profile ? { profile } : {};
  const counts = new Map(
    db
      .prepare(`SELECT folder, COUNT(*) AS n FROM notebook_notes ${scope} GROUP BY folder`)
      .all(params)
      .map((r) => [r.folder, r.n])
  );
  const out = DEFAULT_NOTEBOOK_FOLDERS.map((name) => ({
    id: null,
    name,
    builtin: true,
    count: counts.get(name) ?? 0,
  }));
  const seen = new Set(DEFAULT_NOTEBOOK_FOLDERS);
  for (const f of db
    .prepare(`SELECT id, name FROM notebook_folders ${scope} ORDER BY name COLLATE NOCASE`)
    .all(params)) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    out.push({ id: f.id, name: f.name, builtin: false, count: counts.get(f.name) ?? 0 });
  }
  for (const [name, n] of counts) {
    if (name == null || seen.has(name)) continue;
    seen.add(name);
    out.push({ id: null, name, builtin: false, count: n });
  }
  return {
    folders: out,
    unfiled: counts.get(null) ?? 0,
    total: [...counts.values()].reduce((s, n) => s + n, 0),
  };
}

export function createFolder(b = {}) {
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { error: 'name is required' };
  if (name.length > MAX_FOLDER) return { error: 'folder name is too long' };
  if (name === '__unfiled') return { error: 'reserved name' };
  const profile = scopeProfile(b);
  const existing = listFolders({ profile }).folders.find(
    (f) => f.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return { error: 'folder already exists' };
  const info = db
    .prepare('INSERT INTO notebook_folders (profile_id, name) VALUES (?, ?)')
    .run(profile, name);
  return { folder: { id: info.lastInsertRowid, name, builtin: false, count: 0 } };
}

export function renameFolder(id, b = {}) {
  const row = db.prepare('SELECT * FROM notebook_folders WHERE id = ?').get(Number(id));
  if (!row) return { notFound: true };
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { error: 'name is required' };
  if (name.length > MAX_FOLDER) return { error: 'folder name is too long' };
  if (DEFAULT_NOTEBOOK_FOLDERS.includes(name)) return { error: 'folder already exists' };
  db.transaction(() => {
    db.prepare('UPDATE notebook_folders SET name = ? WHERE id = ?').run(name, row.id);
    db.prepare(
      'UPDATE notebook_notes SET folder = ? WHERE folder = ? AND profile_id IS ?'
    ).run(name, row.name, row.profile_id);
  })();
  return { folder: { id: row.id, name, builtin: false } };
}

/** Delete a user folder; its notes become unfiled (never deleted). */
export function deleteFolder(id) {
  const row = db.prepare('SELECT * FROM notebook_folders WHERE id = ?').get(Number(id));
  if (!row) return false;
  db.transaction(() => {
    db.prepare('UPDATE notebook_notes SET folder = NULL WHERE folder = ? AND profile_id IS ?').run(
      row.name,
      row.profile_id
    );
    db.prepare('DELETE FROM notebook_folders WHERE id = ?').run(row.id);
  })();
  return true;
}

// ---------- templates ----------

export function listTemplates(q = {}) {
  const profile = scopeProfile(q);
  const where = profile ? 'WHERE (profile_id = @profile OR profile_id IS NULL)' : '';
  return db
    .prepare(`SELECT * FROM note_templates ${where} ORDER BY name COLLATE NOCASE`)
    .all(profile ? { profile } : {});
}

function cleanTemplate(b = {}, partial = false) {
  const values = {};
  if (!partial || 'name' in b) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return { error: 'name is required' };
    if (name.length > 80) return { error: 'name is too long' };
    values.name = name;
  }
  if (!partial || 'body' in b) {
    if (b.body != null && typeof b.body !== 'string') return { error: 'body must be text' };
    values.body = b.body ?? '';
  }
  return { values };
}

export function createTemplate(b = {}) {
  const { error, values } = cleanTemplate(b);
  if (error) return { error };
  const info = db
    .prepare('INSERT INTO note_templates (profile_id, name, body) VALUES (?, ?, ?)')
    .run(scopeProfile(b), values.name, values.body);
  return { template: db.prepare('SELECT * FROM note_templates WHERE id = ?').get(info.lastInsertRowid) };
}

export function updateTemplate(id, b = {}) {
  const row = db.prepare('SELECT * FROM note_templates WHERE id = ?').get(Number(id));
  if (!row) return { notFound: true };
  const { error, values } = cleanTemplate(b, true);
  if (error) return { error };
  const keys = Object.keys(values);
  if (!keys.length) return { error: 'nothing to update' };
  db.prepare(
    `UPDATE note_templates SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`
  ).run({ ...values, id: row.id });
  return { template: db.prepare('SELECT * FROM note_templates WHERE id = ?').get(row.id) };
}

export function deleteTemplate(id) {
  return db.prepare('DELETE FROM note_templates WHERE id = ?').run(Number(id)).changes > 0;
}

// ---------- journal recaps (read-only) ----------

/**
 * Day and week recaps from the `notes` table (trade_id NULL, day set), newest
 * first, for the notebook's read-only "Journal recaps" folder. Scoped by
 * account, else by profile's accounts.
 */
export function listRecaps(q = {}) {
  const clauses = ['n.trade_id IS NULL', 'n.day IS NOT NULL', "TRIM(COALESCE(n.body, '')) <> ''"];
  const params = {};
  const account = num(q.account ?? q.account_id);
  const profile = num(q.profile);
  if (account) {
    clauses.push('n.account_id = @account');
    params.account = account;
  } else if (profile) {
    clauses.push('n.account_id IN (SELECT id FROM accounts WHERE profile_id = @profile)');
    params.profile = profile;
  }
  if (q.q && String(q.q).trim()) {
    clauses.push("n.body LIKE @q ESCAPE '\\'");
    params.q = likeEscape(String(q.q).trim());
  }
  return db
    .prepare(
      `SELECT n.id, n.day, COALESCE(n.kind, 'day') AS kind, n.body, n.account_id,
              a.name AS account_name, n.created_at, n.updated_at
       FROM notes n LEFT JOIN accounts a ON a.id = n.account_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY n.day DESC, n.id DESC LIMIT 500`
    )
    .all(params);
}

// ---------- routes ----------

function send(res, result, key, created = false) {
  if (result.notFound) return res.status(404).json({ error: 'not found' });
  if (result.error) return res.status(400).json({ error: result.error });
  return res.status(created ? 201 : 200).json(result[key]);
}

export function registerNotebookRoutes(app, { imageUpload } = {}) {
  app.get('/api/notebook/notes', (req, res) => res.json(listNotes(req.query)));
  app.get('/api/notebook/notes/:id', (req, res) => {
    const n = getNote(req.params.id);
    return n ? res.json(n) : res.status(404).json({ error: 'not found' });
  });
  app.post('/api/notebook/notes', (req, res) => send(res, createNote(req.body), 'note', true));
  app.patch('/api/notebook/notes/:id', (req, res) => send(res, updateNote(req.params.id, req.body), 'note'));
  // POST alias: navigator.sendBeacon (last-chance save on tab close) can only POST.
  app.post('/api/notebook/notes/:id', (req, res) => send(res, updateNote(req.params.id, req.body), 'note'));
  app.delete('/api/notebook/notes/:id', (req, res) =>
    deleteNote(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'not found' })
  );

  app.get('/api/notebook/folders', (req, res) => res.json(listFolders(req.query)));
  app.post('/api/notebook/folders', (req, res) => send(res, createFolder(req.body), 'folder', true));
  app.patch('/api/notebook/folders/:id', (req, res) =>
    send(res, renameFolder(req.params.id, req.body), 'folder')
  );
  app.delete('/api/notebook/folders/:id', (req, res) =>
    deleteFolder(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'not found' })
  );

  app.get('/api/notebook/templates', (req, res) => res.json(listTemplates(req.query)));
  app.post('/api/notebook/templates', (req, res) => send(res, createTemplate(req.body), 'template', true));
  app.patch('/api/notebook/templates/:id', (req, res) =>
    send(res, updateTemplate(req.params.id, req.body), 'template')
  );
  app.delete('/api/notebook/templates/:id', (req, res) =>
    deleteTemplate(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'not found' })
  );

  app.get('/api/notebook/recaps', (req, res) => res.json(listRecaps(req.query)));

  // Pasted / dropped images share the trade screenshot storage (served under
  // /screenshots), but aren't attached to a trade.
  if (imageUpload) {
    app.post('/api/notebook/images', (req, res) => {
      imageUpload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: String(err.message || err) });
        if (!req.file) return res.status(400).json({ error: 'file is required' });
        res.status(201).json({ url: `/screenshots/${req.file.filename}` });
      });
    });
  }
}
