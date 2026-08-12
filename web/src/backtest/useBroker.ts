import { useEffect, useRef, useState } from 'react';
import type { ReplayEngine } from './engine';
import { SimBroker, type BrokerState, type ClosedTrade } from './broker';

// Create a SimBroker bound to an engine and expose its live state to React.
// `onClose` fires once per closed trade (the page persists it + refreshes stats).
export function useBroker(
  engine: ReplayEngine | null,
  onClose?: (trade: ClosedTrade, broker: SimBroker) => void
): { broker: SimBroker | null; state: BrokerState | null } {
  const [broker, setBroker] = useState<SimBroker | null>(null);
  const [state, setState] = useState<BrokerState | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!engine) {
      setBroker(null);
      setState(null);
      return;
    }
    const b = new SimBroker(engine);
    setBroker(b);
    const offState = b.onChange(setState);
    const offClose = b.onClose((t) => onCloseRef.current?.(t, b));
    return () => {
      offState();
      offClose();
      b.destroy();
    };
  }, [engine]);

  return { broker, state };
}
