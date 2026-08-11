import { useMemo } from 'react';
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
      onClose={onClose}
    />
  );
}
