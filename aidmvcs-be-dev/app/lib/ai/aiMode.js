// Per-dealer AI mode (agentic-upsell MASTER_PLAN_1 Stage 5, BPLAN Phase 1).
//
//   off    - today's behaviour: n8n replies, the AI service hears nothing.
//   shadow - n8n still replies; the AI service also gets every event, marked
//            shadow, and drafts a reply it never sends (for comparison).
//   live   - the AI service replies; n8n is not called for auto-replies and
//            the platform's own follow-up jobs are not scheduled.
//
// Workers read it through getDealerAiMode(), cached per process for 60s, so
// switching a dealer back to `off` takes effect everywhere within a minute.
// Any failure reading it falls back to `off`, i.e. to today's behaviour.
//
// Imports are relative (no @lib aliases) so the BullMQ workers, which run
// under plain Node, can use this module too.

import User from '../../models/User.js';

export const AI_MODES = Object.freeze(['off', 'shadow', 'live']);
export const AI_MODE_CACHE_TTL_MS = 60_000;

const cache = new Map();

// AI_DEALER_ALLOWLIST (comma-separated dealer ids): when set, every other dealer is `off` whatever its record
// says. `make crm-live-db` sets it to the test dealer, so a local copy on the live database touches only that
// dealer (agentic-upsell integrations/dealer_mode.py reads the same variable).
export function dealerAllowed(dealerId, env = process.env) {
  const allow = String(env.AI_DEALER_ALLOWLIST || '').split(',').map((d) => d.trim()).filter(Boolean);
  return allow.length === 0 || allow.includes(String(dealerId));
}

// A dealer who turned auto-replies off gets no automated replies from the AI
// either: the mode only takes effect while autoReplyEnabled isn't false.
export function effectiveAiMode(dealer) {
  if (!dealer) return 'off';
  if (dealer?._id && !dealerAllowed(dealer._id)) return 'off';
  if (dealer?.setting?.autoReplyEnabled === false) return 'off';
  return AI_MODES.includes(dealer.ai_mode) ? dealer.ai_mode : 'off';
}

// What each mode means for one inbound lead or message.
export function aiRouting(mode) {
  const safeMode = AI_MODES.includes(mode) ? mode : 'off';
  return {
    mode: safeMode,
    callN8n: safeMode !== 'live',
    sendEvent: safeMode !== 'off',
    shadow: safeMode === 'shadow',
    aiReplies: safeMode === 'live',
  };
}

async function loadDealer(dealerId) {
  return User.findById(dealerId).select('ai_mode setting').lean();
}

export async function getDealerAiMode(dealerId, { load = loadDealer, now = Date.now, logger = console } = {}) {
  if (!dealerId) return 'off';
  const key = String(dealerId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now()) return cached.mode;

  let mode = 'off';
  try {
    mode = effectiveAiMode(await load(key));
  } catch (error) {
    logger.error?.('[ai] could not read dealer AI mode; treating as off', { dealer_id: key, error: error?.message });
  }
  cache.set(key, { mode, expiresAt: now() + AI_MODE_CACHE_TTL_MS });
  return mode;
}

// Same-process invalidation after an admin changes the mode. Other processes
// (e.g. the worker) pick the change up when their cache entry expires.
export function invalidateDealerAiMode(dealerId) {
  cache.delete(String(dealerId));
}

export function clearAiModeCache() {
  cache.clear();
}
