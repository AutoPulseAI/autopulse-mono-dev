// The send check for campaign texts (agentic-upsell MASTER_PLAN_3 B3 item 7,
// architecture decision 66).
//
// The platform still sends campaign texts. Before each one, the campaign
// worker asks the AI service's send check through a shared queue collection,
// `ai_send_checks`: it writes one request per text, the AI service writes its
// answer onto that entry (ALLOW / HOLD <until> / REVIEW / BLOCK <reason>), and
// the worker acts on it. No HTTP call between the services; if the AI service
// is down, requests wait in the queue and the lead is retried later.
//
// Imports are relative (no @lib aliases) so the BullMQ workers, which run
// under plain Node, can use this module too.

import mongoose from 'mongoose';

export const SEND_CHECKS_COLLECTION = 'ai_send_checks';
// How long one worker job waits for the answer before re-queuing the lead.
export const ANSWER_WAIT_MS = 20_000;
export const POLL_EVERY_MS = 1_000;
// When there's no answer yet (the AI service is down or busy), try again this much later.
export const RETRY_UNANSWERED_MS = 60_000;

function defaultCollection() {
  return mongoose.connection.collection(SEND_CHECKS_COLLECTION);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One request per campaign lead per check attempt. A HOLD re-queues the lead
// with the next attempt number, so it's checked again at that time.
export function requestKey(campaignLeadId, attempt = 0) {
  return `campaign:${campaignLeadId}:${attempt}`;
}

// Writes the request (once per key) and waits for the AI service's answer.
// Returns { decision, until, reason, rule } or { decision: 'WAITING' }.
export async function checkCampaignSend(
  { dealerId, campaignId, campaignLeadId, leadId, customerId, phone, channel = 'sms', attempt = 0 },
  { collection = defaultCollection(), waitMs = ANSWER_WAIT_MS, pollMs = POLL_EVERY_MS, now = () => new Date() } = {},
) {
  const key = requestKey(campaignLeadId, attempt);
  await collection.updateOne(
    { request_key: key },
    {
      $setOnInsert: {
        request_key: key,
        dealer_id: String(dealerId),
        campaign_id: String(campaignId),
        campaign_lead_id: String(campaignLeadId),
        lead_id: leadId ? String(leadId) : null,
        customer_id: customerId ? String(customerId) : null,
        phone: phone || null,
        channel,
        purpose: 'marketing',
        status: 'pending',
        requested_at: now(),
      },
    },
    { upsert: true },
  );

  const deadline = Date.now() + waitMs;
  for (;;) {
    const entry = await collection.findOne({ request_key: key });
    if (entry?.status === 'answered') {
      return { decision: entry.decision, until: entry.until || null, reason: entry.reason || '', rule: entry.rule || '' };
    }
    if (Date.now() >= deadline) return { decision: 'WAITING' };
    await sleep(pollMs);
  }
}

// What the campaign report shows for an answer that stops the text.
export function blockReason(answer) {
  if (answer.decision === 'REVIEW') return `Needs review: ${answer.reason}`;
  return answer.reason || 'Blocked by the send check';
}
