// Desk Log (Betsy's Priority 3; SOW v6 Deliverable C).
//   GET  ?dealer_id &start_date &end_date (dealer-local YYYY-MM-DD) [&view &q &department &lead_type &source
//        &salesperson_id &sales_manager_id &bdc_agent_id] [&cards=1]  -> { rows, sources, truncated, cards? }
//   POST { dealer_id, lead_id, checked_in_at?, department?, stock_number?, vehicle?, trade?, salesperson_id?,
//        sales_manager_id?, bdc_agent_id?, stage?, note? }  -> checks a customer in (one showroom visit)
// Visible while the 'desk_log' feature allows it (app/lib/deskLog/access.js).
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import DeskLogEntry from '@models/DeskLogEntry';
import Lead from '@models/Lead';
import TradeIn from '@models/TradeIn';
import { deskLogAccess, json } from '@lib/deskLog/access';
import { deskLogCards } from '@lib/deskLog/cards';
import { deskLogList, VIEWS } from '@lib/deskLog/list';
import { planChanges } from '@lib/deskLog/deskLog';
import { dealerForms } from '@lib/reporting/kpis/common';
import { getDealerTimezone, isValidLocalDate } from '@lib/reporting/time';

const FILTERS = ['department', 'lead_type', 'source', 'salesperson_id', 'sales_manager_id', 'bdc_agent_id', 'stage',
  'outcome'];

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const dealerId = params.get('dealer_id');
  const access = await deskLogAccess(req, dealerId);
  if (access.response) return access.response;
  try {
    const tz = await getDealerTimezone(dealerId);
    const today = moment.tz(tz).format('YYYY-MM-DD');
    const from = params.get('start_date') || today;
    const to = params.get('end_date') || from;
    if (!isValidLocalDate(from) || !isValidLocalDate(to) || from > to) {
      return json({ message: 'start_date / end_date must be YYYY-MM-DD, start first' }, 400);
    }
    const view = params.get('view') || 'all';
    if (!VIEWS[view]) return json({ message: `view must be one of ${Object.keys(VIEWS).join(', ')}` }, 400);
    const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) || null]));
    const list = await deskLogList({ dealerId, tz, from, to, view, q: (params.get('q') || '').trim().slice(0, 80),
      filters });
    const cards = params.get('cards') === '1' ? await deskLogCards(dealerId, tz, to > today ? today : to) : undefined;
    return json({ ...list, cards, tz, views: VIEWS });
  } catch (error) {
    console.error('desk-log GET failed:', error?.message);
    return json({ message: 'Could not load the Desk Log' }, 500);
  }
}

const actorName = (user) => user?.name || user?.email || null;

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
  const dealerId = body?.dealer_id;
  const access = await deskLogAccess(req, dealerId);
  if (access.response) return access.response;
  try {
    if (!mongoose.isValidObjectId(String(body.lead_id || ''))) return json({ message: 'Pick the customer' }, 400);
    const lead = await Lead.findOne({ _id: body.lead_id, dealer_id: { $in: dealerForms(dealerId) } })
      .select('customer_id assigned_to vehicle_year vehicle_make vehicle_model vin').lean();
    if (!lead) return json({ message: 'Customer not found' }, 404);
    const checkedIn = body.checked_in_at ? new Date(body.checked_in_at) : new Date();
    if (Number.isNaN(checkedIn.getTime()) || checkedIn.getTime() > Date.now() + 5 * 60000) {
      return json({ message: 'checked_in_at must be a time, not in the future' }, 400);
    }
    // Filled from the lead (vehicle of interest, its BDC owner) and its latest open trade-in, unless sent.
    const trade = await TradeIn.findOne({ dealer_id: String(dealerId), status: 'open',
      $or: [{ lead_id: lead._id }, ...(lead.customer_id ? [{ customer_id: lead.customer_id }] : [])] })
      .sort({ updatedAt: -1 }).select('year make model trim vin').lean();
    const input = {
      vehicle: { year: lead.vehicle_year || null, make: lead.vehicle_make || null, model: lead.vehicle_model || null,
        vin: lead.vin || null },
      trade: trade ? { year: trade.year ?? null, make: trade.make ?? null, model: trade.model ?? null,
        trim: trade.trim ?? null, vin: trade.vin ?? null } : undefined,
      bdc_agent_id: lead.assigned_to ? String(lead.assigned_to) : undefined,
      ...Object.fromEntries(['department', 'stock_number', 'vehicle', 'trade', 'salesperson_id', 'sales_manager_id',
        'bdc_agent_id', 'stage', 'note'].filter((k) => body[k] !== undefined).map((k) => [k, body[k]])),
    };
    if (input.vehicle?.year && !Number.isInteger(Number(input.vehicle.year))) input.vehicle.year = null;
    const now = new Date();
    const plan = planChanges({}, input, { now });
    if (plan.errors) return json({ message: plan.errors.join('; '), errors: plan.errors }, 400);
    const by = access.user?._id || null;
    const doc = { dealer_id: String(dealerId), lead_id: lead._id, customer_id: lead.customer_id || null,
      checked_in_at: checkedIn, created_by: by, vehicle: {}, trade: {} };
    for (const [k, v] of Object.entries(plan.set)) {
      const [top, sub] = k.split('.');
      if (sub) doc[top][sub] = v; else doc[top] = v;
    }
    if (doc.stage) doc.stage_at = checkedIn; // a stage picked at check-in started then (the time may be earlier)
    doc.history = [{ field: 'checked_in', from: null, to: checkedIn, at: now, by, by_name: actorName(access.user) },
      ...plan.history.filter((h) => h.field === 'stage').map((h) => ({ ...h, at: now, by, by_name: actorName(access.user) }))];
    if (plan.note) doc.notes = [{ text: plan.note, at: now, by, by_name: actorName(access.user) }];
    const entry = await DeskLogEntry.create(doc);
    return json({ entry: { id: String(entry._id) } }, 201);
  } catch (error) {
    console.error('desk-log POST failed:', error?.message);
    return json({ message: 'Could not check the customer in' }, 500);
  }
}
