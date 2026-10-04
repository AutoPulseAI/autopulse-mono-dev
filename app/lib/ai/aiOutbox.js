// Events the AI service never received are kept, not lost (PLAN_4 stream X3
// items 1 and 6).
//
// - An event whose BullMQ retries are all used up, or that could not even be
//   queued (Redis down), is stored in the `ai_event_outbox` collection and
//   replayed by replayAiOutbox() (registered on an interval in
//   app/worker/worker.js) once the AI service answers again. Event ids are
//   stable (Lead _id / Email _id) and the AI dedupes on them, so a replay of
//   something it already took is answered "duplicate" and runs no second turn.
// - An event the AI cannot take at all (rejected as invalid, or no customer
//   key / channel could be built) is never dropped silently either: in `live`
//   mode the lead gets an internal note so staff answer by hand (n8n is off
//   for live dealers, so a person is the CRM's fallback).
//
// The AI service also runs its own reconciliation over leads and emails
// (agentic-upsell scheduler/reconcile.py), so even an event lost before it
// reached this file is found.
//
// Dependencies are injected so it is tested against MongoDB directly.

export const AI_OUTBOX_COLLECTION = 'ai_event_outbox';
export const AI_OUTBOX_REPLAY_EVERY_MS = 2 * 60_000;
// Older than this is not replayed (a customer would get an answer days late); staff get a note instead.
export const AI_OUTBOX_MAX_AGE_MS = 24 * 60 * 60_000;
const REPLAY_BATCH = 100;

async function defaultCollection() {
  const mongoose = (await import('mongoose')).default;
  return mongoose.connection.collection(AI_OUTBOX_COLLECTION);
}

// Never throws. Returns true when stored (or already stored).
export async function storeUndeliveredEvent(type, payload, { reason = null, collection = null, now = () => new Date(),
  logger = console } = {}) {
  try {
    const coll = collection || await defaultCollection();
    const at = now();
    await coll.updateOne(
      { type, event_id: String(payload?.event_id) },
      {
        $setOnInsert: { type, event_id: String(payload?.event_id), payload, dealer_id: payload?.dealer_id ?? null,
          lead_id: payload?.lead_id ?? null, created_at: at, status: 'pending', attempts: 0 },
        $set: { last_error: reason ? String(reason).slice(0, 500) : null, updated_at: at },
      },
      { upsert: true },
    );
    logger.warn?.('[ai] event stored for replay', { type, event_id: payload?.event_id });
    return true;
  } catch (error) {
    logger.error?.('[ai] event LOST: could not store it for replay', { type, event_id: payload?.event_id,
      error: error?.message });
    return false;
  }
}

// Replays pending events oldest first. Stops at the first delivery failure that
// is retryable (the service is still down). Returns counts.
// `skip(row)`: true when the event no longer applies (the dealer switched the AI off meanwhile).
export async function replayAiOutbox({ post, collection = null, now = () => new Date(), onExpired = null,
  skip = null, logger = console, limit = REPLAY_BATCH } = {}) {
  const coll = collection || await defaultCollection();
  const counts = { delivered: 0, rejected: 0, expired: 0, still_down: 0, skipped: 0 };
  const rows = await coll.find({ status: 'pending' }).sort({ created_at: 1 }).limit(limit).toArray();
  for (const row of rows) {
    const at = now();
    if (skip && await skip(row)) {
      await coll.updateOne({ _id: row._id }, { $set: { status: 'skipped', updated_at: at } });
      counts.skipped += 1;
      continue;
    }
    if (at - new Date(row.created_at) > AI_OUTBOX_MAX_AGE_MS) {
      await coll.updateOne({ _id: row._id }, { $set: { status: 'expired', updated_at: at } });
      counts.expired += 1;
      if (onExpired) await onExpired(row).catch(() => {});
      continue;
    }
    try {
      await post(row.type, row.payload);
      await coll.updateOne({ _id: row._id }, { $set: { status: 'delivered', delivered_at: at, updated_at: at },
        $inc: { attempts: 1 } });
      counts.delivered += 1;
    } catch (error) {
      if (error?.retryable === false) {
        await coll.updateOne({ _id: row._id }, { $set: { status: 'rejected', last_error: error.message, updated_at: at },
          $inc: { attempts: 1 } });
        counts.rejected += 1;
        if (onExpired) await onExpired(row).catch(() => {});
        continue;
      }
      await coll.updateOne({ _id: row._id }, { $set: { last_error: error?.message, updated_at: at },
        $inc: { attempts: 1 } });
      counts.still_down += 1;
      break;
    }
  }
  if (counts.delivered || counts.rejected || counts.expired) logger.info?.('[ai] outbox replay', counts);
  return counts;
}

const FALLBACK_TEXT = {
  'lead-created': 'The AI could not take this new lead',
  'inbound-message': 'The AI could not answer this customer message',
};

// Live mode only: the AI will not answer, so a person must. Never throws.
export async function noteForStaff({ type, leadId, dealerId, reason, addNote = null, logger = console }) {
  if (!leadId || !dealerId) return false;
  try {
    const add = addNote || (async (body) => {
      const [{ addAiLeadNote }, Lead, Email] = await Promise.all([
        import('./aiDnd.js'), import('../../models/Lead.js'), import('../../models/Email.js')]);
      return addAiLeadNote(body, { Lead: Lead.default, Email: Email.default });
    });
    await add({
      dealer_id: String(dealerId), lead_id: String(leadId), kind: 'ai_fallback',
      idempotency_key: `fallback_${type}_${String(leadId)}_${String(reason || '').slice(0, 40).replace(/\W+/g, '_')}`,
      text: `${FALLBACK_TEXT[type] || 'The AI could not take this event'} (${reason || 'unknown reason'}). `
        + 'Please reply to the customer by hand.',
    });
    return true;
  } catch (error) {
    logger.error?.('[ai] could not add the fallback note', { lead_id: String(leadId), error: error?.message });
    return false;
  }
}
