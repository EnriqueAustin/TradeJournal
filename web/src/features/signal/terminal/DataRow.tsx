import type { ReactNode } from 'react';

interface DataRowProps {
  label: string;
  value: ReactNode;
  /** direction tint for the value: up=green, down=red, flat=dim */
  dir?: 'up' | 'down' | 'flat';
}

// A dense label→value row (Bloomberg-style key/value line).
export default function DataRow({ label, value, dir }: DataRowProps) {
  const dirClass = dir ? ` sig-${dir}` : '';
  return (
    <div className="sig-row">
      <span className="sig-row-label">{label}</span>
      <span className={`sig-row-val sig-num${dirClass}`}>{value}</span>
    </div>
  );
}
