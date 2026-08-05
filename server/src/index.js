import './env.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORT, EA_TOKEN } from './env.js';
import { db, migrate } from './db.js';
import { parseImport } from './import.js';
import { parseBarsCsv } from './bars.js';
import { aiReview, autoTagTrades } from './ai.js';
import {
  sessionFromTime,
  normalizeInstrument,
  parseBarTime,
  computeRMultiple,
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
} from './stats.js';

migrate();

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

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
       setup_id, is_backtest)
    VALUES
      (@account_id, @instrument, @direction, @entry_time, @exit_time, @entry_price,
       @exit_price, @size, @gross_pnl, @commission, @swap, @net_pnl, @r_multiple,
       @stop_price, @target_price, @mae, @mfe, @hold_time_sec, @session, @source, @ext_id,
       @setup_id, @is_backtest)
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
  });
  const tradeId = info.lastInsertRowid;
  if (t._executions && t._executions.length) {
    const es = db.prepare(
      `INSERT INTO executions (trade_id, exec_time, price, size, side)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const e of t._executions) {
      es.run(tradeId, e.exec_time, e.price, e.size, e.side);
    }
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
         prop_daily_loss, prop_max_dd, prop_target)
       VALUES (@name,@broker,@platform,@account_type,@currency,@starting_balance,
               @prop_daily_loss,@prop_max_dd,@prop_target)`
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
  res.json({ ...trade, executions, tags, notes, screenshots });
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
app.get('/api/stats/optimizer', (req, res) => res.json(optimizer(req.query)));
app.get('/api/stats/portfolio', (req, res) => res.json(portfolio(req.query)));

// ---------- Import ----------
app.post('/api/import', upload.single('file'), (req, res) => {
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

    res.json({ inserted, skipped, account_id: accountId });
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

// GET /api/trades/:id/replay → bars window around the trade + markers.
app.get('/api/trades/:id/replay', (req, res) => {
  const id = Number(req.params.id);
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!trade) return res.status(404).json({ error: 'trade not found' });

  const tf = req.query.tf || 'M1';
  const padBars = req.query.pad ? Math.max(0, Number(req.query.pad)) : 40;

  const all = db
    .prepare(
      `SELECT t, open, high, low, close, volume FROM price_bars
       WHERE instrument = ? AND tf = ? ORDER BY t ASC`
    )
    .all(trade.instrument, tf);

  const entryMs = trade.entry_time ? new Date(trade.entry_time).getTime() : null;
  const exitMs = trade.exit_time ? new Date(trade.exit_time).getTime() : null;

  let bars = all;
  if (all.length && (entryMs != null || exitMs != null)) {
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
    const start = Math.max(0, firstIdx - padBars);
    const end = Math.min(all.length, lastIdx + padBars + 1);
    bars = all.slice(start, end);
  }

  res.json({
    trade_id: id,
    instrument: trade.instrument,
    tf,
    direction: trade.direction,
    bars,
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

// ---------- Phase 3: AI review ----------
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

app.listen(PORT, () => {
  console.log(`Trade Journal API listening on http://localhost:${PORT}`);
});
