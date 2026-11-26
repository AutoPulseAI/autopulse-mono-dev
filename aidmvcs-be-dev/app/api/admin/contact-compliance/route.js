// Admin > Contact compliance (super admin; SOW Deliverable L, G-068 to G-071; built log-only 18 Nov 2026).
//   GET ?dealer=<id>[&decision=allow|block|review&days=7|30|90&page=1&export=suppressions]
//       -> { dealers, policy, summary: { allow, block, review, by_reason }, decisions: { rows, total, page, pages },
//            suppressions: [...] }      export=suppressions -> CSV of the dealer's active Do-Not-Contact list
//   POST   { dealer, kind: 'phone'|'email', value, reason? }          add to the dealer's Do-Not-Contact list
//   DELETE { dealer, id }                                              remove (kept with removed_at)
//   PUT    { dealer, mode?, window_start?, window_end? }               the dealer's policy ('enforce' = sends stopped)
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import User from '@models/User';
import ContactPolicy from '@models/ContactPolicy';
import ContactSuppression from '@models/ContactSuppression';
import ContactEligibilityDecision from '@models/ContactEligibilityDecision';
import { requireSuperAdmin } from '@lib/apiGuard';
import { normalizeEmail, normalizePhone } from '@lib/customerResolver';
import { REASON_TEXT, policyFor } from '@lib/compliance/eligibility';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error }, { status });
const int = (v, d, min, max) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Dealerships only - not their employees, who are also type 'dealer' with the dealership as parent (Betsy, 25 Nov 2026:
// "what is employees in there instead of the dealership?"). Same list as Admin > Integration health / DMS feed.
const DEALERSHIPS_ONLY = { type: 'dealer', parent_id: null };
async function dealers() {
  const list = await User.find(DEALERSHIPS_ONLY).select('name timezone').sort({ name: 1 }).lean();
  return list.map((d) => ({ id: String(d._id), name: d.name || 'Unnamed dealer', timezone: d.timezone || null }));
}

export async function GET(req) {
  await dbConnect();
  const guard = await requireSuperAdmin(req);
  if (guard.response) return guard.response;
  const p = new URL(req.url).searchParams;
  const dealer = String(p.get('dealer') || '');
  if (!dealer) return Response.json({ dealers: await dealers() });
  if (!mongoose.isValidObjectId(dealer)) return fail('dealer must be a dealer id', 400);

  const suppressions = await ContactSuppression.find({ dealer_id: dealer, removed_at: null }).sort({ createdAt: -1 }).lean();
  if (p.get('export') === 'suppressions') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['kind,value,channel,reason,added_by,added_at',
      ...suppressions.map((s) => [s.kind, s.value, s.channel, s.reason, s.added_by_name, s.createdAt?.toISOString()].map(esc).join(','))].join('\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="do-not-contact.csv"' } });
  }
  const days = [7, 30, 90].includes(Number(p.get('days'))) ? Number(p.get('days')) : 7;
  const since = new Date(Date.now() - days * 86400000);
  const base = { dealer_id: dealer, at: { $gte: since } };
  const [counts, reasons] = await Promise.all([
    ContactEligibilityDecision.aggregate([{ $match: base }, { $group: { _id: '$decision', n: { $sum: 1 } } }]),
    ContactEligibilityDecision.aggregate([{ $match: base }, { $unwind: '$reasons' }, { $group: { _id: '$reasons', n: { $sum: 1 } } }]),
  ]);
  const decision = ['allow', 'block', 'review'].includes(p.get('decision')) ? p.get('decision') : null;
  const q = { ...base, ...(decision ? { decision } : {}) };
  const limit = 25; const page = int(p.get('page'), 1, 1, 10000);
  const [total, rows] = await Promise.all([ContactEligibilityDecision.countDocuments(q),
    ContactEligibilityDecision.find(q).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean()]);
  return Response.json({
    dealers: await dealers(),
    policy: await policyFor(dealer),
    summary: { allow: 0, block: 0, review: 0, ...Object.fromEntries(counts.map((c) => [c._id, c.n])),
      by_reason: reasons.map((r) => ({ reason: r._id, text: REASON_TEXT[r._id] || r._id, n: r.n })).sort((a, b) => b.n - a.n) },
    decisions: { rows: rows.map((r) => ({ ...r, _id: String(r._id), reason_text: r.reasons.map((x) => REASON_TEXT[x] || x) })),
      total, page, pages: Math.max(1, Math.ceil(total / limit)) },
    suppressions: suppressions.map((s) => ({ id: String(s._id), kind: s.kind, value: s.value, channel: s.channel, reason: s.reason,
      added_by_name: s.added_by_name, added_at: s.createdAt })),
  });
}

async function body(req) { try { return await req.json(); } catch { return null; } }

export async function POST(req) {
  await dbConnect();
  const guard = await requireSuperAdmin(req);
  if (guard.response) return guard.response;
  const b = await body(req);
  const dealer = String(b?.dealer || '');
  if (!mongoose.isValidObjectId(dealer)) return fail('dealer must be a dealer id', 400);
  const kind = b?.kind === 'email' ? 'email' : 'phone';
  const value = kind === 'email' ? normalizeEmail(b?.value) : normalizePhone(b?.value);
  if (!value || (kind === 'phone' && value.length !== 10)) return fail(kind === 'email' ? 'The email is not valid' : 'The phone needs 10 digits', 400);
  if (await ContactSuppression.findOne({ dealer_id: dealer, kind, value, removed_at: null }).lean()) return fail('Already on the list', 409);
  await ContactSuppression.create({ dealer_id: dealer, kind, value, channel: kind === 'email' ? 'email' : 'call_sms',
    reason: String(b?.reason || '').trim().slice(0, 200) || null, source: 'staff', added_by: guard.user._id, added_by_name: guard.user.name || 'Admin' });
  return Response.json({ ok: true });
}

export async function DELETE(req) {
  await dbConnect();
  const guard = await requireSuperAdmin(req);
  if (guard.response) return guard.response;
  const b = await body(req);
  if (!mongoose.isValidObjectId(b?.id)) return fail('id is required', 400);
  const res = await ContactSuppression.updateOne({ _id: b.id, dealer_id: String(b?.dealer || ''), removed_at: null },
    { $set: { removed_at: new Date(), removed_by_name: guard.user.name || 'Admin' } });
  if (!res.matchedCount) return fail('Not on the list', 404);
  return Response.json({ ok: true });
}

export async function PUT(req) {
  await dbConnect();
  const guard = await requireSuperAdmin(req);
  if (guard.response) return guard.response;
  const b = await body(req);
  const dealer = String(b?.dealer || '');
  if (!mongoose.isValidObjectId(dealer)) return fail('dealer must be a dealer id', 400);
  const set = {}; const changes = [];
  if (b.mode !== undefined) {
    if (!['log_only', 'enforce'].includes(b.mode)) return fail('mode must be log_only or enforce', 400);
    set.mode = b.mode; changes.push(`mode ${b.mode}`);
  }
  for (const k of ['window_start', 'window_end']) {
    if (b[k] === undefined) continue;
    if (!HHMM.test(String(b[k]))) return fail(`${k} must be HH:MM`, 400);
    set[k] = b[k]; changes.push(`${k} ${b[k]}`);
  }
  if (!changes.length) return fail('Nothing to change', 400);
  await ContactPolicy.updateOne({ dealer_id: dealer }, { $set: set,
    $push: { history: { at: new Date(), by_name: guard.user.name || 'Admin', change: changes.join(', ') } } }, { upsert: true });
  return Response.json({ policy: await policyFor(dealer) });
}
