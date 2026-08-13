// Thin proxy to the Python analytics microservice. Node calls this for heavy
// quant; it caches results by input-hash in market.db (added later). For S0.1
// it only exposes a health probe. Fails soft — never throws into a request
// handler; returns a status object the caller can surface.
import { ANALYTICS_URL, ANALYTICS_TIMEOUT_MS } from '../env.js';

async function fetchWithTimeout(url, opts = {}, ms = ANALYTICS_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Returns { ok, status, detail } — status is 'ok' | 'unreachable' | 'error'.
export async function analyticsHealth() {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(`${ANALYTICS_URL}/health`);
    const ms = Date.now() - started;
    if (!res.ok) {
      return { ok: false, status: 'error', detail: `HTTP ${res.status}`, latency_ms: ms };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, status: 'ok', detail: body, latency_ms: ms };
  } catch (err) {
    const ms = Date.now() - started;
    const unreachable = err?.name === 'AbortError' || err?.cause?.code === 'ECONNREFUSED';
    return {
      ok: false,
      status: unreachable ? 'unreachable' : 'error',
      detail: String(err?.message || err),
      latency_ms: ms,
    };
  }
}

// POST JSON to a /compute/* endpoint. Used from S1.2 onward. Throws on failure
// so callers can decide how to degrade; kept here so the contract is centralized.
export async function compute(pathname, body) {
  const res = await fetchWithTimeout(`${ANALYTICS_URL}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`analytics ${pathname} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
