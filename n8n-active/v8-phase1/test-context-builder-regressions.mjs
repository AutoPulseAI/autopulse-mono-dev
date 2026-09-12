import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = JSON.parse(await readFile(new URL('./SMS - 02 Context Builder.json', import.meta.url), 'utf8'));
const node = name => workflow.nodes.find(candidate => candidate.name === name);
const run = (name, { json = {}, nodes = {}, input = [], items = {} } = {}) =>
  new Function('$json', '$node', '$input', '$items', node(name).parameters.jsCode)(
    json,
    nodes,
    { all: () => input.map(value => ({ json: value })) },
    source => (items[source] ?? []).map(value => ({ json: value }))
  );
const query = (name, json) => {
  const expression = node(name).parameters.query.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return JSON.parse(new Function('$json', 'return (' + expression + ');')(json));
};

const dealerId = '6a8f54debb10964e1ea194ac';
const envelope = ({
  received_at = '2026-09-04T13:41:28.528Z',
  recipient = '+15551234567',
  attachments = [],
  dealer = {}
} = {}) => ({
  schema_version: '8.0',
  channel: 'sms',
  event: {
    message_id: 'SMb9a0a9d8f32432c1ba3a8bd37237b281',
    content: 'What about a BMW 5 Series',
    sender: '+15853093700',
    recipient,
    ...(received_at === undefined ? {} : { received_at }),
    attachments
  },
  identity: { dealer_id: dealerId, customer_id: 'customer-1', lead_id: 'lead-1', parent_message_id: 'root-1' },
  context: {
    resolution: {
      valid: true,
      warnings: [],
      errors: [],
      normalized_sender_phone: '5853093700',
      normalized_recipient_phone: '5551234567'
    },
    dealer
  },
  intelligence: {},
  inventory: null,
  decision: {},
  response: {}
});
const structureDealer = (source, rows) => run('Structure Dealer Context', {
  nodes: { 'Sub-workflow Input': { json: source } },
  input: rows
})[0].json;

const dealerLookup = query('Load Dealer Configuration', envelope());
assert.deepEqual(dealerLookup, { _id: { $oid: dealerId } });
assert.equal(JSON.stringify(dealerLookup).includes('sms_conversion_phone'), false);
assert.equal(node('Load Dealer Configuration').parameters.options.limit, 1);

const configuredDealer = {
  _id: dealerId,
  dealer_account_information: {
    sms_conversion_phone: '(555) 123-4567',
    time_zone: 'America/New_York',
    weekly_availability: {
      monday: { active: true, start: '09:00', end: '17:00' },
      sunday: { active: false, start: '09:00', end: '17:00' }
    },
    store_website: 'https://dealer.example',
    store_address: '1 Main St',
    store_city: 'Rochester',
    store_state: 'NY',
    alternative_contact_number: '+15855550100',
    general_manager: 'Morgan',
    trade_in_appraisal_url: 'https://dealer.example/trade',
    credit_finance_application_url: 'https://dealer.example/finance'
  }
};
const started = Date.now();
const dealerContext = structureDealer(envelope(), [configuredDealer]);
assert.equal(dealerContext.context.dealer.timezone, 'America/New_York');
assert.deepEqual(dealerContext.context.dealer.store_hours, [{ day: 'Monday', start: '09:00', end: '17:00' }]);
assert.equal(dealerContext.context.dealer.store_hours_text, 'Monday: 09:00–17:00');
assert.equal(dealerContext.context.dealer.store_hours_status, 'CONFIGURED');
assert.equal(dealerContext.context.resolution.dealer_configuration_source, 'DATABASE');
assert.equal(dealerContext.context.resolution.dealer_configuration_phone_validated, true);
assert.equal(dealerContext.context.resolution.warnings.includes('DEALER_CONFIGURATION_PHONE_MISMATCH'), false);
assert.ok(Date.parse(dealerContext.context.current_time.iso) >= started);
assert.notEqual(dealerContext.context.current_time.iso, dealerContext.event.received_at);

const mismatchedRecipient = structureDealer(envelope({ recipient: '+15557654321' }), [configuredDealer]);
assert.equal(mismatchedRecipient.context.dealer.timezone, 'America/New_York');
assert.deepEqual(mismatchedRecipient.context.dealer.store_hours, [{ day: 'Monday', start: '09:00', end: '17:00' }]);
assert.ok(mismatchedRecipient.context.resolution.warnings.includes('DEALER_CONFIGURATION_PHONE_MISMATCH'));

const upstreamDealer = {
  bot_name: 'Upstream Bot',
  store_name: 'Upstream Store',
  store_phone: '+15855550111',
  sms_conversion_phone: '+15551234567',
  store_address: 'Upstream Address',
  timezone: 'America/Chicago',
  store_website: 'https://upstream.example',
  manager_name: 'Upstream Manager',
  trade_url: 'https://upstream.example/trade',
  finance_url: 'https://upstream.example/finance',
  booking_url: 'https://upstream.example/book',
  store_hours: [{ day: 'Tuesday', start: '10:00', end: '18:00' }],
  store_hours_text: 'Tuesday: 10:00–18:00'
};
const notFound = structureDealer(envelope({ dealer: upstreamDealer }), []);
assert.ok(notFound.context.resolution.warnings.includes('DEALER_CONFIGURATION_NOT_FOUND'));
assert.equal(notFound.context.resolution.dealer_configuration_source, 'UPSTREAM_FALLBACK');
for (const field of ['store_hours', 'store_hours_text', 'timezone', 'store_website', 'store_address', 'store_phone', 'manager_name', 'trade_url', 'finance_url', 'booking_url', 'sms_conversion_phone']) {
  assert.deepEqual(notFound.context.dealer[field], upstreamDealer[field], 'upstream fallback lost ' + field);
}

const unresolvedUpstream = envelope({ dealer: upstreamDealer });
unresolvedUpstream.identity.dealer_id = null;
unresolvedUpstream.context.resolution.valid = false;
unresolvedUpstream.context.resolution.errors = ['DEALER_NOT_FOUND'];
const unresolvedContext = structureDealer(unresolvedUpstream, []);
assert.deepEqual(unresolvedContext.context.resolution.errors, ['DEALER_NOT_FOUND']);
assert.equal(unresolvedContext.context.resolution.warnings.includes('DEALER_CONFIGURATION_NOT_FOUND'), false);
assert.equal(unresolvedContext.context.resolution.dealer_configuration_source, 'UPSTREAM_ONLY');

const missingTimezone = structureDealer(envelope({ dealer: upstreamDealer }), [{
  _id: dealerId,
  dealer_account_information: { sms_conversion_phone: '+15551234567' }
}]);
assert.equal(missingTimezone.context.dealer.timezone, 'America/Chicago');

const missingHours = structureDealer(envelope({ dealer: upstreamDealer }), [{
  _id: dealerId,
  dealer_account_information: { sms_conversion_phone: '+15551234567', time_zone: 'America/New_York' }
}]);
assert.deepEqual(missingHours.context.dealer.store_hours, upstreamDealer.store_hours);
assert.equal(missingHours.context.dealer.store_hours_text, upstreamDealer.store_hours_text);
assert.equal(missingHours.context.dealer.store_hours_status, 'UPSTREAM_FALLBACK');

const upstreamWeeklyObject = structureDealer(envelope({ dealer: {
  ...upstreamDealer,
  store_hours: {
    monday: { active: true, start: '08:00', end: '16:00' },
    sunday: { active: false, start: '10:00', end: '14:00' }
  }
} }), []);
assert.deepEqual(upstreamWeeklyObject.context.dealer.store_hours, [
  { day: 'Monday', start: '08:00', end: '16:00' }
]);

const upstreamOpenCloseArray = structureDealer(envelope({ dealer: {
  ...upstreamDealer,
  store_hours: [{ day: 'wednesday', open: '11:00', close: '19:00' }]
} }), []);
assert.deepEqual(upstreamOpenCloseArray.context.dealer.store_hours, [
  { day: 'Wednesday', start: '11:00', end: '19:00' }
]);

const malformedUpstreamHours = structureDealer(envelope({ dealer: {
  ...upstreamDealer,
  store_hours: { monday: 'not-a-schedule' },
  store_hours_text: null
} }), []);
assert.deepEqual(malformedUpstreamHours.context.dealer.store_hours, []);
assert.equal(malformedUpstreamHours.context.dealer.store_hours_status, 'UPSTREAM_MALFORMED');
assert.ok(malformedUpstreamHours.context.resolution.warnings.includes('MALFORMED_UPSTREAM_STORE_HOURS'));

const noHoursAnywhere = structureDealer(envelope(), [{
  _id: dealerId,
  dealer_account_information: { sms_conversion_phone: '+15551234567' }
}]);
assert.deepEqual(noHoursAnywhere.context.dealer.store_hours, []);
assert.equal(noHoursAnywhere.context.dealer.store_hours_text, null);
assert.equal(noHoursAnywhere.context.dealer.store_hours_status, 'UNAVAILABLE');
assert.equal(JSON.stringify(noHoursAnywhere).includes('No available store hours at the moment.'), false);

const configuredClosed = structureDealer(envelope({ dealer: upstreamDealer }), [{
  _id: dealerId,
  dealer_account_information: {
    sms_conversion_phone: '+15551234567',
    weekly_availability: { sunday: { active: false, start: '09:00', end: '17:00' } }
  }
}]);
assert.deepEqual(configuredClosed.context.dealer.store_hours, []);
assert.equal(configuredClosed.context.dealer.store_hours_text, null);
assert.equal(configuredClosed.context.dealer.store_hours_status, 'CONFIGURED_NO_ACTIVE_HOURS');

const smsHistoryQuery = query('Load SMS History', dealerContext);
const inboundPhonePair = smsHistoryQuery.$or[0];
const senderPattern = new RegExp(inboundPhonePair.sender.$regex, inboundPhonePair.sender.$options);
const recipientPattern = new RegExp(inboundPhonePair.recipient.$regex, inboundPhonePair.recipient.$options);
for (const value of ['+15853093700', '15853093700', '5853093700', '(585) 309-3700']) {
  assert.equal(senderPattern.test(value), true, 'SMS sender format did not match: ' + value);
}
assert.equal(senderPattern.test('+15853093799'), false);
assert.equal(recipientPattern.test('(555) 123-4567'), true);

const history = [
  { _id: 'prior-2', message_id: 'prior-2', communication_type: 'sms', status: 'sent', mail_content: 'Prior second', timestamp: '2026-09-04T13:30:00.000Z' },
  { _id: 'current', message_id: 'SMb9a0a9d8f32432c1ba3a8bd37237b281', communication_type: 'sms', status: 'received', mail_content: 'What about a BMW 5 Series', timestamp: '2026-09-04T13:41:28.528Z' },
  { _id: 'future-1', message_id: 'future-1', communication_type: 'sms', mail_content: 'Future SMS', timestamp: '2026-09-04T14:00:00.000Z' },
  { _id: 'prior-1', message_id: 'prior-1', communication_type: 'sms', status: 'received', mail_content: 'Prior first', date: '2026-09-04T13:00:00.000Z' },
  { _id: 'null-id', message_id: null, communication_type: 'sms', status: 'received', mail_content: 'Null ID retained', timestamp: '2026-09-04T13:05:00.000Z' },
  { _id: 'missing-id', communication_type: 'sms', status: 'received', mail_content: 'Missing ID retained', timestamp: '2026-09-04T13:06:00.000Z' },
  { _id: 'empty-id', message_id: '', communication_type: 'sms', status: 'received', mail_content: 'Empty ID retained', timestamp: '2026-09-04T13:07:00.000Z' },
  { _id: 'space-id', message_id: '   ', communication_type: 'sms', status: 'received', mail_content: 'Whitespace ID retained', timestamp: '2026-09-04T13:08:00.000Z' },
  { _id: 'note-prior', message_id: 'note-prior', communication_type: 'note', note: 'Prior note', timestamp: '2026-09-04T13:20:00.000Z' }
];
const smsContext = run('Structure SMS History and Notes', {
  nodes: { 'Structure Dealer Context': { json: dealerContext } },
  input: history
})[0].json;
assert.deepEqual(smsContext.context.sms_history.map(row => row.content), [
  'Prior first', 'Null ID retained', 'Missing ID retained', 'Empty ID retained', 'Whitespace ID retained', 'Prior second'
]);
assert.deepEqual(smsContext.context.lead_notes.map(row => row.text), ['Prior note']);
assert.equal(smsContext.context.sms_history.some(row => row.content === 'Future SMS'), false);
assert.equal(smsContext.context.sms_history.some(row => row.content === 'What about a BMW 5 Series'), false);

const nullCurrentEnvelope = JSON.parse(JSON.stringify(dealerContext));
nullCurrentEnvelope.event.message_id = null;
const nullCurrentHistory = run('Structure SMS History and Notes', {
  nodes: { 'Structure Dealer Context': { json: nullCurrentEnvelope } },
  input: [{ _id: 'historical-null', message_id: null, communication_type: 'sms', mail_content: 'Do not infer duplicate', timestamp: '2026-09-04T13:00:00.000Z' }]
})[0].json;
assert.deepEqual(nullCurrentHistory.context.sms_history.map(row => row.content), ['Do not infer duplicate']);

const noCutoffDealer = JSON.parse(JSON.stringify(dealerContext));
delete noCutoffDealer.event.received_at;
const noCutoff = run('Structure SMS History and Notes', {
  nodes: { 'Structure Dealer Context': { json: noCutoffDealer } },
  input: history
})[0].json;
assert.ok(noCutoff.context.resolution.warnings.includes('MISSING_OR_INVALID_EVENT_RECEIVED_AT_NO_HISTORY_CUTOFF'));
assert.ok(noCutoff.context.sms_history.some(row => row.content === 'Future SMS'));
assert.equal(noCutoff.context.sms_history.some(row => row.content === 'What about a BMW 5 Series'), false);

const emailContext = run('Structure Email History', {
  nodes: { 'Structure SMS History and Notes': { json: smsContext } },
  input: [
    { _id: 'email-future', message_id: 'email-future', status: 'sent', mail_content: 'Future email', timestamp: '2026-09-04T14:00:00.000Z' },
    { _id: 'email-null', message_id: null, status: 'incoming', mail_content: 'Null ID email retained', timestamp: '2026-09-04T12:30:00.000Z' },
    { _id: 'email-prior-2', message_id: 'email-prior-2', status: 'sent', mail_content: 'Prior email second', timestamp: '2026-09-04T13:15:00.000Z' },
    { _id: 'email-prior-1', message_id: 'email-prior-1', status: 'incoming', mail_content: 'Prior email first', date: '2026-09-04T12:00:00.000Z' }
  ]
})[0].json;
assert.deepEqual(emailContext.context.email_history.map(row => row.content), ['Prior email first', 'Null ID email retained', 'Prior email second']);
const emailHistoryQuery = query('Load Email History', smsContext);
assert.equal(emailHistoryQuery.parent_message_id, 'root-1');
assert.equal(Object.hasOwn(emailHistoryQuery, 'sender'), false);
assert.equal(Object.hasOwn(emailHistoryQuery, 'recipient'), false);

const campaignMembershipQuery = query('Load Campaign Membership', dealerContext);
const campaignPhonePattern = new RegExp(campaignMembershipQuery.phone.$regex, campaignMembershipQuery.phone.$options);
for (const value of ['+15853093700', '15853093700', '5853093700', '(585) 309-3700']) {
  assert.equal(campaignPhonePattern.test(value), true, 'campaign phone format did not match: ' + value);
}
assert.equal(campaignPhonePattern.test('+15853093799'), false);
const campaignStatusPattern = new RegExp(campaignMembershipQuery.status.$regex, campaignMembershipQuery.status.$options);
for (const value of ['sent', 'SENT', 'Sent', ' sent ', 'delivered', 'DELIVERED', 'Delivered', ' delivered ']) {
  assert.equal(campaignStatusPattern.test(value), true, 'eligible campaign status did not match: ' + value);
}
for (const value of ['pending', 'failed', 'bounced', '', '   ', null]) {
  assert.equal(campaignStatusPattern.test(String(value ?? '')), false, 'ineligible campaign status matched: ' + value);
}

const memberships = [
  { _id: 'membership-future', campaign_id: 'campaign-future', status: 'delivered', delivered_at: '2026-09-04T14:30:00.000Z' },
  { _id: 'membership-prior-old', campaign_id: 'campaign-old', status: ' SENT ', sent_at: '2026-09-04T11:30:00.000Z' },
  { _id: 'membership-prior', campaign_id: 'campaign-prior', status: 'Delivered', delivered_at: '2026-09-04T12:30:00.000Z' },
  { _id: 'membership-unknown', campaign_id: 'campaign-unknown', status: 'pending', delivered_at: '2026-09-04T12:45:00.000Z' },
  { _id: 'membership-null', campaign_id: 'campaign-null', status: null, delivered_at: '2026-09-04T12:50:00.000Z' }
];
const campaignQuery = run('Build Campaign Query', {
  nodes: { 'Structure Email History': { json: emailContext } },
  input: memberships
})[0].json;
assert.deepEqual(campaignQuery.campaign_ids, ['campaign-prior', 'campaign-old']);
const campaignContext = run('Structure Campaign Context', {
  nodes: { 'Structure Email History': { json: emailContext } },
  items: { 'Load Campaign Membership': memberships },
  input: [
    { _id: 'campaign-future', name: 'Future campaign', message_content: { body: 'future' } },
    { _id: 'campaign-old', name: 'Older campaign', message_content: { body: 'old' } },
    { _id: 'campaign-prior', name: 'Prior campaign', message_content: { body: 'prior' } }
  ]
})[0].json;
assert.equal(campaignContext.context.campaign.id, 'campaign-prior');
assert.equal(campaignContext.context.campaign.sent_at, '2026-09-04T12:30:00.000Z');

const noAttachments = run('Structured Context Envelope', {
  nodes: { 'Structure Campaign Context': { json: { ...campaignContext, event: { ...campaignContext.event, attachments: [] } } } }
})[0].json;
assert.deepEqual(noAttachments.context.attachments, []);
assert.deepEqual(noAttachments.context.attachment_meta, { has_attachments: false, count: 0, processing: 'metadata_only' });

const attachmentMetadata = [
  { filename: 'photo.jpg', content_type: 'image/jpeg', size: 1234, url: 'https://example.invalid/photo.jpg' },
  { filename: 'document.pdf', content_type: 'application/pdf', size: 5678, s3_key: 'uploads/document.pdf' }
];
const withAttachments = run('Structured Context Envelope', {
  nodes: { 'Structure Campaign Context': { json: { ...campaignContext, event: { ...campaignContext.event, attachments: attachmentMetadata } } } }
})[0].json;
assert.deepEqual(withAttachments.context.attachments, attachmentMetadata);
assert.deepEqual(withAttachments.context.attachment_meta, { has_attachments: true, count: 2, processing: 'metadata_only' });

const forbiddenTypes = new Set([
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.executeCommand',
  'n8n-nodes-base.readWriteFile',
  'n8n-nodes-base.switch',
  '@n8n/n8n-nodes-langchain.openAi'
]);
assert.equal(workflow.nodes.some(candidate => forbiddenTypes.has(candidate.type)), false);
const serialized = JSON.stringify(workflow).toLowerCase();
assert.equal(serialized.includes('fingerprint'), false);
for (const forbidden of ['ffmpeg', 'pdftotext', '/tmp/autopulse', 'download image', 'download video', 'download pdf', 'route attachment type', 'analyze image', 'analyze video']) {
  assert.equal(serialized.includes(forbidden), false, 'forbidden processing reference remains: ' + forbidden);
}
assert.equal(workflow.nodes.length, 12);
assert.equal(Object.keys(workflow.connections).length, 11);
assert.equal(workflow.connections['Structure Campaign Context'].main[0][0].node, 'Structured Context Envelope');

for (const name of ['Load SMS History', 'Load Email History', 'Load Campaign Membership', 'Load Campaigns']) {
  assert.match(node(name).parameters.query, /dealer_id/, name + ' must remain dealer scoped');
  assert.ok(node(name).parameters.options.limit > 0);
  assert.doesNotThrow(() => JSON.parse(node(name).parameters.options.sort));
}
for (const field of ['dealer', 'current_time', 'sms_history', 'lead_notes', 'email_history', 'campaign', 'campaign_meta', 'attachments', 'attachment_meta', 'precedence']) {
  assert.ok(Object.hasOwn(withAttachments.context, field), 'missing context.' + field);
}
assert.equal(workflow.active, false);

console.log('Context Builder regression checks passed (15 pure-DB context invariants covered).');
