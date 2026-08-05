import type { ReactNode } from 'react';

export default function StatTile({
  label,
  value,
  sub,
  valueClass = 'text-slate-100',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`num mt-1.5 text-2xl font-semibold ${valueClass}`}>
        {value}
      </div>
      {sub != null && (
        <div className="num mt-0.5 text-xs text-slate-500">{sub}</div>
      )}
    </div>
  );
}
