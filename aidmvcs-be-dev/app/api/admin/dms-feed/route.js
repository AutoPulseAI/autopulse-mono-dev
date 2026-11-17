// Admin > DMS feed (super admin; SOW G-086 / G-087, 17 Nov 2026).
//   GET                     -> { held: [files held back], files: [recent imports with their decision counts] }
//   GET ?record=<number>&type=SL|SV|SV_APPT|PTINV[&dv=<DV dealer id>]
//                           -> { history: [every file that touched that record: date, decision, reason, retained] }
import dbConnect from '@lib/mongodb';
import Batch from '@models/DealerVaultImportBatch';
import HeldFile from '@models/DealerVaultHeldFile';
import { requireSuperAdmin } from '@lib/apiGuard';
import { KEY_COLUMN } from '../../../worker/dealervault/feedCheck.js';

export async function GET(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const p = new URL(req.url).searchParams;
  const record = String(p.get('record') || '').trim();
  if (record) {
    const type = p.get('type');
    const col = KEY_COLUMN[type];
    if (!col) return Response.json({ error: 'type must be SL, SV, SV_APPT or PTINV' }, { status: 400 });
    // Raw rows are kept as JSON text on each batch: find the batches whose text names this record, then its row.
    const needle = JSON.stringify(record).slice(1, -1);
    const batches = await Batch.find({ fileType: type, ...(p.get('dv') ? { dvDealerId: p.get('dv') } : {}),
      raw_records_json: { $regex: needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } })
      .select('fileName source_file_timestamp raw_records_json row_outcomes status').sort({ source_file_timestamp: 1 }).limit(60).lean();
    const history = [];
    for (const b of batches) {
      let rows = [];
      try { rows = JSON.parse(b.raw_records_json); } catch { continue; }
      rows.forEach((r, i) => {
        if (String(r?.[col] ?? '').trim() !== record) return;
        const o = (b.row_outcomes || []).find((x) => x.row_index === i) || {};
        history.push({ file: b.fileName, file_date: b.source_file_timestamp, batch_status: b.status,
          decision: o.decision || (o.status === 'failed' ? 'REJECT' : o.status ? 'ACCEPT' : null), reason: o.reason || o.code || null,
          retained_fields: o.retained_fields || [], review: o.review || [] });
      });
    }
    return Response.json({ record, type, history });
  }
  const [held, files] = await Promise.all([
    HeldFile.find({}).sort({ createdAt: -1 }).limit(50).lean(),
    Batch.aggregate([
      { $sort: { createdAt: -1 } }, { $limit: 400 },
      { $project: { fileName: 1, fileType: 1, dvDealerId: 1, status: 1, total_records: 1, createdAt: 1, row_outcomes: 1 } },
      { $unwind: { path: '$row_outcomes', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$fileName', fileType: { $first: '$fileType' }, dv: { $first: '$dvDealerId' },
        at: { $max: '$createdAt' }, statuses: { $addToSet: '$status' },
        accept: { $sum: { $cond: [{ $eq: ['$row_outcomes.decision', 'ACCEPT'] }, 1, 0] } },
        retain: { $sum: { $cond: [{ $eq: ['$row_outcomes.decision', 'RETAIN'] }, 1, 0] } },
        review: { $sum: { $cond: [{ $eq: ['$row_outcomes.decision', 'REVIEW'] }, 1, 0] } },
        reject: { $sum: { $cond: [{ $eq: ['$row_outcomes.decision', 'REJECT'] }, 1, 0] } },
        rows: { $sum: 1 } } },
      { $sort: { at: -1 } }, { $limit: 60 },
    ]),
  ]);
  return Response.json({ held, files });
}
