import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Account, Filters, Setup } from '../types';
import { api } from '../api/client';

interface FilterContextValue {
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  accounts: Account[];
  accountsLoading: boolean;
  accountsError: string | null;
  refreshAccounts: () => void;
  setups: Setup[];
  refreshSetups: () => void;
}

const defaultFilters: Filters = {
  account: null,
  instrument: 'All',
  session: 'All',
  setup: 'All',
  from: '',
  to: '',
};

const FilterContext = createContext<FilterContextValue | undefined>(undefined);
const ACCOUNT_STORAGE_KEY = 'trade-journal:selected-account';

function getStoredAccount(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFiltersState] = useState<Filters>(() => ({
    ...defaultFilters,
    account: getStoredAccount(),
  }));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [setups, setSetups] = useState<Setup[]>([]);
  const [setupsKey, setSetupsKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAccountsLoading(true);
    setAccountsError(null);
    api
      .getAccounts()
      .then((data) => {
        if (cancelled) return;
        setAccounts(data);
        // Keep the selected account valid when accounts are added or deleted.
        setFiltersState((f) =>
          f.account == null || !data.some((a) => a.id === f.account)
            ? { ...f, account: data[0]?.id ?? null }
            : f
        );
      })
      .catch((e) => {
        if (!cancelled) setAccountsError(e.message || 'Failed to load accounts');
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (filters.account == null) {
      window.localStorage.removeItem(ACCOUNT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, String(filters.account));
  }, [filters.account]);

  useEffect(() => {
    let cancelled = false;
    api
      .getSetups()
      .then((data) => {
        if (!cancelled) setSetups(data);
      })
      .catch(() => {
        if (!cancelled) setSetups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [setupsKey]);

  const setFilters = (patch: Partial<Filters>) =>
    setFiltersState((f) => ({ ...f, ...patch }));
  const resetFilters = () =>
    setFiltersState((f) => ({ ...defaultFilters, account: f.account }));
  const refreshAccounts = () => setReloadKey((k) => k + 1);
  const refreshSetups = () => setSetupsKey((k) => k + 1);

  const value = useMemo(
    () => ({
      filters,
      setFilters,
      resetFilters,
      accounts,
      accountsLoading,
      accountsError,
      refreshAccounts,
      setups,
      refreshSetups,
    }),
    [filters, accounts, accountsLoading, accountsError, setups]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
}
