// Admin > DMS feed > Customer field decisions (super admin; SOW Appendix B, DealerVault reconciliation; 23 Nov 2026).
//   GET [?dealer=<id>&decision=ACCEPT|RETAIN|APPEND|REVIEW|REJECT&field=name|phone|email|mileage&open=1&page=1]
//       -> { summary: { ACCEPT, RETAIN, APPEND, REVIEW, REJECT, open_reviews }, rows, total, page, pages }
//       open=1: only REVIEW rows nobody resolved yet
//   POST { id, action: "accept" | "keep" }  resolve a REVIEW row: "accept" makes its value current (a staff-confirmed
//       row, DEALER_USER_CONFIRMED, same event date); "keep" leaves the current value. Either way the review is marked
//       resolved (who, when); nothing is deleted.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import User from '@models/User';
import Customer from '@models/Customer';
import CustomerFieldHistory from '@models/CustomerFieldHistory';
import { requireSuperAdmin } from '@lib/apiGuard';
import { recordHistory } from '@lib/reconcile/ledger';

const DECISIONS = ['ACCEPT', 'RETAIN', 'APPEND', 'REVIEW', 'REJECT'];
const FIELDS = { name: /^name$/, phone: /^phone$/, email: /^email$/, mileage: /^mileage:/ };
const LIMIT = 25;
const json = (b, s = 200) => Response.json(b, { status: s });

export async function GET(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const p = new URL(req.url).searchParams;
  const scope = {};
  if (mongoose.isValidObjectId(p.get('dealer'))) scope.dealer_id = p.get('dealer');
  if (FIELDS[p.get('field')]) scope.field = FIELDS[p.get('field')];
  const match = { ...scope };
  if (DECISIONS.includes(p.get('decision'))) match.decision = p.get('decision');
  if (p.get('open') === '1') Object.assign(match, { decision: 'REVIEW', review_resolved_at: { $exists: false } });
  const page = Math.max(1, Number.parseInt(p.get('page'), 10) || 1);

  const [counts, open, total, rows] = await Promise.all([
    CustomerFieldHistory.aggregate([{ $match: scope }, { $group: { _id: '$decision', n: { $sum: 1 } } }]),
    CustomerFieldHistory.countDocuments({ ...scope, decision: 'REVIEW', review_resolved_at: { $exists: false } }),
    CustomerFieldHistory.countDocuments(match),
    CustomerFieldHistory.find(match).sort({ imported_at: -1, _id: -1 }).skip((page - 1) * LIMIT).limit(LIMIT).lean(),
  ]);
  const [customers, dealers] = await Promise.all([
    Customer.find({ _id: { $in: rows.map((r) => r.customer_id) } }).select('name').lean(),
    User.find({ _id: { $in: [...new Set(rows.map((r) => r.dealer_id))].filter(mongoose.isValidObjectId) } }).select('name').lean(),
  ]);
  const cname = new Map(customers.map((c) => [String(c._id), c.name]));
  const dname = new Map(dealers.map((d) => [String(d._id), d.name]));
  return json({
    summary: { ...Object.fromEntries(DECISIONS.map((d) => [d, counts.find((c) => c._id === d)?.n || 0])), open_reviews: open },
    rows: rows.map((r) => ({ ...r, customer: cname.get(String(r.customer_id)) || null, dealer: dname.get(r.dealer_id) || null })),
    total, page, pages: Math.max(1, Math.ceil(total / LIMIT)),
  });
}

export async function POST(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return json({ error: 'The request body must be JSON' }, 400); }
  if (!mongoose.isValidObjectId(body?.id) || !['accept', 'keep'].includes(body?.action)) {
    return json({ error: 'id and action (accept / keep) are required' }, 400);
  }
  const row = await CustomerFieldHistory.findOne({ _id: body.id, decision: 'REVIEW', review_resolved_at: { $exists: false } }).lean();
  if (!row) return json({ error: 'This review was already resolved or does not exist' }, 409);
  const who = access.user;
  if (body.action === 'accept') {
    await recordHistory([{ dealer_id: row.dealer_id, customer_id: String(row.customer_id), field: row.field, value: row.value,
      prior_value: row.prior_value, decision: 'ACCEPT', reason: 'reviewed: accepted by staff', source: 'DEALER_USER',
      source_event_type: row.source_event_type, source_event_date: row.source_event_date, source_record_id: row.source_record_id,
      source_file: row.source_file, precision: row.precision, status: 'DEALER_USER_CONFIRMED', by: who._id, by_name: who.name || null }]);
  }
  await CustomerFieldHistory.updateOne({ _id: row._id }, { $set: { review_resolved_at: new Date(),
    review_resolved_by_name: `${who.name || 'Super admin'} (${body.action === 'accept' ? 'accepted' : 'kept the current value'})` } });
  return json({ ok: true });
}
