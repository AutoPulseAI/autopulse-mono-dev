// Admin > DMS feed > Source precedence (super admin; SOW Appendix B 3 "Source precedence must be configurable by
// field/data type"; 23 Nov 2026). Stored in `reconciliation_policies`: dealer_id '*' = all dealers, else one dealer
// (its own settings win over the all-dealers ones). Every save keeps the previous settings in history.
//   GET ?dealer=<id|*>  -> { defaults, all, dealer, effective, sources, history }
//   PUT { dealer: <id|*>, fields: { name|phone|email|mileage: { precedence?, dms_contacts?, review_drop_miles?,
//         review_jump_miles_per_year? } } }   fields = {} puts that scope back to the defaults
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import { requireSuperAdmin } from '@lib/apiGuard';
import { DEFAULT_POLICY, SOURCES, SOURCE_NAMES, cleanOverride, clearPolicyCache, mergePolicy } from '@lib/reconcile/policy';

const json = (b, s = 200) => Response.json(b, { status: s });
const coll = () => mongoose.connection.collection('reconciliation_policies');
const scopeOf = (v) => (v === '*' || !v ? '*' : mongoose.isValidObjectId(v) ? String(v) : null);

export async function GET(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const dealer = scopeOf(new URL(req.url).searchParams.get('dealer'));
  if (!dealer) return json({ error: 'dealer must be a dealer id or *' }, 400);
  const docs = await coll().find({ dealer_id: { $in: ['*', dealer] } }).toArray();
  const all = docs.find((d) => d.dealer_id === '*') || null;
  const own = dealer === '*' ? null : docs.find((d) => d.dealer_id === dealer) || null;
  return json({ defaults: DEFAULT_POLICY, all: all?.fields || {}, dealer: own?.fields || {}, effective: mergePolicy(all, own),
    sources: SOURCES.map((s) => ({ id: s, name: SOURCE_NAMES[s] })),
    history: ((dealer === '*' ? all : own)?.history || []).slice(-10).reverse() });
}

export async function PUT(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return json({ error: 'The request body must be JSON' }, 400); }
  const dealer = scopeOf(body?.dealer);
  if (!dealer) return json({ error: 'dealer must be a dealer id or *' }, 400);
  const fields = cleanOverride(body?.fields || {});
  const before = await coll().findOne({ dealer_id: dealer });
  await coll().updateOne({ dealer_id: dealer }, {
    $set: { fields, updated_at: new Date(), updated_by: access.user._id, updated_by_name: access.user.name || null },
    $push: { history: { $each: [{ at: new Date(), by_name: access.user.name || null, before: before?.fields || {}, after: fields }], $slice: -50 } },
  }, { upsert: true });
  clearPolicyCache();
  return json({ ok: true, fields });
}
