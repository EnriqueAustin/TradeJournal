import { db } from './db.js';
import { summary } from './stats.js';
import { buildFilter } from './stats.js';
import { ANTHROPIC_API_KEY, AI_MODEL, AI_MODEL_FALLBACK } from './env.js';

const UNAVAILABLE = {
  summary: 'AI review unavailable — set ANTHROPIC_API_KEY',
  patterns: [],
  suggestions: [],
};

// Gather the period's real-trade stats + trades + notes for the prompt.
function gatherContext(q) {
  const stats = summary(q);
  const { where, params } = buildFilter(q);
  const trades = db
    .prepare(
      `SELECT id, instrument, direction, entry_time, exit_time, entry_price,
              exit_price, size, net_pnl, r_multiple, session, hold_time_sec
       FROM trades ${where}
       ORDER BY COALESCE(exit_time, entry_time) ASC, id ASC
       LIMIT 200`
    )
    .all(params);
  const tradeIds = trades.map((t) => t.id);
  let notes = [];
  if (tradeIds.length) {
    const placeholders = tradeIds.map(() => '?').join(',');
    notes = db
      .prepare(
        `SELECT trade_id, body, rules_followed, created_at FROM notes
         WHERE trade_id IN (${placeholders}) AND body IS NOT NULL AND TRIM(body) <> ''
         ORDER BY created_at ASC`
      )
      .all(...tradeIds);
  }
  return { stats, trades, notes };
}

// Normalize {date} into {from,to} and return the query filters used everywhere.
function periodFilters(body) {
  const q = {};
  if (body.account != null) q.account = body.account;
  if (body.instrument && body.instrument !== 'All') q.instrument = body.instrument;
  if (body.session && body.session !== 'All') q.session = body.session;
  if (body.setup && body.setup !== 'All') q.setup = body.setup;
  if (body.date) {
    q.from = body.date;
    q.to = body.date;
  } else {
    if (body.from) q.from = body.from;
    if (body.to) q.to = body.to;
  }
  return q;
}

function buildPrompt(ctx, q) {
  const period = q.from
    ? q.from === q.to
      ? q.from
      : `${q.from} → ${q.to}`
    : 'all available history';
  const lines = [];
  lines.push(`Trading period: ${period}`);
  lines.push(`Summary stats: ${JSON.stringify(ctx.stats)}`);
  lines.push('');
  lines.push('Trades:');
  for (const t of ctx.trades) {
    lines.push(
      `#${t.id} ${t.instrument} ${t.direction} entry=${t.entry_time} exit=${t.exit_time} ` +
        `net=${t.net_pnl} R=${t.r_multiple ?? 'n/a'} session=${t.session} hold=${t.hold_time_sec ?? 'n/a'}s`
    );
  }
  if (ctx.notes.length) {
    lines.push('');
    lines.push('Journal notes:');
    for (const n of ctx.notes) {
      lines.push(
        `[trade ${n.trade_id}] rules_followed=${n.rules_followed}: ${n.body}`
      );
    }
  }
  return lines.join('\n');
}

function extractJson(text) {
  if (!text) return null;
  // Direct parse, else pull the first {...} block.
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Main entry: returns {summary, patterns:[], suggestions:[]} (always HTTP 200).
// ---------- Auto-tag ----------
// Classify a batch of trades: pick a setup_id (or null) + tags per category.
// Categories other than 'setup' are permitted (setup category is unused — trades
// track the playbook via setup_id, not tags). Tags reuse existing vocab.
const TAG_CATS_ALLOWED = ['session', 'emotion', 'mistake', 'grade'];

async function classifyBatch(trades, setups, tagVocab) {
  if (!ANTHROPIC_API_KEY) return null;

  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return null;
  }

  const setupLines = setups.length
    ? setups.map((s) => `- id=${s.id} "${s.name}"${s.instrument ? ` (${s.instrument})` : ''}${s.rules ? `: ${s.rules}` : ''}`).join('\n')
    : '(none defined)';
  const vocabLines = TAG_CATS_ALLOWED.map(
    (c) => `- ${c}: ${(tagVocab[c] || []).slice(0, 30).join(', ') || '(none yet)'}`
  ).join('\n');

  const system =
    'You are auto-tagging closed trades from a scalping trade journal (XAUUSD/US100). ' +
    'For each trade you MUST return an object of the exact shape ' +
    '{"id": number, "setup_id": number|null, "tags": [{"category": string, "name": string}]}. ' +
    'Categories allowed: session, emotion, mistake, grade. ' +
    "Prefer reusing existing tag names when they fit. Keep names short (1-3 words), lowercase. " +
    'Choose setup_id ONLY from the provided ids when it plainly matches; otherwise null. ' +
    'Do not invent trade ids. Respond ONLY with JSON: {"results":[ ... ]}. No markdown.';

  const rows = trades.map((t) => ({
    id: t.id,
    instrument: t.instrument,
    direction: t.direction,
    session: t.session,
    net_pnl: t.net_pnl,
    r_multiple: t.r_multiple,
    hold_time_sec: t.hold_time_sec,
    mae: t.mae,
    mfe: t.mfe,
    entry_time: t.entry_time,
    exit_time: t.exit_time,
  }));

  const prompt =
    `Setups:\n${setupLines}\n\n` +
    `Existing tag vocabulary:\n${vocabLines}\n\n` +
    `Trades (JSON):\n${JSON.stringify(rows)}`;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const models = [AI_MODEL, AI_MODEL_FALLBACK].filter(Boolean);
  let lastErr = null;
  for (const model of models) {
    try {
      const resp = await client.messages.create({
        model,
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = (resp.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const parsed = extractJson(text);
      if (parsed && Array.isArray(parsed.results)) return parsed.results;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

export async function autoTagTrades(tradeIds) {
  if (!ANTHROPIC_API_KEY)
    return { tagged: 0, skipped: tradeIds.length, error: 'ANTHROPIC_API_KEY not set' };
  if (!tradeIds || tradeIds.length === 0) return { tagged: 0, skipped: 0 };

  const placeholders = tradeIds.map(() => '?').join(',');
  const trades = db
    .prepare(
      `SELECT id, instrument, direction, session, net_pnl, r_multiple,
              hold_time_sec, mae, mfe, entry_time, exit_time
       FROM trades WHERE id IN (${placeholders}) AND COALESCE(is_backtest,0) = 0`
    )
    .all(...tradeIds);
  if (!trades.length) return { tagged: 0, skipped: 0 };

  const setups = db.prepare('SELECT id, name, instrument, rules FROM setups').all();
  const tagVocab = {};
  for (const cat of TAG_CATS_ALLOWED) {
    tagVocab[cat] = db
      .prepare('SELECT name FROM tags WHERE category = ? ORDER BY name')
      .all(cat)
      .map((r) => r.name);
  }

  // Cap batch size to keep tokens bounded.
  const BATCH = 40;
  const allResults = [];
  for (let i = 0; i < trades.length; i += BATCH) {
    const chunk = trades.slice(i, i + BATCH);
    const out = await classifyBatch(chunk, setups, tagVocab);
    if (Array.isArray(out)) allResults.push(...out);
  }

  const validSetups = new Set(setups.map((s) => s.id));
  const applyTag = db.prepare(
    'INSERT OR IGNORE INTO tags (category, name) VALUES (?, ?)'
  );
  const getTag = db.prepare(
    'SELECT id FROM tags WHERE category = ? AND name = ?'
  );
  const link = db.prepare(
    'INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)'
  );
  const setSetup = db.prepare(
    'UPDATE trades SET setup_id = ? WHERE id = ? AND setup_id IS NULL'
  );

  let tagged = 0;
  const tx = db.transaction((results) => {
    for (const r of results) {
      const tradeId = Number(r?.id);
      if (!tradeId) continue;
      if (
        r.setup_id != null &&
        Number.isFinite(Number(r.setup_id)) &&
        validSetups.has(Number(r.setup_id))
      ) {
        setSetup.run(Number(r.setup_id), tradeId);
      }
      const tags = Array.isArray(r.tags) ? r.tags : [];
      for (const t of tags) {
        const cat = String(t?.category || '').toLowerCase();
        const name = String(t?.name || '').trim().toLowerCase();
        if (!TAG_CATS_ALLOWED.includes(cat) || !name) continue;
        applyTag.run(cat, name);
        const row = getTag.get(cat, name);
        if (row) link.run(tradeId, row.id);
      }
      tagged++;
    }
  });
  tx(allResults);

  return { tagged, skipped: trades.length - tagged, batches: Math.ceil(trades.length / BATCH) };
}

export async function aiReview(body = {}) {
  if (!ANTHROPIC_API_KEY) return { ...UNAVAILABLE };

  const q = periodFilters(body);
  const ctx = gatherContext(q);

  if (!ctx.trades.length) {
    return {
      summary: 'No trades in the selected period to review.',
      patterns: [],
      suggestions: [],
    };
  }

  const system =
    'You are a trading performance coach reviewing a trader\'s journal. ' +
    'Analyze the provided stats, trades and notes. Be concise, specific and ' +
    'actionable. Respond ONLY with a JSON object of the exact shape ' +
    '{"summary": string, "patterns": string[], "suggestions": string[]}. ' +
    'summary is 2-4 sentences. patterns are observed behavioural/edge patterns. ' +
    'suggestions are concrete improvements. No markdown, no extra keys.';
  const prompt = buildPrompt(ctx, q);

  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return {
      summary: 'AI review unavailable — @anthropic-ai/sdk is not installed.',
      patterns: [],
      suggestions: [],
    };
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const models = [AI_MODEL, AI_MODEL_FALLBACK].filter(Boolean);

  let lastErr = null;
  for (const model of models) {
    try {
      const resp = await client.messages.create({
        model,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = (resp.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const parsed = extractJson(text);
      if (parsed && typeof parsed === 'object') {
        return {
          summary: String(parsed.summary ?? '').trim() || 'No summary produced.',
          patterns: Array.isArray(parsed.patterns) ? parsed.patterns.map(String) : [],
          suggestions: Array.isArray(parsed.suggestions)
            ? parsed.suggestions.map(String)
            : [],
        };
      }
      // Model returned unparseable text — surface it as the summary.
      return { summary: text.trim() || 'No response.', patterns: [], suggestions: [] };
    } catch (err) {
      lastErr = err;
      // Try the fallback model on the next iteration.
    }
  }

  return {
    summary: `AI review failed: ${String(lastErr?.message || lastErr || 'unknown error')}`,
    patterns: [],
    suggestions: [],
  };
}
