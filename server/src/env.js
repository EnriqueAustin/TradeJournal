import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

const fileVars = {};
try {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    fileVars[key] = val;
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // no .env file — rely on real process.env / defaults
}

// .env PORT takes priority over inherited env (e.g. preview tools inject PORT)
export const PORT = Number(fileVars.PORT || process.env.PORT || 4000);
export const EA_TOKEN = process.env.EA_TOKEN || 'changeme';

// OANDA market-data (free practice API). Token from server/.env.
export const OANDA_API_TOKEN = process.env.OANDA_API_TOKEN || '';
export const OANDA_ENV = (process.env.OANDA_ENV || 'practice').toLowerCase();

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL || 'http://host.docker.internal:11434';
export const AI_PROVIDER = (
  process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'ollama')
).toLowerCase();
export const AI_MODEL =
  process.env.AI_MODEL || (AI_PROVIDER === 'ollama' ? 'qwen3.5:9b' : 'claude-opus-4-8');
export const AI_MODEL_FALLBACK =
  process.env.AI_MODEL_FALLBACK || (AI_PROVIDER === 'ollama' ? 'qwen3.5:9b' : 'claude-sonnet-5');
