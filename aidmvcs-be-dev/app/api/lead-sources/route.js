// The dealer's lead source list (gap G-009), picked on the manual lead form.
//   GET ?dealer_id                         -> { sources: [{ name, leads }], used: [{ name, leads }], common: [names],
//                                             can_edit, history: [last 20] }
//       used:   every other source already on the dealer's leads (ADF / provider / imported leads), so the picker is
//               never empty for a dealer whose list nobody has typed in yet (17 Nov 2026: "No sources yet");
//       common: the usual providers (lib/reporting/normalize.js PROVIDER_ALIASES) that are in neither.
//   PUT { dealer_id, action: 'add', name }
//       { dealer_id, action: 'rename', name, to }   also renames the source on the dealer's leads that carry it, so
//                                                   reports don't split one source in two (count in the history)
//       { dealer_id, action: 'remove', name }       leads keep the source they have; it's only no longer offered
//   PUT { dealer_id, action: 'campaign_add', campaign: { name, code, lead_source? } }
//       { dealer_id, action: 'campaign_update', id, campaign: { name?, code?, lead_source?, active? } }
//       { dealer_id, action: 'campaign_remove', id }
//       Campaigns / tracking codes (13 Nov 2026 meeting 4.4, "admin only"): the dealer account or a super admin, not
//       staff. Adding a code (or changing it) also tags the dealer's leads that already carry it and have no campaign
//       (count in the history); removing a campaign leaves its leads tagged. GET returns campaigns + can_edit_campaigns.
// Errors: 401 not signed in · 403 not this dealership's staff, or (PUT) no "Manage Leads" permission · 400 bad name
// or action · 404 (rename/remove) not on the list · 409 (add/rename) already on the list.
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import LeadSourceList from '@models/LeadSourceList';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { dealerForms } from '@lib/reporting/kpis/common';
import { PROVIDER_ALIASES, UNKNOWN_SOURCE, normalizeProvider } from '@lib/reporting/normalize';
import mongoose from 'mongoose';

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
  const onList = new Set(sources.map((n) => n.toLowerCase()));
  // Sources on the dealer's leads, as the reports name them (one name per provider), most used first.
  const raw = await Lead.aggregate([{ $match: { dealer_id: { $in: dealerForms(dealerId) } } },
    { $group: { _id: { ls: '$lead_source', s: '$source' }, n: { $sum: 1 } } }]);
  const usedCount = new Map();
  for (const r of raw) {
    const name = normalizeProvider(r._id.ls, r._id.s);
    if (name === UNKNOWN_SOURCE || name === 'Campaign' || onList.has(name.toLowerCase()) || name.length > 60) continue;
    usedCount.set(name, (usedCount.get(name) || 0) + r.n);
  }
  const used = [...usedCount].map(([name, leads]) => ({ name, leads })).sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
  const taken = new Set([...onList, ...used.map((u) => u.name.toLowerCase())]);
  const common = [...new Set(PROVIDER_ALIASES.map(([, n]) => n))].filter((n) => !taken.has(n.toLowerCase()));
  const campaigns = await Promise.all((doc?.campaigns || []).map(async (c) => ({ id: String(c._id), name: c.name,
    code: c.code, lead_source: c.lead_source || null, active: c.active !== false,
    leads: await Lead.countDocuments({ dealer_id: { $in: dealerForms(dealerId) }, campaign: c.name }) })));
  return { sources: sources.map((name, i) => ({ name, leads: counts[i] })), used, common,
    can_edit: await hasPermission(user, 'Manage Leads'),
    campaigns, can_edit_campaigns: canEditCampaigns(user),
    history: (doc?.history || []).slice(-20).reverse() };
}

// Campaigns are admin-only: the dealer account (rooftop admin; also a super admin inside it through "login as") or a
// super admin. Staff, even with Manage Leads, can't change them.
function canEditCampaigns(user) { return ['admin', 'dealer'].includes(user?.type); }

// Tags the dealer's leads that carry `code` as sub-source or lead source and have no campaign yet.
async function tagExisting(dealerId, code, name) {
  const res = await Lead.updateMany({ dealer_id: { $in: dealerForms(dealerId) }, campaign: { $in: [null, ''] },
    $or: [{ sub_source: exact(code) }, { lead_source: exact(code) }] }, { $set: { campaign: name, campaign_set_by: 'code' } });
  return res.modifiedCount || 0;
}

async function campaignAction(req, body, dealerId, user) {
  if (!canEditCampaigns(user)) return fail('Only the dealership admin can change campaigns', 403);
  const action = body.action;
  const given = body.campaign || {};
  const doc = await LeadSourceList.findOne({ dealer_id: dealerId }).lean();
  const list = doc?.campaigns || [];
  const entry = { at: new Date(), by: user._id, by_name: user.name || null, action, from: null, to: null, leads_renamed: 0 };
  const check = (c) => {
    if (!c.name || c.name.length > 60) return 'A campaign name is 1 to 60 characters';
    if (!c.code || c.code.length > 60) return 'A tracking code is 1 to 60 characters';
    return null;
  };
  if (action === 'campaign_add') {
    const c = { name: clean(given.name), code: clean(given.code), lead_source: clean(given.lead_source) || null, active: true };
    const bad = check(c); if (bad) return fail(bad, 400);
    if (list.some((x) => same(x.name, c.name))) return fail(`"${c.name}" is already a campaign`, 409);
    if (list.some((x) => same(x.code, c.code))) return fail(`The code "${c.code}" is already used`, 409);
    await LeadSourceList.updateOne({ dealer_id: dealerId }, { $push: { campaigns: c } }, { upsert: true });
    entry.to = `${c.name} (${c.code})`;
    entry.leads_renamed = await tagExisting(dealerId, c.code, c.name);
  } else {
    const id = String(body.id || '');
    const at = list.findIndex((x) => String(x._id) === id);
    if (!mongoose.isValidObjectId(id) || at < 0) return fail('That campaign is not on the list', 404);
    const old = list[at];
    entry.from = `${old.name} (${old.code})`;
    if (action === 'campaign_remove') {
      await LeadSourceList.updateOne({ dealer_id: dealerId }, { $pull: { campaigns: { _id: old._id } } });
    } else {
      const c = { name: given.name != null ? clean(given.name) : old.name, code: given.code != null ? clean(given.code) : old.code,
        lead_source: given.lead_source !== undefined ? (clean(given.lead_source) || null) : (old.lead_source || null),
        active: given.active !== undefined ? Boolean(given.active) : old.active !== false };
      const bad = check(c); if (bad) return fail(bad, 400);
      if (list.some((x, i) => i !== at && same(x.name, c.name))) return fail(`"${c.name}" is already a campaign`, 409);
      if (list.some((x, i) => i !== at && same(x.code, c.code))) return fail(`The code "${c.code}" is already used`, 409);
      await LeadSourceList.updateOne({ dealer_id: dealerId, 'campaigns._id': old._id }, { $set: {
        'campaigns.$.name': c.name, 'campaigns.$.code': c.code, 'campaigns.$.lead_source': c.lead_source, 'campaigns.$.active': c.active } });
      // A renamed campaign keeps its leads under the new name, so reports don't split it in two.
      if (c.name !== old.name) {
        await Lead.updateMany({ dealer_id: { $in: dealerForms(dealerId) }, campaign: old.name }, { $set: { campaign: c.name } });
      }
      entry.to = `${c.name} (${c.code})${c.active ? '' : ' - off'}`;
      if (c.active) entry.leads_renamed = await tagExisting(dealerId, c.code, c.name);
    }
  }
  await LeadSourceList.updateOne({ dealer_id: dealerId }, { $push: { history: entry } });
  return Response.json(await listFor(dealerId, user));
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
  if (String(body.action || '').startsWith('campaign_')) return campaignAction(req, body, dealerId, access.user);
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
