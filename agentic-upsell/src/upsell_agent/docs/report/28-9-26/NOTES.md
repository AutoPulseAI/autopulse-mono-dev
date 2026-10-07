# Plan 3 notes: 28 September 2026

Branch `plan_3b`. Part B readiness review: MASTER_PLAN_3 Part B was checked against the AI service and the platform code (`aidmvcs-be-dev`), not just re-read. Recorded in `docs/architecture/architecture.md` §15 (decisions 55–71) and in `docs/plans/PLAN_3/MASTER_PLAN_3.md` Part B.

**Our default** = decided by us because no client document answers it. Flagged for client feedback (list at the bottom).

## Where Part B stands

- Part B can't start on its own: C1's compliance engine, which contains B2 and B3, isn't built.
- **New phase Bq, two questions per message** (decision 71), built after C1 and before B1. `slots/policy.py` still has `MAX_ASKS_PER_MESSAGE = 1`. Bq raises it to 2, updates Compose's instructions and the offline model, and updates Plan 2's tests.
- ~~One item is still open: how the platform's campaign worker gets the send check's answer.~~ Decided later today (decision 66, below). Nothing in Part B's decisions is open now.

## What "the compliance engine" / "the send check" is

A piece of code (Part C's C1; Part B calls it B3's send check, and it's the same thing) that answers, before any message goes out: "may we send this message to this person, on this channel, right now?" It checks, in code, never by the AI model:

- **opt-out:** STOP, unsubscribe, an unclear opt-out waiting for review;
- **consent:** for marketing texts (decision 36);
- **do-not-contact:** the dealer's list;
- **time of day:** the customer's local window, plus dealer opening hours for messages we start;
- **frequency:** at most 3 marketing messages per customer per 24 hours (interim).

Answers: **ALLOW** (send), **HOLD** (send later, at a given time), **REVIEW** (unclear; stop marketing until a person looks), **BLOCK** (never). Every sender goes through it: the AI's replies, the AI's follow-ups, and the platform's campaign sender.

## Decided today

### 1. One engine signature (decision 55)

B3 and C1 described the same check differently (3 vs. 4 outcomes, different inputs). One version: `can_contact(customer_id, dealer_id, lead_id, channel, purpose, is_reply, at) -> ALLOW | HOLD | REVIEW | BLOCK`. REVIEW stops marketing but lets a reply go out.

### 2. Inbound conversations continue at any hour (decision 56, replaces decision 29 for inbound)

**The question:** B0.2 said a reply goes out at night but the conversation only continues inside 8:00–21:00 customer time. That made B1's "chat now" option meaningless at night.

**What B0.2 was based on:** the client's blueprint, box 0 "CUSTOMER WANTS HELP NOW": "AI acknowledges and continues the conversation immediately (**if within TCPA allowed hours**)".

**Checked against every client source for the user's view** ("the after-hours choice is about the dealer's hours; for an inbound lead we don't apply the customer-local window"):

| Source | Says | Supports the user's view? |
|---|---|---|
| Client chat, 25 Sept (`conversation_2.md`) | "if a lead comes in after hours… option… to connect now or during business hours"; "if he says yes i need it now then it will start communication right away"; strict TCPA rules for DealerVault drips/equity "cause that is outbound task where a lead is more classified as an inbound task" | **Yes.** "After hours" means business hours; "now" means right away; strict rules are for outbound |
| TCPA spec PDF §4 | Consumer-initiated lead response: "evaluate response rules". Outbound marketing: "full outbound campaign compliance checks" | **Yes.** Different treatment for inbound |
| TCPA spec PDF §7 | The time window is checked "before every **covered outbound** attempt" | **Yes** |
| TCPA spec PDF p.2 "Hours" | "Determine recipient local time and applicable state restrictions before sending" | General wording, no inbound/outbound split |
| Blueprint box 0 | "LEAD RECEIVED… day or night" → "AI checks customer local time, TCPA rules" → "continues the conversation immediately (**if within TCPA allowed hours**)" | **No.** It limits continuing, even for a new lead |

**Result:** the user's view matches the client's latest words (the 25 Sept chat) and the TCPA spec. The blueprint says otherwise. **Decided:** follow the user's view.
- An inbound conversation is answered and continued at any hour.
- B1's choice is offered whenever the dealer is closed.
- Outbound conversations (campaign replies, DealerVault contacts) keep decision 29.
- Proactive messages keep the outbound rules, even on inbound leads.
- **Flagged for client confirmation** because of the blueprint's wording.

### 3. B1 "later" is not a handoff (decision 57)

At opening, the team gets a summary as a notification; the AI stays in charge and moves the conversation on.

**Can staff take over at any time? Yes. Already built, nothing to add.** Any of these pauses the AI for that lead:
- a staff member replies in the platform's conversations screen (`notifyAiOfStaffReply`, `api/conversations/reply/route.js`);
- staff set a staff-owned status: Appointment Booked, Visited, Sold, DND or Managerial Review (`notifyAiOfStaffStatus`);
- an admin pause (`pauseAiForLead`).

### 4. KNOWN GAP: old reminders after the AI moves or cancels a booking (decision 58). Tolerated until C5.

- **What happens:** the platform schedules its own reminder messages for every booking. Checked in `aidmvcs-be-dev`:
  - `PUT /api/booking` on a move creates new reminders but never cancels the old ones → the customer gets reminders for **both** the old and the new time;
  - on a cancel it cancels **no** reminders → the customer is reminded of an appointment that no longer exists;
  - the reminder sender (`appointmentReminderService.js`) never checks the booking's status.
  - Staff don't hit this: their status screen calls `cancelAllRemindersForLead` first.
- **Accepted until C5**, which switches the platform's reminders off for AI dealers (dealer Settings → Reminder settings, no code).
- **Meanwhile:** the team notification for an AI move or cancel says the old reminders will still go out, so staff can clear them. The AI service doesn't write to the platform's reminder records.

### 5. KNOWN GAP: a cancelled booking leaves the lead "Appointment Booked" (decision 59). Interim, not permanent.

- **What happens:** a cancel through `PUT /api/booking` changes the booking, not the lead. The lead stays "Appointment Booked" on the staff screens. The only route that changes a lead's status is the staff status route, and moving to a staff-owned status there pauses the AI.
- **Interim:** leave the status; the team notification says "the customer cancelled; please update the lead's status"; the AI's own lead state goes back to active so it can offer new times. No platform data is changed by the AI service.
- **The proper fix (platform code changes, not approved in this plan):**
  1. `PUT /api/booking`, on `booking_status: cancelled`: cancel the lead's pending reminders (`cancelAllRemindersForLead`), set the lead's `fe_lead_status` to a status that isn't staff-owned (e.g. back to "Contacted") so the AI isn't paused, and clear the lead's `data.booking` / `booking_status`.
  2. `PUT /api/booking`, on a date/time change: cancel the lead's pending reminders before creating the new ones (also fixes gap 4 for good).
  3. The reminder sender: skip a reminder whose booking is cancelled (safety net).
  4. Fix the reminders' `booking_id`, which actually stores the lead id (`POST /api/booking` passes `_id: lead_id`), so `cancelRemindersForBooking` can find them.

### 6. Booking wording in the guard (decision 60)

Booking wording is allowed whenever a real, non-cancelled booking exists (read fresh each turn), not only in the turn that made it. `pending` → "requested"; `confirmed` → "confirmed" / "booked".

### 7. Visit times in dealership time (decision 61)

Visit times are shown in the dealership's time zone, and the zone name is added only when the customer's zone differs.

### 8. When to offer a visit (decision 62)

Offer a visit once the vehicle (model or type) and a rough timeframe are known, or right away on a buying signal.

### 9. `visit_followup` (decision 63)

After the third decline, a new follow-up kind is due on the customer's date, otherwise in 3 days. C4 replaces it when it ships.

### 10. Handoff reasons (decision 64)

A staff-only question alone isn't a handoff; the AI hands off only after 3 declines with the question still open. Upset and urgent still hand off at any time. **Confirmed against the code and plan:**
- **Upset:** built (`slots/policy.py`, `UPSET_HANDOFF_CONFIDENCE = 0.8`).
- **Asked for a person:** built.
- **Urgent need:** decided 27 Sept (decision 26), but **no phase built it**. B4 only said "the handoff reasons in B0.13". Now an explicit B4 item (item 8) with tests.

### 11. Inbound/outbound per lead (decision 65)

**Why DealerVault is outbound:** DealerVault is the dealer's DMS export, the list of people who once bought or serviced a car there, imported into the platform. None of them asked to be contacted now, so messaging them is the dealer reaching out. The client said it directly (`conversation_2.md`), and the TCPA spec §4–5 says DMS/DealerVault data "may identify an opportunity; it does not itself establish permission". A DealerVault customer who then fills in a website form has an **inbound** lead.

**Order:**
1. campaign reply → outbound;
2. known website/provider/phone-up source → inbound;
3. DealerVault import with no lead form of its own → outbound;
4. anything else → outbound, and reported.

The real `Lead.source` values are pulled from the dev database before B2 is built.

### 12. Consent-ask email: on hold, the client never asked for it (decision 67)

First agreed with Yes / No buttons; **withdrawn later the same day** under the rule "do exactly what the client asked".

**What the client has said (checked in `conversation_2.md`, the blueprint and both spec PDFs):**
- Nothing about asking for text consent by email: no "Reply YES", no buttons, no consent email at all. The email ask was our own proposal on 27 Sept.
- The only "reply Y or N" in the client's documents is the day-before **appointment** confirmation (Omnichannel PDF), not consent.
- What the TCPA spec does require about consent:
  - DealerVault/DMS presence never creates consent (§5 and checklist);
  - every consent keeps an auditable evidence record, including the disclosure text and its version, and can't be changed afterwards (§2, §6, checklist);
  - missing or unverifiable evidence → `CONSENT_REVIEW_REQUIRED`, no automated marketing (§6);
  - the AI never creates, infers or changes consent (§2, §10);
  - counsel approves the consent/disclosure wording per campaign and channel (§12).

**Result:** the ask isn't built. Contacts without text consent get email only (decision 36 step 6). It comes back only if the user or the client asks for it.

### 13. No national Do Not Call check (decision 68)

We don't check the national DNC registry. Leads staff set to "DND" join the internal do-not-contact list.

### 14. Counsel review later (decision 69)

Part B is built with the rules decided; counsel reviews them later. The review doesn't block building or shipping.

### 15. Two-zone states (decision 70)

When only the state is known and it spans two zones, only the hours legal in both are used.

## Decided later today: campaign texts are handed to the AI service (decision 66)

**Decided: option B below** (it was open earlier today).
- When a campaign fires, the platform's campaign worker doesn't send the texts itself. It writes one send request per lead into a shared queue collection.
- The AI service runs the full send check, then sends from the dealer's number, holds, or blocks.
- The AI service writes the result back to that lead's `CampaignLead` record.

**Does a campaign report already exist? Yes; it's extended, not built.**
- **What exists:**
  - the page `dealer/campaigns/[id]/report/page.js`, fed by `GET /api/campaigns/[id]/report`;
  - count cards (sent, delivered, …), a status badge on every lead, a status filter, a search and a CSV export.
- **What it's missing:** a campaign lead's status can only be `pending`, `sent`, `delivered`, `failed` or `bounced` (`models/CampaignLead.js`). A held lead would sit as "pending" forever, and a blocked one would have nowhere to go, or would wrongly show as "failed".
- **What we add:**
  - on the `CampaignLead` model: two statuses, `held` and `blocked`, and two fields, `held_until` and `block_reason`;
  - in the report API: counts for both;
  - on the page: two count cards ("Held until…", "Blocked"), badge colours, the two statuses in the filter, and the time or reason on each lead's row and in the export.

**How it was decided:** the options as they were compared are below.

**Background:** platform campaigns are sent by `worker/campaignWorker.js` (Node, in the platform), one lead at a time. The send check lives in the AI service (Python). Each campaign text must pass the full check: opt-out, consent, do-not-contact, time of day, dealer hours and the frequency cap, not just the hours. The approved platform change (decision 31a) lets the worker apply it; how it gets the answer is open.

**Rejected:** the worker calls a private web endpoint on the AI service for every lead, and retries if the service is down.

**Options:**

| Option | How it works | For | Against |
|---|---|---|---|
| **B. Hand campaign texts to the AI service** (recommended) | When a campaign fires, the worker doesn't send; it writes one "send request" per lead into a shared queue collection in the same database. The AI service picks each up, runs the check, sends / holds / blocks through its own sender, and writes the outcome back to the `CampaignLead` (for the report) | One copy of the rules; no live call between services; if the AI service is down, requests just wait (safe by default); one audit trail; the frequency cap sees every send | Campaign texts leave the platform's sender, so the AI service must send from the dealer's own number (to confirm against `channels/dealer_identity.py`); the platform worker change is a bit larger |
| C. Copy the rules into the platform worker | The worker runs its own Node version of the check, reading the same `ai_consent` and message records | No dependency on the AI service | Two copies of legal rules that will drift apart; the audit trail is split across two systems |
| D. AI service pre-computes, worker finishes | The AI service keeps an up-to-date "contactability" record per customer (opt-out, consent, do-not-contact, time zone); the worker reads it and applies only the time window and frequency cap | No live call; the heavy rules stay in one place | The time and frequency rules still exist twice; the record can be stale at send time |

**Recommendation: B. Agreed.**

## For client feedback (new today)

1. Inbound conversations continue at any hour, following your 25 Sept message and the TCPA spec, against the blueprint's "if within TCPA allowed hours" (decision 56).
2. When a visit is offered: vehicle + rough timeframe, or a buying signal (decision 62).
3. A staff-only question alone isn't a handoff; hand off after 3 declines (decision 64).
4. The `visit_followup` default of 3 days (decision 63).

## Known gaps (accepted) and the platform fix they need

**For the client:** when the AI moves or cancels a customer's appointment, it uses the platform's existing booking endpoint (`PUT /api/booking`). Two things go wrong there today, both in platform code, which this plan doesn't change:

1. **Old reminders still go out (decision 58).** Moving an appointment creates reminders for the new time but leaves the old ones, so the customer is reminded of both times. Cancelling one leaves all its reminders, so the customer is reminded of an appointment that no longer exists. Staff don't hit this, because their status screen clears reminders first. **Until fixed:** tolerated until C5, which switches the platform's reminders off for AI dealers. The team is told on every AI move or cancel.
2. **A cancelled appointment still shows "Appointment Booked" (decision 59).** Cancelling changes the booking, not the lead, so the lead keeps its "Appointment Booked" status. **Until fixed:** the team is asked to update the status by hand. The AI's own records mark the lead active again so it can offer new times.

**The proper fix: four changes to the platform code.** The AI service can't do this itself without changing platform data directly, which we don't do.

| # | Where (`aidmvcs-be-dev`) | Change | Fixes |
|---|---|---|---|
| 1 | `app/api/booking/route.js`, `PUT`, when `booking_status` is `cancelled` | Cancel the lead's pending reminders (`cancelAllRemindersForLead`, already used by the staff status route). Set the lead's `fe_lead_status` to a status that doesn't pause the AI (e.g. back to "Contacted"). Clear the lead's `data.booking` and `booking_status` | Gaps 1 and 2 on a cancel |
| 2 | Same route, `PUT`, when the date or time changes | Cancel the lead's pending reminders **before** creating the new ones | Gap 1 on a move |
| 3 | `app/lib/appointmentReminderService.js`, the reminder sender | Before sending, skip any reminder whose booking is cancelled | Safety net for both |
| 4 | `app/api/booking/route.js`, `POST` and `PUT` (where reminders are created) | Store the real booking id in each reminder's `booking_id`. Today it stores the lead id (`_id: lead_id`), so `cancelRemindersForBooking` can never find them | Makes change 1 reliable per booking |

After these ship, both gaps close. The only AI-service change is dropping the "please update / old reminders" notes from the team notification.

## Changes made in this session

- Reviewed MASTER_PLAN_3 Part B against the code; found the gaps above.
- Added phase Bq (two questions per message) to MASTER_PLAN_3 and the build order.
- Recorded decisions 55–71 in `architecture.md` §15; annotated decisions 29 and 36.
- Updated MASTER_PLAN_3 Part B: the 26 Sept open-questions item 9, the phase table, B0.2, B0.3, B0.4 step 5, B0.5, B0.7, B0.8, B0.12, B0.13, B1 items 2 and 4, B2 item 1, B3 items 1, 7 and "done when", B4 items 1, 4 and 8 (new) and tests, B5 items 1, 5 ("Known gaps in B5") and 7 and tests, the reminders row, and C5's dealer-setup note.
- Updated `progress_3.md`: build order and Part B rows.
