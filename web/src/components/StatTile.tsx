import type { ReactNode } from 'react';

export default function StatTile({
  label,
  value,
  sub,
  valueClass = '',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div
      className="border px-3 py-2"
      style={{
        background: 'var(--term-panel)',
        borderColor: 'var(--term-border)',
        borderRadius: 3,
      }}
    >
      <div
        className="text-[10px] font-bold uppercase"
        style={{ color: 'var(--term-amber)', letterSpacing: '0.1em' }}
      >
        {label}
      </div>
      <div
        className={`num mt-1 text-xl font-bold ${valueClass}`}
        style={valueClass ? undefined : { color: 'var(--term-text-hi)' }}
      >
        {value}
      </div>
      {sub != null && (
        <div
          className="num mt-0.5 text-[10px]"
          style={{ color: 'var(--term-text-dim)' }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
