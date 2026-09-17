// Notebook: markdown notes in folders, saved templates, read-only journal
// recaps. Self-contained like api/profiles.ts.

export type NotebookNote = {
  id: number;
  profile_id: number | null;
  account_id: number | null;
  folder: string | null;
  title: string;
  body: string;
  body_format: string;
  pinned: 0 | 1;
  trade_id: number | null;
  day: string | null;
  created_at: string;
  updated_at: string;
};

export type NotebookNoteInput = Partial<
  Pick<NotebookNote, 'folder' | 'title' | 'body' | 'trade_id' | 'day'>
> & { pinned?: boolean; profile?: number | null; account?: number | null };

export type NotebookFolder = { id: number | null; name: string; builtin: boolean; count: number };
export type NotebookFolders = { folders: NotebookFolder[]; unfiled: number; total: number };

export type NoteTemplate = {
  id: number;
  profile_id: number | null;
  name: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type JournalRecap = {
  id: number;
  day: string;
  kind: 'day' | 'week';
  body: string;
  account_id: number | null;
  account_name: string | null;
  created_at: string;
  updated_at: string | null;
};

export type NotebookScope = { profile?: number | null; account?: number | null };

async function call<T>(path: string, opts?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    });
  } catch {
    throw new Error('Cannot reach the API server.');
  }
  if (res.status === 204) return null as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

// Notes/folders/templates are profile-scoped (an account implies its profile).
const scopeQs = (s: NotebookScope) => (s.profile != null ? { profile: s.profile } : {});

export const notebookApi = {
  listNotes: (scope: NotebookScope, opts: { folder?: string; q?: string } = {}) =>
    call<NotebookNote[]>(`/notebook/notes${qs({ ...scopeQs(scope), ...opts })}`),
  createNote: (body: NotebookNoteInput) =>
    call<NotebookNote>('/notebook/notes', { method: 'POST', body: JSON.stringify(body) }),
  updateNote: (id: number, body: NotebookNoteInput) =>
    call<NotebookNote>(`/notebook/notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteNote: (id: number) => call<null>(`/notebook/notes/${id}`, { method: 'DELETE' }),

  listFolders: (scope: NotebookScope) => call<NotebookFolders>(`/notebook/folders${qs(scopeQs(scope))}`),
  createFolder: (scope: NotebookScope, name: string) =>
    call<NotebookFolder>('/notebook/folders', {
      method: 'POST',
      body: JSON.stringify({ name, profile: scope.profile ?? null }),
    }),
  renameFolder: (id: number, name: string) =>
    call<NotebookFolder>(`/notebook/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteFolder: (id: number) => call<null>(`/notebook/folders/${id}`, { method: 'DELETE' }),

  listTemplates: (scope: NotebookScope) => call<NoteTemplate[]>(`/notebook/templates${qs(scopeQs(scope))}`),
  createTemplate: (scope: NotebookScope, name: string, body: string) =>
    call<NoteTemplate>('/notebook/templates', {
      method: 'POST',
      body: JSON.stringify({ name, body, profile: scope.profile ?? null }),
    }),
  updateTemplate: (id: number, body: { name?: string; body?: string }) =>
    call<NoteTemplate>(`/notebook/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTemplate: (id: number) => call<null>(`/notebook/templates/${id}`, { method: 'DELETE' }),

  listRecaps: (scope: NotebookScope, q?: string) =>
    call<JournalRecap[]>(`/notebook/recaps${qs({ account: scope.account, profile: scope.account == null ? scope.profile : null, q })}`),

  uploadImage: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/notebook/images', { method: 'POST', body: fd });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `Upload failed (${res.status})`);
    return body.url as string;
  },
};
