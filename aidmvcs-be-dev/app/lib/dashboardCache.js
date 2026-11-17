// Short-TTL cache for heavy dashboard read endpoints (DB-SCALING #4), in the app's existing Redis
// (same settings as app/lib/queue.js: REDIS_URL, or REDIS_HOST / REDIS_PORT / REDIS_DB / REDIS_PASSWORD).
//
// Modeled on app/api/reports/kpis/cache.js, which already caches the Reports page the same way. Only
// read-only dashboard aggregates go here — never compliance, consent, live conversation, or anything
// a few seconds of staleness could make wrong.
//
// Fail-safe by design: a Redis that is down or slow NEVER breaks a page — on any error the caller just
// computes the result as before. Turn the whole layer off with DASHBOARD_CACHE=off. Tune staleness with
// DASHBOARD_CACHE_TTL (seconds, default 60).
import crypto from 'crypto';
import Redis from 'ioredis';

export const CACHE_PREFIX = 'dash:v1';
const DEFAULT_TTL_SECONDS = 60;
const OP_TIMEOUT_MS = 800;

let client = null;

function enabled() {
  return String(process.env.DASHBOARD_CACHE || '').toLowerCase() !== 'off';
}

export function ttlSeconds() {
  const n = Number(process.env.DASHBOARD_CACHE_TTL);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TTL_SECONDS;
}

function redis() {
  if (client) return client;
  const opts = { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000,
    retryStrategy: (times) => (times > 3 ? null : 500) };
  client = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, opts)
    : new Redis({ host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379),
      db: Number(process.env.REDIS_DB || 0), password: process.env.REDIS_PASSWORD || undefined, ...opts });
  client.on('error', () => {}); // swallowed; each failed op is logged once below
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

// A stable key: namespace + dealer/date/filter parts, hashed so key length and characters are bounded.
export function dashboardCacheKey(namespace, parts) {
  const sorted = Object.fromEntries(Object.keys(parts || {}).sort().map((k) => [k, parts[k]]));
  const hash = crypto.createHash('sha1').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
  return `${CACHE_PREFIX}:${namespace}:${hash}`;
}

export async function getCached(key) {
  if (!enabled()) return null;
  try {
    const raw = await withTimeout((await ready()).get(key));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('[dashboardCache] read skipped:', error?.message);
    return null;
  }
}

export async function setCached(key, value, ttl = ttlSeconds()) {
  if (!enabled()) return false;
  try {
    await withTimeout((await ready()).set(key, JSON.stringify(value), 'EX', ttl));
    return true;
  } catch (error) {
    console.warn('[dashboardCache] write skipped:', error?.message);
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
