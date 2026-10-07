# Plan 3 notes: 27 September 2026

Branch `plan_3`. Recorded in `docs/architecture/architecture.md` §15 (decisions 21–30) and `docs/plans/PLAN_3/MASTER_PLAN_3.md`.

**Update, later the same day:** Part A Phase 1 (inventory read layer) was built, tested and committed; see `docs/plans/PLAN_3/progress_3.md`. Phase 2 (shopping criteria) went through a readiness review before building — see "Phase 2 readiness review" below.

**Our default** = decided by us because no client document answers it. Every one of these is flagged for client feedback (list at the bottom).

## Decided today

### Carried over from the start of the day (Part A)

- **In stock:** every vehicle `/api/car` returns is treated as in stock for now. There's no sold/available field to filter on. Known gap: a sold car can be mentioned until real feed data shows how sold cars appear.
- **Year filter:** `/api/car`'s `year` parameter never matches (regex against a number field). Always call it with `year_range=<Y>-<Y>` (or `<Y-1>-<Y+1>` for the "year ±1" loosening). `route.js` is Prashanth's code and isn't touched.

### 1. Vehicle photos: MMS through Twilio (decision 21)

- Correction: MASTER_PLAN_3 said the Twilio driver wasn't built. It is: `channels/twilio.py`, used when `CHANNEL_DRIVER=live`, already on the rollout checklist. It's text-only: it sends `To`/`From`/`Body` and never `MediaUrl`.
- Decision: add `MediaUrl` to the Twilio driver (and the fake driver) and send the vehicle's own `imagesSecure` URL.
- Before sending, code checks the image URL is public and under the carrier limit (about 5 MB). If not: link only, then no vehicle. Never an unrelated photo.
- Still to do: cost review (an MMS costs roughly 3× an SMS).

### 2. Build order: the part with no prerequisites first (decision 22)

- The plan said "Part B first", but Part B depends on Part C: the 5-minute callback needs C2's call tasks, and B3's send check is the same engine as C1's `can_contact`.
- **Part A has no prerequisite in this plan** (only Plan 2 and the existing `/api/car`), apart from two items:
  - the price-drop exception (Phase 0 item 3) is used in the Day 8–90 follow-ups, which are Part C's C4. Deferred until after C4.
  - Phase 5 (freshness) waits on real feed data, not on another part.
- Order (updated later today): Part A → C1 (with B2/B3 folded in) → B1 → B5 → B4 → C3 → C4 (then A's price-drop exception) → C5 (if shipped) → C6. C2 and the callback are skipped. The full dependency table is at the top of MASTER_PLAN_3.
- ~~Risk: platform changes need someone who may edit that code.~~ Replaced: platform code is not changed, except B3's campaign check. See "Platform code" below.

### 3. Customer time zone (decision 23)

1. **ZIP, else state.** The platform `Customer` record has no address field. ZIP and State come from the customer's DealerVault sales/service rows (linked by `customer_id`) or from the lead form. DMS contacts (the outbound ones) usually have it; web leads may not.
2. **Else the phone's area code.**
3. **Else (our default):** only the hours legal in every continental US zone at once (11:00–20:00 Eastern = 8:00–17:00 Pacific). Never the dealer's time zone alone.

### 4. Dealer hours for outbound (decision 24)

- **Rule:** a message the system starts (follow-ups, campaigns, the 24h channel switch, the handoff-timeout reply) must be inside **both** the dealer's opening hours **and** the customer-local window. A reply to a message the customer just sent is exempt from the dealer-hours check.
- **Client sources:**
  - blueprint box "7. BUSINESS HOURS RULE": "If outside business hours → send at opening next day… All other touches follow business hours unless customer replies";
  - blueprint box 0: "This check happens BEFORE any outreach";
  - Omnichannel PDF p.1: every automated send stays subject to "dealer schedule, time-window" guardrails.
- Closes the 26 Sept open question about dropping the dealer-hours half. `scheduler/contact_window.py` (today: 8:00–20:00 dealer time) needs rework.

### 5. Urgent need (decision 26)

- How intent is judged today: code judges almost nothing about a message's meaning. Lead type is a regex on the lead source (`slots/requirements.py`); the only keywords in code are STOP/START (`channels/consent.py`) and yes/no (`agent/nodes/validate.py`). Everything else is labelled by **Extract** (the AI step that reads the customer's message and returns structured facts: slot values with quotes, question labels, flags like "wants a person" and "upset"). Code then decides with a threshold.
- Urgency follows that pattern:
  - Extract gets `urgent`, `urgent_confidence`, `urgent_reason`. Reasons (our default): no transportation / car broke down; needs a vehicle within 48 hours; safety problem; deadline elsewhere.
  - Handoff at confidence ≥ 0.8 (our default, the same bar as "upset").
  - Pure-code backstop: `interest.needed_by` resolved within 48 hours → urgent.
  - An eval set of about 20 "urgent vs. just eager" examples; a sample goes to the client.

### 6. Call tasks and the callback (decision 27, updated)

First decided: Part C's call tasks ship before the 5-minute callback. **Updated later today:** C2 (call tasks) is skipped for now, and the callback with it. See "Platform code" below.

### 7. Visit-offer angles (decision 28)

- **What the client defined:**
  - blueprint box C: attempt 1 "based on primary intent and value", attempt 2 "different approach based on hot button or objection", attempt 3 "different value proposition explaining why meeting sooner benefits them";
  - Omnichannel PDF Day 6: "appraisal, comparison, financing review, management review, or right-team meeting";
  - `conversations.md`: successes build the reason from the customer's own facts; a failure "did not overcome the 'waste my time' objection".
- **What we defined (our default):**
  - attempt 2 objections: time/convenience, just looking, wants numbers first, credit worry, unsure of trade value (none seen → the customer's stated priority);
  - attempt 3 value reason by lead bucket: credit → financing review, trade-in → appraisal, general → comparison;
  - the angle used is saved, so none repeats.

### 8. State rules (decision 25)

- **What they are:** some US states have telemarketing/texting laws stricter than the federal TCPA. Florida and Oklahoma, for example, allow marketing texts only 8:00–20:00 and at most 3 per 24 hours on the same subject.
- **Who they apply to:** the **customer's** state, not the dealer's. They cover messages the business starts, not replies to the customer. Some laws treat an in-state area code as a resident, so when the ZIP state and the area-code state differ, the stricter applies.
- **Does it block Part B?** Only B3 (the send check), and not anymore, given the interim rule below.
- **Interim decision:** the strictest known rule for **every** customer: marketing SMS only 8:00–20:00 customer-local, at most 3 marketing messages per customer per 24 hours (AI and campaigns together). This is tighter than the client's 8:00–21:00; the stricter wins for now.
- **A counsel-approved state rules table is still required** to apply state rules properly, to loosen states that allow more, and to add rules we don't have reliable details on (e.g. Sunday/holiday limits).

### 9. Replies at night (decision 29)

- The customer wrote first (a new lead, or a reply to a campaign), so it isn't outreach. One reply goes out right away at any hour.
- **Checked against the client's after-hours rule:** the blueprint says the AI "continues the conversation immediately (**if within TCPA allowed hours**)" (box 0, "CUSTOMER WANTS HELP NOW"). So "reply right away" is limited to that one reply. Outside 8:00–21:00 customer-local time, it says the team picks up at 8:00 and asks nothing more; the conversation resumes then.
- The same rule answers B0.2 (the first reply to a lead at night).
- Follow-ups keep the outbound rules.

### Booking defaults (decision 30, our default)

Per-dealer settings: 30-minute slots, 2 bookings per slot, earliest offer ≥ 2 hours ahead and inside opening hours, last slot ≥ 30 minutes before closing, up to 7 days ahead, AI bookings go in as `pending`.

## Platform code (decided later today)

**Rule:** MASTER_PLAN_3 does not change platform code (`aidmvcs-be-dev`), except B3's campaign check (approved). Everything else is done in the AI service with the platform's endpoints and data as they are.

- **B2, inbound vs. outbound: our side, no campaign type.** The client did ask for this split (`conversation_2.md`: DealerVault drips/equity = outbound, a lead = inbound; TCPA PDF §4), but B2's platform fields were our own design. Checked the platform's campaigns: one kind only (a dealer-written email or SMS blast to a chosen list of leads, scheduled for a date/time). No type field, no drip or equity campaigns, no inbound campaigns. So every campaign counts as outbound and no type is tracked. Leads are classified from `Lead.source`; campaign replies from `find_campaign_context`.
- **B3, platform campaigns: approved platform change, including the required report UI change (approved).** Campaigns are sent later, one lead at a time, by `worker/campaignWorker.js`, so the time/consent check runs there per lead, not when the manager clicks "Schedule". A manager scheduling at the wrong time gets no error: leads outside the window are held and sent when allowed. Needs a small frontend change: the campaign report shows "Held until…" and "Blocked: …" (today it only knows sent/delivered/failed, so held leads would show nothing or wrongly as "failed"). Optional: a warning in the campaign form. The platform's appointment reminders keep their own rule.
- **B3, consent record:** was a platform change. Decided later today: kept on our side (see "Consent" at the end).
- **B5, booking: existing `POST`/`PUT /api/booking`, unchanged.** No new endpoint, no AI-booking marker: a booking through it doesn't pause the AI (only the staff status route does). It creates the booking as `pending`, sets the lead to "Appointment Booked", sends its own confirmation and creates reminders. Handled on our side:
  - check availability ourselves;
  - avoid double bookings on retry;
  - don't send a second confirmation;
  - send the time as `HH:MM`;
  - send `booking_status` when moving a booking.
- **B5, email and phone both required (agreed).** The booking needs both, or it fails and leaves the lead half-updated. The AI asks for whichever is missing: SMS-only customers are asked for an email; email-only customers are asked for a phone number (for the booking and its reminders only, not marketing consent). If they won't give it: no booking, the requested time goes to the team.
- **B5, to check:** whether platform reminders still fire after a booking is cancelled through `PUT`.
- **C2, call tasks: skipped for now.** The platform has no task model or task screen; the only "click to call" is a plain `tel:` phone link on the campaign report. It would be new platform backend and UI. The 5-minute callback is skipped with it.
- **C3, lead stage: backend only, in the AI service.** Inputs are replies, our bookings, and the statuses staff set (Visited = the sales visit).
- **C5: decided later today — ships** (see "Last decisions of the day"). Findings behind it:
  - **Already done by the platform:** the confirmation after booking, reminders before the appointment, and stopping the AI when staff set "Visited".
  - **Could be built on our side:** the day-before Y/N confirmation (marking `confirmed` through the existing `PUT`), a daily countdown with photos, and the timed no-show messages.
  - **Needs a platform change:** only the manager outcome (SOLD PENDING / SOLD DELIVERED / UNSOLD; the platform has only "Sold").
- **Conflicts found:**
  - **No-show message:** staff clicking "No Show" makes the platform send its own no-show message, so ours would be a second one.
  - **Reminders:** the platform's pre-appointment reminders would double up with ours unless the dealer turns them off.
  - **Not a conflict:** the platform's rule-based follow-ups are already switched off for AI-live dealers.
- **C5, platform switches (checked):**
  - The dealer's Settings → Reminder settings page can turn off, per dealer and with no code change: pre-appointment reminders ("enabled", which also stops post-appointment ones), post-appointment messages (`post_enabled`, off by default) and managerial-review messages (`review_enabled`).
  - The no-show message has **no switch**: the platform always sends it when staff set "No Show".
- Recorded in `architecture.md` §15 as decisions 31 (no platform changes except B3's campaign check) and 32 (booking).
- ~~Manager outcome: on hold.~~ **Changed: planned to be shipped** (see "Last decisions of the day").

## Final plan review (end of day)

Read MASTER_PLAN_3 end to end and fixed stale or contradictory lines:
- the intro now says three parts, not two;
- the build-order table marks C2 and the callback skipped, C5 undecided, and C4 no longer depends on C2;
- the vehicle-records row no longer claims DMS cars are mixed in;
- the dev seed no longer shows an in-stock rule that doesn't exist yet;
- the booking and reminder rows are up to date;
- B3's example now includes the dealer-hours condition, and its duplicate frequency line is merged;
- "equity campaign" wording is gone (the platform has no such campaigns);
- the Part C intro says `may_send` and `can_contact` are one engine;
- C1's consent capture is marked undecided (since decided, see "Consent" at the end);
- C6's lead merging is limited to our side;
- the "Not in this plan" list now has C2, the callback, the manager outcome and platform changes.

Added a C4 note on the Touch 1 wording clash.

## Last decisions of the day

- **C5 ships** (decision 33). What gets built:
  - the day-before Y/N confirmation and its router (confirmed through the existing `PUT /api/booking`);
  - a daily countdown with vehicle photos;
  - no-show messages at +1h and +24h, then back into follow-ups;
  - "showed" recorded when staff set Visited.
- **What C5 doesn't build, and dealer setup:**
  - Not built: the client's 15-minute details message, because the booking endpoint already sends a confirmation.
  - For AI dealers, the platform's reminders are switched off in their Reminder settings, with no code change.
  - If staff set "No Show" before our +1h message, ours is skipped (our default).
- **Manager outcome: planned to be shipped** (approved platform change). New "Sold pending / Sold delivered / Unsold" statuses in the status dropdowns and status route, added to the statuses that pause the AI, and a prompt for the outcome after "Visited".
- **Platform code rule:** now two approved exceptions: B3's campaign check, and C5's manager outcome.
- **First reply (decision 34):** B1's after-hours choice and B4's visit offer override the client's required "Tell me, what are you driving now?" ending. Otherwise the driving question ends Touch 1, as its one question. Flagged for client feedback.
- **Campaign types — client check:**
  - The client mentioned "drip service or sales equity campaign" once, in `conversation_2.md`, only to say those need strict TCPA rules. The platform has no such campaigns. No client document asks for campaign types to be tracked.
  - What the TCPA spec does ask for is a **purpose** on every outbound message: marketing vs. service/transactional (§4, acceptance checklist).
  - Added to B2: purpose is set in code. AI follow-ups and all platform campaigns are marketing; booking confirmations and C5 messages are transactional.
- **One question per message:** our own design (MASTER_PLAN_2: "two questions in one text read like a form"), not a client requirement. **Changed: at most 2 questions per message** (decision 35). Decide may pass up to 2 asks and Compose's instructions change to match; a small change of its own before Part B, with Plan 2's tests updated.
- **Unknown time zone:** not resolved by asking the customer (rejected). The fallback stays the all-zones safe window.
## Consent (decision 36)

- **Before this:**
  - The platform marks a phone opted in only when that customer texts the dealer.
  - The AI texted anyone not opted out.
  - The plan would have blocked almost every follow-up text, because no consent source existed.
- **Decided.** A text the business starts needs consent; replies to the customer never do; email needs none. Checked in this order:
  1. An explicit no wins: STOP, `sms_opt_in: false`, or the lead form saying no. It also blocks follow-up texts on their inquiry; the first reply still goes out (agreed).
  2. The platform's opt-in flag counts as consent.
  3. Consent in the lead form, read on our side. Checked the lead data: the platform keeps each lead's raw XML (`RawAdfPayload`) but reads no consent from it. The AutoTrader sample lead does carry a line in its comments: `TCPAOptIn: false;`. Only that format is known; others get added as real leads show them, with a report of providers that carry none.
  4. The customer's own inquiry = consent to follow up on that inquiry, until the opportunity closes. Not for unrelated marketing such as platform campaigns. Counsel to confirm.
  5. One email to contacts with no text consent (e.g. DealerVault): "Want updates by text? Reply YES." A YES is consent. Asked once, never repeated (agreed).
  6. Otherwise email only.
- **Where it's kept:** `ai_consent`, with source, time and evidence. No platform change.

**Still needed before or during implementation:**
- Part B's remaining B0 items, to be handled when Part B is built;
- real lead samples from other providers, to see how they send consent.

## For client feedback

1. The urgent-need reason list, the 0.8 threshold, and a sample of urgent vs. eager examples.
2. The visit-offer objection and value-reason lists.
3. Replies at night: acknowledge right away, continue only inside 8:00–21:00 customer time.
4. The fallback when a customer's time zone can't be found (the all-zones safe window).
5. Booking defaults: slot length, bookings per slot, earliest offer, last slot, days ahead, pending vs. confirmed.
6. The 8:00–20:00 / 3-per-24h interim state rule, tighter than their 8:00–21:00.

## Still open

- The state rules table (counsel).
- How a sold vehicle shows up in the vAuto feed (needs one real dealer's data).
- MMS cost review.
- Whether to ship C5 (see "Platform code").
- ~~The consent record (was a platform change).~~ Decided: see "Consent".
- Whether platform reminders fire after a cancelled booking.

## Phase 2 readiness review (later the same day)

Before building Part A Phase 2 (shopping criteria), its text was checked against the running code rather than re-read from the plan alone — the same way the `/api/car` defects above were caught before Phase 1 was built. Four things needed a decision, all now recorded in `MASTER_PLAN_3.md`'s Phase 2 section:

- **Where the search runs.** `load_context` runs before `extract`/`validate` in the pipeline, so Phase 1's search (built inside `load_context`) can only ever see the profile as it stood before this turn's message. Phase 2 needs this turn's message as a search input, which doesn't exist yet at that point. Decided: a new step, `search_stock`, runs after `validate` instead, replacing Phase 1's search rather than running both.
- **Trim isn't a real search field.** Checked `aidmvcs-be-dev/app/api/car/route.js` directly: it returns each vehicle's trim but has no way to filter by it in a request, unlike colour, year and body type. Decided: trim is filtered on our side after the results come back, not sent to the platform like the other three loosening steps.
- **Colour matching is case-sensitive on the platform**, unlike make/model/body type (checked in the same route). Decided: colours are matched against the dealer's own real stock values before being sent, not a guessed casing.
- **"Something bigger" — our own default, flagged for client feedback.** No document defines a body-type size ordering, so one was agreed rather than left for implementation to guess: 4 tiers, smallest to largest — Coupe/Convertible/Hatchback; Sedan/Wagon; SUV; Minivan/Van/Truck. "Something bigger" moves up one tier (further if that tier is empty too), the same idea as the existing colour/trim/year loosening chain.

Also reconsidered, not newly decided: relabelling stock questions from `restricted` to `answerable` (the plan's original Phase 2 wording) turned out lower-risk than first thought — every non-`clarify` question routes the same way in code regardless of label, and the fallback for an `answerable` question the system can't actually answer is already "the team will confirm," same as `restricted`. Decided to split the stock-vs-price detection rule now (they're currently one merged rule, which also blocks the relabel), but keep the label as `restricted` until Phase 3 ships the real answering logic — so the label and the behaviour change together, not the label alone first.

**Verdict: Phase 2 is ready to build.**

## Changes made in this session

- Reviewed MASTER_PLAN_3's first-to-build phase (B0/B1) against the code and client docs. Citations checked out; one undocumented dependency found (B1 relied on the undecided B0.2, now decided).
- Found the Twilio SMS driver already built; corrected MASTER_PLAN_3 Phase 0 item 7.
- Recorded decisions 21–30 in `architecture.md` §15; pointed decisions 11, 18 and 20 at them.
- Updated MASTER_PLAN_3: build order and dependency table, the 26 Sept open-questions list, Phase 0 items 3 and 7, B0.2, B0.5, B0.6, B0.8, B0.10, B0.11, B0.13, B1 item 2, B3 (time of day, frequency, time zone, scenario), B4 item 4, and the "Not in this plan" list.
- Later the same day: built, tested and committed Part A Phase 1 (inventory read layer) — see `progress_3.md`.
- Reviewed Part A Phase 2 against the running code before building it; recorded 4 decisions (where the search runs, trim, colour case-sensitivity, the "something bigger" size ordering) in MASTER_PLAN_3's Phase 2 section and `progress_3.md`.

## 28 Sept — Part A Phase 2 built, then fixed after a Debug UI review

- Built Part A Phase 2 (shopping criteria) end to end: the `search_stock` graph step, `tools/stock_search.py`'s loosening chain, the two new slots (`interest.body_type`, `interest.color`), the stock/price question split, and the Debug UI's Search stock panel. Recorded as decisions 37–40 in `architecture.md` §15 and in full in `progress_3.md`.
- Verified against the running code, not just unit tests: 715 unit tests, 56 evals, 39/39 scenarios in Docker, and 142/142 searches matching between the stub and the real, running `/api/car` (including confirming live that the platform's colour match is case-sensitive, as the plan assumed).
- **User review in the Debug UI surfaced two real issues**, neither a search bug:
  1. The panel showed "N given to the AI" with no mention of how many actually matched, so a 5-match / 3-loaded turn looked wrong. Fixed: the panel now says "N matched · 3 given to the AI (max 3 per reply)".
  2. The panel's "Asked for" line showed the criteria *before* loosening (still naming the RAV4) next to a search that had actually dropped the vehicle entirely for a body-type search. Fixed: split into "From the profile" (before) and "Actually searched" (after), and the reasoning trace now says the named vehicle "is swapped for the next size up" on a bigger-size search.
  - Both fixes are UI/trace wording only; no change to the search logic itself. Two regression tests added (`test_bigger_after_a_named_rav4_never_sends_the_rav4`, `test_more_matches_than_the_per_reply_limit_says_so`).
- **User then asked**, correctly: if the next size tier has nothing in the customer's stated condition (e.g. no *new* trucks/vans), should the search drop new/used as a last resort rather than return nothing? Agreed as decision 41 (our default, flagged for client feedback) and built as the fifth and last loosening step. `MASTER_PLAN_3.md` Phase 2 item 4 updated to list it.
- Final state: 775 unit tests, 56 evals, 39/39 scenarios, Debug UI `tsc` clean, verified live in the browser against the user's exact reported conversation.
