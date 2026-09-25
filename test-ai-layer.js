// Unit tests for the platform side of the AI layer (agentic-upsell
// MASTER_PLAN_1 Stages 5 and 11). No database or network: every dependency is
// injected.   Run: node --test test-ai-layer.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { UnrecoverableError } from 'bullmq';

import { aiRouting, clearAiModeCache, effectiveAiMode, getDealerAiMode, invalidateDealerAiMode } from './app/lib/ai/aiMode.js';
import { AiEventError, postAiEvent, processAiEventRetryJob, retryJobId, sendAiEvent } from './app/lib/ai/aiEvents.js';
import {
  buildInboundMessageEvent,
  buildLeadCreatedEvent,
  leadChannel,
  notifyAiOfInbound,
  notifyAiOfNewLead,
} from './app/lib/ai/aiDispatch.js';
import {
  buildAiEmailDocument,
  validateAiMessagePayload,
  validateStatusPayload,
} from './app/lib/ai/aiMessageRecord.js';
import { parseSenderHeader } from './app/lib/ai/aiInbound.js';
import {
  STAFF_OWNED_STATUSES,
  buildLeadPausedEvent,
  buildLeadResumedEvent,
  notifyAiOfStaffReply,
  notifyAiOfStaffStatus,
  pauseAiForLead,
  resumeAiForLead,
} from './app/lib/ai/aiStaff.js';
import { aiOwnsFollowUps } from './app/lib/followupService.js';

const quiet = { info() {}, warn() {}, error() {} };
const DEALER = '66f0000000000000000000a1';
const LEAD = '66f00000000000000000beef';

// --- aiMode ---------------------------------------------------------------------

test('effectiveAiMode: unknown or missing mode is off; auto-replies off means AI off', () => {
  assert.equal(effectiveAiMode(null), 'off');
  assert.equal(effectiveAiMode({}), 'off');
  assert.equal(effectiveAiMode({ ai_mode: 'bogus' }), 'off');
  assert.equal(effectiveAiMode({ ai_mode: 'live' }), 'live');
  assert.equal(effectiveAiMode({ ai_mode: 'shadow', setting: { autoReplyEnabled: true } }), 'shadow');
  assert.equal(effectiveAiMode({ ai_mode: 'live', setting: { autoReplyEnabled: false } }), 'off');
});

test('aiRouting: what each mode does', () => {
  assert.deepEqual(aiRouting('off'), { mode: 'off', callN8n: true, sendEvent: false, shadow: false, aiReplies: false });
  assert.deepEqual(aiRouting('shadow'), { mode: 'shadow', callN8n: true, sendEvent: true, shadow: true, aiReplies: false });
  assert.deepEqual(aiRouting('live'), { mode: 'live', callN8n: false, sendEvent: true, shadow: false, aiReplies: true });
  assert.equal(aiRouting('nonsense').mode, 'off');
});

test('getDealerAiMode caches for 60s, and invalidate forces a reload', async () => {
  clearAiModeCache();
  let loads = 0;
  let clock = 1_000;
  let stored = { ai_mode: 'live' };
  const opts = { load: async () => { loads += 1; return stored; }, now: () => clock, logger: quiet };

  assert.equal(await getDealerAiMode(DEALER, opts), 'live');
  stored = { ai_mode: 'off' };
  clock += 59_000;
  assert.equal(await getDealerAiMode(DEALER, opts), 'live', 'still cached');
  clock += 2_000;
  assert.equal(await getDealerAiMode(DEALER, opts), 'off', 'reloaded after 60s');
  stored = { ai_mode: 'shadow' };
  invalidateDealerAiMode(DEALER);
  assert.equal(await getDealerAiMode(DEALER, opts), 'shadow');
  assert.equal(loads, 3);
});

test('getDealerAiMode falls back to off when the lookup fails', async () => {
  clearAiModeCache();
  const mode = await getDealerAiMode(DEALER, { load: async () => { throw new Error('db down'); }, logger: quiet });
  assert.equal(mode, 'off');
  assert.equal(await getDealerAiMode(null), 'off');
});

// --- aiEvents: postAiEvent --------------------------------------------------------

function fakeFetch(status, body = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { impl, calls };
}

const payload = { event_id: LEAD, dealer_id: DEALER, lead_id: LEAD, customer_id: 'c1', channel: 'sms' };

test('postAiEvent posts to the AI service with the shared secret', async () => {
  const { impl, calls } = fakeFetch(202, { status: 'queued' });
  const result = await postAiEvent('lead-created', payload, { fetchImpl: impl, baseUrl: 'http://ai:8100', secret: 's3cret' });
  assert.deepEqual(result, { status: 'queued' });
  assert.equal(calls[0].url, 'http://ai:8100/v1/events/lead-created');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer s3cret');
  assert.deepEqual(JSON.parse(calls[0].init.body), payload);
});

test('postAiEvent: a duplicate (200) is success', async () => {
  const { impl } = fakeFetch(200, { status: 'duplicate' });
  assert.deepEqual(await postAiEvent('lead-created', payload, { fetchImpl: impl, secret: 's' }), { status: 'duplicate' });
});

test('postAiEvent: 4xx is permanent, 5xx / 429 / timeouts are retryable', async () => {
  for (const [status, retryable] of [[401, false], [422, false], [404, false], [500, true], [503, true], [429, true]]) {
    const { impl } = fakeFetch(status);
    await assert.rejects(postAiEvent('lead-created', payload, { fetchImpl: impl, secret: 's' }),
      (error) => error instanceof AiEventError && error.retryable === retryable && error.status === status);
  }
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => {
    const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
  }));
  await assert.rejects(postAiEvent('lead-created', payload, { fetchImpl: hang, secret: 's', timeoutMs: 20 }),
    (error) => error.retryable === true && /within 20ms/.test(error.message));
});

test('postAiEvent refuses to send without a secret or with an unknown type', async () => {
  await assert.rejects(postAiEvent('lead-created', payload, { secret: '' }), (e) => e.retryable === false);
  await assert.rejects(postAiEvent('lead-deleted', payload, { secret: 's' }), (e) => e.retryable === false);
});

// --- aiEvents: sendAiEvent / retry job -------------------------------------------

test('sendAiEvent: delivered on success, no retry queued', async () => {
  const queued = [];
  const result = await sendAiEvent('lead-created', payload, {
    post: async () => ({ status: 'queued' }), enqueueRetry: async (...a) => queued.push(a), logger: quiet,
  });
  assert.equal(result.status, 'delivered');
  assert.equal(queued.length, 0);
});

test('sendAiEvent: a retryable failure goes on the retry queue, never throws', async () => {
  const queued = [];
  const result = await sendAiEvent('lead-created', payload, {
    post: async () => { throw new AiEventError('timeout', { retryable: true }); },
    enqueueRetry: async (type, body) => queued.push({ type, body }),
    logger: quiet,
  });
  assert.equal(result.status, 'queued_for_retry');
  assert.deepEqual(queued, [{ type: 'lead-created', body: payload }]);
});

test('sendAiEvent: a permanent failure is not retried', async () => {
  const queued = [];
  const result = await sendAiEvent('lead-created', payload, {
    post: async () => { throw new AiEventError('401', { status: 401, retryable: false }); },
    enqueueRetry: async (...a) => queued.push(a), logger: quiet,
  });
  assert.equal(result.status, 'rejected');
  assert.equal(queued.length, 0);
});

test('sendAiEvent: even the retry queue being down does not throw', async () => {
  const result = await sendAiEvent('lead-created', payload, {
    post: async () => { throw new AiEventError('down'); },
    enqueueRetry: async () => { throw new Error('redis down'); },
    logger: quiet,
  });
  assert.equal(result.status, 'lost');
});

test('retry job: 5xx rethrows (BullMQ retries), 4xx stops retrying', async () => {
  const job = { data: { type: 'lead-created', payload } };
  await assert.rejects(processAiEventRetryJob(job, { post: async () => { throw new AiEventError('503', { retryable: true }); } }),
    (e) => !(e instanceof UnrecoverableError));
  await assert.rejects(processAiEventRetryJob(job, { post: async () => { throw new AiEventError('422', { retryable: false }); } }),
    (e) => e instanceof UnrecoverableError);
  assert.deepEqual(await processAiEventRetryJob(job, { post: async () => ({ status: 'queued' }) }), { status: 'queued' });
});

test('retry job ids are stable per event and contain no colon', () => {
  assert.equal(retryJobId('lead-created', payload), `lead-created__${LEAD}`);
  assert.ok(!retryJobId('inbound-message', { event_id: 'x' }).includes(':'));
});

// --- aiDispatch: payloads ---------------------------------------------------------

test('leadChannel: stated preference when reachable, else SMS when there is a phone, else email', () => {
  assert.equal(leadChannel({ phone: '+15551234567', email: 'a@b.co', followup_preference: 'email' }), 'email');
  assert.equal(leadChannel({ phone: '+15551234567', email: 'a@b.co', followup_preference: 'sms' }), 'sms');
  assert.equal(leadChannel({ phone: '+15551234567', email: 'a@b.co' }), 'sms');
  assert.equal(leadChannel({ phone: '', email: 'a@b.co', followup_preference: 'sms' }), 'email');
  assert.equal(leadChannel({ email: 'NA' }), null);
  assert.equal(leadChannel({}), null);
});

test('lead-created payload uses the Lead id as the event id', () => {
  const lead = { _id: LEAD, customer_id: 'cust1', dealer_id: DEALER };
  assert.deepEqual(buildLeadCreatedEvent({ lead, dealerId: DEALER, channel: 'sms', shadow: true }), {
    event_id: LEAD, dealer_id: DEALER, lead_id: LEAD, customer_id: 'cust1', channel: 'sms', shadow: true,
  });
  assert.equal(buildLeadCreatedEvent({ lead: { _id: LEAD }, dealerId: DEALER, channel: 'sms' }), null, 'no customer');
});

test('inbound-message payload uses the Email record id', () => {
  const date = new Date('2026-09-24T10:00:00Z');
  const event = buildInboundMessageEvent({
    emailRecord: { _id: 'e1', date, mail_content: 'hi there' },
    lead: { _id: LEAD, customer_id: 'cust1' }, dealerId: DEALER, channel: 'sms',
  });
  assert.deepEqual(event, {
    event_id: 'e1', dealer_id: DEALER, customer_id: 'cust1', lead_id: LEAD, channel: 'sms', message_id: 'e1',
    text: 'hi there', received_at: '2026-09-24T10:00:00.000Z', shadow: false,
  });
});

test('notify helpers: off does nothing, shadow marks the event, missing customer is skipped', async () => {
  const sent = [];
  const send = async (type, event) => { sent.push({ type, event }); return { status: 'delivered' }; };
  const lead = { _id: LEAD, customer_id: 'cust1', phone: '+15551234567' };

  assert.deepEqual(await notifyAiOfNewLead({ lead, dealerId: DEALER, mode: 'off', send, logger: quiet }), { status: 'off' });
  await notifyAiOfNewLead({ lead, dealerId: DEALER, mode: 'shadow', send, logger: quiet });
  assert.equal(sent[0].type, 'lead-created');
  assert.equal(sent[0].event.shadow, true);
  assert.equal(sent[0].event.channel, 'sms', 'channel derived from the lead');

  const skipped = await notifyAiOfNewLead({ lead: { _id: LEAD }, dealerId: DEALER, mode: 'live', send, logger: quiet });
  assert.equal(skipped.status, 'skipped');

  await notifyAiOfInbound({ emailRecord: { _id: 'e1', mail_content: 'x' }, lead, dealerId: DEALER, channel: 'email', mode: 'live', send, logger: quiet });
  assert.equal(sent[1].type, 'inbound-message');
  assert.equal(sent[1].event.shadow, false);
});

test('notify helpers never throw, even if sending blows up', async () => {
  const result = await notifyAiOfNewLead({
    lead: { _id: LEAD, customer_id: 'c' }, dealerId: DEALER, channel: 'sms', mode: 'live',
    send: async () => { throw new Error('boom'); }, logger: quiet,
  });
  assert.equal(result.status, 'error');
});

// --- aiMessageRecord ------------------------------------------------------------

const message = {
  dealer_id: DEALER, lead_id: LEAD, customer_id: 'cust1', channel: 'sms', to: '+15551234567',
  text: 'Hi Maria, thanks for reaching out!', subject: null, status: 'sent', provider_id: 'SM123',
  idempotency_key: 'turn1:sms', turn_id: 'turn1', is_fallback: false, sent_at: '2026-09-24T10:00:01Z',
};

test('record-message payload validation', () => {
  assert.deepEqual(validateAiMessagePayload(message).errors, []);
  const { errors } = validateAiMessagePayload({ ...message, dealer_id: 'nope', channel: 'fax', text: ' ', status: 'queued' });
  assert.equal(errors.length, 4);
  assert.deepEqual(validateAiMessagePayload(null).errors, ['body must be a JSON object']);
});

test('an AI SMS is stored with the dealer SMS number as sender, so replies thread back to the lead', () => {
  const dealer = { _id: DEALER, dealer_account_information: { sms_conversion_phone: '+15550000001' } };
  const doc = buildAiEmailDocument({ payload: message, dealer, emailAccount: null });
  assert.equal(doc.sender, '+15550000001');
  assert.equal(doc.recipient, '+15551234567');
  assert.equal(doc.communication_type, 'sms');
  assert.equal(doc.subject, 'SMS Conversation');
  assert.equal(doc.message_id, 'SM123');
  assert.equal(doc.status, 'sent');
  assert.equal(doc.dealer_id, DEALER);
  assert.equal(String(doc.lead_id), LEAD);
  assert.equal(doc.timestamp.toISOString(), '2026-09-24T10:00:01.000Z');
  assert.equal(doc.ai_generated, true);
  assert.equal(doc.ai_idempotency_key, 'turn1:sms');
});

test('an AI email is stored with the dealer mailbox as sender and its subject', () => {
  const email = { ...message, channel: 'email', to: 'maria@example.test', subject: 'Thanks for your inquiry',
    provider_id: null, is_fallback: true, status: 'failed' };
  const doc = buildAiEmailDocument({ payload: email, dealer: { _id: DEALER }, emailAccount: { email_address: 'sales@dealer.test' } });
  assert.equal(doc.sender, 'sales@dealer.test');
  assert.equal(doc.subject, 'Thanks for your inquiry');
  assert.equal(doc.message_id, 'ai-turn1:sms', 'falls back to a key-based id when the provider gave none');
  assert.equal(doc.status, 'failed');
  assert.equal(doc.ai_fallback, true);
});

test('a dealer with no SMS number still gets a visible record', () => {
  assert.equal(buildAiEmailDocument({ payload: message, dealer: { _id: DEALER } }).sender, 'AutoPulse AI');
});

test('status payload validation', () => {
  assert.deepEqual(validateStatusPayload({ dealer_id: DEALER, provider_id: 'SM1', status: 'delivered' }).errors, []);
  assert.equal(validateStatusPayload({ dealer_id: DEALER, provider_id: 'SM1', status: 'exploded' }).errors.length, 1);
});

// --- aiInbound: sender header ------------------------------------------------------

test('parseSenderHeader handles bare and display-name forms', () => {
  assert.deepEqual(parseSenderHeader('Jane Doe <Jane@Example.test>'), { email: 'jane@example.test', name: 'Jane Doe' });
  assert.deepEqual(parseSenderHeader('bob@example.test'), { email: 'bob@example.test', name: undefined });
  assert.equal(parseSenderHeader('not an address').email, null);
  assert.equal(parseSenderHeader(null).email, null);
});

// --- Stage 11: staff take over, no double messaging -----------------------------------

function eventRecorder() {
  const sent = [];
  return { sent, send: async (type, event) => { sent.push({ type, event }); return { status: 'delivered' }; } };
}

test('lead-paused / lead-resumed payloads match the AI service models', () => {
  assert.deepEqual(buildLeadPausedEvent({ leadId: LEAD, dealerId: DEALER, eventId: 'staff-reply-abc', reason: 'x' }),
    { event_id: 'staff-reply-abc', dealer_id: DEALER, lead_id: LEAD, reason: 'x' });
  assert.deepEqual(buildLeadResumedEvent({ leadId: LEAD, dealerId: DEALER, eventId: 'r1' }),
    { event_id: 'r1', dealer_id: DEALER, lead_id: LEAD });
  assert.equal(buildLeadPausedEvent({ dealerId: DEALER, eventId: 'x' }), null);
  // Event ids become BullMQ retry job ids, which may not contain ':'.
  assert.equal(buildLeadPausedEvent({ leadId: LEAD, dealerId: DEALER, eventId: 'a:b c/d' }).event_id, 'abcd');
});

test('a staff reply pauses the AI for live and shadow dealers, never for off', async () => {
  for (const mode of ['live', 'shadow']) {
    const r = eventRecorder();
    const result = await notifyAiOfStaffReply({ leadId: LEAD, dealerId: DEALER, emailRecordId: 'e1', staffName: 'Sam',
      mode, send: r.send, logger: quiet });
    assert.equal(result.status, 'delivered');
    assert.equal(r.sent[0].type, 'lead-paused');
    assert.equal(r.sent[0].event.event_id, 'staff-reply-e1');
    assert.equal(r.sent[0].event.reason, 'Staff replied by hand (Sam)');
  }
  const off = eventRecorder();
  assert.equal((await notifyAiOfStaffReply({ leadId: LEAD, dealerId: DEALER, emailRecordId: 'e1', mode: 'off',
    send: off.send, logger: quiet })).status, 'off');
  assert.equal(off.sent.length, 0);
});

test('moving a lead to a staff-owned status pauses the AI; other statuses do not', async () => {
  assert.deepEqual([...STAFF_OWNED_STATUSES], ['Appointment Booked', 'Visited', 'Sold', 'DND', 'Managerial Review']);
  const r = eventRecorder();
  await notifyAiOfStaffStatus({ leadId: LEAD, dealerId: DEALER, status: 'Appointment Booked', mode: 'live',
    send: r.send, logger: quiet, now: () => 42 });
  assert.equal(r.sent[0].event.event_id, `status-${LEAD}-AppointmentBooked-42`);
  assert.equal(r.sent[0].event.reason, 'Staff moved the lead to "Appointment Booked"');
  const none = eventRecorder();
  assert.equal((await notifyAiOfStaffStatus({ leadId: LEAD, dealerId: DEALER, status: 'Contacted', mode: 'live',
    send: none.send, logger: quiet })).status, 'not_needed');
  assert.equal(none.sent.length, 0);
});

test('admin pause and resume send unique events each time', async () => {
  const r = eventRecorder();
  let t = 0;
  await pauseAiForLead({ leadId: LEAD, dealerId: DEALER, by: 'admin1', mode: 'live', send: r.send, logger: quiet, now: () => ++t });
  await pauseAiForLead({ leadId: LEAD, dealerId: DEALER, mode: 'live', send: r.send, logger: quiet, now: () => ++t });
  await resumeAiForLead({ leadId: LEAD, dealerId: DEALER, mode: 'live', send: r.send, logger: quiet, now: () => ++t });
  assert.deepEqual(r.sent.map((s) => s.type), ['lead-paused', 'lead-paused', 'lead-resumed']);
  assert.equal(new Set(r.sent.map((s) => s.event.event_id)).size, 3);
  assert.equal(r.sent[0].event.reason, 'Taken over by staff (admin1)');
});

test('staff helpers never throw, even if sending blows up', async () => {
  const boom = async () => { throw new Error('network down'); };
  const result = await notifyAiOfStaffReply({ leadId: LEAD, dealerId: DEALER, emailRecordId: 'e1', mode: 'live',
    send: boom, logger: quiet });
  assert.equal(result.status, 'error');
});

test('FollowUpJobs belong to the AI only for live dealers', async () => {
  for (const [mode, owned] of [['live', true], ['shadow', false], ['off', false]]) {
    assert.equal(await aiOwnsFollowUps(DEALER, { getMode: async () => mode }), owned);
  }
});
