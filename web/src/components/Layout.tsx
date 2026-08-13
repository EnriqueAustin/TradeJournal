import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import FilterBar from './FilterBar';

export default function Layout() {
  return (
    <div
      className="flex h-full min-h-screen"
      style={{ background: 'var(--term-bg)' }}
    >
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <FilterBar />
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
