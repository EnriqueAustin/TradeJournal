import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Account, Filters, Setup } from '../types';
import { api } from '../api/client';
import { profilesApi, type Profile } from '../api/profiles';

interface FilterContextValue {
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  /** Accounts in scope: the active profile's accounts, or all when no profile. */
  accounts: Account[];
  /** Every account regardless of profile (Accounts page, assignment). */
  allAccounts: Account[];
  profiles: Profile[];
  activeProfile: Profile | null;
  /** Switch profile (null = All profiles); pre-selects its default instrument. */
  setProfile: (id: number | null) => void;
  refreshProfiles: () => void;
  accountsLoading: boolean;
  accountsError: string | null;
  refreshAccounts: () => void;
  setups: Setup[];
  refreshSetups: () => void;
}

const defaultFilters: Filters = {
  account: null,
  profile: null,
  instrument: 'All',
  session: 'All',
  setup: 'All',
  from: '',
  to: '',
  rMin: '',
  rMax: '',
};

const FilterContext = createContext<FilterContextValue | undefined>(undefined);
const ACCOUNT_STORAGE_KEY = 'trade-journal:selected-account';
const FILTERS_STORAGE_KEY = 'trade-journal:filters';
const PROFILE_STORAGE_KEY = 'trade-journal:profile';

function getStoredProfile(): number | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

// Stored account: a number id, the literal 'all' (explicit All-accounts), or
// nothing (unset — defaults to the first account once they load). null in state
// always means All accounts; 'all' vs unset is only how we tell an explicit
// All choice from a fresh user who should default to a single account.
function getStoredAccountRaw(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getStoredAccount(): number | null {
  const raw = getStoredAccountRaw();
  if (raw === 'all' || !raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// Rehydrate the non-account filter state (account has its own key). Guarded so
// a private window / cleared storage / an older shape falls back to defaults.
function getStoredFilters(): Filters {
  const base = { ...defaultFilters, account: getStoredAccount(), profile: getStoredProfile() };
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Filters>;
    return {
      ...base,
      instrument: saved.instrument ?? base.instrument,
      session: saved.session ?? base.session,
      setup: saved.setup ?? base.setup,
      from: saved.from ?? base.from,
      to: saved.to ?? base.to,
      rMin: saved.rMin ?? base.rMin,
      rMax: saved.rMax ?? base.rMax,
    };
  } catch {
    return base;
  }
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFiltersState] = useState<Filters>(getStoredFilters);
  const [allAccounts, setAccounts] = useState<Account[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [profilesKey, setProfilesKey] = useState(0);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [setups, setSetups] = useState<Setup[]>([]);
  const [setupsKey, setSetupsKey] = useState(0);
  // Whether null-account is a deliberate "All accounts" choice (persisted as
  // 'all') rather than a fresh user who should default to a single account.
  const explicitAll = useRef(getStoredAccountRaw() === 'all');

  useEffect(() => {
    let cancelled = false;
    setAccountsLoading(true);
    setAccountsError(null);
    api
      .getAccounts()
      .then((data) => {
        if (cancelled) return;
        setAccounts(data);
        setFiltersState((f) => {
          // A stale numeric account (deleted) falls back to All accounts.
          if (f.account != null) {
            return data.some((a) => a.id === f.account) ? f : { ...f, account: null };
          }
          // Null: keep it if it's a deliberate All choice; otherwise a fresh
          // user defaults to their first account.
          if (explicitAll.current) return f;
          return { ...f, account: data[0]?.id ?? null };
        });
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
    try {
      if (filters.account == null) {
        // Only persist an explicit All; a transient unset (pre-defaulting) is
        // left unstored so a fresh user still defaults to a single account.
        if (explicitAll.current) window.localStorage.setItem(ACCOUNT_STORAGE_KEY, 'all');
        else window.localStorage.removeItem(ACCOUNT_STORAGE_KEY);
      } else {
        window.localStorage.setItem(ACCOUNT_STORAGE_KEY, String(filters.account));
      }
    } catch {
      /* storage may be unavailable; ignore */
    }
  }, [filters.account]);

  useEffect(() => {
    let cancelled = false;
    profilesApi
      .list()
      .then((data) => {
        if (!cancelled) setProfiles(data);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      })
      .finally(() => {
        if (!cancelled) setProfilesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [profilesKey, reloadKey]);

  // A stored profile that no longer exists falls back to All profiles.
  useEffect(() => {
    if (!profilesLoaded || filters.profile == null) return;
    if (!profiles.some((p) => p.id === filters.profile)) {
      setFiltersState((f) => ({ ...f, profile: null }));
    }
  }, [profiles, profilesLoaded, filters.profile]);

  // Accounts in scope for the active profile.
  const accounts = useMemo(
    () =>
      filters.profile == null
        ? allAccounts
        : allAccounts.filter((a) => a.profile_id === filters.profile),
    [allAccounts, filters.profile]
  );

  // A selected account outside the active profile becomes "All accounts" (of
  // that profile).
  useEffect(() => {
    if (accountsLoading || filters.account == null || filters.profile == null) return;
    if (!accounts.some((a) => a.id === filters.account)) {
      explicitAll.current = true;
      setFiltersState((f) => ({ ...f, account: null }));
    }
  }, [accounts, accountsLoading, filters.account, filters.profile]);

  useEffect(() => {
    try {
      if (filters.profile == null) window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      else window.localStorage.setItem(PROFILE_STORAGE_KEY, String(filters.profile));
    } catch {
      /* storage may be unavailable; ignore */
    }
  }, [filters.profile]);

  // Persist the rest of the filter state so filters survive a reload/session.
  useEffect(() => {
    try {
      const { account: _account, profile: _profile, ...rest } = filters;
      window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(rest));
    } catch {
      /* storage may be unavailable (private window); ignore */
    }
  }, [filters]);

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

  const setFilters = (patch: Partial<Filters>) => {
    // Any explicit account choice (including All = null) is deliberate from here
    // on, so it persists and survives an accounts refresh.
    if ('account' in patch) explicitAll.current = patch.account == null;
    setFiltersState((f) => ({ ...f, ...patch }));
  };
  const resetFilters = () =>
    setFiltersState((f) => ({ ...defaultFilters, account: f.account, profile: f.profile }));
  const refreshAccounts = () => setReloadKey((k) => k + 1);
  const refreshProfiles = () => setProfilesKey((k) => k + 1);
  const setProfile = (id: number | null) => {
    const p = id == null ? null : profiles.find((x) => x.id === id) ?? null;
    // Switching profile resets to "All accounts" of that profile.
    explicitAll.current = true;
    setFiltersState((f) => ({
      ...f,
      profile: p ? p.id : null,
      account: null,
      instrument: p?.default_instrument ?? (id == null ? f.instrument : 'All'),
    }));
  };
  const activeProfile = profiles.find((p) => p.id === filters.profile) ?? null;
  const refreshSetups = () => setSetupsKey((k) => k + 1);

  const value = useMemo(
    () => ({
      filters,
      setFilters,
      resetFilters,
      accounts,
      allAccounts,
      profiles,
      activeProfile,
      setProfile,
      refreshProfiles,
      accountsLoading,
      accountsError,
      refreshAccounts,
      setups,
      refreshSetups,
    }),
    [filters, accounts, allAccounts, profiles, activeProfile, accountsLoading, accountsError, setups]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
}
