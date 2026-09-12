import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('./', import.meta.url);
const workflow = JSON.parse(await readFile(new URL('./SMS - 01 Normalize + Resolve.json', base), 'utf8'));
const node = name => workflow.nodes.find(candidate => candidate.name === name);
const code = name => node(name).parameters.jsCode;
const builderByMongo = {
  'Resolve Dealer': 'Build Dealer Query',
  'Load Phone-pair Conversation': 'Build Conversation Query',
  'Resolve Customer': 'Build Customer Query',
  'Resolve Lead': 'Build Lead Query'
};
const query = (name, json) => {
  const prepared = builderByMongo[name] ? run(builderByMongo[name], { json }) : json;
  const expression = node(name).parameters.query.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return JSON.parse(new Function('$json', 'return (' + expression + ');')(prepared));
};
const run = (name, { json = {}, nodes = {}, input = [], items = {} } = {}) =>
  new Function('$json', '$node', '$input', '$items', code(name))(
    json,
    nodes,
    { all: () => input.map(value => ({ json: value })) },
    source => (items[source] ?? []).map(value => ({ json: value }))
  )[0].json;

const ids = {
  claimedDealer: '6a8f54debb10964e1ea194ac',
  otherDealer: '7b8f54debb10964e1ea194ad',
  customer: '8c8f54debb10964e1ea194ae',
  otherCustomer: '9d8f54debb10964e1ea194af',
  lead: 'ae8f54debb10964e1ea194b0',
  otherLead: 'bf8f54debb10964e1ea194b1'
};
const raw = ({
  sender = '+15853093700',
  recipient = '+13476585466',
  message_id = 'SMb9a0a9d8f32432c1ba3a8bd37237b281',
  date = '2026-09-04T13:41:28.528Z',
  parent_conversation = null,
  dealer_id = ids.claimedDealer,
  content = 'What about a BMW 5 Series',
  attachments = []
} = {}) => ({ body: { currentMessage: {
  message_id, parent_conversation, sender, recipient, dealer_id, date, content, attachments
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
const clone = value => JSON.parse(JSON.stringify(value));

const weeklyAvailability = {
  monday: { active: true, start: '09:00', end: '17:00' },
  tuesday: { active: false, start: '', end: '' }
};
const dealer = {
  _id: ids.claimedDealer,
  name: 'Dealer Name Fallback',
  dealer_account_information: {
    ai_bot_name: 'Ava',
    store_name: 'AutoPulse BMW',
    sms_conversion_phone: '+13476585466',
    store_address: '100 Main Street',
    store_website: 'https://dealer.example',
    general_manager: 'Jordan Manager',
    weekly_availability: weeklyAvailability,
    time_zone: 'America/New_York',
    trade_in_appraisal_url: 'https://dealer.example/trade',
    credit_finance_application_url: 'https://dealer.example/finance'
  }
};
const otherDealer = { _id: ids.otherDealer, dealer_account_information: { sms_conversion_phone: '+13476585466' } };
const exactCustomer = { _id: ids.customer, dealer_id: dealer._id, name: 'Existing Customer', phones: [{ value: '+15853093700', is_primary: true }], emails: [] };
const digitsCustomer = { ...exactCustomer, _id: ids.otherCustomer, phones: [{ value: '15853093700', is_primary: true }] };
const lead = { _id: ids.lead, dealer_id: dealer._id, customer_id: ids.customer, phone: '+15853093700' };

const normalized = normalize();
assert.equal(normalized.context.resolution.valid_input, true);
assert.equal(normalized.context.resolution.valid, false);
assert.equal(normalized.context.resolution.normalized_sender_phone, '5853093700');
assert.equal(normalized.context.resolution.phone_quality.sender.category, 'NANP_E164');
assert.equal(normalize({ sender: '15853093700' }).context.resolution.phone_quality.sender.category, 'NANP_11_DIGIT');
assert.equal(normalize({ sender: '5853093700' }).context.resolution.phone_quality.sender.category, 'NANP_10_DIGIT');
assert.equal(normalize({ sender: '(585) 309-3700' }).context.resolution.phone_quality.sender.category, 'NANP_FORMATTED');

for (const [overrides, expectedError] of [
  [{ sender: null }, 'MISSING_SENDER'],
  [{ recipient: null }, 'MISSING_RECIPIENT'],
  [{ message_id: null }, 'MISSING_MESSAGE_ID'],
  [{ content: '', attachments: [] }, 'EMPTY_MESSAGE']
]) {
  const invalid = normalize(overrides);
  assert.equal(invalid.context.resolution.valid_input, false);
  assert.equal(invalid.context.resolution.valid, false);
  assert.ok(invalid.context.resolution.errors.includes(expectedError));
}
const shortPhone = normalize({ sender: '12345' });
assert.equal(shortPhone.context.resolution.phone_quality.sender.category, 'MALFORMED_TOO_SHORT');
assert.equal(shortPhone.context.resolution.valid_input, false);
assert.ok(shortPhone.context.resolution.warnings.includes('INVALID_PHONE_SENDER'));
const international = normalize({ sender: '+442079460123' });
assert.equal(international.context.resolution.phone_quality.sender.category, 'UNSUPPORTED_INTERNATIONAL');
assert.equal(international.context.resolution.normalized_sender_phone, null);
assert.equal(international.context.resolution.valid_input, false);
assert.ok(international.context.resolution.warnings.includes('UNSUPPORTED_PHONE_FORMAT_SENDER'));

assert.equal(workflow.connections['Normalize Input'].main[0][0].node, 'Input Is Valid');
assert.equal(workflow.connections['Input Is Valid'].main[0][0].node, 'Build Dealer Query');
assert.equal(workflow.connections['Input Is Valid'].main[1][0].node, 'Normalized Resolved Envelope');
assert.equal(workflow.connections['Build Dealer Query'].main[0][0].node, 'Resolve Dealer');
assert.equal(workflow.connections['Dealer Is Resolved'].main[0][0].node, 'Build Conversation Query');
assert.equal(workflow.connections['Build Conversation Query'].main[0][0].node, 'Load Phone-pair Conversation');
assert.equal(workflow.connections['Resolve Conversation'].main[0][0].node, 'Build Customer Query');
assert.equal(workflow.connections['Build Customer Query'].main[0][0].node, 'Resolve Customer');
assert.equal(workflow.connections['Assemble Customer Resolution'].main[0][0].node, 'Build Lead Query');
assert.equal(workflow.connections['Build Lead Query'].main[0][0].node, 'Resolve Lead');
const mongoNames = new Set(workflow.nodes.filter(candidate => candidate.type === 'n8n-nodes-base.mongoDb').map(candidate => candidate.name));
assert.equal(mongoNames.has(workflow.connections['Input Is Valid'].main[1][0].node), false);

const expectedMongoExpressions = {
  'Resolve Dealer': '={{ $json.dealer_query }}',
  'Load Phone-pair Conversation': '={{ $json.conversation_query }}',
  'Resolve Customer': '={{ $json.customer_query }}',
  'Resolve Lead': '={{ $json.lead_query }}'
};
for (const [mongoName, expectedExpression] of Object.entries(expectedMongoExpressions)) {
  assert.equal(node(mongoName).parameters.query, expectedExpression);
  assert.doesNotMatch(node(mongoName).parameters.query, /\(\(\)=>|JSON\.stringify|\bconst\b|\breturn\b/);
  assert.doesNotMatch(code(builderByMongo[mongoName]), /structuredClone/);
}

const dealerQuery = query('Resolve Dealer', normalized);
const claimedClause = dealerQuery.$or.find(clause => clause.$expr);
const phoneClause = dealerQuery.$or.find(clause => clause['dealer_account_information.sms_conversion_phone']);
assert.deepEqual(claimedClause, { $expr: { $eq: [{ $toString: '$_id' }, ids.claimedDealer] } });
assert.ok(phoneClause);
assert.equal(dealerQuery.$or.length, 2);
assert.equal(JSON.stringify(dealerQuery).includes('$oid'), false);
assert.equal(new RegExp(
  phoneClause['dealer_account_information.sms_conversion_phone'].$regex,
  phoneClause['dealer_account_information.sms_conversion_phone'].$options
).test('+1 (347) 658-5466'), true);
assert.equal(Object.hasOwn(node('Resolve Dealer').parameters.options, 'limit'), false);

const validClaim = validateDealer(normalized, [dealer]);
assert.equal(validClaim.identity.dealer_id, ids.claimedDealer);
assert.equal(validClaim.context.resolution.dealer_resolution_source, 'CLAIMED_DEALER_ID');
assert.equal(validClaim.context.resolution.phone_dealer_match_count, 1);
assert.equal(validClaim.context.resolution.valid, true);
assert.deepEqual(validClaim.context.dealer, {
  id: ids.claimedDealer,
  bot_name: 'Ava',
  store_name: 'AutoPulse BMW',
  store_phone: '+13476585466',
  store_address: '100 Main Street',
  store_website: 'https://dealer.example',
  manager_name: 'Jordan Manager',
  store_hours: weeklyAvailability,
  timezone: 'America/New_York',
  trade_url: 'https://dealer.example/trade',
  finance_url: 'https://dealer.example/finance'
});

const phoneOnly = validateDealer(normalize({ dealer_id: null }), [dealer]);
assert.equal(phoneOnly.identity.dealer_id, ids.claimedDealer);
assert.equal(phoneOnly.context.resolution.dealer_resolution_source, 'RECIPIENT_PHONE');
assert.equal(phoneOnly.context.resolution.valid, true);
const noDealer = validateDealer(normalize({ dealer_id: null }), []);
assert.equal(noDealer.identity.dealer_id, null);
assert.equal(noDealer.context.resolution.valid, false);
assert.ok(noDealer.context.resolution.errors.includes('DEALER_NOT_FOUND'));

const nameFallbackDealer = { ...dealer, dealer_account_information: { ...dealer.dealer_account_information, store_name: null } };
const nameFallback = validateDealer(normalized, [nameFallbackDealer]);
assert.equal(nameFallback.context.dealer.store_name, 'Dealer Name Fallback');

const mismatchEnvelope = normalize();
const claimedDifferentPhone = { ...dealer, dealer_account_information: { sms_conversion_phone: '+12125550100' } };
const mismatch = validateDealer(mismatchEnvelope, [claimedDifferentPhone, otherDealer]);
assert.equal(mismatch.identity.dealer_id, ids.claimedDealer);
assert.equal(mismatch.context.resolution.dealer_resolution_source, 'CLAIMED_DEALER_ID');
assert.equal(mismatch.context.resolution.valid, false);
assert.ok(mismatch.context.resolution.errors.includes('DEALER_ID_PHONE_MISMATCH'));

const invalidClaimEnvelope = normalize({ dealer_id: 'not-an-object-id' });
const invalidClaimQuery = query('Resolve Dealer', invalidClaimEnvelope);
assert.equal(invalidClaimQuery.$or.some(clause => clause.$expr), false);
assert.equal(invalidClaimQuery.$or.some(clause => clause['dealer_account_information.sms_conversion_phone']), true);
const invalidClaimFallback = validateDealer(invalidClaimEnvelope, [dealer]);
assert.equal(invalidClaimFallback.identity.dealer_id, ids.claimedDealer);
assert.equal(invalidClaimFallback.context.resolution.valid, true);
assert.ok(invalidClaimFallback.context.resolution.warnings.includes('INVALID_DEALER_ID_PHONE_FALLBACK'));
const invalidClaimNoFallback = validateDealer(invalidClaimEnvelope, []);
assert.equal(invalidClaimNoFallback.context.resolution.valid, false);
assert.ok(invalidClaimNoFallback.context.resolution.errors.includes('INVALID_DEALER_ID'));

const unclaimed = normalize({ dealer_id: null });
const manyDealers = [dealer, otherDealer, {
  _id: 'cc8f54debb10964e1ea194b2', dealer_account_information: { sms_conversion_phone: '+13476585466' }
}, {
  _id: 'dd8f54debb10964e1ea194b3', dealer_account_information: { sms_conversion_phone: '+13476585466' }
}];
const ambiguousDealer = validateDealer(unclaimed, manyDealers);
assert.equal(ambiguousDealer.context.resolution.phone_dealer_match_count, 4);
assert.equal(ambiguousDealer.context.resolution.ambiguous, true);
assert.ok(ambiguousDealer.context.resolution.errors.includes('AMBIGUOUS_DEALER_PHONE'));

const dealerResolved = validClaim;
const past = { _id: 'email-past', message_id: 'SM-past', parent_conversation: 'root-past', timestamp: '2026-09-04T13:30:00.000Z', lead_id: ids.lead, customer_id: ids.customer };
const future = { _id: 'email-future', message_id: 'SM-future', parent_conversation: 'root-future', timestamp: '2026-09-04T14:10:11.000Z', lead_id: ids.otherLead };
const replay = resolveConversation(dealerResolved, [future, past]);
assert.equal(replay.identity.conversation_id, 'root-past');
assert.equal(replay.identity.lead_id, ids.lead);
assert.equal(replay.identity.customer_id, ids.customer);
assert.equal(replay.context.resolution.future_conversation_record_count, 1);

const explicitEnvelope = validateDealer(normalize({ parent_conversation: 'explicit-root' }), [dealer]);
const explicitQuery = query('Load Phone-pair Conversation', explicitEnvelope);
assert.equal(explicitQuery.dealer_id, ids.claimedDealer);
assert.equal(explicitQuery.$or.some(clause => clause.parent_conversation === 'explicit-root'), true);
assert.equal(JSON.stringify(explicitQuery).includes('sender'), false);
assert.equal(JSON.stringify(explicitQuery).includes('$oid'), false);
const objectIdParentQuery = query('Load Phone-pair Conversation', validateDealer(normalize({ parent_conversation: ids.lead }), [dealer]));
assert.deepEqual(objectIdParentQuery.$or.at(-1), { $expr: { $eq: [{ $toString: '$_id' }, ids.lead] } });
const explicit = resolveConversation(explicitEnvelope, [{ ...past, parent_conversation: 'explicit-root' }]);
assert.equal(explicit.identity.parent_message_id, 'explicit-root');
assert.equal(explicit.context.resolution.conversation_query_mode, 'EXPLICIT_THREAD');

const multipleThreads = resolveConversation(dealerResolved, [
  { ...past, timestamp: '2026-09-04T13:20:00.000Z', parent_conversation: 'older-root', lead_id: ids.otherLead },
  { ...past, _id: 'latest', message_id: 'latest', timestamp: '2026-09-04T13:35:00.000Z', parent_conversation: 'latest-root', lead_id: ids.lead }
]);
assert.equal(multipleThreads.identity.conversation_id, 'latest-root');
assert.equal(multipleThreads.identity.lead_id, ids.lead);
assert.equal(multipleThreads.context.resolution.lead_thread_ambiguous, undefined);

const ambiguousThread = resolveConversation(dealerResolved, [
  { ...past, parent_conversation: 'same-root', lead_id: ids.lead },
  { ...past, _id: 'other', message_id: 'other', timestamp: '2026-09-04T13:31:00.000Z', parent_conversation: 'same-root', lead_id: ids.otherLead }
]);
assert.equal(ambiguousThread.identity.lead_id, null);
assert.equal(ambiguousThread.context.resolution.lead_thread_ambiguous, true);
assert.ok(ambiguousThread.context.resolution.warnings.includes('AMBIGUOUS_THREAD_LEAD_ASSOCIATION'));

const oldThreadRows = Array.from({ length: 101 }, (_, index) => ({
  _id: 'row-' + index,
  message_id: 'message-' + index,
  parent_conversation: 'explicit-root',
  timestamp: new Date(Date.parse('2026-09-04T13:00:00.000Z') + index * 1000).toISOString(),
  lead_id: index === 0 ? ids.lead : null
}));
const oldThread = resolveConversation(explicitEnvelope, oldThreadRows);
assert.equal(oldThread.identity.lead_id, ids.lead);
assert.equal(oldThread.context.resolution.conversation_window_truncated, false);

const noPrior = resolveConversation(dealerResolved, []);
assert.equal(noPrior.identity.conversation_id, dealerResolved.event.message_id);
assert.equal(noPrior.context.resolution.thread_resolved, false);

const cappedRows = Array.from({ length: 500 }, (_, index) => ({
  _id: 'cap-' + index,
  message_id: 'cap-message-' + index,
  parent_conversation: 'cap-root-' + index,
  timestamp: new Date(Date.parse('2026-09-04T12:00:00.000Z') + index * 1000).toISOString(),
  internal_use: true
}));
const capped = resolveConversation(dealerResolved, cappedRows);
assert.equal(capped.context.resolution.conversation_window_truncated, true);
assert.equal(finish(capped).context.resolution.create_lead, false);
assert.ok(capped.context.resolution.warnings.includes('CONVERSATION_PHONE_FALLBACK_WINDOW_TRUNCATED'));

const exactMatch = resolveCustomer(replay, [exactCustomer]);
assert.equal(exactMatch.identity.customer_id, ids.customer);
assert.equal(exactMatch.context.resolution.customer_resolution_candidate_count, 1);
const customerFilter = query('Resolve Customer', replay);
assert.deepEqual(customerFilter, { dealer_id: ids.claimedDealer, $expr: { $eq: [{ $toString: '$_id' }, ids.customer] } });
assert.equal(JSON.stringify(customerFilter).includes('$oid'), false);
const phoneCustomerFilter = query('Resolve Customer', noPrior);
assert.equal(phoneCustomerFilter.dealer_id, ids.claimedDealer);
assert.ok(phoneCustomerFilter['phones.value'].$regex);
const ambiguousCustomer = resolveCustomer(noPrior, [exactCustomer, digitsCustomer]);
assert.equal(ambiguousCustomer.identity.customer_id, null);
assert.equal(ambiguousCustomer.context.resolution.customer_ambiguous, true);
const noCustomer = resolveCustomer(noPrior, []);
assert.equal(noCustomer.identity.customer_id, null);
assert.equal(noCustomer.context.resolution.customer_resolution_candidate_count, 0);

const withLead = finish(resolveLead(exactMatch, [lead], [exactCustomer]));
assert.equal(withLead.identity.lead_id, ids.lead);
assert.equal(withLead.context.resolution.create_lead, false);
assert.equal(withLead.context.resolution.update_lead, true);
const directLeadFilter = query('Resolve Lead', exactMatch);
assert.deepEqual(directLeadFilter, { dealer_id: ids.claimedDealer, $expr: { $eq: [{ $toString: '$_id' }, ids.lead] } });
assert.equal(JSON.stringify(directLeadFilter).includes('$oid'), false);
const customerLeadEnvelope = clone(exactMatch);
customerLeadEnvelope.identity.lead_id = null;
const customerLeadFilter = query('Resolve Lead', customerLeadEnvelope);
assert.deepEqual(customerLeadFilter, { dealer_id: ids.claimedDealer, $expr: { $eq: [{ $toString: '$customer_id' }, ids.customer] } });
assert.equal(JSON.stringify(customerLeadFilter).includes('$oid'), false);

const twoPhoneLeads = resolveLead(resolveCustomer(noPrior, []), [
  lead,
  { ...lead, _id: ids.otherLead, customer_id: ids.otherCustomer }
]);
assert.equal(twoPhoneLeads.identity.lead_id, null);
assert.equal(twoPhoneLeads.context.resolution.lead_ambiguous, true);
const phoneLead = resolveLead(noCustomer, [lead]);
assert.equal(phoneLead.identity.lead_id, ids.lead);
assert.equal(phoneLead.context.resolution.lead_resolution_candidate_count, 1);
const brandNew = finish(resolveLead(resolveCustomer(noPrior, []), []));
assert.equal(brandNew.context.resolution.create_lead, true);
assert.equal(brandNew.context.resolution.update_lead, false);
for (const temporary of ['dealer_query', 'conversation_query', 'customer_query', 'lead_query']) {
  assert.equal(Object.hasOwn(brandNew, temporary), false);
}

const validHistorical = normalize({ date: '2020-01-02T03:04:05.000Z' });
assert.equal(validHistorical.event.received_at, '2020-01-02T03:04:05.000Z');
assert.equal(validHistorical.context.resolution.event_time_reliable, true);
for (const date of [null, 'definitely-not-a-date']) {
  const missingOrInvalid = normalize({ date });
  assert.equal(missingOrInvalid.event.received_at, null);
  assert.equal(missingOrInvalid.context.resolution.event_time_reliable, false);
  assert.ok(missingOrInvalid.context.resolution.warnings.includes('INVALID_OR_MISSING_EVENT_RECEIVED_AT'));
}
const unknownAsOf = resolveConversation(validateDealer(normalize({ date: null }), [dealer]), [past]);
assert.equal(unknownAsOf.context.resolution.as_of_conversation_record_count, 0);
assert.equal(unknownAsOf.context.resolution.conversation_resolution_uncertain, true);
assert.ok(unknownAsOf.context.resolution.warnings.includes('CONVERSATION_AS_OF_UNAVAILABLE'));

assert.equal(node('Load Phone-pair Conversation').parameters.collection, 'emails');
const emailModel = await readFile(new URL('../../aidmvcs-be-dev/app/models/Email.js', base), 'utf8');
const smsRoute = await readFile(new URL('../../aidmvcs-be-dev/app/api/system/sms/route.js', base), 'utf8');
assert.match(emailModel, /enum:\s*\['email',\s*'sms','note'\]/);
assert.match(smsRoute, /Email from '@models\/Email';\s*\/\/ This stores both email and SMS/);

assert.deepEqual(JSON.parse(node('Resolve Dealer').parameters.options.sort), { _id: 1 });
assert.deepEqual(JSON.parse(node('Load Phone-pair Conversation').parameters.options.sort), {
  timestamp: -1, date: -1, created_at: -1, createdAt: -1, _id: 1
});
for (const name of ['Load Phone-pair Conversation', 'Resolve Customer', 'Resolve Lead']) {
  assert.match(code(builderByMongo[name]), /dealer_id/);
  assert.ok(node(name).parameters.options.limit > 0);
}
assert.equal(workflow.active, false);

console.log('Normalize + Resolve regression checks passed.');
