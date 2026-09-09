import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFilters } from '../store/FilterContext';
import TradesDrilldownModal from './TradesDrilldownModal';
import { formatDate } from '../utils/format';

export interface DayTradesModalProps {
  day: string; // YYYY-MM-DD
  currency?: string;
  onClose: () => void;
}

export default function DayTradesModal({
  day,
  currency = 'USD',
  onClose,
}: DayTradesModalProps) {
  const { filters } = useFilters();

  // Every trade realized on this day (from/to filter on the exit date).
  const dayFilters = useMemo(
    () => ({ ...filters, from: day, to: day }),
    [filters, day]
  );

  return (
    <TradesDrilldownModal
      title={formatDate(`${day}T12:00:00Z`)}
      filters={dayFilters}
      currency={currency}
      headerAction={
        <Link
          to={`/journal?day=${day}`}
          onClick={onClose}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-cyan-400 hover:bg-slate-800"
        >
          Open in Journal →
        </Link>
      }
      onClose={onClose}
    />
  );
}
