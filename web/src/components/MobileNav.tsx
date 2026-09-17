import { NavLink, matchPath, useLocation } from 'react-router-dom';
import { useFilters } from '../store/FilterContext';
import { Avatar, localToday, navGroups } from './Sidebar';

// Mobile chrome (below md): a slim top bar with the menu button, page title and
// profile avatar, and a bottom tab bar for the capture loop. Both are md:hidden,
// so the desktop shell is untouched.

const EXTRA_TITLES: [string, string][] = [
  ['/trades/:id', 'Trade'],
  ['/report/week/:date', 'Week report'],
  ['/research', 'Research'],
];

export function pageTitle(pathname: string): string {
  for (const [path, title] of EXTRA_TITLES) {
    if (matchPath({ path, end: true }, pathname)) return title;
  }
  for (const g of navGroups()) {
    for (const l of g.links) {
      if (l.match ? pathname.startsWith(l.match) : pathname === l.to) return l.label;
    }
  }
  return 'Trade Journal';
}

export function MobileTopBar({
  title,
  onMenu,
  menuOpen,
}: {
  title: string;
  onMenu: () => void;
  menuOpen: boolean;
}) {
  const { activeProfile, profiles } = useFilters();
  return (
    <header
      className="tj-mobile-chrome sticky top-0 z-30 flex items-center gap-2 border-b px-1.5 md:hidden"
      style={{
        background: 'var(--term-panel-hd)',
        borderColor: 'var(--term-border-2)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'max(0.375rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.375rem, env(safe-area-inset-right))',
      }}
    >
      <button
        type="button"
        onClick={onMenu}
        className="flex h-11 w-11 items-center justify-center text-xl"
        style={{ color: 'var(--term-text)' }}
        aria-label="Open navigation"
        aria-expanded={menuOpen}
        aria-controls="nav-drawer"
      >
        ☰
      </button>
      <h1
        className="min-w-0 flex-1 truncate text-[15px] font-semibold"
        style={{ color: 'var(--term-text-hi)' }}
      >
        {title}
      </h1>
      {profiles.length > 0 && (
        <button
          type="button"
          onClick={onMenu}
          className="flex h-11 w-11 items-center justify-center"
          aria-label={`Profile: ${activeProfile ? activeProfile.name : 'All profiles'} (switch in menu)`}
          title={activeProfile ? activeProfile.name : 'All profiles'}
        >
          <Avatar profile={activeProfile} size={28} />
        </button>
      )}
    </header>
  );
}

type Tab = { to: string; label: string; icon: string; end?: boolean; match?: string; primary?: boolean };

export function BottomTabBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { pathname } = useLocation();
  const today = localToday();
  const tabs: Tab[] = [
    { to: '/', label: 'Home', icon: '▦', end: true },
    { to: '/journal', label: 'Journal', icon: '❒' },
    { to: '/quick', label: 'Capture', icon: '+', primary: true },
    { to: '/trades', label: 'Trades', icon: '≣' },
    { to: `/review/day/${today}`, label: 'Review', icon: '✓', match: '/review/' },
  ];
  return (
    <nav
      aria-label="Primary"
      className="tj-mobile-chrome fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t md:hidden"
      style={{
        background: 'var(--term-panel-hd)',
        borderColor: 'var(--term-border-2)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {tabs.map((t) => {
        const on = t.match ? pathname.startsWith(t.match) : undefined;
        return (
          <NavLink
            key={t.label}
            to={t.to}
            end={t.end}
            aria-label={t.label === 'Capture' ? 'Quick capture' : undefined}
            className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium"
            style={({ isActive }) => {
              const active = on ?? isActive;
              return { color: active ? 'var(--term-amber)' : 'var(--term-text-dim)' };
            }}
          >
            {({ isActive }) =>
              t.primary ? (
                <span
                  className="flex h-10 w-10 items-center justify-center text-2xl font-bold leading-none"
                  style={{
                    borderRadius: 999,
                    background: 'var(--term-amber)',
                    color: 'var(--term-on-accent)',
                    outline: (on ?? isActive) ? '2px solid var(--term-text-hi)' : undefined,
                    outlineOffset: 2,
                  }}
                  aria-hidden
                >
                  +
                </span>
              ) : (
                <>
                  <span aria-hidden className="text-lg leading-none">
                    {t.icon}
                  </span>
                  <span>{t.label}</span>
                </>
              )
            }
          </NavLink>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-expanded={moreOpen}
        aria-controls="nav-drawer"
        className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium"
        style={{ color: moreOpen ? 'var(--term-amber)' : 'var(--term-text-dim)' }}
      >
        <span aria-hidden className="text-lg leading-none">
          ☰
        </span>
        <span>More</span>
      </button>
    </nav>
  );
}
