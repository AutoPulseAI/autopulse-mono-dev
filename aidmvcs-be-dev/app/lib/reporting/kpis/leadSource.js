// Lead source report (SOW 8 Deliverable F, gap G-040; KPI dictionary A-F 3.7). The funnel per source (leads ->
// replied -> appointments -> shown -> CRM sold) uses the same KPIs as the other tabs, grouped by the lead's provider
// (app/lib/reporting/normalize.js normalizeProvider: CarGurus variants roll up to "CarGurus", campaign_<name> to
// "Campaign"). Spend-based numbers (CPL, cost per appointment / sale, ROI) need spend data and show that instead.
import {
  BOOKING_COLUMNS, BOOKING_FILTERS, KIND, LEAD_COLUMNS, LEAD_FILTERS, REPLY_FILTERS, STATE, collection, dealerForms,
  leadRowsForIds, leadsReceived, localDateTime, localDay, notYet, replies, windowFor,
} from './common.js';
import { SHOWN_BASIS, SHOWN_TEXT, shared } from './executive.js';

const D = 'lead_source';
const BY = ['lead_source'];

const clickKpi = (id, label, coll, numerator) => ({
  id, label, dashboard: D, grain: 'click', kind: KIND.COUNT, dateBasis: `${coll}.clickedAt`,
  numerator, denominator: null, inclusions: 'Clicks on AutoPulse short links.', exclusions: 'Clicks flagged as bots '
    + '(isBot).', source: [coll], filters: [],
  columns: [['click_id', 'Click ID'], ['clicked_at', 'When'], ['link', 'Link'], ['vin', 'VIN']],
  evaluate: async (args) => {
    const w = await windowFor(args);
    const docs = await collection(coll).find({ dealer_id: { $in: dealerForms(args.dealerId) },
      isBot: { $ne: true }, clickedAt: { $gte: w.start, $lte: w.end } },
    { projection: { clickedAt: 1, shortCode: 1, originalUrl: 1, vin: 1 } }).sort({ clickedAt: 1, _id: 1 }).toArray();
    return { rows: docs.map((d) => ({ id: String(d._id), click_id: String(d._id),
      clicked_at: localDateTime(d.clickedAt, w.tz), link: d.originalUrl || d.shortCode || '', vin: d.vin || '',
      _day: localDay(d.clickedAt, w.tz), _g: {} })) };
  },
});

const spend = (id, label, numerator, denominator) => notYet(STATE.NEEDS_DATA, {
  id, label, dashboard: D, grain: 'source', dateBasis: 'month of spend', numerator, denominator,
  exclusions: 'n/a', source: ['source_spend (does not exist)'],
  reason: 'Needs spend data: there is no spend per source anywhere yet (a monthly spend entry per source).',
});

export const LEAD_SOURCE_KPIS = [
  {
    id: 'source.leads', label: 'Leads', dashboard: D, grain: 'lead', kind: KIND.COUNT, dateBasis: 'Lead.createdAt',
    numerator: 'Leads received in the range, by provider.', denominator: null, inclusions: 'Every lead.',
    exclusions: 'None. Leads with no lead source are "Unknown".', source: ['leads'], filters: LEAD_FILTERS,
    breakdowns: BY, columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.leadsReceivedRows(args, ctx) }),
  },
  {
    id: 'source.replied_leads', label: 'Replied', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'emails.timestamp of the reply', numerator: 'Leads (any lead date) whose customer sent a qualifying '
      + 'reply in the range, by the lead\'s provider (replyCohorts rows, distinct lead).', denominator: null,
    inclusions: 'As Customers replied.', exclusions: 'Replies with no lead link.', source: ['emails', 'leads'],
    filters: REPLY_FILTERS, breakdowns: BY, columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => {
      const report = await replies(args, ctx);
      const ids = [...new Set(report.rows.map((r) => r.lead_id).filter(Boolean))];
      return { rows: await leadRowsForIds(ids, args, ctx) };
    },
  },
  {
    id: 'source.appointments', label: 'Appointments set', dashboard: D, grain: 'booking', kind: KIND.COUNT,
    dateBasis: 'Booking.createdAt', numerator: 'Bookings set in the range, by the lead\'s provider.',
    denominator: null, inclusions: 'Any status.', exclusions: 'Duplicate bookings.', source: ['bookings', 'leads'],
    filters: BOOKING_FILTERS, breakdowns: BY, columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.apptSetRows(args, ctx) }),
  },
  {
    id: 'source.shown', label: 'Shown', dashboard: D, grain: 'booking', kind: KIND.COUNT,
    dateBasis: 'Booking.bookingDate', numerator: `${SHOWN_TEXT} By the lead's provider.`, denominator: null,
    inclusions: 'As exec.shown.', basedOn: SHOWN_BASIS,
    exclusions: 'Cancelled; duplicates.', source: ['bookings', 'leads'], filters: BOOKING_FILTERS, breakdowns: BY,
    columns: BOOKING_COLUMNS, evaluate: async (args, ctx) => ({ rows: await shared.shownRows(args, ctx) }),
  },
  {
    id: 'source.crm_sold', label: 'CRM sold', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'ActivityLog.at of the first sold status change', numerator: 'Leads first set to a sold status in the '
      + 'range, by provider.', denominator: null, inclusions: 'As exec.crm_sold.', exclusions: 'As exec.crm_sold.',
    source: ['activitylogs', 'leads'], filters: LEAD_FILTERS, breakdowns: BY,
    columns: [...LEAD_COLUMNS, ['changed_at', 'Sold on']],
    evaluate: async (args, ctx) => ({ rows: await shared.soldRows(args, ctx) }),
  },
  {
    id: 'source.campaign_leads', label: 'Campaign leads', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: 'Lead.createdAt', numerator: 'Leads received in the range whose lead source is "campaign_<name>" '
      + '(created by a campaign, worker/campaignWorker.js), by campaign name.', denominator: null,
    inclusions: 'Name-based: a renamed campaign shows under its old name.', exclusions: 'Other leads.',
    source: ['leads'], filters: LEAD_FILTERS, breakdowns: ['campaign'], columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => {
      const leads = await shared.leadsReceivedRows(args, ctx);
      const all = await leadsReceived(args, ctx);
      const campaign = new Map(all.filter((l) => /^campaign_/i.test(String(l.lead_source || '')))
        .map((l) => [String(l._id), String(l.lead_source).replace(/^campaign_/i, '') || '(no name)']));
      return { rows: leads.filter((r) => campaign.has(r.id))
        .map((r) => ({ ...r, _g: { ...r._g, campaign: campaign.get(r.id) } })) };
    },
  },
  clickKpi('source.vdp_clicks', 'Vehicle page clicks', 'vehicleclicks', 'Clicks on vehicle (VDP) short links in the '
    + 'range.'),
  clickKpi('source.website_clicks', 'Website clicks', 'dealerwebsiteclicks', 'Clicks on dealer website short links in '
    + 'the range.'),
  spend('source.cost_per_lead', 'Cost per lead', 'Spend per source.', 'Leads per source.'),
  spend('source.cost_per_appointment', 'Cost per appointment', 'Spend per source.', 'Appointments per source.'),
  spend('source.cost_per_sale', 'Cost per sale', 'Spend per source.', 'Sales per source.'),
  spend('source.roi', 'ROI', 'Gross from sales per source minus spend.', 'Spend per source.'),
  notYet(STATE.NEEDS_DATA, {
    id: 'source.dms_sales', label: 'DMS sales by source', dashboard: D, grain: 'deal', dateBasis: 'Deal "Contract Date"',
    numerator: 'DMS deals matched to a lead, by the lead\'s provider.', denominator: null, exclusions: 'n/a',
    source: ['deals', 'leads'], reason: 'DMS deal dates are text and no deal-to-lead matching rule is agreed '
      + '(client question 5).',
  }),
];
