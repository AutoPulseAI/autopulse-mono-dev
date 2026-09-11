import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = JSON.parse(await readFile(new URL('./SMS - 01 Normalize + Resolve.json', import.meta.url), 'utf8'));
const node = name => workflow.nodes.find(candidate => candidate.name === name);
const code = name => node(name).parameters.jsCode;
const query = (name, json) => {
  const expression = node(name).parameters.query.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return JSON.parse(new Function('$json', `return (${expression});`)(json));
};
const run = (name, { json = {}, nodes = {}, input = [], items = {} } = {}) =>
  new Function('$json', '$node', '$input', '$items', code(name))(
    json,
    nodes,
    { all: () => input.map(value => ({ json: value })) },
    source => (items[source] ?? []).map(value => ({ json: value }))
  )[0].json;

const raw = ({
  sender = '+15853093700', recipient = '+13476585466',
  message_id = 'SMb9a0a9d8f32432c1ba3a8bd37237b281',
  date = '2026-09-04T13:41:28.528Z', parent_conversation = null
} = {}) => ({ body: { currentMessage: {
  message_id, parent_conversation, sender, recipient, dealer_id: '6a8f54debb10964e1ea194ac',
  date, content: 'What about a BMW 5 Series', attachments: []
} } });

const normalize = overrides => run('Normalize Input', { json: raw(overrides) });
const validateDealer = (envelope, dealers) => run('Validate Dealer Resolution', {
  nodes: { 'Normalize Input': { json: envelope } }, input: dealers
});
const resolveConversation = (envelope, records) => run('Resolve Conversation', {
  nodes: { 'Validate Dealer Resolution': { json: envelope } }, input: records
});
const resolveCustomer = (envelope, customers) => run('Assemble Customer Resolution', {
  nodes: { 'Resolve Conversation': { json: envelope } }, input: customers
});
const resolveLead = (envelope, leads, customers = []) => run('Assemble Lead Resolution', {
  nodes: { 'Assemble Customer Resolution': { json: envelope } }, input: leads,
  items: { 'Resolve Customer': customers }
});
const finish = envelope => run('Normalized Resolved Envelope', { json: envelope });

const dealer = { _id: '6a8f54debb10964e1ea194ac', dealer_account_information: { sms_conversion_phone: '+13476585466' } };
const exactCustomer = { _id: 'customer-1', dealer_id: dealer._id, name: 'Existing Customer', phones: [{ value: '+15853093700', is_primary: true }], emails: [] };
const digitsCustomer = { ...exactCustomer, _id: 'customer-2', phones: [{ value: '15853093700', is_primary: true }] };

const normalized = normalize();
assert.equal(normalized.context.resolution.normalized_sender_phone, '5853093700');
assert.equal(normalize({ sender: '15853093700' }).context.resolution.normalized_sender_phone, '5853093700');
assert.equal(normalize({ sender: '(585) 309-3700' }).context.resolution.normalized_sender_phone, '5853093700');

const dealerResolved = validateDealer(normalized, [dealer]);
assert.equal(dealerResolved.identity.dealer_id, dealer._id);
const dealerFilter = query('Resolve Dealer', normalized);
assert.equal(new RegExp(
  dealerFilter['dealer_account_information.sms_conversion_phone'].$regex,
  dealerFilter['dealer_account_information.sms_conversion_phone'].$options
).test('+1 (347) 658-5466'), true);
assert.equal(validateDealer(normalized, []).context.resolution.errors.includes('DEALER_NOT_FOUND'), true);
const unclaimed = JSON.parse(JSON.stringify(normalized));
unclaimed.context.resolution.claimed_dealer_id = null;
const ambiguousDealer = validateDealer(unclaimed, [dealer, { ...dealer, _id: 'dealer-2' }]);
assert.equal(ambiguousDealer.context.resolution.ambiguous, true);
assert.equal(ambiguousDealer.context.resolution.errors.includes('AMBIGUOUS_DEALER_PHONE'), true);

const past = { _id: 'email-past', message_id: 'SM-past', parent_message_id: 'root-past', timestamp: '2026-09-04T13:30:00.000Z', lead_id: 'lead-1' };
const future = { _id: 'email-future', message_id: 'SM4b3426c3858e000805f5b5fd3278a99f', timestamp: '2026-09-04T14:10:11.000Z' };
const replay = resolveConversation(dealerResolved, [future, past]);
assert.equal(replay.identity.conversation_id, 'root-past');
assert.notEqual(replay.identity.conversation_id, future.message_id);
assert.equal(replay.context.resolution.future_conversation_record_count, 1);

const explicitEnvelope = validateDealer(normalize({ parent_conversation: 'explicit-root' }), [dealer]);
const explicit = resolveConversation(explicitEnvelope, [{ ...past, parent_message_id: 'explicit-root' }]);
assert.equal(explicit.identity.parent_message_id, 'explicit-root');

const currentOnly = resolveConversation(dealerResolved, [{ ...past }, {
  _id: 'current', message_id: normalized.event.message_id, timestamp: normalized.event.received_at
}]);
assert.equal(currentOnly.identity.parent_message_id, 'root-past');
assert.equal(currentOnly.context.resolution.as_of_conversation_record_count, 1);

const exactMatch = resolveCustomer(replay, [exactCustomer]);
assert.equal(exactMatch.identity.customer_id, 'customer-1');
assert.equal(exactMatch.context.resolution.customer_match_count, 1);
assert.equal(resolveCustomer(replay, [digitsCustomer]).identity.customer_id, 'customer-2');
const customerFilter = query('Resolve Customer', replay);
assert.equal(customerFilter.dealer_id, dealer._id);
const customerPhone = customerFilter['phones.value'];
const customerPhoneRegex = new RegExp(customerPhone.$regex, customerPhone.$options);
for (const stored of ['+15853093700', '15853093700', '(585) 309-3700']) {
  assert.equal(customerPhoneRegex.test(stored), true, `customer filter should match ${stored}`);
}
const noCustomer = resolveCustomer(replay, []);
assert.equal(noCustomer.identity.customer_id, null);
assert.equal(noCustomer.context.resolution.customer_match_count, 0);
const ambiguousCustomer = resolveCustomer(replay, [exactCustomer, digitsCustomer]);
assert.equal(ambiguousCustomer.identity.customer_id, null);
assert.equal(ambiguousCustomer.context.resolution.customer_ambiguous, true);
assert.equal(ambiguousCustomer.context.resolution.warnings.includes('AMBIGUOUS_CUSTOMER_PHONE'), true);

const lead = { _id: 'lead-1', dealer_id: dealer._id, customer_id: 'customer-1', phone: '+15853093700' };
const withLead = finish(resolveLead(exactMatch, [lead], [exactCustomer]));
assert.equal(withLead.identity.lead_id, 'lead-1');
assert.equal(withLead.identity.customer_id, 'customer-1');
assert.equal(withLead.context.resolution.lead_match_count, 1);
assert.equal(withLead.context.resolution.create_lead, false);
assert.equal(withLead.context.resolution.update_lead, true);

const noLeadForCustomer = finish(resolveLead(exactMatch, [], [exactCustomer]));
assert.equal(noLeadForCustomer.context.resolution.create_lead, false);
assert.equal(noLeadForCustomer.context.resolution.update_lead, false);
const brandNewConversation = resolveConversation(dealerResolved, []);
const brandNew = finish(resolveLead(resolveCustomer(brandNewConversation, []), []));
assert.equal(brandNew.context.resolution.create_lead, true);
assert.equal(brandNew.context.resolution.update_lead, false);

assert.deepEqual(JSON.parse(node('Resolve Dealer').parameters.options.sort), { _id: 1 });
assert.deepEqual(JSON.parse(node('Load Phone-pair Conversation').parameters.options.sort), {
  timestamp: -1, date: -1, created_at: -1, createdAt: -1, _id: 1
});
for (const name of ['Load Phone-pair Conversation', 'Resolve Customer', 'Resolve Lead']) {
  assert.match(node(name).parameters.query, /dealer_id/);
  assert.ok(node(name).parameters.options.limit > 0);
}
assert.match(node('Resolve Customer').parameters.query, /phones\.value/);
assert.match(node('Resolve Lead').parameters.query, /customer_id/);

console.log('Normalize + Resolve regression checks passed.');
