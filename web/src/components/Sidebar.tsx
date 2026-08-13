import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/trades', label: 'Trades', icon: '≣' },
  { to: '/playbook', label: 'Playbook', icon: '◎' },
  { to: '/analytics', label: 'Analytics', icon: '◔' },
  { to: '/risk', label: 'Risk', icon: '⚠' },
  { to: '/calendar', label: 'Calendar', icon: '▤' },
  { to: '/portfolio', label: 'Portfolio', icon: '⌘' },
  { to: '/replay', label: 'Replay', icon: '▶' },
  { to: '/backtest', label: 'Backtest', icon: '⟲' },
  { to: '/studio', label: 'Studio', icon: '◫' },
  { to: '/research', label: 'Signal', icon: '◉' },
  { to: '/import', label: 'Import', icon: '⤓' },
  { to: '/accounts', label: 'Accounts', icon: '◈' },
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
            color: 'var(--term-bg)',
            borderRadius: 2,
          }}
        >
          TJ
        </div>
        <div className="leading-tight">
          <div
            className="text-[11px] font-bold uppercase"
            style={{ color: 'var(--term-amber)', letterSpacing: '0.14em' }}
          >
            TRADE<span style={{ color: 'var(--term-green)' }}>▮</span>JOURNAL
          </div>
          <div
            className="text-[9px] uppercase"
            style={{ color: 'var(--term-muted)', letterSpacing: '0.1em' }}
          >
            PHASE 3
          </div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `flex items-center gap-2 border px-2.5 py-1.5 text-[11px] font-semibold uppercase transition ${
                isActive ? 'is-active' : ''
              }`
            }
            style={({ isActive }) => ({
              letterSpacing: '0.08em',
              borderRadius: 2,
              borderColor: isActive ? 'var(--term-amber)' : 'transparent',
              background: isActive ? 'var(--term-amber)' : 'transparent',
              color: isActive ? 'var(--term-bg)' : 'var(--term-text-dim)',
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
      </nav>
      <div
        className="px-4 py-3 text-[9px] uppercase border-t"
        style={{
          color: 'var(--term-muted)',
          borderColor: 'var(--term-border)',
          letterSpacing: '0.1em',
          background: 'var(--term-panel-hd)',
        }}
      >
        LOCAL · SINGLE-USER · UTC
      </div>
    </aside>
  );
}
