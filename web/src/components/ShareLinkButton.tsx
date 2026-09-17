import { useEffect, useRef, useState } from 'react';
import { shareApi, type ShareKind, type ShareLink } from '../api/profiles';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a read-only share link for one trade, day or week. Opens a small
 * popover (include notes? expiry?) and shows the resulting URL with a copy
 * button. Mount it wherever a trade/day/week is shown:
 *   <ShareLinkButton kind="trade" refId={trade.id} />
 *   <ShareLinkButton kind="day" refId="2026-09-17" accountId={account} />
 *   <ShareLinkButton kind="week" refId={date} accountId={account} />
 */
export default function ShareLinkButton({
  kind,
  refId,
  accountId,
  label = 'Share link',
  className = 'btn px-2 py-1 text-[11px]',
  onCreated,
}: {
  kind: ShareKind;
  refId: string | number;
  /** required for day / week links */
  accountId?: number | null;
  label?: string;
  className?: string;
  onCreated?: (link: ShareLink) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const needsAccount = kind !== 'trade';
  const disabled = needsAccount && accountId == null;

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const created = await shareApi.create({
        kind,
        ref: refId,
        account_id: accountId ?? null,
        include_notes: notes,
        expires_in_days: expiry ? Number(expiry) : null,
      });
      setLink(created);
      onCreated?.(created);
      if (await copyText(shareApi.urlFor(created.token))) setCopied(true);
    } catch (e: any) {
      setErr(e?.message || 'Could not create link');
    } finally {
      setBusy(false);
    }
  };

  const url = link ? shareApi.urlFor(link.token) : '';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        className={className}
        disabled={disabled}
        title={disabled ? 'Pick a single account to share a day or week' : 'Create a read-only link'}
        onClick={() => {
          setOpen((o) => !o);
          setLink(null);
          setCopied(false);
          setErr(null);
        }}
      >
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Create share link"
          className="absolute right-0 z-40 mt-1 flex w-72 flex-col gap-2 border p-3 text-[12px] shadow-lg"
          style={{ background: 'var(--term-bg-2)', borderColor: 'var(--term-border-2)', borderRadius: 2 }}
        >
          {!link ? (
            <>
              <div className="font-semibold" style={{ color: 'var(--term-text-hi)' }}>
                Read-only {kind} link
              </div>
              <label className="flex items-center gap-2" style={{ color: 'var(--term-text-dim)' }}>
                <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
                Include notes / recap
              </label>
              <label className="flex items-center gap-2" style={{ color: 'var(--term-text-dim)' }}>
                Expires
                <select className="input flex-1" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                  <option value="">Never</option>
                  <option value="1">in 1 day</option>
                  <option value="7">in 7 days</option>
                  <option value="30">in 30 days</option>
                </select>
              </label>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>
                {busy ? 'Creating…' : 'Create link'}
              </button>
              {err && <p className="text-red-400">{err}</p>}
            </>
          ) : (
            <>
              <div className="font-semibold" style={{ color: 'var(--term-text-hi)' }}>
                Link {copied ? 'copied' : 'ready'}
              </div>
              <input className="input w-full font-mono text-[11px]" readOnly value={url} onFocus={(e) => e.target.select()} />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn flex-1"
                  onClick={async () => setCopied(await copyText(url))}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <a className="btn flex-1 text-center" href={url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
              <p style={{ color: 'var(--term-muted)' }}>
                Only reachable by others if this app is exposed on your network. Revoke on the
                Accounts page.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
