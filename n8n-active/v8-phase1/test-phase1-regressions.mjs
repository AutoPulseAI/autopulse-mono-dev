import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('./', import.meta.url);
const loadWorkflow = async name => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const nodeCode = (workflow, name) => workflow.nodes.find(node => node.name === name)?.parameters?.jsCode;
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

console.log('Phase 1 regression checks passed.');
