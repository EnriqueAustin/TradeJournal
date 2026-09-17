// Exercises web/public/sw.js in a fake ServiceWorkerGlobalScope: what gets
// precached, which requests it answers, and that /api is never cached.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'),
  'utf8'
);
const ORIGIN = 'http://journal.test';

function setup({ online = true } = {}) {
  const stores = new Map();
  const net = [];
  const openStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const key = (r) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
    return {
      match: async (r) => m.get(key(r)),
      put: async (r, res) => void m.set(key(r), res),
      addAll: async (urls) => urls.forEach((u) => m.set(key(u), res200(u))),
      keys: async () => [...m.keys()],
    };
  };
  const res200 = (url) => ({ ok: true, type: 'basic', url, clone() { return this; } });
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t, fn) => (listeners[t] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const ctx = {
    self,
    URL,
    Promise,
    Response: { error: () => ({ error: true }) },
    caches: {
      open: async (n) => openStore(n),
      keys: async () => [...stores.keys()],
      delete: async (n) => stores.delete(n),
      match: async (r) => {
        for (const n of stores.keys()) {
          const hit = await openStore(n).match(r);
          if (hit) return hit;
        }
        return undefined;
      },
    },
    fetch: async (req) => {
      const url = typeof req === 'string' ? req : req.url;
      net.push(new URL(url, ORIGIN).pathname);
      if (!online) throw new TypeError('offline');
      return res200(url);
    },
  };
  runInNewContext(SRC, ctx);

  const fire = async (path, { method = 'GET', mode = 'cors', origin = ORIGIN } = {}) => {
    let responded = null;
    const event = {
      request: { url: new URL(path, origin).href, method, mode },
      respondWith: (p) => (responded = p),
      waitUntil: () => {},
    };
    listeners.fetch(event);
    return responded ? await responded : undefined;
  };
  const install = async () => {
    let p;
    listeners.install({ waitUntil: (x) => (p = x) });
    await p;
  };
  return { fire, install, stores, net, ctx };
}

describe('service worker', () => {
  it('precaches the offline page, manifest and icons on install', async () => {
    const sw = setup();
    await sw.install();
    const [name, store] = [...sw.stores][0];
    expect(name).toMatch(/^tj-static-/);
    const paths = [...store.keys()].map((u) => new URL(u).pathname);
    expect(paths).toContain('/offline.html');
    expect(paths).toContain('/manifest.webmanifest');
    expect(paths).toContain('/icons/icon-192.png');
  });

  it('never intercepts /api, /screenshots, non-GET or cross-origin requests', async () => {
    const sw = setup();
    expect(await sw.fire('/api/trades?limit=5')).toBeUndefined();
    expect(await sw.fire('/api/trades/1', { mode: 'navigate' })).toBeUndefined();
    expect(await sw.fire('/screenshots/a.png')).toBeUndefined();
    expect(await sw.fire('/assets/index.js', { method: 'POST' })).toBeUndefined();
    expect(await sw.fire('/css2', { origin: 'https://fonts.googleapis.com' })).toBeUndefined();
    const cached = [];
    for (const store of sw.stores.values()) cached.push(...store.keys());
    expect(cached.some((u) => u.includes('/api/'))).toBe(false);
  });

  it('serves built assets cache-first', async () => {
    const sw = setup();
    await sw.fire('/assets/index-abc.js');
    await sw.fire('/assets/index-abc.js');
    expect(sw.net.filter((p) => p === '/assets/index-abc.js')).toHaveLength(1);
  });

  it('goes to the network for navigations and falls back to the offline page', async () => {
    const online = setup();
    const page = await online.fire('/trades', { mode: 'navigate' });
    expect(page.url).toBe(`${ORIGIN}/trades`);

    const offline = setup({ online: false });
    // Seed the precache as install would have (install itself needs the network).
    const store = await offline.ctx.caches.open('seed');
    await store.addAll(['/offline.html']);
    const fallback = await offline.fire('/quick', { mode: 'navigate' });
    expect(new URL(fallback.url, ORIGIN).pathname).toBe('/offline.html');
  });
});
