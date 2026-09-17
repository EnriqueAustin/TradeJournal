// Profiles (per-trader account grouping) and read-only share links.
// Kept apart from client.ts so these features stay self-contained.

export type Profile = {
  id: number;
  name: string;
  colour: string | null;
  default_instrument: string | null;
  account_count: number;
  created_at: string;
};

export type ProfileInput = {
  name?: string;
  colour?: string | null;
  default_instrument?: string | null;
};

export type ShareKind = 'trade' | 'day' | 'week';

export type ShareLink = {
  token: string;
  kind: ShareKind;
  ref: string;
  account_id: number | null;
  account_name: string | null;
  include_notes: boolean;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  label: string;
  status: 'active' | 'expired' | 'revoked';
};

export type ShareInput = {
  kind: ShareKind;
  ref: string | number;
  account_id?: number | null;
  include_notes?: boolean;
  expires_in_days?: number | null;
};

export type PublicTrade = {
  id: number;
  instrument: string | null;
  direction: 'long' | 'short' | null;
  entry_time: string | null;
  exit_time: string | null;
  entry_price: number | null;
  exit_price: number | null;
  size: number | null;
  net_pnl: number | null;
  r_multiple: number | null;
  r_derived: number;
  session: string | null;
  is_be: number;
  hold_time_sec: number | null;
};

export type PublicKpis = {
  trade_count: number;
  net_pnl: number;
  win_rate: number;
  profit_factor: number | null;
  expectancy: number;
  total_r: number | null;
  avg_win: number;
  avg_loss: number;
};

type PublicBase = {
  ref: string;
  include_notes: boolean;
  created_at: string;
  expires_at: string | null;
  currency: string;
};

export type PublicShare =
  | (PublicBase & {
      kind: 'trade';
      trade: PublicTrade & {
        stop_price: number | null;
        target_price: number | null;
        mae: number | null;
        mfe: number | null;
        setup: string | null;
        tags: { category: string; name: string }[];
      };
      chart: {
        tf: string;
        bars: { t: string; open: number; high: number; low: number; close: number; volume: number | null }[];
      };
      notes: { body: string; created_at: string }[] | null;
    })
  | (PublicBase & {
      kind: 'day' | 'week';
      from: string;
      to: string;
      kpis: PublicKpis;
      trades: PublicTrade[];
      recap?: string | null;
      days?: { day: string; trade_count: number; net_pnl: number; recap: string | null }[];
    });

export class ShareError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, opts?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    });
  } catch {
    throw new ShareError('Cannot reach the API server.', 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ShareError(body?.error || `Request failed (${res.status})`, res.status);
  return body as T;
}

export const profilesApi = {
  list: () => call<Profile[]>('/profiles'),
  create: (body: ProfileInput) =>
    call<Profile>('/profiles', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: ProfileInput) =>
    call<Profile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => call<null>(`/profiles/${id}`, { method: 'DELETE' }),
  assignAccount: (accountId: number, profileId: number | null) =>
    call<unknown>(`/accounts/${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify({ profile_id: profileId }),
    }),
};

export const shareApi = {
  list: () => call<ShareLink[]>('/share'),
  create: (body: ShareInput) =>
    call<ShareLink>('/share', { method: 'POST', body: JSON.stringify(body) }),
  revoke: (token: string) => call<null>(`/share/${token}`, { method: 'DELETE' }),
  getPublic: (token: string) => call<PublicShare>(`/public/${encodeURIComponent(token)}`),
  urlFor: (token: string) => `${window.location.origin}/s/${token}`,
};

export const PROFILE_COLOURS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#60a5fa'];
