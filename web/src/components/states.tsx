import type { ReactNode } from 'react';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400 ${className}`}
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

/** Wraps async UI: shows spinner/error/empty or renders children. */
export function AsyncBoundary({
  loading,
  error,
  isEmpty,
  onRetry,
  emptyMessage,
  loadingLabel,
  children,
}: {
  loading: boolean;
  error: string | null;
  isEmpty?: boolean;
  onRetry?: () => void;
  emptyMessage?: string;
  loadingLabel?: string;
  children: ReactNode;
}) {
  if (loading) return <LoadingBlock label={loadingLabel} />;
  if (error) return <ErrorBlock message={error} onRetry={onRetry} />;
  if (isEmpty) return <EmptyBlock message={emptyMessage} />;
  return <>{children}</>;
}
