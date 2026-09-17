import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Emotion, TradeDetail as TTradeDetail, TradePsych } from '../../types';

export const EMOTIONS: { value: Emotion; label: string; tone: 'good' | 'warn' | 'bad' }[] = [
  { value: 'calm', label: 'Calm', tone: 'good' },
  { value: 'confident', label: 'Confident', tone: 'good' },
  { value: 'bored', label: 'Bored', tone: 'warn' },
  { value: 'anxious', label: 'Anxious', tone: 'warn' },
  { value: 'fomo', label: 'FOMO', tone: 'bad' },
  { value: 'revenge', label: 'Revenge', tone: 'bad' },
];

const toneOn = {
  good: 'border-emerald-500 bg-emerald-500/15 text-emerald-300',
  warn: 'border-amber-500 bg-amber-500/15 text-amber-300',
  bad: 'border-red-500 bg-red-500/15 text-red-300',
};
const OFF = 'border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200';

type Psych = Pick<TradePsych, 'confidence' | 'emotion' | 'satisfaction'>;
const EMPTY: Psych = { confidence: null, emotion: null, satisfaction: null };

function Scale({
  label,
  hint,
  value,
  onPick,
  disabled,
}: {
  label: string;
  hint: [string, string];
  value: number | null;
  onPick: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="w-9 shrink-0 text-right text-[11px] text-slate-500 md:w-10">{hint[0]}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-pressed={value === n}
            onClick={() => onPick(value === n ? null : n)}
            className={`num h-10 min-w-0 flex-1 rounded-lg border text-sm font-semibold transition md:h-8 md:w-8 md:flex-none ${
              value === n ? 'border-cyan-500 bg-cyan-500/15 text-cyan-300' : OFF
            }`}
          >
            {n}
          </button>
        ))}
        <span className="w-9 shrink-0 text-[11px] text-slate-500 md:w-10">{hint[1]}</span>
      </div>
    </div>
  );
}

/**
 * Tiltmeter for one trade: pre-trade confidence (1-5), the emotional state going
 * in (single select) and a post-trade execution rating (1-5). Saves on every tap;
 * tapping the active choice clears it. `bare` drops the card chrome so the review
 * stepper can embed it.
 */
export default function PsychCard({
  trade,
  onChanged,
  bare = false,
}: {
  trade: TTradeDetail;
  onChanged?: () => void;
  bare?: boolean;
}) {
  const [p, setP] = useState<Psych>(trade.psych ?? EMPTY);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setP(trade.psych ?? EMPTY), [trade.id, trade.psych]);

  const save = async (patch: Partial<Psych>) => {
    const prev = p;
    setP({ ...p, ...patch });
    setErr(null);
    try {
      await api.saveTradePsych(trade.id, patch);
      onChanged?.();
    } catch (e: any) {
      setP(prev);
      setErr(e?.message || 'Failed to save');
    }
  };

  const body = (
    <div className="flex flex-col gap-3">
      <Scale
        label="Pre-trade confidence"
        hint={['low', 'high']}
        value={p.confidence}
        onPick={(v) => save({ confidence: v })}
      />
      <div>
        <div className="label mb-1.5">State going in</div>
        <div className="flex flex-wrap gap-1.5">
          {EMOTIONS.map((e) => (
            <button
              key={e.value}
              type="button"
              aria-pressed={p.emotion === e.value}
              onClick={() => save({ emotion: p.emotion === e.value ? null : e.value })}
              className={`min-h-[40px] rounded-full border px-3 py-1 text-xs font-medium transition md:min-h-0 md:px-2.5 ${
                p.emotion === e.value ? toneOn[e.tone] : OFF
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <Scale
        label="Execution / satisfaction"
        hint={['poor', 'great']}
        value={p.satisfaction}
        onPick={(v) => save({ satisfaction: v })}
      />
      {err && <p className="text-sm text-red-400">{err}</p>}
    </div>
  );

  if (bare) return body;
  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">Psychology</h2>
      {body}
      <p className="mt-3 text-xs text-slate-500">Feeds the Psychology panel on Analytics.</p>
    </div>
  );
}
