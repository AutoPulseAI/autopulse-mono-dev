# Stream S: every scenario passes on the running system; CRM sync loose ends

## Run it

```
make crm-local            # CRM :3100, AI :8110, db autopulse_local (never spends Vehicle Databases credits)
make crm-scenarios        # the scenario YAMLs through the running AI API
make crm-e2e              # 48 checks; repeatable on the same data
make crm-cadence-check    # stream F's 50 checks
```

## 1. Scenarios (50 / 76 before)

Code fixes:

- **A follow-up whose lead was busy waited up to 90 seconds.** Two follow-ups of one lead due together (a touch
  and its call timer) are fired at once; the second finds the lead locked, was put back for 30 s and then
  waited for the next minute's cron. Now it is put back for 5 s and the worker queues its own
  `fire_due_followups` run for then (`scheduler/followups.py BUSY_RETRY_AFTER`, `worker/jobs.py
  _queue_busy_retry`). Test: `test_followups.py::test_a_busy_lead_gets_its_own_retry_run_not_the_next_minutes_cron`.
- **Scenario customers had no state.** A 555 "area code" has no state, so the strictest row of every state's
  hours held their follow-ups. The runner now gives each scenario lead a number in one of its dealer's own area
  codes on the never-assigned 555 exchange (`devtools/simulate.py LOCAL_AREA_CODES`, unique per lead);
  `new_lead: {local_phone: false}` keeps a customer whose state is unknown.

- **The runner's turn count** leaves out the Days 1-7 call-task records (stream T), like the rolling summary:
  they fall due on the clock next to the conversation, and one landing between a reply and its answer made
  `wait_turns` / `expect_turn` read the wrong turn.
- **crm-local runs with `SEND_TIME_AB=false`** (stream L's morning / afternoon split puts a lead's touch at
  10:00 or 15:00 by chance; `CRM_LOCAL_SEND_TIME_AB=true` turns it on) and `VEHICLE_DATABASES_ENABLED=false`
  (no paid credits from the local stack). `aidmvcs-be-dev/scripts/ai-dev-full.js`.

Result after merging streams T and L: **76 / 76** (two full runs), `make crm-cadence-check` 50 / 50,
`make crm-e2e` 48 / 48 (five runs in a row on the same data), AI unit tests 1618+, CRM tests 108.

Cadence check 1i now reads "every touch is followed by a staff call task: its 60-minute timer, or that day's
Days 1-7 call tasks": with stream T's daily tasks on (the default) a lead gets at most 2 call tasks a day, so a
Day 2-7 touch starts no timer of its own.

Scenario changes (each expectation was outdated by an intentional change):

| Scenario | Change | Why |
|---|---|---|
| pc1_customer_time_zone | unknown-state lead uses `local_phone: false`; due 13:00, not 11:00 | A1/F1 per-state hours: unknown state = strictest row (10:00 in every zone) |
| pc3_specific_followup, pc4_reply_skips_nudge, pc4_touch1_and_nudge | due 10:00, not 11:00 | local customer: the cadence's own 10:00 (`cadence.TOUCH_HOUR`); 11:00 was the unknown-zone hold |
| pc3_specific_followup | "checking back in, as you asked" | stream G grammar rules |
| s4_email_first_reply | starts "Hello Ellis, greetings from Lakeside Auto" | stream G `touch1_opening_first` (client's Touch 1 intro) |
| p2_handoff_holding_reply | "a member of our team will call you" | stream H "speak to a human" |
| pb4_buying_signal | outcome `offer_visit` | the visit offer's own outcome, as in pb4_offer_after_qualified / pb5_* |
| pc5_confirm_no, pc5_confirm_yes | one more turn before the Y / N reply | stream R: the 15-minute details message is a logged step |
| pb5_slot_taken | 10 other bookings fill the slot, not 2 | client, 5 Oct 2026: 10 sales bookings per one-hour slot |
| pd7_anniversary_no | `index: 0` | sending Year 1 plans Year 2 at once (A3), so the newest is the pending Year 2 |
| s10_dealer_off_cancels_switch, s13_rollback_to_off, p1_context_pack, p5_answer_then_ask, p7_clarify, s8_ai_first_reply | clock pinned to Tue 10:00 | they ran on real time: on a Sunday the dealer is closed (after-hours offer, held nudge) |

Call-task scenarios (pc2, ph_*, pd2) passed once the busy retry was fixed; no expectation changed.

## 2. `make crm-e2e` repeatable

It picked the same day again (the first run's moved booking left the 11:00 sales hour "available") and met its
own service bookings. It now removes fillers a stopped run left, picks a day whose 11:00-13:59 hours hold no
active booking, and cancels its own bookings at the end. New checks: D11/D12 (item 3), H1-H3 (item 4): 48.

## 3. Booking cancel / move in the CRM tells the AI at once

- New event `booking-changed` `{lead_id, booking_id, change: cancelled|moved}` (`events/models.py`,
  `aiEvents.js`, `aiStaff.js notifyAiOfBookingChange`).
- `PUT /api/booking` sends it for a cancel or a new date/time, unless the caller is the AI itself (no loop).
- The status screen: a lead taken off "Appointment Booked" to a status staff don't own (Contacted, Lead)
  has its active booking cancelled (the slot is free again) and the AI is told
  (`aiStaff.js cancelBookingsForStatusChange`). Re-booking a new time already reached the AI as
  "Appointment Booked".
- AI: `handlers.handle_booking_changed`, under the lead lock, re-reads the booking: cancelled -> the steps are
  cancelled, the lead goes to Contact Made - No Next Action and back into the cadence; moved -> the steps are
  re-planned for the new time. Stream F's check when a step falls due stays as the safety net.
- Tests: `test_appointment.py` (2), `test-ai-layer.js` (4), `test-ai-crm-platform.js` (1), e2e D11/D12.

## 4. The AI's closings as the CRM status

- `agent/crm_status.py`: after the AI's own close (`day_91` -> "Closed - Lost", `no_longer_owns` ->
  "Closed - No Longer Owns") it calls `POST /api/internal/ai/leads/status` (shared secret). Live dealers only.
  A CRM that can't be reached is retried by the next hourly sweep. Staff closings are never sent back.
- CRM `aiDnd.js markLeadClosedFromAi`: staff win. Kept when the status changed after the AI's close time, when
  a staff save lands between the read and the write, and for staff statuses (Visited, Sold, DND, Managerial
  Review, Sold Pending, Sold Delivered). "Closed - No Longer Owns" only replaces Sold Delivered / Sold. A note
  says the AI set it; the CRM's own follow-ups and reminders for the lead stop.
- "Closed - No Longer Owns" is in the lead list filters and badges; the status picker shows it only as the
  current value, disabled, and the status route refuses it from staff.
- Tests: `test_lifecycle.py` (3), `test_sold_lifecycles.py` (1), `test-ai-crm-platform.js` (3), e2e H1-H3.

## 5. Year-1 anniversary text

Consent rules unchanged. A marketing text needs the platform opt-in flag (the customer texted the dealer), or
their own enquiry within 91 days. A year after delivery neither holds for a customer who never texted, so the
text is blocked and the email goes (each channel has its own check, `sold_lifecycles._send_both`).

- New: when a lifecycle message goes by email only for that reason, staff are told once per lead: an AI panel
  notice (`text_consent_missing`) and a CRM note saying why and what would allow texting.
  Test: `test_sold_lifecycles.py::test_an_anniversary_without_text_consent_goes_by_email_and_tells_staff_why`.
- **What would be needed to text owners** (for the client and counsel, not decided here): (a) the customer's
  written consent to marketing texts recorded at the sale / delivery (wording, time, source kept as evidence),
  or (b) counsel's approval to treat the sale / delivery as an established business relationship that covers
  ownership messages, or to class the anniversary / service-interval messages as non-marketing. The TCPA
  guardrails PDF §13 lists "established-business-relationship use cases" and "service-interval campaigns" as
  items counsel must approve; §10 says the AI may never infer consent or such a relationship.

## Open items

- `handle_lead_paused` runs without the lead lock, so a booking moved within a second of a staff booking can
  leave the first plan's steps pending next to the new ones (they are cancelled when due: "the appointment was
  moved"). The e2e waits for the plan before moving.
- A booking the AI itself cancels through `PUT /api/booking` leaves the CRM lead status at
  "Appointment Booked" (the route never changes the lead status on a cancel).
- The AI-closing endpoint compares the CRM's `statusChangedAt` (real time) with the AI's close time; with the
  dev clock moved forward the "staff changed it after" rule can't trigger (dev only).
- Scenarios without a pinned clock still run on real time (they pass on a Sunday; any that check after-hours
  behaviour by accident would show on another day).
