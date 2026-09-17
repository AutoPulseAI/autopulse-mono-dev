import { createHash } from 'node:crypto';
import { detectTradeCandidates } from './adfTradeCandidates.js';

export const TRADE_QUEUE = 'adf-trade-enrichment';
export const tradeJobOptions = {
  attempts: 6, backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 1000, removeOnFail: false,
};

export function logTradeEvent(event, context = {}, code) {
  // Never spread arbitrary context/job data or log exception messages.
  const ids = {};
  for (const key of ['raw_adf_payload_id', 'lead_id', 'customer_id', 'trade_id']) {
    if (/^[a-f0-9]{24}$/i.test(String(context[key] || ''))) ids[key] = String(context[key]);
  }
  console.info(JSON.stringify({ event: `adf_trade_${event}`, timestamp: new Date().toISOString(), ...ids,
    ...(code && /^[A-Z_]+$/.test(code) ? { code } : {}) }));
}

// Called from raw ADF capture, before lead parsing or its duplicate early return.
// Bounded enqueue time; any failure is local to optional enrichment.
export async function enqueueAdfTrades(raw, {
  queueProvider = async () => (await import('./queue.js')).getQueue(TRADE_QUEUE),
  log = logTradeEvent, timeoutMs = 1000,
} = {}) {
  if (process.env.ADF_TRADE_ENRICHMENT_ENABLED !== 'true') return;
  let timer;
  let timedOut = false;
  const context = { raw_adf_payload_id: raw?._id };
  try {
    if (!raw?._id || !raw.dealer_id || !raw.message_id) throw new Error('MISSING_SOURCE');
    const candidates = detectTradeCandidates(raw.raw_xml);
    if (!candidates.length) { log('no_trade_detected', context); return; }
    await Promise.race([
      (async () => {
        const queue = await queueProvider();
        for (const candidate of candidates) {
          if (timedOut) return;
          log('candidate_detected', context);
          const data = { raw_adf_payload_id: String(raw._id), dealer_id: String(raw.dealer_id),
            source_message_id: raw.message_id, source_candidate_key: candidate.key };
          const jobId = createHash('sha256').update(`${raw._id}:${candidate.key}`).digest('hex');
          await queue.add('extract-trade', data, { ...tradeJobOptions, jobId });
        }
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(new Error('ENQUEUE_TIMEOUT')); }, timeoutMs);
      }),
    ]);
  } catch {
    log('enqueue_failed', context, 'ENQUEUE_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
