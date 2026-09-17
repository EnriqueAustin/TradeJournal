import { useRef } from 'react';
import type { TouchEvent } from 'react';

/**
 * Horizontal swipe detection for touch screens. Spread the returned handlers on
 * an element; a mostly-horizontal drag of ≥60px fires onLeft / onRight. Drags
 * that start on form controls are ignored so text selection and sliders work.
 */
export function useSwipe({ onLeft, onRight }: { onLeft?: () => void; onRight?: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onLeft?.();
      else onRight?.();
    },
  };
}
