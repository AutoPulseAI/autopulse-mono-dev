// The reporting FIELD dictionary (SOW 3 Deliverable A, G-001: "field name, entity, type, source, source-of-truth,
// transformation, null handling, refresh cadence, access rules and dashboard usage"). registry.js says how each NUMBER
// is counted; this says where each FIELD those numbers read comes from. One row per field the reports, filters,
// drill-downs, exports or the daily email read. Pure data (no database), so the Definitions page, its CSV and scripts
// share it. Written 23 Nov 2026 from the code on main; a field a report starts reading is added here in the same change.
//
// Columns
//   entity      the record the field lives on (collection), and its grain - customer, lead (= opportunity),
//               appointment, vehicle, message, ... A number counts one grain only (registry.js `grain`), so a join
//               never inflates a count.
//   source      who writes the field (screen, provider, worker, the AI)
//   truth       which source wins when two disagree (Appendix B "source authority is field-specific")
//   transform   what reports do to the stored value before counting / grouping
//   nulls       what a missing value means in a report
//   refresh     when the stored value changes (reports themselves read live on every request; the daily email reads
//               the same rules once a day)
//   access      who can see it in reports
//   usedBy      the reports / filters / numbers that read it

export const ENTITIES = Object.freeze({
  store: 'Store (dealership)',
  staff: 'Staff user',
  customer: 'Customer (PulseLoop360 profile)',
  vehicle: 'Vehicle',
  lead: 'Lead / opportunity',
  appointment: 'Appointment',
  message: 'Message (text, email, note)',
  activity: 'Activity log',
  consent: 'Consent',
  ai: 'AI lead state',
  desk: 'Desk Log visit',
  trade: 'Trade-in',
  sale: 'DMS sale (DealerVault SL)',
  service: 'DMS service (DealerVault SV / SV_APPT)',
  import: 'DMS import batch',
  campaign: 'Campaign',
});

const REPORTS_ACCESS = 'Super admin (incl. "login as" a dealer) while the Reports flag is admin-only; the dealer\'s own staff once switched on. Always scoped to one dealer.';
const DEALER_ONLY = 'Scoped to the dealer that owns the record (dealer_id); never shown across dealers.';
const LIVE = 'Live: written when the event happens; reports read it on each request.';
const DMS_DAILY = 'Daily: DealerVault files are copied at 13:00 UTC (sync.py on the CRM server), then imported by the worker within minutes.';

const F = (entity, field, type, o) => ({ entity, field, type, access: REPORTS_ACCESS, refresh: LIVE, ...o });

export const FIELDS = Object.freeze([
  // ---- store -----------------------------------------------------------------------------------------------------
  F('store', 'users._id (type dealer) / every record\'s dealer_id', 'ObjectId / string', {
    collection: 'users',
    source: 'Created by super admin (Admin > Dealers).',
    truth: 'AutoPulse.',
    transform: 'Every report query is filtered on dealer_id = the store picked; dealer_id is a string on leads and bookings.',
    nulls: 'A record without dealer_id is never counted.',
    refresh: 'On setup.',
    access: DEALER_ONLY,
    usedBy: 'Every report (store scope).',
  }),
  F('store', 'users.dealer_account_information.time_zone', 'string (IANA)', {
    collection: 'users',
    source: 'Dealer settings.',
    truth: 'AutoPulse (dealer settings).',
    transform: 'All date ranges are dealer-local calendar days (reporting/time.js); exports show UTC and dealer time.',
    nulls: 'Missing = America/New_York.',
    refresh: 'When the dealer changes it.',
    usedBy: 'Every dated number, filter and export.',
  }),
  F('store', 'users.dv_dealer_id', 'string', {
    collection: 'users',
    source: 'Super admin (Admin > DMS feed: link a DealerVault store).',
    truth: 'AutoPulse (the link); DealerVault (the id).',
    transform: 'Maps each DealerVault file (DVDxxxxx_...) to the store. No guessed or default store.',
    nulls: 'Not linked = no DMS sales, gross, repair orders or service appointments for that store; reports say so.',
    refresh: 'On link.',
    usedBy: 'Sales & profit, Service, gross per source, Data health > DealerVault import errors.',
  }),

  // ---- staff -----------------------------------------------------------------------------------------------------
  F('staff', 'users._id / name (type staff, parent_id = dealer)', 'ObjectId / string', {
    collection: 'users',
    source: 'Dealer settings > Users.',
    truth: 'AutoPulse.',
    transform: 'Shown by name; a removed user shows as "Unknown user".',
    nulls: 'No owner = "Unassigned".',
    refresh: 'When a user is added or renamed.',
    usedBy: 'Staff filter, AI & staff report, BDC numbers.',
  }),
  F('staff', 'users.departments', 'string[] sales|service|parts', {
    collection: 'users',
    source: 'Dealer settings > Users.',
    truth: 'AutoPulse.',
    transform: 'Decides who is emailed when a lead moves department; not a report filter itself.',
    nulls: 'Missing = sales.',
    refresh: 'When edited.',
    usedBy: 'Department routing; Desk Log people pickers.',
  }),

  // ---- customer --------------------------------------------------------------------------------------------------
  F('customer', 'customers._id', 'ObjectId', {
    collection: 'customers',
    source: 'Created by the lead worker (customerResolver.js), staff (Add customer, Desk Log check-in) or the DMS import.',
    truth: 'AutoPulse. A merged customer points to the one it was merged into (merged_into).',
    transform: 'Customer-grain numbers count distinct customers; merged customers are counted once (the survivor).',
    nulls: 'A lead without customer_id is listed in Data health > Leads without a customer.',
    usedBy: 'Customer-grain numbers, Data health, drill-downs to the profile.',
  }),
  F('customer', 'customers.name / first_name / last_name', 'string', {
    collection: 'customers',
    source: 'Lead (ADF name parts), DMS (SL buyer), staff edit.',
    truth: 'name_parts_from: staff > dms > adf > guess - a weaker source never overwrites a stronger one (personName.js).',
    transform: 'None (display only).',
    nulls: 'Shown as "No name".',
    usedBy: 'Drill-down lists, CSV exports, daily email lists.',
  }),
  F('customer', 'customers.phones[].value / emails[].value', 'string (phone +1XXXXXXXXXX, email lower case)', {
    collection: 'customers',
    source: 'Lead, staff edit, DMS import (new customers only).',
    truth: 'Staff edits win: a contact staff removed (removed_contacts) is never added back by a lead or import; the DMS never overwrites an existing customer\'s contacts.',
    transform: 'Phones compared on the last 10 digits, emails lower case, for matching leads, deals and duplicates.',
    nulls: 'A customer with neither is listed as "No contact".',
    usedBy: 'Duplicate customers, DMS deal matching (gross per source), consent audit.',
  }),
  F('customer', 'customers.contact_history[]', '{at, by, field, action, from, to}[]', {
    collection: 'customers',
    source: 'Staff edits on the profile (api/customers/[id]/contacts).',
    truth: 'AutoPulse (audit trail).',
    transform: 'None.',
    nulls: 'Empty = never edited by staff.',
    usedBy: 'Customer profile history; reconciliation evidence.',
  }),
  F('customer', 'customers.assignment_history[]', '{assigned_to, assigned_by, assigned_at}[]', {
    collection: 'customers',
    source: 'Reassignment (single or bulk).',
    truth: 'AutoPulse.',
    transform: 'Owner at the time of an event = the last entry on or before the event.',
    nulls: 'Empty = owner never changed since the history started.',
    usedBy: 'Reassignment history on the profile; owner-at-the-time in reports.',
  }),
  F('customer', 'customers.merge_history[].merged_at', 'Date', {
    collection: 'customers',
    source: 'Duplicate review > merge / undo.',
    truth: 'AutoPulse.',
    transform: 'None.',
    nulls: 'No merges.',
    usedBy: 'Data health > Customer merges.',
  }),
  F('customer', 'customers.ownership_overrides[]', '{vin, owns, at, by}[]', {
    collection: 'customers',
    source: 'The customer (the AI\'s ownership check) or staff.',
    truth: 'Customer / staff confirmation wins over any DMS record dated before it (ownership.js, SOW G-085).',
    transform: 'Applied on top of the DMS-derived owner.',
    nulls: 'No override = DMS-derived ownership.',
    usedBy: 'Service: active owned vehicles; Customer 360 Vehicles tab.',
  }),

  // ---- vehicle ---------------------------------------------------------------------------------------------------
  F('vehicle', 'leads.vin / vehicle_year / vehicle_make / vehicle_model', 'string / number', {
    collection: 'leads',
    source: 'Lead provider (ADF), staff edit, inventory pick on the lead card.',
    truth: 'Staff edit > provider.',
    transform: 'VIN upper case; year as a number.',
    nulls: '"Not given".',
    usedBy: 'Desk Log vehicle, deal matching by VIN, lead lists.',
  }),
  F('vehicle', 'ai_vehicle_ownership / ai_service_vehicles', 'documents', {
    collection: 'ai_vehicle_ownership, ai_service_vehicles',
    source: 'The AI service (from DMS sales and repair orders, and customer answers).',
    truth: 'Customer-confirmed ownership > DMS record.',
    transform: 'Counted per vehicle (VIN), not per customer.',
    nulls: 'No row = not a known owned vehicle.',
    refresh: 'Daily after the DMS import; live on a customer answer.',
    usedBy: 'Service report (owned vehicles, service due - waiting for Vehicle Databases).',
  }),

  // ---- lead / opportunity ----------------------------------------------------------------------------------------
  F('lead', 'leads._id', 'ObjectId', {
    collection: 'leads',
    source: 'Lead worker (ADF / portal email), website, CSV import, staff (Add lead, Desk Log walk-in).',
    truth: 'AutoPulse.',
    transform: 'One lead = one opportunity. A repeat lead for the same vehicle joins the open one; a different vehicle is its own lead.',
    nulls: '-',
    usedBy: 'Every lead-grain number.',
  }),
  F('lead', 'leads.createdAt ("Lead Date")', 'Date (UTC)', {
    collection: 'leads',
    source: 'Set when the lead is saved; CSV imports write the original lead date.',
    truth: 'AutoPulse. Never editable on screen.',
    transform: 'Dealer-local day. "Current leads" = createdAt inside the range (Betsy, 10 Nov: sold / set / shown from current leads).',
    nulls: 'Never empty.',
    usedBy: 'Leads received, lead-age cohorts (7+/15+/30+/60+), "from current leads" columns, Lead date filter.',
  }),
  F('lead', 'leads.lead_source', 'string', {
    collection: 'leads',
    source: 'Lead provider (ADF <provider><name>, portal sender), staff, the dealer\'s lead source list.',
    truth: 'Staff edit > provider.',
    transform: 'normalizeProvider(): known aliases merged (e.g. "Cars.com" / "cars.com leads"); "campaign_<name>" = a campaign.',
    nulls: 'Missing = "Unknown" (Data health > Unknown lead source).',
    usedBy: 'Lead sources report (Source), Source filter, every number filtered by source.',
  }),
  F('lead', 'leads.sub_source', 'string', {
    collection: 'leads',
    source: 'Lead provider (ADF provider service / name beyond the provider, adfLeadParser.js), staff on the lead card.',
    truth: 'Staff edit > provider.',
    transform: 'Trimmed text, grouped as written.',
    nulls: '"No Sub-Source".',
    usedBy: 'Lead sources report (Sub-Source rows), campaign tagging by tracking code.',
  }),
  F('lead', 'leads.contact_type ("Up type")', 'internet | phone | walk_in', {
    collection: 'leads',
    source: 'Staff (Add lead, Desk Log, lead card); portal and website leads are Internet.',
    truth: 'Staff edit > how the lead arrived.',
    transform: 'upType(): Internet / Phone / Walk-in; Campaign when the source is a campaign; Not set when staff have not picked one (no "Other").',
    nulls: 'A manual lead nobody typed = "Not set".',
    usedBy: 'Lead sources report (Up Type), Desk Log cards (Internet / Phone Ups / Walk-Ins).',
  }),
  F('lead', 'leads.source', 'string', {
    collection: 'leads',
    source: 'Lead worker / screen: the channel it arrived by (email, sms, csv_import, website, the manual form\'s choice).',
    truth: 'AutoPulse.',
    transform: 'normalizeChannel(); used only when lead_source is empty.',
    nulls: 'Default "email".',
    usedBy: 'Channel filter.',
  }),
  F('lead', 'leads.campaign', 'string', {
    collection: 'leads',
    source: 'Tagged on arrival when sub_source / lead_source equals a campaign\'s tracking code; staff on the lead card.',
    truth: 'Staff > tracking code (campaign_set_by).',
    transform: 'None.',
    nulls: 'No campaign.',
    usedBy: 'Campaign filter, Leads by campaign.',
  }),
  F('lead', 'leads.department', 'sales | service | parts', {
    collection: 'leads',
    source: 'Source name on arrival, the AI\'s reading, a service appointment, Desk Log, staff.',
    truth: 'Staff (department_set_by staff) - automatic moves never undo it.',
    transform: 'None.',
    nulls: 'Missing = sales.',
    usedBy: 'Department filter on every report, Desk Log cards, Dashboard.',
  }),
  F('lead', 'leads.fe_lead_status (CRM status)', 'string', {
    collection: 'leads',
    source: 'Staff (Update Status, Desk Log outcome), the AI (status sync), opt-out handling.',
    truth: 'The latest change wins; each change is logged (activitylogs, status_source).',
    transform: 'normalizeStatus() maps legacy values (Contacted, visited, Sold, Closed Lost ...) to the governed list, then statusGroup() to New / Working / Appointment set / Sold ...',
    nulls: 'Missing = "Unknown / missing" (Data health > Legacy or unknown status).',
    usedBy: 'Status filter, sold / lost / action-required numbers, Desk Log cards, funnel.',
  }),
  F('lead', 'leads.statusChangedAt', 'Date', {
    collection: 'leads',
    source: 'Set with every status change.',
    truth: 'AutoPulse.',
    transform: 'Dealer-local day.',
    nulls: 'Never changed = lead date.',
    usedBy: 'Sold / closed-lost dates where no DMS date exists.',
  }),
  F('lead', 'leads.assigned_to (owner)', 'ObjectId (users)', {
    collection: 'leads',
    source: 'Reassignment (lead card, bulk), Desk Log BDC agent, round-robin.',
    truth: 'AutoPulse; every change since 13 Nov 2026 is logged in activitylogs (action lead_reassigned, from_id / to_id).',
    transform: 'Staff filter: the owner at the time of each event, rebuilt from the reassignment log (reporting/ownerAtTime.js); an event before the lead\'s first logged change is credited to the first "from" owner.',
    nulls: '"Unassigned".',
    usedBy: 'Staff filter, AI & staff report, BDC numbers.',
  }),
  F('lead', 'leads.customer_id', 'ObjectId (customers)', {
    collection: 'leads',
    source: 'customerResolver.js on arrival; merge.',
    truth: 'AutoPulse.',
    transform: 'Links lead-grain numbers to customer-grain ones without a join that multiplies rows.',
    nulls: 'Data health > Leads without a customer.',
    usedBy: 'Drill-downs, duplicates, deal matching.',
  }),

  // ---- appointment -----------------------------------------------------------------------------------------------
  F('appointment', 'bookings.createdAt ("set" date)', 'Date', {
    collection: 'bookings',
    source: 'Booking saved by the AI, staff or the public booking page.',
    truth: 'AutoPulse.',
    transform: 'Dealer-local day. "Appointments set" = created in the range, any lead date (13 Nov meeting).',
    nulls: 'Never empty.',
    usedBy: 'Appointments made / set, attribution, source report "Appts Set".',
  }),
  F('appointment', 'bookings.bookingDate / bookingTime', 'Date / "HH:mm"', {
    collection: 'bookings',
    source: 'Same as above; changed on reschedule (history[]).',
    truth: 'Latest reschedule.',
    transform: 'The appointment day in dealer time.',
    nulls: 'No time = "Time flexible".',
    usedBy: 'Appointments scheduled / upcoming, show rate, Desk Log appointments panel.',
  }),
  F('appointment', 'bookings.created_by', 'ai | staff | customer', {
    collection: 'bookings',
    source: 'Who saved the booking.',
    truth: 'AutoPulse.',
    transform: 'Attribution: ai = AI; staff + an AI message sent before = AI-assisted; staff alone = human-only; missing / customer page = unknown (appointmentAttribution.js).',
    nulls: 'Bookings before ~7 Oct 2026 have none = unknown.',
    usedBy: 'AI vs AI-assisted vs human appointments, daily email, Actor filter.',
  }),
  F('appointment', 'bookings.showed / showed_at / booking_status', 'boolean / Date / pending|confirmed|cancelled|completed', {
    collection: 'bookings',
    source: 'Staff (Appointments page, lead status Visited, Desk Log check-in), cancel by the AI or staff.',
    truth: 'Desk Log check-in / staff mark.',
    transform: 'Shown = showed true (or the lead visited on that appointment); cancelled bookings stay counted as set on the day they were set.',
    nulls: 'Not marked = not shown.',
    usedBy: 'Appointments shown, no-shows, source report "Appts Shown".',
  }),
  F('appointment', 'bookings.appointment_type', 'sales | service', {
    collection: 'bookings',
    source: 'The screen or the AI that booked it.',
    truth: 'AutoPulse.',
    transform: 'None.',
    nulls: 'Missing = sales.',
    usedBy: 'Appointment type filter, Sales / Service split in the daily email.',
  }),

  // ---- messages / activity ---------------------------------------------------------------------------------------
  F('message', 'emails.timestamp / communication_type / status', 'Date / sms|email|note / sent|received|incoming|failed...', {
    collection: 'emails',
    source: 'Every text, email and note (Twilio, SES, staff, the AI).',
    truth: 'Provider delivery events update status.',
    transform: 'Customer message = received / incoming, not a note, not the lead\'s own arrival (is_lead_email, ADF body, lead- id, arrival window) - contactedLeads.js.',
    nulls: '-',
    usedBy: 'Customer replied, reply cohorts by lead age, first response time, failed sends.',
  }),
  F('message', 'emails.ai_generated / message_by', 'boolean / ObjectId (staff)', {
    collection: 'emails',
    source: 'The AI (ai_generated true) or a staff member (message_by).',
    truth: 'AutoPulse.',
    transform: 'AI vs human activity: ai_generated = AI; message_by set = staff; neither and outbound = system / old automation.',
    nulls: 'Neither = not counted as AI or staff.',
    usedBy: 'AI & staff report, AI-assisted attribution, daily email AI wins.',
  }),
  F('activity', 'activitylogs (action, from, to, actor_type, at)', 'documents', {
    collection: 'activitylogs',
    source: 'Status changes, reassignments (lead_reassigned), merges, undo (activityLog.js).',
    truth: 'AutoPulse (append-only; undo writes undone_at, never deletes).',
    transform: 'Status set by the AI vs staff; owner at the time of an event.',
    nulls: 'Changes before the log existed are not in it.',
    usedBy: 'Sold / Closed lost / Action required counts, owner-at-the-time staff filter, history screens.',
  }),

  // ---- consent ---------------------------------------------------------------------------------------------------
  F('consent', 'ai_consent / ai_compliance_log', 'documents', {
    collection: 'ai_consent, ai_compliance_log',
    source: 'Opt-out / opt-in texts and emails (per channel), the compliance engine.',
    truth: 'The customer\'s latest explicit stop / start per channel.',
    transform: 'Per channel (text, email); a text stop never stops email.',
    nulls: 'No row = no stop recorded.',
    usedBy: 'Data health > Opt-outs, Texts without SMS consent, Sends blocked by compliance.',
  }),
  F('consent', 'contacteligibilitydecisions', 'documents', {
    collection: 'contacteligibilitydecisions',
    source: 'Every outbound text / email check (log-only until a dealer is switched to enforce).',
    truth: 'AutoPulse.',
    transform: 'allowed / would block / needs review, with reasons.',
    nulls: '-',
    usedBy: 'Admin > Contact compliance, Data health > DNC.',
  }),

  // ---- AI --------------------------------------------------------------------------------------------------------
  F('ai', 'ai_lead_state.stage / bucket / status_at', 'string / string / Date', {
    collection: 'ai_lead_state',
    source: 'The AI service on every turn (lifecycle.py).',
    truth: 'The AI for its own follow-up state; the CRM status for the lead\'s status.',
    transform: 'aiStageGroup() maps snake_case stages to report groups.',
    nulls: 'No row = the AI never worked this lead.',
    usedBy: 'AI & staff report, Dashboard AI cards, lead journey.',
  }),
  F('ai', 'ai_turn_log / ai_touches / ai_call_tasks', 'documents', {
    collection: 'ai_turn_log, ai_touches, ai_call_tasks',
    source: 'The AI service.',
    truth: 'AutoPulse.',
    transform: 'Touches by dealer-local day; call tasks by status.',
    nulls: '-',
    usedBy: 'AI activity numbers, call task numbers, AI service errors.',
  }),

  // ---- desk log / trade ------------------------------------------------------------------------------------------
  F('desk', 'desklogentries (checked_in_at, stage, outcome, unsold_reason, salesperson_id, sales_manager_id, bdc_agent_id)', 'documents', {
    collection: 'desklogentries',
    source: 'Desk Log (check-in, stage, outcome), Leads / Appointments pages (visit recorded).',
    truth: 'AutoPulse; each change in history[].',
    transform: 'One visit per row; Walk-Ins also count customers already in the CRM checked in with no appointment.',
    nulls: 'No outcome = still open.',
    usedBy: 'Desk Log cards and manager views, Visits in the source report.',
  }),
  F('trade', 'tradeins (vin, miles, trade_acv_amount, trade_offer_amount, value_history, lead_id)', 'documents', {
    collection: 'tradeins',
    source: 'ADF trade-in, staff, appraisal.',
    truth: 'Latest appraisal; every value kept in value_history.',
    transform: 'Per opportunity (lead_id); payoff / lienholder for managers only.',
    nulls: '-',
    usedBy: 'Desk Log trade, forms.',
  }),

  // ---- DMS -------------------------------------------------------------------------------------------------------
  F('sale', 'deals ("Contract Date", "Delivery Date", VIN, buyer phone / email, "Deal Number")', 'text as sent by DealerVault', {
    collection: 'deals',
    source: 'DealerVault SL file (salesWorker.js).',
    truth: 'DMS for completed sales (Appendix B 3).',
    transform: 'Dates parsed in dealer time (YYYYMMDD, MM/DD/YYYY, ISO); matched to the latest lead on or before the deal date by VIN, phone (last 10) or email, within 365 days (dealGross.js).',
    nulls: 'Unmatched deal = "not matched" (no lead source).',
    refresh: DMS_DAILY,
    usedBy: 'Sold (DMS), gross per source, Sales & profit.',
  }),
  F('sale', 'deals ("Front Gross", "Back Gross", "Gross Profit")', 'money as text', {
    collection: 'deals',
    source: 'DealerVault SL file.',
    truth: 'DMS.',
    transform: 'money(): "$1,234.00", "(123.45)" -> numbers; total = front + back, else Gross Profit.',
    nulls: 'Empty = not counted (not 0).',
    refresh: DMS_DAILY,
    access: `${REPORTS_ACCESS} Gross is shown only in reports, never to the customer or the AI.`,
    usedBy: 'Front / Back / Total gross per source and sub-source.',
  }),
  F('service', 'repairorders ("Open Date", "Close Date", VIN, mileage) / serviceappointments ("Appointment Date")', 'text as sent by DealerVault', {
    collection: 'repairorders, serviceappointments',
    source: 'DealerVault SV and SV_APPT files.',
    truth: 'DMS for repair orders and service appointments.',
    transform: 'Repair orders by Close Date (else Open Date); one row per RO / appointment number (upsert, never duplicated).',
    nulls: 'Missing date = left out of dated numbers.',
    refresh: DMS_DAILY,
    usedBy: 'Service report, owned vehicles, service follow-ups.',
  }),
  F('import', 'dealervaultimportbatches (fileName, fileType, status, row outcomes with decision)', 'documents', {
    collection: 'dealervaultimportbatches',
    source: 'The DealerVault worker.',
    truth: 'AutoPulse (audit).',
    transform: 'Per row: ACCEPT / RETAIN / REVIEW / REJECT with a reason (batchProcessor.js).',
    nulls: 'Files imported before 18 Nov 2026 have no decisions ("Not recorded").',
    refresh: DMS_DAILY,
    access: 'Super admin (Admin > DMS feed).',
    usedBy: 'Admin > DMS feed, Data health > DealerVault import errors.',
  }),
  F('customer', 'customer_field_history (field, value, prior_value, decision, reason, source, source_event_date, status)', 'documents', {
    collection: 'customer_field_history',
    source: 'The DealerVault import (name, phones, emails, mileage per VIN), review decisions, the customer\'s own word recorded by staff (disputed / confirmed).',
    truth: 'Per field, by the source precedence in Admin > DMS feed (reconciliation_policies); mileage by the RO / sale date.',
    transform: 'Current mileage of a VIN = its newest ACCEPT row by event date; older readings stay as history (APPEND).',
    nulls: 'No rows = nothing reconciled yet for that customer.',
    refresh: DMS_DAILY,
    access: 'Super admin (Admin > DMS feed > Customer field decisions); the customer\'s own rows to the dealer\'s staff.',
    usedBy: 'Reconciliation evidence (SOW Appendix B 5 and 7).',
  }),
  F('campaign', 'campaignleads / leadsourcelists.campaigns', 'documents', {
    collection: 'campaignleads, leadsourcelists',
    source: 'Campaign sends; Lead sources > Campaigns.',
    truth: 'AutoPulse.',
    transform: 'Blocked texts counted per recipient.',
    nulls: '-',
    usedBy: 'Campaign texts blocked, campaign filter.',
  }),
]);

/** The rows, with their entity's name; stable ids for the CSV. */
export function listFields() {
  return FIELDS.map((f, i) => ({ id: `F-${String(i + 1).padStart(3, '0')}`, entityLabel: ENTITIES[f.entity] || f.entity, ...f }));
}

export const FIELD_COLUMNS = Object.freeze([
  ['id', 'ID'], ['entityLabel', 'Entity'], ['field', 'Field'], ['collection', 'Stored in'], ['type', 'Type'],
  ['source', 'Source'], ['truth', 'Source of truth'], ['transform', 'Transformation'], ['nulls', 'Null handling'],
  ['refresh', 'Refresh'], ['access', 'Access'], ['usedBy', 'Used by'],
]);

// A spreadsheet cell: quoted, and never read as a formula.
const cell = (v) => {
  const s = String(v ?? '');
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export function fieldDictionaryCsv() {
  const rows = listFields();
  return [FIELD_COLUMNS.map(([, h]) => cell(h)).join(','), ...rows.map((r) => FIELD_COLUMNS.map(([k]) => cell(r[k])).join(','))].join('\r\n');
}
