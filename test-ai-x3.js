// PLAN_4 stream X3: the AI path on production's data model, outages, intake.
// No database or network: every dependency is injected (an in-memory
// collection stands in for MongoDB).   Run: node --test test-ai-x3.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInboundMessageEvent,
  buildLeadCreatedEvent,
  customerIdForLead,
  derivedCustomerKey,
  isAutoReplyRecord,
  notifyAiOfInbound,
  notifyAiOfNewLead,
} from './app/lib/ai/aiDispatch.js';
import { AiEventError, processAiEventRetryJob, sendAiEvent } from './app/lib/ai/aiEvents.js';
import { aiMayChangeBooking } from './app/lib/ai/aiOwnership.js';
import { AI_OUTBOX_MAX_AGE_MS, replayAiOutbox, storeUndeliveredEvent } from './app/lib/ai/aiOutbox.js';

const DEALER = '64b000000000000000000001';
const LEAD = '64b0000000000000000000aa';
const quiet = { info() {}, warn() {}, error() {} };

// A tiny stand-in for a MongoDB collection: updateOne with upsert/$set/$setOnInsert/$inc, find().sort().limit().
function memoryCollection() {
  const rows = [];
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) => row[k] === v);
  return {
    rows,
    async updateOne(filter, update, options = {}) {
      let row = rows.find((r) => matches(r, filter));
      if (!row && options.upsert) {
        row = { _id: rows.length + 1, ...filter, ...(update.$setOnInsert || {}) };
        rows.push(row);
      }
      if (!row) return { matchedCount: 0 };
      Object.assign(row, update.$set || {});
      for (const [k, v] of Object.entries(update.$inc || {})) row[k] = (row[k] || 0) + v;
      return { matchedCount: 1 };
    },
    find(filter) {
      let out = rows.filter((r) => matches(r, filter));
      const cursor = {
        sort() { out = [...out].sort((a, b) => a.created_at - b.created_at); return cursor; },
        limit(n) { out = out.slice(0, n); return cursor; },
        async toArray() { return out; },
      };
      return cursor;
    },
  };
}

// --- Item 1: production leads have no customer_id ----------------------------------

test('a lead without customer_id still gets an event, keyed by its normalised phone (production data model)', () => {
  const lead = { _id: LEAD, dealer_id: DEALER, phone: '+1 (555) 123-4567' };
  const event = buildLeadCreatedEvent({ lead, dealerId: DEALER, channel: 'sms' });
  assert.ok(event, 'production leads must not be dropped');
  assert.equal(event.customer_id, 'ck_e66ba7182e8ddaafc62c404c', 'same vector as agentic-upsell test_customer_key.py');
  const inbound = buildInboundMessageEvent({ emailRecord: { _id: 'e1', mail_content: 'hi' }, lead, dealerId: DEALER,
    channel: 'sms' });
  assert.equal(inbound.customer_id, event.customer_id, 'every event of the customer carries the same key');
});

test('the derived key is stable across phone formats, per dealer, and falls back to email', () => {
  const a = derivedCustomerKey({ dealerId: DEALER, phone: '5551234567' });
  assert.equal(a, derivedCustomerKey({ dealerId: DEALER, phone: '+15551234567' }));
  assert.equal(a, derivedCustomerKey({ dealerId: DEALER, phone: '(555) 123-4567', email: 'x@y.com' }), 'phone wins');
  assert.notEqual(a, derivedCustomerKey({ dealerId: '64b000000000000000000002', phone: '5551234567' }), 'per dealer');
  assert.equal(derivedCustomerKey({ dealerId: DEALER, email: ' Jane@X.com ' }), 'ck_d5f50d486e195b6dad1f728b');
  assert.equal(derivedCustomerKey({ dealerId: DEALER, phone: '123', email: 'n/a' }), null);
  assert.equal(customerIdForLead({ customer_id: 'c1', phone: '5551234567' }, DEALER), 'c1', 'the CRM link wins');
  assert.equal(customerIdForLead({ ai_customer_key: 'ck_x', phone: '5551234567' }, DEALER), 'ck_x');
});

test('live: a lead the AI cannot take gets a staff note, never silence', async () => {
  const notes = [];
  const fallback = async (args) => { notes.push(args); return true; };
  const remember = async () => null;
  const send = async () => ({ status: 'rejected', error: 'AI service answered 422' });
  const lead = { _id: LEAD, dealer_id: DEALER, phone: '5551234567' };
  const result = await notifyAiOfNewLead({ lead, dealerId: DEALER, channel: 'sms', mode: 'live', send, logger: quiet,
    fallback, remember });
  assert.equal(result.fallback, 'staff_note');
  assert.equal(notes[0].type, 'lead-created');
  assert.equal(String(notes[0].leadId), LEAD);

  const noContact = await notifyAiOfInbound({ emailRecord: { _id: 'e2' }, lead: { _id: LEAD }, dealerId: DEALER,
    channel: 'sms', mode: 'live', send, logger: quiet, fallback, remember });
  assert.equal(noContact.status, 'skipped');
  assert.equal(notes.length, 2);

  // shadow: n8n still answers, so no note
  await notifyAiOfNewLead({ lead, dealerId: DEALER, channel: 'sms', mode: 'shadow', send, logger: quiet, fallback,
    remember });
  assert.equal(notes.length, 2);
  // delivered / queued: the AI will answer
  await notifyAiOfNewLead({ lead, dealerId: DEALER, channel: 'sms', mode: 'live', logger: quiet, fallback, remember,
    send: async () => ({ status: 'queued_for_retry' }) });
  assert.equal(notes.length, 2);
});

test('a derived key is remembered on the lead for the AI to find the customer\'s leads', async () => {
  const remembered = [];
  const lead = { _id: LEAD, dealer_id: DEALER, phone: '5551234567' };
  await notifyAiOfNewLead({ lead, dealerId: DEALER, channel: 'sms', mode: 'live', logger: quiet,
    send: async () => ({ status: 'delivered' }), fallback: async () => true,
    remember: async (l, d) => { remembered.push([String(l._id), d]); } });
  assert.deepEqual(remembered, [[LEAD, DEALER]]);
});

// --- Item 6: outages ------------------------------------------------------------

test('an event that cannot be delivered nor queued is stored for replay, not lost', async () => {
  const coll = memoryCollection();
  const payload = { event_id: LEAD, dealer_id: DEALER, lead_id: LEAD, customer_id: 'c1', channel: 'sms' };
  const result = await sendAiEvent('lead-created', payload, {
    post: async () => { throw new AiEventError('down'); },
    enqueueRetry: async () => { throw new Error('redis down'); },
    storeUndelivered: (type, p, opts) => storeUndeliveredEvent(type, p, { ...opts, collection: coll }),
    logger: quiet,
  });
  assert.equal(result.status, 'stored_for_replay');
  assert.equal(coll.rows.length, 1);
  assert.equal(coll.rows[0].status, 'pending');
});

test('the last failed retry stores the event for replay', async () => {
  const stored = [];
  const job = { data: { type: 'inbound-message', payload: { event_id: 'e1' } }, attemptsMade: 4, opts: { attempts: 5 } };
  await assert.rejects(processAiEventRetryJob(job, {
    post: async () => { throw new AiEventError('503'); },
    storeUndelivered: async (type, payload) => { stored.push([type, payload.event_id]); return true; },
  }));
  assert.deepEqual(stored, [['inbound-message', 'e1']]);
  const early = { ...job, attemptsMade: 1 };
  await assert.rejects(processAiEventRetryJob(early, { post: async () => { throw new AiEventError('503'); },
    storeUndelivered: async () => { stored.push('early'); return true; } }));
  assert.equal(stored.length, 1, 'only the last attempt stores');
});

test('replay delivers stored events once the AI is back, stops while it is down, expires old ones', async () => {
  const coll = memoryCollection();
  const t0 = new Date('2026-10-04T10:00:00Z');
  await storeUndeliveredEvent('lead-created', { event_id: 'a', dealer_id: DEALER }, { collection: coll, now: () => t0, logger: quiet });
  await storeUndeliveredEvent('inbound-message', { event_id: 'b', dealer_id: DEALER },
    { collection: coll, now: () => new Date(t0.getTime() + 1000), logger: quiet });
  await storeUndeliveredEvent('lead-created', { event_id: 'a', dealer_id: DEALER }, { collection: coll, now: () => t0, logger: quiet });
  assert.equal(coll.rows.length, 2, 'stored once per event');

  let down = true;
  const posted = [];
  const post = async (type, payload) => { if (down) throw new AiEventError('down'); posted.push(payload.event_id); };
  let counts = await replayAiOutbox({ post, collection: coll, now: () => new Date(t0.getTime() + 60_000), logger: quiet });
  assert.equal(counts.still_down, 1);
  down = false;
  counts = await replayAiOutbox({ post, collection: coll, now: () => new Date(t0.getTime() + 120_000), logger: quiet });
  assert.deepEqual(posted, ['a', 'b']);
  assert.equal(counts.delivered, 2);
  counts = await replayAiOutbox({ post, collection: coll, now: () => new Date(t0.getTime() + 180_000), logger: quiet });
  assert.equal(counts.delivered, 0, 'never replayed twice');

  const expired = [];
  await storeUndeliveredEvent('lead-created', { event_id: 'c', dealer_id: DEALER }, { collection: coll, now: () => t0, logger: quiet });
  counts = await replayAiOutbox({ post, collection: coll, now: () => new Date(t0.getTime() + AI_OUTBOX_MAX_AGE_MS + 1),
    onExpired: async (row) => expired.push(row.event_id), logger: quiet });
  assert.equal(counts.expired, 1);
  assert.deepEqual(expired, ['c']);
});

// --- Item 10: auto-responders ---------------------------------------------------

test('auto-reply headers mark the inbound event so the AI does not answer an out-of-office', () => {
  const lead = { _id: LEAD, dealer_id: DEALER, email: 'a@b.co' };
  const ooo = { _id: 'e9', mail_content: 'Thanks', headers: { 'Auto-Submitted': 'auto-replied' } };
  assert.equal(buildInboundMessageEvent({ emailRecord: ooo, lead, dealerId: DEALER, channel: 'email' }).auto_reply, true);
  assert.ok(isAutoReplyRecord({ headers: { 'X-Autoreply': 'yes' } }));
  assert.ok(isAutoReplyRecord({ headers: { precedence: 'auto_reply' } }));
  assert.ok(!isAutoReplyRecord({ headers: { 'Auto-Submitted': 'no' } }));
  assert.ok(!isAutoReplyRecord({}));
  const normal = buildInboundMessageEvent({ emailRecord: { _id: 'e8', mail_content: 'hi' }, lead, dealerId: DEALER,
    channel: 'email' });
  assert.equal('auto_reply' in normal, false, 'the payload is unchanged for ordinary messages');
});

// --- Item 11: dealer ownership on internal calls -----------------------------------

test('the AI may change a booking only when it names the booking\'s own dealer', () => {
  const booking = { dealer_id: DEALER };
  assert.equal(aiMayChangeBooking({ kind: 'ai' }, booking, DEALER), true);
  assert.equal(aiMayChangeBooking({ kind: 'ai' }, booking, '64b000000000000000000002'), false);
  assert.equal(aiMayChangeBooking({ kind: 'ai' }, booking, undefined), false, 'no dealer named: refused');
  assert.equal(aiMayChangeBooking({ kind: 'staff' }, booking, undefined), true, 'staff rules are unchanged');
});
