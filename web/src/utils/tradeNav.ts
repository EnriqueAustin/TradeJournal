import type { TradeQuery } from '../types';

// The Trades list remembers its search/sort here so a trade's detail page can
// step to the previous / next row in that same order.
const KEY = 'trade-journal:trades-query';

export function saveTradesQuery(q: TradeQuery) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable — detail nav falls back to chronological */
  }
}

export function loadTradesQuery(): TradeQuery | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TradeQuery) : null;
  } catch {
    return null;
  }
}

/** True when a keyboard shortcut should be ignored because focus is in a
 *  text field, select or rich editor (or a modifier is held). */
export function isTypingTarget(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type !== 'checkbox' && type !== 'radio' && type !== 'button';
  }
  return (
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}
