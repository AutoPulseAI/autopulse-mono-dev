// Dealer ownership for internal (shared-secret) callers (PLAN_4 stream X3 item 11, audit 4 C9 / D16).
//
// The AI service authenticates with one shared secret for every dealer, so each internal route must check that
// the record it touches belongs to the dealer the call names. A missing or different dealer is answered exactly
// like a missing record (404), so the secret's holder cannot probe other dealers' ids.

// A booking changed through PUT /api/booking by the AI: the call must name the booking's own dealer.
export function aiMayChangeBooking(caller, booking, dealerId) {
  if (caller?.kind !== 'ai') return true; // staff sessions are checked by their own rules
  if (!booking || !dealerId) return false;
  return String(booking.dealer_id) === String(dealerId);
}
