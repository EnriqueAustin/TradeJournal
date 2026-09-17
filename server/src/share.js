import crypto from 'node:crypto';
import { db } from './db.js';
import { summary } from './stats.js';
import { getBarsForTf, isKnownTf, tfMs } from './bars.js';

// Read-only share links. A link is an unguessable token (32 random bytes, hex)
// scoped to exactly one trade, day or week. GET /api/public/:token returns only
// that scope's data, and notes/recaps only when the link was created with
// include_notes. Only reachable by others if the app is exposed on a network.

const KINDS = new Set(['trade', 'day', 'week']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TOKEN_RE = /^[0-9a-f]{64}$/;

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

// Monday..Sunday (UTC) containing `day`.
export function weekRange(day) {
  const base = new Date(`${day}T00:00:00Z`);
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: isoDay(monday), to: isoDay(sunday) };
}

// Link status at `now`: revoked wins, then expiry.
export function linkStatus(link, now = new Date()) {
  if (link.revoked) return 'revoked';
  if (link.expires_at && new Date(link.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

export function createShareLink(body = {}, now = new Date()) {
  const kind = String(body.kind || '');
  if (!KINDS.has(kind)) return { error: 'kind must be trade, day or week' };
  let ref = body.ref == null ? '' : String(body.ref).trim();
  let accountId = null;
  if (kind === 'trade') {
    const trade = /^\d+$/.test(ref) ? db.prepare('SELECT id, account_id FROM trades WHERE id = ?').get(Number(ref)) : null;
    if (!trade) return { error: 'trade not found' };
    accountId = trade.account_id;
  } else {
    if (!DAY_RE.test(ref) || Number.isNaN(new Date(`${ref}T00:00:00Z`).getTime()))
      return { error: 'ref must be YYYY-MM-DD' };
    accountId = Number(body.account_id);
    if (!accountId || !db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(accountId))
      return { error: 'valid account_id required' };
    if (kind === 'week') ref = weekRange(ref).from;
  }
  let expiresAt = null;
  if (body.expires_in_days != null && body.expires_in_days !== '') {
    const days = Number(body.expires_in_days);
    if (!(days > 0)) return { error: 'expires_in_days must be positive' };
    expiresAt = new Date(now.getTime() + days * 86400000).toISOString();
  }
  const token = newToken();
  db.prepare(
    `INSERT INTO share_links (token, kind, ref, account_id, include_notes, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(token, kind, ref, accountId, body.include_notes ? 1 : 0, now.toISOString(), expiresAt);
  return { link: decorate(getLink(token), now) };
}

function getLink(token) {
  return db.prepare('SELECT * FROM share_links WHERE token = ?').get(token) ?? null;
}

// Add a human label + status for the management list.
function decorate(link, now = new Date()) {
  if (!link) return null;
  let label = '';
  const acct = link.account_id
    ? db.prepare('SELECT name FROM accounts WHERE id = ?').get(link.account_id)
    : null;
  if (link.kind === 'trade') {
    const t = db
      .prepare('SELECT instrument, direction, COALESCE(exit_time, entry_time) AS t FROM trades WHERE id = ?')
      .get(Number(link.ref));
    label = t
      ? `${t.instrument ?? ''} ${t.direction ?? ''} · ${String(t.t ?? '').slice(0, 10)}`.trim()
      : `Trade #${link.ref} (deleted)`;
  } else if (link.kind === 'day') {
    label = `Day ${link.ref}`;
  } else {
    label = `Week of ${link.ref}`;
  }
  return {
    ...link,
    include_notes: !!link.include_notes,
    revoked: !!link.revoked,
    account_name: acct?.name ?? null,
    label,
    status: linkStatus(link, now),
  };
}

export function listShareLinks(now = new Date()) {
  return db
    .prepare('SELECT * FROM share_links ORDER BY created_at DESC, rowid DESC')
    .all()
    .map((l) => decorate(l, now));
}

export function revokeShareLink(token) {
  if (!TOKEN_RE.test(String(token))) return false;
  return db.prepare('UPDATE share_links SET revoked = 1 WHERE token = ?').run(token).changes > 0;
}

// ---- public payloads (whitelisted fields only) ----

const TRADE_ROW = `id, instrument, direction, entry_time, exit_time, entry_price, exit_price,
  size, net_pnl, r_multiple, r_derived, session, is_be, hold_time_sec`;

function kpis(s) {
  return {
    trade_count: s.trade_count,
    net_pnl: s.net_pnl,
    win_rate: s.win_rate,
    profit_factor: s.profit_factor,
    expectancy: s.expectancy,
    total_r: s.total_r,
    avg_win: s.avg_win,
    avg_loss: s.avg_loss,
  };
}

// Bars around the trade on its preferred TF (default M5): `pad` bars either side.
export function tradeChart(trade, pad = 40) {
  const tf = trade.preferred_tf && isKnownTf(trade.preferred_tf) ? trade.preferred_tf : 'M5';
  const entry = trade.entry_time ? new Date(trade.entry_time).getTime() : null;
  const exit = trade.exit_time ? new Date(trade.exit_time).getTime() : entry;
  if (entry == null || !trade.instrument) return { tf, bars: [] };
  const span = (tfMs(tf) || 300000) * pad;
  const lo = entry - span;
  const hi = (exit ?? entry) + span;
  const { bars } = getBarsForTf(trade.instrument, tf);
  return {
    tf,
    bars: bars.filter((b) => {
      const t = new Date(b.t).getTime();
      return t >= lo && t <= hi;
    }),
  };
}

function tradePayload(link) {
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(Number(link.ref));
  if (!trade) return null;
  const pick = Object.fromEntries(
    TRADE_ROW.split(',').map((k) => k.trim()).map((k) => [k, trade[k]])
  );
  const acct = db.prepare('SELECT currency FROM accounts WHERE id = ?').get(trade.account_id);
  const setup = trade.setup_id
    ? db.prepare('SELECT name FROM setups WHERE id = ?').get(trade.setup_id)?.name ?? null
    : null;
  const tags = db
    .prepare(
      `SELECT t.category, t.name FROM tags t JOIN trade_tags tt ON tt.tag_id = t.id
       WHERE tt.trade_id = ? ORDER BY t.category, t.name`
    )
    .all(trade.id);
  return {
    trade: {
      ...pick,
      stop_price: trade.stop_price,
      target_price: trade.target_price,
      mae: trade.mae,
      mfe: trade.mfe,
      setup,
      tags,
    },
    currency: acct?.currency ?? 'USD',
    chart: tradeChart(trade),
    notes: link.include_notes
      ? db
          .prepare('SELECT body, created_at FROM notes WHERE trade_id = ? ORDER BY created_at')
          .all(trade.id)
      : null,
  };
}

function rangePayload(link) {
  const account = db.prepare('SELECT id, currency FROM accounts WHERE id = ?').get(link.account_id);
  if (!account) return null;
  const { from, to } = link.kind === 'week' ? weekRange(link.ref) : { from: link.ref, to: link.ref };
  const stats = summary({ account: account.id, from, to });
  const trades = db
    .prepare(
      `SELECT ${TRADE_ROW} FROM trades
       WHERE account_id = ? AND COALESCE(is_backtest, 0) = 0
         AND date(COALESCE(exit_time, entry_time)) BETWEEN date(?) AND date(?)
       ORDER BY COALESCE(entry_time, exit_time)`
    )
    .all(account.id, from, to);
  const recapFor = (day) =>
    db
      .prepare(
        'SELECT body FROM notes WHERE account_id = ? AND day = ? AND trade_id IS NULL AND kind IS NULL ORDER BY id LIMIT 1'
      )
      .get(account.id, day)?.body ?? null;
  const out = { from, to, currency: account.currency ?? 'USD', kpis: kpis(stats), trades };
  if (link.kind === 'day') {
    out.recap = link.include_notes ? recapFor(from) : null;
  } else {
    const days = [];
    const d = new Date(`${from}T00:00:00Z`);
    for (let i = 0; i < 7; i++) {
      const day = isoDay(d);
      const list = trades.filter((t) => String(t.exit_time ?? t.entry_time).slice(0, 10) === day);
      days.push({
        day,
        trade_count: list.length,
        net_pnl: list.reduce((s, t) => s + (t.net_pnl || 0), 0),
        recap: link.include_notes ? recapFor(day) : null,
      });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    out.days = days;
  }
  return out;
}

// → { status: 200|404|410, body }
export function publicShare(token, now = new Date()) {
  if (!TOKEN_RE.test(String(token))) return { status: 404, body: { error: 'link not found' } };
  const link = getLink(token);
  if (!link) return { status: 404, body: { error: 'link not found' } };
  const status = linkStatus(link, now);
  if (status !== 'active') return { status: 410, body: { error: `link ${status}` } };
  const data = link.kind === 'trade' ? tradePayload(link) : rangePayload(link);
  if (!data) return { status: 404, body: { error: 'shared item no longer exists' } };
  return {
    status: 200,
    body: {
      kind: link.kind,
      ref: link.ref,
      include_notes: !!link.include_notes,
      created_at: link.created_at,
      expires_at: link.expires_at,
      ...data,
    },
  };
}

export function registerShareRoutes(app) {
  app.get('/api/share', (req, res) => res.json(listShareLinks()));
  app.post('/api/share', (req, res) => {
    const r = createShareLink(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json(r.link);
  });
  app.delete('/api/share/:token', (req, res) => {
    if (!revokeShareLink(req.params.token)) return res.status(404).json({ error: 'link not found' });
    res.status(204).end();
  });
  app.get('/api/public/:token', (req, res) => {
    const r = publicShare(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.status).json(r.body);
  });
}
