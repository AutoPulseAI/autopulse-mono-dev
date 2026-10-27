import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import User from '@models/User';
import moment from 'moment-timezone';
import { messageActivity } from '@lib/contactedLeads';

// The dashboard's Messages card (Betsy, 27 Oct 2026 meeting): messages sent and received in the picked range, in the
// dealer's own days (app/lib/contactedLeads.js messageActivity).
export async function GET(request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const dealerId = searchParams.get('dealer_id');
    if (!dealerId) return Response.json({ error: 'dealer_id is required' }, { status: 400 });
    let from = null, to = null;
    if (searchParams.get('start_date') && searchParams.get('end_date')) {
      const dealer = await User.findById(dealerId).select('dealer_account_information.time_zone').lean();
      const tz = dealer?.dealer_account_information?.time_zone || 'America/New_York';
      const start = moment.utc(searchParams.get('start_date')).tz(tz).format('YYYY-MM-DD');
      const end = moment.utc(searchParams.get('end_date')).tz(tz).format('YYYY-MM-DD');
      from = moment.tz(start, 'YYYY-MM-DD', tz).startOf('day').utc().toDate();
      to = moment.tz(end, 'YYYY-MM-DD', tz).endOf('day').utc().toDate();
    }
    const ids = (await Lead.find({ dealer_id: dealerId }).select('_id').lean()).map((l) => l._id);
    return Response.json(await messageActivity(ids, from, to));
  } catch (error) {
    console.error('[message-activity]', error);
    return Response.json({ error: 'Could not count messages' }, { status: 500 });
  }
}
