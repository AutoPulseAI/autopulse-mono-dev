// Staff mark whether this customer still owns a vehicle (SOW G-085; app/lib/ownership.js). The mark is kept over
// older DMS records; a DMS sale or service record dated after it wins again.
//   POST { dealer_id, vin, owns: boolean, note? } -> { ok, vin }
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Customer from '@models/Customer';
import { requireDealerAccess } from '@lib/apiGuard';
import { setOwnership } from '@lib/ownership';
import { logActivity } from '@lib/activityLog';

export async function POST(req, { params }) {
  await dbConnect();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const access = await requireDealerAccess(req, String(body?.dealer_id || ''));
  if (access.response) return access.response;
  if (!mongoose.isValidObjectId(id) || !(await Customer.exists({ _id: id, dealer_id: String(body.dealer_id) }))) {
    return Response.json({ error: 'Customer not found' }, { status: 404 });
  }
  if (typeof body.owns !== 'boolean') return Response.json({ error: 'owns must be true or false' }, { status: 400 });
  const out = await setOwnership({ customerId: id, dealerId: body.dealer_id, vin: body.vin, owns: body.owns, by: 'staff',
    byName: access.user?.name || null, note: body.note });
  if (!out.saved) return Response.json({ error: 'A full VIN is needed' }, { status: 422 });
  await logActivity({ dealer_id: body.dealer_id, customer_id: id, actor_type: 'staff', actor_id: access.user?._id || null,
    actor_name: access.user?.name || null, action: 'customer_edited', from: null,
    to: body.owns ? `owns ${out.vin}` : `no longer owns ${out.vin}`, detail: 'vehicle ownership' });
  return Response.json({ ok: true, vin: out.vin });
}
