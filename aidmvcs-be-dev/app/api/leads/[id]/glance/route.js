// GET /api/leads/[id]/glance - "What we know" strip at the top of the conversation (app/lib/leadGlance.js): what the
// AI already learned (stored slots) and its rolling summary. Reads only; no AI call.
// Errors: 401 · 403 not this dealership · 404 not found.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import { requireDealerAccess } from '@lib/apiGuard';
import { leadGlance } from '@lib/leadGlance';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  await dbConnect();
  const { id } = await params;
  const lead = mongoose.isValidObjectId(id) ? await Lead.findById(id, { dealer_id: 1, customer_id: 1 }).lean() : null;
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 });
  const access = await requireDealerAccess(req, lead.dealer_id);
  if (access.response) return access.response;
  return Response.json(await leadGlance(lead));
}
