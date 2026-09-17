import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { FilterProvider } from './store/FilterContext';
import SharePublic from './pages/SharePublic';
import Dashboard from './pages/Dashboard';
import Trades from './pages/Trades';
import TradeDetail from './pages/TradeDetail';
import Import from './pages/Import';
import Accounts from './pages/Accounts';
import Playbook from './pages/Playbook';
import Analytics from './pages/Analytics';
import Risk from './pages/Risk';
import Replay from './pages/Replay';
import BacktestHub from './pages/BacktestHub';
import Portfolio from './pages/Portfolio';
import CalendarPage from './pages/Calendar';
import Journal from './pages/Journal';
import WeekReport from './pages/WeekReport';
import Signal from './features/signal/pages/Signal';

export default function App() {
  return (
    <Routes>
      {/* Public read-only share page: outside Layout (no sidebar / filter bar)
          and outside FilterProvider, so it never loads accounts or profiles. */}
      <Route path="s/:token" element={<SharePublic />} />
      <Route
        element={
          <FilterProvider>
            <Layout />
          </FilterProvider>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="journal" element={<Journal />} />
        <Route path="report/week/:date" element={<WeekReport />} />
        <Route path="trades" element={<Trades />} />
        <Route path="trades/:id" element={<TradeDetail />} />
        <Route path="playbook" element={<Playbook />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="risk" element={<Risk />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="replay" element={<Replay />} />
        <Route path="backtest" element={<BacktestHub />} />
        <Route path="studio" element={<Navigate to="/backtest" replace />} />
        {/* Signal is parked: route kept, hidden from the sidebar and palette. */}
        <Route path="research" element={<Signal />} />
        <Route path="import" element={<Import />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
