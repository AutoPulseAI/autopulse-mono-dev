// Dealership on / off (Betsy, 25 Nov 2026 meeting: "I need to be able to turn a dealership on and off if they're not
// complying ... or not adhering to their contract. I need to be able to either pause them or deactivate them.").
// A super admin sets it on Admin > Dealers. Paused or deactivated: the dealership account and all its staff can't sign
// in, and a signed-in session stops at its next page load. AutoPulse's "login as" still works, so support can look.
// Nothing else changes: leads, data and the AI's settings stay as they are (the AI is switched in Admin > AI mode).
import User from '../models/User.js';

export const ACCOUNT_STATES = Object.freeze(['active', 'paused', 'deactivated']);
export const PAUSED_MESSAGE = "This dealership's AutoPulse account is paused. Please contact AutoPulse.";
export const DEACTIVATED_MESSAGE = "This dealership's AutoPulse account is deactivated. Please contact AutoPulse.";

/** The message to show when this dealer user (the dealership or a staff member) may not sign in, else null. */
export async function dealershipBlockedMessage(user, { Model = User } = {}) {
  if (!user || user.type !== 'dealer') return null;
  const dealership = user.parent_id
    ? await Model.findById(user.parent_id).select('account_status type').lean()
    : user;
  const state = dealership?.account_status || 'active';
  if (state === 'paused') return PAUSED_MESSAGE;
  if (state === 'deactivated') return DEACTIVATED_MESSAGE;
  return null;
}

/** Sets a dealership's state with a history entry. Returns { ok, error?, status? }. */
export async function setDealershipState({ dealerId, state, reason, byName }, { Model = User } = {}) {
  if (!ACCOUNT_STATES.includes(state)) return { ok: false, status: 400, error: `state must be one of ${ACCOUNT_STATES.join(', ')}` };
  const dealer = await Model.findOne({ _id: dealerId, type: 'dealer', parent_id: null }).select('account_status name').lean();
  if (!dealer) return { ok: false, status: 404, error: 'Dealership not found' };
  const from = dealer.account_status || 'active';
  if (from === state) return { ok: true, unchanged: true, state };
  const why = String(reason || '').trim().slice(0, 300);
  if (state !== 'active' && !why) return { ok: false, status: 400, error: 'Say why (it is kept in the history)' };
  await Model.updateOne({ _id: dealer._id }, { $set: { account_status: state },
    $push: { account_status_history: { from, to: state, reason: why || null, by_name: byName || null, at: new Date() } } });
  return { ok: true, state, from };
}
