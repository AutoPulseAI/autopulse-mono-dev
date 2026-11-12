// The Desk Log's headline cards (Betsy's Desk Log design): Internet Leads, Phone Ups, Walk-Ins, Appointments Set,
// Appointments Showed, Sold Pending, Sold Delivered, Dealership Action Required, Closed Lost - each for today and
// month to date, in the dealer's time. Counted with the same KPIs as the Dashboard reports
// (app/lib/reporting), so a number here always equals the same number there.
import moment from 'moment-timezone';
import { evaluateKpi } from '../reporting/registry.js';
import { firstStatusChangeLeads, leadsByIds } from '../reporting/kpis/common.js';
import { statusRegexFor } from '../reporting/normalize.js';
import { upType } from '../reporting/sourcePerformance.js';

export const CARDS = Object.freeze([
  { key: 'internet', label: 'Internet Leads' },
  { key: 'phone', label: 'Phone Ups' },
  { key: 'walk_in', label: 'Walk-Ins' },
  { key: 'appts_set', label: 'Appointments Set' },
  { key: 'appts_showed', label: 'Appointments Showed' },
  { key: 'sold_pending', label: 'Sold Pending' },
  { key: 'sold_delivered', label: 'Sold Delivered' },
  { key: 'action_required', label: 'Dealership Action Required' },
  { key: 'closed_lost', label: 'Closed Lost' },
]);

const STATUS_CARDS = Object.freeze({
  sold_pending: ['SOLD_PENDING'], sold_delivered: ['SOLD_DELIVERED'], action_required: ['ESCALATED'],
  closed_lost: ['CLOSED_LOST'],
});
const TYPE_OF = Object.freeze({ Internet: 'internet', Phone: 'phone', 'Walk-in': 'walk_in' });

async function countsFor(args) {
  const ctx = {};
  const out = Object.fromEntries(CARDS.map((c) => [c.key, 0]));
  const received = await evaluateKpi('exec.leads_received', args, ctx);
  const leads = await leadsByIds(received.rows.map((r) => String(r.lead_id)).filter(Boolean), ctx);
  for (const r of received.rows) {
    const key = TYPE_OF[upType(leads.get(String(r.lead_id)))];
    if (key) out[key] += 1;
  }
  out.appts_set = (await evaluateKpi('exec.appointments_set', args, ctx)).count ?? 0;
  out.appts_showed = (await evaluateKpi('exec.shown', args, ctx)).count ?? 0;
  for (const [key, groups] of Object.entries(STATUS_CARDS)) {
    out[key] = (await firstStatusChangeLeads(args, ctx, `desk:${key}`, statusRegexFor(groups))).length;
  }
  return out;
}

/** { today, mtd, day } for the day `day` (dealer-local YYYY-MM-DD, default today) and its month up to that day. */
export async function deskLogCards(dealerId, tz, day = null) {
  const d = day || moment.tz(tz).format('YYYY-MM-DD');
  const monthStart = moment.tz(d, 'YYYY-MM-DD', tz).startOf('month').format('YYYY-MM-DD');
  const [today, mtd] = await Promise.all([
    countsFor({ dealerId, tz, from: d, to: d }),
    countsFor({ dealerId, tz, from: monthStart, to: d }),
  ]);
  return { day: d, cards: CARDS.map((c) => ({ ...c, today: today[c.key], mtd: mtd[c.key] })) };
}
