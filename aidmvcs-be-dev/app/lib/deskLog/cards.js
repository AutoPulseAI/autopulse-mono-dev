// The Desk Log's headline cards (Betsy's Desk Log design): Internet Leads, Phone Ups, Walk-Ins, Appointments Set,
// Appointments Showed, Sold Pending, Sold Delivered, Dealership Action Required, Closed Lost - each for today and
// month to date, in the dealer's time. Each card IS a Reports number (app/lib/reporting), counted by it and opening
// its leads on the Leads page (/dealer/leads?report_kpi=..., like every Dashboard and Reports number), so the card
// and the list it opens always agree.
import moment from 'moment-timezone';
import { evaluateKpi } from '../reporting/registry.js';

// key -> the Reports number it is, and for the lead types the group of "Leads received" by lead type.
export const CARDS = Object.freeze([
  { key: 'internet', label: 'Internet Leads', kpi: 'exec.leads_received', by: 'up_type', group: 'Internet' },
  { key: 'phone', label: 'Phone Ups', kpi: 'exec.leads_received', by: 'up_type', group: 'Phone' },
  { key: 'walk_in', label: 'Walk-Ins', kpi: 'exec.leads_received', by: 'up_type', group: 'Walk-in' },
  { key: 'appts_set', label: 'Appointments Set', kpi: 'exec.appointments_set' },
  { key: 'appts_showed', label: 'Appointments Showed', kpi: 'exec.shown' },
  { key: 'sold_pending', label: 'Sold Pending', kpi: 'sales.proxy_sold_pending' },
  { key: 'sold_delivered', label: 'Sold Delivered', kpi: 'sales.proxy_sold_delivered' },
  { key: 'action_required', label: 'Dealership Action Required', kpi: 'sales.proxy_action_required' },
  { key: 'closed_lost', label: 'Closed Lost', kpi: 'sales.proxy_closed_lost' },
]);
// The Reports numbers the cards open (the Leads page lets a Desk Log user open these).
export const CARD_KPIS = Object.freeze(new Set(CARDS.map((c) => c.kpi)));

async function countsFor(args) {
  const ctx = {};
  const results = new Map();
  for (const id of CARD_KPIS) results.set(id, await evaluateKpi(id, args, ctx));
  return Object.fromEntries(CARDS.map((c) => {
    const r = results.get(c.kpi);
    const n = c.by ? (r.breakdowns?.[c.by] || []).find((g) => g.key === c.group)?.count : r.count;
    return [c.key, n ?? 0];
  }));
}

/** The Leads page list behind a card: the dealer-local days from..to as instants, as the Reports links send them. */
export function cardLink(card, { from, to, tz }) {
  const q = new URLSearchParams({ report_kpi: card.kpi });
  q.set('startDate', moment.tz(from, 'YYYY-MM-DD', tz).startOf('day').toISOString());
  q.set('endDate', moment.tz(to, 'YYYY-MM-DD', tz).endOf('day').toISOString());
  if (card.by) {
    q.set('report_by', card.by);
    q.set('report_group', card.group);
  }
  return `/dealer/leads?${q.toString()}`;
}

/** { today, mtd, day } for the day `day` (dealer-local YYYY-MM-DD, default today) and its month up to that day. */
export async function deskLogCards(dealerId, tz, day = null) {
  const d = day || moment.tz(tz).format('YYYY-MM-DD');
  const monthStart = moment.tz(d, 'YYYY-MM-DD', tz).startOf('month').format('YYYY-MM-DD');
  const [today, mtd] = await Promise.all([
    countsFor({ dealerId, tz, from: d, to: d }),
    countsFor({ dealerId, tz, from: monthStart, to: d }),
  ]);
  return { day: d, cards: CARDS.map(({ key, label, ...card }) => ({ key, label, today: today[key], mtd: mtd[key],
    today_link: cardLink(card, { from: d, to: d, tz }), mtd_link: cardLink(card, { from: monthStart, to: d, tz }) })) };
}
