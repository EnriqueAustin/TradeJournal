import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  tag?: string; // right-aligned subtitle (e.g. instrument, freshness)
  right?: ReactNode; // header-right slot (badges, controls)
  span?: 4 | 6 | 8 | 12; // grid columns
  className?: string; // extra classes (e.g. fullscreen modifier)
  children?: ReactNode;
}

// Bordered, titled terminal panel. The building block of every Signal cockpit.
export default function Panel({ title, tag, right, span = 4, className = '', children }: PanelProps) {
  return (
    <section className={`sig-panel sig-col-${span}${className ? ` ${className}` : ''}`}>
      <header className="sig-panel-hd">
        <span>{title}</span>
        {tag && <span className="sig-panel-tag">{tag}</span>}
        <span className="sig-spacer" />
        {right}
      </header>
      <div className="sig-panel-bd">{children}</div>
    </section>
  );
}
