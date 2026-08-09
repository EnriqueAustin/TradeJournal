import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Trades from './pages/Trades';
import TradeDetail from './pages/TradeDetail';
import Import from './pages/Import';
import Accounts from './pages/Accounts';
import Playbook from './pages/Playbook';
import Analytics from './pages/Analytics';
import Risk from './pages/Risk';
import Replay from './pages/Replay';
import Backtest from './pages/Backtest';
import Portfolio from './pages/Portfolio';
import CalendarPage from './pages/Calendar';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="trades" element={<Trades />} />
        <Route path="trades/:id" element={<TradeDetail />} />
        <Route path="playbook" element={<Playbook />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="risk" element={<Risk />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="replay" element={<Replay />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="import" element={<Import />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
