import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { DISPLAY_TZ } from '../utils/format';
import { setTheme, useTheme } from '../store/theme';
import { useFilters } from '../store/FilterContext';
import type { Profile } from '../api/profiles';

type Link = { to: string; label: string; icon: string; end?: boolean; match?: string };

// Today / this month on the display clock, so the Review and Month report links
// land on the trader's local day rather than UTC's.
function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ }).format(new Date());
}

function navGroups(): { heading: string; links: Link[] }[] {
  const today = localToday();
  return [
    {
      heading: 'Journal',
      links: [
        { to: '/', label: 'Dashboard', icon: '▦', end: true },
        { to: '/journal', label: 'Journal', icon: '❒' },
        { to: '/notebook', label: 'Notebook', icon: '✎' },
        { to: '/trades', label: 'Trades', icon: '≣' },
        { to: '/playbook', label: 'Playbook', icon: '◎' },
      ],
    },
    {
      heading: 'Review',
      links: [
        { to: `/review/day/${today}`, label: 'Review', icon: '✓', match: '/review/' },
        { to: `/report/month/${today.slice(0, 7)}`, label: 'Month report', icon: '▧', match: '/report/month/' },
      ],
    },
    {
      heading: 'Analyze',
      links: [
        { to: '/analytics', label: 'Analytics', icon: '◔' },
        { to: '/reports', label: 'Reports', icon: '⊞' },
        { to: '/compare', label: 'Compare', icon: '⇄' },
        { to: '/risk', label: 'Risk', icon: '⚠' },
        { to: '/portfolio', label: 'Portfolio', icon: '⌘' },
      ],
    },
    {
      heading: 'Tools',
      links: [
        { to: '/calendar', label: 'Econ Calendar', icon: '▤' },
        { to: '/replay', label: 'Replay', icon: '▶' },
        { to: '/backtest', label: 'Backtest', icon: '⟲' },
      ],
    },
    {
      heading: 'Data',
      links: [
        { to: '/import', label: 'Import', icon: '⤓' },
        { to: '/accounts', label: 'Accounts', icon: '◈' },
      ],
    },
  ];
}

export default function Sidebar() {
  const { pathname } = useLocation();
  const groups = navGroups();
  return (
    <aside
      className="flex w-52 shrink-0 flex-col border-r"
      style={{ background: 'var(--term-bg-2)', borderColor: 'var(--term-border-2)' }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{ borderColor: 'var(--term-border)', background: 'var(--term-panel-hd)' }}
      >
        <div
          className="flex h-7 w-7 items-center justify-center text-xs font-bold"
          style={{
            background: 'var(--term-amber)',
            color: 'var(--term-on-accent)',
            borderRadius: 2,
          }}
        >
          TJ
        </div>
        <div
          className="text-[12px] font-bold uppercase leading-tight"
          style={{ color: 'var(--term-amber)', letterSpacing: '0.06em' }}
        >
          TRADE<span style={{ color: 'var(--term-green)' }}>▮</span>JOURNAL
        </div>
      </div>
      <ProfileSwitcher />
      <nav className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 py-2">
        {groups.map((g) => (
          <div key={g.heading} className="flex flex-col gap-0.5">
            <div
              className="px-2 pb-1 text-[11px] font-semibold uppercase"
              style={{ color: 'var(--term-muted)', letterSpacing: '0.05em' }}
            >
              {g.heading}
            </div>
            {g.links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive: a }) =>
                  `flex items-center gap-2 border px-2.5 py-1 text-[13px] font-medium transition ${
                    a || (l.match && pathname.startsWith(l.match)) ? 'is-active' : ''
                  }`
                }
                style={({ isActive: a }) => {
                  const isActive = a || (!!l.match && pathname.startsWith(l.match));
                  return {
                  borderRadius: 2,
                  borderColor: isActive ? 'var(--term-amber)' : 'transparent',
                  background: isActive ? 'var(--term-amber)' : 'transparent',
                  color: isActive ? 'var(--term-on-accent)' : 'var(--term-text-dim)',
                  };
                }}
              >
                <span
                  className="w-4 text-center text-sm leading-none"
                  style={{ color: 'inherit' }}
                >
                  {l.icon}
                </span>
                {l.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div
        className="flex items-center justify-between gap-2 border-t px-4 py-2.5"
        style={{ borderColor: 'var(--term-border)', background: 'var(--term-panel-hd)' }}
      >
        <span className="text-[11px]" style={{ color: 'var(--term-muted)' }}>
          Local · SAST
        </span>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function Avatar({ profile, size = 22 }: { profile: Profile | null; size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center text-[11px] font-bold uppercase"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: profile ? profile.colour || 'var(--term-amber)' : 'transparent',
        border: profile ? 'none' : '1px dashed var(--term-border-2)',
        color: profile ? '#0b1411' : 'var(--term-muted)',
      }}
    >
      {profile ? profile.name.trim().charAt(0) || '?' : '∗'}
    </span>
  );
}

// Per-trader profile picker. Hidden until at least one profile exists (set up on
// the Accounts page); the choice persists in localStorage via FilterContext.
function ProfileSwitcher() {
  const { profiles, activeProfile, setProfile } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (profiles.length === 0) return null;

  const options: (Profile | null)[] = [null, ...profiles];
  return (
    <div
      ref={ref}
      className="relative border-b px-2 py-2"
      style={{ borderColor: 'var(--term-border)' }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 border px-2 py-1.5 text-left text-[13px] font-medium transition hover:brightness-110"
        style={{ borderColor: 'var(--term-border-2)', borderRadius: 2, color: 'var(--term-text)' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch profile"
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar profile={activeProfile} />
        <span className="min-w-0 flex-1 truncate">
          {activeProfile ? activeProfile.name : 'All profiles'}
        </span>
        <span aria-hidden className="text-[10px]" style={{ color: 'var(--term-muted)' }}>
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Profiles"
          className="absolute left-2 right-2 z-30 mt-1 flex flex-col border py-1 shadow-lg"
          style={{ background: 'var(--term-bg-2)', borderColor: 'var(--term-border-2)', borderRadius: 2 }}
        >
          {options.map((p) => {
            const selected = (p?.id ?? null) === (activeProfile?.id ?? null);
            return (
              <li key={p?.id ?? 'all'} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] hover:brightness-125"
                  style={{
                    color: selected ? 'var(--term-amber)' : 'var(--term-text-dim)',
                    background: selected ? 'var(--term-panel-hd)' : 'transparent',
                  }}
                  onClick={() => {
                    setProfile(p?.id ?? null);
                    setOpen(false);
                  }}
                >
                  <Avatar profile={p} size={18} />
                  <span className="min-w-0 flex-1 truncate">{p ? p.name : 'All profiles'}</span>
                  {p?.default_instrument && (
                    <span className="text-[10px]" style={{ color: 'var(--term-muted)' }}>
                      {p.default_instrument}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="flex items-center gap-1.5 border px-2 py-1 text-[11px] font-medium transition hover:brightness-110"
      style={{
        borderColor: 'var(--term-border-2)',
        color: 'var(--term-text-dim)',
        borderRadius: 2,
      }}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
    >
      <span aria-hidden className="text-sm leading-none">
        {theme === 'dark' ? '☾' : '☀'}
      </span>
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}
