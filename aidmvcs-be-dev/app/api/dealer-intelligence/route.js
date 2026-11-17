// A rooftop's Dealer Intelligence settings (SOW v6 Appendix A section 02; lib/dealerIntelligence/fields.js).
//   GET ?dealer_id              -> { values, history (last 50), can_edit, updated_at, updated_by }
//   PUT { dealer_id, values }   -> checked (a Yes needs its details; links valid), saved, every change in history
// Edited by the dealer account, staff with "Manage Account Information", or an AutoPulse super admin; only this
// rooftop's own settings (requireDealerAccess).
import dbConnect from '@lib/mongodb';
import DealerIntelligence from '@models/DealerIntelligence';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { FIELDS, normalizeValues } from '@lib/dealerIntelligence/fields';

export const runtime = 'nodejs';
const json = (b, s = 200) => Response.json(b, { status: s });
const canEdit = (user) => hasPermission(user, 'Manage Account Information');

async function view(dealerId, user) {
  const doc = await DealerIntelligence.findOne({ dealer_id: dealerId }).lean();
  const values = Object.fromEntries(FIELDS.map((f) => [f.key, (doc?.values || {})[f.key] ?? (f.type === 'tri' ? 'not_configured'
    : f.type === 'list' || f.type === 'fees' ? [] : null)]));
  return { values, history: (doc?.history || []).slice(-50).reverse(), can_edit: await canEdit(user),
    updated_at: doc?.updatedAt || null, updated_by: doc?.updated_by_name || null };
}

export async function GET(req) {
  await dbConnect();
  const dealerId = new URL(req.url).searchParams.get('dealer_id') || '';
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  return json(await view(dealerId, access.user));
}

export async function PUT(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return json({ error: 'The request body must be JSON' }, 400); }
  const dealerId = String(body?.dealer_id || '');
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  if (!(await canEdit(access.user))) return json({ error: 'You do not have permission to change these settings' }, 403);
  let values;
  try { values = normalizeValues(body.values || {}); } catch (e) { return json({ error: e.message, errors: e.errors }, 400); }
  const before = (await DealerIntelligence.findOne({ dealer_id: dealerId }).lean())?.values || {};
  const at = new Date(); const by = access.user?._id || null; const byName = access.user?.name || access.user?.email || null;
  const changes = FIELDS.filter((f) => JSON.stringify(before[f.key] ?? null) !== JSON.stringify(values[f.key] ?? null))
    .map((f) => ({ at, by, by_name: byName, key: f.key, from: before[f.key] ?? null, to: values[f.key] ?? null }));
  await DealerIntelligence.updateOne({ dealer_id: dealerId }, { $set: { values, updated_by_name: byName },
    ...(changes.length ? { $push: { history: { $each: changes, $slice: -500 } } } : {}) }, { upsert: true });
  return json({ ...(await view(dealerId, access.user)), changed: changes.length });
}
