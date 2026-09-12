import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = async file => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
const intelligence = await load('./Sales - 10 Conversation Intelligence.json');
const strategy = await load('./Sales - 16 Response Strategy.json');
const generator = await load('./SMS - 20 Response Generator.json');
const formatter = await load('./SMS - 21 Validator + Output Formatter.json');
const code = (w, name) => w.nodes.find(n => n.name === name).parameters.jsCode;
const exec = (w, name, json, input = json) => new Function('$json', '$node', code(w, name))(json, { 'Sub-workflow Input': { json: input } })[0].json;
const history = [];
const turn = (content, model = null, generatorResult = { error: 'simulated failure' }) => {
  const input = {
    event: { content, sender: '+15550001111' }, identity: { dealer_id: 'dealer-1' },
    context: { resolution: { valid: true }, dealer: {}, lead: { make: 'Honda', model: 'Accord', year: '2024' }, sms_history: [...history] },
    inventory: { required: true, status: 'UNKNOWN', exact_matches: [{ make: 'Honda', model: 'Accord' }, { make: 'Honda', model: 'Accord' }], warnings: [] }
  };
  let e = exec(intelligence, 'Safe Structured Intelligence', model ? { output: JSON.stringify(model) } : { error: 'simulated failure' }, input);
  e = exec(strategy, 'Deterministic Response Strategy', e);
  e = exec(generator, 'Safe Generator Output', generatorResult, e);
  return e;
};
const remember = (customer, bot) => history.push({ direction: 'inbound', content: customer }, { direction: 'outbound', content: bot });

let e = turn('Do you have a Honda Accord?');
assert.equal(e.decision.route, 'INVENTORY');
remember('Do you have a Honda Accord?', 'I found several 2024 Honda Accord matches. Would you like to book an appointment to see one?');
e = turn("Yes, I'd like to book an appointment");
assert.equal(e.decision.route, 'VISIT');
assert.match(e.response.candidate.sms_response, /day and time/);
assert.doesNotMatch(e.response.candidate.sms_response, /inventory|availability|matches|Accord/i);
remember("Yes, I'd like to book an appointment", e.response.candidate.sms_response);
e = turn('Tomorrow at 11AM');
assert.equal(e.decision.route, 'VISIT');
assert.equal(e.intelligence.vehicle.model, 'Accord');
assert.equal(e.intelligence.appointment.date, 'Tomorrow');
assert.equal(e.intelligence.appointment.time, '11AM');
assert.match(e.response.candidate.sms_response, /confirm/);
assert.doesNotMatch(e.response.candidate.sms_response, /inventory|availability|matches|Accord/i);
remember('Tomorrow at 11AM', e.response.candidate.sms_response);

for (const reply of ['Yes', 'Yes, confirm it', "Yes, I'd like to confirm", 'That works', 'Book it', 'Sounds good']) {
  e = turn(reply, null, { output: JSON.stringify({ sms_response: 'Would you like us to confirm your appointment?' }) });
  assert.equal(e.intelligence.appointment.signal, 'BOOKED', reply);
  assert.equal(e.decision.route, 'BOOKING', reply);
  assert.equal(e.decision.cta_type, 'complete_booking');
  assert.equal(e.intelligence.appointment.persistence_confirmed, false);
  assert.match(e.response.candidate.sms_response, /I'll mark your appointment/);
  assert.doesNotMatch(e.response.candidate.sms_response, /\?|inventory|availability|matches|already saved|is confirmed/i);
  const output = exec(formatter, 'Format Legacy v7 Output', { ...e, response: { validated: e.response.candidate } });
  assert.equal(output.booking_status, true);
  assert.equal(output.fe_lead_status, 'Appointment Booked');
}
e = turn('What about a Camry instead?');
assert.equal(e.decision.route, 'INVENTORY');
assert.equal(e.intelligence.appointment.signal, 'NONE');
e = turn('Actually cancel that');
assert.equal(e.intelligence.appointment.signal, 'CANCEL');
assert.equal(e.decision.cta_type, 'cancel_appointment');
assert.match(e.response.candidate.sms_response, /cancellation request/);
assert.doesNotMatch(e.response.candidate.sms_response, /what day|confirm that slot/i);
e = turn('Make it Friday at 2PM instead');
assert.equal(e.intelligence.appointment.signal, 'RESCHEDULE');
assert.equal(e.decision.cta_type, 'reschedule');
assert.equal(e.intelligence.appointment.date, 'Friday');
assert.equal(e.intelligence.appointment.time, '2PM');
assert.doesNotMatch(e.response.candidate.sms_response, /inventory|availability|matches/i);
e = turn('Make it Friday at 2 instead');
assert.equal(e.intelligence.appointment.signal, 'RESCHEDULE');
assert.equal(e.intelligence.appointment.date, 'Friday');
assert.equal(e.intelligence.appointment.time, null);
assert.match(e.response.candidate.sms_response, /What time.*Friday/i);
// Exercise valid model extraction as well as the failure fallback used above.
const semantic = JSON.parse(JSON.stringify(turn('Tomorrow at 11AM').intelligence));
semantic.appointment = { signal: 'ACCEPT', date: 'tomorrow', time: '11:00 AM' };
semantic.journey.intent = 'Visit Requested';
semantic.inquiry.category = 'Availability Inquiry';
e = turn("Yes, I'd like to confirm", semantic);
assert.equal(e.intelligence.meta.parse_status, 'parsed');
assert.equal(e.decision.route, 'BOOKING');
assert.equal(e.intelligence.appointment.signal, 'BOOKED');
assert.doesNotMatch(e.response.candidate.sms_response, /\?|inventory|matches/i);
e = turn("No, I don't want to come in");
assert.equal(e.intelligence.appointment.signal, 'REJECT');
assert.equal(e.decision.cta_type, 'acknowledge_refusal');
assert.doesNotMatch(e.response.candidate.sms_response, /confirm|what day/i);
e = turn('STOP');
assert.equal(e.decision.route, 'DND');
assert.equal(e.response.candidate.sms_response, null);
e = turn('Call me');
assert.equal(e.decision.route, 'ESCALATION');

history.length = 0;
e = turn('Yes');
assert.notEqual(e.intelligence.appointment.signal, 'BOOKED');
remember('What is the price?', 'Would you like the vehicle price?');
e = turn('Sounds good');
assert.notEqual(e.intelligence.appointment.signal, 'BOOKED');
console.log('Appointment progression regression checks passed.');
