// Runs the Monte Carlo off the main thread.
import { runMonteCarlo, type MCInput } from './monteCarlo';

self.onmessage = (e: MessageEvent<{ id: number; input: MCInput }>) => {
  const { id, input } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, result: runMonteCarlo(input) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message || err) });
  }
};
