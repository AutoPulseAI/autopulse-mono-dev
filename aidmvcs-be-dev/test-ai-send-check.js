// The campaign send check (agentic-upsell MASTER_PLAN_3 B3 item 7, decision
// 66): the campaign worker writes one request per text into `ai_send_checks`
// and waits for the AI service's answer. An in-memory collection stands in
// for MongoDB.   Run: node --test test-ai-send-check.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { blockReason, checkCampaignSend, requestKey } from './app/lib/ai/aiSendCheck.js';

function fakeCollection() {
  const rows = new Map();
  return {
    rows,
    async updateOne(filter, update, { upsert } = {}) {
      if (!rows.has(filter.request_key) && upsert) rows.set(filter.request_key, { ...update.$setOnInsert });
    },
    async findOne(filter) {
      return rows.get(filter.request_key) || null;
    },
  };
}

const request = { dealerId: 'd1', campaignId: 'c1', campaignLeadId: 'cl1', leadId: 'l1', phone: '5550000001' };

test('writes one pending request per campaign lead and attempt', async () => {
  const collection = fakeCollection();
  const first = await checkCampaignSend(request, { collection, waitMs: 0 });
  await checkCampaignSend(request, { collection, waitMs: 0 });
  assert.equal(first.decision, 'WAITING');
  assert.equal(collection.rows.size, 1);
  const row = collection.rows.get(requestKey('cl1', 0));
  assert.equal(row.status, 'pending');
  assert.equal(row.purpose, 'marketing');
  assert.equal(row.channel, 'sms');
  assert.equal(row.dealer_id, 'd1');
  await checkCampaignSend({ ...request, attempt: 1 }, { collection, waitMs: 0 });
  assert.equal(collection.rows.size, 2);
});

test('returns the answer the AI service wrote onto the entry', async () => {
  const collection = fakeCollection();
  const until = new Date('2026-09-23T13:00:00Z');
  setTimeout(() => {
    Object.assign(collection.rows.get(requestKey('cl1', 0)),
      { status: 'answered', decision: 'HOLD', until, reason: 'outside 08:00-20:00 customer time', rule: 'held' });
  }, 5);
  const answer = await checkCampaignSend(request, { collection, waitMs: 1000, pollMs: 2 });
  assert.deepEqual(answer, { decision: 'HOLD', until, reason: 'outside 08:00-20:00 customer time', rule: 'held' });
});

test('the report reason for a stopped text', () => {
  assert.equal(blockReason({ decision: 'BLOCK', reason: 'no text consent' }), 'no text consent');
  assert.match(blockReason({ decision: 'REVIEW', reason: 'CONSENT_REVIEW_REQUIRED' }), /^Needs review: /);
});
