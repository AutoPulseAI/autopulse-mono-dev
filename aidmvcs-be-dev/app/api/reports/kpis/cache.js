// Five-minute cache of computed Reports-page totals in the app's existing Redis (the same settings as
// app/lib/queue.js: REDIS_URL, or REDIS_HOST / REDIS_PORT / REDIS_DB / REDIS_PASSWORD). Only dashboard totals are
// cached. A Redis that is down or slow never breaks the page: the totals are then
// computed every time. REPORTS_CACHE=off turns the cache off.
import crypto from 'crypto';
import Redis from 'ioredis';

export const CACHE_TTL_SECONDS = 300;
export const CACHE_PREFIX = 'reports:kpis:v2'; // v2: show rate over past appointments, leads_link
const OP_TIMEOUT_MS = 800;

let client = null;

function enabled() {
  return String(process.env.REPORTS_CACHE || '').toLowerCase() !== 'off';
}

function redis() {
  if (client) return client;
  const opts = { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000,
    retryStrategy: (times) => (times > 3 ? null : 500) };
  client = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, opts)
    : new Redis({ host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379),
      db: Number(process.env.REDIS_DB || 0), password: process.env.REDIS_PASSWORD || undefined, ...opts });
  client.on('error', () => {}); // logged once per failed call below
  return client;
}

async function withTimeout(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('redis timeout')), OP_TIMEOUT_MS);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function ready() {
  const c = redis();
  if (c.status === 'wait') await withTimeout(c.connect());
  if (c.status === 'end') { client = null; return ready(); }
  return c;
}

export function cacheKey({ dealerId, dashboard, from, to, filters }) {
  const sorted = Object.fromEntries(Object.keys(filters || {}).sort().map((k) => [k, filters[k]]));
  const hash = crypto.createHash('sha1').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
  return `${CACHE_PREFIX}:${dealerId}:${dashboard}:${from}:${to}:${hash}`;
}

export async function cacheGet(key) {
  if (!enabled()) return null;
  try {
    const raw = await withTimeout((await ready()).get(key));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('[reports] cache read skipped:', error?.message);
    return null;
  }
}

export async function cacheSet(key, value) {
  if (!enabled()) return false;
  try {
    await withTimeout((await ready()).set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS));
    return true;
  } catch (error) {
    console.warn('[reports] cache write skipped:', error?.message);
    return false;
  }
}

// Tests and scripts: close the connection so the process can exit.
export async function closeCache() {
  if (client) {
    try { await client.quit(); } catch { client.disconnect(); }
    client = null;
  }
}
