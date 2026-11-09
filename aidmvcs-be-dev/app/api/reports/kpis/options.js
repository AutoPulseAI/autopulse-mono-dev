// The Reports page filter bar's choices for one dealer: the stored source / lead source values of its leads (the
// filters match stored values exactly, app/lib/reporting/filters.js leadMatch) and its staff (the dealer account and
// users whose parent is the dealer - the people leads can be assigned to).
import mongoose from 'mongoose';
import Lead from '../../../models/Lead.js';
import User from '../../../models/User.js';

export async function filterOptions(dealerId) {
  const forms = mongoose.isValidObjectId(dealerId) && /^[0-9a-f]{24}$/i.test(dealerId)
    ? [dealerId, new mongoose.Types.ObjectId(dealerId)] : [dealerId];
  const [sources, leadSources] = await Promise.all([
    Lead.collection.distinct('source', { dealer_id: { $in: forms } }),
    Lead.collection.distinct('lead_source', { dealer_id: { $in: forms } }),
  ]);
  const clean = (list) => [...new Set(list.filter((v) => typeof v === 'string' && v.trim()).map((v) => v))]
    .sort((a, b) => a.localeCompare(b));
  const staff = mongoose.isValidObjectId(dealerId)
    ? await User.find({ $or: [{ _id: dealerId }, { parent_id: dealerId }] }).select('_id name').lean() : [];
  return {
    sources: clean(sources),
    lead_sources: clean(leadSources),
    staff: staff.map((u) => ({ id: String(u._id), name: u.name || String(u._id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
