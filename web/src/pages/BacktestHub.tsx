import { useSearchParams } from 'react-router-dom';
import Backtest from './Backtest';
import BacktestStudio from './BacktestStudio';

const MODES = [
  { key: 'studio', label: 'Studio · bar replay' },
  { key: 'log', label: 'Quick log · click chart' },
] as const;

type Mode = (typeof MODES)[number]['key'];

/**
 * One Backtest destination: Studio (bar replay sessions) by default, with the
 * older click-the-chart logger kept as a second mode (?mode=log).
 */
export default function BacktestHub() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'log' ? 'log' : 'studio';

  const setMode = (m: Mode) =>
    setParams(
      (p) => {
        if (m === 'studio') p.delete('mode');
        else p.set('mode', m);
        return p;
      },
      { replace: true }
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Backtest mode">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            className={`btn px-3 py-1 text-[10px] ${mode === m.key ? 'btn-primary' : ''}`}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'log' ? <Backtest /> : <BacktestStudio />}
    </div>
  );
}
