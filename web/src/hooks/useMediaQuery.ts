import { useSyncExternalStore } from 'react';

/** Live `matchMedia` result. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Below Tailwind's `md` breakpoint (768px) — the phone layout. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767.98px)');
}
