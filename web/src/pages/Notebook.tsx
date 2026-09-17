import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFilters } from '../store/FilterContext';
import Markdown from '../components/Markdown';
import {
  notebookApi,
  type JournalRecap,
  type NotebookFolders,
  type NotebookNote,
  type NoteTemplate,
  type NotebookScope,
} from '../api/notebook';

// Virtual folder keys (never valid user folder names).
const ALL = '__all';
const PINNED = '__pinned';
const UNFILED = '__unfiled';
const RECAPS = '__recaps';

type Draft = Pick<NotebookNote, 'title' | 'body' | 'folder' | 'trade_id' | 'day'>;
type ViewMode = 'write' | 'split' | 'preview';

const VIEW_KEY = 'trade-journal:notebook-view';

function relTime(sqlUtc: string | null | undefined): string {
  if (!sqlUtc) return '';
  const t = new Date(`${sqlUtc.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(t)) return sqlUtc;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function snippet(body: string): string {
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#>*_`~\-[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
}

function longDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function fillTemplate(body: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return body.replace(/\{\{date\}\}/g, today);
}

export default function Notebook() {
  const { filters, accounts, activeProfile } = useFilters();
  const account = filters.account ?? null;
  const profile =
    activeProfile?.id ?? accounts.find((a) => a.id === account)?.profile_id ?? null;
  const scope: NotebookScope = useMemo(() => ({ profile, account }), [profile, account]);

  const [params, setParams] = useSearchParams();
  const [folder, setFolder] = useState<string>(() => params.get('folder') || ALL);
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const [folders, setFolders] = useState<NotebookFolders | null>(null);
  const [notes, setNotes] = useState<NotebookNote[]>([]);
  const [recaps, setRecaps] = useState<JournalRecap[]>([]);
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const selectedId = params.get('note') ? Number(params.get('note')) : null;
  const selectedRecapId = params.get('recap') ? Number(params.get('recap')) : null;
  const select = useCallback(
    (key: 'note' | 'recap', id: number | null) =>
      setParams(
        (p) => {
          p.delete('note');
          p.delete('recap');
          if (id != null) p.set(key, String(id));
          return p;
        },
        { replace: true }
      ),
    [setParams]
  );

  const loadFolders = useCallback(() => {
    notebookApi.listFolders(scope).then(setFolders).catch(() => setFolders(null));
  }, [scope]);
  const loadTemplates = useCallback(() => {
    notebookApi.listTemplates(scope).then(setTemplates).catch(() => setTemplates([]));
  }, [scope]);

  const loadList = useCallback(async () => {
    setErr(null);
    try {
      if (folder === RECAPS) {
        setRecaps(await notebookApi.listRecaps(scope, debouncedQ));
      } else {
        const rows = await notebookApi.listNotes(scope, {
          folder: folder === ALL || folder === PINNED ? undefined : folder,
          q: debouncedQ,
        });
        setNotes(folder === PINNED ? rows.filter((n) => n.pinned) : rows);
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [scope, folder, debouncedQ]);

  useEffect(() => {
    loadFolders();
    loadTemplates();
  }, [loadFolders, loadTemplates]);
  useEffect(() => {
    loadList();
  }, [loadList]);

  // ----- editor state + autosave -----
  const [current, setCurrent] = useState<NotebookNote | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ id: number; draft: Draft } | null>(null);
  const currentId = useRef<number | null>(null);
  currentId.current = current?.id ?? null;

  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setSaveState('saving');
    try {
      const saved = await notebookApi.updateNote(p.id, p.draft);
      setNotes((list) => list.map((n) => (n.id === saved.id ? saved : n)));
      setCurrent((c) => (c && c.id === saved.id ? saved : c));
      setSaveState(pending.current ? 'dirty' : 'saved');
      loadFolders();
    } catch (e: any) {
      setSaveState('error');
      setErr(e?.message || 'Save failed');
    }
  }, [loadFolders]);

  // Open the selected note (flushing edits to the previous one first).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await flush();
      if (selectedId == null) {
        setCurrent(null);
        setDraft(null);
        return;
      }
      // Already open (e.g. just created) — don't clobber the live draft.
      if (currentId.current === selectedId) return;
      const inList = notes.find((n) => n.id === selectedId);
      try {
        const n =
          inList ??
          (await fetch(`/api/notebook/notes/${selectedId}`).then((r) => (r.ok ? r.json() : null)));
        if (cancelled) return;
        setCurrent(n);
        setDraft(n ? { title: n.title, body: n.body, folder: n.folder, trade_id: n.trade_id, day: n.day } : null);
        setSaveState('idle');
      } catch {
        if (!cancelled) setCurrent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Save on unmount / tab close.
  useEffect(() => {
    const onUnload = () => {
      const p = pending.current;
      if (p) {
        navigator.sendBeacon?.(
          `/api/notebook/notes/${p.id}`,
          new Blob([JSON.stringify(p.draft)], { type: 'application/json' })
        );
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      flush();
    };
  }, [flush]);

  const edit = (patch: Partial<Draft>) => {
    if (!current || !draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    pending.current = { id: current.id, draft: next };
    setSaveState('dirty');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 800);
  };

  // ----- actions -----
  const newNote = async (template?: NoteTemplate) => {
    await flush();
    const targetFolder =
      folder !== ALL && folder !== PINNED && folder !== UNFILED && folder !== RECAPS ? folder : null;
    try {
      const n = await notebookApi.createNote({
        title: template ? `${template.name} — ${new Date().toISOString().slice(0, 10)}` : '',
        body: template ? fillTemplate(template.body) : '',
        folder:
          targetFolder ??
          (template && /recap|review|post-mortem/i.test(template.name)
            ? 'Session Recaps'
            : template && /plan/i.test(template.name)
              ? 'Trading Plan'
              : null),
        profile,
        account,
      });
      if (folder === RECAPS || (folder !== ALL && n.folder !== (folder === UNFILED ? null : folder))) {
        setFolder(ALL);
      }
      setNotes((list) => [n, ...list]);
      setCurrent(n);
      setDraft({ title: n.title, body: n.body, folder: n.folder, trade_id: n.trade_id, day: n.day });
      select('note', n.id);
      loadFolders();
    } catch (e: any) {
      setErr(e?.message || 'Could not create note');
    }
  };

  const togglePin = async (n: NotebookNote) => {
    try {
      const saved = await notebookApi.updateNote(n.id, { pinned: !n.pinned });
      setCurrent((c) => (c?.id === saved.id ? { ...c, pinned: saved.pinned } : c));
      loadList();
    } catch (e: any) {
      setErr(e?.message || 'Could not pin note');
    }
  };

  const removeNote = async (n: NotebookNote) => {
    if (!window.confirm(`Delete "${n.title || 'Untitled'}"? This cannot be undone.`)) return;
    pending.current = null;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      await notebookApi.deleteNote(n.id);
      setNotes((list) => list.filter((x) => x.id !== n.id));
      select('note', null);
      loadFolders();
    } catch (e: any) {
      setErr(e?.message || 'Could not delete note');
    }
  };

  const [newFolder, setNewFolder] = useState<string | null>(null);
  const addFolder = async () => {
    const name = (newFolder ?? '').trim();
    if (!name) return setNewFolder(null);
    try {
      await notebookApi.createFolder(scope, name);
      setNewFolder(null);
      loadFolders();
      setFolder(name);
    } catch (e: any) {
      setErr(e?.message || 'Could not create folder');
    }
  };
  const renameFolder = async (id: number, old: string) => {
    const name = window.prompt('Rename folder', old)?.trim();
    if (!name || name === old) return;
    try {
      await notebookApi.renameFolder(id, name);
      if (folder === old) setFolder(name);
      loadFolders();
      loadList();
    } catch (e: any) {
      setErr(e?.message || 'Could not rename folder');
    }
  };
  const deleteFolder = async (id: number, name: string) => {
    if (!window.confirm(`Delete folder "${name}"? Its notes are kept and move to Unfiled.`)) return;
    try {
      await notebookApi.deleteFolder(id);
      if (folder === name) setFolder(ALL);
      loadFolders();
      loadList();
    } catch (e: any) {
      setErr(e?.message || 'Could not delete folder');
    }
  };

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newMenu, setNewMenu] = useState(false);

  const [view, setView] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === 'write' || v === 'preview' || v === 'split' ? v : 'split';
    } catch {
      return 'split';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  const selectedRecap = recaps.find((r) => r.id === selectedRecapId) ?? null;
  const folderNames = folders?.folders.map((f) => f.name) ?? [];

  const pickFolder = (f: string) => {
    setFolder(f);
    setParams(
      (p) => {
        p.delete('recap');
        if (f === ALL) p.delete('folder');
        else p.set('folder', f);
        return p;
      },
      { replace: true }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold text-slate-100">Notebook</h1>
          <p className="text-sm text-slate-500">
            Plans, recaps, lessons{activeProfile ? ` · ${activeProfile.name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="input w-56 py-1"
            placeholder={folder === RECAPS ? 'Search recaps…' : 'Search notes…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn text-xs" onClick={() => setTemplatesOpen(true)}>
            Templates
          </button>
          <div className="relative">
            <div className="flex">
              <button className="btn btn-primary rounded-r-none text-xs" onClick={() => newNote()}>
                + New note
              </button>
              <button
                className="btn btn-primary rounded-l-none border-l border-black/20 px-2 text-xs"
                onClick={() => setNewMenu((o) => !o)}
                aria-label="New from template"
                title="New from template"
              >
                ▾
              </button>
            </div>
            {newMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setNewMenu(false)} />
                <div className="card absolute right-0 z-30 mt-1 w-60 p-1 shadow-xl">
                  <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-slate-500">
                    New from template
                  </div>
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                      onClick={() => {
                        setNewMenu(false);
                        newNote(t);
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                  {templates.length === 0 && <p className="px-2 py-1 text-sm text-slate-500">No templates.</p>}
                  <button
                    className="mt-1 block w-full border-t border-slate-800 px-2 py-1.5 text-left text-xs text-cyan-400 hover:underline"
                    onClick={() => {
                      setNewMenu(false);
                      setTemplatesOpen(true);
                    }}
                  >
                    Manage templates…
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {err && (
        <div className="card flex items-center justify-between border-red-500/30 p-2.5 text-sm text-red-400">
          {err}
          <button className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setErr(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_280px_minmax(0,1fr)]">
        {/* Folders */}
        <nav className="card flex flex-col gap-0.5 self-start p-2 text-sm">
          <FolderRow label="All notes" count={folders?.total} active={folder === ALL} onClick={() => pickFolder(ALL)} />
          <FolderRow label="📌 Pinned" active={folder === PINNED} onClick={() => pickFolder(PINNED)} />
          <div className="mb-0.5 mt-2 px-2 text-[11px] uppercase tracking-wide text-slate-500">Folders</div>
          {folders?.folders.map((f) => (
            <FolderRow
              key={f.name}
              label={f.name}
              count={f.count}
              active={folder === f.name}
              onClick={() => pickFolder(f.name)}
              onRename={f.id != null ? () => renameFolder(f.id!, f.name) : undefined}
              onDelete={f.id != null ? () => deleteFolder(f.id!, f.name) : undefined}
            />
          ))}
          <FolderRow
            label="Unfiled"
            count={folders?.unfiled}
            active={folder === UNFILED}
            onClick={() => pickFolder(UNFILED)}
            muted
          />
          {newFolder == null ? (
            <button
              className="mt-1 rounded px-2 py-1 text-left text-xs text-cyan-400 hover:bg-slate-800/60"
              onClick={() => setNewFolder('')}
            >
              + New folder
            </button>
          ) : (
            <input
              autoFocus
              className="input mt-1 py-1 text-xs"
              placeholder="Folder name"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onBlur={addFolder}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addFolder();
                if (e.key === 'Escape') setNewFolder(null);
              }}
            />
          )}
          <div className="mb-0.5 mt-3 px-2 text-[11px] uppercase tracking-wide text-slate-500">Journal</div>
          <FolderRow
            label="Journal recaps"
            active={folder === RECAPS}
            onClick={() => pickFolder(RECAPS)}
            title="Day and week recaps written on the Journal (read-only here)"
          />
        </nav>

        {/* List */}
        <div className="card flex max-h-[calc(100vh-180px)] min-h-[200px] flex-col self-start overflow-hidden">
          <div className="border-b border-slate-800 px-3 py-2 text-xs text-slate-500">
            {folder === RECAPS
              ? `${recaps.length} recap${recaps.length === 1 ? '' : 's'}`
              : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
            {debouncedQ && <> matching “{debouncedQ}”</>}
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-3 text-sm text-slate-500">Loading…</p>
            ) : folder === RECAPS ? (
              recaps.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">No recaps yet — write one on the Journal page.</p>
              ) : (
                recaps.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => select('recap', r.id)}
                    className={`block w-full border-b border-slate-800/60 px-3 py-2 text-left hover:bg-slate-800/40 ${
                      r.id === selectedRecapId ? 'bg-cyan-500/10' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-200">
                        {r.kind === 'week' ? `Week of ${longDay(r.day)}` : longDay(r.day)}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 text-[10px] uppercase ${
                          r.kind === 'week' ? 'bg-amber-500/15 text-amber-400' : 'bg-cyan-500/10 text-cyan-400'
                        }`}
                      >
                        {r.kind}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{snippet(r.body)}</div>
                    {r.account_name && <div className="mt-0.5 text-[11px] text-slate-600">{r.account_name}</div>}
                  </button>
                ))
              )
            ) : notes.length === 0 ? (
              <div className="p-3 text-sm text-slate-500">
                {debouncedQ ? 'No notes match.' : 'No notes here yet.'}
                <button className="mt-2 block text-cyan-400 hover:underline" onClick={() => newNote()}>
                  + New note
                </button>
              </div>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => select('note', n.id)}
                  className={`block w-full border-b border-slate-800/60 px-3 py-2 text-left hover:bg-slate-800/40 ${
                    n.id === selectedId ? 'bg-cyan-500/10' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {n.pinned ? <span className="text-xs" title="Pinned">📌</span> : null}
                    <span className="truncate text-sm font-medium text-slate-200">
                      {(n.id === current?.id ? draft?.title : n.title) || 'Untitled'}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                    {snippet(n.id === current?.id ? draft?.body ?? n.body : n.body) || 'Empty note'}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-600">
                    <span>{relTime(n.updated_at)}</span>
                    {n.folder && folder === ALL && <span className="truncate">· {n.folder}</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Editor / viewer */}
        <div className="min-w-0">
          {folder === RECAPS && selectedRecap ? (
            <div className="card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    {selectedRecap.kind === 'week' ? `Week recap · ${longDay(selectedRecap.day)}` : `Day recap · ${longDay(selectedRecap.day)}`}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {selectedRecap.account_name ?? 'Account'} · read-only here
                  </p>
                </div>
                <Link
                  className="btn text-xs"
                  to={
                    selectedRecap.kind === 'week'
                      ? `/report/week/${selectedRecap.day}`
                      : `/journal?day=${selectedRecap.day}`
                  }
                >
                  {selectedRecap.kind === 'week' ? 'Open week review →' : 'Open in Journal →'}
                </Link>
              </div>
              <Markdown source={selectedRecap.body} />
            </div>
          ) : current && draft ? (
            <Editor
              note={current}
              draft={draft}
              folderNames={folderNames}
              view={view}
              setView={setView}
              saveState={saveState}
              onEdit={edit}
              onPin={() => togglePin(current)}
              onDelete={() => removeNote(current)}
              onSaveAsTemplate={async () => {
                const name = window.prompt('Template name', draft.title || 'My template')?.trim();
                if (!name) return;
                try {
                  await notebookApi.createTemplate(scope, name, draft.body);
                  loadTemplates();
                } catch (e: any) {
                  setErr(e?.message || 'Could not save template');
                }
              }}
              onError={setErr}
            />
          ) : (
            <div className="card flex min-h-[300px] flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-slate-400">
                {folder === RECAPS ? 'Pick a recap to read it.' : 'Pick a note, or start a new one.'}
              </p>
              {folder !== RECAPS && (
                <div className="flex flex-wrap justify-center gap-2">
                  <button className="btn btn-primary text-xs" onClick={() => newNote()}>
                    + Blank note
                  </button>
                  {templates.slice(0, 4).map((t) => (
                    <button key={t.id} className="btn text-xs" onClick={() => newNote(t)}>
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {templatesOpen && (
        <TemplatesModal
          templates={templates}
          scope={scope}
          onChanged={loadTemplates}
          onClose={() => setTemplatesOpen(false)}
          onUse={(t) => {
            setTemplatesOpen(false);
            newNote(t);
          }}
        />
      )}
    </div>
  );
}

function FolderRow({
  label,
  count,
  active,
  onClick,
  onRename,
  onDelete,
  muted,
  title,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  muted?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`group flex items-center gap-1 rounded px-2 py-1 ${
        active ? 'bg-cyan-500/10 text-cyan-300' : muted ? 'text-slate-500 hover:bg-slate-800/60' : 'text-slate-300 hover:bg-slate-800/60'
      }`}
      title={title}
    >
      <button className="min-w-0 flex-1 truncate text-left" onClick={onClick}>
        {label}
      </button>
      {onRename && (
        <button
          className="hidden text-[11px] text-slate-500 hover:text-slate-200 group-hover:inline"
          onClick={onRename}
          title="Rename folder"
        >
          ✎
        </button>
      )}
      {onDelete && (
        <button
          className="hidden text-[11px] text-slate-500 hover:text-red-400 group-hover:inline"
          onClick={onDelete}
          title="Delete folder (notes move to Unfiled)"
        >
          ✕
        </button>
      )}
      {count != null && <span className="num text-[11px] text-slate-500">{count}</span>}
    </div>
  );
}

// ---------------- editor ----------------

function Editor({
  note,
  draft,
  folderNames,
  view,
  setView,
  saveState,
  onEdit,
  onPin,
  onDelete,
  onSaveAsTemplate,
  onError,
}: {
  note: NotebookNote;
  draft: Draft;
  folderNames: string[];
  view: ViewMode;
  setView: (v: ViewMode) => void;
  saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  onEdit: (p: Partial<Draft>) => void;
  onPin: () => void;
  onDelete: () => void;
  onSaveAsTemplate: () => void;
  onError: (msg: string) => void;
}) {
  const [tradeInput, setTradeInput] = useState(draft.trade_id ? String(draft.trade_id) : '');
  useEffect(() => {
    setTradeInput(draft.trade_id ? String(draft.trade_id) : '');
  }, [note.id, draft.trade_id]);
  const commitTrade = () => {
    const next = tradeInput ? Number(tradeInput) : null;
    if (next !== draft.trade_id) onEdit({ trade_id: next });
  };
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <input
          className="min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold text-slate-100 placeholder:text-slate-600 focus:outline-none"
          placeholder="Untitled"
          value={draft.title}
          onChange={(e) => onEdit({ title: e.target.value })}
        />
        <span className="shrink-0 pt-1.5 text-[11px] text-slate-500">
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'dirty'
              ? 'Unsaved'
              : saveState === 'saved'
                ? 'Saved'
                : saveState === 'error'
                  ? <span className="text-red-400">Save failed</span>
                  : `Edited ${relTime(note.updated_at)}`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-slate-500">
          Folder
          <select
            className="input py-0.5 text-xs"
            value={draft.folder ?? ''}
            onChange={(e) => onEdit({ folder: e.target.value || null })}
          >
            <option value="">Unfiled</option>
            {folderNames.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-500" title="Link this note to a trade">
          Trade #
          <input
            className="input w-20 py-0.5 text-xs"
            inputMode="numeric"
            value={tradeInput}
            onChange={(e) => setTradeInput(e.target.value.replace(/\D/g, ''))}
            // Committed on blur/Enter: every keystroke would try to link a
            // half-typed id that may not exist.
            onBlur={commitTrade}
            onKeyDown={(e) => e.key === 'Enter' && commitTrade()}
          />
        </label>
        {draft.trade_id && (
          <Link className="text-cyan-400 hover:underline" to={`/trades/${draft.trade_id}`}>
            open →
          </Link>
        )}
        <label className="flex items-center gap-1 text-slate-500" title="Link this note to a journal day">
          Day
          <input
            type="date"
            className="input py-0.5 text-xs"
            value={draft.day ?? ''}
            onChange={(e) => onEdit({ day: e.target.value || null })}
          />
        </label>
        {draft.day && (
          <Link className="text-cyan-400 hover:underline" to={`/journal?day=${draft.day}`}>
            journal →
          </Link>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            className={`btn px-2 py-0.5 text-xs ${note.pinned ? 'border-amber-500/50 text-amber-400' : ''}`}
            onClick={onPin}
            title={note.pinned ? 'Unpin' : 'Pin to top'}
          >
            📌 {note.pinned ? 'Pinned' : 'Pin'}
          </button>
          <button className="btn px-2 py-0.5 text-xs" onClick={onSaveAsTemplate} title="Save this note's body as a template">
            Save as template
          </button>
          <button className="btn px-2 py-0.5 text-xs hover:text-red-400" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <MarkdownEditor
        value={draft.body}
        onChange={(body) => onEdit({ body })}
        view={view}
        setView={setView}
        onError={onError}
      />
    </div>
  );
}

function MarkdownEditor({
  value,
  onChange,
  view,
  setView,
  onError,
}: {
  value: string;
  onChange: (v: string) => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
  onError: (msg: string) => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(0);

  // Replace the selection, then restore a sensible caret/selection.
  const replaceSel = (fn: (sel: string) => { text: string; selStart: number; selEnd: number }) => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const r = fn(value.slice(s, e));
    onChange(value.slice(0, s) + r.text + value.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + r.selStart, s + r.selEnd);
    });
  };

  const wrap = (before: string, after: string, placeholder: string) =>
    replaceSel((sel) => {
      const inner = sel || placeholder;
      return { text: before + inner + after, selStart: before.length, selEnd: before.length + inner.length };
    });

  const prefixLines = (prefix: string | ((i: number) => string)) => {
    const el = ta.current;
    if (!el) return;
    const lineStart = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    const end = el.selectionEnd;
    const block = value.slice(lineStart, end);
    const next = block
      .split('\n')
      .map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l)
      .join('\n');
    onChange(value.slice(0, lineStart) + next + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart + next.length, lineStart + next.length);
    });
  };

  const insertText = (text: string) =>
    replaceSel(() => ({ text, selStart: text.length, selEnd: text.length }));

  const uploadFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return false;
    setUploading((n) => n + images.length);
    for (const f of images) {
      try {
        const url = await notebookApi.uploadImage(f);
        insertText(`\n![${f.name.replace(/[[\]]/g, '') || 'image'}](${url})\n`);
      } catch (e: any) {
        onError(e?.message || 'Image upload failed');
      } finally {
        setUploading((n) => n - 1);
      }
    }
    return true;
  };

  const fileInput = useRef<HTMLInputElement>(null);

  const tools: { label: string; title: string; run: () => void; cls?: string }[] = [
    { label: 'B', title: 'Bold (Ctrl+B)', run: () => wrap('**', '**', 'bold'), cls: 'font-bold' },
    { label: 'I', title: 'Italic (Ctrl+I)', run: () => wrap('*', '*', 'italic'), cls: 'italic' },
    { label: 'S', title: 'Strikethrough', run: () => wrap('~~', '~~', 'text'), cls: 'line-through' },
    { label: 'H2', title: 'Heading', run: () => prefixLines('## ') },
    { label: 'H3', title: 'Sub-heading', run: () => prefixLines('### ') },
    { label: '•', title: 'Bullet list', run: () => prefixLines('- ') },
    { label: '1.', title: 'Numbered list', run: () => prefixLines((i) => `${i + 1}. `) },
    { label: '☐', title: 'Checklist', run: () => prefixLines('- [ ] ') },
    { label: '❝', title: 'Quote', run: () => prefixLines('> ') },
    { label: '</>', title: 'Code', run: () => wrap('`', '`', 'code') },
    { label: '🔗', title: 'Link', run: () => wrap('[', '](https://)', 'text') },
    { label: '#', title: 'Link a trade: #id', run: () => wrap('#', '', '123') },
    { label: '@', title: 'Link a journal day: @YYYY-MM-DD', run: () => insertText(`@${new Date().toISOString().slice(0, 10)}`) },
    { label: '🖼', title: 'Insert image (or paste / drop one)', run: () => fileInput.current?.click() },
  ];

  const editor = (
    <div className="relative">
      <textarea
        ref={ta}
        className="input min-h-[420px] w-full resize-y font-mono text-[13px] leading-relaxed"
        value={value}
        placeholder={'Write in markdown…\n\n## Heading\n- bullet\n- [ ] task\n#123 links a trade, @2026-09-15 a day. Paste or drop screenshots.'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            wrap('**', '**', 'bold');
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
            e.preventDefault();
            wrap('*', '*', 'italic');
          } else if (e.key === 'Tab') {
            e.preventDefault();
            insertText('  ');
          }
        }}
        onPaste={async (e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.some((f) => f.type.startsWith('image/'))) {
            e.preventDefault();
            await uploadFiles(files);
          }
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) e.preventDefault();
        }}
        onDrop={async (e) => {
          const files = Array.from(e.dataTransfer.files);
          if (files.length) {
            e.preventDefault();
            await uploadFiles(files);
          }
        }}
      />
      {uploading > 0 && (
        <div className="absolute right-2 top-2 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
          Uploading {uploading} image{uploading === 1 ? '' : 's'}…
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {view !== 'preview' &&
          tools.map((t) => (
            <button
              key={t.title}
              type="button"
              title={t.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={t.run}
              className={`min-w-[28px] rounded border border-slate-800 px-1.5 py-0.5 text-xs text-slate-300 hover:border-slate-600 hover:text-slate-100 ${t.cls ?? ''}`}
            >
              {t.label}
            </button>
          ))}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-800 text-xs">
          {(['write', 'split', 'preview'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 font-semibold capitalize ${
                view === v ? 'bg-cyan-600 text-white' : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === 'write' ? (
        editor
      ) : view === 'preview' ? (
        <div className="min-h-[420px] rounded-lg border border-slate-800 bg-slate-900/20 p-4">
          <Markdown source={value} empty={<p className="text-sm text-slate-500">Nothing to preview.</p>} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {editor}
          <div className="max-h-[70vh] min-h-[420px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/20 p-4">
            <Markdown source={value} empty={<p className="text-sm text-slate-500">Preview appears here.</p>} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- templates ----------------

function TemplatesModal({
  templates,
  scope,
  onChanged,
  onClose,
  onUse,
}: {
  templates: NoteTemplate[];
  scope: NotebookScope;
  onChanged: () => void;
  onClose: () => void;
  onUse: (t: NoteTemplate) => void;
}) {
  const [selId, setSelId] = useState<number | 'new' | null>(templates[0]?.id ?? 'new');
  const sel = typeof selId === 'number' ? templates.find((t) => t.id === selId) ?? null : null;
  const [name, setName] = useState(sel?.name ?? '');
  const [body, setBody] = useState(sel?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    setName(sel?.name ?? '');
    setBody(sel?.body ?? '');
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!name.trim()) return setMsg('Name is required');
    setBusy(true);
    setMsg(null);
    try {
      if (selId === 'new') {
        const t = await notebookApi.createTemplate(scope, name.trim(), body);
        onChanged();
        setSelId(t.id);
      } else if (sel) {
        await notebookApi.updateTemplate(sel.id, { name: name.trim(), body });
        onChanged();
      }
      setMsg('Saved');
    } catch (e: any) {
      setMsg(e?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!sel || !window.confirm(`Delete template "${sel.name}"?`)) return;
    setBusy(true);
    try {
      await notebookApi.deleteTemplate(sel.id);
      onChanged();
      setSelId('new');
    } catch (e: any) {
      setMsg(e?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tj-modal fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="tj-modal-panel card flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Note templates"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Note templates</h2>
          <button className="text-slate-400 hover:text-slate-100" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div className="overflow-y-auto border-b border-slate-800 p-2 sm:border-b-0 sm:border-r">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelId(t.id)}
                className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                  selId === t.id ? 'bg-cyan-500/10 text-cyan-300' : 'text-slate-300 hover:bg-slate-800/60'
                }`}
              >
                {t.name}
              </button>
            ))}
            <button
              onClick={() => setSelId('new')}
              className={`mt-1 block w-full rounded px-2 py-1.5 text-left text-xs ${
                selId === 'new' ? 'bg-cyan-500/10 text-cyan-300' : 'text-cyan-400 hover:bg-slate-800/60'
              }`}
            >
              + New template
            </button>
          </div>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
            <input
              className="input"
              placeholder="Template name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Markdown · {'{{date}}'} becomes today's date</span>
              <button className="text-cyan-400 hover:underline" onClick={() => setPreview((p) => !p)}>
                {preview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {preview ? (
              <div className="min-h-[300px] rounded-lg border border-slate-800 p-3">
                <Markdown source={body} />
              </div>
            ) : (
              <textarea
                className="input min-h-[300px] w-full resize-y font-mono text-[13px]"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {sel && (
                  <button className="btn text-xs hover:text-red-400" onClick={remove} disabled={busy}>
                    Delete
                  </button>
                )}
                {msg && <span className="text-xs text-slate-400">{msg}</span>}
              </div>
              <div className="flex gap-2">
                {sel && (
                  <button className="btn text-xs" onClick={() => onUse({ ...sel, name, body })}>
                    New note from this
                  </button>
                )}
                <button className="btn btn-primary text-xs" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : selId === 'new' ? 'Create template' : 'Save template'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
