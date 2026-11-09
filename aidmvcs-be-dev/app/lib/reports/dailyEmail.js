// The daily performance email, rendered from a saved snapshot (app/lib/reports/dailySnapshot.js). Pure: same snapshot
// + branding -> same HTML. Single column, max 600px, inline styles (Gmail / Outlook / phone mail apps), every string
// HTML-escaped. Counts and the store name only: no customer names, phones or emails ever reach this module.
// A number the snapshot could not compute (or whose data source is stale) shows as "—", never 0.
import moment from 'moment-timezone';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const DASH = '—';

function color(value, fallback) {
  return HEX.test(String(value || '').trim()) ? String(value).trim() : fallback;
}

function httpUrl(value) {
  const s = String(value || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
}

export function brandingFrom(dealer) {
  const b = dealer?.branding_information || {};
  const logo = typeof b.dealershipLogo === 'string' ? b.dealershipLogo : b.dealershipLogo?.url;
  return {
    primary: color(b.primaryColor, '#0272b4'),
    text: color(b.titleColor, '#262a2a'),
    logoUrl: httpUrl(logo),
    storeName: String(dealer?.dealer_account_information?.store_name || dealer?.name || 'Your dealership'),
  };
}

function staleSet(snapshot) {
  const s = new Set();
  for (const src of snapshot?.stale_sources || []) for (const a of src.affects || []) s.add(a);
  return s;
}

// A number for display: "—" when missing or when its section is stale.
function n(value, sectionStale) {
  if (sectionStale || value === null || value === undefined || Number.isNaN(value)) return DASH;
  return Number(value).toLocaleString('en-US');
}

function pct(value, sectionStale) {
  if (sectionStale || value === null || value === undefined) return DASH;
  return `${Math.round(Number(value))}%`;
}

const SOURCE_LABELS = {
  appointments: 'Appointments set', appointments_due: 'Appointment results', replies: 'Customer replies',
  ai_messages: 'AI messages', ai_service: 'AI service events',
};

/**
 * @param {{snapshot: object, dealer?: object, branding?: object, dashboardUrl?: string, mode?: 'internal'|'live',
 *   liveRecipientCount?: number}} args
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderDailyEmail({ snapshot, dealer = null, branding = null, dashboardUrl = null, mode = 'live',
  liveRecipientCount = null } = {}) {
  const b = branding || brandingFrom(dealer);
  const m = snapshot?.metrics || {};
  const stale = staleSet(snapshot);
  const unavailable = new Set(snapshot?.unavailable || []);
  const a = m.appointments || {};
  const aStale = stale.has('appointments') || !m.appointments;
  const due = m.appointments_due || {};
  const dueStale = stale.has('appointments_due') || !m.appointments_due;
  const r = m.replies || {};
  const rStale = stale.has('replies') || !m.replies;
  const cum = r.cumulative || {};
  const l = m.leads || {};
  const lStale = stale.has('leads') || !m.leads;
  const ai = m.ai_activity || {};
  const aiStale = stale.has('ai_activity') || !m.ai_activity;
  const day = moment.tz(snapshot.report_date, 'YYYY-MM-DD', snapshot.tz || 'UTC');
  const dayLong = day.format('dddd, MMMM D, YYYY');
  const dayShort = day.format('MMM D');
  const link = httpUrl(dashboardUrl);

  const prefix = mode === 'internal'
    ? `[Internal test${liveRecipientCount != null ? `, live would go to ${liveRecipientCount}` : ''}] ` : '';
  const subject = `${prefix}Yesterday at ${b.storeName}: ${n(a.total, aStale)} appointments (${dayShort})`;

  const row = (label, value, note = '') => `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #eceff1;font-size:16px;color:${b.text}">${esc(label)}${note
    ? `<div style="font-size:12px;color:#6b7280">${esc(note)}</div>` : ''}</td>
              <td align="right" style="padding:10px 0;border-bottom:1px solid #eceff1;font-size:18px;font-weight:bold;color:${b.text}">${esc(value)}</td>
            </tr>`;
  const heading = (title, sub = '') => `
          <tr><td style="padding:24px 24px 4px 24px">
            <div style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:bold;color:${b.primary}">${esc(title)}</div>${sub
    ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(sub)}</div>` : ''}
          </td></tr>`;
  const table = (rows) => `
          <tr><td style="padding:0 24px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
            </table>
          </td></tr>`;

  const staleList = (snapshot?.stale_sources || []);
  const banner = staleList.length ? `
          <tr><td style="padding:16px 24px 0 24px">
            <div style="background:#fff7e6;border:1px solid #f5c26b;border-radius:8px;padding:12px 14px;font-size:14px;color:#7a4b00">
              <strong>Some data may be incomplete.</strong> Figures marked ${DASH} could not be confirmed for this day:
              ${esc(staleList.map((s) => SOURCE_LABELS[s.source] || s.source).filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', '))}.
            </div>
          </td></tr>` : '';

  const logo = b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.storeName)}" width="140" style="display:block;max-width:140px;height:auto;border:0;margin:0 auto 8px auto">` : '';
  const testNote = mode === 'internal' ? `
          <tr><td style="padding:12px 24px 0 24px;font-size:13px;color:#7a4b00;background:#fff7e6">
            Internal test copy - this dealer does not receive it yet.
          </td></tr>` : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f3f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f3f4">
    <tr><td align="center" style="padding:16px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
        <tr><td style="height:6px;background:${b.primary};font-size:0;line-height:0">&nbsp;</td></tr>${testNote}
        <tr><td align="center" style="padding:24px 24px 8px 24px">
          ${logo}
          <div style="font-size:20px;font-weight:bold;color:${b.text}">${esc(b.storeName)}</div>
          <div style="font-size:14px;color:#6b7280;margin-top:4px">Daily performance - ${esc(dayLong)}</div>
        </td></tr>${banner}
        <tr><td align="center" style="padding:24px 24px 8px 24px">
          <div style="font-size:56px;line-height:1;font-weight:bold;color:${b.primary}">${esc(n(a.total, aStale))}</div>
          <div style="font-size:16px;color:${b.text};margin-top:6px">Total appointments set</div>
          <div style="font-size:14px;color:#6b7280;margin-top:4px">AI-influenced: ${esc(pct(a.ai_influence_pct, aStale))}${
  !aStale && a.ai_influenced != null ? ` (${esc(n(a.ai_influenced))} of ${esc(n(a.total))})` : ''}</div>
        </td></tr>
        ${heading('Who set the appointments')}
        ${table([
    row('Booked by AI', n(a.ai, aStale)),
    row('AI-assisted', n(a.ai_assisted, aStale), 'AI talked with the customer, then staff booked'),
    row('Human only', n(a.human_only, aStale)),
    row('Unknown', n(a.unknown, aStale), 'Booking source not recorded'),
  ].join(''))}
        ${heading('Appointment results', 'Appointments that were due this day')}
        ${table([
    row('Shown', n(due.shown, dueStale)),
    row('No-show', n(due.no_show, dueStale)),
    row('No outcome recorded yet', n(due.no_outcome, dueStale)),
    row('Cancelled', n(a.cancelled, aStale), 'Of the appointments set this day'),
    row('Rescheduled', unavailable.has('appointments.rescheduled') ? DASH : n(a.rescheduled, aStale),
      unavailable.has('appointments.rescheduled') ? 'Not tracked yet' : ''),
  ].join(''))}
        ${heading('Customers who replied', 'Each customer counted once for the day')}
        ${table([
    row("From today's leads", n(r.todays_leads, rStale)),
    row('From past leads', n(r.past_leads, rStale)),
    row('Total customers replied', n(r.total, rStale)),
  ].join(''))}
        ${heading('Replies by lead age', 'Overlapping groups - a 30+ day lead is also in 7+ and 15+; do not add them up')}
        ${table([
    row('Lead 7+ days old', n(cum.d7, rStale)),
    row('Lead 15+ days old', n(cum.d15, rStale)),
    row('Lead 30+ days old', n(cum.d30, rStale)),
    row('Lead 60+ days old', n(cum.d60, rStale)),
  ].join(''))}
        ${heading('Leads and AI activity')}
        ${table([
    row('Leads received', n(l.received, lStale)),
    row('AI messages sent', n(ai.messages_sent, aiStale)),
    row('Leads the AI messaged', n(ai.leads_messaged, aiStale)),
    row('Customer messages answered by AI', n(ai.customer_messages_answered, aiStale)),
  ].join(''))}
        ${link ? `<tr><td align="center" style="padding:28px 24px 8px 24px">
          <a href="${esc(link)}" style="display:inline-block;background:${b.primary};color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 28px;border-radius:8px">Open your dashboard</a>
        </td></tr>` : ''}
        <tr><td style="padding:20px 24px 24px 24px;font-size:12px;line-height:1.5;color:#6b7280">
          Report day: ${esc(snapshot.report_date)} (${esc(snapshot.tz)}). Data as of ${esc(moment(snapshot.data_as_of).tz(snapshot.tz || 'UTC').format('MMM D, YYYY h:mm A z'))}.
          Sent by AutoPulse. To change who receives this email, update Report Schedule in your dashboard.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `${b.storeName} - daily performance, ${dayLong}`,
    staleList.length ? 'Some data may be incomplete; figures shown as "—" could not be confirmed.' : null,
    `Total appointments set: ${n(a.total, aStale)} (AI-influenced ${pct(a.ai_influence_pct, aStale)})`,
    `  AI ${n(a.ai, aStale)} | AI-assisted ${n(a.ai_assisted, aStale)} | Human only ${n(a.human_only, aStale)} | Unknown ${n(a.unknown, aStale)}`,
    `Due that day: shown ${n(due.shown, dueStale)} | no-show ${n(due.no_show, dueStale)} | no outcome ${n(due.no_outcome, dueStale)}`,
    `Cancelled ${n(a.cancelled, aStale)} | Rescheduled ${DASH} (not tracked yet)`,
    `Customers replied: today's leads ${n(r.todays_leads, rStale)} | past leads ${n(r.past_leads, rStale)} | total ${n(r.total, rStale)}`,
    `By lead age (overlapping groups): 7+ ${n(cum.d7, rStale)} | 15+ ${n(cum.d15, rStale)} | 30+ ${n(cum.d30, rStale)} | 60+ ${n(cum.d60, rStale)}`,
    `Leads received: ${n(l.received, lStale)}`,
    `AI messages sent ${n(ai.messages_sent, aiStale)} | leads messaged ${n(ai.leads_messaged, aiStale)} | customer messages answered ${n(ai.customer_messages_answered, aiStale)}`,
    link ? `Dashboard: ${link}` : null,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}
