// Admin > DMS feed (24 Nov 2026; docs/superpowers/specs/2026-11-24-dms-feed-design.md): the three tabs' data, all
// counted from the records they describe - Needs you (problems grouped by kind), Feed health (stores, one store's
// file types and files, one file's rows), Look up (a customer's field history). Read-only except resolveValue.
// A count and the list it opens always come from the same query, so they can't disagree.
import mongoose from 'mongoose';
import FeedStatus from '../../models/DealerVaultFeedStatus.js';
import Batch from '../../models/DealerVaultImportBatch.js';
import HeldFile from '../../models/DealerVaultHeldFile.js';
import CustomerFieldHistory from '../../models/CustomerFieldHistory.js';
import Customer from '../../models/Customer.js';
import Deal from '../../models/Deal.js';
import RepairOrder from '../../models/RepairOrder.js';
import ServiceAppointment from '../../models/ServiceAppointment.js';
import { KEY_COLUMN } from '../../worker/dealervault/feedCheck.js';
import { recordHistory } from '../reconcile/ledger.js';
import { LATE_HOURS, backfillFeedStatus, feedWord, stampDate } from './feedStatus.js';

export const PAGE = 25;
export const TYPES = ['SL', 'SV', 'SV_APPT', 'PTINV'];
const CUSTOMER_CODES = ['CUSTOMER_UNRESOLVED', 'CUSTOMER_AMBIGUOUS', 'CUSTOMER_MERGED'];
const RECORDS = { SL: { Model: Deal, key: 'deal_number', label: 'Deal' }, SV: { Model: RepairOrder, key: 'ro_number', label: 'RO' },
  SV_APPT: { Model: ServiceAppointment, key: 'appointment_number', label: 'Appointment' } };
const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stampAt = (date) => date.toISOString().replace(/\D/g, '').slice(0, 12);
const pageOf = (p) => Math.max(1, Math.min(100000, Number.parseInt(p, 10) || 1));
const paged = (total, page) => ({ total, page, pages: Math.max(1, Math.ceil(total / PAGE)) });

async function ensureStatus() {
  if (!(await FeedStatus.estimatedDocumentCount())) await backfillFeedStatus();
}

/** Dealers by id and by store, for names. */
async function dealerMap(ids = null) {
  const q = { type: 'dealer', ...(ids ? { _id: { $in: ids.filter((i) => mongoose.isValidObjectId(i)).map((i) => new mongoose.Types.ObjectId(String(i))) } } : { dv_dealer_id: { $nin: [null, ''] } }) };
  const users = await mongoose.connection.collection('users').find(q, { projection: { name: 1, dv_dealer_id: 1, timezone: 1 } }).toArray();
  return { byId: new Map(users.map((u) => [String(u._id), u])), byDv: new Map(users.filter((u) => u.dv_dealer_id).map((u) => [u.dv_dealer_id, u])) };
}

/** The store picker: stores whose ID or dealer name matches (at most 20). */
export async function storeSearch(q = '') {
  await ensureStatus();
  const rx = q ? new RegExp(escape(q.trim().slice(0, 60)), 'i') : null;
  const named = rx ? await mongoose.connection.collection('users').find({ type: 'dealer', name: rx, dv_dealer_id: { $nin: [null, ''] } },
    { projection: { dv_dealer_id: 1 } }).limit(20).toArray() : [];
  const dvs = await FeedStatus.distinct('dvDealerId', rx ? { $or: [{ dvDealerId: rx }, { dvDealerId: { $in: named.map((n) => n.dv_dealer_id) } }] } : {});
  const { byDv } = await dealerMap();
  return dvs.slice(0, 20).map((dv) => ({ dv, dealer: byDv.get(dv) ? { id: String(byDv.get(dv)._id), name: byDv.get(dv).name } : null }))
    .sort((a, b) => (!!b.dealer - !!a.dealer) || (a.dealer?.name || a.dv).localeCompare(b.dealer?.name || b.dv));
}

// ---------- Needs you ----------
// Each kind: count(scope) -> { count, stores }, rows(scope, page) -> { rows, total }. scope = { dv, dealerId, type, days }.
const lateMatch = (s, now) => ({ last_stamp: { $lt: stampAt(new Date(now - LATE_HOURS * 3600000)), $gte: stampAt(new Date(now - 30 * 86400000)) },
  ...(s.dv ? { dvDealerId: s.dv } : {}), ...(s.type ? { fileType: s.type } : {}), fileType: s.type || { $in: TYPES } });

async function dealerIdsFor(s) {
  if (s.dealerId) return [s.dealerId];
  if (s.dv) return [];
  return null; // all dealers
}

const KINDS = {
  late: {
    async count(s, now) {
      const rows = await FeedStatus.find(lateMatch(s, now)).select('dvDealerId').lean();
      return { count: rows.length, stores: new Set(rows.map((r) => r.dvDealerId)).size };
    },
    async rows(s, page, now) {
      const q = lateMatch(s, now);
      const [docs, total] = await Promise.all([FeedStatus.find(q).sort({ last_stamp: 1 }).skip((page - 1) * PAGE).limit(PAGE).lean(), FeedStatus.countDocuments(q)]);
      const { byDv } = await dealerMap();
      return { total, rows: docs.map((d) => ({ dv: d.dvDealerId, dealer: byDv.get(d.dvDealerId)?.name || null, type: d.fileType,
        last_stamp: d.last_stamp, days: Math.floor(feedWord(d, new Date(now)).hours / 24) })) };
    },
  },
  not_linked: {
    async count(s) {
      const dvs = await FeedStatus.distinct('dvDealerId', { dealer_id: null, ...(s.dv ? { dvDealerId: s.dv } : {}) });
      const { byDv } = await dealerMap();
      const open = dvs.filter((dv) => !byDv.has(dv));
      const held = open.length ? await HeldFile.countDocuments({ dvDealerId: { $in: open }, status: 'held' }) : 0;
      return { count: open.length, stores: open.length, held };
    },
    async rows(s, page) {
      const { byDv } = await dealerMap();
      const dvs = (await FeedStatus.distinct('dvDealerId', { dealer_id: null, ...(s.dv ? { dvDealerId: s.dv } : {}) })).filter((dv) => !byDv.has(dv)).sort();
      const slice = dvs.slice((page - 1) * PAGE, page * PAGE);
      const rows = await Promise.all(slice.map(async (dv) => {
        const [st, held] = await Promise.all([FeedStatus.find({ dvDealerId: dv }).lean(), HeldFile.countDocuments({ dvDealerId: dv, status: 'held' })]);
        return { dv, types: st.map((x) => x.fileType).sort(), last_stamp: st.reduce((m, x) => (x.last_stamp > m ? x.last_stamp : m), ''), held };
      }));
      return { total: dvs.length, rows };
    },
  },
  held: {
    query(s, linked) {
      return { status: 'held', dvDealerId: s.dv ? s.dv : { $in: [...linked] }, ...(s.type ? { fileType: s.type } : {}),
        ...(s.from || s.to ? { createdAt: { ...(s.from ? { $gte: s.from } : {}), ...(s.to ? { $lte: s.to } : {}) } } : {}) };
    },
    async count(s) {
      const { byDv } = await dealerMap();
      if (s.dv && !byDv.has(s.dv)) return { count: 0, stores: 0 };
      const q = this.query(s, byDv.keys());
      const [count, stores] = await Promise.all([HeldFile.countDocuments(q), HeldFile.distinct('dvDealerId', q)]);
      return { count, stores: stores.length };
    },
    async rows(s, page) {
      const { byDv } = await dealerMap();
      if (s.dv && !byDv.has(s.dv)) return { total: 0, rows: [] };
      const q = this.query(s, byDv.keys());
      const [docs, total] = await Promise.all([HeldFile.find(q).sort({ fileName: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(), HeldFile.countDocuments(q)]);
      return { total, rows: docs.map((h) => ({ id: String(h._id), file: h.fileName, dv: h.dvDealerId, dealer: byDv.get(h.dvDealerId)?.name || null,
        type: h.fileType, rows: h.records, expected: h.expected, reasons: h.reasons || [] })) };
    },
  },
  value_review: {
    match(s) {
      return { decision: 'REVIEW', review_resolved_at: { $exists: false }, ...(s.dealerId ? { dealer_id: s.dealerId } : {}),
        ...(s.from || s.to ? { imported_at: { ...(s.from ? { $gte: s.from } : {}), ...(s.to ? { $lte: s.to } : {}) } } : {}) };
    },
    async count(s) {
      if (s.dv && !s.dealerId) return { count: 0, stores: 0 };
      const [g] = await CustomerFieldHistory.aggregate([{ $match: this.match(s) },
        { $group: { _id: { c: '$customer_id', f: '$field' }, d: { $first: '$dealer_id' } } },
        { $group: { _id: null, n: { $sum: 1 }, stores: { $addToSet: '$d' } } }]);
      return { count: g?.n || 0, stores: g?.stores.length || 0 };
    },
    async rows(s, page) {
      if (s.dv && !s.dealerId) return { total: 0, rows: [] };
      const [res] = await CustomerFieldHistory.aggregate([{ $match: this.match(s) }, { $sort: { source_event_date: -1, imported_at: -1 } },
        { $group: { _id: { c: '$customer_id', f: '$field' }, last: { $first: '$$ROOT' }, n: { $sum: 1 } } }, { $sort: { 'last.imported_at': -1 } },
        { $facet: { total: [{ $count: 'n' }], rows: [{ $skip: (page - 1) * PAGE }, { $limit: PAGE }] } }]);
      const groups = res?.rows || [];
      const customers = await Customer.find({ _id: { $in: groups.map((g) => g._id.c) } }).select('name').lean();
      const names = new Map(customers.map((c) => [String(c._id), c.name]));
      const { byId } = await dealerMap(groups.map((g) => g.last.dealer_id));
      // The value it would replace: the newest accepted reading of that field.
      const current = await Promise.all(groups.map((g) => CustomerFieldHistory.findOne({ customer_id: g._id.c, field: g._id.f, decision: 'ACCEPT' })
        .sort({ source_event_date: -1, imported_at: -1 }).lean()));
      return { total: res?.total[0]?.n || 0, rows: groups.map((g, i) => ({ customer_id: String(g._id.c), customer: names.get(String(g._id.c)) || null,
        field: g._id.f, dealer: byId.get(g.last.dealer_id)?.name || null, observations: g.n,
        incoming: { value: g.last.value, date: g.last.source_event_date, record: g.last.source_record_id, type: g.last.source_event_type },
        current: current[i] ? { value: current[i].value, date: current[i].source_event_date, record: current[i].source_record_id } : null,
        reason: g.last.reason })) };
    },
  },
  no_customer: {
    async count(s) {
      const ids = await dealerIdsFor(s);
      if (ids && !ids.length) return { count: 0, stores: 0 };
      let count = 0; const stores = new Set();
      for (const [type, r] of Object.entries(RECORDS)) {
        if (s.type && s.type !== type) continue;
        const q = { customer_id: null, ...(ids ? { dealer_id: { $in: ids } } : {}) };
        count += await r.Model.countDocuments(q);
        for (const d of await r.Model.distinct('dealer_id', q)) stores.add(d);
      }
      return { count, stores: stores.size };
    },
    async rows(s, page) {
      const ids = await dealerIdsFor(s);
      if (ids && !ids.length) return { total: 0, rows: [] };
      // Paged across the three record kinds in a fixed order (deals, ROs, appointments).
      const out = []; let total = 0; let skip = (page - 1) * PAGE;
      for (const [type, r] of Object.entries(RECORDS)) {
        if (s.type && s.type !== type) continue;
        const q = { customer_id: null, ...(ids ? { dealer_id: { $in: ids } } : {}) };
        const n = await r.Model.countDocuments(q);
        total += n;
        if (out.length >= PAGE || skip >= n) { skip = Math.max(0, skip - n); continue; }
        const docs = await r.Model.find(q).sort({ source_file_timestamp: -1, [r.key]: -1 }).skip(skip).limit(PAGE - out.length)
          .select({ [r.key]: 1, dealer_id: 1, 'Full Name': 1, 'Customer Number': 1, source_file_timestamp: 1 }).lean();
        skip = 0;
        out.push(...docs.map((d) => ({ type, key: d[r.key], dealer_id: d.dealer_id, customer: d['Full Name'] || null, number: d['Customer Number'] || null })));
      }
      const { byId } = await dealerMap(out.map((o) => o.dealer_id));
      return { total, rows: out.map((o) => ({ ...o, dealer: byId.get(o.dealer_id)?.name || null, dv: byId.get(o.dealer_id)?.dv_dealer_id || null })) };
    },
  },
  rejected: {
    match(s, now) {
      const r = rangeOf(s, now, 7);
      return { createdAt: { $gte: r.from, $lte: r.to }, 'row_outcomes.decision': 'REJECT',
        ...(s.dv ? { dvDealerId: s.dv } : {}), ...(s.type ? { fileType: s.type } : {}) };
    },
    pipeline(s, now) {
      return [{ $match: this.match(s, now) }, { $project: { fileName: 1, dvDealerId: 1, fileType: 1, dealer_id: 1,
        rej: { $filter: { input: '$row_outcomes', cond: { $eq: ['$$this.decision', 'REJECT'] } } } } },
      { $unwind: '$rej' }, { $group: { _id: '$fileName', dv: { $first: '$dvDealerId' }, type: { $first: '$fileType' }, dealer_id: { $first: '$dealer_id' },
        n: { $sum: 1 }, codes: { $addToSet: { $ifNull: ['$rej.reason', '$rej.code'] } } } }];
    },
    async count(s, now) {
      const [g] = await Batch.aggregate([...this.pipeline(s, now), { $group: { _id: null, n: { $sum: '$n' }, stores: { $addToSet: '$dv' } } }]);
      return { count: g?.n || 0, stores: g?.stores.length || 0 };
    },
    async rows(s, page, now) {
      const [res] = await Batch.aggregate([...this.pipeline(s, now), { $sort: { _id: -1 } },
        { $facet: { total: [{ $count: 'n' }], rows: [{ $skip: (page - 1) * PAGE }, { $limit: PAGE }] } }]);
      const { byId } = await dealerMap((res?.rows || []).map((r) => r.dealer_id));
      return { total: res?.total[0]?.n || 0, rows: (res?.rows || []).map((r) => ({ file: r._id, dv: r.dv, type: r.type, dealer: byId.get(r.dealer_id)?.name || null, rows: r.n, codes: r.codes })) };
    },
  },
};
export const KIND_ORDER = ['late', 'not_linked', 'held', 'value_review', 'no_customer', 'rejected'];

/** A YYYY-MM-DD day as the start (or end) of that UTC day, or null. */
export function dayAt(value, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const d = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function scopeOf({ dv, type, from, to }) {
  const { byDv } = await dealerMap();
  return { dv: dv || null, dealerId: dv && byDv.get(dv) ? String(byDv.get(dv)._id) : null,
    type: TYPES.includes(type) ? type : null, from: dayAt(from), to: dayAt(to, true) };
}
// The date range a list uses: the picked dates, or the last `days` days.
const rangeOf = (s, now, days) => ({ from: s.from || new Date(now - days * 86400000), to: s.to || new Date(now) });

export async function needsYou(scope, now = Date.now()) {
  await ensureStatus();
  const out = [];
  for (const kind of KIND_ORDER) out.push({ kind, ...(await KINDS[kind].count(scope, now)) });
  return out;
}
export async function needsRows(kind, scope, page, now = Date.now()) {
  await ensureStatus();
  if (!KINDS[kind]) throw new Error('Unknown kind');
  const res = await KINDS[kind].rows(scope, pageOf(page), now);
  return { kind, ...res, ...paged(res.total, pageOf(page)) };
}

/** Resolve a value waiting for a decision: every open REVIEW of that customer + field. */
export async function resolveValue({ customerId, field, action, who }) {
  const rows = await CustomerFieldHistory.find({ customer_id: customerId, field, decision: 'REVIEW', review_resolved_at: { $exists: false } })
    .sort({ source_event_date: -1, imported_at: -1 }).lean();
  if (!rows.length) return { resolved: 0 };
  const row = rows[0];
  if (action === 'accept') {
    await recordHistory([{ dealer_id: row.dealer_id, customer_id: row.customer_id, field: row.field, value: row.value, prior_value: row.prior_value,
      decision: 'ACCEPT', reason: 'reviewed: accepted by staff', source: 'DEALER_USER', source_event_type: row.source_event_type,
      source_event_date: row.source_event_date, source_record_id: row.source_record_id, source_file: row.source_file, precision: row.precision,
      status: 'DEALER_USER_CONFIRMED', by: who._id, by_name: who.name || null }]);
  }
  await CustomerFieldHistory.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { review_resolved_at: new Date(),
    review_resolved_by_name: `${who.name || 'Super admin'} (${action === 'accept' ? 'accepted' : 'kept the current value'})` } });
  return { resolved: rows.length };
}

// ---------- Feed health ----------
/** All stores (paged, problem stores first) or one store's sheet. */
export async function health({ q = '', status = '', type = '', page = 1 }, now = Date.now()) {
  await ensureStatus();
  const lateBefore = stampAt(new Date(now - LATE_HOURS * 3600000));
  const { byDv } = await dealerMap();
  let dvFilter = null;
  if (q.trim()) {
    const rx = new RegExp(escape(q.trim().slice(0, 60)), 'i');
    dvFilter = [...byDv.values()].filter((u) => rx.test(u.name || '')).map((u) => u.dv_dealer_id);
    dvFilter.push(...await FeedStatus.distinct('dvDealerId', { dvDealerId: rx }));
  }
  const docs = await FeedStatus.find({ ...(dvFilter ? { dvDealerId: { $in: dvFilter } } : {}), fileType: { $in: TYPES } }).lean();
  const stores = new Map();
  for (const d of docs) {
    const s = stores.get(d.dvDealerId) || { dv: d.dvDealerId, types: {}, linked: byDv.has(d.dvDealerId) };
    const w = feedWord(d, new Date(now));
    s.types[d.fileType] = { ...w, last_stamp: d.last_stamp, files_30d: d.stamps.length };
    stores.set(d.dvDealerId, s);
  }
  const held = await HeldFile.aggregate([{ $match: { status: 'held' } }, { $group: { _id: '$dvDealerId', n: { $sum: 1 } } }]);
  const heldBy = new Map(held.map((h) => [h._id, h.n]));
  let rows = [...stores.values()].map((s) => {
    const words = Object.values(s.types).map((t) => t.word);
    const state = !s.linked ? 'not_linked' : words.includes('late') ? 'late' : words.includes('held') || heldBy.get(s.dv) ? 'held' : 'ok';
    return { ...s, dealer: byDv.get(s.dv)?.name || null, held: heldBy.get(s.dv) || 0, state };
  });
  if (status) rows = rows.filter((r) => r.state === status);
  if (type) rows = rows.filter((r) => r.types[type]);
  const rank = { not_linked: 0, late: 1, held: 2, ok: 3 };
  rows.sort((a, b) => rank[a.state] - rank[b.state] || (a.dealer || a.dv).localeCompare(b.dealer || b.dv));
  const p = pageOf(page);
  return { ...paged(rows.length, p), late_hours: LATE_HOURS, lateBefore, rows: rows.slice((p - 1) * PAGE, p * PAGE) };
}

/** Outcome of one row, in the page's words. Vehicle warnings don't count: AutoPulse's cars are the for-sale inventory. */
function outcomeOf(o) {
  if (o.decision === 'REJECT' || o.status === 'failed') return 'rejected';
  if (o.decision === 'RETAIN') return 'older';
  if ((o.review || o.warnings || []).some((c) => CUSTOMER_CODES.includes(c))) return 'not_on_customer';
  if (!o.decision) return 'importing';
  return o.reason === 'new record' ? 'new' : 'updated';
}
export const OUTCOMES = ['new', 'updated', 'older', 'not_on_customer', 'rejected', 'importing'];

/** One store's files of one type (paged), newest first, with exact counts; held files included. */
export async function storeFiles({ dv, type, page = 1, from = null, to = null }, now = Date.now()) {
  const { byDv } = await dealerMap();
  const dealer = byDv.get(dv);
  const r = rangeOf({ from, to }, now, 30);
  const since = stampAt(r.from);
  const until = stampAt(r.to);
  const batches = dealer ? await Batch.find({ dealer_id: String(dealer._id), fileType: type, source_file_timestamp: { $gte: since, $lte: until } })
    .select('fileName source_file_timestamp status total_records row_outcomes.decision row_outcomes.reason row_outcomes.review row_outcomes.warnings row_outcomes.status').lean() : [];
  const files = new Map();
  for (const b of batches) {
    const f = files.get(b.fileName) || { file: b.fileName, stamp: b.source_file_timestamp, state: 'imported', rows: 0, counts: Object.fromEntries(OUTCOMES.map((k) => [k, 0])) };
    f.rows += b.total_records || 0;
    for (const o of b.row_outcomes || []) f.counts[outcomeOf(o)] += 1;
    f.counts.importing += Math.max(0, (b.total_records || 0) - (b.row_outcomes || []).length);
    if (['pending', 'processing'].includes(b.status)) f.state = 'importing';
    if (b.status === 'failed') f.state = 'failed';
    files.set(b.fileName, f);
  }
  const held = await HeldFile.find({ dvDealerId: dv, fileType: type, status: { $in: ['held', 'discarded'] } }).lean();
  for (const h of held) {
    const stamp = h.fileName.match(/_(\d{8})_(\d{4})_/);
    const st = stamp ? `${stamp[1]}${stamp[2]}` : null;
    if (!st || st < since || st > until || files.has(h.fileName)) continue;
    files.set(h.fileName, { file: h.fileName, stamp: st, state: h.status, id: String(h._id), rows: h.records, expected: h.expected, reasons: h.reasons, counts: null });
  }
  const list = [...files.values()].sort((a, b) => String(b.stamp).localeCompare(String(a.stamp)));
  const p = pageOf(page);
  return { dv, type, dealer: dealer?.name || null, ...paged(list.length, p), rows: list.slice((p - 1) * PAGE, p * PAGE) };
}

/** The rows of one file with one outcome (paged): exactly the rows its count counted. */
export async function fileRows({ file, outcome, page = 1 }) {
  const batches = await Batch.find({ fileName: file }).sort({ batchId: 1 }).lean();
  if (!batches.length) {
    const h = await HeldFile.findOne({ fileName: file }).lean();
    return { file, held: h ? { status: h.status, reasons: h.reasons, rows: h.records, expected: h.expected } : null, total: 0, page: 1, pages: 1, rows: [] };
  }
  const col = KEY_COLUMN[batches[0].fileType];
  const out = [];
  for (const b of batches) {
    let raw = null;
    for (const o of b.row_outcomes || []) {
      if (outcomeOf(o) !== outcome) continue;
      if (!raw) { try { raw = JSON.parse(b.raw_records_json); } catch { raw = []; } }
      const r = raw[o.row_index] || {};
      out.push({ key: String(r[col] ?? '').trim() || null, customer: String(r['Full Name'] || '').trim() || [r['First Name'], r['Last Name']].filter(Boolean).join(' ') || null,
        number: r['Customer Number'] || null, detail: r['Part Description'] || [r.Year, r.Make, r.Model].filter(Boolean).join(' ') || null,
        why: o.decision === 'REJECT' ? [o.reason || o.code] : o.decision === 'RETAIN' ? ['a newer file is already applied'] : (o.review || o.warnings || []).filter((c) => CUSTOMER_CODES.includes(c)),
        changed: o.retained_fields?.length ? o.retained_fields.length : null });
    }
  }
  const p = pageOf(page);
  return { file, type: batches[0].fileType, key_label: { SL: 'Deal', SV: 'RO', SV_APPT: 'Appointment', PTINV: 'Part' }[batches[0].fileType],
    ...paged(out.length, p), rows: out.slice((p - 1) * PAGE, p * PAGE) };
}

// ---------- Look up ----------
export async function lookup({ q, dv, from = null, to = null }) {
  const text = String(q || '').trim().slice(0, 60);
  const { byDv, byId } = await dealerMap();
  const dealerId = dv && byDv.get(dv) ? String(byDv.get(dv)._id) : null;
  if (text.length < 2) {
    // Nothing typed yet: the customers whose details the DMS touched most recently, with what happened last.
    const when = from || to ? { imported_at: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {};
    const recent = await CustomerFieldHistory.aggregate([{ $match: { ...(dealerId ? { dealer_id: dealerId } : {}), ...when } }, { $sort: { imported_at: -1, _id: -1 } },
      { $group: { _id: '$customer_id', last: { $first: '$$ROOT' }, n: { $sum: 1 } } }, { $sort: { 'last.imported_at': -1 } }, { $limit: 25 }]).allowDiskUse(true);
    const cs = await Customer.find({ _id: { $in: recent.map((r) => r._id) } }).select('name dealer_id phones emails extra.dealervault.customer_numbers').lean();
    const byC = new Map(cs.map((c) => [String(c._id), c]));
    return { recent: true, rows: recent.filter((r) => byC.has(String(r._id))).map((r) => { const c = byC.get(String(r._id));
      return { id: String(c._id), name: c.name, dealer: byId.get(String(c.dealer_id))?.name || null, phone: c.phones?.[0]?.value || null,
        email: c.emails?.[0]?.value || null, numbers: c.extra?.dealervault?.customer_numbers || [],
        last: { field: r.last.field, value: r.last.value, decision: r.last.decision, at: r.last.imported_at } }; }) };
  }
  const rx = new RegExp(escape(text), 'i');
  const digits = text.replace(/\D/g, '');
  const scope = dealerId ? { dealer_id: dealerId } : {};
  // A record number or VIN finds its customer.
  const recs = (await Promise.all(Object.values(RECORDS).map((r) => r.Model.find({ ...scope, $or: [{ [r.key]: text }, { vin: text.toUpperCase() }] })
    .select('customer_id').limit(10).lean()))).flat().map((d) => d.customer_id).filter(Boolean);
  const or = [{ name: rx }, { 'emails.value': rx }, { 'extra.dealervault.customer_numbers': text }, ...(recs.length ? [{ _id: { $in: recs } }] : []),
    ...(digits.length >= 7 ? [{ 'phones.value': new RegExp(`${escape(digits.slice(-10))}$`) }] : [])];
  const customers = await Customer.find({ ...scope, $or: or }).select('name dealer_id phones emails extra.dealervault.customer_numbers').limit(25).lean();
  return { rows: customers.map((c) => ({ id: String(c._id), name: c.name, dealer: byId.get(String(c.dealer_id))?.name || null,
    phone: c.phones?.[0]?.value || null, email: c.emails?.[0]?.value || null, numbers: c.extra?.dealervault?.customer_numbers || [] })) };
}

/** One customer's field history: per field the current value and every observation, newest first. */
export async function customerHistory(customerId) {
  if (!mongoose.isValidObjectId(customerId)) return null;
  const c = await Customer.findById(customerId).select('name dealer_id phones emails first_name last_name name_parts_from').lean();
  if (!c) return null;
  const rows = await CustomerFieldHistory.find({ customer_id: c._id }).sort({ source_event_date: -1, imported_at: -1 }).limit(500).lean();
  const fields = new Map();
  for (const r of rows) {
    const f = fields.get(r.field) || { field: r.field, current: null, rows: [] };
    if (!f.current && r.decision === 'ACCEPT') f.current = { value: r.value, date: r.source_event_date, source: r.source };
    if (r.status === 'CUSTOMER_DISPUTED') (f.disputed || (f.disputed = [])).push(r.value);
    f.rows.push({ value: r.value, prior: r.prior_value, decision: r.decision, reason: r.reason, source: r.source, type: r.source_event_type,
      date: r.source_event_date, record: r.source_record_id, file: r.source_file, open: r.decision === 'REVIEW' && !r.review_resolved_at, by: r.review_resolved_by_name || r.by_name || null,
      status: r.status || null });
    fields.set(r.field, f);
  }
  const { byId } = await dealerMap([String(c.dealer_id)]);
  return { id: String(c._id), name: c.name, dealer: byId.get(String(c.dealer_id))?.name || null,
    profile: { phones: (c.phones || []).map((p) => p.value), emails: (c.emails || []).map((e) => e.value), name_from: c.name_parts_from || null },
    fields: [...fields.values()] };
}

/**
 * Staff act on one of a customer's values (SOW Appendix B 3-4): 'confirm' makes it the current value (DEALER_USER_CONFIRMED,
 * kept against later DMS files); 'dispute' records that the customer says it is wrong (CUSTOMER_DISPUTED: the DMS never
 * brings it back). Both are new history rows; nothing is deleted.
 */
export async function markValue({ customerId, field, value, action, who }) {
  const c = await Customer.findById(customerId).select('dealer_id').lean();
  if (!c) throw new Error('Customer not found');
  const last = await CustomerFieldHistory.findOne({ customer_id: c._id, field, value }).sort({ source_event_date: -1, imported_at: -1 }).lean();
  const confirm = action === 'confirm';
  await recordHistory([{ dealer_id: String(c.dealer_id), customer_id: c._id, field, value, prior_value: null,
    decision: confirm ? 'ACCEPT' : 'REJECT', reason: confirm ? `${who.name || 'Staff'} confirmed this value` : `the customer says this is wrong (recorded by ${who.name || 'staff'})`,
    source: confirm ? 'DEALER_USER' : 'CUSTOMER', source_event_type: 'staff_review', source_event_date: new Date(),
    source_record_id: last?.source_record_id || null, precision: 'EXACT',
    status: confirm ? 'DEALER_USER_CONFIRMED' : 'CUSTOMER_DISPUTED', by: who._id, by_name: who.name || null }]);
  return { ok: true };
}

export { stampDate };
