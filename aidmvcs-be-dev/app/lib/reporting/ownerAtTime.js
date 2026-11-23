// Owner at the time (SOW 3 Deliverable A: "normalize ... owner history"). The Reports staff filter used the lead's
// CURRENT owner (Lead.assigned_to), so a lead reassigned today moved all its old appointments and replies to the new
// person. Now a lead counts for a staff member when that person owned it at some moment inside the picked days.
//
// Owner history = the reassignment log (ActivityLog action 'lead_reassigned', from_id -> to_id, at), written since
// 13 Nov 2026 by the lead card, bulk reassign and undo (an undo is its own entry, so the time the other person held
// the lead is kept). For one lead:
//   before its first logged change   the first entry's from_id (who had it when the log started)
//   after each change                that entry's to_id, until the next change
//   no logged change                 Lead.assigned_to (it never moved since the log started)
// A lead owned by two selected people in the range counts once; a lead that moved from A to B mid-range counts for
// A and for B when each is picked alone - each held it in those days.
//
// Imports are relative so BullMQ workers (the daily email) can load this module too.
import mongoose from 'mongoose';
import ActivityLog from '../../models/ActivityLog.js';
import Lead from '../../models/Lead.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const str = (v) => (v == null ? null : String(v));

/**
 * Owner spans of one lead from its reassignment entries (sorted by `at`).
 * @returns {{owner: string|null, from: Date|null, to: Date|null}[]}  from/to null = open-ended
 */
export function ownerSpans(currentOwner, entries = []) {
  const log = [...entries].sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!log.length) return [{ owner: str(currentOwner), from: null, to: null }];
  const spans = [{ owner: str(log[0].from_id), from: null, to: new Date(log[0].at) }];
  log.forEach((e, i) => spans.push({ owner: str(e.to_id), from: new Date(e.at), to: log[i + 1] ? new Date(log[i + 1].at) : null }));
  // The owner changed again without a log entry (e.g. a screen that doesn't log yet): when is unknown, so the current
  // owner is counted from the last logged change on, beside the last logged owner.
  const last = log[log.length - 1];
  if (str(currentOwner) !== str(last.to_id)) spans.push({ owner: str(currentOwner), from: new Date(last.at), to: null });
  return spans;
}

/** Whether any span owned by one of `staff` overlaps [start, end]. */
export function ownedDuring(spans, staff, start, end) {
  return spans.some((s) => s.owner && staff.has(s.owner)
    && (!s.from || s.from <= end) && (!s.to || s.to >= start));
}

const cache = new Map(); // one report run asks the same question several times
const TTL_MS = 60 * 1000;

/**
 * Ids (strings) of the dealer's leads owned by any of `staffIds` at some moment in [start, end].
 * @param {{dealerForms: string[], staffIds: string[], start: Date, end: Date}} args
 */
export async function leadsOwnedDuring({ dealerForms, staffIds, start, end }) {
  const staff = new Set((staffIds || []).map(String));
  if (!staff.size) return new Set();
  const key = JSON.stringify([dealerForms, [...staff].sort(), start, end]);
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - TTL_MS) return hit.ids;

  const staffOids = [...staff].filter((s) => mongoose.isValidObjectId(s)).map(oid);
  const dealer = { dealer_id: { $in: dealerForms } };
  // Candidates: owned now, or named in a reassignment either way.
  const [current, logged] = await Promise.all([
    Lead.collection.find({ ...dealer, assigned_to: { $in: staffOids } }, { projection: { _id: 1 } }).toArray(),
    ActivityLog.collection.distinct('lead_id', { ...dealer, action: 'lead_reassigned',
      $or: [{ from_id: { $in: staffOids } }, { to_id: { $in: staffOids } }] }),
  ]);
  const candidates = [...new Set([...current.map((l) => String(l._id)), ...logged.filter(Boolean).map(String)])];
  const ids = new Set();
  for (let i = 0; i < candidates.length; i += 2000) {
    const chunk = candidates.slice(i, i + 2000).map(oid);
    const [leads, entries] = await Promise.all([
      Lead.collection.find({ _id: { $in: chunk }, ...dealer }, { projection: { assigned_to: 1 } }).toArray(),
      ActivityLog.collection.find({ lead_id: { $in: chunk }, action: 'lead_reassigned' },
        { projection: { lead_id: 1, from_id: 1, to_id: 1, at: 1 } }).toArray(),
    ]);
    const byLead = new Map();
    for (const e of entries) {
      const k = String(e.lead_id);
      if (!byLead.has(k)) byLead.set(k, []);
      byLead.get(k).push(e);
    }
    for (const l of leads) {
      const k = String(l._id);
      if (ownedDuring(ownerSpans(l.assigned_to, byLead.get(k)), staff, start, end)) ids.add(k);
    }
  }
  cache.set(key, { at: Date.now(), ids });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return ids;
}
