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

const envelope = ({ received_at = '2026-09-04T13:41:28.528Z', attachments = [] } = {}) => ({
  schema_version: '8.0', channel: 'sms',
  event: {
    message_id: 'SMb9a0a9d8f32432c1ba3a8bd37237b281',
    content: 'What about a BMW 5 Series', sender: '+15853093700', recipient: '+13476585466',
    ...(received_at === undefined ? {} : { received_at }), attachments
  },
  identity: { dealer_id: '6a8f54debb10964e1ea194ac', customer_id: 'customer-1', lead_id: 'lead-1', parent_message_id: 'root-1' },
  context: { resolution: { warnings: [] }, dealer: {} }, intelligence: {}, inventory: null, decision: {}, response: {}
});

const started = Date.now();
const dealerContext = run('Structure Dealer Context', {
  nodes: { 'Sub-workflow Input': { json: envelope() } }, input: [{ _id: '6a8f54debb10964e1ea194ac', dealer_account_information: {} }]
})[0].json;
assert.equal(dealerContext.context.dealer.timezone, null);
assert.deepEqual(dealerContext.context.dealer.store_hours, []);
assert.equal(dealerContext.context.dealer.store_hours_text, 'No available store hours at the moment.');
assert.ok(Date.parse(dealerContext.context.current_time.iso) >= started);
assert.notEqual(dealerContext.context.current_time.iso, dealerContext.event.received_at);

const history = [
  { _id: 'prior-2', message_id: 'prior-2', communication_type: 'sms', status: 'sent', mail_content: 'Prior second', timestamp: '2026-09-04T13:30:00.000Z' },
  { _id: 'current', message_id: 'SMb9a0a9d8f32432c1ba3a8bd37237b281', communication_type: 'sms', status: 'received', mail_content: 'What about a BMW 5 Series', timestamp: '2026-09-04T13:41:28.528Z' },
  { _id: 'future-1', message_id: 'future-1', communication_type: 'sms', mail_content: 'Sierra 1500', timestamp: '2026-09-04T13:54:00.000Z' },
  { _id: 'future-2', message_id: 'future-2', communication_type: 'sms', mail_content: 'Toyota Camry', timestamp: '2026-09-04T14:10:11.000Z' },
  { _id: 'future-3', message_id: 'future-3', communication_type: 'sms', mail_content: 'Mazda CX-70', timestamp: '2026-09-04T15:02:00.000Z' },
  { _id: 'future-4', message_id: 'future-4', communication_type: 'sms', mail_content: 'Honda Civic', timestamp: '2026-09-04T21:04:00.000Z' },
  { _id: 'future-5', message_id: 'future-5', communication_type: 'sms', mail_content: 'Tuesday scheduling', timestamp: '2026-09-04T21:05:00.000Z' },
  { _id: 'prior-1', message_id: 'prior-1', communication_type: 'sms', status: 'received', mail_content: 'Prior first', date: '2026-09-04T13:00:00.000Z' },
  { _id: 'note-prior', message_id: 'note-prior', communication_type: 'note', note: 'Prior note', timestamp: '2026-09-04T13:20:00.000Z' },
  { _id: 'note-future', message_id: 'note-future', communication_type: 'note', note: 'Future note', timestamp: '2026-09-04T16:00:00.000Z' }
];
const smsContext = run('Structure SMS History and Notes', {
  nodes: { 'Structure Dealer Context': { json: dealerContext } }, input: history
})[0].json;
assert.deepEqual(smsContext.context.sms_history.map(row => row.content), ['Prior first', 'Prior second']);
assert.deepEqual(smsContext.context.lead_notes.map(row => row.text), ['Prior note']);
for (const leaked of ['What about a BMW 5 Series', 'Sierra 1500', 'Toyota Camry', 'Mazda CX-70', 'Honda Civic', 'Tuesday scheduling']) {
  assert.equal(smsContext.context.sms_history.some(row => row.content === leaked), false, `${leaked} leaked into prior SMS history`);
}

const noCutoffDealer = { ...dealerContext, event: { ...dealerContext.event } };
delete noCutoffDealer.event.received_at;
const noCutoff = run('Structure SMS History and Notes', {
  nodes: { 'Structure Dealer Context': { json: noCutoffDealer } }, input: history
})[0].json;
assert.ok(noCutoff.context.resolution.warnings.includes('MISSING_OR_INVALID_EVENT_RECEIVED_AT_NO_HISTORY_CUTOFF'));
assert.ok(noCutoff.context.sms_history.some(row => row.content === 'Toyota Camry'));
assert.equal(noCutoff.context.sms_history.some(row => row.content === 'What about a BMW 5 Series'), false);
const invalidCutoffDealer = { ...dealerContext, event: { ...dealerContext.event, received_at: 'not-a-date' } };
const invalidCutoff = run('Structure SMS History and Notes', {
  nodes: { 'Structure Dealer Context': { json: invalidCutoffDealer } }, input: history
})[0].json;
assert.ok(invalidCutoff.context.resolution.warnings.includes('MISSING_OR_INVALID_EVENT_RECEIVED_AT_NO_HISTORY_CUTOFF'));
assert.ok(invalidCutoff.context.sms_history.some(row => row.content === 'Toyota Camry'));

const emailContext = run('Structure Email History', {
  nodes: { 'Structure SMS History and Notes': { json: smsContext } },
  input: [
    { _id: 'email-future', message_id: 'email-future', status: 'sent', mail_content: 'Future email', timestamp: '2026-09-04T14:00:00.000Z' },
    { _id: 'email-prior-2', message_id: 'email-prior-2', status: 'sent', mail_content: 'Prior email second', timestamp: '2026-09-04T13:15:00.000Z' },
    { _id: 'email-prior-1', message_id: 'email-prior-1', status: 'incoming', mail_content: 'Prior email first', date: '2026-09-04T12:00:00.000Z' }
  ]
})[0].json;
assert.deepEqual(emailContext.context.email_history.map(row => row.content), ['Prior email first', 'Prior email second']);

const memberships = [
  { _id: 'membership-future', campaign_id: 'campaign-future', delivered_at: '2026-09-04T14:30:00.000Z' },
  { _id: 'membership-prior', campaign_id: 'campaign-prior', delivered_at: '2026-09-04T12:30:00.000Z' }
];
const campaignQuery = run('Build Campaign Query', {
  nodes: { 'Structure Email History': { json: emailContext } }, input: memberships
})[0].json;
assert.deepEqual(campaignQuery.campaign_ids, ['campaign-prior']);
const campaignContext = run('Structure Campaign Context', {
  nodes: { 'Structure Email History': { json: emailContext } }, items: { 'Load Campaign Membership': memberships },
  input: [
    { _id: 'campaign-future', name: 'Future campaign', message_content: { body: 'future' } },
    { _id: 'campaign-prior', name: 'Prior campaign', message_content: { body: 'prior' } }
  ]
})[0].json;
assert.equal(campaignContext.context.campaign.id, 'campaign-prior');
assert.equal(campaignContext.context.campaign.sent_at, '2026-09-04T12:30:00.000Z');

const classify = attachments => run('Classify and Flatten Attachments', { json: envelope({ attachments }) }).map(item => item.json);
assert.equal(classify([])[0].route, 'UNSUPPORTED');
assert.equal(classify([{ filename: 'unknown.bin', content_type: 'application/octet-stream' }])[0].route, 'UNSUPPORTED');
assert.equal(classify([{ filename: 'photo.jpg', content_type: 'image/jpeg' }])[0].route, 'IMAGE');
assert.equal(classify([{ filename: 'document.pdf', content_type: 'application/pdf' }])[0].route, 'PDF');
assert.equal(classify([{ filename: 'walkaround.mp4', content_type: 'video/mp4' }])[0].route, 'VIDEO');

const attachmentSwitch = node('Route Attachment Type');
assert.equal(attachmentSwitch.typeVersion, 3.3);
assert.equal(attachmentSwitch.parameters.numberOutputs, 5);
assert.match(attachmentSwitch.parameters.output, /IMAGE:0, TEXT:1, PDF:2, VIDEO:3, UNSUPPORTED:4/);
assert.equal(workflow.connections['Route Attachment Type'].main.length, 5);
assert.equal(workflow.connections['Route Attachment Type'].main[4][0].node, 'Keep Unsupported Attachment');

for (const name of ['Load SMS History', 'Load Email History', 'Load Campaign Membership', 'Load Campaigns']) {
  assert.match(node(name).parameters.query, /dealer_id/, `${name} must remain dealer scoped`);
  assert.ok(node(name).parameters.options.limit > 0);
  assert.doesNotThrow(() => JSON.parse(node(name).parameters.options.sort));
}

const structured = run('Structured Context Envelope', { nodes: {
  'Structure Campaign Context': { json: campaignContext },
  'Aggregate Attachment Insights': { json: { attachments: [], has_attachments: false, warnings: [] } }
} })[0].json;
for (const field of ['dealer', 'current_time', 'sms_history', 'lead_notes', 'email_history', 'campaign', 'campaign_meta', 'attachments', 'attachment_meta', 'precedence']) {
  assert.ok(Object.hasOwn(structured.context, field), `missing context.${field}`);
}

console.log('Context Builder regression checks passed.');
