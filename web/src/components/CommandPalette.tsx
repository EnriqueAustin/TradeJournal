import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Every jump-to destination. Mirrors the sidebar groups plus the Signal views
// (the Signal section is chosen via the ?section= query the page reads on load).
interface Command {
  label: string;
  group: string;
  to: string;
  keywords?: string;
}

const COMMANDS: Command[] = [
  { label: 'Dashboard', group: 'Journal', to: '/' },
  { label: 'Trades', group: 'Journal', to: '/trades' },
  { label: 'Playbook', group: 'Journal', to: '/playbook' },
  { label: 'Analytics', group: 'Journal', to: '/analytics' },
  { label: 'Risk', group: 'Journal', to: '/risk' },
  { label: 'Signal Terminal', group: 'Research', to: '/research', keywords: 'gold xauusd research' },
  { label: 'Calendar', group: 'Research', to: '/calendar' },
  { label: 'Portfolio', group: 'Research', to: '/portfolio' },
  { label: 'Replay', group: 'Simulate', to: '/replay' },
  { label: 'Backtest', group: 'Simulate', to: '/backtest' },
  { label: 'Studio', group: 'Simulate', to: '/studio' },
  { label: 'Import', group: 'Data', to: '/import' },
  { label: 'Accounts', group: 'Data', to: '/accounts' },
];

export default function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl/Cmd-K toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus after the overlay paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) =>
      `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    if (active >= results.length) setActive(0);
  }, [results, active]);

  if (!open) return null;

  const go = (c?: Command) => {
    const target = c ?? results[active];
    if (!target) return;
    setOpen(false);
    navigate(target.to);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', paddingTop: '12vh' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden border shadow-xl"
        style={{
          background: 'var(--term-bg-2)',
          borderColor: 'var(--term-border-2)',
          borderRadius: 4,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Jump to…  (↑↓ to move, ↵ to open, esc to close)"
          className="w-full bg-transparent px-4 py-3 text-sm outline-none"
          style={{ color: 'var(--term-text)', borderBottom: '1px solid var(--term-border)' }}
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--term-muted)' }}>
              No matches.
            </div>
          )}
          {results.map((c, i) => (
            <button
              key={c.to}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(c)}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-[13px]"
              style={{
                background: i === active ? 'var(--term-amber)' : 'transparent',
                color: i === active ? 'var(--term-bg)' : 'var(--term-text-dim)',
              }}
            >
              <span className="font-semibold">{c.label}</span>
              <span
                className="text-[10px] uppercase tracking-wide"
                style={{ color: i === active ? 'var(--term-bg)' : 'var(--term-muted)' }}
              >
                {c.group}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
