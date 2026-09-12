import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = JSON.parse(await readFile(new URL('./Sales - 16 Response Strategy.json', import.meta.url), 'utf8'));
const strategyNode = workflow.nodes.find(node => node.name === 'Deterministic Response Strategy');
const strategyCode = strategyNode.parameters.jsCode;
const execute = new Function('$json', strategyCode);
const merge = (base, override) => {
  if (Array.isArray(override)) return override;
  if (!override || typeof override !== 'object') return override;
  const result = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(override)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(result[key], value) : value;
  }
  return result;
};

const baseEnvelope = {
  schema_version: '8.0',
  event: { content: 'How can you help?', sender: '+15550001111' },
  identity: { dealer_id: 'dealer-1' },
  context: {
    resolution: { valid: true, ambiguous: false, customer_ambiguous: false, lead_ambiguous: false, errors: [], warnings: [] },
    customer: { name: 'Alex', email: 'alex@example.com', phone: '+15550002222' },
    lead: {},
    dealer: {},
    sms_history: [],
    email_history: [],
    lead_notes: [],
    attachments: []
  },
  intelligence: {
    customer: { name: 'Alex', email: 'alex@example.com', phone: '+15550002222' },
    vehicle: { vin: null, year: null, make: null, model: null },
    language: { code: 'en', name: 'English', confidence: 1 },
    inquiry: { category: 'General Inquiry', confidence: 'High' },
    journey: { intent: null, sentiment: 'Neutral' },
    communication: { preferred_mode: 'sms', email_present: true },
    dnd: { requested: false, reason: null },
    escalation: { required: false, reason: null, callback_requested: false },
    appointment: { signal: 'NONE', date: null, time: null },
    response_signals: { explicit_visit_refusal: false, asks_vdp_content: false, asks_location: false, asks_booking_link: false, complex_trade: false, complex_finance: false }
  },
  inventory: { status: 'UNKNOWN', required: false, exact_vehicle: null, exact_matches: [], alternatives: [], authoritative_availability: false, warnings: [] },
  decision: {},
  response: {}
};
const run = override => execute(merge(baseEnvelope, override))[0].json;

// DND and escalation outrank email preference, and actual escalation preserves manager visibility.
const dndEmail = run({ intelligence: { communication: { preferred_mode: 'email' }, dnd: { requested: true, reason: 'STOP' } } });
assert.equal(dndEmail.decision.route, 'DND');
assert.equal(dndEmail.decision.send_user_response, false);
assert.equal(dndEmail.decision.send_manager_sms, true);
const escalationEmail = run({ intelligence: { communication: { preferred_mode: 'email' }, escalation: { required: true, reason: 'human request' } } });
assert.equal(escalationEmail.decision.route, 'ESCALATION');
assert.equal(escalationEmail.decision.send_manager_sms, true);
assert.ok(escalationEmail.decision.manager_sms);
assert.equal(escalationEmail.decision.allowed_facts.customer.email, 'alex@example.com');
const urgentEmail = run({ intelligence: { communication: { preferred_mode: 'email' }, escalation: { required: true, reason: 'urgent_need' } } });
assert.equal(urgentEmail.decision.route, 'ESCALATION');
assert.equal(urgentEmail.decision.send_manager_sms, true);

// Invalid or ambiguous identity is routed for review and blocks customer delivery.
const invalid = run({ context: { resolution: { valid: false, errors: ['DEALER_NOT_FOUND'] } } });
assert.equal(invalid.decision.route, 'ESCALATION');
assert.equal(invalid.decision.block_delivery, true);
assert.equal(invalid.decision.send_user_response, false);
assert.equal(invalid.decision.identity_safety_state, 'INVALID');
assert.ok(invalid.decision.warnings.includes('DEALER_NOT_FOUND'));
const ambiguousCustomer = run({ context: { resolution: { valid: true, ambiguous: true, customer_ambiguous: true } } });
assert.equal(ambiguousCustomer.decision.route, 'ESCALATION');
assert.equal(ambiguousCustomer.decision.block_delivery, true);
assert.equal(ambiguousCustomer.decision.identity_safety_state, 'AMBIGUOUS');
assert.ok(ambiguousCustomer.decision.warnings.includes('AMBIGUOUS_CUSTOMER_IDENTITY'));
const ambiguousLead = run({ context: { resolution: { valid: true, lead_ambiguous: true } } });
assert.equal(ambiguousLead.decision.route, 'ESCALATION');
assert.equal(ambiguousLead.decision.block_delivery, true);
assert.ok(ambiguousLead.decision.warnings.includes('AMBIGUOUS_LEAD_IDENTITY'));
const validIdentity = run({});
assert.equal(validIdentity.decision.block_delivery, false);
assert.equal(validIdentity.decision.identity_safety_state, 'VALID');

const vehicle = { vin: null, year: '2023', make: 'BMW', model: '5 Series' };
const exact = { vin: 'VIN530', year: 2023, make: 'BMW', model: '5 Series', availability: true };
const inventoryCase = inventory => ({ intelligence: { vehicle, inquiry: { category: 'Availability Inquiry' } }, inventory: { required: true, ...inventory } });

// Inventory CTA/claim behavior distinguishes known vehicles from missing vehicle context.
const exactAvailable = run(inventoryCase({ status: 'EXACT_AVAILABLE', exact_vehicle: exact, exact_matches: [exact], authoritative_availability: true }));
assert.equal(exactAvailable.decision.route, 'INVENTORY');
assert.equal(exactAvailable.decision.cta_type, 'offer_visit');
assert.equal(exactAvailable.decision.inventory_claim_mode, 'confirmed_available');
const unverifiedAvailable = run(inventoryCase({ status: 'EXACT_AVAILABLE', exact_vehicle: exact, exact_matches: [exact], authoritative_availability: false }));
assert.equal(unverifiedAvailable.decision.cta_type, 'verify_availability');
assert.equal(unverifiedAvailable.decision.inventory_claim_mode, 'availability_unverified');
const availableRefusal = run(merge(inventoryCase({ status: 'EXACT_AVAILABLE', exact_vehicle: exact, exact_matches: [exact], authoritative_availability: true }), { intelligence: { response_signals: { explicit_visit_refusal: true } } }));
assert.equal(availableRefusal.decision.cta_type, 'answer_question');
const exactUnavailable = run(inventoryCase({ status: 'EXACT_UNAVAILABLE', exact_vehicle: { ...exact, availability: false }, exact_matches: [{ ...exact, availability: false }], authoritative_availability: true }));
assert.equal(exactUnavailable.decision.cta_type, 'offer_alternatives');
assert.equal(exactUnavailable.decision.inventory_claim_mode, 'confirmed_unavailable');
const unverifiedUnavailable = run(inventoryCase({ status: 'EXACT_UNAVAILABLE', exact_vehicle: exact, exact_matches: [exact], authoritative_availability: false }));
assert.equal(unverifiedUnavailable.decision.cta_type, 'verify_availability');
assert.equal(unverifiedUnavailable.decision.inventory_claim_mode, 'availability_unverified');
const unknownExact = run(inventoryCase({ status: 'UNKNOWN', exact_vehicle: { ...exact, availability: null }, exact_matches: [{ ...exact, availability: null }] }));
assert.equal(unknownExact.decision.cta_type, 'verify_availability');
assert.equal(unknownExact.decision.inventory_claim_mode, 'availability_unverified');
const multipleUnknownExact = run(inventoryCase({ status: 'UNKNOWN', exact_vehicle: exact, exact_matches: [exact, { ...exact, vin: 'VIN531' }] }));
assert.equal(multipleUnknownExact.decision.cta_type, 'clarify_vehicle');
const alternatives = run(inventoryCase({ status: 'ALTERNATIVES', alternatives: [{ ...exact, model: '3 Series' }] }));
assert.equal(alternatives.decision.cta_type, 'offer_alternatives');
assert.equal(alternatives.decision.inventory_claim_mode, 'alternatives_only');
const noMatch = run(inventoryCase({ status: 'NO_MATCH', warnings: ['NO_INVENTORY_MATCH'] }));
assert.equal(noMatch.decision.cta_type, 'offer_alternatives');
assert.equal(noMatch.decision.inventory_claim_mode, 'no_match');
const noVehicle = run({ intelligence: { inquiry: { category: 'Availability Inquiry' } }, inventory: { required: true, status: 'UNKNOWN' } });
assert.equal(noVehicle.decision.cta_type, 'clarify_vehicle');

const contradiction = run(inventoryCase({ status: 'UNKNOWN', warnings: ['NO_INVENTORY_KEY'] }));
assert.equal(contradiction.decision.cta_type, 'verify_availability');
assert.ok(contradiction.decision.warnings.includes('INVENTORY_KEY_STATE_CONTRADICTION'));

// Resolved/intelligence customer phone is canonical; event.sender is only the fallback.
assert.equal(run({}).decision.allowed_facts.customer.phone, '+15550002222');
assert.equal(run({ intelligence: { customer: { phone: '+15550003333' } } }).decision.allowed_facts.customer.phone, '+15550003333');
assert.equal(run({ intelligence: { customer: { phone: null } }, context: { customer: { phone: null }, lead: { phone: null } } }).decision.allowed_facts.customer.phone, '+15550001111');
assert.equal(run({ intelligence: { customer: { phone: '  ' } }, context: { customer: { phone: null }, lead: { phone: null } } }).decision.allowed_facts.customer.phone, '+15550001111');

// Sales-16 only references currently valid Sales-10 visit and appointment enums.
assert.doesNotMatch(strategyCode, /Visit Suggested|REQUESTED|SUGGESTED/);
assert.equal(run({ intelligence: { journey: { intent: 'Visit Requested' }, appointment: { signal: 'INTEREST' } } }).decision.route, 'VISIT');
assert.equal(run({ intelligence: { journey: { intent: 'Visit Booked' }, appointment: { signal: 'BOOKED' } } }).decision.route, 'BOOKING');
assert.equal(run({ intelligence: { appointment: { signal: 'RESCHEDULE' } } }).decision.cta_type, 'reschedule');

// Frustration keeps empathetic general handling unless a separate escalation condition is present.
const frustration = run({ intelligence: { inquiry: { category: 'Sarcasm / Frustration' } } });
assert.equal(frustration.decision.route, 'GENERAL');
assert.equal(frustration.decision.tone, 'calm-empathetic');
const escalatedFrustration = run({ intelligence: { inquiry: { category: 'Sarcasm / Frustration' }, escalation: { required: true, reason: 'upset_or_complaint' } } });
assert.equal(escalatedFrustration.decision.route, 'ESCALATION');

// Context Builder supplies notes oldest-to-newest; keep the most recent 12 in their existing order.
const fewNotes = [{ text: 'one' }, { text: 'two' }];
assert.deepEqual(run({ context: { lead_notes: fewNotes } }).decision.allowed_facts.conversation.lead_notes, fewNotes);
const manyNotes = Array.from({ length: 15 }, (_, index) => ({ text: `note-${index + 1}` }));
assert.deepEqual(run({ context: { lead_notes: manyNotes } }).decision.allowed_facts.conversation.lead_notes.map(note => note.text), manyNotes.slice(-12).map(note => note.text));
assert.deepEqual(run({ context: { lead_notes: [] } }).decision.allowed_facts.conversation.lead_notes, []);
assert.equal(run({}).decision.compatibility.lead_notes_limit, 12);

assert.equal(run({}).decision.route, 'GENERAL');
assert.equal(workflow.active, false);
assert.equal(strategyNode.onError, undefined);

console.log('Response Strategy regression checks passed (21 strategy invariants covered).');
