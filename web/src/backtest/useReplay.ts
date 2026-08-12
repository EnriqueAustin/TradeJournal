import { useEffect, useState } from 'react';
import type { CursorState, ReplayEngine } from './engine';

// Subscribe a React component to a ReplayEngine's cursor. Returns the latest
// CursorState (index/time/playing/speed/atEnd/total), re-rendering on change.
export function useReplayCursor(engine: ReplayEngine | null): CursorState | null {
  const [state, setState] = useState<CursorState | null>(
    engine ? engine.snapshot() : null
  );
  useEffect(() => {
    if (!engine) {
      setState(null);
      return;
    }
    return engine.onCursor(setState);
  }, [engine]);
  return state;
}
