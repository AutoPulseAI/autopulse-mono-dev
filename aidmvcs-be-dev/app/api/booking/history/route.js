// GET /api/booking/history?lead_id=...  every appointment of one lead with its history (SOW Deliverable E, gap G-031):
// booked, moved, status changes, cancelled (and by whom), showed / no-show - the history bookingService.js already
// saves on each booking. Signed-in staff of the lead's dealership only.
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dbConnect from '@lib/mongodb';
import Booking from '@models/Booking';
import Lead from '@models/Lead';
import User from '@models/User';
import { isAuthorizedForDealer } from '@lib/customerListing';

export const runtime = 'nodejs';
const json = (body, status = 200) => Response.json(body, { status });

export async function GET(request) {
  await dbConnect();
  let user = null;
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
      user = await User.findById(decoded.userId).select('_id name type parent_id');
    } catch { user = null; }
  }
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const leadId = new URL(request.url).searchParams.get('lead_id');
  if (!mongoose.isValidObjectId(leadId)) return json({ error: 'Lead not found' }, 404);
  const lead = await Lead.findById(leadId).select('dealer_id name').lean();
  if (!lead || !(await isAuthorizedForDealer(user, lead.dealer_id))) return json({ error: 'Lead not found' }, 404);

  const bookings = await Booking.find({ lead_id: String(leadId) }).sort({ createdAt: -1 })
    .select('bookingDate bookingTime appointment_type booking_status showed showed_at created_by created_by_name '
      + 'created_via cancelled_at cancelled_by reschedule_count history createdAt').lean();
  return json({ lead: { _id: lead._id, name: lead.name }, bookings });
}
