import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import PsychCard from './PsychCard';
import { isTypingTarget } from '../../utils/tradeNav';
import { GRADES } from '../../utils/review';
import type { Tag, TagWithUses, TradeDetail } from '../../types';

export const OFF = 'border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200';
export const gradeOn = (g: string) =>
  g === 'A' || g === 'B'
    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
    : g === 'C'
      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
      : 'border-red-500 bg-red-500/15 text-red-300';

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="num hidden rounded border border-slate-700 bg-slate-900 px-1 py-px text-[11px] text-slate-400 md:inline">
      {children}
    </kbd>
  );
}

/**
 * One trade's quick review: grade, followed/broke plan, mistake quick-picks,
 * psychology, setup, a one-line note and (optionally) a camera screenshot.
 * Used by the review stepper and the mobile Quick capture sheet. Below md the
 * controls grow to thumb size and the keyboard hints drop out.
 */
export default function QuickReview({
  trade,
  setups,
  onChanged,
  onNext,
  onPrev,
  isLast,
  keyboard = true,
  withScreenshot = false,
  bare = false,
  nextLabel,
}: {
  trade: TradeDetail;
  setups: { id: number; name: string }[];
  onChanged: () => void;
  onNext: () => void;
  onPrev?: () => void;
  isLast: boolean;
  /** Global shortcuts (1–5, f/b, n/p). Off inside a sheet over another page. */
  keyboard?: boolean;
  withScreenshot?: boolean;
  /** Drop the card chrome (when hosted in a sheet). */
  bare?: boolean;
  nextLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [newMistake, setNewMistake] = useState('');
  const [known, setKnown] = useState<TagWithUses[]>([]);
  const gradeTag = trade.tags.find((t) => t.category === 'grade') ?? null;
  const grade = gradeTag?.name ?? null;
  const mistakeTags = trade.tags.filter((t) => t.category === 'mistake');

  useEffect(() => {
    api.getTags('mistake').then(setKnown).catch(() => setKnown([]));
  }, []);

  // Serialise writes so a fast double-press never interleaves remove/add.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(
    (fn: () => Promise<unknown>) => {
      chain.current = chain.current.then(async () => {
        setBusy(true);
        setErr(null);
        try {
          await fn();
          onChanged();
        } catch (e: any) {
          setErr(e?.message || 'Failed to save');
        } finally {
          setBusy(false);
        }
      });
      return chain.current;
    },
    [onChanged]
  );

  const setGrade = useCallback(
    (g: string) =>
      run(async () => {
        if (gradeTag) await api.removeTag(trade.id, gradeTag.id);
        if (g !== grade) await api.addTag(trade.id, 'grade', g);
      }),
    [run, gradeTag, grade, trade.id]
  );
  const setFollowed = useCallback(
    (v: 0 | 1) =>
      run(() => api.patchTrade(trade.id, { followed_plan: trade.followed_plan === v ? null : v })),
    [run, trade.id, trade.followed_plan]
  );
  const toggleMistake = (name: string) => {
    const on = mistakeTags.find((t) => t.name === name);
    return run(() => (on ? api.removeTag(trade.id, on.id) : api.addTag(trade.id, 'mistake', name)));
  };
  const addMistake = () => {
    const n = newMistake.trim();
    if (!n) return;
    setNewMistake('');
    run(async () => {
      await api.addTag(trade.id, 'mistake', n);
      setKnown((k) => (k.some((t) => t.name === n) ? k : [...k, { id: -1, category: 'mistake', name: n, uses: 1 }]));
    });
  };
  const saveNote = async () => {
    const body = note.trim();
    if (!body) return;
    setNote('');
    await run(() => api.addNote(trade.id, body));
  };
  // The note input saves on blur, which fires before this click lands.
  const goNext = () => onNext();

  const uploadShot = (file: File | undefined) => {
    if (!file) return;
    run(() => api.uploadScreenshot(trade.id, file));
  };

  // Keyboard: 1–5 grade A–F, f/b plan, n/Enter next, p previous.
  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= '5') {
        e.preventDefault();
        setGrade(GRADES[Number(k) - 1]);
      } else if (k === 'f') {
        e.preventDefault();
        setFollowed(1);
      } else if (k === 'b') {
        e.preventDefault();
        setFollowed(0);
      } else if (k === 'n' || k === 'enter' || k === 'arrowright') {
        if (k === 'enter' && (e.target as HTMLElement)?.tagName === 'BUTTON') return;
        e.preventDefault();
        onNext();
      } else if ((k === 'p' || k === 'arrowleft') && onPrev) {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, setGrade, setFollowed, onNext, onPrev]);

  // Quick-pick: most used mistakes first, plus any already on this trade.
  const chips = useMemo(() => {
    const names = new Set<string>();
    for (const t of known) names.add(t.name);
    for (const t of mistakeTags) names.add(t.name);
    return [...names].slice(0, 14);
  }, [known, mistakeTags]);

  const existingNotes = trade.notes.filter((n) => n.body?.trim());

  return (
    <div className={bare ? '' : 'card p-4'}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Quick review</h2>
        {busy ? (
          <span className="text-xs text-slate-500">Saving…</span>
        ) : trade.followed_plan != null ? (
          <span className="text-xs text-emerald-400">✓ reviewed</span>
        ) : (
          <span className="text-xs text-amber-400">unreviewed</span>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <div className="label mb-1.5">
            Grade <span className="hidden font-normal normal-case text-slate-600 md:inline">1–5</span>
          </div>
          <div className="flex gap-1.5">
            {GRADES.map((g, i) => (
              <button
                key={g}
                type="button"
                aria-pressed={grade === g}
                onClick={() => setGrade(g)}
                title={`Grade ${g} (${i + 1})`}
                className={`h-12 flex-1 rounded-lg border text-base font-semibold transition md:h-9 md:w-9 md:flex-none md:text-sm ${
                  grade === g ? gradeOn(g) : OFF
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="label mb-1.5">Plan</div>
          <div className="flex gap-1.5">
            <button
              type="button"
              aria-pressed={trade.followed_plan === 1}
              onClick={() => setFollowed(1)}
              className={`min-h-[48px] flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition md:min-h-0 md:flex-none ${
                trade.followed_plan === 1 ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : OFF
              }`}
            >
              ✓ Followed <Kbd>f</Kbd>
            </button>
            <button
              type="button"
              aria-pressed={trade.followed_plan === 0}
              onClick={() => setFollowed(0)}
              className={`min-h-[48px] flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition md:min-h-0 md:flex-none ${
                trade.followed_plan === 0 ? 'border-red-500 bg-red-500/15 text-red-300' : OFF
              }`}
            >
              ✗ Broke <Kbd>b</Kbd>
            </button>
          </div>
        </div>

        <div>
          <div className="label mb-1.5">Mistakes</div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chips.length === 0 && <span className="text-xs text-slate-500">No mistake tags yet — add one.</span>}
            {chips.map((name) => {
              const on = mistakeTags.some((t: Tag) => t.name === name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleMistake(name)}
                  className={`min-h-[40px] rounded-full border px-3 py-1 text-xs font-medium transition md:min-h-0 md:px-2.5 ${
                    on ? 'border-red-500 bg-red-500/15 text-red-300' : OFF
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5">
            <input
              className="input min-w-0 flex-1 py-1 text-sm"
              value={newMistake}
              placeholder="New mistake, e.g. moved stop"
              enterKeyHint="done"
              onChange={(e) => setNewMistake(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addMistake();
                }
              }}
            />
            <button className="btn text-xs" onClick={addMistake} disabled={!newMistake.trim()}>
              Add
            </button>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-3">
          <PsychCard trade={trade} onChanged={onChanged} bare />
        </div>

        <div>
          <label className="label mb-1.5 block" htmlFor={`review-setup-${trade.id}`}>
            Setup
          </label>
          <select
            id={`review-setup-${trade.id}`}
            className="input w-full"
            value={trade.setup_id ?? ''}
            onChange={(e) =>
              run(() => api.patchTrade(trade.id, { setup_id: e.target.value ? Number(e.target.value) : null }))
            }
          >
            <option value="">— none —</option>
            {setups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-1.5 block" htmlFor={`review-note-${trade.id}`}>
            One-line note
          </label>
          {existingNotes.length > 0 && (
            <ul className="mb-1.5 flex flex-col gap-1">
              {existingNotes.slice(-3).map((n) => (
                <li key={n.id} className="truncate text-xs text-slate-400" title={n.body}>
                  • {n.body}
                </li>
              ))}
            </ul>
          )}
          <input
            id={`review-note-${trade.id}`}
            className="input w-full"
            value={note}
            placeholder="What mattered on this trade?"
            enterKeyHint="next"
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                await saveNote();
                (e.target as HTMLInputElement).blur();
                onNext();
              } else if (e.key === 'Escape') {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>

        {withScreenshot && (
          <div>
            <div className="label mb-1.5">
              Screenshot{' '}
              {trade.screenshots.length > 0 && (
                <span className="font-normal normal-case text-slate-500">
                  ({trade.screenshots.length} attached)
                </span>
              )}
            </div>
            {trade.screenshots.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto">
                {trade.screenshots.map((s) => (
                  <img
                    key={s.id}
                    src={s.url}
                    alt=""
                    className="h-16 w-24 shrink-0 rounded border border-slate-800 object-cover"
                  />
                ))}
              </div>
            )}
            {/* capture=environment opens the rear camera straight away on phones;
                desktop browsers ignore it and show a file picker. */}
            <label className="btn w-full cursor-pointer">
              📷 Take / attach photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  uploadShot(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        )}

        {err && <p className="text-sm text-red-400">{err}</p>}

        <div className="tj-sticky-actions flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
          {onPrev && (
            <button className="btn min-h-[48px] flex-1 md:min-h-0 md:flex-none" onClick={onPrev}>
              ← Prev <Kbd>p</Kbd>
            </button>
          )}
          <button className="btn btn-primary min-h-[48px] flex-1 md:min-h-0 md:flex-none" onClick={goNext}>
            {nextLabel ?? (isLast ? 'Finish' : 'Next')} → <Kbd>n</Kbd>
          </button>
        </div>
        {keyboard && (
          <p className="hidden text-[11px] text-slate-500 md:block">
            Keys: <Kbd>1</Kbd>–<Kbd>5</Kbd> grade A–F · <Kbd>f</Kbd>/<Kbd>b</Kbd> followed/broke ·{' '}
            <Kbd>n</Kbd>/<Kbd>Enter</Kbd> next · <Kbd>p</Kbd> previous
          </p>
        )}
      </div>
    </div>
  );
}
