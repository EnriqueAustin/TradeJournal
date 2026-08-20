import './env.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { PORT, EA_TOKEN } from './env.js';
import { db, migrate } from './db.js';
import { migrateResearch } from './research/schema.js';
import { researchRouter } from './research/routes.js';
import { initResearchWs } from './research/ws.js';
import { safeIngestOanda } from './research/ingest/oanda.js';
import { captureSnapshot } from './research/snapshot.js';
import { parseImport } from './import.js';
import { parseBarsCsv, getBarsForTf, upsertBars, TF_MINUTES, TF_MS, tfMs, isKnownTf } from './bars.js';
import { fetchOandaM1, fetchOandaCandles, oandaConfigured, oandaSymbol } from './marketdata.js';
import { aiReview, autoTagTrades, getAiConfig } from './ai.js';
import {
  safeRefresh,
  getNews,
  newsStatus,
  startNewsScheduler,
  ingestNews,
} from './calendar.js';
import {
  sessionFromTime,
  normalizeInstrument,
  parseBarTime,
  computeRMultiple,
  brokerIsoToUtc,
} from './util.js';
import {
  summary,
  equity,
  calendar,
  sessionStats,
  hourly,
  setupStats,
  holdtime,
  excursion,
  propStats,
  adherence,
  streaks,
  tilt,
  optimizer,
  portfolio,
  wickEdge,
} from './stats.js';

migrate();
migrateResearch();

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Signal research module (docs/signal/) — mounted under /api/research.
app.use('/api/research', researchRouter);

const upload = multer({ storage: multer.memoryStorage() });

// ---------- Screenshot storage ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, '..', 'data', 'screenshots');
fs.mkdirSync(screenshotsDir, { recursive: true });
app.use('/screenshots', express.static(screenshotsDir, { maxAge: '1d' }));

const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const screenshotUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, screenshotsDir),
    filename: (_req, file, cb) => {
      const ext = IMAGE_EXT[file.mimetype] || path.extname(file.originalname) || '.bin';
      cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('image files only'));
    cb(null, true);
  },
});

// ---------- helpers ----------
function insertTradeTx(t) {
  const stmt = db.prepare(`
    INSERT INTO trades
      (account_id, instrument, direction, entry_time, exit_time, entry_price,
       exit_price, size, gross_pnl, commission, swap, net_pnl, r_multiple,
       stop_price, target_price, mae, mfe, hold_time_sec, session, source, ext_id,
       setup_id, is_backtest, bt_session_id)
    VALUES
      (@account_id, @instrument, @direction, @entry_time, @exit_time, @entry_price,
       @exit_price, @size, @gross_pnl, @commission, @swap, @net_pnl, @r_multiple,
       @stop_price, @target_price, @mae, @mfe, @hold_time_sec, @session, @source, @ext_id,
       @setup_id, @is_backtest, @bt_session_id)
  `);
  const info = stmt.run({
    account_id: t.account_id,
    instrument: t.instrument,
    direction: t.direction,
    entry_time: t.entry_time,
    exit_time: t.exit_time,
    entry_price: t.entry_price,
    exit_price: t.exit_price,
    size: t.size,
    gross_pnl: t.gross_pnl,
    commission: t.commission,
    swap: t.swap,
    net_pnl: t.net_pnl,
    r_multiple: t.r_multiple ?? null,
    stop_price: t.stop_price ?? null,
    target_price: t.target_price ?? null,
    mae: t.mae ?? null,
    mfe: t.mfe ?? null,
    hold_time_sec: t.hold_time_sec ?? null,
    session: t.session,
    source: t.source,
    ext_id: t.ext_id ?? null,
    setup_id: t.setup_id ?? null,
    is_backtest: t.is_backtest ? 1 : 0,
    bt_session_id: t.bt_session_id ?? null,
  });
  const tradeId = info.lastInsertRowid;
  if (t._executions && t._executions.length) {
    const es = db.prepare(
      `INSERT INTO executions (trade_id, exec_time, price, size, side, profit, commission, swap)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of t._executions) {
      es.run(
        tradeId,
        e.exec_time,
        e.price,
        e.size,
        e.side,
        e.profit ?? null,
        e.commission ?? null,
        e.swap ?? null
      );
    }
  }

  if (!t.is_backtest && t.instrument) {
    try {
      const entryMs = t.entry_time ? new Date(t.entry_time).getTime() : Date.now();
      captureSnapshot(tradeId, t.instrument, entryMs);
    } catch (_) { /* never block trade insertion */ }
  }

  return tradeId;
}

function accountExists(id) {
  return !!db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(id);
}

function removeScreenshotFiles(rows) {
  for (const row of rows) {
    if (row.url && row.url.startsWith('/screenshots/')) {
      const file = path.join(screenshotsDir, path.basename(row.url));
      fs.unlink(file, () => {});
    }
  }
}

// ---------- Accounts ----------
app.get('/api/accounts', (req, res) => {
  res.json(db.prepare('SELECT * FROM accounts ORDER BY id').all());
});

app.post('/api/accounts', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare(
      `INSERT INTO accounts
        (name, broker, platform, account_type, currency, starting_balance,
         prop_daily_loss, prop_max_dd, prop_target,
         prop_firm, prop_plan, prop_phase, prop_dd_type,
         prop_min_days, prop_profit_split, prop_news_window_min,
         prop_weekend_hold, prop_consistency_pct,
         prop_min_hold_sec, prop_hold_deduct_threshold_pct,
         prop_safety_buffer_pct, prop_max_inactivity_days)
       VALUES (@name,@broker,@platform,@account_type,@currency,@starting_balance,
               @prop_daily_loss,@prop_max_dd,@prop_target,
               @prop_firm,@prop_plan,@prop_phase,@prop_dd_type,
               @prop_min_days,@prop_profit_split,@prop_news_window_min,
               @prop_weekend_hold,@prop_consistency_pct,
               @prop_min_hold_sec,@prop_hold_deduct_threshold_pct,
               @prop_safety_buffer_pct,@prop_max_inactivity_days)`
    )
    .run({
      name: b.name,
      broker: b.broker ?? null,
      platform: b.platform ?? null,
      account_type: b.account_type ?? null,
      currency: b.currency ?? 'USD',
      starting_balance: b.starting_balance ?? 0,
      prop_daily_loss: b.prop_daily_loss ?? null,
      prop_max_dd: b.prop_max_dd ?? null,
      prop_target: b.prop_target ?? null,
      prop_firm: b.prop_firm ?? null,
      prop_plan: b.prop_plan ?? null,
      prop_phase: b.prop_phase ?? 0,
      prop_dd_type: b.prop_dd_type ?? null,
      prop_min_days: b.prop_min_days ?? null,
      prop_profit_split: b.prop_profit_split ?? null,
      prop_news_window_min: b.prop_news_window_min ?? null,
      prop_weekend_hold: b.prop_weekend_hold ?? null,
      prop_consistency_pct: b.prop_consistency_pct ?? null,
      prop_min_hold_sec: b.prop_min_hold_sec ?? null,
      prop_hold_deduct_threshold_pct: b.prop_hold_deduct_threshold_pct ?? null,
      prop_safety_buffer_pct: b.prop_safety_buffer_pct ?? null,
      prop_max_inactivity_days: b.prop_max_inactivity_days ?? null,
    });
  res.status(201).json(
    db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid)
  );
});

app.patch('/api/accounts/:id', (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: 'account not found' });
  const b = req.body || {};
  const EDIT = [
    'name',
    'broker',
    'platform',
    'account_type',
    'currency',
    'starting_balance',
    'prop_daily_loss',
    'prop_max_dd',
    'prop_target',
    'prop_firm',
    'prop_plan',
    'prop_phase',
    'prop_dd_type',
    'prop_min_days',
    'prop_profit_split',
    'prop_news_window_min',
    'prop_weekend_hold',
    'prop_consistency_pct',
    'prop_min_hold_sec',
    'prop_hold_deduct_threshold_pct',
    'prop_safety_buffer_pct',
    'prop_max_inactivity_days',
    'broker_tz',
  ];
  const sets = [];
  const params = { id };
  for (const k of EDIT) {
    if (k in b) {
      sets.push(`${k} = @${k}`);
      params[k] = b[k];
    }
  }
  if (sets.length)
    db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
});

// POST /api/accounts/:id/realign-times — one-shot: shift this account's existing
// trade + execution times from broker_tz wall-clock into true UTC. Guarded by
// accounts.times_realigned so it can never double-apply.
app.post('/api/accounts/:id/realign-times', (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: 'account not found' });
  const tz = account.broker_tz;
  if (!tz || tz === 'UTC')
    return res.status(400).json({ error: 'account has no broker_tz to convert from' });
  if (account.times_realigned)
    return res.json({ realigned: 0, note: 'already realigned', broker_tz: tz });

  const trades = db
    .prepare('SELECT id, entry_time, exit_time FROM trades WHERE account_id = ?')
    .all(id);
  const upT = db.prepare(
    'UPDATE trades SET entry_time=@entry_time, exit_time=@exit_time, session=@session WHERE id=@id'
  );
  const exSel = db.prepare('SELECT id, exec_time FROM executions WHERE trade_id = ?');
  const upE = db.prepare('UPDATE executions SET exec_time=@exec_time WHERE id=@id');

  let n = 0;
  const tx = db.transaction(() => {
    for (const t of trades) {
      const entry = brokerIsoToUtc(t.entry_time, tz);
      const exit = brokerIsoToUtc(t.exit_time, tz);
      upT.run({
        id: t.id,
        entry_time: entry,
        exit_time: exit,
        session: entry ? sessionFromTime(entry) : null,
      });
      for (const e of exSel.all(t.id))
        upE.run({ id: e.id, exec_time: brokerIsoToUtc(e.exec_time, tz) });
      n++;
    }
    db.prepare('UPDATE accounts SET times_realigned = 1 WHERE id = ?').run(id);
  });
  tx();
  res.json({ realigned: n, broker_tz: tz });
});

// GET /api/accounts/:id/time-check — safety net. For recent trades on supported
// instruments, checks whether each entry fill price lands inside the OANDA M1
// candle at its UTC entry time, and reports the time-shift (minutes) that best
// fits. best_offset_min === 0 means trades are aligned with the price data.
app.get('/api/accounts/:id/time-check', (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: 'account not found' });

  const trades = db
    .prepare(
      `SELECT instrument, entry_time, entry_price FROM trades
       WHERE account_id = ? AND entry_time IS NOT NULL AND entry_price IS NOT NULL
       ORDER BY entry_time DESC LIMIT 50`
    )
    .all(id);

  const OFFSETS = [-180, -120, -60, 0, 60, 120, 180];
  const tol = 0.05;
  const scores = Object.fromEntries(OFFSETS.map((o) => [o, 0]));
  const barCache = new Map();
  const barsFor = (inst) => {
    if (!barCache.has(inst)) barCache.set(inst, getBarsForTf(inst, 'M1').bars);
    return barCache.get(inst);
  };

  let checked = 0;
  for (const t of trades) {
    const inst = normalizeInstrument(t.instrument);
    if (!oandaSymbol(inst)) continue;
    const bars = barsFor(inst);
    if (!bars.length) continue;
    const et = new Date(t.entry_time).getTime();
    checked++;
    for (const o of OFFSETS) {
      const target = et + o * 60000;
      const b = bars.find((x) => {
        const bt = new Date(x.t).getTime();
        return target >= bt && target < bt + 60000;
      });
      if (b && t.entry_price >= b.low - tol && t.entry_price <= b.high + tol)
        scores[o]++;
    }
  }

  let best = 0;
  let bestScore = -1;
  for (const o of OFFSETS)
    if (scores[o] > bestScore) {
      bestScore = scores[o];
      best = o;
    }
  // No offset fits any fill → inconclusive (bad prices or no bar coverage),
  // not a real misalignment. Only claim aligned/off when something actually fit.
  const inconclusive = checked === 0 || bestScore <= 0;
  res.json({
    checked,
    scores,
    fit_at_best: Math.max(0, bestScore),
    best_offset_min: inconclusive ? null : best,
    fit_at_zero: scores[0],
    aligned: inconclusive ? null : best === 0,
  });
});

app.delete('/api/accounts/:id', (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: 'account not found' });

  const tx = db.transaction((accountId) => {
    const screenshots = db
      .prepare(
        `SELECT s.url
         FROM screenshots s
         JOIN trades t ON t.id = s.trade_id
         WHERE t.account_id = ?`
      )
      .all(accountId);

    db.prepare('DELETE FROM live_positions WHERE account_id = ?').run(accountId);
    db.prepare('DELETE FROM daily_plans WHERE account_id = ?').run(accountId);
    db.prepare('DELETE FROM trades WHERE account_id = ?').run(accountId);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
    return screenshots;
  });

  const screenshots = tx(id);
  removeScreenshotFiles(screenshots);
  res.status(204).end();
});

// ---------- Setups (Playbook) ----------
app.get('/api/setups', (req, res) => {
  res.json(db.prepare('SELECT * FROM setups ORDER BY name').all());
});

app.post('/api/setups', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim())
    return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare(
      `INSERT INTO setups (name, instrument, rules)
       VALUES (@name, @instrument, @rules)`
    )
    .run({
      name: String(b.name).trim(),
      instrument: b.instrument ? normalizeInstrument(b.instrument) : null,
      rules: b.rules ?? null,
    });
  res
    .status(201)
    .json(db.prepare('SELECT * FROM setups WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/setups/:id', (req, res) => {
  const id = Number(req.params.id);
  const setup = db.prepare('SELECT * FROM setups WHERE id = ?').get(id);
  if (!setup) return res.status(404).json({ error: 'setup not found' });
  const b = req.body || {};
  const EDIT = ['name', 'instrument', 'rules'];
  const sets = [];
  const params = { id };
  for (const k of EDIT) {
    if (k in b) {
      sets.push(`${k} = @${k}`);
      params[k] =
        k === 'instrument'
          ? b.instrument
            ? normalizeInstrument(b.instrument)
            : null
          : b[k];
    }
  }
  if (sets.length)
    db.prepare(`UPDATE setups SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json(db.prepare('SELECT * FROM setups WHERE id = ?').get(id));
});

app.delete('/api/setups/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM setups WHERE id = ?').get(id))
    return res.status(404).json({ error: 'setup not found' });
  // Detach from any trades, then delete the setup.
  db.prepare('UPDATE trades SET setup_id = NULL WHERE setup_id = ?').run(id);
  db.prepare('DELETE FROM setups WHERE id = ?').run(id);
  res.status(204).end();
});

// ---------- Trades ----------
app.get('/api/trades', (req, res) => {
  const q = req.query;
  const clauses = ['COALESCE(is_backtest, 0) = 0'];
  const params = {};
  if (q.account) {
    clauses.push('account_id = @account');
    params.account = Number(q.account);
  }
  if (q.instrument) {
    clauses.push('instrument = @instrument');
    params.instrument = q.instrument;
  }
  if (q.session) {
    clauses.push('session = @session');
    params.session = q.session;
  }
  if (q.setup) {
    clauses.push('setup_id = @setup');
    params.setup = Number(q.setup);
  }
  if (q.from) {
    clauses.push("date(COALESCE(exit_time, entry_time)) >= date(@from)");
    params.from = q.from;
  }
  if (q.to) {
    clauses.push("date(COALESCE(exit_time, entry_time)) <= date(@to)");
    params.to = q.to;
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM trades ${where}`)
    .get(params).c;
  const limit = q.limit ? Math.max(0, Number(q.limit)) : 100;
  const offset = q.offset ? Math.max(0, Number(q.offset)) : 0;
  const rows = db
    .prepare(
      `SELECT * FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) DESC, id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset });
  res.json({ rows, total });
});

app.get('/api/trades/:id', (req, res) => {
  const id = Number(req.params.id);
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!trade) return res.status(404).json({ error: 'trade not found' });
  const executions = db
    .prepare('SELECT * FROM executions WHERE trade_id = ? ORDER BY exec_time')
    .all(id);
  const tags = db
    .prepare(
      `SELECT t.* FROM tags t
       JOIN trade_tags tt ON tt.tag_id = t.id
       WHERE tt.trade_id = ?`
    )
    .all(id);
  const notes = db
    .prepare('SELECT * FROM notes WHERE trade_id = ? ORDER BY created_at')
    .all(id);
  const screenshots = db
    .prepare('SELECT * FROM screenshots WHERE trade_id = ?')
    .all(id);
  const wick = db.prepare('SELECT * FROM trade_wick WHERE trade_id = ?').get(id) ?? null;
  res.json({ ...trade, executions, tags, notes, screenshots, wick });
});

// Allowed values for the structured wick-setup fields.
const WICK_LEVELS = new Set([
  'asian_high', 'asian_low', 'london_high', 'london_low',
  'pdh', 'pdl', 'ny_open', 'equal_highs', 'equal_lows', 'other',
]);
const WICK_SESSIONS = new Set(['asia', 'london', 'ny', 'off']);

// PUT /api/trades/:id/wick — upsert the structured wick-fill setup tags.
// Any field may be null to clear it. Sending an all-null body removes the row.
app.put('/api/trades/:id/wick', express.json(), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id))
    return res.status(404).json({ error: 'trade not found' });
  const b = req.body || {};

  const swept = b.swept_level ?? null;
  const session = b.strat_session ?? null;
  if (swept != null && !WICK_LEVELS.has(swept))
    return res.status(400).json({ error: `invalid swept_level: ${swept}` });
  if (session != null && !WICK_SESSIONS.has(session))
    return res.status(400).json({ error: `invalid strat_session: ${session}` });

  let fill = b.fill_pct == null || b.fill_pct === '' ? null : Number(b.fill_pct);
  if (fill != null) {
    if (Number.isNaN(fill)) return res.status(400).json({ error: 'fill_pct must be a number' });
    fill = Math.max(0, Math.min(100, fill));
  }
  const fakeout = b.fakeout == null ? null : (b.fakeout ? 1 : 0);

  // No data at all → clear the row.
  if (swept == null && session == null && fill == null && fakeout == null) {
    db.prepare('DELETE FROM trade_wick WHERE trade_id = ?').run(id);
    return res.json({ trade_id: id, wick: null });
  }

  db.prepare(
    `INSERT INTO trade_wick (trade_id, swept_level, strat_session, fill_pct, fakeout, updated_at)
     VALUES (@id, @swept, @session, @fill, @fakeout, datetime('now'))
     ON CONFLICT(trade_id) DO UPDATE SET
       swept_level = excluded.swept_level,
       strat_session = excluded.strat_session,
       fill_pct = excluded.fill_pct,
       fakeout = excluded.fakeout,
       updated_at = excluded.updated_at`
  ).run({ id, swept, session, fill, fakeout });

  res.json({ trade_id: id, wick: db.prepare('SELECT * FROM trade_wick WHERE trade_id = ?').get(id) });
});

const EDITABLE = new Set([
  'stop_price',
  'target_price',
  'mae',
  'mfe',
  'setup_id',
  'instrument',
  'direction',
  'entry_price',
  'exit_price',
  'size',
  'preferred_tf',
]);

app.patch('/api/trades/:id', (req, res) => {
  const id = Number(req.params.id);
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!trade) return res.status(404).json({ error: 'trade not found' });
  const b = req.body || {};
  // Validate setup_id: must be null or reference an existing setup.
  if ('setup_id' in b && b.setup_id != null) {
    if (!db.prepare('SELECT 1 FROM setups WHERE id = ?').get(Number(b.setup_id)))
      return res.status(400).json({ error: 'unknown setup_id' });
  }
  const sets = [];
  const params = { id };
  for (const [k, v] of Object.entries(b)) {
    if (EDITABLE.has(k)) {
      sets.push(`${k} = @${k}`);
      params[k] = k === 'setup_id' ? (v == null ? null : Number(v)) : v;
    }
  }
  if (sets.length) {
    db.prepare(`UPDATE trades SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }
  // recompute r_multiple if stop_price present (uses realized $/point, so it's
  // correct across instruments with different contract multipliers)
  const updated = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (updated.stop_price != null && updated.entry_price != null) {
    const r = computeRMultiple(updated);
    db.prepare('UPDATE trades SET r_multiple = ? WHERE id = ?').run(r, id);
  }
  res.json(db.prepare('SELECT * FROM trades WHERE id = ?').get(id));
});

// ---------- Tags ----------
app.post('/api/trades/:id/tags', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id))
    return res.status(404).json({ error: 'trade not found' });
  const { category, name } = req.body || {};
  if (!category || !name)
    return res.status(400).json({ error: 'category and name are required' });
  db.prepare(
    'INSERT OR IGNORE INTO tags (category, name) VALUES (?, ?)'
  ).run(category, name);
  const tag = db
    .prepare('SELECT * FROM tags WHERE category = ? AND name = ?')
    .get(category, name);
  db.prepare(
    'INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)'
  ).run(id, tag.id);
  res.status(201).json(tag);
});

app.delete('/api/trades/:id/tags/:tagId', (req, res) => {
  const id = Number(req.params.id);
  const tagId = Number(req.params.tagId);
  db.prepare('DELETE FROM trade_tags WHERE trade_id = ? AND tag_id = ?').run(
    id,
    tagId
  );
  res.status(204).end();
});

// ---------- Notes ----------
app.post('/api/trades/:id/notes', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id))
    return res.status(404).json({ error: 'trade not found' });
  const { body, rules_followed } = req.body || {};
  if (body === undefined) return res.status(400).json({ error: 'body is required' });
  const info = db
    .prepare(
      'INSERT INTO notes (trade_id, body, rules_followed) VALUES (?, ?, ?)'
    )
    .run(id, body, rules_followed === undefined ? null : rules_followed ? 1 : 0);
  res
    .status(201)
    .json(db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- Daily Plans ----------
function resolveAccountId(qOrBody) {
  if (qOrBody.account_id) return Number(qOrBody.account_id);
  if (qOrBody.account) return Number(qOrBody.account);
  return db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get()?.id;
}

app.get('/api/plans', (req, res) => {
  const accountId = resolveAccountId(req.query);
  if (!accountId || !accountExists(accountId))
    return res.status(400).json({ error: 'valid account required' });
  const day = req.query.day || new Date().toISOString().slice(0, 10);
  const row = db
    .prepare('SELECT * FROM daily_plans WHERE account_id = ? AND day = ?')
    .get(accountId, day);
  res.json(row || { account_id: accountId, day, bias: null, key_levels: null, risk_cap: null, checklist_json: null, notes: null });
});

app.put('/api/plans', (req, res) => {
  const b = req.body || {};
  const accountId = resolveAccountId(b);
  if (!accountId || !accountExists(accountId))
    return res.status(400).json({ error: 'valid account required' });
  const day = b.day || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    return res.status(400).json({ error: 'day must be YYYY-MM-DD' });

  const checklist = b.checklist_json
    ? typeof b.checklist_json === 'string'
      ? b.checklist_json
      : JSON.stringify(b.checklist_json)
    : null;

  db.prepare(
    `INSERT INTO daily_plans
       (account_id, day, bias, key_levels, risk_cap, checklist_json, notes, updated_at)
     VALUES (@account_id, @day, @bias, @key_levels, @risk_cap, @checklist_json, @notes, datetime('now'))
     ON CONFLICT(account_id, day) DO UPDATE SET
       bias = excluded.bias,
       key_levels = excluded.key_levels,
       risk_cap = excluded.risk_cap,
       checklist_json = excluded.checklist_json,
       notes = excluded.notes,
       updated_at = datetime('now')`
  ).run({
    account_id: accountId,
    day,
    bias: b.bias ?? null,
    key_levels: b.key_levels ?? null,
    risk_cap: b.risk_cap ?? null,
    checklist_json: checklist,
    notes: b.notes ?? null,
  });
  const row = db
    .prepare('SELECT * FROM daily_plans WHERE account_id = ? AND day = ?')
    .get(accountId, day);
  res.json(row);
});

// ---------- Screenshots ----------
app.post('/api/trades/:id/screenshots', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id))
    return res.status(404).json({ error: 'trade not found' });

  screenshotUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: String(err.message || err) });
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const url = `/screenshots/${req.file.filename}`;
    const info = db
      .prepare('INSERT INTO screenshots (trade_id, url) VALUES (?, ?)')
      .run(id, url);
    res
      .status(201)
      .json(db.prepare('SELECT * FROM screenshots WHERE id = ?').get(info.lastInsertRowid));
  });
});

app.delete('/api/trades/:id/screenshots/:sid', (req, res) => {
  const id = Number(req.params.id);
  const sid = Number(req.params.sid);
  const row = db
    .prepare('SELECT * FROM screenshots WHERE id = ? AND trade_id = ?')
    .get(sid, id);
  if (!row) return res.status(404).json({ error: 'screenshot not found' });
  db.prepare('DELETE FROM screenshots WHERE id = ?').run(sid);
  // Best-effort file cleanup for locally-stored screenshots.
  if (row.url && row.url.startsWith('/screenshots/')) {
    const file = path.join(screenshotsDir, path.basename(row.url));
    fs.unlink(file, () => {});
  }
  res.status(204).end();
});

// ---------- Stats ----------
app.get('/api/stats/summary', (req, res) => res.json(summary(req.query)));
app.get('/api/stats/equity', (req, res) => res.json(equity(req.query)));
app.get('/api/stats/calendar', (req, res) => res.json(calendar(req.query)));
app.get('/api/stats/session', (req, res) => res.json(sessionStats(req.query)));
app.get('/api/stats/hourly', (req, res) => res.json(hourly(req.query)));
app.get('/api/stats/setup', (req, res) => res.json(setupStats(req.query)));
app.get('/api/stats/holdtime', (req, res) => res.json(holdtime(req.query)));
app.get('/api/stats/excursion', (req, res) => res.json(excursion(req.query)));
app.get('/api/stats/prop', (req, res) => res.json(propStats(req.query)));
app.get('/api/stats/adherence', (req, res) => res.json(adherence(req.query)));
app.get('/api/stats/streaks', (req, res) => res.json(streaks(req.query)));
app.get('/api/stats/tilt', (req, res) => res.json(tilt(req.query)));
app.get('/api/stats/wick', (req, res) => res.json(wickEdge(req.query)));
app.get('/api/stats/optimizer', (req, res) => res.json(optimizer(req.query)));
app.get('/api/stats/portfolio', (req, res) => res.json(portfolio(req.query)));

// ---------- Economic calendar / news ----------
app.get('/api/news', (req, res) => res.json(getNews(req.query)));
app.get('/api/news/status', (req, res) => res.json(newsStatus()));
app.post('/api/news/refresh', async (req, res) => {
  const feeds = req.body?.feeds;
  const result = await safeRefresh(
    Array.isArray(feeds) && feeds.length ? feeds : undefined
  );
  if (result?.error) {
    return res
      .status(502)
      .json({ error: `News refresh failed: ${result.error}`, status: newsStatus() });
  }
  res.json({ ...result, status: newsStatus() });
});

// Ingest raw ForexFactory JSON fetched by a client on a residential IP (the
// server's own outbound IP is Cloudflare-blocked). Body is either a bare FF
// array or { thisweek:[...], nextweek:[...] }. Uses a larger body limit than
// the global parser since a full week's feed can exceed the 100kb default.
app.post('/api/news/ingest', express.json({ limit: '10mb' }), (req, res) => {
  try {
    const result = ingestNews(req.body);
    res.json({ ...result, status: newsStatus() });
  } catch (e) {
    res.status(400).json({ error: `News ingest failed: ${e.message}` });
  }
});

// ---------- Import ----------
// Convert a parsed trade's broker-local times (stored wall-clock-as-UTC) into
// true UTC using the account's broker_tz, re-deriving session. Mutates + returns
// the trade. No-op when tz is empty/UTC.
function brokerTimesToUtc(trade, tz) {
  if (!tz || tz === 'UTC') return trade;
  if (trade.entry_time) trade.entry_time = brokerIsoToUtc(trade.entry_time, tz);
  if (trade.exit_time) trade.exit_time = brokerIsoToUtc(trade.exit_time, tz);
  if (Array.isArray(trade._executions)) {
    for (const e of trade._executions) {
      if (e.exec_time) e.exec_time = brokerIsoToUtc(e.exec_time, tz);
    }
  }
  if (trade.entry_time) trade.session = sessionFromTime(trade.entry_time);
  return trade;
}

// Merge padded per-trade windows per instrument, then pull M1 from OANDA for
// each merged span and upsert. No-op (returns null) when OANDA isn't configured
// so imports never fail on a missing token / network hiccup.
// Pad enough M1 either side of a trade to build the largest replay timeframe's
// window contiguously. Replay shows up to H1 (60m) padded 20 bars = 20h each
// side; without this much M1, aggregated M30/H1 bars near the trade are too few
// and windowBars splices in bars from other days, leaving a visual gap. 26h
// covers H1×20 with margin (still one OANDA chunk).
const BAR_FETCH_PAD_MS = 26 * 60 * 60 * 1000;

// Finest OANDA candle (5-second), fetched for the focus instrument only over a
// tight window around each trade — enough to replay/backtest the entry at
// sub-minute resolution without the storage of a wide S5 span.
const FINE_TF = 'S5';
const FINE_SYMBOLS = new Set(['XAUUSD']);
const FINE_PAD_MS = 3 * 60 * 60 * 1000; // 3h either side

// Pull S5 bars around each gold trade into price_bars. Best-effort, gold-only.
async function autoFetchFineBars(trades) {
  if (!oandaConfigured()) return null;
  const byInst = new Map();
  for (const t of trades) {
    const inst = normalizeInstrument(t.instrument);
    if (!FINE_SYMBOLS.has(inst) || !oandaSymbol(inst)) continue;
    const times = [t.entry_time, t.exit_time]
      .map((v) => (v ? new Date(v).getTime() : null))
      .filter((v) => v != null && !Number.isNaN(v));
    if (!times.length) continue;
    if (!byInst.has(inst)) byInst.set(inst, []);
    byInst.get(inst).push([Math.min(...times) - FINE_PAD_MS, Math.max(...times) + FINE_PAD_MS]);
  }

  const out = [];
  for (const [inst, ivals] of byInst) {
    ivals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of ivals) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([...iv]);
    }
    let fetched = 0;
    let upserted = 0;
    let error = null;
    try {
      for (const [lo, hi] of merged) {
        const bars = await fetchOandaCandles(inst, new Date(lo), new Date(hi), FINE_TF);
        fetched += bars.length;
        upserted += upsertBars(inst, FINE_TF, bars);
      }
    } catch (e) {
      error = String(e.message || e);
    }
    out.push({ instrument: inst, tf: FINE_TF, fetched, upserted, ...(error ? { error } : {}) });
  }
  return out;
}

async function autoFetchBarsForTrades(trades) {
  if (!oandaConfigured()) return null;
  const pad = BAR_FETCH_PAD_MS;
  const byInst = new Map();
  for (const t of trades) {
    const inst = normalizeInstrument(t.instrument);
    if (!oandaSymbol(inst)) continue;
    const times = [t.entry_time, t.exit_time]
      .map((v) => (v ? new Date(v).getTime() : null))
      .filter((v) => v != null && !Number.isNaN(v));
    if (!times.length) continue;
    if (!byInst.has(inst)) byInst.set(inst, []);
    byInst.get(inst).push([Math.min(...times) - pad, Math.max(...times) + pad]);
  }

  const out = [];
  for (const [inst, ivals] of byInst) {
    ivals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of ivals) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([...iv]);
    }
    let fetched = 0;
    let upserted = 0;
    let error = null;
    try {
      for (const [lo, hi] of merged) {
        const bars = await fetchOandaM1(inst, new Date(lo), new Date(hi));
        fetched += bars.length;
        upserted += upsertBars(inst, 'M1', bars);
      }
    } catch (e) {
      error = String(e.message || e);
    }
    out.push({ instrument: inst, fetched, upserted, ...(error ? { error } : {}) });
  }

  // Also pull S5 for the focus instrument so replay/backtest can zoom to the
  // finest resolution. Never let an S5 hiccup fail the M1 result.
  try {
    const fine = await autoFetchFineBars(trades);
    if (fine?.length) out.push(...fine);
  } catch { /* best-effort */ }

  return out;
}

app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    let accountId = req.body.account ? Number(req.body.account) : null;
    if (!accountId) {
      accountId = db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get()?.id;
    }
    if (!accountId || !accountExists(accountId))
      return res.status(400).json({ error: 'valid account is required' });

    const { trades } = parseImport(req.file.buffer, {
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      accountId,
    });

    // Broker server time → true UTC (so trades align with UTC price bars).
    const brokerTz = db
      .prepare('SELECT broker_tz FROM accounts WHERE id = ?')
      .get(accountId)?.broker_tz;
    for (const t of trades) brokerTimesToUtc(t, brokerTz);

    let inserted = 0;
    let skipped = 0;
    const tx = db.transaction((list) => {
      for (const t of list) {
        if (
          t.ext_id != null &&
          db
            .prepare('SELECT 1 FROM trades WHERE account_id = ? AND ext_id = ?')
            .get(t.account_id, t.ext_id)
        ) {
          skipped++;
          continue;
        }
        insertTradeTx(t);
        inserted++;
      }
    });
    tx(trades);

    // Best-effort: pull M1 bars around the imported trades so Replay works.
    let bars = null;
    try {
      bars = await autoFetchBarsForTrades(trades);
    } catch {
      /* never fail an import over bars */
    }

    res.json({ inserted, skipped, account_id: accountId, bars });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---------- Phase 3: Price bars ----------
// Normalize a from/to filter value into an ISO boundary for string comparison.
function barBound(v, end) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return end ? `${s}T23:59:59.999Z` : `${s}T00:00:00.000Z`;
  }
  return parseBarTime(s) || s;
}

function queryBars({ instrument, tf, from, to }) {
  const clauses = ['instrument = @instrument', 'tf = @tf'];
  const params = { instrument: normalizeInstrument(instrument), tf };
  const f = barBound(from, false);
  const t = barBound(to, true);
  if (f) {
    clauses.push('t >= @from');
    params.from = f;
  }
  if (t) {
    clauses.push('t <= @to');
    params.to = t;
  }
  return db
    .prepare(
      `SELECT t, open, high, low, close, volume FROM price_bars
       WHERE ${clauses.join(' AND ')} ORDER BY t ASC`
    )
    .all(params);
}

// POST /api/bars/import — multipart CSV (time,open,high,low,close,vol) + instrument, tf.
app.post('/api/bars/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const instrument = req.body.instrument;
    const tf = req.body.tf;
    if (!instrument) return res.status(400).json({ error: 'instrument is required' });
    if (!tf) return res.status(400).json({ error: 'tf is required' });

    const { bars, skipped: parseSkipped } = parseBarsCsv(req.file.buffer, {
      instrument,
      tf,
    });

    const stmt = db.prepare(
      `INSERT OR IGNORE INTO price_bars (instrument, tf, t, open, high, low, close, volume)
       VALUES (@instrument, @tf, @t, @open, @high, @low, @close, @volume)`
    );
    let inserted = 0;
    let skipped = parseSkipped;
    const tx = db.transaction((list) => {
      for (const b of list) {
        const info = stmt.run(b);
        if (info.changes > 0) inserted++;
        else skipped++;
      }
    });
    tx(bars);

    const total = db
      .prepare('SELECT COUNT(*) AS c FROM price_bars WHERE instrument = ? AND tf = ?')
      .get(normalizeInstrument(instrument), tf).c;
    res.json({
      inserted,
      skipped,
      instrument: normalizeInstrument(instrument),
      tf,
      total,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// POST /api/bars/fetch {instrument?|instruments?, from?, to?, days?}
// Pull M1 from OANDA and upsert. Defaults to XAUUSD+US100 over the last `days`
// (7) up to now. Requires OANDA_API_TOKEN in server/.env.
app.post('/api/bars/fetch', async (req, res) => {
  try {
    if (!oandaConfigured())
      return res
        .status(400)
        .json({ error: 'OANDA_API_TOKEN not set in server/.env' });

    const b = req.body || {};
    const insts = b.instrument
      ? [b.instrument]
      : Array.isArray(b.instruments) && b.instruments.length
      ? b.instruments
      : ['XAUUSD', 'US100'];
    const to = b.to ? new Date(b.to) : new Date();
    const days = b.days != null ? Number(b.days) : 7;
    const from = b.from ? new Date(b.from) : new Date(to.getTime() - days * 86400000);

    const results = [];
    for (const inst of insts) {
      if (!oandaSymbol(inst)) {
        results.push({ instrument: inst, error: 'unsupported instrument' });
        continue;
      }
      try {
        const bars = await fetchOandaM1(inst, from, to);
        const upserted = upsertBars(inst, 'M1', bars);
        const row = {
          instrument: normalizeInstrument(inst),
          fetched: bars.length,
          upserted,
        };
        // Finest (S5) feed for the focus instrument, same range.
        if (FINE_SYMBOLS.has(normalizeInstrument(inst))) {
          const s5 = await fetchOandaCandles(inst, from, to, FINE_TF);
          row.s5 = upsertBars(inst, FINE_TF, s5);
        }
        results.push(row);
      } catch (e) {
        results.push({ instrument: inst, error: String(e.message || e) });
      }
    }
    res.json({ from: from.toISOString(), to: to.toISOString(), results });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// GET /api/bars/status → whether the live feed (OANDA) is configured.
app.get('/api/bars/status', (req, res) => {
  res.json({ oanda: oandaConfigured() });
});

// GET /api/bars?instrument&tf&from&to → OHLC array.
app.get('/api/bars', (req, res) => {
  const { instrument, tf, from, to } = req.query;
  if (!instrument || !tf)
    return res.status(400).json({ error: 'instrument and tf are required' });
  res.json(queryBars({ instrument, tf, from, to }));
});

// GET /api/bars/instruments → distinct instrument/tf pairs that have bars.
app.get('/api/bars/instruments', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT instrument, tf, COUNT(*) AS bar_count,
                MIN(t) AS first_t, MAX(t) AS last_t
         FROM price_bars GROUP BY instrument, tf ORDER BY instrument, tf`
      )
      .all()
  );
});

// Slice ascending bars to a window of `pad` bars either side of entry↔exit.
// Window `all` to ~`pad` bars either side of the trade, but never expand across
// a time gap larger than `maxGapMs` — so leftover real gaps (weekends, missing
// data) don't splice in bars from a distant day and warp the chart. `tfMs` is
// the timeframe's bar spacing; a gap up to 6× that (covers the daily maintenance
// break) is tolerated, anything bigger stops the window.
function windowBars(all, entryMs, exitMs, pad, tfMs) {
  if (!all.length || (entryMs == null && exitMs == null)) return all;
  const times = all.map((b) => new Date(b.t).getTime());
  const lo = entryMs ?? exitMs;
  const hi = exitMs ?? entryMs;
  let firstIdx = times.findIndex((tm) => tm >= lo);
  if (firstIdx === -1) firstIdx = all.length - 1;
  let lastIdx = -1;
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] <= hi) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) lastIdx = firstIdx;

  const maxGap = tfMs ? tfMs * 6 : Infinity;
  // Walk left from the trade, stopping at pad bars or the first oversized gap.
  let start = firstIdx;
  for (let i = firstIdx; i > 0 && firstIdx - i < pad; i--) {
    if (times[i] - times[i - 1] > maxGap) break;
    start = i - 1;
  }
  // Walk right similarly.
  let end = lastIdx;
  for (let i = lastIdx; i < all.length - 1 && i - lastIdx < pad; i++) {
    if (times[i + 1] - times[i] > maxGap) break;
    end = i + 1;
  }
  return all.slice(start, end + 1);
}

// GET /api/trades/:id/replay?tf=M5,M15,M30,H1&pad=20
// → one frame per requested TF (stored bars preferred, aggregated otherwise),
//   each windowed to `pad` bars around the trade, plus shared markers.
app.get('/api/trades/:id/replay', (req, res) => {
  const id = Number(req.params.id);
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!trade) return res.status(404).json({ error: 'trade not found' });

  const primaryTf = trade.preferred_tf || 'M30';
  const requested = String(req.query.tf || `M5,M15,M30,H1`)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && isKnownTf(s));
  // De-dupe, keep request order; guarantee the primary is present.
  const tfs = [...new Set([...requested, primaryTf])].filter((t) => isKnownTf(t));
  tfs.sort((a, b) => TF_MS[a] - TF_MS[b]);

  const pad = req.query.pad ? Math.max(0, Number(req.query.pad)) : 20;
  const entryMs = trade.entry_time ? new Date(trade.entry_time).getTime() : null;
  const exitMs = trade.exit_time ? new Date(trade.exit_time).getTime() : null;

  const frames = tfs.map((tf) => {
    const { bars: all, source } = getBarsForTf(trade.instrument, tf);
    return { tf, source, bars: windowBars(all, entryMs, exitMs, pad, tfMs(tf) || 0) };
  });

  res.json({
    trade_id: id,
    instrument: trade.instrument,
    direction: trade.direction,
    primary_tf: primaryTf,
    frames,
    markers: {
      entry:
        trade.entry_time != null
          ? { t: trade.entry_time, price: trade.entry_price }
          : null,
      exit:
        trade.exit_time != null
          ? { t: trade.exit_time, price: trade.exit_price }
          : null,
      stop: trade.stop_price != null ? { price: trade.stop_price } : null,
      target: trade.target_price != null ? { price: trade.target_price } : null,
    },
  });
});

// POST /api/trades/:id/bars/refetch — pull a fresh, wide M1 window around this
// trade from OANDA so its chart has contiguous higher-TF data (repairs trades
// imported before the wider fetch window, without a full re-import).
app.post('/api/trades/:id/bars/refetch', async (req, res) => {
  const id = Number(req.params.id);
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!trade) return res.status(404).json({ error: 'trade not found' });
  if (!oandaConfigured())
    return res.status(400).json({ error: 'OANDA not configured' });
  try {
    const bars = await autoFetchBarsForTrades([trade]);
    res.json({ trade_id: id, bars });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// ---------- Phase 3: Backtest ----------
// POST /api/backtest {instrument,tf,from,to,setup_id?} → bars for the range.
app.post('/api/backtest', (req, res) => {
  const b = req.body || {};
  if (!b.instrument || !b.tf)
    return res.status(400).json({ error: 'instrument and tf are required' });
  const bars = queryBars({
    instrument: b.instrument,
    tf: b.tf,
    from: b.from,
    to: b.to,
  });
  res.json({
    instrument: normalizeInstrument(b.instrument),
    tf: b.tf,
    from: b.from ?? null,
    to: b.to ?? null,
    setup_id: b.setup_id ?? null,
    bars,
  });
});

// POST /api/backtest/trades → save a hypothetical trade (is_backtest=1).
app.post('/api/backtest/trades', (req, res) => {
  const b = req.body || {};
  if (!b.instrument) return res.status(400).json({ error: 'instrument is required' });
  if (b.entry_price == null || b.exit_price == null)
    return res.status(400).json({ error: 'entry_price and exit_price are required' });

  let accountId = b.account_id
    ? Number(b.account_id)
    : db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get()?.id;
  if (!accountId || !accountExists(accountId))
    return res.status(400).json({ error: 'valid account_id required' });

  if (b.setup_id != null) {
    if (!db.prepare('SELECT 1 FROM setups WHERE id = ?').get(Number(b.setup_id)))
      return res.status(400).json({ error: 'unknown setup_id' });
  }

  const direction = b.direction === 'short' ? 'short' : 'long';
  const size = b.size != null ? Number(b.size) : 1;
  const entry = Number(b.entry_price);
  const exit = Number(b.exit_price);
  const sign = direction === 'long' ? 1 : -1;
  const gross_pnl = (exit - entry) * size * sign;
  const net_pnl = gross_pnl;
  const entry_time = b.entry_time ?? null;
  const exit_time = b.exit_time ?? null;
  const hold_time_sec =
    entry_time && exit_time
      ? Math.max(
          0,
          Math.round(
            (new Date(exit_time).getTime() - new Date(entry_time).getTime()) / 1000
          )
        )
      : null;

  const r_multiple = computeRMultiple({
    entry_price: entry,
    exit_price: exit,
    stop_price: b.stop_price != null ? Number(b.stop_price) : null,
    size,
    gross_pnl,
    net_pnl,
  });

  const trade = {
    account_id: accountId,
    instrument: normalizeInstrument(b.instrument),
    direction,
    entry_time,
    exit_time,
    entry_price: entry,
    exit_price: exit,
    size,
    gross_pnl,
    commission: 0,
    swap: 0,
    net_pnl,
    r_multiple,
    stop_price: b.stop_price != null ? Number(b.stop_price) : null,
    target_price: b.target_price != null ? Number(b.target_price) : null,
    mae: null,
    mfe: null,
    hold_time_sec,
    session: sessionFromTime(entry_time),
    source: 'api',
    ext_id: null,
    setup_id: b.setup_id != null ? Number(b.setup_id) : null,
    is_backtest: 1,
    bt_session_id: b.bt_session_id != null ? Number(b.bt_session_id) : null,
  };
  const id = insertTradeTx(trade);
  res.status(201).json(db.prepare('SELECT * FROM trades WHERE id = ?').get(id));
});

// GET /api/backtest/trades → list hypothetical trades (with filters).
app.get('/api/backtest/trades', (req, res) => {
  const q = req.query;
  const clauses = ['COALESCE(is_backtest, 0) = 1'];
  const params = {};
  if (q.account) {
    clauses.push('account_id = @account');
    params.account = Number(q.account);
  }
  if (q.instrument) {
    clauses.push('instrument = @instrument');
    params.instrument = normalizeInstrument(q.instrument);
  }
  if (q.setup) {
    clauses.push('setup_id = @setup');
    params.setup = Number(q.setup);
  }
  if (q.from) {
    clauses.push("date(COALESCE(exit_time, entry_time)) >= date(@from)");
    params.from = q.from;
  }
  if (q.to) {
    clauses.push("date(COALESCE(exit_time, entry_time)) <= date(@to)");
    params.to = q.to;
  }
  const where = 'WHERE ' + clauses.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM trades ${where}`).get(params).c;
  const rows = db
    .prepare(
      `SELECT * FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) DESC, id DESC`
    )
    .all(params);
  res.json({ rows, total });
});

// DELETE /api/backtest/trades/:id → remove a hypothetical trade.
app.delete('/api/backtest/trades/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare('SELECT id FROM trades WHERE id = ? AND COALESCE(is_backtest,0) = 1')
    .get(id);
  if (!row) return res.status(404).json({ error: 'backtest trade not found' });
  db.prepare('DELETE FROM trades WHERE id = ?').run(id);
  res.status(204).end();
});

// GET /api/backtest/stats → summary over is_backtest=1 trades.
app.get('/api/backtest/stats', (req, res) =>
  res.json(summary(req.query, { backtest: true }))
);

// ---------- Backtest Studio: replay sessions ----------
function sessionRow(id) {
  return db.prepare('SELECT * FROM bt_sessions WHERE id = ?').get(id);
}

// POST /api/backtest/sessions → create a replay workspace.
app.post('/api/backtest/sessions', (req, res) => {
  const b = req.body || {};
  if (!b.instrument) return res.status(400).json({ error: 'instrument is required' });
  const baseTf = b.base_tf && TF_MINUTES[b.base_tf] ? b.base_tf : 'M1';
  let accountId = b.account_id
    ? Number(b.account_id)
    : db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get()?.id;
  if (accountId != null && !accountExists(accountId)) accountId = null;
  const info = db
    .prepare(
      `INSERT INTO bt_sessions
         (account_id, name, instrument, base_tf, start_time, cursor_time, speed, risk_pct, layout_json)
       VALUES (@account_id, @name, @instrument, @base_tf, @start_time, @cursor_time, @speed, @risk_pct, @layout_json)`
    )
    .run({
      account_id: accountId ?? null,
      name: b.name ?? null,
      instrument: normalizeInstrument(b.instrument),
      base_tf: baseTf,
      start_time: b.start_time ?? null,
      cursor_time: b.cursor_time ?? b.start_time ?? null,
      speed: b.speed != null ? Number(b.speed) : 1,
      risk_pct: b.risk_pct != null ? Number(b.risk_pct) : null,
      layout_json: b.layout_json != null ? JSON.stringify(b.layout_json) : null,
    });
  res.status(201).json(sessionRow(info.lastInsertRowid));
});

// GET /api/backtest/sessions → list (newest first, optional account filter).
app.get('/api/backtest/sessions', (req, res) => {
  const clauses = [];
  const params = {};
  if (req.query.account) {
    clauses.push('account_id = @account');
    params.account = Number(req.query.account);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  res.json(
    db
      .prepare(`SELECT * FROM bt_sessions ${where} ORDER BY updated_at DESC, id DESC`)
      .all(params)
  );
});

// GET /api/backtest/sessions/:id → one session (+ parsed layout).
app.get('/api/backtest/sessions/:id', (req, res) => {
  const s = sessionRow(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'session not found' });
  res.json(s);
});

// PATCH /api/backtest/sessions/:id → update cursor/speed/name/layout/risk.
app.patch('/api/backtest/sessions/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = sessionRow(id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  const b = req.body || {};
  const fields = [];
  const params = { id };
  const set = (col, val) => {
    fields.push(`${col} = @${col}`);
    params[col] = val;
  };
  if (b.name !== undefined) set('name', b.name);
  if (b.cursor_time !== undefined) set('cursor_time', b.cursor_time);
  if (b.start_time !== undefined) set('start_time', b.start_time);
  if (b.speed !== undefined) set('speed', Number(b.speed));
  if (b.risk_pct !== undefined) set('risk_pct', b.risk_pct == null ? null : Number(b.risk_pct));
  if (b.base_tf !== undefined && TF_MINUTES[b.base_tf]) set('base_tf', b.base_tf);
  if (b.layout_json !== undefined)
    set('layout_json', b.layout_json == null ? null : JSON.stringify(b.layout_json));
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE bt_sessions SET ${fields.join(', ')} WHERE id = @id`).run(params);
  res.json(sessionRow(id));
});

// DELETE /api/backtest/sessions/:id → drop session (orders + drawings cascade).
app.delete('/api/backtest/sessions/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!sessionRow(id)) return res.status(404).json({ error: 'session not found' });
  db.prepare('DELETE FROM bt_sessions WHERE id = ?').run(id);
  res.status(204).end();
});

// GET /api/backtest/sessions/:id/stats → summary over this session's trades.
app.get('/api/backtest/sessions/:id/stats', (req, res) => {
  const id = Number(req.params.id);
  if (!sessionRow(id)) return res.status(404).json({ error: 'session not found' });
  res.json(summary({}, { btSession: id }));
});

// GET /api/backtest/sessions/:id/trades → this session's hypothetical trades.
app.get('/api/backtest/sessions/:id/trades', (req, res) => {
  const id = Number(req.params.id);
  if (!sessionRow(id)) return res.status(404).json({ error: 'session not found' });
  const rows = db
    .prepare(
      `SELECT * FROM trades WHERE bt_session_id = ?
       ORDER BY COALESCE(exit_time, entry_time) DESC, id DESC`
    )
    .all(id);
  res.json({ rows, total: rows.length });
});

// GET /api/backtest/sessions/:id/drawings → the session's chart drawings.
app.get('/api/backtest/sessions/:id/drawings', (req, res) => {
  const id = Number(req.params.id);
  if (!sessionRow(id)) return res.status(404).json({ error: 'session not found' });
  const rows = db
    .prepare('SELECT points_json FROM bt_drawings WHERE session_id = ? ORDER BY id ASC')
    .all(id);
  const drawings = [];
  for (const r of rows) {
    try {
      drawings.push(JSON.parse(r.points_json));
    } catch {
      /* skip malformed */
    }
  }
  res.json({ drawings });
});

// PUT /api/backtest/sessions/:id/drawings {drawings:[…]} → replace them all.
app.put('/api/backtest/sessions/:id/drawings', (req, res) => {
  const id = Number(req.params.id);
  const s = sessionRow(id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  const drawings = Array.isArray(req.body?.drawings) ? req.body.drawings : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM bt_drawings WHERE session_id = ?').run(id);
    const stmt = db.prepare(
      `INSERT INTO bt_drawings (session_id, instrument, tf, type, points_json, style_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const d of drawings) {
      stmt.run(id, s.instrument, d?.tf ?? null, d?.type ?? null, JSON.stringify(d), null);
    }
  });
  tx();
  res.json({ drawings });
});

// GET /api/backtest/sessions/:id/bars?tf=M1,M5 → per-TF frames of full ascending
// OHLC (stored or aggregated). The client drives the replay cursor over these.
app.get('/api/backtest/sessions/:id/bars', (req, res) => {
  const s = sessionRow(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'session not found' });
  const requested = String(req.query.tf || s.base_tf)
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && TF_MINUTES[x]);
  const tfs = requested.length ? [...new Set(requested)] : [s.base_tf];
  tfs.sort((a, b) => TF_MINUTES[a] - TF_MINUTES[b]);
  const frames = tfs.map((tf) => {
    const { bars, source } = getBarsForTf(s.instrument, tf);
    return { tf, source, bars };
  });
  res.json({ session_id: s.id, instrument: s.instrument, frames });
});

// ---------- AI auto-tag ----------
// POST /api/ai/autotag  body: {trade_ids?: number[], account_id?, since?, all_untagged?}
app.post('/api/ai/autotag', async (req, res) => {
  try {
    const b = req.body || {};
    let ids = Array.isArray(b.trade_ids) ? b.trade_ids.map(Number).filter(Boolean) : null;
    if (!ids || !ids.length) {
      const clauses = ['COALESCE(is_backtest,0) = 0'];
      const params = {};
      if (b.account_id) {
        clauses.push('account_id = @account_id');
        params.account_id = Number(b.account_id);
      }
      if (b.since) {
        clauses.push('COALESCE(exit_time, entry_time) >= @since');
        params.since = b.since;
      }
      if (b.all_untagged) {
        clauses.push(
          'setup_id IS NULL AND id NOT IN (SELECT trade_id FROM trade_tags)'
        );
      }
      ids = db
        .prepare(
          `SELECT id FROM trades WHERE ${clauses.join(' AND ')}
           ORDER BY COALESCE(exit_time, entry_time) DESC LIMIT 200`
        )
        .all(params)
        .map((r) => r.id);
    }
    const result = await autoTagTrades(ids);
    res.json({ ...result, requested: ids.length });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---------- Phase 3: AI config & review ----------
app.get('/api/ai/config', (_req, res) => {
  res.json(getAiConfig());
});

app.post('/api/ai/review', async (req, res) => {
  try {
    const result = await aiReview(req.body || {});
    res.json(result);
  } catch (err) {
    // Never fail hard — degrade gracefully.
    res.json({
      summary: `AI review failed: ${String(err.message || err)}`,
      patterns: [],
      suggestions: [],
    });
  }
});

// ---------- Webhook (EA) ----------
function webhookTrade(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!EA_TOKEN || token !== EA_TOKEN)
    return res.status(401).json({ error: 'unauthorized' });

  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b))
    return res.status(400).json({ error: 'JSON body required' });
  if (!b.instrument)
    return res.status(400).json({ error: 'instrument is required' });
  if (b.ext_id == null || String(b.ext_id).trim() === '')
    return res.status(400).json({ error: 'ext_id is required for dedupe' });

  let accountId = b.account_id
    ? Number(b.account_id)
    : db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get()?.id;
  if (!accountId || !accountExists(accountId))
    return res.status(400).json({ error: 'valid account_id required' });

  const gross_pnl = b.gross_pnl ?? 0;
  const commission = Math.abs(b.commission ?? 0);
  const swap = b.swap ?? 0;
  const net_pnl = b.net_pnl ?? gross_pnl - commission + swap;
  const entry_time = b.entry_time ?? null;
  const exit_time = b.exit_time ?? null;
  const hold_time_sec =
    entry_time && exit_time
      ? Math.max(
          0,
          Math.round(
            (new Date(exit_time).getTime() - new Date(entry_time).getTime()) / 1000
          )
        )
      : (b.hold_time_sec ?? null);

  const trade = {
    account_id: accountId,
    instrument: b.instrument ? normalizeInstrument(b.instrument) : null,
    direction: b.direction === 'short' ? 'short' : 'long',
    entry_time,
    exit_time,
    entry_price: b.entry_price ?? null,
    exit_price: b.exit_price ?? null,
    size: b.size ?? null,
    gross_pnl,
    commission,
    swap,
    net_pnl,
    r_multiple: b.r_multiple ?? null,
    stop_price: b.stop_price ?? null,
    target_price: b.target_price ?? null,
    mae: b.mae ?? null,
    mfe: b.mfe ?? null,
    hold_time_sec,
    session: sessionFromTime(entry_time),
    source: 'ea',
    ext_id: String(b.ext_id),
  };

  // EA reports MT5 broker server time → convert to UTC like the CSV import.
  const brokerTz = db
    .prepare('SELECT broker_tz FROM accounts WHERE id = ?')
    .get(accountId)?.broker_tz;
  brokerTimesToUtc(trade, brokerTz);

  if (
    db
      .prepare('SELECT id FROM trades WHERE account_id = ? AND ext_id = ?')
      .get(trade.account_id, trade.ext_id)
  ) {
    return res.status(200).json({ inserted: 0, skipped: 1 });
  }
  const id = insertTradeTx(trade);
  res.status(201).json({ inserted: 1, id });
}

app.post('/api/webhook/trade', webhookTrade);
app.post('/webhook/trade', webhookTrade); // EA posts here directly (no /api prefix)

// ---------- Live positions (EA snapshot) ----------
function webhookPositions(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!EA_TOKEN || token !== EA_TOKEN)
    return res.status(401).json({ error: 'unauthorized' });

  const b = req.body || {};
  const positions = Array.isArray(b.positions) ? b.positions : null;
  if (!positions) return res.status(400).json({ error: 'positions array required' });

  let accountId = b.account_id
    ? Number(b.account_id)
    : db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get()?.id;
  if (!accountId || !accountExists(accountId))
    return res.status(400).json({ error: 'valid account_id required' });

  const upsert = db.prepare(
    `INSERT INTO live_positions
       (account_id, ext_id, instrument, direction, size, entry_price, entry_time,
        current_price, unrealized_pnl, updated_at)
     VALUES (@account_id, @ext_id, @instrument, @direction, @size, @entry_price, @entry_time,
             @current_price, @unrealized_pnl, datetime('now'))
     ON CONFLICT(account_id, ext_id) DO UPDATE SET
       instrument = excluded.instrument,
       direction = excluded.direction,
       size = excluded.size,
       entry_price = excluded.entry_price,
       entry_time = excluded.entry_time,
       current_price = excluded.current_price,
       unrealized_pnl = excluded.unrealized_pnl,
       updated_at = datetime('now')`
  );
  const kept = new Set();
  const tx = db.transaction(() => {
    for (const p of positions) {
      if (p.ext_id == null || String(p.ext_id).trim() === '') continue;
      const ext_id = String(p.ext_id);
      kept.add(ext_id);
      upsert.run({
        account_id: accountId,
        ext_id,
        instrument: p.instrument ? normalizeInstrument(p.instrument) : null,
        direction: p.direction === 'short' ? 'short' : 'long',
        size: p.size ?? null,
        entry_price: p.entry_price ?? null,
        entry_time: p.entry_time ?? null,
        current_price: p.current_price ?? null,
        unrealized_pnl: p.unrealized_pnl ?? null,
      });
    }
    // Prune positions no longer open on the terminal (they closed).
    const existing = db
      .prepare('SELECT ext_id FROM live_positions WHERE account_id = ?')
      .all(accountId)
      .map((r) => r.ext_id);
    const del = db.prepare(
      'DELETE FROM live_positions WHERE account_id = ? AND ext_id = ?'
    );
    for (const e of existing) if (!kept.has(e)) del.run(accountId, e);
  });
  tx();

  res.json({ account_id: accountId, count: kept.size });
}

app.post('/api/webhook/positions', webhookPositions);
app.post('/webhook/positions', webhookPositions);

app.get('/api/live/positions', (req, res) => {
  const clauses = [];
  const params = {};
  if (req.query.account) {
    clauses.push('account_id = @account');
    params.account = Number(req.query.account);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db
    .prepare(
      `SELECT * FROM live_positions ${where} ORDER BY updated_at DESC, ext_id`
    )
    .all(params);
  const totals = rows.reduce(
    (acc, r) => {
      acc.count++;
      acc.unrealized_pnl += r.unrealized_pnl || 0;
      return acc;
    },
    { count: 0, unrealized_pnl: 0 }
  );
  const last = rows[0]?.updated_at ?? null;
  res.json({ positions: rows, ...totals, last_update: last });
});

// ---------- fallback error handler ----------
app.use((err, req, res, next) => {
  res.status(500).json({ error: String(err.message || err) });
});

const server = http.createServer(app);
initResearchWs(server);

server.listen(PORT, () => {
  console.log(`Trade Journal API listening on http://localhost:${PORT}`);
  const newsSec = Number(process.env.NEWS_REFRESH_SEC ?? 300);
  if (newsSec > 0) startNewsScheduler(newsSec);
  else console.log('[news] server-side polling disabled (NEWS_REFRESH_SEC=0)');

  const priceSec = Number(process.env.PRICE_REFRESH_SEC ?? 300);
  if (priceSec > 0) {
    safeIngestOanda({ days: 3 }).then(
      (r) => console.log('[signal] initial price ingest:', JSON.stringify(r)),
      (e) => console.error('[signal] initial price ingest error:', e.message)
    );
    const tid = setInterval(() => {
      safeIngestOanda({ days: 1 }).then(
        (r) => console.log('[signal] price refresh:', JSON.stringify(r)),
        (e) => console.error('[signal] price refresh error:', e.message)
      );
    }, priceSec * 1000);
    tid.unref();
  }
});
