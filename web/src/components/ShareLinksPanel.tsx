import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useFilters } from '../store/FilterContext';
import { shareApi, type ShareKind } from '../api/profiles';
import { formatDateTime } from '../utils/format';
import ShareLinkButton, { copyText } from './ShareLinkButton';

const STATUS_COLOUR: Record<string, string> = {
  active: 'var(--term-green)',
  expired: 'var(--term-muted)',
  revoked: 'var(--term-red)',
};

/** Create, list, copy and revoke read-only share links. */
export default function ShareLinksPanel() {
  const { allAccounts, filters } = useFilters();
  const { data, loading, error, reload } = useApi(() => shareApi.list(), []);
  const [kind, setKind] = useState<ShareKind>('day');
  const [tradeId, setTradeId] = useState('');
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [account, setAccount] = useState<number | null>(filters.account ?? null);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const acct = account ?? allAccounts[0]?.id ?? null;
  const refId = kind === 'trade' ? tradeId.trim() : day;
  const ready = kind === 'trade' ? /^\d+$/.test(refId) : !!day && acct != null;

  const revoke = async (token: string) => {
    if (!confirm('Revoke this link? Anyone holding it loses access.')) return;
    setErr(null);
    try {
      await shareApi.revoke(token);
      reload();
    } catch (e: any) {
      setErr(e?.message || 'Revoke failed');
    }
  };

  const copy = async (token: string) => {
    if (await copyText(shareApi.urlFor(token))) {
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    }
  };

  return (
    <div className="card flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--term-border)' }}>
        <h2 className="text-sm font-semibold text-slate-200">Share links</h2>
        <span className="text-xs" style={{ color: 'var(--term-muted)' }}>
          Read-only views of a trade, day or week. Only reachable by others if this app is exposed on
          your network.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--term-border)' }}>
        <select className="input" aria-label="Share kind" value={kind} onChange={(e) => setKind(e.target.value as ShareKind)}>
          <option value="trade">Trade</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
        </select>
        {kind === 'trade' ? (
          <input
            className="input w-28"
            inputMode="numeric"
            placeholder="Trade #"
            aria-label="Trade id"
            value={tradeId}
            onChange={(e) => setTradeId(e.target.value)}
          />
        ) : (
          <>
            <input type="date" className="input" aria-label={kind === 'day' ? 'Day' : 'Any day in week'} value={day} onChange={(e) => setDay(e.target.value)} />
            <select
              className="input"
              aria-label="Account"
              value={acct ?? ''}
              onChange={(e) => setAccount(e.target.value ? Number(e.target.value) : null)}
            >
              {allAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </>
        )}
        {ready ? (
          <ShareLinkButton
            key={`${kind}:${refId}:${acct}`}
            kind={kind}
            refId={refId}
            accountId={kind === 'trade' ? null : acct}
            className="btn btn-primary"
            onCreated={reload}
          />
        ) : (
          <button type="button" className="btn btn-primary" disabled>
            Share link
          </button>
        )}
      </div>

      {loading && !data ? (
        <p className="px-4 py-4 text-xs" style={{ color: 'var(--term-muted)' }}>Loading links…</p>
      ) : error ? (
        <p className="px-4 py-4 text-xs text-red-400">{error}</p>
      ) : !data || data.length === 0 ? (
        <p className="px-4 py-4 text-xs" style={{ color: 'var(--term-muted)' }}>No share links yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-medium">Shared</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Notes</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Expires</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.token} className="border-b border-slate-800/60">
                  <td className="px-4 py-2 text-slate-200">
                    <span className="mr-1.5 text-[10px] uppercase text-slate-500">{l.kind}</span>
                    {l.label}
                  </td>
                  <td className="px-4 py-2 text-slate-400">{l.account_name ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-400">{l.include_notes ? 'Yes' : 'No'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDateTime(l.created_at)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">{l.expires_at ? formatDateTime(l.expires_at) : 'Never'}</td>
                  <td className="px-4 py-2 text-xs font-semibold uppercase" style={{ color: STATUS_COLOUR[l.status] }}>
                    {l.status}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {l.status === 'active' ? (
                      <div className="flex justify-end gap-3 text-xs">
                        <button type="button" className="text-slate-400 hover:text-cyan-300" onClick={() => copy(l.token)}>
                          {copied === l.token ? 'Copied' : 'Copy'}
                        </button>
                        <a className="text-slate-400 hover:text-cyan-300" href={shareApi.urlFor(l.token)} target="_blank" rel="noreferrer">
                          Open
                        </a>
                        <button type="button" className="text-slate-500 hover:text-red-400" onClick={() => revoke(l.token)}>
                          Revoke
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <p className="px-4 py-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}
