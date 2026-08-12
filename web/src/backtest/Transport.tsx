import { useState } from 'react';
import type { CursorState, ReplayEngine } from './engine';

const SPEEDS = [1, 2, 5, 10, 25, 50, 100];

// The replay transport: step-back / play-pause / step-forward, a speed picker,
// a scrub slider, a bar counter, and "go to date". Mirrors FXReplay's replay bar.
export default function Transport({
  engine,
  cursor,
  barTimeLabel,
}: {
  engine: ReplayEngine;
  cursor: CursorState;
  /** formats a cursor time (unix seconds) for the readout */
  barTimeLabel: (sec: number) => string;
}) {
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoVal, setGotoVal] = useState('');

  const disabled = cursor.total === 0;

  const doGoto = () => {
    if (!gotoVal) return;
    const sec = Math.floor(new Date(gotoVal).getTime() / 1000);
    if (Number.isFinite(sec)) engine.seek(sec);
    setGotoOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <button
          className="btn btn-icon"
          title="Step back one bar"
          disabled={disabled || cursor.index <= 0}
          onClick={() => engine.step(-1)}
        >
          ⏮
        </button>
        <button
          className="btn btn-primary btn-icon"
          title={cursor.playing ? 'Pause' : 'Play'}
          disabled={disabled || cursor.atEnd}
          onClick={() => engine.toggle()}
        >
          {cursor.playing ? '⏸' : '▶'}
        </button>
        <button
          className="btn btn-icon"
          title="Step forward one bar"
          disabled={disabled || cursor.atEnd}
          onClick={() => engine.step(1)}
        >
          ⏭
        </button>
      </div>

      <div className="flex items-center gap-1">
        <span className="label mb-0">Speed</span>
        <select
          className="input py-1"
          value={cursor.speed}
          onChange={(e) => engine.setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>

      <input
        type="range"
        className="min-w-[160px] flex-1 accent-indigo-500"
        min={0}
        max={Math.max(0, cursor.total - 1)}
        value={cursor.index}
        disabled={disabled}
        onChange={(e) => engine.seekIndex(Number(e.target.value))}
      />

      <div className="num min-w-[168px] text-right text-xs text-slate-400">
        {disabled ? (
          '— no bars —'
        ) : (
          <>
            <span className="text-slate-200">{barTimeLabel(cursor.time)}</span>
            <span className="ml-2 text-slate-500">
              {cursor.index + 1}/{cursor.total}
            </span>
          </>
        )}
      </div>

      <div className="relative">
        <button
          className="btn"
          disabled={disabled}
          onClick={() => setGotoOpen((o) => !o)}
        >
          Go to date
        </button>
        {gotoOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-lg">
            <input
              type="datetime-local"
              className="input py-1"
              value={gotoVal}
              onChange={(e) => setGotoVal(e.target.value)}
            />
            <button className="btn btn-primary" onClick={doGoto}>
              Go
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
