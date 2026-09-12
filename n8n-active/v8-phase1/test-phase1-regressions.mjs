import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('./', import.meta.url);
const loadWorkflow = async name => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const nodeCode = (workflow, name) => workflow.nodes.find(node => node.name === name)?.parameters?.jsCode;
const nodeParam = (workflow, name, key) => workflow.nodes.find(node => node.name === name)?.parameters?.[key];
const executeCode = (code, json, nodes = {}) => new Function('$json', '$node', code)(json, nodes);

const context = await loadWorkflow('SMS - 02 Context Builder.json');
const normalize = await loadWorkflow('SMS - 01 Normalize + Resolve.json');
const intelligence = await loadWorkflow('Sales - 10 Conversation Intelligence.json');
const inventory = await loadWorkflow('Sales - 11 Inventory Resolver.json');
const strategy = await loadWorkflow('Sales - 16 Response Strategy.json');
const generator = await loadWorkflow('SMS - 20 Response Generator.json');
const validator = await loadWorkflow('SMS - 21 Validator + Output Formatter.json');
const parentWorkflow = await loadWorkflow('AutoPulse AI_SMS_Workflow_v8.json');

for (const workflow of [parentWorkflow, normalize, context, intelligence, inventory, strategy, generator, validator]) {
  for (const candidate of workflow.nodes.filter(node => node.type === 'n8n-nodes-base.code')) {
    assert.doesNotMatch(nodeCode(workflow, candidate.name), /\{\s*\$oid\s*:/, `${workflow.name}/${candidate.name} constructs an unsupported $oid query value`);
  }
}

const scopedQueries = [
  [normalize, 'Build Conversation Query', /dealer_id:/],
  [normalize, 'Build Lead Query', /dealer_id:/],
  [normalize, 'Build Customer Query', /dealer_id:/],
  [context, 'Build Dealer Configuration Query', /\$toString:'\$_id'/],
  [context, 'Build SMS History Query', /dealer_id:/],
  [context, 'Build Email History Query', /dealer_id:/],
  [context, 'Build Campaign Membership Query', /dealer_id:/],
  [context, 'Build Campaign Query', /dealer_id:/]
];
for (const [workflow, name, tenantPattern] of scopedQueries) {
  const parameters = workflow.nodes.find(node => node.name === name)?.parameters ?? {};
  const querySource = parameters.jsCode ?? parameters.query ?? '';
  assert.match(querySource, tenantPattern, `${name} must be dealer scoped`);
}
assert.match(nodeCode(inventory, 'Build Safe Inventory Queries'), /dealerId:/);

const envelope = {
  schema_version: '8.0', channel: 'sms',
  event: { content: 'What about financing?', sender: '+15550001001', recipient: '+15550002000', message_id: 'test-1' },
  identity: { dealer_id: 'dealer-1', parent_message_id: 'parent-1' },
  context: {
    resolution: { valid: true, create_lead: false, update_lead: true },
    customer: { name: 'Alex', email: 'alex@example.com', phone: '+15550001001' },
    lead: { name: 'Alex', email: 'alex@example.com', phone: '+15550001001', year: '2022', make: 'Honda', model: 'Civic' },
    sms_history: [], email_history: [], lead_notes: [], attachments: [], dealer: {}
  },
  intelligence: {}, inventory: { status: 'UNKNOWN', required: false, warnings: [] }, decision: {}, response: {}
};

const modelResult = { output: JSON.stringify({
  customer: { name: null, email: null, phone: null }, vehicle: { vin: null, year: null, make: null, model: null },
  communication: { preferred_mode: 'unknown', email_present: false }, dnd: { requested: false },
  escalation: { required: false }, appointment: { signal: 'NONE' }, response_signals: {}, inquiry: {}, journey: {}, language: {}
}) };
const intelligenceResult = executeCode(nodeCode(intelligence, 'Safe Structured Intelligence'), modelResult, {
  'Sub-workflow Input': { json: envelope }
})[0].json;
assert.deepEqual(intelligenceResult.intelligence.vehicle, { vin: null, year: '2022', make: 'Honda', model: 'Civic' });
assert.equal(intelligenceResult.intelligence.customer.name, 'Alex');
assert.equal(intelligenceResult.intelligence.customer.email, 'alex@example.com');

const strategyResult = executeCode(nodeCode(strategy, 'Deterministic Response Strategy'), intelligenceResult)[0].json;
assert.deepEqual(strategyResult.decision.allowed_facts.vehicle, { vin: null, year: '2022', make: 'Honda', model: 'Civic' });

const validate = candidate => executeCode(nodeCode(validator, 'Validate Response'), {
  ...JSON.parse(JSON.stringify(strategyResult)),
  decision: { ...strategyResult.decision, route: 'GENERAL', send_user_response: true, allowed_links: ['https://dealer.example/vdp/123'], max_characters: 300 },
  response: { candidate: { sms_response: candidate } }
})[0].json.response.validated.sms_response;
assert.equal(validate('See https://dealer.example/vdp/123.'), 'See https://dealer.example/vdp/123.');
assert.equal(validate('See https://dealer.example/vdp/123-tracker.'), 'See .');
assert.equal(validate('See https://dealer.example/vdp/123?source=sms.'), 'See .');

const enforceExact = candidate => executeCode(nodeCode(validator, 'Enforce Exact URL Allowlist'), {
  ...JSON.parse(JSON.stringify(strategyResult)),
  decision: { ...strategyResult.decision, allowed_links: ['https://dealer.example/vdp/123'] },
  response: { validated: { sms_response: candidate }, validation: { warnings: [] } }
})[0].json.response.validated.sms_response;
assert.equal(enforceExact('See https://dealer.example/vdp/123.'), 'See https://dealer.example/vdp/123.');
assert.equal(enforceExact('See https://dealer.example/vdp/123-tracker.'), 'See .');
assert.equal(enforceExact('See https://dealer.example/vdp/123?source=sms.'), 'See .');

const formatterCode = nodeCode(validator, 'Format Legacy v7 Output');
assert.doesNotMatch(formatterCode, /member of our dealership team will connect|manager\.\*follow up/);
assert.doesNotMatch(formatterCode, /create === ['\"]true['\"]/);
const formatted = executeCode(formatterCode, {
  ...JSON.parse(JSON.stringify(strategyResult)),
  context: { ...strategyResult.context, sms_history: [{ content: 'A manager will follow up.' }] },
  decision: { ...strategyResult.decision, route: 'GENERAL' }, response: { validated: { sms_response: 'Thanks.' } }
})[0].json;
assert.equal(formatted.fe_lead_status, 'Contacted');

// SMS-01 lead-query precedence: thread lead > explicit inbound parent > resolved customer > phone.
const buildLeadQueryCode = nodeCode(normalize, 'Build Lead Query');
const runBuildLeadQuery = json => JSON.parse(executeCode(buildLeadQueryCode, json)[0].json.lead_query);
const customerId = '6a9078deea61622f3d7a0d71';
const otherCustomerId = '6a9078deea61622f3d7a0d72';
const dealerId = 'dealer-1';
const baseResolution = { thread_resolved: true, normalized_sender_phone: '5550001001' };

// 1. event.parent_message_id=null, identity.parent_message_id inferred, resolved customer exists -> CUSTOMER tier used.
const inferredParentOnly = runBuildLeadQuery({
  event: { parent_message_id: null, message_id: 'm1' },
  identity: { dealer_id: dealerId, lead_id: null, customer_id: customerId, parent_message_id: 'SMinferredRoot' },
  context: { resolution: baseResolution }
});
assert.equal(inferredParentOnly.$or, undefined, 'inferred conversation root must not trigger the parent_message_id/parent_conversation lookup');
assert.deepEqual(inferredParentOnly.$expr, { $eq: [{ $toString: '$customer_id' }, customerId.toLowerCase()] });

// 2. explicit event.parent_message_id supplied -> explicit-parent tier wins, using the raw event value (not identity.parent_message_id).
const explicitParent = runBuildLeadQuery({
  event: { parent_message_id: 'SMexplicitParent000', message_id: 'm2' },
  identity: { dealer_id: dealerId, lead_id: null, customer_id: customerId, parent_message_id: 'SMdifferentInferredRoot' },
  context: { resolution: baseResolution }
});
assert.deepEqual(explicitParent.$or, [{ parent_message_id: 'SMexplicitParent000' }, { parent_conversation: 'SMexplicitParent000' }]);

// 3. thread-specific identity.lead_id exists -> thread lead wins over customer/explicit parent.
const threadLeadId = customerId;
const threadLead = runBuildLeadQuery({
  event: { parent_message_id: 'SMexplicitParent000', message_id: 'm3' },
  identity: { dealer_id: dealerId, lead_id: threadLeadId, customer_id: otherCustomerId, parent_message_id: 'SMdifferentInferredRoot' },
  context: { resolution: baseResolution }
});
assert.deepEqual(threadLead.$expr, { $eq: [{ $toString: '$_id' }, threadLeadId.toLowerCase()] });

// 4. inferred identity.parent_message_id alone, even with thread_resolved=false, must not suppress customer lookup.
const inferredNoThread = runBuildLeadQuery({
  event: { parent_message_id: null, message_id: 'm4' },
  identity: { dealer_id: dealerId, lead_id: null, customer_id: customerId, parent_message_id: 'SMinferredRootNoThread' },
  context: { resolution: { ...baseResolution, thread_resolved: false } }
});
assert.deepEqual(inferredNoThread.$expr, { $eq: [{ $toString: '$customer_id' }, customerId.toLowerCase()] });

// 5. multiple customer leads -> latest createdAt selected (then _id desc), not treated as ambiguous.
const assembleLeadResolutionCode = nodeCode(normalize, 'Assemble Lead Resolution');
const runAssembleLeadResolution = (rows, json, customerRows = []) => new Function('$json', '$node', '$input', '$items', assembleLeadResolutionCode)(
  json,
  { 'Assemble Customer Resolution': { json } },
  { all: () => rows.map(row => ({ json: row })) },
  name => (name === 'Resolve Customer' ? customerRows.map(row => ({ json: row })) : [])
)[0].json;
const multipleCustomerLeads = runAssembleLeadResolution(
  [
    { _id: 'lead-old', dealer_id: dealerId, customer_id: customerId, createdAt: '2026-01-01T00:00:00.000Z' },
    { _id: 'lead-new', dealer_id: dealerId, customer_id: customerId, createdAt: '2026-06-01T00:00:00.000Z' }
  ],
  {
    identity: { dealer_id: dealerId, lead_id: null, customer_id: customerId, parent_message_id: 'SMsomeRoot' },
    event: { sender: '+15550001001' },
    context: { resolution: { normalized_sender_phone: '5550001001', lead_thread_ambiguous: false, warnings: [], errors: [] } }
  }
);
assert.equal(multipleCustomerLeads.identity.lead_id, 'lead-new', 'must select the latest createdAt customer lead');
assert.equal(multipleCustomerLeads.context.resolution.lead_ambiguous, false, 'multiple customer-tier leads are not ambiguous');
assert.ok(!multipleCustomerLeads.context.resolution.warnings.includes('AMBIGUOUS_LEAD_MATCH'));

// SMS-20 Response Generator: gpt-5.6-luna model config + availability_unverified wording.
const openAiModelNode = generator.nodes.find(node => node.name === 'OpenAI Chat Model');
assert.equal(openAiModelNode.parameters.model.value, 'gpt-5.6-luna');
assert.equal(openAiModelNode.parameters.model.cachedResultName, 'gpt-5.6-luna');
assert.equal(openAiModelNode.parameters.options.reasoningEffort, 'low');
assert.equal(openAiModelNode.parameters.options.temperature, 1);
assert.equal(openAiModelNode.id, 'b5b41c21-63b4-4df6-9351-b52fc9ea9844', 'OpenAI Chat Model node id must be preserved');
assert.equal(openAiModelNode.credentials.openAiApi.id, '8HDcbDkuFRoCFjGB', 'credentials must be preserved');
assert.equal(generator.active, false, 'workflow must remain inactive');
assert.doesNotMatch(JSON.stringify(generator), /gpt-4o-mini/, 'no remaining gpt-4o-mini reference in SMS-20');

const promptText = nodeParam(generator, 'Generate Approved Wording', 'text');
assert.match(promptText, /availability_unverified: if decision\.allowed_facts\.inventory\.exact_matches has one or more vehicles, mention up to 3/);
assert.match(promptText, /never invent price, availability, features, mileage, or condition/);
assert.match(promptText, /never say the requested vehicle is unavailable/);
assert.match(promptText, /never say "we have" or otherwise imply confirmed availability/);
assert.match(promptText, /exact_vehicle is supplied, acknowledge that one vehicle conservatively/);
assert.match(promptText, /Do not ask which vehicle unless cta_type is clarify_vehicle/);
// Untouched inventory_claim_mode bullets and unrelated prompt sections must survive verbatim.
assert.match(promptText, /confirmed_available: availability may be stated; offer a visit only for offer_visit\./);
assert.match(promptText, /confirmed_unavailable: unavailability may be stated; offer alternatives without inventing any\./);
assert.match(promptText, /Labeled link contract:/);

const generatorCode = nodeCode(generator, 'Safe Generator Output');
const baseAllowedFacts = () => ({
  current_message: 'What about a BMW 5 Series',
  customer: { name: null, email: null, phone: '+15550001001' },
  vehicle: { vin: null, year: null, make: null, model: null },
  inventory: { status: 'UNKNOWN', exact_match_count: 0, exact_matches: [], exact_vehicle: null, alternatives: [], warnings: [] },
  dealer: {}, conversation: {}, appointment: {},
  links: { vdp: null, trade: null, finance: null, booking: null, store_website: null }
});
const commonDecision = { route: 'INVENTORY', cta_type: 'verify_availability', language: 'English', language_code: 'en', tone: 'helpful', response_objective: 'test', send_user_response: true, block_delivery: false, max_characters: 300, allowed_links: [] };
const runGenerator = (decision, modelOutput) => executeCode(
  generatorCode,
  { output: typeof modelOutput === 'string' ? modelOutput : JSON.stringify(modelOutput) },
  { 'Sub-workflow Input': { json: { intelligence: {}, decision } } }
)[0].json;

// Trims are deliberately distinct and non-overlapping substrings of one another so mention-counting below is unambiguous.
const fiveExactMatches = [
  { year: '2024', make: 'BMW', model: '5 Series', trim: '530i' },
  { year: '2023', make: 'BMW', model: '5 Series', trim: '530e' },
  { year: '2022', make: 'BMW', model: '5 Series', trim: 'M550i' },
  { year: '2022', make: 'BMW', model: '5 Series', trim: '540i' },
  { year: '2021', make: 'BMW', model: '5 Series', trim: '545e' }
];

// Test 1: availability_unverified + 5 exact_matches -> mentions 1-3 matches, confirmation wording, no confirmed-availability claim.
const result1 = runGenerator(
  { ...commonDecision, inventory_claim_mode: 'availability_unverified', allowed_facts: { ...baseAllowedFacts(), inventory: { status: 'UNKNOWN', exact_match_count: 5, exact_matches: fiveExactMatches, exact_vehicle: fiveExactMatches[0], alternatives: [], warnings: [] } } },
  { sms_response: 'I found several BMW 5 Series matches, including a 2024 530i, 2023 530e, and 2022 M550i. Live availability still needs confirmation.', email_subject: null, email_body: null, booking_date: null, booking_time: null }
);
const sms1 = result1.response.candidate.sms_response;
assert.ok(sms1, 'expected a generated sms response');
const mentionedCount1 = fiveExactMatches.filter(v => sms1.includes(v.trim)).length;
assert.ok(mentionedCount1 >= 1 && mentionedCount1 <= 3, `expected 1-3 mentioned matches, got ${mentionedCount1}`);
assert.match(sms1, /confirmation|confirm/i);
assert.doesNotMatch(sms1, /\bwe have\b/i);
assert.doesNotMatch(sms1, /\bisn'?t (currently )?available\b/i);

// Test 2: availability_unverified + exact_matches empty + exact_vehicle exists -> uses exact_vehicle, confirmation wording.
const result2 = runGenerator(
  { ...commonDecision, inventory_claim_mode: 'availability_unverified', allowed_facts: { ...baseAllowedFacts(), inventory: { status: 'UNKNOWN', exact_match_count: 0, exact_matches: [], exact_vehicle: { year: '2024', make: 'BMW', model: '5 Series', trim: '530i' }, alternatives: [], warnings: [] } } },
  { sms_response: 'I found a 2024 BMW 5 Series 530i. Live availability still needs confirmation.', email_subject: null, email_body: null, booking_date: null, booking_time: null }
);
const sms2 = result2.response.candidate.sms_response;
assert.match(sms2, /2024/);
assert.match(sms2, /confirmation|confirm/i);
assert.doesNotMatch(sms2, /\bwe have\b/i);

// Test 3: availability_unverified + no exact vehicle data -> conservative fallback (malformed model output forces the code-level fallback).
const result3 = runGenerator(
  { ...commonDecision, inventory_claim_mode: 'availability_unverified', allowed_facts: { ...baseAllowedFacts(), inventory: { status: 'UNKNOWN', exact_match_count: 0, exact_matches: [], exact_vehicle: null, alternatives: [], warnings: ['NO_INVENTORY_KEY'] } } },
  'not valid json at all'
);
assert.equal(result3.response.generation.status, 'fallback');
assert.equal(result3.response.candidate.sms_response, 'Which vehicle are you interested in? Please share the make and model.');

// Test 4: confirmed_available -> existing behavior unchanged.
const result4 = runGenerator(
  { ...commonDecision, inventory_claim_mode: 'confirmed_available', allowed_facts: { ...baseAllowedFacts(), vehicle: { vin: null, year: '2024', make: 'BMW', model: '5 Series' }, inventory: { status: 'EXACT_AVAILABLE', authoritative_availability: true, exact_match_count: 1, exact_matches: [{ year: '2024', make: 'BMW', model: '5 Series', trim: '530i' }], exact_vehicle: { year: '2024', make: 'BMW', model: '5 Series', trim: '530i' }, alternatives: [], warnings: [] } } },
  'malformed'
);
assert.equal(result4.response.candidate.sms_response, 'The 2024 BMW 5 Series is available. Would you like more details?');

// Test 5: confirmed_unavailable -> existing behavior unchanged.
const result5 = runGenerator(
  { ...commonDecision, inventory_claim_mode: 'confirmed_unavailable', allowed_facts: { ...baseAllowedFacts(), vehicle: { vin: null, year: '2024', make: 'BMW', model: '5 Series' }, inventory: { status: 'EXACT_UNAVAILABLE', authoritative_availability: true, exact_match_count: 1, exact_matches: [], exact_vehicle: { year: '2024', make: 'BMW', model: '5 Series', trim: '530i' }, alternatives: [], warnings: [] } } },
  'malformed'
);
assert.equal(result5.response.candidate.sms_response, "The 2024 BMW 5 Series isn't currently available. Would you like help with alternatives?");

// Test 6: alternatives_only -> existing behavior unchanged.
const result6 = runGenerator(
  { ...commonDecision, inventory_claim_mode: 'alternatives_only', allowed_facts: { ...baseAllowedFacts(), inventory: { status: 'ALTERNATIVES', exact_match_count: 0, exact_matches: [], exact_vehicle: null, alternatives: [{ year: '2023', make: 'BMW', model: '5 Series', trim: '530e' }], warnings: [] } } },
  'malformed'
);
assert.equal(result6.response.candidate.sms_response, 'We found similar options. Would you like the details?');

// Test 7: no fabricated inventory facts appear in the prompt's safety constraints (see promptText assertions above) or in code-level fallbacks.
assert.doesNotMatch(result3.response.candidate.sms_response, /\$|price|mileage|available/i, 'conservative fallback must not fabricate inventory facts');

// Test 8: final wording respects decision.max_characters downstream.
const longCandidate = 'I found several BMW 5 Series matches, including a 2024 530i, 2023 530e, and 2022 M550i. Live availability still needs confirmation.';
const result8 = runGenerator(
  { ...commonDecision, inventory_claim_mode: 'availability_unverified', max_characters: 40, allowed_facts: { ...baseAllowedFacts(), inventory: { status: 'UNKNOWN', exact_match_count: 5, exact_matches: fiveExactMatches, exact_vehicle: fiveExactMatches[0], alternatives: [], warnings: [] } } },
  { sms_response: longCandidate, email_subject: null, email_body: null, booking_date: null, booking_time: null }
);
const finalSms8 = result8.response.candidate.sms_response;
assert.ok(finalSms8 === null || finalSms8.length <= 40, `expected null or <=40 chars, got ${JSON.stringify(finalSms8)}`);

console.log('Phase 1 regression checks passed.');
