// Tells the AI service (agentic-upsell) that something happened: a new lead
// or a customer reply (MASTER_PLAN_1 Stage 5, BPLAN Phase 2).
//
// The contract is agentic-upsell's POST /v1/events/{type} (architecture §11):
// shared-secret auth, one event id per lead / Email record, 202 when queued,
// 200 {"status": "duplicate"} when that event was already accepted.
//
// Rules:
// - 2-second timeout. A worker is never held up waiting for the AI service.
// - sendAiEvent() never throws. A retryable failure (timeout, network, 5xx,
//   429) goes on a small BullMQ retry queue: 5 attempts, doubling delay from
//   2s. A permanent failure (401, 422, ...) is logged, not retried.
// - Event ids are stable (Lead _id / Email _id), so a retry the AI service
//   already accepted is answered as a duplicate and runs no second turn.

import { Queue, UnrecoverableError } from 'bullmq';
import Redis from 'ioredis';

export const AI_EVENT_TYPES = Object.freeze(['lead-created', 'inbound-message', 'lead-paused', 'lead-resumed']);
export const AI_EVENT_RETRY_QUEUE = 'aiEventRetryQueue';
export const AI_EVENT_TIMEOUT_MS = 2_000;
export const AI_EVENT_RETRY_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
});

export class AiEventError extends Error {
  constructor(message, { status = null, retryable = true } = {}) {
    super(message);
    this.name = 'AiEventError';
    this.status = status;
    this.retryable = retryable;
  }
}

function defaultBaseUrl() {
  return (process.env.UPSELL_AGENT_API_URL || 'http://localhost:8100').replace(/\/$/, '');
}

// One POST. Resolves with the service's JSON answer; throws AiEventError.
export async function postAiEvent(type, payload, {
  fetchImpl = fetch,
  baseUrl = defaultBaseUrl(),
  secret = process.env.UPSELL_SERVICE_SHARED_SECRET,
  timeoutMs = AI_EVENT_TIMEOUT_MS,
} = {}) {
  if (!AI_EVENT_TYPES.includes(type)) {
    throw new AiEventError(`unknown AI event type ${type}`, { retryable: false });
  }
  if (!secret) {
    throw new AiEventError('UPSELL_SERVICE_SHARED_SECRET is not set', { retryable: false });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/events/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    throw new AiEventError(timedOut ? `AI service did not answer within ${timeoutMs}ms` : `AI service unreachable: ${error?.message}`,
      { retryable: true });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 200 || response.status === 202) {
    return response.json().catch(() => ({}));
  }
  const detail = await response.text().catch(() => '');
  const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
  throw new AiEventError(`AI service answered ${response.status}: ${detail.slice(0, 300)}`,
    { status: response.status, retryable });
}

let retryQueue = null;

function redisConnection() {
  if (process.env.REDIS_URL) return new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    db: Number(process.env.REDIS_DB || 0),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });
}

export function getAiEventRetryQueue() {
  if (!retryQueue) retryQueue = new Queue(AI_EVENT_RETRY_QUEUE, { connection: redisConnection() });
  return retryQueue;
}

// BullMQ custom job ids may not contain ':'.
export function retryJobId(type, payload) {
  return `${type}__${payload?.event_id ?? 'unknown'}`;
}

async function defaultEnqueueRetry(type, payload) {
  await getAiEventRetryQueue().add('deliverAiEvent', { type, payload }, {
    ...AI_EVENT_RETRY_OPTIONS,
    jobId: retryJobId(type, payload),
  });
}

// Fire-and-forget from a worker's point of view: never throws.
// Returns { status: 'delivered' | 'queued_for_retry' | 'rejected' | 'lost', ... }.
export async function sendAiEvent(type, payload, {
  post = postAiEvent,
  enqueueRetry = defaultEnqueueRetry,
  logger = console,
} = {}) {
  try {
    const response = await post(type, payload);
    logger.info?.('[ai] event delivered', { type, event_id: payload?.event_id, status: response?.status });
    return { status: 'delivered', response };
  } catch (error) {
    if (error?.retryable === false) {
      logger.error?.('[ai] event rejected, not retrying', { type, event_id: payload?.event_id, error: error.message });
      return { status: 'rejected', error: error.message };
    }
    try {
      await enqueueRetry(type, payload);
      logger.warn?.('[ai] event delivery failed; queued for retry', { type, event_id: payload?.event_id, error: error?.message });
      return { status: 'queued_for_retry', error: error?.message };
    } catch (queueError) {
      logger.error?.('[ai] event LOST: delivery and retry queue both failed', {
        type, event_id: payload?.event_id, error: error?.message, queue_error: queueError?.message,
      });
      return { status: 'lost', error: error?.message };
    }
  }
}

// BullMQ processor for the retry queue (registered in app/worker/worker.js).
// Throwing makes BullMQ retry; UnrecoverableError stops the retries.
export async function processAiEventRetryJob(job, { post = postAiEvent } = {}) {
  const { type, payload } = job.data;
  try {
    return await post(type, payload);
  } catch (error) {
    if (error?.retryable === false) throw new UnrecoverableError(error.message);
    throw error;
  }
}
