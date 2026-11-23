// Admin > DMS feed, the dealer's DMS as we hold it (super admin; 23 Nov 2026). The page opens on a DealerVault store
// and shows what its DMS sent us the way the DMS keeps it - Sales, Service, Appointments, Parts - in the dealer's own
// categories (whatever values their DMS uses: deal types, RO statuses, advisors, stocking statuses...), not ours.
//   GET                                     -> { stores } every store that sent files or is linked, with its dealer
//   GET ?dv=DVD46315                        -> { store, calendar, departments, issues } for one store
//   GET ?dv=&dept=service[&f=<col>::<value>...][&q=][&issue=no_vin&checked=0|1][&page=]
//                                           -> { columns, categories, rows, total, page, pages } the department's records
//   GET ?dv=&dept=service&key=<RO number>   -> { record } every field the DMS sent for one record
//   POST { dv, dept, key, issue }           mark a record "checked" for that issue (who and when kept); { ..., undo: true }
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import User from '@models/User';
import Batch from '@models/DealerVaultImportBatch';
import HeldFile from '@models/DealerVaultHeldFile';
import Deal from '@models/Deal';
import RepairOrder from '@models/RepairOrder';
import ServiceAppointment from '@models/ServiceAppointment';
import PartInventory from '@models/PartInventory';
import { requireSuperAdmin } from '@lib/apiGuard';
import { storedFiles } from '@lib/dealervault/storedFiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DV = /^DVD\d{3,10}$/;
const PAGE = 25;
const CAL_DAYS = 35;
const fail = (error, status) => Response.json({ error }, { status });
const int = (v, d, min, max) => { const x = Number.parseInt(v, 10); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const marks = () => mongoose.connection.collection('dms_review_marks');

// What each department is, in the DMS's own columns. `categories` are the DMS columns the dealer files records by;
// their values come from the dealer's data, so a dealer whose DMS uses other words sees its own words.
const DEPTS = {
  sales: {
    label: 'Sales', type: 'SL', Model: Deal, key: 'deal_number', keyLabel: 'Deal', dates: ['Contract Date', 'Delivery Date', 'Entry Date'],
    categories: ['Deal Type', 'Sale Type', 'New/Used', 'Deal Status', 'Salesman 1 Name', 'Finance Manager Name'],
    columns: [
      { col: 'Contract Date', label: 'Contract date', kind: 'date' },
      { col: '$customer', label: 'Customer' }, { col: '$vehicle', label: 'Vehicle' },
      { col: 'New/Used', label: 'New / used' }, { col: 'Deal Type', label: 'Deal type' },
      { col: 'Salesman 1 Name', label: 'Salesperson' },
      { col: 'Sales Price', label: 'Price', kind: 'money' }, { col: 'Front Gross', label: 'Front gross', kind: 'money' },
      { col: 'Back Gross', label: 'Back gross', kind: 'money' },
    ],
    issues: ['no_customer', 'no_vin', 'no_vehicle'],
  },
  service: {
    label: 'Service', type: 'SV', Model: RepairOrder, key: 'ro_number', keyLabel: 'RO', dates: ['Close Date', 'Open Date'],
    categories: ['RO Status', 'RO Department', 'Service Advisor Name', 'Payment Method', 'Accounting Make'],
    columns: [
      { col: 'Open Date', label: 'Opened', kind: 'date' }, { col: 'Close Date', label: 'Closed', kind: 'date' },
      { col: '$customer', label: 'Customer' }, { col: '$vehicle', label: 'Vehicle' },
      { col: 'Service Advisor Name', label: 'Advisor' }, { col: 'RO Status', label: 'Status' },
      { col: 'Customer Total Sale', label: 'Customer pay', kind: 'money' },
      { col: 'Warranty Total Sale', label: 'Warranty', kind: 'money' }, { col: 'Internal Total Sale', label: 'Internal', kind: 'money' },
    ],
    issues: ['no_customer', 'no_vin', 'no_vehicle'],
  },
  appointments: {
    label: 'Appointments', type: 'SV_APPT', Model: ServiceAppointment, key: 'appointment_number', keyLabel: 'Appointment',
    dates: ['Appointment Date'],
    categories: ['Service Advisor Name', 'Sale Type', 'Waiting Flag', 'Loaner Flag', 'Make'],
    columns: [
      { col: 'Appointment Date', label: 'Date', kind: 'date' }, { col: 'Appointment Time', label: 'Time' },
      { col: '$customer', label: 'Customer' }, { col: '$vehicle', label: 'Vehicle' },
      { col: 'Service Advisor Name', label: 'Advisor' }, { col: 'Operation Code Description', label: 'Work booked' },
      { col: 'Waiting Flag', label: 'Waiting' }, { col: 'Estimate Amount', label: 'Estimate', kind: 'money' },
    ],
    issues: ['no_customer', 'no_vin', 'no_vehicle'],
  },
  parts: {
    label: 'Parts', type: 'PTINV', Model: PartInventory, key: 'part_number', keyLabel: 'Part', dates: ['Last Sale Date'],
    categories: ['Stocking Status', 'Source', 'Part Group', 'Manufacturer Status', 'Make'],
    columns: [
      { col: 'Part Description', label: 'Description' }, { col: 'Quantity On Hand', label: 'On hand', kind: 'num' },
      { col: 'Quantity On Order', label: 'On order', kind: 'num' }, { col: 'BIN#', label: 'Bin' },
      { col: 'Part Price', label: 'Price', kind: 'money' }, { col: 'Part Cost', label: 'Cost', kind: 'money' },
      { col: 'Last Sale Date', label: 'Last sold', kind: 'date' },
    ],
    issues: [],
    sortByKey: true,
  },
};

// Records that need a person to look, in plain words (shown on the page as they are here).
const ISSUES = {
  no_customer: {
    label: 'Not linked to a customer',
    means: "We couldn't match the DMS customer on it to a customer in AutoPulse, so it doesn't show on anyone's profile.",
    fix: 'Open it and check the customer number and contact details in the DMS. It links on the next file once they match a customer.',
    match: { customer_id: null },
  },
  no_vin: {
    label: 'No VIN in the DMS',
    means: "The dealer's DMS has no VIN on it, so it can't be tied to a car.",
    fix: 'The VIN has to be added on the record in the DMS. The next file brings it in.',
    match: { vin: { $in: [null, ''] } },
  },
  no_vehicle: {
    label: 'VIN not matched to a car',
    means: 'The VIN is there, but no car in AutoPulse has it (or more than one does).',
    fix: "It usually links when the car's sale or service history arrives. If it stays, the VIN may be mistyped in the DMS.",
    match: { vin: { $nin: [null, ''] }, vehicle_id: null },
  },
};

const field = (f) => ({ $getField: f });
const str = (f) => ({ $trim: { input: { $toString: { $ifNull: [field(f), ''] } } } });
const asDate = (f) => ({ $let: { vars: { s: str(f) }, in: { $ifNull: [
  { $dateFromString: { dateString: '$$s', format: '%m/%d/%Y', onError: null, onNull: null } },
  { $dateFromString: { dateString: '$$s', format: '%Y%m%d', onError: null, onNull: null } },
  { $dateFromString: { dateString: '$$s', format: '%Y-%m-%d', onError: null, onNull: null } }, null] } } });
const num = (f) => ({ $convert: { input: { $replaceAll: { input: { $replaceAll: { input: str(f), find: ',', replacement: '' } },
  find: { $literal: '$' }, replacement: '' } }, to: 'double', onError: 0, onNull: 0 } });
const sortAt = (dept) => ({ $ifNull: [...dept.dates.map(asDate), null] });

async function storeList() {
  let files = [];
  let storageError = null;
  try { files = await storedFiles(); } catch (e) { storageError = e.code || e.message; }
  const dealers = await User.find({ type: 'dealer', parent_id: null }).select('name dv_dealer_id timezone').lean();
  const by = {};
  for (const f of files) {
    const s = by[f.dv] || (by[f.dv] = { dv: f.dv, files: 0, last: null, types: new Set() });
    s.files += 1;
    if (!s.last || f.stamp > s.last) s.last = f.stamp;
    s.types.add(f.type);
  }
  for (const d of dealers) if (d.dv_dealer_id && !by[d.dv_dealer_id]) by[d.dv_dealer_id] = { dv: d.dv_dealer_id, files: 0, last: null, types: new Set() };
  const held = await HeldFile.aggregate([{ $match: { status: 'held' } }, { $group: { _id: '$dvDealerId', n: { $sum: 1 } } }]);
  const heldBy = Object.fromEntries(held.map((h) => [h._id, h.n]));
  const stores = Object.values(by).map((s) => {
    const d = dealers.find((x) => x.dv_dealer_id === s.dv);
    return { dv: s.dv, files: s.files, last: s.last, types: [...s.types].sort(), held: heldBy[s.dv] || 0,
      dealer: d ? { id: String(d._id), name: d.name || 'Unnamed dealer', timezone: d.timezone || null } : null };
  }).sort((a, b) => (!!b.dealer - !!a.dealer) || a.dv.localeCompare(b.dv));
  return { stores, files, storageError,
    dealers: dealers.map((d) => ({ id: String(d._id), name: d.name || 'Unnamed dealer', dv: d.dv_dealer_id || null }))
      .sort((a, b) => a.name.localeCompare(b.name)) };
}

// The delivery calendar: for each file type and each of the last CAL_DAYS days, the files DealerVault put in storage
// and what happened to each (imported / imported with rows to look at / held / discarded / not imported yet).
async function calendar(dv, dealerId, files) {
  const today = new Date();
  const days = [];
  for (let i = CAL_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    days.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  const mine = files.filter((f) => f.dv === dv && f.day >= days[0]);
  const names = mine.map((f) => f.fileName);
  const [batches, held] = await Promise.all([
    dealerId && names.length ? Batch.aggregate([
      { $match: { dealer_id: dealerId, fileName: { $in: names } } },
      { $project: { fileName: 1, status: 1,
        review: { $size: { $filter: { input: { $ifNull: ['$row_outcomes', []] }, cond: { $eq: ['$$this.decision', 'REVIEW'] } } } } } },
      { $group: { _id: '$fileName', statuses: { $addToSet: '$status' }, review: { $sum: '$review' } } },
    ]) : [],
    names.length ? HeldFile.find({ fileName: { $in: names } }).select('fileName status reasons').lean() : [],
  ]);
  const b = Object.fromEntries(batches.map((x) => [x._id, x]));
  const h = Object.fromEntries(held.map((x) => [x.fileName, x]));
  const state = (f) => {
    if (f.type === 'OPENRO') return 'stored';
    const x = b[f.fileName];
    if (x) {
      if (x.statuses.includes('failed') || x.statuses.includes('completed_with_errors')) return 'problem';
      if (x.statuses.some((s) => s === 'pending' || s === 'processing')) return 'importing';
      return x.review ? 'imported_unlinked' : 'imported';
    }
    const hf = h[f.fileName];
    if (hf?.status === 'held') return 'held';
    if (hf?.status === 'discarded') return 'discarded';
    if (hf) return 'importing';
    return 'waiting';
  };
  const types = [...new Set(['SL', 'SV', 'SV_APPT', 'PTINV', ...mine.map((f) => f.type)])];
  const rows = types.map((type) => {
    const all = files.filter((f) => f.dv === dv && f.type === type);
    const last = all.reduce((m, f) => (!m || f.stamp > m ? f.stamp : m), null);
    return { type, last, cells: days.map((day) => mine.filter((f) => f.type === type && f.day === day)
      .sort((x, y) => x.stamp.localeCompare(y.stamp))
      .map((f) => ({ file: f.fileName, stamp: f.stamp, state: state(f), reasons: h[f.fileName]?.reasons || [] }))) };
  });
  return { days, rows };
}

async function headlines(dealerId) {
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const [sales, service, appts, parts] = await Promise.all([
    Deal.aggregate([{ $match: { dealer_id: dealerId } }, { $group: { _id: null, n: { $sum: 1 },
      last: { $max: sortAt(DEPTS.sales) }, front: { $sum: num('Front Gross') }, back: { $sum: num('Back Gross') },
      new: { $sum: { $cond: [{ $regexMatch: { input: str('New/Used'), regex: /^n/i } }, 1, 0] } } } }]),
    RepairOrder.aggregate([{ $match: { dealer_id: dealerId } }, { $group: { _id: null, n: { $sum: 1 },
      last: { $max: sortAt(DEPTS.service) }, cp: { $sum: num('Customer Total Sale') }, wty: { $sum: num('Warranty Total Sale') },
      int: { $sum: num('Internal Total Sale') } } }]),
    ServiceAppointment.aggregate([{ $match: { dealer_id: dealerId } }, { $addFields: { _at: asDate('Appointment Date') } },
      { $group: { _id: null, n: { $sum: 1 }, upcoming: { $sum: { $cond: [{ $gte: ['$_at', today] }, 1, 0] } },
        next: { $min: { $cond: [{ $gte: ['$_at', today] }, '$_at', null] } }, last: { $max: '$_at' } } }]),
    PartInventory.aggregate([{ $match: { dealer_id: dealerId } }, { $group: { _id: null, n: { $sum: 1 },
      units: { $sum: num('Quantity On Hand') }, value: { $sum: { $multiply: [num('Quantity On Hand'), num('Part Cost')] } },
      stocked: { $sum: { $cond: [{ $gt: [num('Quantity On Hand'), 0] }, 1, 0] } } } }]),
  ]);
  const one = (a) => { const x = a[0] || { n: 0 }; delete x._id; return x; };
  return { sales: one(sales), service: one(service), appointments: one(appts), parts: one(parts) };
}

async function checkedKeys(dealerId, dept, issue) {
  return marks().distinct('key', { dealer_id: dealerId, dept, issue });
}

async function issueSummary(dealerId) {
  const out = [];
  for (const [deptId, dept] of Object.entries(DEPTS)) {
    for (const issue of dept.issues) {
      const checked = await checkedKeys(dealerId, deptId, issue);
      const n = await dept.Model.countDocuments({ dealer_id: dealerId, ...ISSUES[issue].match, [dept.key]: { $nin: checked } });
      if (n) out.push({ dept: deptId, deptLabel: dept.label, issue, label: ISSUES[issue].label, means: ISSUES[issue].means,
        fix: ISSUES[issue].fix, open: n, checked: checked.length });
    }
  }
  return out;
}

function parseFilters(p, dept) {
  const out = [];
  for (const raw of p.getAll('f')) {
    const i = raw.indexOf('::');
    if (i < 1) continue;
    const col = raw.slice(0, i);
    if (!dept.categories.includes(col)) continue;
    out.push({ col, value: raw.slice(i + 2) });
  }
  return out;
}
const filterMatch = ({ col, value }) => (value === '' ? { [col]: { $in: [null, ''] } } : { [col]: value });

async function ledger(p, dealerId, deptId) {
  const dept = DEPTS[deptId];
  const filters = parseFilters(p, dept);
  const page = int(p.get('page'), 1, 1, 100000);
  const base = { dealer_id: dealerId };
  const q = String(p.get('q') || '').trim().slice(0, 60);
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    base.$or = [{ [dept.key]: rx }, { 'Full Name': rx }, { 'Last Name': rx }, { vin: rx }, { 'Part Description': rx }];
  }
  const issue = ISSUES[p.get('issue')] && dept.issues.includes(p.get('issue')) ? p.get('issue') : null;
  if (issue) {
    Object.assign(base, ISSUES[issue].match);
    const checked = await checkedKeys(dealerId, deptId, issue);
    base[dept.key] = p.get('checked') === '1' ? { $in: checked } : { $nin: checked };
  }
  const all = filters.length ? { $and: filters.map(filterMatch) } : {};
  const projection = { _id: 0, key: `$${dept.key}`, customer_id: 1, vehicle_id: 1, vin: 1, _at: 1,
    first: field('First Name'), last: field('Last Name'), full: field('Full Name'),
    year: field('Year'), make: field('Make'), model: field('Model') };
  for (const c of dept.columns) if (!c.col.startsWith('$')) projection[`c_${dept.columns.indexOf(c)}`] = field(c.col);
  const [res] = await dept.Model.aggregate([
    { $match: base },
    { $facet: {
      ...Object.fromEntries(dept.categories.map((col, i) => {
        const others = filters.filter((f) => f.col !== col).map(filterMatch);
        return [`cat_${i}`, [...(others.length ? [{ $match: { $and: others } }] : []),
          { $group: { _id: str(col), n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 14 }]];
      })),
      total: [{ $match: all }, { $count: 'n' }],
      rows: [{ $match: all },
        ...(dept.sortByKey ? [{ $sort: { [dept.key]: 1 } }]
          : [{ $addFields: { _at: sortAt(dept) } }, { $sort: { _at: -1, source_file_timestamp: -1, [dept.key]: -1 } }]),
        { $skip: (page - 1) * PAGE }, { $limit: PAGE }, { $project: projection }],
    } },
  ]).allowDiskUse(true);
  const total = res.total[0]?.n || 0;
  const marked = issue ? Object.fromEntries((await marks().find({ dealer_id: dealerId, dept: deptId, issue,
    key: { $in: res.rows.map((r) => r.key) } }).toArray()).map((m) => [m.key, { by: m.by_name, at: m.at }])) : {};
  return {
    dept: deptId, label: dept.label, keyLabel: dept.keyLabel, issue,
    columns: dept.columns.map(({ label, kind }) => ({ label, kind: kind || 'text' })),
    categories: dept.categories.map((col, i) => ({ col, values: res[`cat_${i}`].map((v) => ({ value: v._id, n: v.n })) }))
      .filter((c) => c.values.some((v) => v.value !== '')),
    filters, total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
    rows: res.rows.map((r) => ({
      key: r.key, linked: { customer: !!r.customer_id, vehicle: !!r.vehicle_id, vin: !!r.vin },
      checked: marked[r.key] || null,
      cells: dept.columns.map((c, i) => {
        if (c.col === '$customer') return (String(r.full || '').trim() || [r.first, r.last].filter(Boolean).join(' ')).trim() || null;
        if (c.col === '$vehicle') return [r.year, r.make, r.model].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || null;
        const v = r[`c_${i}`];
        return v == null || String(v).trim() === '' ? null : String(v).trim();
      }),
    })),
  };
}

const HIDDEN = new Set(['_id', '__v', 'dealer_id', 'File Type', 'DV Dealer ID', 'Vendor Dealer ID', 'source_batch_id', 'source_row_index',
  'source_import', 'source_file_timestamp', 'customer_id', 'vehicle_id', 'repair_order_id', 'createdAt', 'updatedAt',
  'service_operations', 'trade_ins']);

async function record(dealerId, deptId, key) {
  const dept = DEPTS[deptId];
  const doc = await dept.Model.findOne({ dealer_id: dealerId, [dept.key]: key }).lean();
  if (!doc) return null;
  const fields = Object.entries(doc).filter(([k, v]) => !HIDDEN.has(k) && !/^CASS_/.test(k) && v != null && typeof v !== 'object'
    && String(v).trim() !== '' && !/^(deal_number|ro_number|appointment_number|part_number|customer_number|vin|appointment_date|appointment_time)$/.test(k))
    .map(([k, v]) => [k, String(v).trim()]);
  return { dept: deptId, label: dept.label, keyLabel: dept.keyLabel, key, fields,
    file: doc.source_import?.fileName || null, file_stamp: doc.source_file_timestamp || null,
    linked: { customer: doc.customer_id ? String(doc.customer_id) : null, vehicle: doc.vehicle_id ? String(doc.vehicle_id) : null },
    lines: Array.isArray(doc.service_operations) ? doc.service_operations.slice(0, 60) : [] };
}

export async function GET(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const p = new URL(req.url).searchParams;
  const { stores, files, storageError, dealers } = await storeList();
  const dv = String(p.get('dv') || '').toUpperCase();
  if (!dv) return Response.json({ stores, dealers, storage_error: storageError });
  if (!DV.test(dv)) return fail('A DealerVault ID looks like DVD12345', 400);
  const store = stores.find((s) => s.dv === dv);
  if (!store) return fail(`${dv} has sent no files and isn't linked to a dealer`, 404);
  const dealerId = store.dealer?.id || null;
  const deptId = p.get('dept');
  if (deptId) {
    if (!DEPTS[deptId]) return fail('Unknown department', 400);
    if (!dealerId) return fail(`${dv} isn't linked to a dealer, so nothing from it was imported`, 409);
    if (p.get('key')) {
      const r = await record(dealerId, deptId, String(p.get('key')).slice(0, 80));
      return r ? Response.json({ record: r }) : fail('Record not found', 404);
    }
    return Response.json(await ledger(p, dealerId, deptId));
  }
  const [cal, heads, issues] = await Promise.all([
    calendar(dv, dealerId, files),
    dealerId ? headlines(dealerId) : null,
    dealerId ? issueSummary(dealerId) : [],
  ]);
  return Response.json({ stores, dealers, storage_error: storageError, store, calendar: cal, departments: heads, issues,
    issue_text: Object.fromEntries(Object.entries(ISSUES).map(([k, v]) => [k, { label: v.label, means: v.means, fix: v.fix }])) });
}

export async function POST(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const b = await req.json().catch(() => ({}));
  const dv = String(b?.dv || '').toUpperCase();
  const dept = DEPTS[b?.dept];
  if (!DV.test(dv) || !dept || !dept.issues.includes(b?.issue) || !b?.key) return fail('dv, dept, issue and key are required', 400);
  const dealer = await User.findOne({ type: 'dealer', dv_dealer_id: dv }).select('_id').lean();
  if (!dealer) return fail(`${dv} isn't linked to a dealer`, 409);
  const id = { dealer_id: String(dealer._id), dept: b.dept, issue: b.issue, key: String(b.key).slice(0, 80) };
  if (b.undo) await marks().deleteOne(id);
  else await marks().updateOne(id, { $setOnInsert: { ...id, by: String(access.user._id), by_name: access.user.name || 'Super admin', at: new Date() } }, { upsert: true });
  return Response.json({ ok: true });
}
