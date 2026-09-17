import { useMemo, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { renderMarkdown } from '../utils/markdown';

/**
 * Renders note markdown (see utils/markdown — source is escaped, URLs are
 * allow-listed). In-app links (#trade, @day, root-relative) route through the
 * SPA router instead of a full page load.
 */
export default function Markdown({
  source,
  className = '',
  empty,
}: {
  source: string | null | undefined;
  className?: string;
  empty?: React.ReactNode;
}) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const navigate = useNavigate();

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a[data-internal]') as HTMLAnchorElement | null;
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(a.getAttribute('href') || '/');
  };

  if (!html) return <>{empty ?? null}</>;
  return (
    <div
      className={`break-words text-sm leading-relaxed text-slate-200 ${className}`}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
