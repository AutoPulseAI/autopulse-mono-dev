/**
 * Shared-secret auth for trusted backend-to-backend calls (e.g. the
 * agentic-upsell Python service calling back into this app's API routes).
 *
 * This is a DIFFERENT trust model from human auth (app/lib/auth.js's JWT,
 * checked against a per-user session): there is no user here, only "does the
 * caller know the shared secret." Used ONLY for routes meant to be called by
 * another internal service, never for anything the browser calls directly.
 *
 * See ../../agentic-upsell/INTEGRATION.md for the full auth chain: a human
 * dealer session authorizes the initial /api/upsell/recommend call (see
 * apiAuth.js), and THIS check authorizes the Python service's follow-up call
 * back into /api/customers/[id]/360 using the dealer_id that call already
 * carries (not a client-supplied value re-checked from scratch).
 */

import crypto from "crypto";

// Constant-time string comparison. crypto.timingSafeEqual() throws if the two
// buffers differ in length, and a naive === comparison leaks timing
// information proportional to how many leading characters match — both are
// real side channels for a secret this short-lived and high-value. Hashing
// both sides to a fixed-length digest first sidesteps the length-mismatch
// throw entirely, so this function has exactly one code path regardless of
// input length.
function constantTimeEquals(a, b) {
  const digestA = crypto.createHash("sha256").update(String(a)).digest();
  const digestB = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * @param {Request} req
 * @returns {boolean} true only if the request carries a valid internal
 *   service token. Fails closed (returns false) if the shared secret isn't
 *   configured at all — a missing env var must never be treated as "auth
 *   disabled."
 */
export function verifyInternalServiceToken(req) {
  const expected = process.env.UPSELL_SERVICE_SHARED_SECRET;
  if (!expected) return false;

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !/^Bearer\s+\S+$/.test(authHeader)) return false;

  const token = authHeader.replace(/^Bearer\s+/, "");
  return constantTimeEquals(token, expected);
}
