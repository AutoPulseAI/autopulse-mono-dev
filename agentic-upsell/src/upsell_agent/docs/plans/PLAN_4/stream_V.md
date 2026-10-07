# PLAN_4 stream V: scenarios reconciled with the audit fixes, and the final verification

Run on 4-5 Oct 2026 on `integration` (all feature streams + X1 compliance, X2 workflow, X3 conversation /
memory / CRM) plus the changes below. Local stack only (`make crm-local` from this worktree, offline model,
provider sends stubbed). Vehicle Databases was never called.

## 1. The six failing scenarios

None was a product bug. Five were expectations written before the audit fixes; one was the scenario runner
counting a message the AI did not send.

| Scenario | Verdict | Why (source) | What changed |
|---|---|---|---|
| `p2_handoff_holding_reply` | Outdated | X3 item 4 (audit 4 A6, trade-2: a customer who wrote after a handoff got silence): a question on a handed-off lead gets one holding reply (at most one per 10 minutes) and staff are told at once. "Hello?" is a question. | Plain message: still saved only. "Hello?": holding reply + staff notice `after_handoff_question`. A second question inside 10 minutes: saved only (3 texts in all). |
| `pb1_after_hours_later`, `pb1_after_hours_now` | Outdated | X1 item 1 (audit 2 blocker 1; TCPA PDF §7 "before every covered outbound attempt"; blueprint box 0 "continues the conversation immediately (if within TCPA allowed hours)"): the first message is a `lead_response` and follows the customer's state hours. 23:00 New York is outside 8:00-21:00, so the first text is held to 8:00. | The choice is now tested at 19:30 (dealer closed, texting allowed). Added: a 23:00 lead gets nothing at night, a `first_reply_held` follow-up due 8:00, and its first text after that. |
| `pc1_campaign_consent` | Outdated | X1 item 4 (audit 2 finding 4): the CRM sets `sms_opt_in` on any inbound text, so the flag is not consent to campaigns (TCPA PDF §1 "Do not send covered automated marketing merely because a phone number exists"). | See "What counts as consent" below. The scenario now shows: no consent BLOCK; flag only BLOCK; complete consent record ALLOW; STOP then START: BLOCK then ALLOW; form line alone REVIEW; ALLOW becomes HOLD at 21:00. |
| `pc1_form_opt_out` | Outdated | X1 item 1: the form's explicit no ("TCPAOptIn: false") now applies to the first message too, since it is no longer treated as a reply. | The lead gets no text at all; its first reply and the cadence go by email (0 texts, 2 emails after the first touch). |
| `s13_shadow_dealer` | Runner bug, **no real send** | The lead's AI rows were both `shadow`; the CRM conversation held only n8n's and the staff reply. The one "sent" row was n8n's own reply, which X3 item 5 (history sync) copies into the AI's thread as `sent` + `imported: true`. `expect_outbox` counted it. | `devtools/scenarios.sent_by_ai_filter` excludes imported rows. Test: `tests/unit/test_stream_v.py`. |

Runner additions: `set_contact: {consent_record: true}` (a complete lead-provider consent object on the lead),
`expect_followup` kind `first_reply_held`. The engine's reason for a consent BLOCK no longer says "no platform
opt-in flag" (the flag no longer matters): "no text consent (no recorded consent or opt-in from the customer, ...)".

### What counts as consent for a marketing text now (`compliance/engine.marketing_sms_consent`)

1. The customer's own opt-in after an opt-out (START, "you can text me again"): campaigns and follow-ups.
2. A lead provider's **complete** consent record on the lead (`tcpa_consent` / `consent` / `lead_consent`):
   disclosure text, its version, the time, and the phone we would text (SMS among the permitted channels if
   listed). Campaigns and follow-ups. Anything less, or AutoTrader's bare `TCPAOptIn: true`, is REVIEW.
3. The customer's own inquiry, for AI follow-ups on that lead for 91 days. Never for a dealer campaign.

Not consent: a phone number on file, DealerVault / DMS presence, the CRM `sms_opt_in` flag.

Gap for the client: there is **no way for a dealer to record consent they collected themselves** (a signed form
at the sale, a checkbox on their own website) other than as that consent object on the lead. A dealer campaign to
their own sold customers is therefore blocked by text until the CRM stores such a record. See "Decisions".

## 2. Final checks (each run twice on the final code)

| Check | Run 1 | Run 2 |
|---|---|---|
| AI unit tests (`make ai-test`) | 1924 pass | 1924 pass |
| Offline evals (`pytest evals`) | 80 pass, 9 skipped | 80 pass, 9 skipped |
| `make platform-test` | 127 pass | 127 pass |
| `make crm-e2e` | 49 / 49 | 49 / 49 |
| `make crm-cadence-check` | 51 / 51 | 51 / 51 |
| `make crm-scenarios` | 76 / 76 | 76 / 76 |

The 9 skipped evals are the grammar eval, which needs a real model (run in section 4). The unit tests and
evals were run twice more on the last commit. The four stack checks ran before the last change, which touched
only `devtools/burst.py` (the load-test tool, which none of them uses) and these notes.

## 3. Audit findings re-verified

Probes: the auditors' probe tests pass when the defect exists. Run on the final code from a temporary test file
(deleted, not committed).

- Audit 1 probes (5): 4 now **fail** (defect gone): same-day duplicate touch, handoff stranding Appointment Set,
  no call timer after appointment touches, resume never restarting the cadence. The 5th still passes, and is not
  a defect: it asserts the *send check* holds a Saturday 17:30 no-show text until Monday. That is correct. The
  defect was the stage waiting for the message; X2 item 2 moves the stage at +1h regardless
  (`test_an_after_closing_no_show_moves_the_stage_at_once_and_never_sends_the_showroom_text_late`).
- Audit 2 probes: P1 (phone that texted STOP under an older record) and P2 (DealerVault-style lead, no consent,
  23:30): **no text is sent**; the marketing check is BLOCK. In both the lead's first message now goes by
  **email** (see open item O1). P3: transactional under an open review is REVIEW (was ALLOW). P4: Kentucky
  transactional HOLD to 10:00 (was allowed at 8:30). P5 stricter-of two states, P6 per-dealer scoping, P7 the 40
  state/time cases: unchanged and correct, except Rhode Island Victory Day (10 Aug 2026) is now banned, as required.

Status: FIXED (test named) / OPEN / CLIENT (a decision for the client or counsel).

### Audit 1: new lead workflow

| # | Finding | Sev. | Status | Evidence |
|---|---|---|---|---|
| 1 | Cadence never restarts after staff pause then resume | blocker | FIXED | `test_x2_workflow.py::test_resume_after_a_staff_pause_restarts_the_cadence_where_it_was`, `test_resume_re_plans_the_appointment_steps`; probe fails |
| 2 | No Show gated by message permission; Appointment Set stranded | high | FIXED | `test_a_lead_with_staff_still_becomes_a_no_show_and_never_strands`, `test_an_after_closing_no_show_...`, `test_day_91_closes_an_appointment_long_past_that_nothing_resolved`; probe fails |
| 3 | No call checkpoint after appointment / no-show / visit follow-up touches | should fix | FIXED | `test_the_confirmation_and_no_show_touches_start_the_call_checkpoint`, `test_the_visit_follow_up_goes_on_text_and_email_and_starts_the_call_checkpoint`; probe fails |
| 4 | "Call within 5 minutes" has no deadline | should fix | FIXED | `test_a_requested_call_is_due_in_5_minutes_and_escalates_when_it_isnt_made` |
| 5 | Two touches on one day after an evening lead | should fix | FIXED | `test_cadence.py::test_an_evening_leads_held_nudge_and_touch_3_never_share_a_day`; probe fails |
| 6 | Staff confirming a booking never reaches the AI | should fix | FIXED | `test_staff_confirming_the_booking_in_the_crm_confirms_the_appointment_and_skips_the_y_n`; `test-ai-layer.js` |
| 7 | Cadence pre-send check is stage-only | should fix | FIXED | `test_a_reply_no_turn_answered_stops_the_stale_touch_and_the_cadence_goes_on`, `test_a_booking_the_stage_missed_stops_the_cadence_touch` |
| 8 | "No longer available" in the sold-vehicle fallback | should fix | FIXED (template) / CLIENT | `test_the_sold_vehicle_fallback_leads_with_the_next_step_never_not_available`. An AI-written reply may still say a car is sold when it offers an alternative (decision D): client to confirm |

### Audit 2: TCPA

| # | Finding | Sev. | Status | Evidence |
|---|---|---|---|---|
| 1 | First message on a lead skips consent, opt-out, review, state hours, cap | blocker | FIXED | `test_x1_first_reply.py` (8 tests); probes P1, P2 send no text |
| 2 | Explicit opt-outs missed ("please stop", "STOP ALL", "opt me out"...) | blocker | FIXED | `test_x1_opt_out_detection.py` |
| 3 | REVIEW doesn't stop transactional sends and clears itself | should fix | FIXED | `test_x1_review.py`; probe P3 |
| 4a | CRM `sms_opt_in` flag treated as marketing consent | should fix | FIXED | `test_compliance.py::test_platform_opt_in_flag_is_not_marketing_consent`; scenario `pc1_campaign_consent` |
| 4b | "The customer wrote back" gives an outbound / DealerVault lead 91 days of AI follow-up texts | should fix | CLIENT (counsel) | unchanged (`engine._customer_wrote`) |
| 5 | CRM internal send endpoint is a force-send | should fix | FIXED | `test-ai-crm-platform.js` (decision id required, recipient must be the lead's, DND refused) |
| 6 | Dealer DND is per lead only | should fix | FIXED | `test_x1_dnd.py` |
| 7 | Call tasks not re-checked at dial time; calls not counted in state caps | should fix | FIXED in the AI / OPEN in the CRM | `test_x1_calls.py`. The CRM's click-to-call does not yet call `GET /v1/call-tasks/{id}/check` before dialling |
| 8 | Transactional texts ignore the state table | should fix | FIXED / CLIENT (counsel) | `test_state_hours.py` (KY); probe P4. Counsel: must appointment texts follow the state rows? |
| 9 | Lead-provider consent object not kept; audit row incomplete | should fix | FIXED in the AI / OPEN in the CRM | `test_x1_audit.py`. CRM lead intake (ADF / provider feeds) does not put the provider's consent object on the lead, so provider leads stay at REVIEW for campaigns |
| 10 | AI may state or imply consent / eligibility | should fix | FIXED | `test_x1_consent_claims.py` |
| 11 | State holidays (RI, LA, AL), IN / ME automated-device rows, NJ cell-phone sales ban | should fix | FIXED / CLIENT (counsel) | `test_x1_state_rules.py`; probe P7 (RI Victory Day). Counsel to confirm the holiday lists and readings |

### Audit 3: SOLD PENDING / SOLD DELIVERED

| # | Finding | Sev. | Status | Evidence |
|---|---|---|---|---|
| 1 | Anniversary "No problem, yes I still have it" read as NO; stale question | blocker | FIXED | `test_sold_lifecycles.py` (table incl. the audit's four phrases, commit 1acb7ec), `test_x2_sold.py::test_an_unclear_answer_closes_the_ownership_question...`, `test_the_ownership_question_expires` |
| 2 | Race between a staff status change and a touch in flight | should fix | FIXED | `test_x2_sold.py::test_sold_delivered_set_while_a_sold_pending_touch_is_firing_wins`, `test_a_sold_pending_call_timer_never_opens_after_delivery`, `test_staff_status_changes_run_under_the_lead_lock` |
| 3 | No CRM path to confirm a recall | should fix | FIXED, not clicked through in a browser | `test-ai-crm-platform.js` (recall actions) |
| 4 | Staff outcomes dropped on an opted-out / closed lead | should fix | FIXED | `test_a_staff_outcome_takes_effect_on_an_opted_out_or_closed_lead`, `test_opting_back_in_never_restarts_sold_pending_for_a_delivered_car` |
| 5 | CRM allows Closed - Lost on a Sold Delivered lead | should fix | FIXED | `test_closed_lost_on_a_delivered_lead_is_refused_and_pauses_nothing`; `test-ai-crm-platform.js` |
| 6 | Service-offer answers misread; the offer never expires | should fix | FIXED (reading) / OPEN (expiry) | `test_the_answer_to_a_service_offer`. The service offer still has no expiry |
| 7 | SOLD PENDING router misses "When can I pick it up", misreads "I have a question" | should fix | FIXED | `test_the_sold_pending_router_reads_delivery_questions_and_real_answers` |
| 8 | No guard on AI-written SOLD PENDING replies | should fix | FIXED | `test_an_ai_reply_on_a_sold_pending_lead_never_invents_a_status_or_blames_a_delay` |
| 9 | Check-in / anniversary can name a car they didn't buy | should fix | FIXED | `test_the_check_in_never_names_the_model_the_customer_only_asked_about`, `test_the_check_in_names_the_delivered_vehicle_from_the_deal` |
| 10 | Phantom customer-reported vehicles | should fix | FIXED | `test_a_reply_with_no_vehicle_in_it_never_creates_a_customer_reported_vehicle` |
| 11 | Maintenance on a flat 6 months; none at all while Vehicle Databases is off | should fix | CLIENT | Vehicle Databases goes on when the client is happy with the conversations (Q15); the interval without a mileage reading is a placeholder |

### Audit 4: conversation, memory, CRM

| # | Finding | Sev. | Status | Evidence |
|---|---|---|---|---|
| 1 | Production leads have no `customer_id`; every AI event skipped | critical | FIXED | `test-ai-x3.js` (derived key), `test_x3_production_model.py` |
| 2 | Customer's own words not used as the reason to visit | high | FIXED | `test_x3_conversation.py`; real run: "$400-a-month target" carried into the offer (credit-1) |
| 3 | Over-escalation; silence after a handoff | high | FIXED in part | `test_x3_after_handoff.py`. Real run: 6 handoffs, 2 wrong (section 4); a customer who books after a *hard* handoff gets a holding reply, not a booking |
| 4 | Offered times ignore the day the customer asked for | high | FIXED | `test_booking_flow.py::test_a_bare_time_is_read_on_the_asked_day_even_if_that_offer_never_went_out`; real run credit-1 "10 works" booked Saturday 10:00 |
| 5 | Staff replies, notes, n8n and campaign texts not in the AI's memory | high | FIXED | `test_x3_memory.py` |
| 6 | Leads open when a dealer goes live are orphaned | high | FIXED | `test_x3_reconcile.py::test_an_open_lead_already_in_conversation_is_adopted_not_greeted`; the burst run adopted 108 such leads |
| 7 | AI outage over a minute loses events | high | FIXED, not tested against a real outage | `test-ai-x3.js` (stored and replayed), `test_x3_reconcile.py` |
| 8 | Portal emails become leads addressed to the portal; SMS thread linking | high | FIXED | `test-ai-x3-integration.js`. An unknown portal with a personal-looking sender is still read as a person |
| 9 | Internal send endpoint: `to` never checked | high | FIXED | `test-ai-crm-platform.js`. One static shared secret for every dealer and both directions remains (OPEN) |
| 10 | `GET /api/conversations/lead` and `GET /api/car` need no login | high | **OPEN, CLIENT** | The client's production code, which we were told not to change. Anyone can read any dealer's customer conversations |
| 11 | Message on a closed lead; linked duplicates never released | medium | FIXED | `test_x3_closed_and_duplicates.py` |
| 12 | Invented facts in words (durations, credit pulls, what to bring) | medium | FIXED in part | `test_x3_conversation.py::test_invented_word_claims_are_rejected`. Real run: one "generally bring your ID and proof of income" got through (section 4) |
| 13 | No guard against auto-responders; lock expires mid-turn | medium | FIXED | `test_x3_auto_reply_and_lock.py` |

**Totals (44 rows, each counted once by its worst part): FIXED 32, OPEN 6, CLIENT 6.**

- OPEN (a part is still open): audit 2 #7 (the CRM does not call the dial-time check), audit 2 #9 (CRM lead
  intake does not keep the provider's consent object), audit 3 #6 (the service offer never expires), audit 4 #3
  (2 wrong handoffs of 6; a booking after a hard handoff is passed to staff, not booked), audit 4 #9 (one static
  shared secret), audit 4 #12 (one unbacked "what to bring" list got through).
- CLIENT (client or counsel decides): audit 1 #8 (may the AI say a car is sold when it offers another),
  audit 2 #4b, #8 and #11 (counsel), audit 3 #11 (Vehicle Databases on / the 6-month placeholder), audit 4 #10
  (the two open routes in the client's production CRM).

## 4. Real-model run (gpt-5-mini, reasoning effort minimal)

Report: `evals/reports/conversation_cost/conversation_cost_gpt-5-mini_streamV_20261004-1943.md` (+ `.json`,
two `.csv`). Spend $0.41 of the $2 budget (plus the grammar judge).

| | |
|---|---|
| AI replies / customer messages | 148 / 156 |
| Handoffs | 6 conversations: 4 right, 2 wrong |
| Template fallbacks | 6 of 148 replies |
| Guard retries | 9 |
| Bookings made | 5 |
| Grammar (judge) | 0.887 mean over the 12 conversations; 13 replies flagged, 11 of them under 0.8 (lowest 0.56) |
| Cost | $0.00277 per reply, $0.0342 per conversation ($0.0388 with no handoff) |
| Prompt cache | 53.2% of input tokens |
| Turn time p50 / p95 | 4.4 s / 7.7 s; 1 of 142 extract calls over the 6 s production limit |

Handoffs:

| Conversation, turn | Customer said | Verdict |
|---|---|---|
| credit-2, t13 | "can sumone just call me im driving alot" | right (asked for a person) |
| credit-3, t11 | "Can I talk to a person tomorrow?" | right |
| service-3, t11 | "Monday morning?" after "Can I speak to someone in service directly?" | right |
| general-2, t5 | "it was like 3k less" (the reason, after "not interested anymore") | right by the client's rule (ask why, then a person decides); the logged reason wrongly says "no reason given" |
| general-3, t5 | "How about the Highlander?" | **wrong**: two fallbacks in a row. The guard rejected every draft answering "Is the Pacifica a hybrid?" because the draft used the word "hybrid" (a trim not on the vehicle), even to say it isn't one |
| trade-2, t8 | "Not interested in coming in if you can't match it" | **wrong**: a price objection read as "not interested". She then asked "Could I come Saturday at 11?" and got "I've passed your request to the team" instead of a booking (a hard handoff is never taken back) |

Worst remaining turns, verbatim (nothing fixed here):

1. general-2 t4, customer "found one cheaper somewhere else": "Sorry to hear that, Tyler. Can I ask why you
   found one cheaper elsewhere? Also, are you looking for a new or a used vehicle?"
2. general-3 t4, "Is the Pacifica a hybrid?": "Thanks, Angela. Let me check on that with the team, and someone
   will get back to you shortly." The same again at t5, then the lead went to staff.
3. general-1 t1, "Hi! Is it still available?": the same "Let me check on that with the team" fallback (drafts
   rejected for a trim word, 338 characters, three questions).
4. trade-2 t0, lead form "Want to sell my 2017 Jeep Wrangler": "... I am excited to help you with your
   purchase. About how many miles are on your trade-in?"
5. trade-2 t4, customer "Black, soft top and hard top both": "Do you have a soft top and a hard top on the Jeep,
   and which best describes its condition: excellent, good, fair, or poor?"
6. credit-1 t1, "hi yes still looking": offers three visit times before asking anything.
7. credit-1 t10, "ok": "Thanks for the update, Denise. I won't keep asking—let me know if you want to pick a
   time to come in or have the team call you with financing options."
8. credit-1 t13, "10 works": "Got it — Saturday at 10:00 AM is set." (it is a request the team confirms.)
9. credit-1 t14, "what do I need to bring?": "You don't need many things, Denise. The team will confirm exactly
   what to bring, but generally bring your ID and proof of income if you have it, and your down payment."
10. service-3 t3, "VIN ends in 4471": "Got your VIN ending in 4471. Thanks, Gary — I won't keep asking."
11. trade-1 t14, "Do I need to bring the title?": fallback "Let me check on that with the team" (both drafts
    stated what to bring).
12. service-1 (grammar 0.56): "Weekday mornings work best for you, evenings, or weekends?"
13. credit-3 t12-t13 and general-3 t12, after a handoff: "Thursday at 12 would work" and "Saturday at 10" were
    saved for staff with no reply (no visit word, no question mark).

Compared with the run before the audit fixes (HANDOFF of 4 Oct): replies 138 -> 148 of 156, fallbacks 9 -> 6,
wrong handoffs 4 of 8 -> 2 of 6, grammar mean 0.89 -> 0.89, cost per reply unchanged.

## 5. Load test (300 replies in 10 minutes)

`make ai-burst` uses the shared containers (old code), so the burst ran against its own worker started from
this worktree: its own database (`autopulse_burst_v3` on localhost:27018), Redis db and queue, offline model
with 1200 ms per model call, fake channel driver. No code change was needed to point it there (environment
variables only).

First run **failed**, for reasons in the test's fixture, not in the service:

- The 300 "campaign recipients" were brand-new leads with nothing in the CRM conversation, so the
  reconciliation sweep (X3 item 6) correctly treated 162 of them as new leads nobody had answered and sent
  each a first message; those turns queued ahead of the replies (p95 64 s) and used up the campaign context.
- The other dealer's probe leads had 555 numbers with no known state. On a Sunday the strictest-state rule
  holds their first text until Monday (X1), so no first reply could be timed.

Fixture fixed in `devtools/burst.py` (dev tool only): the campaign text is recorded in the CRM conversation as
the campaign worker does, leads get a phone in their dealer's state, and the sent count ignores the copied
campaign text. Result on the final code:

| | |
|---|---|
| Burst replies answered and sent | 300 / 300, 0 errors, 0 template fallbacks, 0 handoffs, campaign context in 300 |
| Burst reply time (event to send) | p50 2.46 s, p95 2.47 s, max 2.52 s |
| Other dealer's first reply, baseline | p50 2.44 s, p95 2.62 s (n=5) |
| Other dealer's first reply, during the burst | p50 2.46 s, p95 2.47 s, max 2.47 s (n=20) |
| Dealer A turns in flight | peak 7 (cap 10, worker concurrency 20) |

**BURST TEST PASSED**, all 8 checks. (The run before it, same code but for the sent count, had the same
figures with one reply at 11.5 s.) The sweep adopted the campaign leads that had not replied yet (108 in that
run) without sending them anything.

Worth knowing for go-live: after an outage, or when a dealer is switched to live with many recent unanswered
leads, the sweep's first replies share that dealer's 10-turn cap with live conversations, so replies can wait
behind them (64 s p95 with 162 at once). Other dealers were not affected.

## 6. Open items found in this stream

- **O1. An imported / DealerVault lead with no text consent gets its first message by email**, at any hour, with
  the inquiry wording ("Thank you for your interest in our Honda CR-V"). Not a TCPA matter (email), but the
  client should decide whether imported records get an AI email at all. Same path for a phone that opted out
  of texts: the first reply goes by email.
- **O2. A website lead at 23:00 gets nothing until 8:00.** The client asked on 25 Sep for a confirmation with
  the choice "now or during business hours" for after-hours leads and called a lead "an inbound task". X1 holds
  the first *text* outside 8:00-21:00 customer time (the stricter reading; the blueprint says "if within TCPA
  allowed hours"). The choice still works between closing and 21:00. Options for the client / counsel: allow the
  first text to a consumer's own inquiry at any hour, or send that first message by email at night.
- **O3. No dealer-recorded consent** (section 1).
- **O4. The text BLOCK that reroutes a first reply to email is not written to the compliance log** (only the
  email's ALLOW is); the TCPA PDF §11 asks for every attempt. Small.
- O5. After a handoff, a bare time ("Saturday at 10", "Thursday at 12 would work") gets no reply (section 4,
  item 13).
