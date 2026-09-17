// Dashboard layout state: widget order, hidden set and which widgets are
// widened. Persisted in localStorage per profile. Pure helpers so the merge
// rules (unknown ids dropped, new widgets slotted in) are unit-testable.

export interface LayoutState {
  order: string[];
  hidden: string[];
  wide: string[];
}

export interface WidgetMeta {
  id: string;
  /** Hidden until the user adds it from Customise. */
  defaultHidden?: boolean;
}

export function defaultLayout(defs: WidgetMeta[]): LayoutState {
  return {
    order: defs.map((d) => d.id),
    hidden: defs.filter((d) => d.defaultHidden).map((d) => d.id),
    wide: [],
  };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Reconcile a saved layout with the current widget registry: ids that no longer
 * exist are dropped, duplicates removed, and widgets added since the layout was
 * saved are inserted right after their nearest preceding default neighbour (so
 * a new widget lands where it was designed to sit, not at the very bottom).
 */
export function mergeLayout(saved: unknown, defs: WidgetMeta[]): LayoutState {
  const base = defaultLayout(defs);
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Record<string, unknown>;
  const known = new Set(base.order);
  const order: string[] = [];
  for (const id of strings(s.order)) if (known.has(id) && !order.includes(id)) order.push(id);
  if (!order.length) return base;

  const savedIds = new Set(order);
  base.order.forEach((id, i) => {
    if (savedIds.has(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(base.order[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, id);
  });

  const newIds = base.order.filter((id) => !savedIds.has(id));
  const hidden = [
    ...strings(s.hidden).filter((id) => known.has(id)),
    ...newIds.filter((id) => base.hidden.includes(id)),
  ];
  return {
    order,
    hidden: [...new Set(hidden)],
    wide: [...new Set(strings(s.wide).filter((id) => known.has(id)))],
  };
}

/** Move `id` to sit before `targetId` (or after it when `after`). */
export function moveWidget(state: LayoutState, id: string, targetId: string, after = false): LayoutState {
  if (id === targetId) return state;
  const order = state.order.filter((x) => x !== id);
  const t = order.indexOf(targetId);
  if (t < 0) return state;
  order.splice(after ? t + 1 : t, 0, id);
  return { ...state, order };
}

/** Swap `id` with the previous (-1) / next (+1) *visible* widget. */
export function stepWidget(state: LayoutState, id: string, dir: -1 | 1): LayoutState {
  const visible = state.order.filter((x) => !state.hidden.includes(x));
  const i = visible.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= visible.length) return state;
  return moveWidget(state, id, visible[j], dir === 1);
}

export function toggleIn(list: string[], id: string, on: boolean): string[] {
  const without = list.filter((x) => x !== id);
  return on ? [...without, id] : without;
}

export function layoutStorageKey(profile: number | null | undefined): string {
  return `trade-journal:dashboard-layout:${profile ?? 'all'}`;
}

export function loadLayout(profile: number | null | undefined, defs: WidgetMeta[]): LayoutState {
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(profile));
    return mergeLayout(raw ? JSON.parse(raw) : null, defs);
  } catch {
    return defaultLayout(defs);
  }
}

export function saveLayout(profile: number | null | undefined, state: LayoutState | null): void {
  try {
    if (state) window.localStorage.setItem(layoutStorageKey(profile), JSON.stringify(state));
    else window.localStorage.removeItem(layoutStorageKey(profile));
  } catch {
    /* storage unavailable — layout just won't persist */
  }
}
