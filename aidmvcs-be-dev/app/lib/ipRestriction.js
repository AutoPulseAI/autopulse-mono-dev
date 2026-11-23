// IP restriction (19 Nov 2026, SOW reference B8 "IP Restriction"): a dealership may allow its staff to use the CRM only
// from listed networks (the showroom's internet). Off for every dealership until its list has an entry.
//   - Test mode (the default, the user 20 Nov 2026: "please do not block any IP, but we need to give them
//     functionality and test it"): nobody is blocked; a request from outside the list is only recorded
//     (IpRestrictionLog, "would block") and shown on the page. Blocking ("enforce") is switched on per dealership by
//     an AutoPulse super admin only.
//   - Who: the dealership's own users (the dealer account and its staff). AutoPulse super admins, agencies and anyone
//     inside the store through "login as" are never restricted.
//   - Where: sign-in (/api/auth/login), every page load (/api/auth/me) and every dealer API behind requireDealerAccess.
//   - The visitor's IP: X-Real-IP, which nginx sets from the connection - for www.autopulse.ai the real visitor behind
//     Cloudflare (nginx real_ip with Cloudflare's ranges, conf.d/cloudflare-realip.conf, set 19 Nov 2026). A request
//     without it (local development) is not restricted.
//   - Stored on the dealer: dealer_account_information.ip_allowlist [{ value, label, added_by_name, at }] with
//     ip_allowlist_history. Read through a 60-second cache, cleared when the list is saved.
import net from 'node:net';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import IpRestrictionLog from '../models/IpRestrictionLog.js';

export const IP_LIST_MAX = 50;
const CACHE_MS = 60_000;
const cache = new Map(); // dealerId -> { at, list, mode }
const logged = new Map(); // "dealer|user|ip" -> last record time (one row per person, IP and hour)
export const IP_MODES = Object.freeze(['test', 'enforce']);

/** "203.0.113.7", "203.0.113.0/24", "2001:db8::/48" -> { address, prefix, family } or null. */
export function parseEntry(value) {
  const s = String(value ?? '').trim();
  const [addr, bits, extra] = s.split('/');
  if (extra !== undefined) return null;
  const family = net.isIP(addr);
  if (!family) return null;
  const max = family === 4 ? 32 : 128;
  const prefix = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(prefix) || prefix < (family === 4 ? 8 : 16) || prefix > max || (bits !== undefined && !/^\d+$/.test(bits))) return null;
  return { address: addr, prefix, family: family === 4 ? 'ipv4' : 'ipv6' };
}

const plain = (ip) => String(ip || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');

/** Is this IP inside any of the list's entries? */
export function ipAllowed(ip, entries) {
  const at = plain(ip);
  const family = net.isIP(at);
  if (!family) return false;
  const list = new net.BlockList();
  for (const e of entries || []) {
    const p = parseEntry(e?.value ?? e);
    if (p) list.addSubnet(p.address, p.prefix, p.family);
  }
  return list.check(at, family === 4 ? 'ipv4' : 'ipv6');
}

/** The visitor's IP as nginx saw it, or null. */
export function requestIp(req) {
  const ip = plain(req?.headers?.get?.('x-real-ip'));
  return net.isIP(ip) ? ip : null;
}

/** The dealership's list and mode ("test" unless a super admin set "enforce"). */
export async function dealerIpRule(dealerId) {
  const key = String(dealerId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const dealer = await User.findById(key)
    .select('dealer_account_information.ip_allowlist dealer_account_information.ip_restriction_mode').lean().catch(() => null);
  const info = dealer?.dealer_account_information || {};
  const rule = { at: Date.now(), list: info.ip_allowlist || [], mode: info.ip_restriction_mode === 'enforce' ? 'enforce' : 'test' };
  cache.set(key, rule);
  return rule;
}

async function record(dealerId, user, ip, where, blocked) {
  const key = `${dealerId}|${user._id}|${ip}`;
  if (Date.now() - (logged.get(key) || 0) < 3_600_000) return;
  logged.set(key, Date.now());
  try {
    await IpRestrictionLog.create({ dealer_id: String(dealerId), user_id: user._id, user_name: user.name || user.email || null,
      ip, where, blocked });
  } catch { /* the record is a convenience; never fail the request over it */ }
}

export const forgetDealerIpList = (dealerId) => cache.delete(String(dealerId));

export const IP_BLOCKED_MESSAGE = 'This dealership only allows the CRM from its own network. Connect from the dealership, or ask the dealership account to add this network.';

/** Does the request's sign-in come from "login as" (its token carries impersonated_by)? Bearer token, else the
 * dealer session cookie. */
export function viaLoginAs(req) {
  const header = req?.headers?.get?.('authorization') || '';
  let token = /^Bearer\s+\S+$/.test(header) ? header.replace(/^Bearer\s+/, '') : null;
  if (!token) {
    const m = String(req?.headers?.get?.('cookie') || '').match(/(?:^|;\s*)dealertoken=([^;]+)/);
    token = m ? decodeURIComponent(m[1]) : null;
  }
  if (!token || !process.env.JWT_SECRET) return false;
  try { return Boolean(jwt.verify(token, process.env.JWT_SECRET)?.impersonated_by); } catch { return false; }
}

/**
 * Is this signed-in user kept out from where the request came from? `impersonated`: inside the store through
 * "login as" (never restricted).
 */
export async function ipBlocked(req, user, { impersonated = null, where = 'api', rule = null } = {}) {
  if (!user || user.type !== 'dealer') return false;
  if (impersonated ?? viaLoginAs(req)) return false;
  const ip = requestIp(req);
  if (!ip) return false;
  const dealerId = user.parent_id || user._id;
  const { list, mode } = rule || await dealerIpRule(dealerId); // `rule`: given by the tests
  if (!list.length || ipAllowed(ip, list)) return false;
  const blocked = mode === 'enforce';
  await record(dealerId, user, ip, where, blocked);
  return blocked;
}

export function ipBlockedResponse() {
  return new Response(JSON.stringify({ message: IP_BLOCKED_MESSAGE, error: IP_BLOCKED_MESSAGE, code: 'ip_blocked' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } });
}
