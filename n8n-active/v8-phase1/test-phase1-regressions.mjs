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
assert.match(promptText, /never say "we have", "it is available", "it's in stock", or otherwise imply confirmed availability/);
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

// SMS-21: sanitizeSmsText must strip HTML/entities from customer-facing SMS fields before length enforcement.
const validateResponseCode = nodeCode(validator, 'Validate Response');
const enforceExactCode = nodeCode(validator, 'Enforce Exact URL Allowlist');
const formatLegacyCode = nodeCode(validator, 'Format Legacy v7 Output');
const runSms21 = envelope => {
  const afterValidate = executeCode(validateResponseCode, envelope)[0].json;
  const afterEnforce = executeCode(enforceExactCode, afterValidate)[0].json;
  return executeCode(formatLegacyCode, afterEnforce)[0].json;
};
const baseSms21Envelope = (route, candidate, decisionOverrides = {}) => ({
  decision: { route, send_user_response: true, send_manager_sms: false, block_delivery: false, max_characters: 300, allowed_links: [], manager_sms: null, language: 'English', ...decisionOverrides },
  response: { candidate },
  inventory: {},
  intelligence: {},
  context: { resolution: { create_lead: true, update_lead: false }, customer: {}, lead: {} },
  event: { sender: '+15550001001', recipient: '+15550002000', message_id: 'sms21-test-1', content: 'test message' },
  identity: { parent_message_id: 'sms21-test-1' }
});
const blankCandidate = overrides => ({ sms_response: null, email_body: null, email_subject: null, booking_date: null, booking_time: null, ...overrides });

// Test 1: full html/body/div wrapper -> all tags removed.
const sms21Test1 = runSms21(baseSms21Envelope('GENERAL', blankCandidate({ sms_response: '<html><body><div>Hi <strong>there</strong>, visit us!</div></body></html>' })));
assert.equal(sms21Test1.response, 'Hi there, visit us!');
assert.doesNotMatch(sms21Test1.response, /<[^>]+>/);

// Test 2: <strong>, <b>, <em> -> inner text retained.
const sms21Test2 = runSms21(baseSms21Envelope('GENERAL', blankCandidate({ sms_response: '<strong>Bold</strong> <b>bold2</b> <em>emph</em> text' })));
assert.equal(sms21Test2.response, 'Bold bold2 emph text');

// Test 3: <br> and block boundaries -> words do not concatenate.
const sms21Test3 = runSms21(baseSms21Envelope('GENERAL', blankCandidate({ sms_response: 'Hello<br>World</div><div>Again' })));
assert.doesNotMatch(sms21Test3.response, /HelloWorld|WorldAgain/);

// Test 4: <a href="...">visible text</a> -> visible text retained, href NOT automatically inserted.
const sms21Test4 = runSms21(baseSms21Envelope('GENERAL', blankCandidate({ sms_response: 'See <a href="https://unapproved.example/x">our site</a> for info' })));
assert.match(sms21Test4.response, /our site/);
assert.doesNotMatch(sms21Test4.response, /unapproved\.example/);

// Test 5: HTML entities correctly decoded.
const sms21Test5 = runSms21(baseSms21Envelope('GENERAL', blankCandidate({ sms_response: 'Tom &amp; Jerry said &quot;hi&quot;&nbsp;&#39;test&#39;&nbsp;&lt;3&gt;' })));
assert.equal(sms21Test5.response, 'Tom & Jerry said "hi" \'test\' <3>');

// Test 6: already-valid plain SMS -> unchanged except harmless whitespace normalization.
const sms21Test6 = runSms21(baseSms21Envelope('GENERAL', blankCandidate({ sms_response: 'Thanks for reaching out! We will follow up soon.' })));
assert.equal(sms21Test6.response, 'Thanks for reaching out! We will follow up soon.');

// Test 7: null response remains compatible with the existing DND contract.
const sms21Test7 = runSms21(baseSms21Envelope('DND', blankCandidate(), { send_user_response: false, send_manager_sms: true, manager_sms: 'Lead opted for DND.' }));
assert.equal(sms21Test7.response, null);

// Test 8: user_response (ESCALATION) is sanitized.
const sms21Test8 = runSms21(baseSms21Envelope('ESCALATION', blankCandidate({ sms_response: '<div>A team member will <strong>connect</strong> with you shortly.</div>' }), { send_manager_sms: true, manager_sms: 'New lead needs intervention.' }));
assert.equal(sms21Test8.user_response, 'A team member will connect with you shortly.');
assert.doesNotMatch(sms21Test8.user_response, /<[^>]+>/);

// Test 9: manager_sms is sanitized when it can carry upstream-generated content.
const sms21Test9 = runSms21(baseSms21Envelope('DND', blankCandidate(), { send_user_response: false, send_manager_sms: true, manager_sms: '<div>Lead opted for <strong>DND</strong>. VDP: Not Available.</div>' }));
assert.equal(sms21Test9.manager_sms, 'Lead opted for DND. VDP: Not Available.');

// Test 10: email_body is NOT sanitized by this SMS-specific logic.
const sms21Test10 = runSms21(baseSms21Envelope('EMAIL_HANDOFF', blankCandidate({ email_body: '<div>Hi <strong>there</strong>, thanks for your interest.</div>', email_subject: 'Your inquiry' })));
assert.match(sms21Test10.response, /<strong>there<\/strong>/);

// Test 11: HTML markup does not count toward the final SMS character enforcement because sanitation occurs first.
const sms21LongHtml = '<div>' + 'A'.repeat(50) + '</div><div>' + 'B'.repeat(50) + '</div>';
const sms21Test11 = runSms21(baseSms21Envelope('GENERAL', blankCandidate({ sms_response: sms21LongHtml }), { max_characters: 120 }));
assert.doesNotMatch(sms21Test11.response, /<[^>]+>/);
assert.ok(sms21Test11.response.length <= 120);
assert.ok(sms21Test11.response.length > 100, 'expected the full 101-char sanitized text to survive un-truncated since raw HTML length must not count toward the limit');

// Test 12: existing Phase 1 terminal output contract (key set) is unchanged for a plain-text GENERAL response.
const sms21Test12 = runSms21(baseSms21Envelope('GENERAL', blankCandidate({ sms_response: 'Thanks! How can we help?' })));
const sms21ExpectedKeys = ['lead_status', 'lead_name', 'lead_mail', 'lead_phone', 'source', 'message_id', 'create_lead', 'update_lead', 'sender_number', 'recipient_number', 'user_language', 'appointment_cancellation_requested', 'response', 'request_query', 'parent_message_id', 'fe_lead_status', 'send_user_response', 'send_manager_sms', 'manager_sms'];
assert.deepEqual(Object.keys(sms21Test12).sort(), sms21ExpectedKeys.sort());
assert.equal(sms21Test12.response, 'Thanks! How can we help?');

// Config/graph guardrails: node ids, credentials-free code nodes, workflow id/active state untouched.
assert.equal(validator.active, false, 'SMS-21 workflow must remain inactive');
assert.equal(validator.versionId, '79d6d36b-a927-4d1d-9a4d-edf13658bba0', 'SMS-21 workflow id must be unchanged');
assert.equal(validator.nodes.find(n => n.name === 'Validate Response').id, '8c3a9e3c-dabd-4e61-9d4e-2e7ecbc5422a');
assert.equal(validator.nodes.find(n => n.name === 'Format Legacy v7 Output').id, '9a21ac37-122f-478c-97d7-0f60818a87d5');

// Sales-10 / Sales-11: current-message vehicle must not be contaminated with a stale lead vehicle's VIN/year,
// and inventory query construction must never use a fake ObjectId sentinel or stale VIN-lookup constraints.
const safeStructuredIntelligenceCode = nodeCode(intelligence, 'Safe Structured Intelligence');
const buildSafeInventoryQueriesCode = nodeCode(inventory, 'Build Safe Inventory Queries');
const leadRav4 = { vin: '2T3P1RFVORW456789', year: '2024', make: 'Toyota', model: 'RAV4' };
const vehicleDealerId = 'dealer-1';
const baseIntelResponseSignals = { asks_location: false, asks_booking_link: false, asks_vdp_content: false, complex_trade: false, complex_finance: false, explicit_visit_refusal: false, closure: false };
const runIntel = (content, modelVehicle, lead = leadRav4) => executeCode(safeStructuredIntelligenceCode, {
  output: JSON.stringify({
    customer: {}, vehicle: modelVehicle, language: { code: 'en', name: 'English', confidence: 0.9 },
    inquiry: { category: 'Availability Inquiry', confidence: 'High' }, journey: { intent: null, sentiment: 'Neutral' }, business_flow: 'SALES',
    communication: { preferred_mode: 'unknown', email_present: false }, dnd: { requested: false, reason: null },
    escalation: { required: false, reason: null, callback_requested: false }, appointment: { signal: 'NONE', date: null, time: null },
    response_signals: baseIntelResponseSignals
  })
}, {
  'Sub-workflow Input': { json: { event: { content, sender: '+15550001001', recipient: '+15550002000' }, context: { lead, customer: {} }, identity: { dealer_id: vehicleDealerId } } }
})[0].json;
const runQueries = envelope => executeCode(buildSafeInventoryQueriesCode, envelope)[0].json;

// 1. Existing lead = 2024 Toyota RAV4, message names a different make/model -> no inherited VIN/year.
const vt1 = runIntel('Hi do you have a Mazda cx-70', { vin: null, year: null, make: 'Mazda', model: 'CX-70' });
assert.deepEqual(vt1.intelligence.vehicle, { vin: null, year: null, make: 'Mazda', model: 'CX-70' });
const qt1 = runQueries(vt1);
assert.deepEqual(JSON.parse(qt1.vin_query), { dealerId: vehicleDealerId, make: { $regex: '^\\s*Mazda\\s*$', $options: 'i' }, model: { $regex: '^\\s*CX-70\\s*$', $options: 'i' } });
assert.doesNotMatch(qt1.vin_query, /2T3P1RFVORW456789|"year"/);

// 2. Conversational reference to the same lead vehicle legitimately resolves back to it (with VIN, VIN-only query).
const vt2 = runIntel('Do you still have the RAV4?', { vin: null, year: null, make: 'Toyota', model: 'RAV4' });
assert.deepEqual(vt2.intelligence.vehicle, leadRav4);
const qt2 = runQueries(vt2);
assert.deepEqual(JSON.parse(qt2.vin_query), { dealerId: vehicleDealerId, vin: { $regex: '^\\s*2T3P1RFVORW456789\\s*$', $options: 'i' } });

// 3. Different make/model plus an explicitly supplied year -> year/make/model used, no Toyota VIN.
const vt3 = runIntel('Do you have a 2025 Mazda CX-70?', { vin: null, year: '2025', make: 'Mazda', model: 'CX-70' });
assert.deepEqual(vt3.intelligence.vehicle, { vin: null, year: '2025', make: 'Mazda', model: 'CX-70' });
const qt3 = runQueries(vt3);
assert.deepEqual(JSON.parse(qt3.vin_query), { dealerId: vehicleDealerId, year: { $in: [2025, '2025'] }, make: { $regex: '^\\s*Mazda\\s*$', $options: 'i' }, model: { $regex: '^\\s*CX-70\\s*$', $options: 'i' } });

// 4. Explicit VIN in the current message -> VIN lookup executes using dealer+VIN only, never constrained by stale make/model/year.
const vt4 = runIntel('Is JH4KA7561PC008269 still available', { vin: null, year: null, make: null, model: null });
assert.equal(vt4.intelligence.vehicle.vin, 'JH4KA7561PC008269');
const qt4 = runQueries(vt4);
assert.deepEqual(JSON.parse(qt4.vin_query), { dealerId: vehicleDealerId, vin: { $regex: '^\\s*JH4KA7561PC008269\\s*$', $options: 'i' } });

// 5. Make/model lookup without a VIN must not produce an invalid ObjectId query on the alternative-match branch.
const qt5 = runQueries(vt1);
assert.doesNotMatch(qt5.model_query, /"_id"/);
assert.match(qt5.model_query, /"vin":"__NO_ALTERNATIVE_CRITERIA__"/);

// 6. No usable inventory criteria at all -> safe non-ObjectId sentinel on both queries, not a crash-prone _id filter.
const vt6 = runIntel('What is the price?', { vin: null, year: null, make: null, model: null }, {});
const qt6 = runQueries(vt6);
assert.doesNotMatch(qt6.vin_query, /"_id"/);
assert.doesNotMatch(qt6.model_query, /"_id"/);
assert.match(qt6.vin_query, /"vin":"__NO_EXACT_CRITERIA__"/);
assert.match(qt6.model_query, /"vin":"__NO_ALTERNATIVE_CRITERIA__"/);

// Sales-16 / SMS-20: availability_unverified with exact matches should end with a booking-oriented CTA,
// while no_match / insufficient_vehicle_context / confirmed_unavailable / DND / escalation / explicit refusal
// and confirmed_available's prior behavior must all stay unchanged.
const strategyCode = nodeCode(strategy, 'Deterministic Response Strategy');
const bookingSafeGeneratorCode = nodeCode(generator, 'Safe Generator Output');
const runStrategy = envelope => executeCode(strategyCode, envelope)[0].json;
const runGeneratorFallback = (envelope, modelOutput) => executeCode(
  bookingSafeGeneratorCode,
  { output: typeof modelOutput === 'string' ? modelOutput : JSON.stringify(modelOutput) },
  { 'Sub-workflow Input': { json: envelope } }
)[0].json;
const baseStrategyResponseSignals = { asks_location: false, asks_booking_link: false, asks_vdp_content: false, complex_trade: false, complex_finance: false, explicit_visit_refusal: false, closure: false };
const baseStrategyEnvelope = (inventory, intelOverrides = {}) => ({
  intelligence: {
    customer: {}, vehicle: { vin: null, year: null, make: null, model: null }, language: { code: 'en', name: 'English', confidence: 0.9 },
    inquiry: { category: 'Availability Inquiry', confidence: 'High' }, journey: { intent: null, sentiment: 'Neutral' }, dnd: { requested: false },
    escalation: { required: false }, appointment: { signal: 'NONE' }, communication: { preferred_mode: 'unknown' },
    response_signals: baseStrategyResponseSignals, ...intelOverrides
  },
  context: { resolution: { valid: true }, dealer: {}, customer: {}, lead: {} },
  event: { content: 'test', sender: '+15550001001', recipient: '+15550002000' },
  inventory, identity: {}
});

// 1. availability_unverified + one exact match -> caveat retained, asks to book an appointment.
const bookingT1 = runGeneratorFallback(runStrategy(baseStrategyEnvelope(
  { status: 'UNKNOWN', required: true, exact_match_count: 1, exact_matches: [{ year: '2025', make: 'Mazda', model: 'CX-70', trim: null }], exact_vehicle: { year: '2025', make: 'Mazda', model: 'CX-70' }, alternatives: [], warnings: ['EXACT_MATCH_AVAILABILITY_UNRESOLVED'] },
  { vehicle: { vin: null, year: '2025', make: 'Mazda', model: 'CX-70' } }
)), 'malformed');
assert.match(bookingT1.response.candidate.sms_response, /availability[^.]*confir/i);
assert.match(bookingT1.response.candidate.sms_response, /would you like to book an appointment to see it\?/i);

// 2. availability_unverified + multiple exact matches -> caveat retained, asks to book an appointment "to see one".
const bookingT2 = runGeneratorFallback(runStrategy(baseStrategyEnvelope(
  { status: 'UNKNOWN', required: true, exact_match_count: 3, exact_matches: [{ year: '2024', make: 'BMW', model: '5 Series', trim: '530i' }, { year: '2023', make: 'BMW', model: '5 Series', trim: '530e' }], exact_vehicle: { year: '2024', make: 'BMW', model: '5 Series', trim: '530i' }, alternatives: [], warnings: ['EXACT_MATCH_AVAILABILITY_UNRESOLVED'] },
  { vehicle: { vin: null, year: null, make: 'BMW', model: '5 Series' } }
)), 'malformed');
assert.match(bookingT2.response.candidate.sms_response, /availability[^.]*confir/i);
assert.match(bookingT2.response.candidate.sms_response, /would you like to book an appointment to see one\?/i);

// 3. explicit visit refusal -> do NOT push an appointment.
const bookingT3Strategy = runStrategy(baseStrategyEnvelope(
  { status: 'UNKNOWN', required: true, exact_match_count: 2, exact_matches: [{ year: '2025', make: 'Mazda', model: 'CX-70' }], exact_vehicle: { year: '2025', make: 'Mazda', model: 'CX-70' }, alternatives: [], warnings: [] },
  { vehicle: { vin: null, year: '2025', make: 'Mazda', model: 'CX-70' }, response_signals: { ...baseStrategyResponseSignals, explicit_visit_refusal: true } }
));
assert.notEqual(bookingT3Strategy.decision.cta_type, 'offer_visit');
const bookingT3 = runGeneratorFallback(bookingT3Strategy, 'malformed');
assert.doesNotMatch(bookingT3.response.candidate.sms_response, /book an appointment/i);

// 4. no_match -> existing non-booking behavior unchanged.
const bookingT4 = runGeneratorFallback(runStrategy(baseStrategyEnvelope(
  { status: 'UNKNOWN', required: true, exact_match_count: 0, exact_matches: [], exact_vehicle: null, alternatives: [], warnings: ['NO_INVENTORY_MATCH'] },
  { vehicle: { vin: null, year: null, make: 'Mazda', model: 'CX-70' } }
)), 'malformed');
assert.equal(bookingT4.response.candidate.sms_response, "We couldn't confirm a matching vehicle. Would you like help with alternatives?");

// 5. confirmed_available -> existing behavior unchanged (already booking-oriented via offer_visit, unaffected by this change).
const bookingT5 = runGeneratorFallback(runStrategy(baseStrategyEnvelope(
  { status: 'EXACT_AVAILABLE', authoritative_availability: true, required: true, exact_match_count: 1, exact_matches: [{ year: '2025', make: 'Mazda', model: 'CX-70' }], exact_vehicle: { year: '2025', make: 'Mazda', model: 'CX-70' }, alternatives: [], warnings: [] },
  { vehicle: { vin: null, year: '2025', make: 'Mazda', model: 'CX-70' } }
)), 'malformed');
assert.equal(bookingT5.response.candidate.sms_response, 'The 2025 Mazda CX-70 is available. Would you like more details?');

// 6. confirmed_unavailable -> existing behavior unchanged.
const bookingT6 = runGeneratorFallback(runStrategy(baseStrategyEnvelope(
  { status: 'EXACT_UNAVAILABLE', authoritative_availability: true, required: true, exact_match_count: 1, exact_matches: [], exact_vehicle: { year: '2025', make: 'Mazda', model: 'CX-70' }, alternatives: [], warnings: [] },
  { vehicle: { vin: null, year: '2025', make: 'Mazda', model: 'CX-70' } }
)), 'malformed');
assert.equal(bookingT6.response.candidate.sms_response, "The 2025 Mazda CX-70 isn't currently available. Would you like help with alternatives?");

// 7. final SMS remains within the existing max_characters limit even with the booking CTA appended.
const bookingT7Strategy = runStrategy(baseStrategyEnvelope(
  { status: 'UNKNOWN', required: true, exact_match_count: 3, exact_matches: [{ year: '2024', make: 'BMW', model: '5 Series', trim: '530i' }], exact_vehicle: { year: '2024', make: 'BMW', model: '5 Series', trim: '530i' }, alternatives: [], warnings: ['EXACT_MATCH_AVAILABILITY_UNRESOLVED'] },
  { vehicle: { vin: null, year: '2024', make: 'BMW', model: '5 Series' } }
));
bookingT7Strategy.decision.max_characters = 60;
const bookingT7 = runGeneratorFallback(bookingT7Strategy, 'malformed');
assert.ok(bookingT7.response.candidate.sms_response == null || bookingT7.response.candidate.sms_response.length <= 60);

// DND/escalation CTA behavior must be untouched by this change.
const dndStrategy = runStrategy({ ...baseStrategyEnvelope({}, { dnd: { requested: true, reason: 'opt_out' } }) });
assert.equal(dndStrategy.decision.cta_type, 'none');

console.log('Phase 1 regression checks passed.');
