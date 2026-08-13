export type BadgeKind = 'ok' | 'warn' | 'err' | 'muted';

interface StatusBadgeProps {
  kind: BadgeKind;
  label: string;
}

// Colored status pill with a leading dot (service up/down, provider on/off).
export default function StatusBadge({ kind, label }: StatusBadgeProps) {
  return <span className={`sig-badge sig-badge--${kind}`}>{label}</span>;
}
