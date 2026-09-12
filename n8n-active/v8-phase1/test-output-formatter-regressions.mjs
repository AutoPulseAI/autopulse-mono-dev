import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('./SMS - 21 Validator + Output Formatter.json', import.meta.url);
const workflow = JSON.parse(await readFile(workflowPath, 'utf8'));
const nodeCode = name => workflow.nodes.find(node => node.name === name)?.parameters?.jsCode;
const execute = (code, json) => new Function('$json', code)(json)[0].json;
const validateCode = nodeCode('Validate Response');
const exactCode = nodeCode('Enforce Exact URL Allowlist');
const formatterCode = nodeCode('Format Legacy v7 Output');
assert.ok(validateCode && exactCode && formatterCode, 'SMS-21 Code nodes must exist');

const base = {
  schema_version: '8.0',
  channel: 'sms',
  event: { content: 'Can you help?', sender: '+15550001001', recipient: '+15550002000', message_id: 'message-1' },
  identity: { parent_message_id: 'parent-1' },
  context: { resolution: { create_lead: false, update_lead: true }, customer: {}, lead: {} },
  intelligence: { customer: {}, appointment: { signal: 'NONE' }, escalation: { required: false }, journey: {} },
  inventory: { status: 'UNKNOWN', authoritative_availability: false },
  decision: { route: 'GENERAL', language: 'English', send_user_response: true, send_manager_sms: false, block_delivery: false, max_characters: 300, allowed_links: [] },
  response: { candidate: { sms_response: 'Thanks for reaching out.', email_subject: null, email_body: null, booking_date: null, booking_time: null } }
};
const merge = (left, right) => ({
  ...left,
  ...right,
  event: { ...left.event, ...right.event },
  identity: { ...left.identity, ...right.identity },
  context: { ...left.context, ...right.context, resolution: { ...left.context.resolution, ...right.context?.resolution } },
  intelligence: { ...left.intelligence, ...right.intelligence, customer: { ...left.intelligence.customer, ...right.intelligence?.customer }, appointment: { ...left.intelligence.appointment, ...right.intelligence?.appointment }, escalation: { ...left.intelligence.escalation, ...right.intelligence?.escalation }, journey: { ...left.intelligence.journey, ...right.intelligence?.journey } },
  inventory: { ...left.inventory, ...right.inventory },
  decision: { ...left.decision, ...right.decision },
  response: { ...left.response, ...right.response, candidate: { ...left.response.candidate, ...right.response?.candidate }, validated: right.response?.validated }
});
const input = overrides => merge(structuredClone(base), overrides ?? {});
const validate = overrides => execute(validateCode, input(overrides));
const validateExact = overrides => execute(exactCode, validate(overrides));
const format = overrides => execute(formatterCode, input(overrides));
const validateAndFormat = overrides => execute(formatterCode, validateExact(overrides));

// Exact URL allowlist remains a second, deterministic defense.
assert.equal(validate({ decision: { allowed_links: ['https://dealer.example/car/1'] }, response: { candidate: { sms_response: 'See https://dealer.example/car/1.' } } }).response.validated.sms_response, 'See https://dealer.example/car/1.');
assert.equal(validateExact({ decision: { allowed_links: ['https://dealer.example/car/1'] }, response: { candidate: { sms_response: 'See https://dealer.example/car/1?track=1.' } } }).response.validated.sms_response, 'See .');

// Length enforcement remains hard, including the URL-boundary behavior.
assert.equal(validate({ response: { candidate: { sms_response: 'a'.repeat(300) } } }).response.validated.sms_response.length, 300);
assert.ok(validate({ decision: { max_characters: 40 }, response: { candidate: { sms_response: 'word '.repeat(20) } } }).response.validated.sms_response.length <= 40);
const overLimit = validate({ response: { candidate: { sms_response: `${'word '.repeat(70)}https://dealer.example/car/1` } }, decision: { allowed_links: ['https://dealer.example/car/1'] } });
assert.ok(overLimit.response.validated.sms_response.length <= 300);
assert.ok(!overLimit.response.validated.sms_response.includes('https://dealer.example/car/'));
assert.ok(overLimit.response.validation.warnings.includes('RESPONSE_TRUNCATED_URL_SAFE'));

// Contextual inventory-claim guard: inventory claims are checked, unrelated uses are not.
for (const claim of ["We've got it!", 'It is available now.', 'That vehicle is still here.', 'It is in stock.']) {
  const guarded = validate({ decision: { route: 'INVENTORY', inventory_claim_mode: 'availability_unverified', allowed_facts: { vehicle: { make: 'BMW', model: '5 Series' } } }, response: { candidate: { sms_response: claim } } });
  assert.match(guarded.response.validated.sms_response, /availability still needs to be confirmed/i);
  assert.ok(guarded.response.validation.warnings.includes('UNSUPPORTED_AVAILABILITY_CLAIM_REPLACED'));
}
assert.equal(validate({ decision: { route: 'INVENTORY', inventory_claim_mode: 'availability_unverified' }, response: { candidate: { sms_response: 'I found matching inventory records.' } } }).response.validated.sms_response, 'I found matching inventory records.');
assert.equal(validate({ decision: { route: 'INVENTORY', inventory_claim_mode: 'availability_unverified' }, response: { candidate: { sms_response: 'Our service department is available Saturdays.' } } }).response.validated.sms_response, 'Our service department is available Saturdays.');
assert.equal(validate({ decision: { route: 'SERVICE' }, response: { candidate: { sms_response: 'Our service team is available Saturday.' } } }).response.validated.sms_response, 'Our service team is available Saturday.');
assert.equal(validate({ inventory: { status: 'EXACT_AVAILABLE', authoritative_availability: true }, decision: { route: 'INVENTORY', inventory_claim_mode: 'confirmed_available' }, response: { candidate: { sms_response: "We've got it!" } } }).response.validated.sms_response, "We've got it!");

// create_lead is a boolean throughout, and EMAIL_HANDOFF uses the same status rule.
assert.equal(format({ context: { resolution: { create_lead: true, update_lead: false } }, response: { validated: { sms_response: 'Hello.' } } }).fe_lead_status, 'Lead');
assert.equal(format({ context: { resolution: { create_lead: false, update_lead: true } }, response: { validated: { sms_response: 'Hello.' } } }).fe_lead_status, 'Contacted');
const newEmail = format({ context: { resolution: { create_lead: true, update_lead: false } }, decision: { route: 'EMAIL_HANDOFF' }, response: { validated: { email_body: '<html>Hello</html>' } } });
assert.equal(newEmail.fe_lead_status, 'Lead');
assert.equal(newEmail.request_query, 'Can you help?');
assert.equal(newEmail.request, newEmail.request_query);
assert.equal(format({ decision: { route: 'EMAIL_HANDOFF' }, response: { validated: { email_body: '<html>Hello</html>' } } }).fe_lead_status, 'Contacted');

// Customer and manager delivery flags require policy plus actual content.
const normal = format({ response: { validated: { sms_response: 'Hello.' } } });
assert.equal(normal.response, 'Hello.');
assert.equal(normal.send_user_response, true);
assert.equal(normal.send_manager_sms, false);
const blockedGeneral = format({ decision: { block_delivery: true }, response: { validated: { sms_response: 'Do not send.' } } });
assert.equal(blockedGeneral.response, null);
assert.equal(blockedGeneral.send_user_response, false);
assert.equal(blockedGeneral.Response, 'null');
const smsWorkerText = blockedGeneral.response || blockedGeneral.Response || 'legacy canned fallback';
assert.equal(smsWorkerText, 'null');
assert.equal(smsWorkerText !== 'null' && smsWorkerText !== 'undefined', false);
const dnd = format({ decision: { route: 'DND', send_manager_sms: true, manager_sms: 'DND requested.' }, response: { validated: { sms_response: 'Do not send.' } } });
assert.equal(dnd.response, null);
assert.equal(dnd.send_user_response, false);
assert.equal(dnd.send_manager_sms, true);
assert.equal(dnd.manager_sms, 'DND requested.');
const escalation = format({ decision: { route: 'ESCALATION', send_manager_sms: true, manager_sms: 'Please review.' }, response: { validated: { sms_response: 'A manager will follow up.' } } });
assert.equal(escalation.response, 'A manager will follow up.');
assert.equal(escalation.user_response, escalation.response);
assert.equal(escalation.send_user_response, true);
assert.equal(escalation.send_manager_sms, true);
const blockedEscalation = format({ decision: { route: 'ESCALATION', block_delivery: true, send_manager_sms: true, manager_sms: 'Please review.' }, response: { validated: { sms_response: 'Do not send.' } } });
assert.equal(blockedEscalation.response, null);
assert.equal(blockedEscalation.user_response, null);
assert.equal(blockedEscalation.send_user_response, false);
assert.equal(blockedEscalation.send_manager_sms, true);
const managerOnly = format({ decision: { route: 'ESCALATION', send_manager_sms: true, manager_sms: 'Please review.' }, response: { validated: { sms_response: null } } });
assert.equal(managerOnly.send_user_response, false);
assert.equal(managerOnly.send_manager_sms, true);
assert.equal(format({ decision: { route: 'ESCALATION', send_manager_sms: true, manager_sms: null }, response: { validated: { sms_response: 'Acknowledged.' } } }).send_manager_sms, false);
assert.equal(format({ decision: { send_user_response: null }, response: { validated: { sms_response: 'Do not send.' } } }).send_user_response, false);

// Booking is true only for an explicit BOOKED signal with both date and time.
const booking = (signal, date, time) => format({ decision: { route: 'BOOKING' }, intelligence: { appointment: { signal } }, response: { validated: { sms_response: 'Visit details.', booking_date: date, booking_time: time } } });
const confirmed = booking('BOOKED', '2026-09-15', '10:00');
assert.equal(confirmed.booking_status, true);
assert.equal(confirmed.fe_lead_status, 'Appointment Booked');
assert.equal(confirmed.lead_status, 'Visit Booked');
for (const partial of [booking('BOOKED', '2026-09-15', null), booking('BOOKED', null, '10:00'), booking('BOOKED', null, null), booking('RESCHEDULE', '2026-09-15', '10:00')]) {
  assert.equal(partial.booking_status, false);
  assert.notEqual(partial.fe_lead_status, 'Appointment Booked');
  assert.notEqual(partial.lead_status, 'Visit Booked');
}
const cancelled = format({ intelligence: { appointment: { signal: 'CANCEL' } }, response: { validated: { sms_response: 'Cancellation requested.' } } });
assert.equal(cancelled.appointment_cancellation_requested, true);
assert.equal(cancelled.fe_lead_status, 'Appointment Cancellation Requested');

// Every route exposes the canonical terminal contract and normalized request field.
const required = ['lead_status', 'lead_name', 'lead_mail', 'lead_phone', 'source', 'message_id', 'create_lead', 'update_lead', 'sender_number', 'recipient_number', 'user_language', 'appointment_cancellation_requested', 'response', 'request_query', 'parent_message_id', 'fe_lead_status', 'send_user_response', 'send_manager_sms', 'manager_sms'];
for (const route of ['GENERAL', 'DND', 'ESCALATION', 'EMAIL_HANDOFF', 'BOOKING', 'VISIT']) {
  const out = validateAndFormat({ decision: { route, send_manager_sms: route === 'DND' || route === 'ESCALATION', manager_sms: 'Review.' }, intelligence: { appointment: { signal: route === 'BOOKING' ? 'BOOKED' : 'NONE' } }, response: { candidate: { sms_response: 'Hello.', email_body: 'Email hello.', booking_date: '2026-09-15', booking_time: '10:00' } } });
  for (const field of required) assert.ok(Object.hasOwn(out, field), `${route} missing ${field}`);
  assert.equal(out.request_query, 'Can you help?');
  assert.equal(typeof out.send_user_response, 'boolean');
  assert.equal(typeof out.send_manager_sms, 'boolean');
}

console.log('SMS-21 validator/output formatter regression checks passed.');
