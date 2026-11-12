// Customer merge (SOW Deliverable B b3, gap G-008: "safe merge review; never destroy provenance or separate valid
// opportunities"). A merge only MARKS the merged customer (Customer.merged_into = the kept customer); its leads, deals,
// service records, trade-ins, conversations and the AI's records stay exactly as they are, under their own ids, so a
// merge can be undone and the AI service (which keys consent and memory by the lead's customer id) is not touched.
// The CRM screens read a customer together with every customer merged into it - this "family" - and the reports
// already follow merged_into (reporting/replyCohorts.js, kpis/executive.js).
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';

const MAX_DEPTH = 5;

/** The kept customer id for this one: follows merged_into (a merged customer -> the one it was merged into). */
export async function survivorOf(customerId, dealerId, { Model = Customer } = {}) {
  let id = String(customerId);
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    const c = await Model.findOne({ _id: id, dealer_id: String(dealerId) }).select('merged_into').lean();
    if (!c?.merged_into) return id;
    id = String(c.merged_into);
  }
  return id;
}

/** The kept customer (this one, or the one it was merged into) plus every customer merged into it (also merged in
 * turn), as ObjectIds - so a merged customer's page shows the same records as the kept one. */
export async function customerFamily(customerId, dealerId, { Model = Customer } = {}) {
  const kept = await survivorOf(customerId, dealerId, { Model });
  const ids = [kept];
  let frontier = [kept];
  for (let i = 0; i < MAX_DEPTH && frontier.length; i += 1) {
    const merged = await Model.find({ dealer_id: String(dealerId), merged_into: { $in: frontier } }).select('_id').lean();
    frontier = merged.map((m) => String(m._id)).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
}
