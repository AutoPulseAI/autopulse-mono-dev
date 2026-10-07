// A full appointment slot, as every staff booking screen shows it (agentic-upsell MASTER_PLAN_4 stream R).
//
// The booking check (app/lib/bookingService.js) answers a full slot with
// 409 {error: "slot_taken", message: "... is full. The next available is ...",
//      next_available: {date: "YYYY-MM-DD", time: "HH:mm"} | null, alternatives?: ["HH:mm", ...]}
// (alternatives: other open times on the requested day, from POST/PUT /api/booking).
// throwIfStatusFailed() turns that answer into an error the StatusModals catch: the modal stays
// open and offers "Book {next available}" in one click (app/dealer/components/SlotFullNotice.js).
// Kept free of JSX so the CRM's node tests import it.

const SLOT_ERRORS = ['slot_taken', 'slot_full', 'closed', 'outside_hours', 'in_past', 'invalid_date', 'invalid_time'];

export class BookingConflictError extends Error {
  constructor(conflict) {
    super(conflict.message);
    this.name = 'BookingConflictError';
    this.slotConflict = conflict;
  }
}

// {status, message, nextAvailable, alternatives, requestedDate} for a 409 / slot 422 answer, else null.
export function bookingConflictFrom(status, body, requested = {}) {
  if (!body || (status !== 409 && status !== 422)) return null;
  if (status === 422 && !SLOT_ERRORS.includes(body.error) && !body.next_available) return null;
  const next = body.next_available && body.next_available.date && body.next_available.time ? body.next_available : null;
  const alternatives = Array.isArray(body.alternatives)
    ? body.alternatives.filter((t) => typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t)) : [];
  return {
    status,
    message: body.message || (status === 409 ? 'That time is full.' : 'That time cannot be booked.'),
    nextAvailable: next,
    alternatives: requested.date ? alternatives.filter((t) => t !== requested.time) : [],
    requestedDate: requested.date || null,
  };
}

// "Friday, Oct 9 at 10:00 AM" for ("2026-10-09", "10:00"): the dealer-local date and time as given, never
// shifted by the browser's time zone.
export function slotLabel(date, time) {
  if (!date || !time) return '';
  const [y, m, d] = String(date).split('-').map(Number);
  const [hh, mm] = String(time).split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return `${date} ${time}`;
  const day = new Date(Date.UTC(y, m - 1, d));
  const weekday = day.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const month = day.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const hour12 = ((hh + 11) % 12) + 1;
  return `${weekday}, ${month} ${d} at ${hour12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

// For a lead-status PUT: resolves on success; throws BookingConflictError for a full / unbookable slot (the
// StatusModal shows it and stays open), a plain Error with the server's message otherwise.
export async function throwIfStatusFailed(response, requested = {}) {
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  const conflict = bookingConflictFrom(response.status, body,
    { date: requested.booking_date || requested.date, time: requested.booking_time || requested.time });
  if (conflict) throw new BookingConflictError(conflict);
  throw new Error(body.message || body.error || 'Failed to update status');
}
