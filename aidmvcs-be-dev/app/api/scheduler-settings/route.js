// A rooftop's service scheduler settings (Dealer-FX / Xtime via DealerVault; SOW v6 Appendix A 1A, G-072 to G-074).
//   GET ?dealer_id            -> { settings, can_edit, checklist }
//   PUT { dealer_id, settings } -> checked and saved; every change in history
// Settings only (the user, 18 Nov 2026): no vendor API access yet, so no availability is read and nothing is booked;
// status is PENDING VENDOR VERIFICATION. Same editors as Dealer Intelligence ("Manage Account Information", the
// dealer account, a super admin). Credentials are not accepted here.
import dbConnect from '@lib/mongodb';
import SchedulerSettings from '@models/SchedulerSettings';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';

export const runtime = 'nodejs';
const json = (b, s = 200) => Response.json(b, { status: s });
const canEdit = (user) => hasPermission(user, 'Manage Account Information');
const text = (v, max = 200) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); return s || null; };

// What each vendor must confirm in writing before any booking code is written (SOW Appendix A 1A, 1E).
const CHECKLIST = [
  'Vendor-approved API access for this rooftop, with sandbox / test credentials',
  'Authentication method and permissions',
  'Endpoint specifications: read availability (open and full slots), create appointment, read it back',
  'Availability rules: capacity, advisors / resources, service durations, holidays',
  'Cancellation, rescheduling and change notifications (what is supported)',
  'Rate limits and error codes',
  'Xtime only: written confirmation from DealerVault of the supported read / write operations',
];

const view = async (dealerId, user) => {
  const doc = await SchedulerSettings.findOne({ dealer_id: dealerId }).lean();
  return { settings: { provider: 'none', status: 'pending_vendor_verification', department: 'service', services: [], advisors: [], ...(doc || {}),
    history: (doc?.history || []).slice(-30).reverse() }, can_edit: await canEdit(user), checklist: CHECKLIST };
};

export async function GET(req) {
  await dbConnect();
  const dealerId = new URL(req.url).searchParams.get('dealer_id') || '';
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  return json(await view(dealerId, access.user));
}

export async function PUT(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return json({ error: 'The request body must be JSON' }, 400); }
  const dealerId = String(body?.dealer_id || '');
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  if (!(await canEdit(access.user))) return json({ error: 'You do not have permission to change these settings' }, 403);
  const s = body.settings || {};
  if (['password', 'api_key', 'secret', 'token', 'credentials'].some((k) => s[k] != null)) {
    return json({ error: 'Credentials are not saved here: they go into the server\'s secret store when the vendor issues them' }, 400);
  }
  if (!['none', 'dealer_fx', 'xtime_dealervault'].includes(s.provider || 'none')) return json({ error: 'Provider must be none, Dealer-FX or Xtime' }, 400);
  const services = (Array.isArray(s.services) ? s.services : []).slice(0, 100).map((x) => ({ name: text(x?.name, 80),
    duration_min: Number.isFinite(Number(x?.duration_min)) && Number(x.duration_min) > 0 ? Math.min(600, Math.round(Number(x.duration_min))) : null }))
    .filter((x) => x.name);
  if (services.some((x) => !x.duration_min)) return json({ error: 'Each service needs its length in minutes' }, 400);
  const tz = text(s.timezone, 60);
  if (tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return json({ error: 'The time zone is not valid (e.g. America/New_York)' }, 400); } }
  const date = s.access_requested_on ? new Date(s.access_requested_on) : null;
  if (date && Number.isNaN(date.getTime())) return json({ error: 'The access request date is not valid' }, 400);
  const next = { provider: s.provider || 'none', location: text(s.location), department: text(s.department, 40) || 'service', timezone: tz,
    services, advisors: (Array.isArray(s.advisors) ? s.advisors : []).map((a) => text(a, 80)).filter(Boolean).slice(0, 100),
    booking_restrictions: text(s.booking_restrictions, 2000), vendor_contact: text(s.vendor_contact), access_requested_on: date,
    notes: text(s.notes, 2000) };
  const before = (await SchedulerSettings.findOne({ dealer_id: dealerId }).lean()) || {};
  const changed = Object.keys(next).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(next[k] ?? null));
  const byName = access.user?.name || access.user?.email || null;
  await SchedulerSettings.updateOne({ dealer_id: dealerId }, { $set: { ...next, updated_by_name: byName },
    ...(changed.length ? { $push: { history: { $each: [{ at: new Date(), by_name: byName, change: changed.join(', ') }], $slice: -200 } } } : {}) },
  { upsert: true });
  return json({ ...(await view(dealerId, access.user)), changed: changed.length });
}
