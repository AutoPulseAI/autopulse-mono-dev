// Possible duplicate customers of one dealer (SOW B b3, G-008), for the manager's review list. Same rule as the
// Data Quality report's "Possible duplicate customers" (kpis/dataQuality.js): customers that share a phone number
// (last 10 digits) or an email address, not already merged into another. Pairs a manager marked "not the same
// person" (DuplicateReview) are not linked. Customers linked through shared contacts form one group.
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import Lead from '../models/Lead.js';
import DuplicateReview from '../models/DuplicateReview.js';

export const pairKey = (a, b) => [String(a), String(b)].sort().join(':');
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);

export async function duplicateGroups(dealerId, { limit = 100 } = {}) {
  const docs = await Customer.find({ dealer_id: String(dealerId), merged_into: { $in: [null] } })
    .select('name emails phones createdAt assigned_to').lean();
  const owners = new Map();
  for (const c of docs) {
    const keys = new Set([
      ...(c.emails || []).map((e) => String(e?.value || '').trim().toLowerCase()).filter(Boolean).map((e) => `e:${e}`),
      ...(c.phones || []).map((p) => digits(p?.value)).filter((d) => d.length === 10).map((d) => `p:${d}`),
    ]);
    for (const k of keys) {
      if (!owners.has(k)) owners.set(k, []);
      owners.get(k).push(String(c._id));
    }
  }
  const dismissed = new Set((await DuplicateReview.find({ dealer_id: String(dealerId), decision: 'not_duplicate' })
    .select('pair').lean()).map((r) => r.pair));

  // Union-find over the shared contacts, skipping dismissed pairs.
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const shared = new Map(); // pair -> shared contacts
  for (const [key, ids] of owners) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const p = pairKey(ids[i], ids[j]);
        if (dismissed.has(p)) continue;
        if (!shared.has(p)) shared.set(p, []);
        shared.get(p).push(key.slice(2));
        for (const x of [ids[i], ids[j]]) if (!parent.has(x)) parent.set(x, x);
        const a = find(ids[i]), b = find(ids[j]);
        if (a !== b) parent.set(a, b);
      }
    }
  }
  const members = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(id);
  }
  const byId = new Map(docs.map((c) => [String(c._id), c]));
  const allIds = [...parent.keys()];
  const counts = allIds.length ? await Lead.aggregate([
    { $match: { dealer_id: String(dealerId), customer_id: { $in: allIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: '$customer_id', leads: { $sum: 1 }, last_lead_at: { $max: '$createdAt' } } },
  ]) : [];
  const leadInfo = new Map(counts.map((r) => [String(r._id), r]));

  const groups = [...members.values()].map((ids) => {
    const customers = ids.map((id) => {
      const c = byId.get(id) || {};
      return { _id: id, name: c.name || null, emails: (c.emails || []).map((e) => e.value),
        phones: (c.phones || []).map((p) => p.value), created_at: c.createdAt || null,
        leads: leadInfo.get(id)?.leads || 0, last_lead_at: leadInfo.get(id)?.last_lead_at || null };
    }).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const pairs = [];
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
      const p = pairKey(ids[i], ids[j]);
      if (shared.has(p)) pairs.push({ customer_ids: p.split(':'), shared: [...new Set(shared.get(p))] });
    }
    const latest = Math.max(...customers.map((c) => new Date(c.last_lead_at || c.created_at || 0).getTime()));
    return { customers, pairs, latest };
  }).sort((a, b) => b.latest - a.latest);
  // Merges done by managers, newest first, so one can be undone (app/api/customers/merge).
  const kept = await Customer.find({ dealer_id: String(dealerId), 'merge_history.0': { $exists: true } })
    .select('name merge_history').lean();
  const mergedIds = kept.flatMap((k) => k.merge_history.map((h) => h.merged_customer_id));
  const mergedNames = new Map((await Customer.find({ _id: { $in: mergedIds } }).select('name merged_into').lean())
    .map((c) => [String(c._id), c]));
  const recentMerges = kept.flatMap((k) => k.merge_history.filter((h) => !h.reversed_at
    && String(mergedNames.get(String(h.merged_customer_id))?.merged_into || '') === String(k._id))
    .map((h) => ({ kept_id: String(k._id), kept_name: k.name || null, merged_id: String(h.merged_customer_id),
      merged_name: mergedNames.get(String(h.merged_customer_id))?.name || null, merged_at: h.merged_at || null,
      reason: h.reason || null })))
    .sort((a, b) => new Date(b.merged_at || 0) - new Date(a.merged_at || 0)).slice(0, 50);
  return { total: groups.length, groups: groups.slice(0, limit), recent_merges: recentMerges };
}
