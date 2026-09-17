import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { AsyncBoundary } from '../components/states';
import TradeChartCard from '../components/trade/TradeChartCard';
import KeyStatsCard from '../components/trade/KeyStatsCard';
import PsychCard from '../components/trade/PsychCard';
import ExitAnalysisCard from '../components/ExitAnalysisCard';
import { isTypingTarget } from '../utils/tradeNav';
import {
  GRADES,
  longDay,
  rangeFilters,
  reviewPath,
  scopeRange,
  shiftDay,
  type ReviewScope,
} from '../utils/review';
import type { Tag, TagWithUses, Trade, TradeDetail } from '../types';
import {
  formatDateTime,
  formatMoney,
  formatPct,
  formatR,
  sessionLabel,
  signClass,
} from '../utils/format';

const OFF = 'border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200';
const gradeOn = (g: string) =>
  g === 'A' || g === 'B'
    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
    : g === 'C'
      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
      : 'border-red-500 bg-red-500/15 text-red-300';

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="num rounded border border-slate-700 bg-slate-900 px-1 py-px text-[11px] text-slate-400">
      {children}
    </kbd>
  );
}

/**
 * Guided review: step through every trade in a day or week — chart, stats and
 * exit analysis beside quick inputs (grade, plan, mistakes, psychology, setup,
 * note) — then a summary + recap. "Reviewed" is followed_plan being set, the same
 * flag the Trades page "Unreviewed" filter uses.
 */
export default function Review() {
  const { scope: rawScope = 'day', date = '' } = useParams();
  const scope: ReviewScope | null = rawScope === 'day' || rawScope === 'week' ? rawScope : null;
  if (!scope || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return <Navigate to="/journal" replace />;
  return <ReviewInner key={`${scope}/${date}`} scope={scope} date={date} />;
}

function ReviewInner({ scope, date }: { scope: ReviewScope; date: string }) {
  const navigate = useNavigate();
  const { filters, accounts, accountsLoading, setups } = useFilters();
  // Recaps are per account (like the Journal): fall back to the first account.
  const account = filters.account ?? accounts[0]?.id ?? null;
  const currency = accounts.find((a) => a.id === account)?.currency ?? 'USD';
  const { from, to } = scopeRange(scope, date);

  const [rows, setRows] = useState<Trade[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const started = useRef(false);

  const loadList = useCallback(async () => {
    if (account == null) return;
    try {
      const r = await api.getTrades(rangeFilters(account, from, to), 500, 0, {
        sort: 'entry_time',
        dir: 'asc',
      });
      setRows(r.rows);
      setListErr(null);
      if (!started.current) {
        started.current = true;
        const first = r.rows.findIndex((t) => t.followed_plan == null);
        setIdx(first === -1 ? (r.rows.length ? 0 : 0) : first);
      }
    } catch (e: any) {
      setListErr(e?.message || 'Failed to load trades');
    }
  }, [account, from, to]);

  useEffect(() => {
    if (!accountsLoading) loadList();
  }, [loadList, accountsLoading]);

  const total = rows?.length ?? 0;
  const onSummary = rows != null && idx >= total;
  const tradeId = rows && idx < total ? rows[idx].id : null;

  const [trade, setTrade] = useState<TradeDetail | null>(null);
  const [tradeErr, setTradeErr] = useState<string | null>(null);
  const loadTrade = useCallback(async () => {
    if (tradeId == null) return;
    try {
      const t = await api.getTrade(tradeId);
      setTrade(t);
      setTradeErr(null);
    } catch (e: any) {
      setTradeErr(e?.message || 'Failed to load trade');
    }
  }, [tradeId]);
  useEffect(() => {
    loadTrade();
  }, [loadTrade]);

  const refresh = useCallback(() => {
    loadTrade();
    loadList();
  }, [loadTrade, loadList]);

  const next = useCallback(() => setIdx((i) => Math.min(i + 1, total)), [total]);
  const prev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  const shiftScope = (dir: -1 | 1) =>
    navigate(reviewPath(scope, shiftDay(from, dir * (scope === 'week' ? 7 : 1))));

  const title =
    scope === 'week' ? `Week of ${longDay(from)}` : longDay(date);
  const current = trade && trade.id === tradeId ? trade : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header: scope, date nav, progress */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">
            Review {scope} <span className="text-slate-400">· {title}</span>
          </h1>
          <p className="text-sm text-slate-500">
            {rows == null
              ? 'Loading…'
              : `${rows.filter((t) => t.followed_plan != null).length}/${total} reviewed`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn px-2 py-1" onClick={() => shiftScope(-1)} aria-label={`Previous ${scope}`}>
            ‹
          </button>
          <button className="btn px-2 py-1" onClick={() => shiftScope(1)} aria-label={`Next ${scope}`}>
            ›
          </button>
          <div className="flex overflow-hidden rounded-lg border border-slate-800">
            {(['day', 'week'] as const).map((s) => (
              <Link
                key={s}
                to={reviewPath(s, s === 'day' && scope === 'week' ? from : date)}
                className={`px-2.5 py-1 text-xs font-semibold capitalize ${
                  s === scope ? 'bg-cyan-600 text-white' : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}
              </Link>
            ))}
          </div>
          <Link className="btn px-2 py-1 text-xs" to={`/journal?day=${from}`}>
            Journal
          </Link>
        </div>
      </div>

      {rows && total > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {rows.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setIdx(i)}
              title={`#${i + 1} ${t.instrument} ${t.direction} ${formatMoney(t.net_pnl, currency)}${
                t.followed_plan == null ? ' · unreviewed' : ''
              }`}
              className={`num h-6 min-w-[1.5rem] rounded border px-1 text-[11px] font-semibold ${
                i === idx ? 'ring-2 ring-cyan-500 ' : ''
              }${
                t.followed_plan == null
                  ? 'border-slate-700 bg-slate-900/40 text-slate-400'
                  : t.followed_plan
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                    : 'border-red-500/60 bg-red-500/15 text-red-300'
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setIdx(total)}
            className={`h-6 rounded border px-2 text-[11px] font-semibold ${
              onSummary ? 'border-cyan-500 text-cyan-300 ring-2 ring-cyan-500' : OFF
            }`}
          >
            Summary
          </button>
        </div>
      )}

      {listErr && <div className="card border-red-500/30 p-3 text-sm text-red-400">{listErr}</div>}

      {rows != null && total === 0 && (
        <div className="card p-6 text-sm text-slate-400">
          No trades in this {scope}.{' '}
          <Link className="text-cyan-400 hover:underline" to={`/journal?day=${from}`}>
            Open the journal
          </Link>{' '}
          or step to another {scope} with ‹ ›.
        </div>
      )}

      {rows != null && total > 0 && onSummary && (
        <ReviewSummary
          scope={scope}
          from={from}
          to={to}
          account={account}
          rows={rows}
          currency={currency}
          onJump={setIdx}
        />
      )}

      {rows != null && total > 0 && !onSummary && (
        <AsyncBoundary loading={!current && !tradeErr} error={tradeErr} onRetry={loadTrade} loadingLabel="Loading trade…">
          {current && (
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="num text-sm text-slate-500">
                    {idx + 1} / {total}
                  </span>
                  <Link to={`/trades/${current.id}`} className="text-lg font-semibold text-slate-100 hover:underline">
                    {current.instrument}
                  </Link>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      current.direction === 'long'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}
                  >
                    {current.direction}
                  </span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                    {sessionLabel(current.session)}
                  </span>
                  <span className="text-xs text-slate-500">{formatDateTime(current.entry_time)}</span>
                  <span className={`num ml-auto text-lg font-semibold ${signClass(current.net_pnl)}`}>
                    {formatMoney(current.net_pnl, currency)}
                  </span>
                  <span className={`num text-sm ${signClass(current.r_multiple)}`}>{formatR(current.r_multiple)}</span>
                </div>
                <TradeChartCard key={current.id} trade={current} onChanged={loadTrade} height={360} hideNews />
                <ExitAnalysisCard tradeId={current.id} currency={currency} />
              </div>
              <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
                <QuickReview
                  key={current.id}
                  trade={current}
                  setups={setups}
                  onChanged={refresh}
                  onNext={next}
                  onPrev={prev}
                  isLast={idx === total - 1}
                />
                <KeyStatsCard trade={current} />
              </div>
            </div>
          )}
        </AsyncBoundary>
      )}
    </div>
  );
}

function QuickReview({
  trade,
  setups,
  onChanged,
  onNext,
  onPrev,
  isLast,
}: {
  trade: TradeDetail;
  setups: { id: number; name: string }[];
  onChanged: () => void;
  onNext: () => void;
  onPrev: () => void;
  isLast: boolean;
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

  // Keyboard: 1–5 grade A–F, f/b plan, n/Enter next, p previous.
  useEffect(() => {
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
      } else if (k === 'p' || k === 'arrowleft') {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setGrade, setFollowed, onNext, onPrev]);

  // Quick-pick: most used mistakes first, plus any already on this trade.
  const chips = useMemo(() => {
    const names = new Set<string>();
    for (const t of known) names.add(t.name);
    for (const t of mistakeTags) names.add(t.name);
    return [...names].slice(0, 14);
  }, [known, mistakeTags]);

  const existingNotes = trade.notes.filter((n) => n.body?.trim());

  return (
    <div className="card p-4">
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
            Grade <span className="font-normal normal-case text-slate-600">1–5</span>
          </div>
          <div className="flex gap-1.5">
            {GRADES.map((g, i) => (
              <button
                key={g}
                type="button"
                aria-pressed={grade === g}
                onClick={() => setGrade(g)}
                title={`Grade ${g} (${i + 1})`}
                className={`h-9 w-9 rounded-lg border text-sm font-semibold transition ${grade === g ? gradeOn(g) : OFF}`}
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
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                trade.followed_plan === 1 ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : OFF
              }`}
            >
              ✓ Followed <Kbd>f</Kbd>
            </button>
            <button
              type="button"
              aria-pressed={trade.followed_plan === 0}
              onClick={() => setFollowed(0)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
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
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
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
              className="input flex-1 py-1 text-sm"
              value={newMistake}
              placeholder="New mistake, e.g. moved stop"
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
          <label className="label mb-1.5 block" htmlFor="review-setup">
            Setup
          </label>
          <select
            id="review-setup"
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
          <label className="label mb-1.5 block" htmlFor="review-note">
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
            id="review-note"
            className="input w-full"
            value={note}
            placeholder="What mattered on this trade? (Enter saves + next)"
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

        {err && <p className="text-sm text-red-400">{err}</p>}

        <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
          <button className="btn" onClick={onPrev}>
            ← Prev <Kbd>p</Kbd>
          </button>
          <button className="btn btn-primary" onClick={onNext}>
            {isLast ? 'Finish' : 'Next'} → <Kbd>n</Kbd>
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          Keys: <Kbd>1</Kbd>–<Kbd>5</Kbd> grade A–F · <Kbd>f</Kbd>/<Kbd>b</Kbd> followed/broke ·{' '}
          <Kbd>n</Kbd>/<Kbd>Enter</Kbd> next · <Kbd>p</Kbd> previous
        </p>
      </div>
    </div>
  );
}

function ReviewSummary({
  scope,
  from,
  to,
  account,
  rows,
  currency,
  onJump,
}: {
  scope: ReviewScope;
  from: string;
  to: string;
  account: number | null;
  rows: Trade[];
  currency: string;
  onJump: (i: number) => void;
}) {
  const s = useMemo(() => {
    let net = 0, r = 0, rN = 0, followed = 0, broke = 0, mistakes = 0;
    const grades: Record<string, number> = {};
    const mistakeNames: Record<string, number> = {};
    for (const t of rows) {
      net += t.net_pnl || 0;
      if (t.r_multiple != null) {
        r += t.r_multiple;
        rN++;
      }
      if (t.followed_plan === 1) followed++;
      else if (t.followed_plan === 0) broke++;
      for (const tag of t.tags ?? []) {
        if (tag.category === 'mistake') {
          mistakes++;
          mistakeNames[tag.name] = (mistakeNames[tag.name] ?? 0) + 1;
        } else if (tag.category === 'grade') grades[tag.name] = (grades[tag.name] ?? 0) + 1;
      }
    }
    const reviewed = followed + broke;
    return {
      net,
      r: rN ? r : null,
      followed,
      broke,
      reviewed,
      followedPct: reviewed ? followed / reviewed : null,
      mistakes,
      mistakeNames: Object.entries(mistakeNames).sort((a, b) => b[1] - a[1]),
      grades,
    };
  }, [rows]);

  const [recap, setRecap] = useState('');
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const p =
      scope === 'week'
        ? api.getWeekRecap(account, from).then((w) => w.recap?.body ?? '')
        : api.getJournalDay(account, from).then((d) => d.recap?.body ?? '');
    p.then((b) => {
      if (!cancelled) setRecap(b);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scope, account, from]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      if (scope === 'week') await api.saveWeekRecap(account, from, recap.trim());
      else await api.saveJournalRecap(account, from, recap.trim());
      setDirty(false);
      setMsg('Saved');
    } catch (e: any) {
      setMsg(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const unreviewed = rows.map((t, i) => ({ t, i })).filter(({ t }) => t.followed_plan == null);
  const tiles = [
    { label: 'Net P&L', value: formatMoney(s.net, currency), cls: signClass(s.net) },
    { label: 'Total R', value: formatR(s.r), cls: signClass(s.r) },
    { label: 'Trades', value: String(rows.length), cls: 'text-slate-200' },
    {
      label: 'Followed plan',
      value: s.followedPct == null ? '—' : formatPct(s.followedPct),
      cls: s.followedPct == null ? 'text-slate-200' : s.followedPct >= 0.7 ? 'text-emerald-400' : 'text-amber-400',
    },
    { label: 'Mistakes', value: String(s.mistakes), cls: s.mistakes ? 'text-red-400' : 'text-slate-200' },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">
          {scope === 'week' ? 'Week' : 'Day'} summary
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label}>
              <div className="label">{t.label}</div>
              <div className={`num text-xl font-semibold ${t.cls}`}>{t.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div>
            <div className="label mb-1">Grades</div>
            <div className="flex gap-1.5">
              {GRADES.map((g) => (
                <span key={g} className="num text-slate-300">
                  <span className="text-slate-500">{g}</span> {s.grades[g] ?? 0}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1">Plan</div>
            <span className="text-emerald-400">{s.followed} followed</span> ·{' '}
            <span className="text-red-400">{s.broke} broke</span>
          </div>
          {s.mistakeNames.length > 0 && (
            <div>
              <div className="label mb-1">Mistakes</div>
              <span className="text-slate-300">
                {s.mistakeNames.map(([n, c]) => `${n}${c > 1 ? ` ×${c}` : ''}`).join(', ')}
              </span>
            </div>
          )}
        </div>
        {unreviewed.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {unreviewed.length} still unreviewed:
            {unreviewed.map(({ t, i }) => (
              <button key={t.id} className="underline hover:text-amber-200" onClick={() => onJump(i)}>
                #{i + 1} {t.instrument}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">
            {scope === 'week' ? 'Week recap' : 'Day recap'}
          </h2>
          <div className="flex items-center gap-2">
            {msg && <span className="text-sm text-emerald-400">{msg}</span>}
            <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save recap'}
            </button>
          </div>
        </div>
        <textarea
          className="input min-h-[140px] w-full resize-y"
          value={recap}
          onChange={(e) => {
            setRecap(e.target.value);
            setDirty(true);
          }}
          placeholder={
            scope === 'week'
              ? 'What defined the week? Patterns, the one thing to fix next week…'
              : 'How did the day go against the plan? What to carry into tomorrow…'
          }
        />
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link className="btn text-xs" to={`/journal?day=${from}`}>
            Journal →
          </Link>
          <Link className="btn text-xs" to={`/report/week/${from}`}>
            Week report →
          </Link>
          <Link className="btn text-xs" to={`/report/month/${to.slice(0, 7)}`}>
            Month report →
          </Link>
        </div>
      </div>
    </div>
  );
}
