import { NavLink } from 'react-router-dom';
import { setTheme, useTheme } from '../store/theme';

type Link = { to: string; label: string; icon: string; end?: boolean };

const groups: { heading: string; links: Link[] }[] = [
  {
    heading: 'Journal',
    links: [
      { to: '/', label: 'Dashboard', icon: '▦', end: true },
      { to: '/journal', label: 'Journal', icon: '❒' },
      { to: '/trades', label: 'Trades', icon: '≣' },
      { to: '/playbook', label: 'Playbook', icon: '◎' },
      { to: '/analytics', label: 'Analytics', icon: '◔' },
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

export default function Sidebar() {
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
      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-2 py-2">
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
                className={({ isActive }) =>
                  `flex items-center gap-2 border px-2.5 py-1.5 text-[13px] font-medium transition ${
                    isActive ? 'is-active' : ''
                  }`
                }
                style={({ isActive }) => ({
                  borderRadius: 2,
                  borderColor: isActive ? 'var(--term-amber)' : 'transparent',
                  background: isActive ? 'var(--term-amber)' : 'transparent',
                  color: isActive ? 'var(--term-on-accent)' : 'var(--term-text-dim)',
                })}
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
