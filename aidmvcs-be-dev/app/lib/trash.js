// Undo delete (BB, 14 Nov 2026: "undo delete for tasks and campaigns"). A deleted record is copied here first, with
// the records that go with it, and can be put back for 30 days (TRASH_DAYS). Collection `deleted_records`:
//   { kind, dealer_id, record_id, label, doc, children: { <collection>: [docs] }, deleted_at, deleted_by,
//     deleted_by_name, restored_at?, restored_by? }
// Restoring re-inserts the same documents with their own _ids, so links to them still work.
import mongoose from 'mongoose';

export const TRASH_DAYS = 30;
const coll = () => mongoose.connection.db.collection('deleted_records');

/** Copy a record (and its children) to the trash before it is deleted. */
export async function moveToTrash({ kind, dealerId, doc, label, children = {}, user }) {
  const plain = (d) => (typeof d?.toObject === 'function' ? d.toObject({ depopulate: true }) : d);
  const res = await coll().insertOne({
    kind, dealer_id: String(dealerId), record_id: String(doc._id), label: label || null, doc: plain(doc),
    children: Object.fromEntries(Object.entries(children).map(([k, list]) => [k, (list || []).map(plain)])),
    deleted_at: new Date(), deleted_by: user?._id || null, deleted_by_name: user?.name || null,
  });
  return String(res.insertedId);
}

/** What can still be put back, newest first. */
export async function listTrash({ kind, dealerId }) {
  const since = new Date(Date.now() - TRASH_DAYS * 86400000);
  return coll().find({ kind, dealer_id: String(dealerId), restored_at: { $exists: false }, deleted_at: { $gte: since } })
    .project({ doc: 0, children: 0 }).sort({ deleted_at: -1 }).limit(50).toArray();
}

/**
 * Put a deleted record back. `prepare(doc)` may change the record before it goes back (e.g. a campaign comes back
 * as a draft). Returns { ok, record_id } or { error, status }.
 */
export async function restoreFromTrash({ id, kind, dealerId, user, collection, prepare = (d) => d }) {
  if (!mongoose.isValidObjectId(id)) return { error: 'Not found', status: 404 };
  const entry = await coll().findOne({ _id: new mongoose.Types.ObjectId(id), kind, dealer_id: String(dealerId) });
  if (!entry) return { error: 'Not found', status: 404 };
  if (entry.restored_at) return { error: 'This was already put back', status: 409 };
  if (entry.deleted_at < new Date(Date.now() - TRASH_DAYS * 86400000)) {
    return { error: `Deleted more than ${TRASH_DAYS} days ago - it can no longer be put back`, status: 410 };
  }
  // Claim it first so two clicks can't restore twice.
  const claim = await coll().updateOne({ _id: entry._id, restored_at: { $exists: false } },
    { $set: { restored_at: new Date(), restored_by: user?._id || null, restored_by_name: user?.name || null } });
  if (!claim.modifiedCount) return { error: 'This was already put back', status: 409 };
  const db = mongoose.connection.db;
  if (await db.collection(collection).findOne({ _id: entry.doc._id })) return { error: 'It is already there', status: 409 };
  await db.collection(collection).insertOne(prepare(entry.doc));
  for (const [name, docs] of Object.entries(entry.children || {})) {
    if (docs?.length) await db.collection(name).insertMany(docs, { ordered: false }).catch(() => null);
  }
  return { ok: true, record_id: entry.record_id };
}
