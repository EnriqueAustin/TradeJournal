import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Bottom sheet for phone layouts: slides up from the bottom edge, closes on the
 * backdrop, the ✕ button or Esc, and keeps its content clear of the home
 * indicator. Portalled to <body> so it sits above the bottom tab bar.
 */
export default function Sheet({
  title,
  onClose,
  children,
  fullHeight = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  fullHeight?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`tj-sheet-in relative flex w-full flex-col border-t ${
          fullHeight ? 'h-[92dvh]' : 'max-h-[88dvh]'
        }`}
        style={{
          background: 'var(--term-panel)',
          borderColor: 'var(--term-border-2)',
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
        }}
      >
        <div className="flex items-center gap-2 border-b px-4 py-1" style={{ borderColor: 'var(--term-border)' }}>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: 'var(--term-text-hi)' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 items-center justify-center text-lg"
            style={{ color: 'var(--term-text-dim)' }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div
          className="tj-sheet-body min-h-0 flex-1 overflow-y-auto px-4 pt-3"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
