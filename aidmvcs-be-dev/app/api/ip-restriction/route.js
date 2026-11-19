// The dealership's IP restriction list (19 Nov 2026, SOW reference B8; lib/ipRestriction.js).
//   GET ?dealer_id=                          -> { your_ip, entries, history, can_edit, via_login_as }
//   PUT { dealer_id, entries: [{ value, label? }] }   replaces the list (empty = no restriction)
// Changed only by the dealership account itself or AutoPulse / its agency inside the store ("login as"). A list that
// would shut out the person saving it is refused (they would be signed out at once), except for "login as", which
// is never restricted.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import User from '@models/User';
import { requireDealerAccess } from '@lib/apiGuard';
import { IP_LIST_MAX, forgetDealerIpList, ipAllowed, parseEntry, requestIp, viaLoginAs } from '@lib/ipRestriction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const fail = (error, status) => Response.json({ error }, { status });
const canEdit = (user, dealerId) => user?.type === 'admin'
  || (user?.type === 'dealer' && !user.parent_id && String(user._id) === String(dealerId));

async function view(req, dealerId, user) {
  const dealer = await User.findById(dealerId).select('dealer_account_information.ip_allowlist dealer_account_information.ip_allowlist_history').lean();
  const info = dealer?.dealer_account_information || {};
  return { your_ip: requestIp(req), via_login_as: viaLoginAs(req), can_edit: canEdit(user, dealerId),
    entries: info.ip_allowlist || [], history: (info.ip_allowlist_history || []).slice(-20).reverse() };
}

export async function GET(req) {
  await dbConnect();
  const dealerId = String(new URL(req.url).searchParams.get('dealer_id') || '');
  if (!mongoose.isValidObjectId(dealerId)) return fail('dealer_id is required', 400);
  const g = await requireDealerAccess(req, dealerId);
  if (g.response) return g.response;
  return Response.json(await view(req, dealerId, g.user));
}

export async function PUT(req) {
  await dbConnect();
  const b = await req.json().catch(() => null);
  const dealerId = String(b?.dealer_id || '');
  if (!mongoose.isValidObjectId(dealerId)) return fail('dealer_id is required', 400);
  const g = await requireDealerAccess(req, dealerId);
  if (g.response) return g.response;
  if (!canEdit(g.user, dealerId)) return fail('Only the dealership account can change the IP restriction', 403);
  if (!Array.isArray(b?.entries)) return fail('entries must be a list', 400);
  if (b.entries.length > IP_LIST_MAX) return fail(`At most ${IP_LIST_MAX} entries`, 400);
  const who = (await User.findById(g.user._id).select('name email').lean())?.name || 'Dealer';
  const before = (await User.findById(dealerId).select('dealer_account_information.ip_allowlist').lean())
    ?.dealer_account_information?.ip_allowlist || [];
  const seen = new Set();
  const entries = [];
  for (const e of b.entries) {
    const value = String(e?.value || '').trim();
    if (!parseEntry(value)) return fail(`"${value}" is not an IP address or range (e.g. 203.0.113.7 or 203.0.113.0/24)`, 400);
    if (seen.has(value)) continue;
    seen.add(value);
    const old = before.find((x) => x.value === value);
    entries.push({ value, label: String(e?.label || '').trim().slice(0, 60) || null,
      added_by_name: old?.added_by_name || who, at: old?.at || new Date() });
  }
  if (entries.length && !viaLoginAs(req)) {
    const ip = requestIp(req);
    if (!ip) return fail('Your IP address can\'t be seen right now, so the list can\'t be checked against it. Try again from the dealership.', 409);
    if (!ipAllowed(ip, entries)) return fail(`This list doesn't include your own IP (${ip}): saving it would sign you out. Add it first.`, 409);
  }
  const was = before.map((x) => x.value).join(', ') || 'no restriction';
  const now = entries.map((x) => x.value).join(', ') || 'no restriction';
  await User.updateOne({ _id: dealerId, type: 'dealer' }, {
    $set: { 'dealer_account_information.ip_allowlist': entries },
    $push: { 'dealer_account_information.ip_allowlist_history': { $each: [{ at: new Date(), by_name: who, from: was, to: now }], $slice: -100 } },
  }, { strict: false });
  forgetDealerIpList(dealerId);
  return Response.json(await view(req, dealerId, g.user));
}
