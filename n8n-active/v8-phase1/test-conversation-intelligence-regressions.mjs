import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = JSON.parse(await readFile(new URL('./Sales - 10 Conversation Intelligence.json', import.meta.url), 'utf8'));
const nodeCode = name => workflow.nodes.find(node => node.name === name)?.parameters?.jsCode;
const executeCode = (code, json, nodes = {}) => new Function('$json', '$node', code)(json, nodes);
const safeCode = nodeCode('Safe Structured Intelligence');
const validateCode = nodeCode('Validate Intelligence Labels');

const baseModel = {
  customer: { name: null, email: null, phone: null },
  vehicle: { vin: null, year: null, make: null, model: null },
  language: { code: 'en', name: 'English', confidence: 0.99 },
  inquiry: { category: 'General Inquiry', confidence: 'High' },
  journey: { intent: null, sentiment: 'Neutral' },
  business_flow: 'UNKNOWN',
  communication: { preferred_mode: 'sms', email_present: false },
  dnd: { requested: false, reason: null },
  escalation: { required: false, reason: null, callback_requested: false },
  appointment: { signal: 'NONE', date: null, time: null },
  response_signals: {
    asks_location: false,
    asks_booking_link: false,
    asks_vdp_content: false,
    complex_trade: false,
    complex_finance: false,
    explicit_visit_refusal: false,
    closure: false
  }
};

const envelopeFor = message => ({
  schema_version: '8.0',
  channel: 'sms',
  event: { content: message, sender: '+15853093700', recipient: '+13476585466', message_id: 'test-message' },
  identity: { dealer_id: 'dealer-1', parent_message_id: null },
  context: {
    resolution: { valid: true },
    customer: { name: null, email: null, phone: '+15853093700' },
    lead: {},
    sms_history: [{ content: 'What financing rates do you offer?' }],
    email_history: [],
    lead_notes: [],
    attachments: [],
    dealer: {}
  },
  intelligence: {},
  inventory: {},
  decision: {},
  response: {}
});

const mergeModel = overrides => ({
  ...JSON.parse(JSON.stringify(baseModel)),
  ...overrides,
  customer: { ...baseModel.customer, ...overrides?.customer },
  vehicle: { ...baseModel.vehicle, ...overrides?.vehicle },
  language: { ...baseModel.language, ...overrides?.language },
  inquiry: { ...baseModel.inquiry, ...overrides?.inquiry },
  journey: { ...baseModel.journey, ...overrides?.journey },
  communication: { ...baseModel.communication, ...overrides?.communication },
  dnd: { ...baseModel.dnd, ...overrides?.dnd },
  escalation: { ...baseModel.escalation, ...overrides?.escalation },
  appointment: { ...baseModel.appointment, ...overrides?.appointment },
  response_signals: { ...baseModel.response_signals, ...overrides?.response_signals }
});

const classify = (message, overrides = {}, sourceOverride = null) => {
  const source = sourceOverride ?? { output: JSON.stringify(mergeModel(overrides)) };
  const safe = executeCode(safeCode, source, { 'Sub-workflow Input': { json: envelopeFor(message) } })[0].json;
  return executeCode(validateCode, safe)[0].json.intelligence;
};

const vehicleInquiry = classify('What about a BMW 5 Series', {
  vehicle: { make: 'BMW', model: '5 Series' },
  inquiry: { category: 'Availability Inquiry' },
  business_flow: 'SALES',
});
assert.equal(vehicleInquiry.inquiry.category, 'Availability Inquiry');
assert.equal(vehicleInquiry.vehicle.make, 'BMW');
assert.equal(vehicleInquiry.vehicle.model, '5 Series');
assert.equal(vehicleInquiry.journey.intent, null);
assert.equal(vehicleInquiry.appointment.signal, 'NONE');

const visitInterest = classify("I'd like to come see it");
assert.equal(visitInterest.journey.intent, 'Visit Requested');
assert.equal(visitInterest.appointment.signal, 'INTEREST');

const testDrive = classify('Can I test drive it tomorrow?');
assert.equal(testDrive.inquiry.category, 'Test Drive Request');
assert.equal(testDrive.journey.intent, 'Visit Requested');
assert.equal(testDrive.appointment.signal, 'INTEREST');

const rejection = classify("No, I don't want to come in");
assert.equal(rejection.journey.intent, null);
assert.equal(rejection.appointment.signal, 'REJECT');
assert.equal(rejection.response_signals.explicit_visit_refusal, true);
assert.equal(rejection.dnd.requested, false);

const callback = classify('Call me');
assert.equal(callback.escalation.required, true);
assert.equal(callback.escalation.callback_requested, true);
assert.equal(callback.escalation.reason, 'callback_request');

const salesperson = classify('I want to speak to a salesperson');
assert.equal(salesperson.escalation.required, true);
assert.equal(salesperson.journey.intent, 'Managerial Review');

const stop = classify('STOP');
assert.equal(stop.dnd.requested, true);
assert.equal(stop.dnd.reason, 'opt_out');

for (const message of [
  'Stop texting me',
  'Unsubscribe me please',
  'Please remove me from your list',
  'Take me off your texting list'
]) {
  const naturalOptOut = classify(message);
  assert.equal(naturalOptOut.dnd.requested, true, message);
}

const normalMessage = classify('What is the price?');
assert.equal(normalMessage.dnd.requested, false);

const semanticOptOut = classify('I no longer wish to receive these updates', {
  dnd: { requested: true, reason: 'customer requested removal from future messages' }
});
assert.equal(semanticOptOut.dnd.requested, true);
assert.equal(semanticOptOut.dnd.reason, 'customer requested removal from future messages');
assert.equal(semanticOptOut.meta.parse_status, 'parsed');

const negatedCallback = classify("Please don't call me, text is fine.", {
  escalation: { required: false, reason: null, callback_requested: false }
});
assert.equal(negatedCallback.escalation.required, false);
assert.equal(negatedCallback.escalation.callback_requested, false);

const negatedService = classify("I don't need any service on this car, just financing for a new one.", {
  inquiry: { category: 'Financing/Loan Inquiry' },
  business_flow: 'SALES'
});
assert.equal(negatedService.inquiry.category, 'Financing/Loan Inquiry');
assert.equal(negatedService.business_flow, 'SALES');

const negatedTrade = classify("I don't want to trade in my old car, I'll pay cash — do you have financing?", {
  inquiry: { category: 'Financing/Loan Inquiry' },
  business_flow: 'SALES'
});
assert.equal(negatedTrade.inquiry.category, 'Financing/Loan Inquiry');
assert.equal(negatedTrade.business_flow, 'SALES');

const multilingualVisit = classify('Quiero venir mañana para ver el coche.', {
  language: { code: 'es', name: 'Spanish', confidence: 0.99 },
  journey: { intent: 'Visit Requested' },
  appointment: { signal: 'INTEREST', date: 'tomorrow' },
  business_flow: 'SALES'
});
assert.equal(multilingualVisit.language.code, 'es');
assert.equal(multilingualVisit.journey.intent, 'Visit Requested');
assert.equal(multilingualVisit.appointment.signal, 'INTEREST');
assert.equal(multilingualVisit.appointment.date, 'tomorrow');

const explicitAcceptance = classify('That time works for me', {
  journey: { intent: 'Visit Requested' },
  appointment: { signal: 'ACCEPT', date: '2026-09-13', time: '14:00' }
});
assert.equal(explicitAcceptance.journey.intent, 'Visit Requested');
assert.equal(explicitAcceptance.appointment.signal, 'ACCEPT');

const naturalAcceptance = classify('Saturday at 2pm works for me!', {
  journey: { intent: 'Visit Requested' },
  appointment: { signal: 'ACCEPT', date: 'Saturday', time: '2pm' }
});
assert.equal(naturalAcceptance.journey.intent, 'Visit Requested');
assert.equal(naturalAcceptance.appointment.signal, 'ACCEPT');
assert.equal(naturalAcceptance.appointment.time, '2pm');

const purchased = classify('I already bought another car');
assert.equal(purchased.inquiry.category, 'Already Purchased');
assert.equal(purchased.dnd.requested, false);
assert.equal(purchased.journey.intent, null);

const service = classify('I need an oil change and brake service');
assert.equal(service.inquiry.category, 'Service Inquiry');
assert.equal(service.business_flow, 'SERVICE');
assert.equal(service.journey.intent, null);

const switchedIntent = classify('I want to trade my car', {
  inquiry: { category: 'Financing/Loan Inquiry' },
  business_flow: 'SALES'
});
assert.equal(switchedIntent.inquiry.category, 'Trade-In Inquiry');

const malformed = classify('What is the price?', {}, { output: '{not valid json' });
assert.equal(malformed.meta.warning, 'MODEL_OUTPUT_PARSE_ERROR');
assert.equal(malformed.meta.parse_status, 'fallback');
assert.equal(malformed.inquiry.category, 'Price Inquiry');

const apiError = classify('Call me', {}, { error: { message: 'OpenAI request failed' } });
assert.equal(apiError.meta.warning, 'OPENAI_API_ERROR');
assert.equal(apiError.meta.parse_status, 'fallback');
assert.equal(apiError.escalation.callback_requested, true);

const schemaError = classify('What about a BMW 5 Series', {}, { output: JSON.stringify({ foo: 'bar' }) });
assert.equal(schemaError.meta.warning, 'MODEL_OUTPUT_SCHEMA_ERROR');
assert.equal(schemaError.meta.parse_status, 'fallback');
assert.equal(schemaError.appointment.signal, 'NONE');

const cancellation = classify('Cancel my appointment');
assert.equal(cancellation.appointment.signal, 'CANCEL');
assert.equal(cancellation.dnd.requested, false);

const rescheduling = classify('Can we reschedule my appointment?', {
  appointment: { signal: 'NONE' }
});
assert.equal(rescheduling.appointment.signal, 'RESCHEDULE');
assert.equal(rescheduling.journey.intent, 'Visit Requested');

console.log('Conversation Intelligence regression checks passed.');
