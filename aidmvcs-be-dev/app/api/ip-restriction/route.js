// The dealership's IP restriction (19 Nov 2026, SOW reference B8; lib/ipRestriction.js).
//   GET ?dealer_id=[&check=<ip>]  -> { your_ip, entries, mode, history, recent, can_edit, can_enforce[, check] }
//   PUT { dealer_id, entries?: [{ value, label? }], mode?: "test" | "enforce" }
// The list: the dealership account itself, or AutoPulse / its agency inside the store ("login as"). The mode: AutoPulse
// super admins only - "test" (default: nobody is blocked, outside requests are only recorded) or "enforce". An
// enforced list that would shut out the person saving it is refused ("login as" is never restricted).
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dbConnect from '@lib/mongodb';
import User from '@models/User';
import IpRestrictionLog from '@models/IpRestrictionLog';
import { requireDealerAccess } from '@lib/apiGuard';
import { IP_LIST_MAX, IP_MODES, forgetDealerIpList, ipAllowed, parseEntry, requestIp, viaLoginAs } from '@lib/ipRestriction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const fail = (error, status) => Response.json({ error }, { status });
const canEdit = (user, dealerId) => user?.type === 'admin'
  || (user?.type === 'dealer' && !user.parent_id && String(user._id) === String(dealerId));

/** An AutoPulse super admin, signed in directly or inside the store through "login as". */
function superAdmin(req, user) {
  if (user?.type === 'admin') return true;
  const header = req.headers.get('authorization') || '';
  const token = /^Bearer\s+\S+$/.test(header) ? header.replace(/^Bearer\s+/, '') : null;
  try { return Boolean(token) && jwt.verify(token, process.env.JWT_SECRET)?.impersonator_type === 'admin'; } catch { return false; }
}

async function view(req, dealerId, user) {
  const [dealer, recent] = await Promise.all([
    User.findById(dealerId).select('dealer_account_information.ip_allowlist dealer_account_information.ip_allowlist_history '
      + 'dealer_account_information.ip_restriction_mode').lean(),
    IpRestrictionLog.find({ dealer_id: String(dealerId) }).sort({ at: -1 }).limit(50).lean(),
  ]);
  const info = dealer?.dealer_account_information || {};
  return { your_ip: requestIp(req), via_login_as: viaLoginAs(req), can_edit: canEdit(user, dealerId),
    can_enforce: superAdmin(req, user), mode: info.ip_restriction_mode === 'enforce' ? 'enforce' : 'test',
    entries: info.ip_allowlist || [], history: (info.ip_allowlist_history || []).slice(-20).reverse(),
    recent: recent.map((r) => ({ at: r.at, user_name: r.user_name, ip: r.ip, where: r.where, blocked: r.blocked })) };
}

export async function GET(req) {
  await dbConnect();
  const p = new URL(req.url).searchParams;
  const dealerId = String(p.get('dealer_id') || '');
  if (!mongoose.isValidObjectId(dealerId)) return fail('dealer_id is required', 400);
  const g = await requireDealerAccess(req, dealerId);
  if (g.response) return g.response;
  const out = await view(req, dealerId, g.user);
  if (p.get('check') !== null) {
    // "Check an IP": would it be let in with the list as saved?
    const ip = String(p.get('check') || '').trim();
    if (!parseEntry(ip) || ip.includes('/')) return fail('Type one IP address, e.g. 203.0.113.7', 400);
    out.check = { ip, allowed: !out.entries.length || ipAllowed(ip, out.entries) };
  }
  return Response.json(out);
}

export async function PUT(req) {
  await dbConnect();
  const b = await req.json().catch(() => null);
  const dealerId = String(b?.dealer_id || '');
  if (!mongoose.isValidObjectId(dealerId)) return fail('dealer_id is required', 400);
  const g = await requireDealerAccess(req, dealerId);
  if (g.response) return g.response;
  if (!canEdit(g.user, dealerId)) return fail('Only the dealership account can change the IP restriction', 403);
  if (b?.mode !== undefined && !IP_MODES.includes(b.mode)) return fail('mode must be test or enforce', 400);
  if (b?.mode !== undefined && !superAdmin(req, g.user)) return fail('Only AutoPulse can switch blocking on or off', 403);
  if (b?.entries !== undefined && !Array.isArray(b.entries)) return fail('entries must be a list', 400);
  if ((b?.entries || []).length > IP_LIST_MAX) return fail(`At most ${IP_LIST_MAX} entries`, 400);

  const who = (await User.findById(g.user._id).select('name email').lean())?.name || 'Dealer';
  const info = (await User.findById(dealerId).select('dealer_account_information.ip_allowlist dealer_account_information.ip_restriction_mode')
    .lean())?.dealer_account_information || {};
  const before = info.ip_allowlist || [];
  let entries = before;
  if (b?.entries !== undefined) {
    const seen = new Set();
    entries = [];
    for (const e of b.entries) {
      const value = String(e?.value || '').trim();
      if (!parseEntry(value)) return fail(`"${value}" is not an IP address or range (e.g. 203.0.113.7 or 203.0.113.0/24)`, 400);
      if (seen.has(value)) continue;
      seen.add(value);
      const old = before.find((x) => x.value === value);
      entries.push({ value, label: String(e?.label || '').trim().slice(0, 60) || null,
        added_by_name: old?.added_by_name || who, at: old?.at || new Date() });
    }
  }
  const modeBefore = info.ip_restriction_mode === 'enforce' ? 'enforce' : 'test';
  const mode = b?.mode ?? modeBefore;
  if (mode === 'enforce' && entries.length && !viaLoginAs(req)) {
    const ip = requestIp(req);
    if (!ip) return fail('Your IP address can\'t be seen right now, so the list can\'t be checked against it.', 409);
    if (!ipAllowed(ip, entries)) return fail(`This list doesn't include your own IP (${ip}): with blocking on, saving it would sign you out. Add it first.`, 409);
  }
  const listText = (l) => l.map((x) => x.value).join(', ') || 'no list';
  const change = { at: new Date(), by_name: who, from: `${listText(before)} (${modeBefore})`, to: `${listText(entries)} (${mode})` };
  await User.updateOne({ _id: dealerId, type: 'dealer' }, {
    $set: { 'dealer_account_information.ip_allowlist': entries, 'dealer_account_information.ip_restriction_mode': mode },
    $push: { 'dealer_account_information.ip_allowlist_history': { $each: [change], $slice: -100 } },
  }, { strict: false });
  forgetDealerIpList(dealerId);
  return Response.json(await view(req, dealerId, g.user));
}
