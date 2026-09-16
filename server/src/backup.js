// Journal backups + full JSON export.
//
// Pure helpers: nothing here imports the db singleton, so tests can drive them
// against a scratch database. A backup is a consistent SQLite snapshot taken
// with better-sqlite3's online backup API (safe while the server is writing),
// plus a sibling folder holding copies of the screenshot files trades reference:
//
//   <dir>/journal-20260917-081500.db
//   <dir>/journal-20260917-081500-screenshots/<file>.png
//
// Restore is deliberately not an API — see README "Backups & restore".
import fs from 'node:fs';
import path from 'node:path';

export const DAY_MS = 24 * 60 * 60 * 1000;

// Strict: only names this module produces. Used to validate download requests,
// so nothing with a separator, `..` or another extension can get through.
export const BACKUP_NAME_RE = /^journal-\d{8}-\d{6}(?:-\d{1,3})?\.db$/;

export function isValidBackupName(name) {
  return typeof name === 'string' && BACKUP_NAME_RE.test(name);
}

const pad = (n) => String(n).padStart(2, '0');

// UTC timestamp for file names: YYYYMMDD-HHMMSS.
export function backupStamp(d = new Date()) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

// BACKUP_DIR wins; otherwise a `backups` folder next to the journal DB.
export function resolveBackupDir(dbPath, env = process.env) {
  if (env.BACKUP_DIR) return path.resolve(env.BACKUP_DIR);
  return path.join(path.dirname(path.resolve(dbPath)), 'backups');
}

export function resolveBackupKeep(env = process.env) {
  const n = Number(env.BACKUP_KEEP);
  return Number.isInteger(n) && n > 0 ? n : 14;
}

const shotsDirFor = (dir, name) => path.join(dir, name.replace(/\.db$/, '-screenshots'));

// Newest first: [{ name, size, time (ISO), screenshots (file count) }].
export function listBackups(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!isValidBackupName(name)) continue;
    let st;
    try {
      st = fs.statSync(path.join(dir, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    let screenshots = 0;
    try {
      screenshots = fs.readdirSync(shotsDirFor(dir, name)).length;
    } catch {
      /* no screenshots folder */
    }
    out.push({ name, size: st.size, time: st.mtime.toISOString(), screenshots });
  }
  // Names embed a sortable UTC stamp plus an optional same-second counter.
  const key = (n) => {
    const m = /^journal-(\d{8}-\d{6})(?:-(\d+))?\.db$/.exec(n);
    return `${m[1]}-${String(m[2] || 0).padStart(3, '0')}`;
  };
  return out.sort((a, b) => (key(a.name) < key(b.name) ? 1 : key(a.name) > key(b.name) ? -1 : 0));
}

export function lastBackupTime(dir) {
  const [latest] = listBackups(dir);
  return latest ? latest.time : null;
}

// Keep the newest `keep` backups; delete older .db files and their screenshot
// folders. Returns the removed names.
export function pruneBackups(dir, keep) {
  const removed = [];
  for (const b of listBackups(dir).slice(Math.max(1, keep))) {
    try {
      fs.rmSync(path.join(dir, b.name), { force: true });
      fs.rmSync(shotsDirFor(dir, b.name), { recursive: true, force: true });
      removed.push(b.name);
    } catch {
      /* best-effort */
    }
  }
  return removed;
}

// Snapshot the DB + referenced screenshots, then apply retention.
export async function createBackup({ db, dir, screenshotsDir, keep = 14, now = new Date() }) {
  fs.mkdirSync(dir, { recursive: true });
  let name = `journal-${backupStamp(now)}.db`;
  for (let i = 1; fs.existsSync(path.join(dir, name)); i++) {
    name = `journal-${backupStamp(now)}-${i}.db`;
  }
  const file = path.join(dir, name);
  // Write to a partial name first so a crash never leaves a listed half-file.
  const partial = `${file}.partial`;
  fs.rmSync(partial, { force: true });
  await db.backup(partial);
  fs.renameSync(partial, file);

  let screenshots = 0;
  let missing = 0;
  if (screenshotsDir) {
    const rows = db
      .prepare("SELECT DISTINCT url FROM screenshots WHERE url LIKE '/screenshots/%'")
      .all();
    if (rows.length) {
      const target = shotsDirFor(dir, name);
      fs.mkdirSync(target, { recursive: true });
      for (const { url } of rows) {
        const base = path.basename(url);
        const src = path.join(screenshotsDir, base);
        try {
          fs.copyFileSync(src, path.join(target, base));
          screenshots++;
        } catch {
          missing++;
        }
      }
    }
  }

  const pruned = pruneBackups(dir, keep);
  const size = fs.statSync(file).size;
  return { name, size, time: fs.statSync(file).mtime.toISOString(), screenshots, missing_screenshots: missing, pruned };
}

// Transient/derived tables left out of the portability export: market bars
// (re-fetchable, huge), the news feed cache and the live EA position mirror.
export const EXPORT_EXCLUDE = new Set(['price_bars', 'news_events', 'live_positions']);

// Every journal table as { table: rows[] }. Enumerated from the schema so new
// tables (goals, custom fields, missed trades, …) are included automatically.
export function exportAll(db) {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()
    .map((r) => r.name)
    .filter((n) => !EXPORT_EXCLUDE.has(n));
  const out = {};
  for (const t of tables) {
    out[t] = db.prepare(`SELECT * FROM "${t.replace(/"/g, '""')}"`).all();
  }
  return {
    format: 'trade-journal-export',
    version: 1,
    exported_at: new Date().toISOString(),
    schema_version: db.pragma('user_version', { simple: true }),
    excluded: [...EXPORT_EXCLUDE],
    tables: out,
  };
}

// Daily auto-backup: run now if the newest backup is older than `intervalMs`
// (or none exists), then every `intervalMs`. Returns a stop() function.
export function startBackupScheduler({ dir, run, intervalMs = DAY_MS, log = console }) {
  const tick = async (reason) => {
    try {
      const r = await run();
      log.log(`[backup] ${reason}: ${r.name} (${r.screenshots} screenshots)`);
    } catch (e) {
      log.error(`[backup] ${reason} failed:`, e.message || e);
    }
  };
  const last = lastBackupTime(dir);
  if (!last || Date.now() - new Date(last).getTime() >= intervalMs) tick('startup');
  const id = setInterval(() => tick('scheduled'), intervalMs);
  id.unref?.();
  return () => clearInterval(id);
}
