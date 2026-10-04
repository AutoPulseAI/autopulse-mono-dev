# Stream R: the remaining gaps

Built locally and unit-tested. Nothing ran against the shared stack (ports 3100/8110) or Docker; no paid API calls.
Edits to shared files are marked `stream R`.

## 1. The 15-minute appointment details message (Omnichannel PDF §7)

"{first}, we are all set to meet on {date} at {time} at {dealership}, {address}. Please make sure to call or text
us if anything changes at {ai_agent_phone}. Looking forward to assisting you!" goes out on text and email
15 minutes after an appointment is set (AI booking, staff booking, customer page: all reach
`plan_appointment_timers`) or moved.

- `agent/appointment.py`: `STEP_DETAILS`, `details_step` (planned only while the meeting is at least 30 minutes
  after the send; so a same-day booking still gets it when it helps), `details_still_useful` (checked again
  at send time: never later than 15 minutes before), and the wording. A missing name, address or phone is
  left out with its own words ("We are all set...", "...call or text us if anything changes."). Nothing is made up.
- `{ai_agent_phone}` is the dealer's texting number (`sms_conversion_phone`, new `DealerProfile.agent_phone`).
- `scheduler/followups.py`: planned with the other `appointment_*` steps. Before sending, it checks that the same
  appointment still stands, plus the stage, the dealer mode and the send check. A cancel cancels it through
  `lifecycle.KIND_STAGES` (`appointment_details`). A move supersedes it and plans a new one. Sent once per
  appointment time (`ai_lead_state.appointment_details_sent_for`), so if staff save the same status again it
  is not sent twice.

## 2. Staff notices written into the CRM conversation

`agent/crm_notes.py` `write(db, lead_id, kind, text, key)`: "AutoPulse AI - {label}: {text}" goes through
`add_lead_note` on the stub and live platform clients to `POST /api/internal/ai/leads/notes`. Each notice gets
one note: the AI keeps `ai_crm_notes` by key, and the CRM now takes `idempotency_key` and returns the note it
already has (`aiDnd.js`). A CRM failure is logged and kept as `failed`, and the next call with the same key
retries. A failure never stops the turn. Callers:
service request (`service_request.notify_team`), SOLD PENDING escalation / info and the Day-3 service YES
(`sold_lifecycles._notice`), recall / maintenance notices (`service_events.notify_staff`, keyed by event),
"not interested" handoffs (`turn._note_not_interested`), bad contact (`suppression.suppress_contact`, keyed by address).

## 3. Booking UI: a full slot

`app/lib/bookingConflict.js` and `app/dealer/components/SlotFullNotice.js`. A 409 (or a slot 422) keeps the
StatusModal open. The modal shows the server's message, a one-click "Book Friday, Oct 9 at 11:00 AM" that
re-submits, and the other open times that day when the server sends `alternatives`. There is now one StatusModal (leads). The booking and
conversations folders re-export it, so the conversations screen also gets the booking date and time. All six
status handlers (both lead lists, the booking list, three conversation views) use `throwIfStatusFailed`.

## 4. Booking capacity on AI Settings

The table has bookings per slot and slot length for sales and service, with defaults shown (10 / 60, 1 / 60).
Values are validated 1-50 and 15-240 on the page and the server (`bookingCapacityUpdate`). They are saved as
`dealer_account_information.booking_capacity.{sales,service}.{max_per_slot,slot_minutes}`.

## 5. Assigned-only staff

`app/lib/ai/assignedScope.js` follows the same rule as `/api/leads`. Staff with "View Assigned Leads" and
without "Manage Leads" get only the call tasks and alerts of leads where `assigned_to` is them. The filter runs
server side in the Next.js routes, and the alert count is counted from the filtered rows.

## 6. Photos in the conversation

`app/dealer/components/MessagePhotos.js` shows 160x120 thumbnails of `ai_media_urls` in all three conversation
views. Each thumbnail opens the full image. AI messages with photos no longer use the full-width attachment block.

## Tests

AI: 1447 unit tests pass (11 new), and 79 evals pass. CRM: 95 tests pass (5 new, plus the idempotent note
test). The integration tests ran on their own databases (`pulse_r_*`).

## Open items

- `CallOutcomeModal.js` (stream H) books through the status route too. Its 409 still shows as a plain error. It
  could use `throwIfStatusFailed` + `SlotFullNotice`.
- The alerts filter works on the AI service's first 300 notices. For a very large dealership, pass the
  assigned lead ids to `/v1/staff/notices` instead.
- POST call-task outcome and alert "handled" do not check assignment yet. Only the lists are filtered.
- Failed CRM notes are retried only when the same notice is written again. There is no sweep job.
- The pages were checked with ESLint and the unit tests only. Nobody clicked through them in a browser.
