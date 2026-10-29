// Email opens and unsubscribes for the AI's emails (Betsy and Bibi, 28 Oct 2026 meeting: "we need an unsubscribe in our
// emails" - "do these statuses get back to the CRM?" - "if it's opened it should show opened"). Each email carries two
// signed links keyed by its idempotency key: a 1x1 image that records the open, and an unsubscribe link. The signature
// stops anyone from unsubscribing a customer, or faking an open, by guessing a key.
import crypto from 'crypto';

const secret = () => process.env.EMAIL_LINK_SECRET || process.env.UPSELL_SERVICE_SHARED_SECRET || process.env.JWT_SECRET || '';

export function signKey(key) {
  return crypto.createHmac('sha256', secret()).update(String(key)).digest('hex').slice(0, 32);
}

export function validKey(key, signature) {
  if (!key || !signature || !secret()) return false;
  const expected = Buffer.from(signKey(key));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// The two links for one email, or {} when the CRM's public address isn't configured (the email still goes).
export function emailLinks(key, base = process.env.NEXT_PUBLIC_BASE_URL) {
  if (!key || !base || !secret()) return {};
  const q = `k=${encodeURIComponent(key)}&s=${signKey(key)}`;
  const root = String(base).replace(/\/$/, '');
  return { openPixelUrl: `${root}/api/email/open?${q}`, unsubscribeUrl: `${root}/api/email/unsubscribe?${q}` };
}

// The 1x1 transparent GIF the open link returns.
export const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
