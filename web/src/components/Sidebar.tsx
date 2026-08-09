import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/trades', label: 'Trades', icon: '≣' },
  { to: '/playbook', label: 'Playbook', icon: '◎' },
  { to: '/analytics', label: 'Analytics', icon: '◔' },
  { to: '/risk', label: 'Risk', icon: '⚠' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/portfolio', label: 'Portfolio', icon: '⌘' },
  { to: '/replay', label: 'Replay', icon: '▶' },
  { to: '/backtest', label: 'Backtest', icon: '⟲' },
  { to: '/import', label: 'Import', icon: '⤓' },
  { to: '/accounts', label: 'Accounts', icon: '◈' },
];

export default function Sidebar() {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">
          TJ
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-slate-100">Trade Journal</div>
          <div className="text-[11px] text-slate-500">Phase 3</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`
            }
          >
            <span className="w-4 text-center text-base leading-none">{l.icon}</span>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-4 text-[11px] text-slate-600">
        Local single-user · UTC
      </div>
    </aside>
  );
}
