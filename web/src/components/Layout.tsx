import { Outlet, matchPath, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import FilterBar from './FilterBar';
import CommandPalette from './CommandPalette';

// Report/list pages get the full filter bar; account-scoped pages only the
// account picker; everything else (trade detail, import, accounts, econ
// calendar) none — the filters do nothing there.
const FULL_FILTERS = ['/', '/trades', '/analytics', '/risk', '/playbook', '/portfolio'];
const ACCOUNT_ONLY = ['/journal', '/report/week/:date', '/replay', '/backtest'];

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
  return (
    <div
      className="flex h-full min-h-screen"
      style={{ background: 'var(--term-bg)' }}
    >
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {variant && <FilterBar variant={variant} />}
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-4">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
