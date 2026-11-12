// Possible duplicate customers, for a manager to review (SOW Deliverable B b3, gap G-008). Nothing is merged here.
//   GET  ?dealer_id=            the groups (app/lib/duplicateCustomers.js), newest activity first, at most 100
//   POST {dealer_id, customer_ids: [a, b], decision: 'not_duplicate'}   "not the same person": the pair is not
//        flagged again (DuplicateReview) and the decision is logged on both customers' timelines.
// Errors: 401 not signed in · 403 not this dealership's staff, or no "Manage Leads" permission · 400 bad request ·
// 404 a customer isn't this dealership's.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Customer from '@models/Customer';
import DuplicateReview from '@models/DuplicateReview';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { duplicateGroups, pairKey } from '@lib/duplicateCustomers';
import { logActivity } from '@lib/activityLog';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error }, { status });

async function manager(req, dealerId) {
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access;
  if (!(await hasPermission(access.user, 'Manage Leads'))) return { response: fail('Only managers can review duplicates', 403) };
  return access;
}

export async function GET(req) {
  await dbConnect();
  const dealerId = String(new URL(req.url).searchParams.get('dealer_id') || '');
  const access = await manager(req, dealerId);
  if (access.response) return access.response;
  return Response.json(await duplicateGroups(dealerId));
}

export async function POST(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const dealerId = String(body?.dealer_id || '');
  const access = await manager(req, dealerId);
  if (access.response) return access.response;
  const ids = Array.isArray(body.customer_ids) ? [...new Set(body.customer_ids.map(String))] : [];
  if (ids.length !== 2 || ids.some((id) => !mongoose.isValidObjectId(id))) return fail('Give exactly two customer ids', 400);
  if (body.decision !== 'not_duplicate') return fail("decision must be 'not_duplicate'", 400);
  const found = await Customer.countDocuments({ _id: { $in: ids }, dealer_id: dealerId });
  if (found !== 2) return fail('Customer not found', 404);
  const user = access.user;
  await DuplicateReview.updateOne({ dealer_id: dealerId, pair: pairKey(ids[0], ids[1]) },
    { $set: { customer_ids: ids, decision: 'not_duplicate', by: user._id, by_name: user.name || null, at: new Date() } },
    { upsert: true });
  for (const [mine, other] of [[ids[0], ids[1]], [ids[1], ids[0]]]) {
    await logActivity({ dealer_id: dealerId, customer_id: mine, actor_type: 'staff', actor_id: user._id,
      actor_name: user.name || null, action: 'not_duplicate', to: other });
  }
  return Response.json({ ok: true });
}
