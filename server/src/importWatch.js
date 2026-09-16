// Watch-folder auto-import.
//
// Polls a directory (fs.watch is unreliable on Windows and on bind mounts) for
// MT5 / Match-Trader report files, hands each to the same import pipeline as
// POST /api/import, then moves it to `processed/` — or to `failed/` alongside a
// `<file>.log` with the error. The import function and config are injected so
// this module stays free of the db singleton and is unit-testable.
import fs from 'node:fs';
import path from 'node:path';

export const WATCH_EXTS = new Set(['.csv', '.htm', '.html', '.xlsx', '.xml']);

// Filename convention for routing to an account: a leading `acc<id>` token,
// e.g. `acc3_ReportHistory.html` or `acc3-closed.csv` → account 3.
export function accountFromFilename(name) {
  const m = /^acc(\d+)(?:[_\-. ]|$)/i.exec(String(name || ''));
  return m ? Number(m[1]) : null;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');

// Move a file into `destDir`, avoiding clobbering an earlier file of the same
// name (prefix a timestamp). Falls back to copy+unlink across devices.
function moveInto(file, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  let dest = path.join(destDir, path.basename(file));
  if (fs.existsSync(dest)) dest = path.join(destDir, `${stamp()}_${path.basename(file)}`);
  try {
    fs.renameSync(file, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(file, dest);
    fs.unlinkSync(file);
  }
  return dest;
}

/**
 * @param {object} o
 * @param {() => {dir: string|null, accountId: number|null}} o.getConfig
 * @param {(buffer: Buffer, opts: {filename: string, accountId: number|null}) => Promise<object>} o.importFile
 * @param {number} [o.intervalMs]  poll interval
 * @param {number} [o.settleMs]    skip files modified more recently than this (still being written)
 */
export function createImportWatcher({
  getConfig,
  importFile,
  intervalMs = 30_000,
  settleMs = 5_000,
  maxRecent = 25,
  log = console,
}) {
  const state = { lastScan: null, lastError: null, scanning: false, recent: [] };
  let timer = null;

  const record = (entry) => {
    state.recent.unshift(entry);
    if (state.recent.length > maxRecent) state.recent.length = maxRecent;
  };

  async function scanOnce() {
    if (state.scanning) return { skipped: 'busy', results: [] };
    const { dir, accountId } = getConfig();
    if (!dir) return { skipped: 'disabled', results: [] };
    state.scanning = true;
    const results = [];
    try {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
        state.lastError = null;
      } catch (e) {
        state.lastError = `cannot read ${dir}: ${e.message}`;
        return { skipped: 'unreadable', results };
      }
      const now = Date.now();
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const name = ent.name;
        if (name.startsWith('.') || name.startsWith('~$')) continue; // temp/lock files
        if (!WATCH_EXTS.has(path.extname(name).toLowerCase())) continue;
        const file = path.join(dir, name);
        let st;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        if (now - st.mtimeMs < settleMs) continue; // still being written; next scan

        const target = accountFromFilename(name) ?? accountId ?? null;
        const at = new Date().toISOString();
        try {
          const buffer = fs.readFileSync(file);
          const r = await importFile(buffer, { filename: name, accountId: target });
          const moved = moveInto(file, path.join(dir, 'processed'));
          const entry = {
            file: name,
            ok: true,
            at,
            account_id: r?.account_id ?? target,
            inserted: r?.inserted ?? 0,
            skipped: r?.skipped ?? 0,
            moved_to: path.relative(dir, moved),
          };
          record(entry);
          results.push(entry);
          log.log?.(`[watch] imported ${name}: +${entry.inserted} (${entry.skipped} dupes)`);
        } catch (e) {
          const error = String(e?.message || e);
          let movedTo = null;
          try {
            const moved = moveInto(file, path.join(dir, 'failed'));
            movedTo = path.relative(dir, moved);
            fs.writeFileSync(
              `${moved}.log`,
              `${at}\nfile: ${name}\naccount: ${target ?? '(default)'}\nerror: ${error}\n${e?.stack || ''}\n`
            );
          } catch {
            /* leave it; it'll be retried next scan */
          }
          const entry = { file: name, ok: false, at, account_id: target, error, moved_to: movedTo };
          record(entry);
          results.push(entry);
          log.error?.(`[watch] failed ${name}: ${error}`);
        }
      }
      return { results };
    } finally {
      state.lastScan = new Date().toISOString();
      state.scanning = false;
    }
  }

  return {
    scanOnce,
    start() {
      if (timer) return;
      const run = () => scanOnce().catch((e) => log.error?.('[watch] scan error:', e.message));
      run();
      timer = setInterval(run, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    status() {
      return {
        running: !!timer,
        interval_sec: Math.round(intervalMs / 1000),
        last_scan: state.lastScan,
        last_error: state.lastError,
        scanning: state.scanning,
        recent: state.recent,
      };
    },
  };
}
