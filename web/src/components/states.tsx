import type { CSSProperties, ReactNode } from 'react';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400 ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-400">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export type SkeletonKind = 'lines' | 'chart' | 'table' | 'tiles';

function Bar({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded-sm ${className}`}
      style={{ background: 'var(--term-border)', ...style }}
    />
  );
}

const CHART_BARS = [40, 65, 30, 80, 55, 70, 45, 60, 35, 75];

/**
 * Placeholder shaped like the content it stands in for, so a page of
 * independent panels doesn't jump as each request resolves.
 */
export function Skeleton({
  kind = 'lines',
  label = 'Loading…',
}: {
  kind?: SkeletonKind;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="py-2">
      {kind === 'chart' && (
        <div className="flex h-48 items-end gap-2">
          {CHART_BARS.map((h, i) => (
            <Bar key={i} className="flex-1" style={{ height: `${h}%` }} />
          ))}
        </div>
      )}
      {kind === 'table' && (
        <div className="flex flex-col gap-2.5">
          <Bar className="h-3 w-full opacity-60" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Bar key={i} className="h-4 w-full" />
          ))}
        </div>
      )}
      {kind === 'tiles' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Bar className="h-2.5 w-1/2" />
              <Bar className="h-6 w-3/4" />
            </div>
          ))}
        </div>
      )}
      {kind === 'lines' && (
        <div className="flex flex-col gap-2.5">
          <Bar className="h-4 w-2/3" />
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-5/6" />
        </div>
      )}
    </div>
  );
}

export function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-900/50 bg-red-950/30 py-8 px-4 text-center">
      <p className="text-sm text-red-300">{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyBlock({
  message = 'No data yet.',
  children,
}: {
  message?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
      <p className="text-sm text-slate-400">{message}</p>
      {children}
    </div>
  );
}

/** Wraps async UI: shows skeleton/error/empty or renders children. */
export function AsyncBoundary({
  loading,
  error,
  isEmpty,
  onRetry,
  emptyMessage,
  loadingLabel,
  skeleton,
  children,
}: {
  loading: boolean;
  error: string | null;
  isEmpty?: boolean;
  onRetry?: () => void;
  emptyMessage?: string;
  loadingLabel?: string;
  /** Shape of the loading placeholder. */
  skeleton?: SkeletonKind;
  children: ReactNode;
}) {
  if (loading) return <Skeleton kind={skeleton} label={loadingLabel} />;
  if (error) return <ErrorBlock message={error} onRetry={onRetry} />;
  if (isEmpty) return <EmptyBlock message={emptyMessage} />;
  return <>{children}</>;
}
