// Customer search for checking someone in on the Desk Log: ?dealer_id &q (name, phone, email) -> up to 10 of the
// dealer's leads, newest first.
import Lead from '@models/Lead';
import { deskLogAccess, json } from '@lib/deskLog/access';
import { dealerForms } from '@lib/reporting/kpis/common';
import { normalizeProvider } from '@lib/reporting/normalize';
import { upType } from '@lib/reporting/sourcePerformance';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const dealerId = params.get('dealer_id');
  const access = await deskLogAccess(req, dealerId);
  if (access.response) return access.response;
  const q = (params.get('q') || '').trim().slice(0, 80);
  if (q.length < 2) return json({ leads: [] });
  const digits = q.replace(/\D/g, '');
  const or = [{ name: new RegExp(escape(q), 'i') }, { email: new RegExp(escape(q), 'i') }];
  if (digits.length >= 4) or.push({ phone: new RegExp(digits.split('').map(escape).join('\\D*')) });
  const leads = await Lead.find({ dealer_id: { $in: dealerForms(dealerId) }, $or: or })
    .select('name phone email createdAt lead_source source contact_type fe_lead_status vehicle_year vehicle_make '
      + 'vehicle_model').sort({ createdAt: -1 }).limit(10).lean();
  return json({ leads: leads.map((l) => ({ id: String(l._id), name: l.name || '', phone: l.phone || '',
    email: l.email || '', created_at: l.createdAt, source: normalizeProvider(l.lead_source, l.source),
    lead_type: upType(l), status: l.fe_lead_status || null,
    vehicle: [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(' ') })) });
}
