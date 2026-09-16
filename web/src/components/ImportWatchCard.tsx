import { useCallback, useEffect, useState } from 'react';
import { opsApi, type ImportWatchStatus } from '../api/ops';
import { useFilters } from '../store/FilterContext';
import { Spinner } from './states';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function ImportWatchCard({ onImported }: { onImported?: () => void }) {
  const { accounts } = useFilters();
  const [st, setSt] = useState<ImportWatchStatus | null>(null);
  const [dir, setDir] = useState('');
  const [account, setAccount] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const apply = useCallback((s: ImportWatchStatus) => {
    setSt(s);
    setDir(s.dir ?? '');
    setAccount(s.account_id != null ? String(s.account_id) : '');
  }, []);

  useEffect(() => {
    opsApi.getWatch().then(apply).catch((e) => setError(e.message));
    // Refresh status while the page is open so auto-imports show up.
    const id = setInterval(() => {
      opsApi.getWatch().then(setSt).catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, [apply]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const body: { dir?: string; account_id?: number | null } = {};
      if (st?.dir_source !== 'env') body.dir = dir.trim();
      if (st?.account_source !== 'env') body.account_id = account ? Number(account) : null;
      apply(await opsApi.saveWatch(body));
      setNote('Saved');
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    setError(null);
    setNote(null);
    try {
      const r = await opsApi.scanWatch();
      setSt(r.status);
      if (r.skipped === 'disabled') setNote('Watch folder not configured');
      else if (r.skipped === 'unreadable') setNote(r.status.last_error || 'Folder unreadable');
      else setNote(r.results.length ? `Processed ${r.results.length} file(s)` : 'No new files');
      if (r.results.some((x) => x.ok && (x.inserted ?? 0) > 0)) onImported?.();
    } catch (e: any) {
      setError(e?.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const envDir = st?.dir_source === 'env';
  const envAcct = st?.account_source === 'env';

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">
            Watch folder{' '}
            {st === null ? (
              <span className="text-xs font-normal text-slate-500">…</span>
            ) : !st.enabled ? (
              <span className="text-xs font-normal text-slate-500">● off</span>
            ) : !st.dir_exists || st.last_error ? (
              <span className="text-xs font-normal text-red-400">● folder unreachable</span>
            ) : (
              <span className="text-xs font-normal text-emerald-400">
                ● watching every {st.interval_sec}s
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Drop MT5 / Match-Trader reports into a folder and they import automatically
            (same dedupe as upload), then move to <span className="num">processed/</span>{' '}
            or <span className="num">failed/</span> with a <span className="num">.log</span>.
            {st?.last_scan && <> Last scan {fmtTime(st.last_scan)}.</>}
          </p>
        </div>
        <button className="btn" onClick={scan} disabled={scanning || !st?.enabled}>
          {scanning ? (
            <>
              <Spinner className="h-4 w-4" /> Scanning…
            </>
          ) : (
            'Scan now'
          )}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <label className="label" htmlFor="watch-dir">
            Folder (absolute path){envDir && ' — set by IMPORT_WATCH_DIR'}
          </label>
          <input
            id="watch-dir"
            className="input num w-full"
            placeholder="C:\Users\you\Documents\MT5 Reports"
            value={dir}
            disabled={envDir}
            onChange={(e) => setDir(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="watch-account">
            Default account{envAcct && ' (env)'}
          </label>
          <select
            id="watch-account"
            className="input w-48"
            value={account}
            disabled={envAcct}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">First account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.id} {a.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving || (envDir && envAcct)}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <p className="text-xs text-slate-600">
        Name a file <span className="num">acc&lt;id&gt;_…</span> (e.g.{' '}
        <span className="num">acc3_ReportHistory.html</span>) to route it to that account.
        Env vars <span className="num">IMPORT_WATCH_DIR</span> /{' '}
        <span className="num">IMPORT_WATCH_ACCOUNT</span> override these settings. Leave the
        folder empty to turn watching off. Under Docker the folder must be mounted into the
        server container.
      </p>

      {note && <p className="text-sm text-slate-400">{note}</p>}
      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {st?.last_error && <p className="text-xs text-red-400">{st.last_error}</p>}

      {st && st.recent.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {st.recent.slice(0, 8).map((r) => (
            <li
              key={`${r.at}-${r.file}`}
              className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-800/60 pb-1 last:border-0"
            >
              <span className={r.ok ? 'text-emerald-400' : 'text-red-400'}>{r.ok ? '✓' : '✗'}</span>
              <span className="num text-slate-300">{r.file}</span>
              <span className="text-slate-500">{fmtTime(r.at)}</span>
              {r.ok ? (
                <span className="text-slate-400">
                  +{r.inserted} new, {r.skipped} dupes → #{r.account_id}
                </span>
              ) : (
                <span className="text-red-300">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
