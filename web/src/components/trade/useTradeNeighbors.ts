import { useMemo } from 'react';
import { api } from '../../api/client';
import { useApi, filterKey } from '../../hooks/useApi';
import { useFilters } from '../../store/FilterContext';
import { loadTradesQuery } from '../../utils/tradeNav';
import type { Filters } from '../../types';

// Plenty for a personal journal; the list endpoint has no cap.
const MAX_IDS = 5000;

export interface TradeNeighbors {
  prevId: number | null;
  nextId: number | null;
  /** 1-based position in the sequence, with its length. */
  position: number | null;
  total: number;
  /** 'list' = the Trades page's filters + sort; 'account' = chronological in
   *  the trade's account (the trade isn't in the filtered list). */
  mode: 'list' | 'account' | null;
}

/** Previous / next trade for detail-page stepping. Follows the Trades list
 *  (global filters + the list's own search/sort) when the trade is in it,
 *  otherwise walks the trade's account by entry time. Both id lists are keyed
 *  on their inputs, so stepping between trades doesn't refetch. */
export function useTradeNeighbors(
  tradeId: number,
  accountId: number | null | undefined
): TradeNeighbors {
  const { filters } = useFilters();
  const query = loadTradesQuery();
  const queryKey = JSON.stringify(query);

  const list = useApi(
    async () =>
      query
        ? (await api.getTrades(filters, MAX_IDS, 0, query)).rows.map((r) => r.id)
        : null,
    [filterKey(filters), queryKey]
  );

  const account = useApi(async () => {
    if (accountId == null) return null;
    const f: Filters = {
      account: accountId,
      instrument: 'All',
      session: 'All',
      setup: 'All',
      from: '',
      to: '',
      rMin: '',
      rMax: '',
    };
    const res = await api.getTrades(f, MAX_IDS, 0, { sort: 'entry_time', dir: 'asc' });
    return res.rows.map((r) => r.id);
  }, [accountId]);

  return useMemo(() => {
    const pick = (ids: number[] | null, mode: 'list' | 'account'): TradeNeighbors | null => {
      const i = ids ? ids.indexOf(tradeId) : -1;
      if (!ids || i < 0) return null;
      return {
        prevId: i > 0 ? ids[i - 1] : null,
        nextId: i < ids.length - 1 ? ids[i + 1] : null,
        position: i + 1,
        total: ids.length,
        mode,
      };
    };
    return (
      pick(list.data, 'list') ??
      pick(account.data, 'account') ?? {
        prevId: null,
        nextId: null,
        position: null,
        total: 0,
        mode: null,
      }
    );
  }, [list.data, account.data, tradeId]);
}
