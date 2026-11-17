// Admin > DMS feed (super admin; SOW G-086 / G-087, 17 Nov 2026; page reworked 18 Nov 2026: paged, filtered, dealer names).
//   GET [?dealer=<dealer id>&type=SL|SV|SV_APPT|PTINV&days=7|30|90&problems=1&page=1&limit=20&held_all=1&held_page=1]
//       -> { dealers, summary, files: { rows, total, page, pages }, held: { rows, total, page, pages, waiting } }
//          one row per file (its batches added up): dealer, file date, type, rows, decisions, status
//   GET ?file=<file name>&dealer=<dealer id>
//       -> { file, reasons: [{ decision, reason, count }], problems: [first 100 rows needing review / rejected] }
//   GET ?record=<number>&type=SL|SV|SV_APPT|PTINV[&dealer=<dealer id>]
//       -> { history: [every file that touched that record: date, decision, reason, retained] }
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Batch from '@models/DealerVaultImportBatch';
import HeldFile from '@models/DealerVaultHeldFile';
import User from '@models/User';
import { requireSuperAdmin } from '@lib/apiGuard';
import { KEY_COLUMN } from '../../../worker/dealervault/feedCheck.js';

const TYPES = Object.keys(KEY_COLUMN);
const PERIODS = [7, 30, 90];
const int = (v, d, min, max) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (decision) => ({ $size: { $filter: { input: { $ifNull: ['$row_outcomes', []] }, cond: { $eq: ['$$this.decision', decision] } } } });

async function dealerNames(ids) {
  const valid = [...new Set(ids.map(String))].filter((id) => mongoose.isValidObjectId(id));
  const users = valid.length ? await User.find({ _id: { $in: valid } }).select('name timezone').lean() : [];
  return Object.fromEntries(users.map((u) => [String(u._id), { name: u.name || 'Unnamed dealer', timezone: u.timezone || null }]));
}

async function recordHistory(p) {
  const record = String(p.get('record') || '').trim().slice(0, 60);
  const type = p.get('type');
  const col = KEY_COLUMN[type];
  if (!col) return Response.json({ error: 'type must be SL, SV, SV_APPT or PTINV' }, { status: 400 });
  // Raw rows are kept as JSON text on each batch: find the batches whose text names this record, then its row.
  const needle = JSON.stringify(record).slice(1, -1);
  const dealer = p.get('dealer');
  const batches = await Batch.find({ fileType: type, ...(dealer ? { dealer_id: dealer } : {}),
    ...(p.get('dv') ? { dvDealerId: p.get('dv') } : {}), raw_records_json: { $regex: escape(needle) } })
    .select('dealer_id fileName source_file_timestamp raw_records_json row_outcomes status').sort({ source_file_timestamp: 1 }).limit(60).lean();
  const names = await dealerNames(batches.map((b) => b.dealer_id));
  const history = [];
  for (const b of batches) {
    let rows = [];
    try { rows = JSON.parse(b.raw_records_json); } catch { continue; }
    rows.forEach((r, i) => {
      if (String(r?.[col] ?? '').trim() !== record) return;
      const o = (b.row_outcomes || []).find((x) => x.row_index === i) || {};
      history.push({ file: b.fileName, file_date: b.source_file_timestamp, dealer: names[b.dealer_id]?.name || null,
        decision: o.decision || null, reason: o.reason || o.code || null,
        retained_fields: o.retained_fields || [], review: o.review || [] });
    });
  }
  return Response.json({ record, type, history });
}

async function fileDetail(p) {
  const fileName = String(p.get('file') || '').slice(0, 200);
  const dealer = p.get('dealer');
  const batches = await Batch.find({ fileName, ...(dealer ? { dealer_id: dealer } : {}) })
    .select('fileType raw_records_json row_outcomes batchId').sort({ batchId: 1 }).lean();
  if (!batches.length) return Response.json({ error: 'File not found' }, { status: 404 });
  const col = KEY_COLUMN[batches[0].fileType];
  const reasons = new Map();
  const problems = [];
  let recorded = 0;
  for (const b of batches) {
    let rows = null;
    for (const o of b.row_outcomes || []) {
      if (!o.decision) continue;
      recorded += 1;
      // A file date inside a reason ("a newer file (202611170600) ...") is grouped as one reason.
      const reason = o.decision === 'ACCEPT' ? (o.reason === 'new record' ? 'new record' : 'updated an existing record')
        : o.decision === 'RETAIN' ? 'a newer file is already applied' : o.decision === 'REVIEW' ? (o.review || []).join(', ') || 'needs review'
        : o.reason || o.code;
      const k = `${o.decision}|${reason}`;
      reasons.set(k, { decision: o.decision, reason, count: (reasons.get(k)?.count || 0) + 1 });
      if ((o.decision === 'REVIEW' || o.decision === 'REJECT') && problems.length < 100) {
        if (!rows) { try { rows = JSON.parse(b.raw_records_json); } catch { rows = []; } }
        const r = rows[o.row_index] || {};
        problems.push({ key: `${b.batchId}-${o.row_index}`, record: String(r[col] ?? '').trim() || null,
          customer: String(r['Full Name'] || '').trim() || [r['First Name'], r['Last Name']].filter(Boolean).join(' ') || null,
          decision: o.decision, reason: o.decision === 'REVIEW' ? o.review || [] : [o.reason || o.code] });
      }
    }
  }
  const order = { REJECT: 0, REVIEW: 1, RETAIN: 2, ACCEPT: 3 };
  return Response.json({ file: fileName, type: batches[0].fileType, key_column: col, recorded,
    reasons: [...reasons.values()].sort((a, b) => order[a.decision] - order[b.decision] || b.count - a.count), problems });
}

export async function GET(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const p = new URL(req.url).searchParams;
  if (p.get('record')) return recordHistory(p);
  if (p.get('file')) return fileDetail(p);

  const dealer = mongoose.isValidObjectId(p.get('dealer')) ? p.get('dealer') : null;
  const type = TYPES.includes(p.get('type')) ? p.get('type') : null;
  const days = PERIODS.includes(Number(p.get('days'))) ? Number(p.get('days')) : 30;
  const limit = int(p.get('limit'), 20, 5, 100);
  const page = int(p.get('page'), 1, 1, 100000);
  const heldPage = int(p.get('held_page'), 1, 1, 100000);
  const HELD_LIMIT = 10;
  const since = new Date(Date.now() - days * 86400000);
  const scope = { ...(dealer ? { dealer_id: dealer } : {}), ...(type ? { fileType: type } : {}) };

  const problemsOnly = p.get('problems') === '1';
  const [agg] = await Batch.aggregate([
    { $match: { ...scope, createdAt: { $gte: since } } },
    { $project: { dealer_id: 1, dvDealerId: 1, fileName: 1, fileType: 1, status: 1, total_records: 1, createdAt: 1, completedAt: 1,
      source_file_timestamp: 1, accept: count('ACCEPT'), retain: count('RETAIN'), review: count('REVIEW'), reject: count('REJECT') } },
    { $group: { _id: { d: '$dealer_id', f: '$fileName' }, fileType: { $first: '$fileType' }, dv: { $first: '$dvDealerId' },
      file_date: { $first: '$source_file_timestamp' }, imported_at: { $max: { $ifNull: ['$completedAt', '$createdAt'] } },
      statuses: { $addToSet: '$status' }, rows: { $sum: '$total_records' }, batches: { $sum: 1 },
      accept: { $sum: '$accept' }, retain: { $sum: '$retain' }, review: { $sum: '$review' }, reject: { $sum: '$reject' } } },
    { $addFields: { problem: { $or: [{ $gt: ['$review', 0] }, { $gt: ['$reject', 0] },
      { $in: ['failed', '$statuses'] }, { $in: ['completed_with_errors', '$statuses'] }] } } },
    { $facet: {
      summary: [{ $group: { _id: null, files: { $sum: 1 }, rows: { $sum: '$rows' }, accept: { $sum: '$accept' },
        retain: { $sum: '$retain' }, review: { $sum: '$review' }, reject: { $sum: '$reject' },
        problem_files: { $sum: { $cond: ['$problem', 1, 0] } } } }],
      total: [...(problemsOnly ? [{ $match: { problem: true } }] : []), { $count: 'n' }],
      rows: [...(problemsOnly ? [{ $match: { problem: true } }] : []), { $sort: { file_date: -1, imported_at: -1 } },
        { $skip: (page - 1) * limit }, { $limit: limit }],
    } },
  ]).allowDiskUse(true);

  const heldScope = { ...(dealer ? { dealer_id: dealer } : {}), ...(type ? { fileType: type } : {}) };
  const heldMatch = p.get('held_all') === '1' ? heldScope : { ...heldScope, status: { $in: ['held', 'release_requested', 'releasing'] } };
  const [held, heldTotal, waiting, dealerIds] = await Promise.all([
    HeldFile.find(heldMatch).sort({ createdAt: -1 }).skip((heldPage - 1) * HELD_LIMIT).limit(HELD_LIMIT).lean(),
    HeldFile.countDocuments(heldMatch),
    HeldFile.countDocuments({ ...heldScope, status: 'held' }),
    Batch.distinct('dealer_id'),
  ]);
  const rows = agg?.rows || [];
  const names = await dealerNames([...dealerIds, ...held.map((h) => h.dealer_id).filter(Boolean)]);
  // A held file whose store was never matched to a dealer is named by its DealerVault store id.
  const dvToDealer = Object.fromEntries(rows.map((r) => [r.dv, r._id.d]));
  const total = agg?.total?.[0]?.n || 0;
  return Response.json({
    period_days: days,
    dealers: Object.entries(names).map(([id, d]) => ({ id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name)),
    summary: { files: 0, rows: 0, accept: 0, retain: 0, review: 0, reject: 0, problem_files: 0, ...(agg?.summary?.[0] || {}), _id: undefined },
    files: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)),
      rows: rows.map((r) => ({ key: `${r._id.d}|${r._id.f}`, dealer_id: r._id.d, dealer: names[r._id.d]?.name || null,
        timezone: names[r._id.d]?.timezone || null, dv: r.dv, file: r._id.f, type: r.fileType, file_date: r.file_date,
        imported_at: r.imported_at, statuses: r.statuses, rows: r.rows, batches: r.batches,
        accept: r.accept, retain: r.retain, review: r.review, reject: r.reject })) },
    held: { page: heldPage, total: heldTotal, pages: Math.max(1, Math.ceil(heldTotal / HELD_LIMIT)), waiting,
      rows: held.map((h) => { const d = h.dealer_id || dvToDealer[h.dvDealerId] || null;
        return { ...h, dealer: (d && names[d]?.name) || null, timezone: (d && names[d]?.timezone) || null }; }) },
  });
}
