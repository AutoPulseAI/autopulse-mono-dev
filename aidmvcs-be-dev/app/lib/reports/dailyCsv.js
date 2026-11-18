// The daily email's numbers as a CSV, from the same saved snapshot (SOW F2: "an optional CSV attachment or secure
// download link"). Counts only, never customer names / phones / emails. The link in the email is signed (dealer, day,
// expiry) and works for 30 days without a login, because it carries no customer data.
import { signKey, validKey } from '../ai/emailTracking.js';

export const LINK_DAYS = 30;

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const val = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);

/** [section, metric, value, how it is counted] rows. A blank value = not computed / stale (the email's "—"). */
export function snapshotRows(snapshot) {
  const m = snapshot?.metrics || {};
  const a = m.appointments || {}; const due = m.appointments_due || {}; const r = m.replies || {};
  const ai = m.ai_activity || {}; const dept = m.by_department || {};
  const rows = [
    ['Appointments set', 'Total', a.total, 'Appointments created that day (not the day they are for)'],
    ['Appointments set', 'Booked by AI', a.ai, 'The AI booked it'],
    ['Appointments set', 'AI-assisted', a.ai_assisted, 'The AI talked with the customer first, then staff booked'],
    ['Appointments set', 'Human only', a.human_only, 'Staff booked with no AI conversation before'],
    ['Appointments set', 'Unknown', a.unknown, 'Booking source not recorded'],
    ['Appointments set', 'AI-influenced %', a.ai_influence_pct, '(AI + AI-assisted) / total'],
    ['Appointments set', 'Cancelled', a.cancelled, 'Of the appointments set that day'],
    ['Appointment results', 'Shown (recorded)', due.shown, 'Appointments due that day'],
    ['Appointment results', 'No-show (marked)', due.no_show, 'Appointments due that day'],
    ['Appointment results', 'No outcome recorded', due.not_recorded, 'Past, nobody marked shown or no-show'],
    ['Customers replied', "From today's leads", r.todays_leads, 'Each customer once'],
    ['Customers replied', 'From past leads', r.past_leads, 'Each customer once'],
    ['Customers replied', 'Total', r.total, 'Each customer once'],
    ['Replies by lead age (overlapping)', '7+ days', r.cumulative?.d7, 'Do not add these up'],
    ['Replies by lead age (overlapping)', '15+ days', r.cumulative?.d15, 'Do not add these up'],
    ['Replies by lead age (overlapping)', '30+ days', r.cumulative?.d30, 'Do not add these up'],
    ['Replies by lead age (overlapping)', '60+ days', r.cumulative?.d60, 'Do not add these up'],
    ['Leads', 'Leads received', m.leads?.received, ''],
    ['AI activity (each counted on its own)', 'AI replied to an inbound message', ai.customer_messages_answered, 'Customer messages the AI answered'],
    ['AI activity (each counted on its own)', 'AI follow-up reactivated a cold lead', ai.cold_reactivated, 'Replied 14+ days after the last reply (or lead), after an AI message'],
    ['AI activity (each counted on its own)', 'AI turned a lead into a conversation', ai.conversations_started, "The lead's first reply, after an AI message"],
    ['AI activity (each counted on its own)', 'AI teed up a customer for your team', ai.qualified_handoffs, 'AI handed the lead to staff for a reason that needs a person'],
    ['AI activity (each counted on its own)', 'AI messages sent', ai.messages_sent, ''],
    ['Sold', 'Sold (CRM status)', m.sold?.count, 'Leads first set to a sold status that day'],
  ];
  for (const [k, label] of [['sales', 'Sales'], ['service', 'Service']]) {
    if (!dept[k]) continue;
    rows.push([`${label} appointments set`, 'Total', dept[k].total, "By the lead's department"],
      [`${label} appointments set`, 'Booked by AI', dept[k].ai, ''], [`${label} appointments set`, 'AI-assisted', dept[k].ai_assisted, '']);
  }
  return rows;
}

export function snapshotCsv(snapshot, storeName = '') {
  const head = [`# ${storeName} - daily performance ${snapshot.report_date} (${snapshot.tz})`,
    `# data as of ${new Date(snapshot.data_as_of).toISOString()}; blank = could not be confirmed`];
  return [...head, 'section,metric,value,how it is counted',
    ...snapshotRows(snapshot).map(([s, m, v, d]) => [q(s), q(m), val(v), q(d)].join(','))].join('\n');
}

const keyFor = (dealerId, date, exp) => `daily:${dealerId}:${date}:${exp}`;

/** The signed CSV link for one dealer's day, or null when the CRM's address isn't configured. */
export function csvLink(baseUrl, dealerId, date, now = Date.now()) {
  if (!baseUrl) return null;
  const exp = Math.floor(now / 1000) + LINK_DAYS * 86400;
  const sig = signKey(keyFor(dealerId, date, exp));
  if (!sig) return null;
  const root = String(baseUrl).replace(/\/+$/, '');
  return `${root}/api/reports/daily-csv?d=${encodeURIComponent(dealerId)}&date=${encodeURIComponent(date)}&e=${exp}&s=${sig}`;
}

export function validCsvLink({ d, date, e, s }, now = Date.now()) {
  if (!d || !date || !e || !s) return false;
  if (Number(e) * 1000 < now) return false;
  return validKey(keyFor(d, date, e), s);
}
