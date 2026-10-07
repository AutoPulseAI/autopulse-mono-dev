# PLAN_4 stream X3: conversation leverage, memory, CRM connectivity

Fixes for audit 4 (conversation behaviour, memory, lead vs customer, CRM connectivity). Each item has a
regression test that fails on `integration` before the fix.

## SECURITY ISSUE FOR THE CLIENT (production code we did not change)

Two routes in the client's own production CRM are open to anyone on the internet. They are identical in
production (`/home/temp/Ammer/crm/aidmvcs-be`) and in our branch; we were told not to modify them.

1. **`GET /api/conversations/lead` has no authentication**, and its `dealer_id` requirement is commented out.
   With a `dealer_id` it returns that dealer's conversation records (message text, recipient, notes); with a
   `lead_id` it returns the lead's whole thread. With the AI live it also returns the AI's internal notes
   (handoff reasons, service requests, call outcomes).
2. **`GET /api/car` has no authentication** and needs no dealer: it lists every dealer's stock with price, MSRP,
   VIN and each listing's dealer `_id` - which is exactly the id route 1 needs.

Together: anyone can read any dealer's customer conversations. The client should put both behind a session (and
scope them to the signed-in dealer) before, or together with, the AI going live.

## What changed

| # | Item | Change | Where |
|---|---|---|---|
| 1 | Works without `customer_id` | The CRM derives a per-dealer customer key from the lead's normalised phone (else email): `ck_` + 24 hex of sha256(`dealer|p:<10 digits>` or `dealer|e:<email>`); the same rule on the AI side. Stored on the lead as `ai_customer_key` (production's Lead is `strict: false`). The AI finds a customer's leads by CRM link, stored key, or the leads it has seen under the key. An event the AI cannot take in `live` leaves a staff note on the lead; nothing is dropped silently. | `aiDispatch.js`, `aiOutbox.js`, `agent/customer_key.py` |
| 2 | Leverage answers | The visit reason is built from the customer's own facts: payment target, payoff + trade, budget (no amount said), trade. A stated objective makes the lead eligible for the offer. Canned "while it's still available" and "only takes a few minutes" removed: the guard rejected every draft repeating them, which is what produced "I've made a note of that". | `agent/visit_offer.py`, `nodes/guard.py` |
| 3 | Offered times | `VisitState.asked_day`: the day the customer asked for, kept even if that offer fell back to a template. "Morning is better" = that day's morning; "10 works" = that day at 10:00 (booked if open, else the nearest open times that day; a move to another day is said, with why). Live for 2 replies. | `nodes/decide.py`, `tools/booking_tool.py`, `agent/turn.py` |
| 4 | After a handoff | A booking request or a question on a handed-off lead: staff notice + CRM note at once, and a holding reply (booking: always, with its own wording; question: at most one per 10 minutes; anything else: the 2-hour rule). Soft handoff (unsafe draft, or read as upset) + booking request: the AI takes the lead back and books. Upset hands off at 0.80 only with clear words of upset in the message, else from 0.95. | `agent/after_handoff.py`, `events/handlers.py`, `slots/policy.py` |
| 5 | Memory | Before each turn the lead's CRM `emails` the AI didn't write are copied into its thread with an `author`: `staff`, `staff_note` (direction `note`), `crm` (n8n / follow-up / reminder), `campaign`, `customer` (history from before the AI saw the lead only). First sync: newest 40; the rolling summary covers what falls out of working memory. A lead first seen through a reply gets its stage and opportunity clock from its own creation date. A returning customer's new lead gets `previous_lead_summary`. | `agent/history_sync.py`, `nodes/load_context.py`, `agent/llm.py` |
| 6 | Outages | CRM: an event whose retries are all used (or that could not be queued) is stored in `ai_event_outbox` and replayed every 2 minutes; older than 24 h becomes a staff note. AI: a sweep every 5 minutes per live dealer submits lost new leads and lost customer messages through the deduplicating intake, and *adopts* open leads it never saw (stage, history, next cadence touch, no greeting). | `aiOutbox.js`, `aiEvents.js`, `worker.js`, `scheduler/reconcile.py` |
| 7 | Intake on production | Plain portal lead emails: the customer is read from the body (Name / Email / Phone), never the portal's sender; a portal email naming no customer makes no lead. ADF in the plain-email path is read with our `adfLeadParser.js`. SMS replies match the open lead in any stored phone format. | `aiInbound.js` |
| 8 | Closed-lost, duplicates | A message from a customer whose leads are all closed starts a new lead (`previous_lead_id`), so its appointment gets confirmation and reminders. A linked duplicate is released (active, stage, cadence) when its primary finishes. "No ownership record" no longer counts as unknown ownership: closed-only customers with no deal become INACTIVE. | `aiInbound.js`, `agent/duplicates.py`, `agent/lifecycle.py`, `agent/ownership.py` |
| 9 | Invented facts in words | Guard rejects unbacked durations, credit-pull / score claims, "no cost / free", document lists and "don't need to bring", "we don't share prices", and "Yes - the team will confirm whether ...". A claim inside a deferral to the team passes; a duration the customer gave may be repeated. Compose is told the same. | `guardrails/word_claims.py` |
| 10 | Auto-responders, lock | Auto-reply headers (CRM) or phrases (AI): no reply, not contact, channel switch kept, logged. Lead lock extended every TTL/3 while its turn runs; job timeout 60 s -> 180 s. | `agent/auto_reply.py`, `worker/locks.py` |
| 11 | Security (ours) | Every shared-secret check already goes through `internalServiceAuth.js` (constant time, fails closed). Added: `PUT /api/booking` from the AI must name the booking's own dealer (404 otherwise); the AI now sends it. | `aiOwnership.js`, `booking/route.js` |
| + | Vehicle already shown | "The silver one", "the second one you sent", "the Tacoma", "that one", "the 2022", fewer miles / newer: resolved in code against the shown vehicles (now stored with their fields), re-read from stock, given to Compose as `referred_vehicle` and kept as `focus_vin` for the photo. Two fit: asks which, naming both. Sold: says so. "Cheaper" is never resolved (no price data). | `agent/vehicle_reference.py`, `nodes/search_stock.py` |

## Fields our code reads that production never writes

Compared `aidmvcs-be-dev/` with `/home/temp/Ammer/crm/aidmvcs-be` (0 references in production `app/` for each).

| Field | Read by | Handling |
|---|---|---|
| `Lead.customer_id` | every AI event, ownership, campaigns, Customer 360 | derived key (item 1) |
| `Lead.ai_customer_key` | AI lead lookup | written by our CRM code; AI also falls back to leads it has seen |
| `Lead.last_inbound_at`, `Lead.previous_lead_id` | written only by our `aiInbound.js` | not read by production; safe |
| `Lead.data.lead_type` | lead bucket | absent: classified from `source` and the conversation |
| `User.ai_mode` | AI on/off | absent = `off` |
| `User.ai_mms_enabled` | photos by MMS | absent = off |
| `dealer_account_information.ai_daily_call_tasks` | Days 1-7 call tasks | absent = on |
| `booking_capacity`, `booking_max_per_slot`, `booking_slot_minutes` | slot capacity | absent = 10 sales / 1 service per hour |
| `dv_dealer_id` | DealerVault lifecycles | absent: those lifecycles do not run |
| `Booking.created_by`, `appointment_type`, `showed` | booking capacity, no-show | absent = sales booking, not shown |
| `Email.ai_*` | AI message records | written by our endpoints only |
| collections `customers`, `deals`, `repairorders`, `serviceappointments`, `tradeins` | Customer 360, ownership, sold lifecycles | absent: empty reads; a derived key skips Customer 360 |

## Production port checklist

1. `app/lib/ai/*` (whole folder, incl. new `aiOutbox.js`, `aiOwnership.js`), `app/lib/internalServiceAuth.js`,
   `app/api/internal/ai/*`.
2. `aiInbound.js` imports `customerResolver.js` (`linkCustomerToLead`) and `adfLeadParser.js`: port both, or
   stub `linkCustomerToLead` as a no-op (the derived key then identifies the customer). `fast-xml-parser` is
   already in production's package.json.
3. Replace `app/api/booking/route.js` (capacity, caller kinds, AI-owned confirmations, dealer check).
4. Port the gates or production keeps sending alongside the AI: `followupService.js`, `appointmentReminderService.js`,
   `campaignWorker.js`, `conversations/followup/route.js`.
5. Hooks: `leadworker.js`, `emailWorker.js`, `processSms.js`, `conversations/reply/route.js`, `worker.js` (retry
   queue + outbox replay interval), `User.js` / `Email.js` fields, the `ai_idempotency_key` index.
6. `app/api/system/sms/route.js` thread linking is no longer required for correctness (item 7), but port it anyway.
7. AI service: read access to the CRM MongoDB (`leads`, `emails`, `users`, `bookings`, `vehicles`); it writes only
   its own `ai_*` collections.
8. At go-live per dealer nothing to backfill by hand: the reconciliation sweep adopts open leads within 5 minutes.
9. Fix the two open routes above.

## Real-model check (gpt-5-mini), spend $0.24 of $2

Reports: `evals/reports/conversation_cost/conversation_cost_gpt-5-mini_streamX3_20261004-1908.md`,
`..._streamX3b_20261004-1910.md`. Before: `..._streamQ_20261004-1309.md`.

| Turn | Before | After |
|---|---|---|
| credit-1 "I'd want to keep it under 400 a month" | "Thanks, Denise. I've made a note of that." | "We can work toward a $400/month payment ... Would you like to come Tuesday at 1:00 PM, 2:00 PM, or 3:00 PM to go over options in person?" (run 1908; in run 1910 the model asked text-or-call instead) |
| credit-1 "can I come in saturday?" | "I've made a note of that." | "Saturday at 9:00 AM, 1:00 PM, or 4:00 PM are available ... toward your $400-a-month target." |
| credit-1 "morning is better" | "Saturday morning or Saturday afternoon?" | "Saturday at 9:00 AM, 10:00 AM, or 11:00 AM ..." |
| credit-1 "10 works" | "Tuesday at 1:00 PM, 2:00 PM, or 3:00 PM all work." | "I've requested Saturday at 10:00 AM. The team will confirm the appointment shortly." (booked) |
| trade-2 "...waste a trip for a lowball" | handoff "clearly upset (0.80)" | no upset handoff |
| trade-2 "Could I come Saturday at 11?" (after a not-interested handoff) | silence | "I've passed your request to come in to the team, and someone will confirm the time with you shortly." + staff notice + CRM note |
| credit-1 soft-pull claim, service-1 "about an hour" | sent | rejected by the guard; not in the after runs |

## Open items

- The harness sends messages milliseconds apart, so the 10-minute question gap hides some holding replies there.
- credit-1 "what do I need to bring?" still got "generally bring your driver's license and a form of payment"
  in one run: the deferral before it exempts the claim. Tighten if the client wants no list at all.
- When the guard rejects a process claim twice the customer gets the "let me check with the team" template; two
  in a row still flag the lead for staff (now a soft handoff the AI can take back).
- `campaign` author relies on `campaign_id` on the Email record; production's campaign worker must set it.
- Portal sender detection is a list of known domains plus no-reply style local parts; an unknown portal with a
  personal-looking sender is still treated as a person writing in.
- The outbox replay and the reconciliation sweep were tested against in-memory stores, not a real outage.
- Webchat intake (audit D5) and per-dealer cadence settings (E10) are not in this stream.
