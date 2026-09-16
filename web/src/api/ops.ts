// Operational endpoints: backups, full export, import watch folder.
// Kept apart from client.ts so these features stay self-contained.

export type BackupInfo = {
  name: string;
  size: number;
  time: string;
  screenshots: number;
};

export type BackupsResponse = {
  dir: string;
  keep: number;
  auto: boolean;
  last_backup: string | null;
  backups: BackupInfo[];
};

export type BackupResult = BackupInfo & {
  missing_screenshots: number;
  pruned: string[];
};

export type WatchResult = {
  file: string;
  ok: boolean;
  at: string;
  account_id: number | null;
  inserted?: number;
  skipped?: number;
  error?: string;
  moved_to: string | null;
};

export type ImportWatchStatus = {
  enabled: boolean;
  dir: string | null;
  dir_source: 'env' | 'settings' | null;
  account_id: number | null;
  account_source: 'env' | 'settings' | null;
  dir_exists: boolean;
  running: boolean;
  interval_sec: number;
  last_scan: string | null;
  last_error: string | null;
  scanning: boolean;
  recent: WatchResult[];
};

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
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

export const opsApi = {
  listBackups: () => call<BackupsResponse>('/backups'),
  backupNow: () => call<BackupResult>('/backup', { method: 'POST' }),
  backupDownloadUrl: (name: string) => `/api/backups/${encodeURIComponent(name)}/download`,
  exportAllUrl: '/api/export/all',
  getWatch: () => call<ImportWatchStatus>('/import/watch'),
  saveWatch: (body: { dir?: string; account_id?: number | null }) =>
    call<ImportWatchStatus>('/import/watch', { method: 'PUT', body: JSON.stringify(body) }),
  scanWatch: () =>
    call<{ results: WatchResult[]; skipped?: string; status: ImportWatchStatus }>(
      '/import/watch/scan',
      { method: 'POST' }
    ),
};
