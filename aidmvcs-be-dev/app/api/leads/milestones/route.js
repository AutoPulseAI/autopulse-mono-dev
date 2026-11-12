// GET /api/leads/milestones?lead_ids=a,b,c  each lead's funnel times (SOW B b4, G-009; app/lib/leadMilestones.js).
// Staff of the leads' dealership only; at most 50 leads per call.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import { requireDealerAccess } from '@lib/apiGuard';
import { leadMilestones } from '@lib/leadMilestones';

export const runtime = 'nodejs';
const MAX = 50;

export async function GET(req) {
  await dbConnect();
  const ids = String(new URL(req.url).searchParams.get('lead_ids') || '').split(',').map((s) => s.trim())
    .filter((s) => mongoose.isValidObjectId(s));
  if (!ids.length) return Response.json({ error: 'lead_ids is required' }, { status: 400 });
  if (ids.length > MAX) return Response.json({ error: `at most ${MAX} leads per request` }, { status: 400 });
  const dealers = [...new Set((await Lead.find({ _id: { $in: ids } }).select('dealer_id').lean())
    .map((l) => String(l.dealer_id)))];
  if (dealers.length !== 1) return Response.json({ error: 'Leads not found' }, { status: 404 });
  const access = await requireDealerAccess(req, dealers[0]);
  if (access.response) return Response.json({ error: 'Leads not found' }, { status: 404 });
  return Response.json({ milestones: await leadMilestones(ids) });
}
