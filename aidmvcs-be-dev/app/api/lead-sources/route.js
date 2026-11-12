// The dealer's lead source list (gap G-009), picked on the manual lead form.
//   GET ?dealer_id                         -> { sources: [{ name, leads }], can_edit, history: [last 20] }
//   PUT { dealer_id, action: 'add', name }
//       { dealer_id, action: 'rename', name, to }   also renames the source on the dealer's leads that carry it, so
//                                                   reports don't split one source in two (count in the history)
//       { dealer_id, action: 'remove', name }       leads keep the source they have; it's only no longer offered
// Errors: 401 not signed in · 403 not this dealership's staff, or (PUT) no "Manage Leads" permission · 400 bad name
// or action · 404 (rename/remove) not on the list · 409 (add/rename) already on the list.
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import LeadSourceList from '@models/LeadSourceList';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { dealerForms } from '@lib/reporting/kpis/common';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error }, { status });
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const exact = (name) => new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

async function listFor(dealerId, user) {
  const doc = await LeadSourceList.findOne({ dealer_id: dealerId }).lean();
  const sources = doc?.sources || [];
  const counts = await Promise.all(sources.map((name) => Lead.countDocuments({ dealer_id: { $in: dealerForms(dealerId) },
    lead_source: exact(name) })));
  return { sources: sources.map((name, i) => ({ name, leads: counts[i] })), can_edit: await hasPermission(user, 'Manage Leads'),
    history: (doc?.history || []).slice(-20).reverse() };
}

export async function GET(req) {
  await dbConnect();
  const dealerId = new URL(req.url).searchParams.get('dealer_id') || '';
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  return Response.json(await listFor(dealerId, access.user));
}

export async function PUT(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const dealerId = String(body?.dealer_id || '');
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  if (!(await hasPermission(access.user, 'Manage Leads'))) return fail('You do not have permission to change the source list', 403);

  const action = String(body.action || '');
  const name = clean(body.name);
  const to = clean(body.to);
  if (!['add', 'rename', 'remove'].includes(action)) return fail('action must be add, rename or remove', 400);
  if (!name || name.length > 60) return fail('A source name is 1 to 60 characters', 400);
  if (action === 'rename' && (!to || to.length > 60)) return fail('The new name is 1 to 60 characters', 400);

  const doc = await LeadSourceList.findOne({ dealer_id: dealerId }).lean();
  const sources = doc?.sources || [];
  const at = sources.findIndex((s) => same(s, name));
  const entry = { at: new Date(), by: access.user._id, by_name: access.user.name || null, action, from: null, to: null };
  let next;
  if (action === 'add') {
    if (at >= 0) return fail(`"${sources[at]}" is already on the list`, 409);
    next = [...sources, name];
    entry.to = name;
  } else {
    if (at < 0) return fail(`"${name}" is not on the list`, 404);
    entry.from = sources[at];
    if (action === 'remove') next = sources.filter((_, i) => i !== at);
    else {
      if (sources.some((s, i) => i !== at && same(s, to))) return fail(`"${to}" is already on the list`, 409);
      next = sources.map((s, i) => (i === at ? to : s));
      entry.to = to;
    }
  }
  // Only if nobody changed the list meanwhile (same list as read), so two people never overwrite each other.
  const res = await LeadSourceList.updateOne({ dealer_id: dealerId, sources },
    { $set: { sources: next } }, { upsert: !doc });
  if (!res.matchedCount && !res.upsertedCount) return fail('Someone else changed the list just now - reload and try again', 409);
  if (action === 'rename') {
    const renamed = await Lead.updateMany({ dealer_id: { $in: dealerForms(dealerId) }, lead_source: exact(entry.from) },
      { $set: { lead_source: to } });
    entry.leads_renamed = renamed.modifiedCount || 0;
  }
  await LeadSourceList.updateOne({ dealer_id: dealerId }, { $push: { history: entry } });
  return Response.json(await listFor(dealerId, access.user));
}
