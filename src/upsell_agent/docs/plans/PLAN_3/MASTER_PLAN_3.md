# Master Plan 3: Inventory, contact rules and appointments

> **What this is:** two parts.
>
> - **Part A: Inventory** (Phases 0–7). Letting the AI talk about the dealer's
>   inventory ("do you have a white RAV4?", "what SUVs do you have under
>   30k?"). It was left out of Plan 1 and Plan 2 on purpose.
> - **Part B: Client requests of 25 September 2026** (Phases B0–B6).
>   After-hours leads, strict US rules for outbound messaging, and booking
>   appointments as the main goal. Source: [`../../data/conversation_2.md`](../../data/conversation_2.md).
>
> **Suggested order: Part B first.** It is the client's stated main goal, it
> covers legal risk, and it doesn't depend on Part A. Part A's Phase 3 can then
> use Part B's visit offer ("we have one in silver, want to come see it?").
>
> **Assumes:** [`../PLAN_2/MASTER_PLAN_2.md`](../PLAN_2/MASTER_PLAN_2.md) is finished end to end:
>
> - one context pack per turn;
> - conversation state (asks, open questions, promises);
> - the rolling summary;
> - questions labelled `answerable` / `restricted` / …;
> - Decide's `answer` rule;
> - read-only answer sources loaded in code;
> - the guard knowing those sources.
>
> Today, stock questions are labelled `restricted` and answered with "the team
> will check what's in stock for you". This plan makes them answerable from real
> stock, safely.
>
> **Progress:** `PLAN_3/progress_3.md`, written as each phase is finished.

---

# Part A: Inventory

## What already exists

| Piece | Where | State |
|---|---|---|
| Vehicle records | Platform `vehicles` collection (Mongoose `Vehicle`, `strict: false`, unique per dealer + VIN) | Holds dealer stock **and** vehicles that came from DMS history (customers' own cars, Customer 360). |
| Inventory API | Platform `GET /api/car` | Filters by dealer, make, model, year, `car_type` (new / used), body type, price range, miles range, and more. Maps prices from `internetreduced` / `instoreprice`. |
| Inventory tool | `agentic-upsell/src/upsell_agent/tools/inventory_tool.py` | A stub. Its docstring already asks for raw rows, so every mention can be traced back to a VIN. |
| Grounding nodes | `agent/nodes/recommend.py`, `agent/nodes/verify_grounding.py` | Stubs from the original design, not in the graph. |

## Principles

1. **Stock facts come from records, never from the model.** Every vehicle the AI mentions is a record loaded in code for this turn, with its VIN. Anything the model says about a vehicle that isn't in that record is removed or the draft is rejected, never "corrected".
2. **Fresh or silent.** A vehicle is mentioned only if it was in stock when the turn loaded it, and it is re-checked before anything is sent later (the 24h channel switch).
3. **Prices stay restricted** unless Phase 0 decides otherwise. Inventory answers say what's there, not what it costs.
4. **Stock is looked up in code, not by the model calling functions.** Like Plan 2's answer sources: loaded in code and put into the context pack, so the reply stays within the time budget and every value is traceable.
5. **Every phase ships its own tests and scenarios**, and Plan 1 and Plan 2's tests, scenarios, e2e and burst test keep passing.

---

## Phase overview

| # | Phase | You can see it when |
|---|---|---|
| 0 | Decisions | The answers are written into architecture.md |
| 1 | Inventory read layer | The Debug UI shows the stock records a turn loaded, each with its VIN |
| 2 | Shopping criteria | "White SUV under 30k" becomes structured search criteria from the profile and the message |
| 3 | Answering stock questions | "Do you have a RAV4?" is answered from real stock, or honestly says no |
| 4 | Grounding check | A draft that names a car or a detail not in the loaded records is rejected |
| 5 | Freshness | A car sold since the message was written is never mentioned in a later send |
| 6 | Debug UI and dev inventory | Seeded stock per dev dealer, and an Inventory panel per turn |
| 7 | Evals, shadow and rollout | Inventory evals pass on the real models, and shadow review shows no wrong vehicle facts |

---

## Phase 0: Decisions

1. **What counts as in stock.** The `vehicles` collection also has DMS-history vehicles. Decide the rule that marks a record as dealer stock and not sold: a `source` value, a status field, the inventory feed's last-seen date, or a combination. Check it against the real data of one dealer. **This is the most important decision in this plan.**
2. **Source of truth for reads.**
   - **Option A:** the platform's `GET /api/car`, as the stub suggests. One source of truth and its field mapping, but a network hop inside the 8 s budget.
   - **Option B:** a dealer-scoped, read-only query of `vehicles`, like Customer 360. Faster, but duplicates the field mapping.
   - **Suggested:** Option B for the turn (speed), with a parity check against `/api/car` like Plan 1's `compare-360`.
3. **Prices.**
   - **Suggested:** stay restricted ("the team will confirm pricing").
   - If allowed later: only the dealer's published internet price, word for word, with a "plus taxes and fees" line. State rules on advertised vehicle prices apply to an AI quoting a price too, so confirm with counsel before enabling.
4. **Links.**
   - SMS: none (Plan 1 rule).
   - Email: the vehicle's page on the dealer site, if the record has one.
5. **How many vehicles per reply.**
   - **Suggested:** at most 3 in email, and 1–2 in SMS, which is short.
6. **Feed freshness.** How often the inventory feed updates, and how old a record's last update can be before it's treated as possibly sold. **Suggested:** older than 3 days = not mentioned.
7. **Photos.** Not in this plan (SMS stays text-only).

Write the answers into architecture.md.

---

## Phase 1: Inventory read layer

1. **Implement `tools/inventory_tool.py`** as decided in Phase 0:
   - `search_inventory(dealer_id, criteria, limit)` returns raw records;
   - `get_vehicle(dealer_id, vin)` is used for re-checks.
   It is dealer-scoped and read-only, and applies the in-stock rule.
2. **A typed view** of each record: VIN, stock number, year, make, model, trim, body type, new/used, exterior colour, miles, record last-updated time, and the page link if allowed. The price is loaded only if Phase 0 allows it.
3. **Short cache** (e.g. 60 s per dealer + criteria), so a burst of campaign replies doesn't query the same stock 300 times.
4. **Inventory layer in the context pack:**
   - `inventory`: the records loaded this turn, with each record's `source_id` (the VIN);
   - `inventory_query`: the criteria used;
   - `inventory_checked_at`: when it was loaded.
5. **Trace:** Load context shows the query, how many records matched, and which were given to the AI.

**Tests:**
- The in-stock rule, including DMS-history vehicles excluded and old records excluded.
- Dealer scoping (no cross-dealer read).
- The cache.
- The typed view.

**Scenario:** `p1_inventory_loaded.yaml`. A sales lead for a used SUV; Load context shows matching seeded stock.

**Done when:** a turn's loaded stock is visible in the Debug UI, and a parity check against `/api/car` passes for the dev dealers.

---

## Phase 2: Shopping criteria

1. **Criteria from what we know**, built in code:
   - the profile: desired model, new or used, budget, monthly payment;
   - the current message: colour, body type, "under 30k", "something bigger".
   New criteria slots are added to the slot schema where needed (e.g. `interest.body_type`, `interest.color`), with Plan 2's customer wording and explanations.
2. **Search when it helps.** Stock is loaded when:
   - the customer asks about stock (Plan 2's `answerable` label now covers stock questions);
   - or the profile has enough to search (at least a model, or a body type + new/used).
   Otherwise the turn doesn't search, which saves time and cost.
3. **Loosening.** No exact match loosens the search in a fixed order and records what was loosened:
   1. colour
   2. trim
   3. year ±1
   4. the same body type from another make
   Compose can then say "not in white, but we have it in silver".
4. **Budget handling.** If Phase 0 keeps prices restricted, the budget can still filter the search (the price is used, not said). The reply never states or implies a price.

**Tests:**
- Criteria building from the profile + message, table-driven.
- The search-or-not rule.
- The loosening order and its record.

**Scenario:** `p2_loosened_search.yaml`. "White RAV4" with only a silver one in stock; the trace shows colour loosened.

---

## Phase 3: Answering stock questions

1. **Decide:** a stock question with loaded results is answered by the `answer` rule, using the inventory layer. With no results, the answer is honest ("I'm not seeing one in stock right now; I can have the team let you know if one comes in"), and that is added to `promises`.
2. **Compose rules:**
   - Mention only vehicles from `inventory`.
   - Describe them only with their record's fields.
   - Keep to Phase 0's per-channel count.
   - Put each mentioned VIN in a structured output field (`mentioned_vins`), not only in the text.
3. **Conversation state:**
   - The vehicles mentioned are recorded (`shown_vehicles`), so the next turns don't repeat them.
   - "The second one" / "the silver one" can be resolved against them (Plan 2 Phase 4's short replies).
   - Interest in a shown vehicle fills `interest.model` with its details and source VIN.
4. **Still restricted:** holding a vehicle, price, discounts, payments, trade-in value and booking a test drive. These get "the team will confirm", as today.

**Tests:**
- Answer with results, answer with none.
- `mentioned_vins` present.
- A second reference resolved.
- Shown vehicles not repeated.

**Scenarios:**
- `p3_do_you_have.yaml`: a yes answer naming a real seeded vehicle.
- `p3_none_in_stock.yaml`: an honest no, with the promise recorded.

---

## Phase 4: Grounding check

The existing stubs (`agent/nodes/verify_grounding.py`, `guardrails/output_validation.py`) become real, as part of the guard:

1. Every VIN in `mentioned_vins` must be in this turn's `inventory`. Otherwise the draft is rejected.
2. Every vehicle-like mention in the text (year, make, model, trim, colour, miles) must match one of the mentioned records. A made-up trim or colour is rejected.
3. The text must not mention a vehicle that isn't in `mentioned_vins`.
4. Prices and payments are still blocked by the existing never-invent rules.
5. A rejection uses the normal path: one rewrite with the guard's feedback, then the template and a staff flag.
6. **Metric:** grounding rejections per turn, on the Metrics tab and in the rollout check. Target 0 after the rewrite.

**Tests:** each rejection rule, a valid multi-vehicle draft passing, and the rewrite path.

**Scenario:** `p4_invented_trim.yaml`. With the offline model's new `#badtrim` test tag (offline only), the guard rejects the draft and the rewrite passes.

---

## Phase 5: Freshness

1. **Before the send:** if the turn took long, the mentioned VINs are re-checked with `get_vehicle` right before sending. A vehicle that sold in the meantime rejects the draft (rewrite without it).
2. **24h channel switch:** the saved follow-up keeps its `mentioned_vins`. At fire time each is re-checked. If any sold, the stock-free version of the message is sent instead: Compose writes one alongside, the same way it already writes an SMS and an email version.
3. **Old records:** anything past Phase 0's freshness limit is never loaded.
4. **Metric:** "sold vehicle mentioned". Must be 0 in the rollout check.

**Tests:** sold before the send, sold before the follow-up (the stock-free version is sent), and old records ignored.

**Scenario:** `p5_sold_before_followup.yaml`. A vehicle is marked sold, then the clock is advanced 24h; the stock-free version goes out.

---

## Phase 6: Debug UI and dev inventory

1. **Dev inventory seed:** 20–40 realistic vehicles per dev dealer, both new and used, several colours and body types. A couple are marked sold and a couple have old feed dates, so the in-stock rule is visible. Clearly separate from the dev DMS-history vehicles.
2. **Inventory panel** in the turn inspector:
   - the query;
   - the loosening steps;
   - the records loaded;
   - which VINs the draft mentioned;
   - the grounding result per vehicle.
3. **A simulator shortcut** to mark a vehicle sold, for testing freshness by hand.
4. **Offline model:** answers stock questions from the inventory layer by simple rules, and `#badtrim` exercises the grounding check.

---

## Phase 7: Evals, shadow and rollout

1. **Evals:**
   - answers only name loaded vehicles;
   - no invented trims, colours or miles;
   - "no stock" is honest;
   - no prices;
   - short references resolve;
   - the SMS count limit holds.
2. **Promptfoo:** injection through vehicle descriptions (dealer feed text is data, never instructions).
3. **Real-model run** of the eval gate, with pass rates and cost per turn recorded.
4. **Shadow review:** during a dealer's shadow week, the Shadow tab marks each stock answer right / wrong vehicle fact / should have said no.
5. **Rollout check** adds grounding rejections, sold-vehicle mentions (0) and the inventory query p95 time.

**Done when:** one dealer has been live with inventory answers for a week, with zero wrong vehicle facts and zero sold-vehicle mentions.

---

# Part B: Client requests (25 September 2026)

## What the client asked for

| # | Client's words (short) | In plain terms | Built today? |
|---|---|---|---|
| 1 | "If a lead comes in after hours, send a confirmation with the option to connect now or during business hours." | A lead at 11pm gets a first message that lets the customer choose: carry on now, or be contacted when the dealership opens. | **No.** The first reply goes out straight away at any hour and offers no choice. The 8:00–20:00 window covers only follow-ups the AI sends on its own ([scheduler/contact_window.py](../../../scheduler/contact_window.py)). |
| 2 | "Dealer Vault contacts, drip service or sales equity campaigns need the TCPA US rules strictly enforced. That is outbound, where a lead is inbound." | Contacting people who didn't just reach out (old DMS contacts, drips, equity campaigns) is marketing. It needs consent, quiet hours in the **customer's** time, opt-out and do-not-call handling. | **Partly.** The AI sends no campaigns (the platform does) and keeps its own follow-ups to 8:00–20:00 **dealer** time. Nothing tells inbound and outbound apart, checks consent or uses the customer's time zone. In the platform, only appointment reminders have quiet hours ([appointmentReminderService.js](../../../../../../aidmvcs-be-dev/app/lib/appointmentReminderService.js), 9:00–20:00 dealer time). |
| 3 | "The main goals are always qualifying the customer and using their responses to schedule an APPOINTMENT. Don't escalate every customer; strike while the iron is hot." | The conversation should end with a booked visit, not a handoff to staff. | **No.** Booking was out of scope in Plans 1 and 2. A qualified lead is passed to staff, and Compose is told never to say a visit is booked ([agent/llm.py](../../../agent/llm.py)). |

## What already exists

| Piece | Where | State |
|---|---|---|
| Bookings | Platform `Booking` model and `POST /api/booking` | Creates a booking (`pending` / `confirmed` / `cancelled` / `completed`), sets the lead to "Appointment Booked", sends the confirmation email and SMS, and creates reminders. Built for staff; no AI caller. |
| Dealer calendar | Platform `dealer/booking` (LeadCalendar) | Staff see bookings here. |
| Reminders | Platform `appointmentReminderService.js` | Its own quiet hours, 9:00–20:00 dealer time. |
| SMS consent | Platform `Customer.sms_opt_in` | A yes/no flag. There's no record of when or how consent was given. |
| Staff status pauses the AI | Platform `lib/ai/aiStaff.js` (`notifyAiOfStaffStatus`) | Moving a lead to "Appointment Booked" pauses the AI. A booking made by the AI must not do that. |
| Business hours, dealer time zone, dates | Plan 2: `integrations/dealer_profile.py`, `slots/dates.py`, `scheduler/contact_window.py` | Ready to reuse for "are we open?", offering times, and reading "Saturday at 10". |
| Campaigns | Platform `Campaign` model and its sender | Has scheduled sends. Has no type (drip / equity / one-off) and no compliance check before sending. |

## Principles

1. **The visit is the goal.** Every qualified or partly qualified lead gets a visit offer before anything is passed to staff. A handoff is for when the customer needs a person, not a default ending.
2. **Compliance is code, not prompt.** One send check decides "send now / wait until / blocked", with the reason recorded, for every message the AI or a campaign sends. The model is never asked whether a message is legal.
3. **When unsure, treat it as outbound.** An unknown origin, unknown consent or unknown time zone gets the strictest rule.
4. **Never claim a booking that doesn't exist.** "You're booked" is said only when the booking record was created in this turn.
5. Plan 2's rules still hold: one question per message, never silent, plain words, all tests and scenarios keep passing.

## Phase overview

| # | Phase | You can see it when |
|---|---|---|
| B0 | Decisions | The answers are written into architecture.md, with counsel's sign-off on B0.2–B0.6 |
| B1 | After-hours first reply | A lead at 23:00 dealer time gets "chat now or during business hours?", and each answer leads to the right path |
| B2 | Inbound or outbound | Every lead and message shows its origin in the Debug UI, and unknown means outbound |
| B3 | Send check (US rules) | An outbound SMS with no consent is blocked; one due at 7:30 customer time waits until 8:00; each shows its reason |
| B4 | The visit as the goal | A qualified lead is offered a visit instead of being handed to staff; handoffs drop |
| B5 | Booking the visit | "Saturday at 10 works" creates a booking in the dealer's calendar, and the customer gets a confirmation |
| B6 | Debug UI, evals and rollout | Evals for booking and compliance pass on the real models, and the rollout check tracks booking rate and blocked sends |

**Before Tuesday (29 September 2026), realistic:** B0 answered, and B1 built and tested. B2 and B3 need platform changes and counsel's answers, so they follow.

---

## Phase B0: Decisions

1. **What "after hours" means.** Suggested: outside the dealer's opening hours (`weekly_availability`, otherwise Monday–Saturday 9:00–18:00), not the 8:00–20:00 contact window. A lead at 19:00 is after hours but can still be texted.
2. **The first reply to an inbound lead at night.** The customer just asked to be contacted, but it's still a text at night. Options:
   - **A:** reply by SMS at any hour (fastest; today's behaviour);
   - **B:** at night (20:00–8:00 customer time), reply by email if we have one, and hold the SMS until 8:00;
   - **C:** reply by SMS at night only if the lead arrived in the last few minutes (the customer is waiting for it).
   **Suggested:** C, with B as the fallback. **Counsel to confirm.**
3. **What counts as outbound.** A list of lead sources and campaign types, e.g.
   - outbound: Dealer Vault / DMS imports, sales equity, drips, service reminders sent as marketing, re-engagement;
   - inbound: website forms, third-party lead providers, phone-ups, a customer writing first.
   Needs the platform's real `Lead.source` values and a new campaign type.
4. **Consent.** What proves consent for marketing texts (prior express written consent): a form checkbox, a signed sales document, a keyword opt-in. Where it's stored (today only `sms_opt_in`, with no date or source). **Suggested:** no outbound SMS without a consent record with a date and source; email allowed with an unsubscribe link (CAN-SPAM).
5. **Customer time zone.** Suggested order: the customer's postal code, then the phone's area code, then the dealer's. Outbound SMS only when it's 8:00–20:00 in **both** the customer's and the dealer's time zone.
6. **State rules.** Some states are stricter than the federal TCPA; for example, Florida and Oklahoma limit marketing texts to 8:00–20:00 and to 3 per 24 hours on the same subject. **Counsel provides the state table**; code applies it by the customer's state.
7. **Do-not-call.** An internal do-not-contact list per dealer (from STOP / unsubscribe, already kept by Plan 1), and whether numbers without consent are scrubbed against the national Do Not Call registry (a paid service).
8. **Replies inside an outbound conversation.** When a customer answers an equity campaign at 22:00, does our reply wait until 8:00? **Suggested:** reply right away (the customer wrote first), but follow-ups keep the outbound rules. **Counsel to confirm.**
9. **Visit types.** Sales visit / test drive, and service. **Suggested:** sales visits and test drives first. Service booking stays with the service team for now, because service scheduling usually lives in the DMS.
10. **Booking rules.**
    - Slot length (suggested 30 minutes);
    - how many bookings per slot;
    - the earliest time offered (suggested at least 2 hours ahead, and within opening hours);
    - how far ahead (suggested 7 days).
11. **Confirmed or requested.** Does an AI booking go in as `confirmed`, or `pending` until staff confirm? **Suggested:** a per-dealer setting, `pending` by default. Pending: the customer hears "I've requested Saturday at 10:00; the team will confirm shortly."
12. **When to offer a visit.** Suggested:
    - as soon as we know what they want (the model or type) and roughly when; the rest of the questions can happen at the dealership;
    - or right away when the customer shows a buying signal ("can I come see it?", "test drive", "is it still there?").
13. **When to hand off.** Suggested, only when:
    - the customer asks for a person;
    - they are clearly upset (Plan 2's 0.8 rule);
    - they declined a visit twice and still have a question only staff can answer (price, trade-in value, finance).

---

## Phase B1: After-hours first reply

1. **Detect:** a new inbound lead outside opening hours (B0.1), in the dealer's time zone. It's shown in the context pack's `now` layer as `open_now: false` with the next opening time.
2. **The first reply** answers what the customer wrote, and adds one choice instead of a question:
   "We're closed right now and open again at 9:00 tomorrow. I can help you here now, or the team can pick this up when we open. Which would you like?"
   On SMS at night it follows B0.2.
3. **Understanding the answer:** Extract gets a new field `contact_preference`: `now` / `later` / none. Short replies ("now", "tomorrow is fine", "morning") are read against the choice, like Plan 2's short replies.
4. **Paths:**
   - **Now:** the normal conversation carries on.
   - **Later:** a short thank-you, no more questions tonight, and a new follow-up kind `resume_at_opening` due at the next opening time. At opening, the team gets the lead with a summary, and the AI sends one message ("Good morning, the team is in now…"), within B3's rules.
   - **No answer:** the normal 24h follow-up, sent inside the contact window.
5. **Conversation state** records the choice, so it's never asked again for this lead.

**Tests:** after-hours detection per dealer time zone and hours; each path; the choice asked once; a `later` answer stops questions until opening.

**Scenarios:**
- `pb1_after_hours_now.yaml`: a lead at 23:00, the customer says "now", the conversation carries on.
- `pb1_after_hours_later.yaml`: the customer says "tomorrow", then the clock moves to 9:00 and the resume message goes out.

**Done when:** both scenarios pass, and a lead during opening hours gets no choice.

---

## Phase B2: Inbound or outbound

1. **Platform:**
   - `Lead` gets a `contact_origin` (`inbound` / `outbound`), set from the source list in B0.3 when the lead is created or imported.
   - `Campaign` gets a `campaign_type` (`one_off` / `drip` / `sales_equity` / `service_marketing` / …), and each type maps to outbound.
   - The AI events (`lead-created`, `inbound-message`, campaign replies) carry the origin.
2. **AI:** the origin is saved in lead state and shown in the context pack. Missing or unknown means `outbound` (principle 3).
3. **Existing leads:** a one-off backfill from `Lead.source`, and a report of sources it couldn't map, for the client to classify.

**Tests:** the mapping table, the unknown default, and the origin travelling from platform to AI.

**Scenario:** `pb2_origin.yaml`: a website lead shows inbound, a Dealer Vault import shows outbound, and a lead with no source shows outbound.

---

## Phase B3: Send check (US rules)

One check, used by every sender: the AI sender, the AI follow-up scheduler, the platform's campaign sender and appointment reminders.

1. **`may_send(customer, channel, origin, kind, at)`** returns `send`, `wait_until <time>` or `blocked <reason>`. Rules:
   - **Opt-out:** STOP / unsubscribe blocks everything except the opt-out confirmation (already in Plan 1; moved here).
   - **Consent:** an outbound marketing SMS needs a consent record (B0.4); otherwise it's blocked.
   - **Do-not-contact:** the dealer's list, and the national registry if B0.7 says so.
   - **Time of day:** 8:00–20:00 in the customer's and the dealer's time zone (B0.5), with state rules on top (B0.6). Otherwise the send waits.
   - **Frequency:** per-state limits (e.g. 3 marketing texts per 24 hours) counted across the AI and campaigns.
   - **Email:** no time limit; an unsubscribe link and the dealer's postal address on marketing emails (CAN-SPAM).
2. **Customer time zone** is worked out in code (B0.5) and saved on the lead, with how it was found (postal code, area code, dealer).
3. **Consent record:** the platform stores when, how and for which dealer consent was given, next to `sms_opt_in`. The lead forms and imports are updated to fill it.
4. **Audit trail:** every decision is saved with its reason and the rule that applied, so a dealer can show why a message was or wasn't sent.
5. **Plan 2's contact window** (`scheduler/contact_window.py`) becomes part of this check, and the appointment reminders' own 9:00–20:00 rule is replaced by it.
6. **Metrics:** sends blocked or delayed, by reason. "Sent outside the allowed hours" must be 0.

**Tests:** table-driven, one row per rule and state: consent missing, opt-out, a customer in another time zone, a frequency cap reached, email always allowed, and unknown data treated strictly.

**Scenarios:**
- `pb3_no_consent_blocked.yaml`: an equity campaign reply follow-up to a customer without consent is blocked, with the reason.
- `pb3_customer_time_zone.yaml`: a New York dealer and a Los Angeles customer; a follow-up due at 9:00 New York time waits until 8:00 Los Angeles time.

**Done when:** every sender goes through the check, and counsel has reviewed the rules table.

---

## Phase B4: The visit as the goal

1. **Decide gets a rule `offer_visit`,** between `answer` and `ask`. It fires when:
   - what B0.12 needs is known;
   - or Extract flags a buying signal (a new `wants_visit` field: "can I come see it", "test drive", "is it still there?").
2. **The endings change:**
   - `qualified` and `partly_qualified` no longer end with a handoff. They lead to `offer_visit`.
   - The lead goes to the team **when a visit is booked**, or on the handoff reasons in B0.13.
   - Every current handoff reason is reviewed against B0.13.
3. **The offer:** one message, two or three concrete times from Phase B5 (not "when would you like to come in?"), plain words, no pressure. It still answers the customer's question first, and it counts as the message's one question.
4. **When the customer declines:** a short "no problem", the visit isn't offered again for 3 replies (like Plan 2's parked asks), and at most twice per lead.
5. **Conversation state:** visit offers made, the times offered, declined or not.
6. **Follow-ups:** an unanswered visit offer gets the 24h follow-up with fresh times, inside B3's rules.
7. **Metrics:** visit offer rate, booking rate, handoff rate. The client's goal is fewer handoffs and more bookings, so both are shown per dealer.

**Tests:** when `offer_visit` fires and when it doesn't; the buying signal; a decline parks the offer; the new endings; a qualified lead is no longer handed off.

**Scenarios:**
- `pb4_offer_after_qualified.yaml`: a sales lead answers the key questions and gets a visit offer, not a handoff.
- `pb4_buying_signal.yaml`: "can I come see it this weekend?" on the first reply gets times straight away.
- `pb4_declined.yaml`: "not yet" parks the offer, and the conversation carries on.

---

## Phase B5: Booking the visit

1. **Available times, in code:**
   - built from the dealer's opening hours, existing platform bookings, and the booking rules in B0.10;
   - loaded into the context pack as `visit_times`, 2–3 options in the customer's time zone, in plain words ("Saturday at 10:00 AM").
2. **Reading the customer's pick:** "the second one", "Saturday 10 works", "after 5 tomorrow". Matched in code to the offered times using Plan 2's date resolver. A time that wasn't offered is checked against availability; an unclear answer gets one confirming question.
3. **Creating the booking:**
   - a new internal platform endpoint (shared secret, like the other AI routes) that reuses `POST /api/booking`'s logic: the `Booking` record (`pending` or `confirmed` per B0.11), the lead status, the confirmation message and reminders;
   - idempotent per lead and time, so a retry never books twice;
   - if the time was just taken, the reply offers the next free times instead.
4. **The AI isn't paused by its own booking:** the platform marks the booking as made by the AI, so `notifyAiOfStaffStatus` doesn't treat it as a staff takeover. After the booking, the lead is in a `booked` state: the AI answers questions, and asks nothing more.
5. **Changes:** "can we make it 11 instead?" offers new times and moves the booking; "I can't make it" cancels it, offers new times once, and tells the team.
6. **The team is told** of every booking, with the customer's summary (what they want, budget, trade-in), so staff are ready when they arrive.
7. **Guard:** "booked", "confirmed" and "see you on…" are allowed only when this turn created or confirmed a booking; otherwise the draft is rejected. Compose's "never say booked" rule is replaced by this.

**Tests:** time building (hours, existing bookings, earliest time); matching the customer's pick; idempotent creation; slot taken; move and cancel; no pause after an AI booking; the guard's booked rule.

**Scenarios:**
- `pb5_book_visit.yaml`: an offer, "the second one", a booking created, and a confirmation sent.
- `pb5_slot_taken.yaml`: the chosen time is taken meanwhile, and new times are offered.
- `pb5_reschedule.yaml`: a booked customer asks to move it.

**Platform e2e:** an AI booking appears in the dealer calendar, the lead shows "Appointment Booked", and reminders are created.

**Done when:** the three scenarios and the e2e pass, and a booking never pauses the AI.

---

## Phase B6: Debug UI, evals and rollout

1. **Debug UI:**
   - each send shows its origin and the send check's decision with the reason;
   - a Visit panel: times offered, the customer's pick, the booking and its status;
   - the Scheduler tab also shows the customer's local time;
   - the simulator can create an outbound lead and set consent on or off.
2. **Evals:**
   - conversations that end in a booking;
   - a decline respected;
   - no "booked" without a booking;
   - the after-hours choice;
   - outbound sends blocked for each reason.
3. **Real-model run** of the eval gate, with the booking rate and cost per turn recorded.
4. **Manual test script:** after hours now and later, booking, rescheduling, and an outbound customer without consent.
5. **Rollout check** adds: booking rate, handoff rate, sends outside the allowed hours (must be 0), and sends without consent (must be 0).

**Done when:** one dealer has been live for a week with zero sends outside the rules, and a booking rate and handoff rate the client agrees with.

---

## Not in this plan

- Prices, payments, discounts, trade-in values (unless Phase 0 allows prices)
- Holding or reserving a vehicle
- Booking service appointments (B0.9 suggests sales visits and test drives first)
- Writing bookings back to the DMS
- Photos in messages
- Cross-dealer (group) inventory
- Upselling accessories or products

---

# Part C: TCPA AI Compliance Guardrails & Omnichannel Workflow Spec Implementation

> **Source Documents:**
> 1. [`../../data/AutoPulse_TCPA_AI_Compliance_Guardrails_Developer_Spec.pdf`](../../data/AutoPulse_TCPA_AI_Compliance_Guardrails_Developer_Spec.pdf)
> 2. [`../../data/AutoPulse_New_Lead_Follow_Up_Workflow_OMNICHANNEL_FINAL.pdf`](../../data/AutoPulse_New_Lead_Follow_Up_Workflow_OMNICHANNEL_FINAL.pdf)
> 3. [`../../data/conversation_3.md`](../../data/conversation_3.md)
>
> **What this is:**
> Part B introduced basic inbound/outbound origin tracking and an initial `may_send` check. Part C formalizes the client's mandatory developer specs for TCPA & AI Compliance Guardrails and the Omnichannel New Lead Follow-Up State Machine.
>
> **Key Principles:**
> 1. **Compliance Engine Gate:** The AI *never* decides whether a message is legal. Every send passes through a deterministic Compliance Engine returning `ALLOW`, `HOLD`, `REVIEW`, or `BLOCK`. `BLOCK` / `REVIEW` can never be overridden by the AI or users.
> 2. **Omnichannel Mandate (CALL + TEXT + EMAIL):** Every scheduled follow-up touch engages all permitted channels simultaneously (AI SMS + AI Email + Human Call Task).
> 3. **1-Hour Call Escalation Timer:** Every AI touch starts a 60-minute connection timer. If no meaningful contact occurs within 60 minutes, a human call task is activated for dealership staff (respecting agent work hours).
> 4. **Master State Machine & Priority:** Strict state machine handling (`New Lead`, `Short-Term Follow-Up`, `No Contact Made`, `Contact Made - No Next Action`, `Contact Made - Specific Follow-Up`, `Appointment Set`, `Appointment No Show`, `Sales Visit`, `Opted Out / Suppressed`, `Opportunity Closed - No Response` on Day 91).

---

## Phase Overview (Part C)

| # | Phase | You can see it when |
|---|---|---|
| C1 | Compliance Engine & Evidence Schema | Sends return `ALLOW`/`HOLD`/`REVIEW`/`BLOCK`, natural-language opt-outs route to `REVIEW`/suppression, and evidence metadata is saved |
| C2 | Omnichannel Rule & 1-Hour Call Escalation | Scheduled follow-up sends SMS + Email and starts a 60-min timer that activates a staff call task if no response |
| C3 | Master State Machine & Priority Engine | Lead transitions cleanly through Short-Term, Specific, Appointment, No-Show, Sales Visit, and Day 91 closure with pre-send rechecks |
| C4 | Short-Term Cadence & Required Touch Rules | Touch 1 ends with "Tell me, what are you driving now?", Touch 2 sends "{FirstName}?" nudge 3 hours later, and Days 2-7 follow thematic angles |
| C5 | Appointment Confirmation, No-Show & Sales Visit | 15-min confirmation sent, Day-before Y/N router handles replies, +1h No Show triggers check-in, and Sales Visit requires manager outcome |
| C6 | Edge Cases & Operational Hardening | Wrong number/bad phone suppressed, email hard-bounces handled, duplicate leads merged, and photo fallbacks enforced |

---

## Phase C1: Compliance Engine & Evidence Schema

1. **Deterministic Compliance Engine (`can_contact` service):**
   - Signature: `can_contact(customer_id, dealer_id, channel, purpose, timestamp) -> ALLOW | HOLD | REVIEW | BLOCK`.
   - LLM Guardrail: The LLM is explicitly forbidden from creating, inferring, or changing consent statuses or overriding compliance decisions.
2. **Consent Evidence Profile:**
   - Store immutable consent evidence: `consent_status`, `consent_type`, `consent_timestamp`, `consent_source`, `consent_text_version`, `consent_evidence_id`, `consenting_seller_id`, `source_url`.
   - DMS/DealerVault rule: DMS presence *never* implies consent (`TCPA_PERMISSION = YES`).
3. **Natural-Language Opt-Out & Ambiguity Handling:**
   - Explicit keywords: `STOP`, `END`, `CANCEL`, `UNSUBSCRIBE`, `QUIT`.
   - Natural language: "don't text me", "leave me alone", "remove my number", "take me off your list".
   - Ambiguous phrases route to `REVIEW` and immediately suspend automated marketing.
4. **AI Voice Channel Control:**
   - AI outbound voice treated as a separate, higher-risk channel, disabled by default.
5. **Auditable Compliance Event Logging:**
   - Record timestamp, dealer_id, customer_id, channel, purpose, consent_evidence_id, jurisdiction, local_time, DNC results, frequency check, decision, and decision_reason for every attempted send.

**Tests:** `can_contact` table-driven tests for all 4 outcomes, natural-language opt-out parsing, evidence immutability, and compliance audit log generation.

---

## Phase C2: Omnichannel Rule & 1-Hour Human Call Escalation

1. **Omnichannel Execution Rule:**
   - Scheduled follow-up triggers all permitted and valid channels: AI Text + AI Email + Human Call Task checkpoint.
2. **1-Hour Connection Timer & Call Escalation:**
   - On successful AI SMS/Email send, start a 60-minute connection timer.
   - Watch for meaningful customer reply/contact during the 60 minutes.
   - If contact occurs: cancel the pending human call task.
   - If no contact at 60 minutes: activate/surface the human call task in the platform UI for staff (Click-to-Call supported).
3. **Work Hours & Compliance Guardrail:**
   - Human call tasks respect agent work schedules and time-of-day compliance rules; defer to next eligible call window if outside hours.
   - Re-check current lead status immediately before activating stale call tasks.

**Tests:** 60-minute timer activation, cancellation on reply, task creation on expiration, agent schedule deferral, and pre-activation state recheck.

---

## Phase C3: Master Lifecycle State Machine & Priority Engine

1. **State Machine Statuses:**
   - `New Lead`, `Short-Term Follow-Up`, `No Contact Made`, `Contact Made - No Next Action`, `Contact Made - Specific Follow-Up`, `Appointment Set`, `Appointment No Show`, `Sales Visit`, `Opted Out / Suppressed`, `Opportunity Closed - No Response`.
2. **Event Priority & Race-Condition Control:**
   - Order of precedence: `1. OPT-OUT / COMPLIANCE BLOCK` > `2. SALES VISIT` > `3. APPOINTMENT SET` > `4. CONTACT MADE - SPECIFIC FOLLOW-UP` > `5. APPOINTMENT NO SHOW` > `6. CONTACT MADE - NO NEXT ACTION` > `7. NO CONTACT MADE` > `8. NEW LEAD`.
   - Pre-send re-check: Re-read status, reply state, appointment state, sales visit state, and compliance check before executing any queued action.
3. **Opportunity Clock & Day 91 Expiration:**
   - `opportunity_created_at` is immutable and never resets on cadence re-entry.
   - Day 91 closes active opportunity while retaining customer record and history.

**Tests:** State transitions across all events, priority resolution when events conflict, pre-send re-check canceling stale tasks, and Day 91 opportunity closure.

---

## Phase C4: Short-Term Cadence & Required Touch Rules

1. **Touch 1 Structure (Immediate):**
   - Answers customer lead questions.
   - Mandated closing prompt line: *"Tell me, what are you driving now?"*.
2. **Touch 2 Name Nudge (3 Hours Later):**
   - If no response after 3 hours (inside permitted window), send nudge: `"{FirstName}?"`.
3. **Days 2–7 Follow-up Angles:**
   - Day 2: Vehicle visual (photo).
   - Day 3: Financing help prompt (no fabricated terms).
   - Day 4: Trade-in appraisal prompt.
   - Day 5: Verified vehicle feature/value highlight.
   - Day 6: Appointment value proposition.
   - Day 7: Direct closing appointment offer.
4. **Days 8–90 Extended Cadence:**
   - Days 8–30: 1 outreach cycle/week (SMS + Email).
   - Days 31–90: 1 outreach cycle/month (SMS + Email).

**Tests:** Touch 1 required ending validation, Touch 2 3-hour trigger execution, thematic angle selection, and weekly/monthly cadence transitions.

---

## Phase C5: Appointment Confirmation, No-Show & Sales Visit Workflows

1. **Appointment Confirmation Sequence:**
   - 15 minutes post-booking: Send appointment details text & email confirmation.
   - Day before appointment: Text & Email `"Hello {customer_first_name}... confirming our meeting for {date} at {time}. Does this time still work? Please reply Y for Yes or N for No."`.
   - Confirmation Router: `Y` -> mark `appointment.confirmed = true`; `N` -> trigger immediate reschedule workflow; Ambiguous -> ask for clarification.
2. **Appointment No-Show Flow:**
   - Trigger: Appointment time + 1 hour with no qualifying `Sales Visit`.
   - Touch 1 (+1 hr): SMS + Email + Photo: *"I am looking for you in the showroom - are you here and working with someone?"*.
   - Touch 2 (+24 hrs if no reply): SMS + Email: *"How did everything go when you came in?"*.
   - No reply after Touch 2 -> route to `Contact Made - No Next Action` -> Short-Term Follow-Up.
3. **Sales Visit Trigger & Manager Outcome:**
   - Customer check-in at dealership SALES sets `Sales Visit` immediately and halts all automated follow-up.
   - If on appointment date: marks `appointment.showed = true`.
   - Requires manager outcome selection: `SOLD PENDING`, `SOLD DELIVERED`, or `UNSOLD`.

**Tests:** 15-min confirmation, day-before Y/N routing, +1h No Show trigger, +24h check-in, routing to Short-Term, and Sales Visit manager outcome mandate.

---

## Phase C6: Edge Cases & Operational Hardening

1. **Wrong Person / Bad Number:**
   - Mark as bad number / data suppression outcome; permanently cease outreach to that number.
2. **Hard-Bounce Email:**
   - Suppress invalid email address upon provider hard bounce; permit remaining valid channels (SMS) to continue.
3. **Duplicate Lead Handling:**
   - Merge/link duplicate leads to existing customer record; prevent duplicate active workflow instances.
4. **Photo Fallback Guardrail:**
   - If requested vehicle photo is unavailable, never send unrelated or fabricated photos; fall back to non-photo text message.

**Tests:** Bad number suppression, email hard-bounce channel isolation, duplicate lead merge prevention, and photo fallback enforcement.

