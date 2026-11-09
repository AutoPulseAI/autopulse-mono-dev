// Data quality / compliance report (SOW 8 Deliverable F, gap G-041; KPI dictionary A-F 3.8). Lead-based checks use
// the leads received in the range; pick a long range to see the whole history.
import {
  BOOKING_COLUMNS, KIND, LEAD_COLUMNS, LEAD_FILTERS, MESSAGE_COLUMNS, MESSAGE_FILTERS, STATE, FAILED, attribution,
  bookingRows, collection, dealerForms, leadRows, leadsReceived, localDateTime, localDay, messageRows,
  messageFilterMatch, messagesInWindow, notYet, outboundMatch, passingLeads, windowFor, isOid, leadsByIds,
} from './common.js';
import { isUnmappedSource, normalizeStatus } from '../normalize.js';

const D = 'data_quality';
const LEAD_BASIS = 'Lead.createdAt (leads received in the range)';

async function receivedWhere(args, ctx, pred, extra) {
  const leads = (await leadsReceived(args, ctx)).filter(pred);
  return leadRows(leads, args, ctx, extra);
}

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

export const DATA_QUALITY_KPIS = [
  {
    id: 'dq.leads_no_customer', label: 'Leads without a customer', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: LEAD_BASIS, numerator: 'Leads received in the range with no customer link (Lead.customer_id empty).',
    denominator: null, inclusions: 'Every lead.', exclusions: 'None.', source: ['leads'], filters: LEAD_FILTERS,
    breakdowns: ['lead_source'], columns: LEAD_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await receivedWhere(args, ctx, (l) => !l.customer_id) }),
  },
  {
    id: 'dq.unmapped_source', label: 'Unknown lead source', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: LEAD_BASIS, numerator: 'Leads received in the range whose lead source is empty or "Unknown".',
    denominator: null, inclusions: 'Lead.lead_source missing, empty or "unknown" (any case).', exclusions: 'None.',
    source: ['leads'], filters: LEAD_FILTERS, breakdowns: [], columns: [...LEAD_COLUMNS, ['source_raw', 'Source field']],
    evaluate: async (args, ctx) => ({ rows: await receivedWhere(args, ctx, (l) => isUnmappedSource(l.lead_source),
      (l) => ({ source_raw: l.source || '' })) }),
  },
  {
    id: 'dq.legacy_status', label: 'Legacy or unknown status', dashboard: D, grain: 'lead', kind: KIND.COUNT,
    dateBasis: LEAD_BASIS, numerator: 'Leads received in the range whose stored status is not one of the governed '
      + 'statuses (app/lib/reporting/normalize.js): legacy spellings (\'visited\', \'Contacted\', \'Sold\', ...), '
      + 'display labels stored as values, unknown values, or no status.', denominator: null,
    inclusions: 'Lead.fe_lead_status.', exclusions: 'None. scripts/normalize-legacy-statuses.js fixes the ones with a '
      + 'clear governed value.', source: ['leads'], filters: LEAD_FILTERS, breakdowns: ['status'],
    columns: [...LEAD_COLUMNS, ['would_become', 'Governed value'], ['needs_review', 'Needs a person']],
    evaluate: async (args, ctx) => ({ rows: await receivedWhere(args, ctx, (l) => {
      const n = normalizeStatus(l.fe_lead_status);
      return n.legacy || n.governed == null;
    }, (l) => {
      const n = normalizeStatus(l.fe_lead_status);
      return { would_become: n.fix || '', needs_review: n.needs_review ? 'yes' : 'no' };
    }).then((rows) => rows.map((r) => ({ ...r, _g: { ...r._g, status: r.status || '(none)' } }))) }),
  },
  {
    id: 'dq.duplicate_customers', label: 'Possible duplicate customers', dashboard: D, grain: 'customer',
    kind: KIND.COUNT, dateBasis: 'Customer.createdAt',
    numerator: 'Customers created in the range that share a phone number (last 10 digits) or an email address with '
      + 'another customer of the dealer.', denominator: null, inclusions: 'Customers not merged into another.',
    exclusions: 'Merged customers (Customer.merged_into set).', source: ['customers'], filters: [],
    columns: [['customer_id', 'Customer ID'], ['customer', 'Customer'], ['created_at', 'Created'],
      ['shared', 'Shared phone / email'], ['other_customers', 'Other customer IDs']],
    evaluate: async (args) => {
      const w = await windowFor(args);
      const docs = await collection('customers').find({ dealer_id: { $in: dealerForms(args.dealerId) },
        merged_into: { $in: [null] } }, { projection: { name: 1, emails: 1, phones: 1, createdAt: 1 } }).toArray();
      const owners = new Map();
      const keysOf = new Map();
      for (const c of docs) {
        const keys = new Set([
          ...(c.emails || []).map((e) => String(e?.value || '').trim().toLowerCase()).filter(Boolean).map((e) => `e:${e}`),
          ...(c.phones || []).map((p) => digits(p?.value)).filter((d) => d.length === 10).map((d) => `p:${d}`),
        ]);
        keysOf.set(String(c._id), keys);
        for (const k of keys) {
          if (!owners.has(k)) owners.set(k, new Set());
          owners.get(k).add(String(c._id));
        }
      }
      const rows = [];
      for (const c of docs.sort((a, b) => String(a._id).localeCompare(String(b._id)))) {
        if (!c.createdAt || c.createdAt < w.start || c.createdAt > w.end) continue;
        const id = String(c._id);
        const shared = [...keysOf.get(id)].filter((k) => owners.get(k).size > 1);
        if (!shared.length) continue;
        const others = new Set(shared.flatMap((k) => [...owners.get(k)]).filter((o) => o !== id));
        rows.push({ id, customer_id: id, customer: c.name || '', created_at: localDateTime(c.createdAt, w.tz),
          shared: shared.map((k) => k.slice(2)).join(' '), other_customers: [...others].join(' '),
          _day: localDay(c.createdAt, w.tz), _g: {} });
      }
      return { rows };
    },
  },
  {
    id: 'dq.merged_customers', label: 'Customer merges', dashboard: D, grain: 'merge', kind: KIND.COUNT,
    dateBasis: 'Customer.merge_history.merged_at', numerator: 'Customer merges done in the range (one per merged '
      + 'customer).', denominator: null, inclusions: 'Reversed merges too (shown in the list).', exclusions: 'None.',
    source: ['customers'], filters: [],
    columns: [['merge_id', 'Merge'], ['customer_id', 'Kept customer'], ['customer', 'Customer'],
      ['merged_customer_id', 'Merged customer'], ['merged_at', 'Merged'], ['reversed', 'Reversed']],
    evaluate: async (args) => {
      const w = await windowFor(args);
      const rows = await collection('customers').aggregate([
        { $match: { dealer_id: { $in: dealerForms(args.dealerId) }, 'merge_history.merged_at': { $gte: w.start,
          $lte: w.end } } },
        { $unwind: '$merge_history' },
        { $match: { 'merge_history.merged_at': { $gte: w.start, $lte: w.end } } },
        { $project: { name: 1, m: '$merge_history' } },
        { $sort: { 'm.merged_at': 1, _id: 1 } },
      ]).toArray();
      const seen = new Set();
      return { rows: rows.map((r) => ({ id: `${r._id}:${r.m.merged_customer_id}`, merge_id: `${r._id}:${r.m.merged_customer_id}`,
        customer_id: String(r._id), customer: r.name || '', merged_customer_id: String(r.m.merged_customer_id),
        merged_at: localDateTime(r.m.merged_at, w.tz), reversed: r.m.reversed_at ? 'yes' : 'no',
        _day: localDay(r.m.merged_at, w.tz), _g: {} })).filter((r) => !seen.has(r.id) && seen.add(r.id)) };
    },
  },
  {
    id: 'dq.dms_import_errors', label: 'DealerVault import errors', dashboard: D, grain: 'import_batch',
    kind: KIND.COUNT, dateBasis: 'DealerVaultImportBatch.createdAt',
    numerator: 'DMS import batches received in the range that failed or completed with errors.', denominator: null,
    inclusions: 'status failed or completed_with_errors.', exclusions: 'Clean batches.',
    source: ['dealervaultimportbatches'], filters: [], breakdowns: ['status'],
    columns: [['batch_id', 'Batch'], ['file', 'File'], ['type', 'Type'], ['status', 'Status'],
      ['failed_rows', 'Failed rows'], ['error', 'Error'], ['received_at', 'Received']],
    evaluate: async (args) => {
      const w = await windowFor(args);
      const docs = await collection('dealervaultimportbatches').find({ dealer_id: { $in: dealerForms(args.dealerId) },
        status: { $in: ['failed', 'completed_with_errors'] }, createdAt: { $gte: w.start, $lte: w.end } },
      { projection: { raw_records_json: 0, row_outcomes: 0 } }).sort({ createdAt: 1, _id: 1 }).toArray();
      return { rows: docs.map((d) => ({ id: String(d._id), batch_id: String(d._id), file: d.fileName || '',
        type: d.fileType || '', status: d.status, failed_rows: d.failed_count ?? 0, error: d.error_code || '',
        received_at: localDateTime(d.createdAt, w.tz), _day: localDay(d.createdAt, w.tz), _g: { status: d.status } })) };
    },
  },
  {
    id: 'dq.failed_sends', label: 'Failed sends', dashboard: D, grain: 'message', kind: KIND.COUNT,
    dateBasis: 'emails.timestamp', numerator: 'Outbound messages in the range whose status is failed, undelivered, '
      + 'bounced or error.', denominator: null, inclusions: 'AI, staff and automatic messages.',
    exclusions: 'Notes, inbound.', source: ['emails'], filters: MESSAGE_FILTERS, breakdowns: ['channel'],
    columns: MESSAGE_COLUMNS,
    evaluate: async (args, ctx) => {
      const rows = await messagesInWindow(args, { ...outboundMatch(), ...messageFilterMatch({ spec: {
        channel: args.spec?.channel } }), status: { $in: FAILED } });
      return { rows: await messageRows(rows, args, ctx) };
    },
  },
  {
    id: 'dq.opt_outs', label: 'Opt-outs', dashboard: D, grain: 'consent_event', kind: KIND.COUNT,
    dateBasis: 'ai_consent.recorded_at', numerator: 'Opt-out entries recorded in the range (STOP texts, email '
      + 'unsubscribe links, staff), per channel.', denominator: null,
    inclusions: 'ai_consent consent_type opt_out, consent_status opted_out.', exclusions: 'Opt-ins.',
    source: ['ai_consent'], filters: LEAD_FILTERS, breakdowns: ['channel'],
    columns: [['consent_id', 'Entry'], ['lead_id', 'Lead ID'], ['customer', 'Customer'], ['channel', 'Channel'],
      ['how', 'How'], ['recorded_at', 'When']],
    evaluate: async (args, ctx) => {
      const w = await windowFor(args);
      let docs = await collection('ai_consent').find({ dealer_id: { $in: dealerForms(args.dealerId) },
        consent_type: 'opt_out', consent_status: 'opted_out', recorded_at: { $gte: w.start, $lte: w.end } })
        .sort({ recorded_at: 1, _id: 1 }).toArray();
      const pass = await passingLeads(args, docs.map((d) => String(d.lead_id || '')));
      if (pass) docs = docs.filter((d) => pass.has(String(d.lead_id)));
      const leads = await leadsByIds(docs.map((d) => String(d.lead_id || '')).filter(isOid), ctx);
      return { rows: docs.map((d) => ({ id: String(d._id), consent_id: String(d._id),
        lead_id: d.lead_id ? String(d.lead_id) : '', customer: leads.get(String(d.lead_id))?.name || '',
        channel: d.channel || '', how: d.consent_source || '', recorded_at: localDateTime(d.recorded_at, w.tz),
        _day: localDay(d.recorded_at, w.tz), _g: { channel: d.channel || 'unknown' } })) };
    },
  },
  {
    id: 'dq.send_blocks', label: 'Sends blocked by compliance', dashboard: D, grain: 'send_check', kind: KIND.COUNT,
    dateBasis: 'ai_compliance_log.at', numerator: 'AI send checks in the range that decided BLOCK (opt-out, no '
      + 'consent, quiet hours, ...), by reason.', denominator: null, inclusions: 'decision = BLOCK.',
    exclusions: 'HOLD (sent later) and REVIEW.', source: ['ai_compliance_log'], filters: LEAD_FILTERS,
    breakdowns: ['reason'],
    columns: [['check_id', 'Check'], ['lead_id', 'Lead ID'], ['channel', 'Channel'], ['reason', 'Reason'],
      ['rule', 'Rule'], ['at', 'When']],
    evaluate: async (args) => {
      const w = await windowFor(args);
      let docs = await collection('ai_compliance_log').find({ dealer_id: { $in: dealerForms(args.dealerId) },
        decision: 'BLOCK', at: { $gte: w.start, $lte: w.end } },
      { projection: { lead_id: 1, channel: 1, decision_reason: 1, rule: 1, at: 1 } }).sort({ at: 1, _id: 1 }).toArray();
      const pass = await passingLeads(args, docs.map((d) => String(d.lead_id || '')));
      if (pass) docs = docs.filter((d) => pass.has(String(d.lead_id)));
      return { rows: docs.map((d) => ({ id: String(d._id), check_id: String(d._id),
        lead_id: d.lead_id ? String(d.lead_id) : '', channel: d.channel || '', reason: d.decision_reason || '',
        rule: d.rule || '', at: localDateTime(d.at, w.tz), _day: localDay(d.at, w.tz),
        _g: { reason: d.rule || d.decision_reason || 'unknown' } })) };
    },
  },
  {
    id: 'dq.campaign_blocked', label: 'Campaign texts blocked', dashboard: D, grain: 'campaign_recipient',
    kind: KIND.COUNT, dateBasis: 'CampaignLead.updatedAt', numerator: 'Campaign recipients blocked by the send check, '
      + 'last updated in the range.', denominator: null, inclusions: 'CampaignLead.status blocked.',
    exclusions: 'Held texts (sent later).', source: ['campaignleads'], filters: [], breakdowns: ['reason'],
    columns: [['recipient_id', 'Recipient'], ['campaign_id', 'Campaign'], ['lead_id', 'Lead ID'],
      ['reason', 'Reason'], ['updated_at', 'When']],
    evaluate: async (args) => {
      const w = await windowFor(args);
      const docs = await collection('campaignleads').find({ dealer_id: { $in: dealerForms(args.dealerId) },
        status: 'blocked', updatedAt: { $gte: w.start, $lte: w.end } },
      { projection: { campaign_id: 1, lead_id: 1, block_reason: 1, updatedAt: 1 } })
        .sort({ updatedAt: 1, _id: 1 }).toArray();
      return { rows: docs.map((d) => ({ id: String(d._id), recipient_id: String(d._id),
        campaign_id: d.campaign_id ? String(d.campaign_id) : '', lead_id: d.lead_id ? String(d.lead_id) : '',
        reason: d.block_reason || '', updated_at: localDateTime(d.updatedAt, w.tz), _day: localDay(d.updatedAt, w.tz),
        _g: { reason: d.block_reason || 'unknown' } })) };
    },
  },
  {
    id: 'dq.duplicate_bookings', label: 'Duplicate appointments', dashboard: D, grain: 'booking', kind: KIND.COUNT,
    dateBasis: 'Booking.createdAt', numerator: 'Bookings set in the range that duplicate another active booking of '
      + 'the same lead, day and time (left out of every appointment count).', denominator: null,
    inclusions: 'Not cancelled.', exclusions: 'The kept booking (lowest id).', source: ['bookings'],
    filters: ['source', 'lead_source', 'assigned_to', 'actor', 'appointment_type'], columns: [...BOOKING_COLUMNS,
      ['duplicate_of', 'Duplicate of']],
    evaluate: async (args, ctx) => {
      const report = await attribution(args, ctx, 'created');
      const dups = report.excluded.duplicates;
      const rows = await bookingRows(dups.map((d) => ({ booking_id: d.booking_id, lead_id: d.lead_id,
        category: 'unknown', created_at: d.created_at, booking_date: d.booking_date, booking_time: d.booking_time })),
      args, ctx);
      const of = new Map(dups.map((d) => [d.booking_id, d.duplicate_of]));
      return { rows: rows.map((r) => ({ ...r, made_by: '', duplicate_of: of.get(r.id) })) };
    },
  },
  notYet(STATE.NEEDS_DATA, {
    id: 'dq.consent_audit', label: 'Texts without SMS consent', dashboard: D, grain: 'customer',
    dateBasis: 'emails.timestamp', numerator: 'Customers sent texts whose phone has no sms_opt_in.', denominator: null,
    exclusions: 'n/a', source: ['emails', 'customers'],
    reason: 'The consent rule comes with Deliverable L (DNC / consent); not defined yet.',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'dq.ai_service_errors', label: 'AI service errors', dashboard: D, grain: 'ai_turn',
    dateBasis: 'ai_turn_log.created_at', numerator: 'AI turns that errored, and the last successful turn.',
    denominator: null, exclusions: 'n/a', source: ['ai_turn_log'],
    reason: 'Kept by the AI service (/v1/metrics, /api/ai/system-status); not read by the CRM reports yet.',
  }),
  notYet(STATE.BLOCKED, {
    id: 'dq.dnc', label: 'DNC / reassigned numbers', dashboard: D, grain: 'phone', dateBasis: 'check time',
    numerator: 'Numbers on the DNC list or reassigned.', denominator: null, exclusions: 'n/a', source: [],
    reason: 'Deliverable L (DNC / reassigned-number checks) is not built (Priority 5).',
  }),
];
