import { useEffect, useRef, useState } from 'react';
import { Outlet, matchPath, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import FilterBar from './FilterBar';
import CommandPalette from './CommandPalette';
import { MobileTopBar, BottomTabBar, pageTitle } from './MobileNav';

// Report/list pages get the full filter bar; account-scoped pages only the
// account picker; everything else (trade detail, import, accounts, econ
// calendar) none — the filters do nothing there.
const FULL_FILTERS = ['/', '/trades', '/analytics', '/risk', '/playbook', '/portfolio', '/reports'];
const ACCOUNT_ONLY = ['/journal', '/report/week/:date', '/replay', '/backtest', '/quick'];

function filterVariant(pathname: string): 'full' | 'account' | null {
  const hit = (paths: string[]) =>
    paths.some((path) => matchPath({ path, end: true }, pathname));
  if (hit(FULL_FILTERS)) return 'full';
  if (hit(ACCOUNT_ONLY)) return 'account';
  return null;
}

export default function Layout() {
  const { pathname } = useLocation();
  const variant = filterVariant(pathname);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The drawer closes on any navigation (link tap inside it, bottom bar, back),
  // and a new page starts at the top — main is the scroll container and
  // outlives route changes, so it would otherwise keep the old offset.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setDrawerOpen(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Esc closes it; the page behind doesn't scroll while it's open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  const title = pageTitle(pathname);

  return (
    <div
      className="tj-shell flex h-full min-h-screen"
      style={{ background: 'var(--term-bg)' }}
    >
      <Sidebar className="hidden md:flex" />

      {/* Off-canvas navigation drawer (below md only) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="tj-drawer-in relative h-full">
            <Sidebar drawer />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar title={title} onMenu={() => setDrawerOpen(true)} menuOpen={drawerOpen} />
        {variant && <FilterBar variant={variant} />}
        <main ref={mainRef} className="tj-main min-w-0 flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4">
          <Outlet />
        </main>
      </div>
      <BottomTabBar onMore={() => setDrawerOpen(true)} moreOpen={drawerOpen} />
      <CommandPalette />
    </div>
  );
}
