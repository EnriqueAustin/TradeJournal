import { useState } from 'react';
import { api } from '../../api/client';
import type { TradeDetail as TTradeDetail, Note as TNote } from '../../types';
import { formatDateTime } from '../../utils/format';

// One note: read view with Edit/Delete, or an inline editor. Notes are editable
// documents — a typo or a note on the wrong trade shouldn't be permanent.
function NoteRow({ note, onChanged }: { note: TNote; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [rules, setRules] = useState<boolean | null>(
    note.rules_followed == null ? null : !!note.rules_followed
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.updateNote(note.id, {
        body: body.trim(),
        rules_followed: rules == null ? null : rules ? 1 : 0,
      });
      setEditing(false);
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save note');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteNote(note.id);
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Failed to delete note');
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>
          {formatDateTime(note.created_at)}
          {note.updated_at && note.updated_at !== note.created_at ? ' · edited' : ''}
        </span>
        <div className="flex items-center gap-3">
          {note.rules_followed != null && (
            <span className={note.rules_followed ? 'text-emerald-400' : 'text-amber-400'}>
              {note.rules_followed ? 'Rules followed' : 'Rules broken'}
            </span>
          )}
          {!editing && (
            <>
              <button className="hover:text-slate-200" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="hover:text-red-400" onClick={remove} disabled={busy}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="input min-h-[70px] w-full resize-y"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={rules === true}
                onChange={(e) => setRules(e.target.checked ? true : false)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              Rules followed
            </label>
            <div className="flex gap-2">
              <button
                className="btn"
                onClick={() => {
                  setEditing(false);
                  setBody(note.body);
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy || !body.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-slate-200">{note.body}</p>
      )}
      {err && <p className="mt-1 text-sm text-red-400">{err}</p>}
    </div>
  );
}

export default function NotesPanel({
  trade,
  onChanged,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
}) {
  const [body, setBody] = useState('');
  const [rules, setRules] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.addNote(trade.id, body.trim(), rules ? 1 : 0);
      setBody('');
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Failed to add note');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">
        Notes ({trade.notes.length})
      </h2>
      <div className="mb-4 flex flex-col gap-3">
        {trade.notes.length === 0 && (
          <p className="text-sm text-slate-500">No notes yet.</p>
        )}
        {trade.notes.map((n) => (
          <NoteRow key={n.id} note={n} onChanged={onChanged} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <textarea
          className="input min-h-[80px] w-full resize-y"
          placeholder="Write a note about this trade…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={rules}
              onChange={(e) => setRules(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800"
            />
            Rules followed
          </label>
          <button
            className="btn btn-primary"
            onClick={add}
            disabled={busy || !body.trim()}
          >
            Add Note
          </button>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
      </div>
    </div>
  );
}
