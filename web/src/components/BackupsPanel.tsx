import { useCallback, useEffect, useState } from 'react';
import { opsApi, type BackupsResponse } from '../api/ops';
import { Spinner } from './states';

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ago(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(0, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function BackupsPanel() {
  const [data, setData] = useState<BackupsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    opsApi
      .listBackups()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const backupNow = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const r = await opsApi.backupNow();
      setMsg(
        `Saved ${r.name} (${fmtSize(r.size)}, ${r.screenshots} screenshot${r.screenshots === 1 ? '' : 's'}` +
          (r.missing_screenshots ? `, ${r.missing_screenshots} missing` : '') +
          ')'
      );
      load();
    } catch (e: any) {
      setError(e?.message || 'Backup failed');
    } finally {
      setBusy(false);
    }
  };

  const stale = data?.last_backup
    ? Date.now() - new Date(data.last_backup).getTime() > 48 * 3_600_000
    : true;

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Backups</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Last backup:{' '}
            {data ? (
              data.last_backup ? (
                <span className={stale ? 'text-amber-400' : 'text-emerald-400'}>
                  {fmtTime(data.last_backup)} ({ago(data.last_backup)})
                </span>
              ) : (
                <span className="text-amber-400">never</span>
              )
            ) : (
              '…'
            )}
            {data && (
              <>
                {' '}
                · {data.auto ? 'daily auto-backup on' : 'auto-backup off'} · keeps last{' '}
                {data.keep}
              </>
            )}
          </p>
          {data && (
            <p className="mt-0.5 break-all text-xs text-slate-600">
              <span className="num">{data.dir}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className="btn" href={opsApi.exportAllUrl} download>
            Export all (JSON)
          </a>
          <button className="btn btn-primary" onClick={backupNow} disabled={busy}>
            {busy ? (
              <>
                <Spinner className="h-4 w-4" /> Backing up…
              </>
            ) : (
              'Backup now'
            )}
          </button>
        </div>
      </div>

      {msg && <p className="text-sm text-emerald-400">{msg}</p>}
      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {data && data.backups.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">Backup</th>
                <th className="py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-3 text-right font-medium">Size</th>
                <th className="py-2 pr-3 text-right font-medium">Screenshots</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {data.backups.map((b) => (
                <tr key={b.name} className="border-b border-slate-800/60 last:border-0">
                  <td className="num py-2 pr-3 text-slate-300">{b.name}</td>
                  <td className="py-2 pr-3 text-slate-400">{fmtTime(b.time)}</td>
                  <td className="num py-2 pr-3 text-right text-slate-400">{fmtSize(b.size)}</td>
                  <td className="num py-2 pr-3 text-right text-slate-400">{b.screenshots}</td>
                  <td className="py-2 text-right">
                    <a
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                      href={opsApi.backupDownloadUrl(b.name)}
                      download
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.backups.length === 0 && (
        <p className="text-sm text-slate-500">No backups yet.</p>
      )}
      <p className="text-xs text-slate-600">
        Restore is manual: stop the server, replace the journal database with a backup
        file and copy its screenshots folder back. See README → Backups &amp; restore.
      </p>
    </div>
  );
}
