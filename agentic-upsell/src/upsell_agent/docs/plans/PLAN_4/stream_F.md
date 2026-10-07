# Stream F: every cadence, end to end, on the local CRM

## Run it

```
make crm-local            # the stack (CRM :3100, AI :8110, autopulse_local)
make crm-cadence-check    # 50 checks, about 10 minutes; CADENCE_ONLY=6,8 limits the optional sections
make crm-scenarios        # the scenario YAMLs through the running AI API (IDS=a,b for some)
```

`aidmvcs-be-dev/scripts/ai-cadence-check.js` creates leads through the CRM's real intake (lead queue, Twilio
webhook, staff status route, booking route, Call Tasks route) and walks the AI's dev clock forward one due
follow-up at a time (a big jump would let a touch plan its successor from a clock already past it). Every step is
checked where it really lands: the AI's `ai_messages` row, the CRM's `Email` record (`ai_sent_via_platform`) and
the stubbed provider call (`dev_provider_outbox`). It starts the clock at the next Monday 09:30 dealer time.

Side effects: other leads' pending follow-ups are parked (`held_by_cadence_check`) during the run and put back
after; the clock is reset at the end. Leads of earlier runs still meet the AI's Day 91 sweep as the clock passes
it, so run `make crm-seed` afterwards for fresh demo data. A second dealer, "Late Hours Motors"
(`66f00000000000000000d0f8`, open 7:00-23:00 every day), is created for the per-state check so the state's
window, not the dealer's hours, is what holds the touch. `make crm-e2e` is not repeatable on the same data (its
service-slot checks D4b/D9b fail on the second run); reseed first.

## Result (merged with integration incl. E, G, H, R): 50 / 50

1 new lead Days 1-7 (1a-1i), 2 Days 8-90 + Day 91 (2a-2c), 3 reply / specific follow-up / re-entry (3a-3f),
4 appointment incl. the 15-minute details message, a move and a cancel (4a-4n), 5 manager outcomes and the
ownership lifecycle (5a-5h), 6 after hours (6a-6d), 7 opt-out (7a-7b), 8 per-state hours (8a-8c).

## Bugs fixed

1. **The specific follow-up's check-back went by one channel and started no call task.** The dated "call me
   Friday" check-back is a follow-up like any other (Omnichannel PDF p.9-10). `agent/turn.py`:
   `TRIGGER_NEXT_ACTION` added to `OMNICHANNEL_TRIGGERS` and `CALL_TASK_TRIGGERS`. Test:
   `test_call_tasks.py::test_the_specific_follow_up_goes_on_text_and_email_and_starts_the_call_timer`.
2. **A booking cancelled on the CRM's booking screen still got every appointment message** (details, countdown,
   confirmation, no-show). `PUT /api/booking` tells the AI nothing, and the lead keeps its booking fields, which
   the pre-send re-check read as a standing appointment. `scheduler/followups.py` now treats the lead's own
   cancelled booking as no appointment: the step is cancelled, the other steps too, and the lead goes to
   Contact Made - No Next Action and back into the cadence (PDF §15). `tools/booking_tool.booking_cancelled`.
   Test: `test_appointment.py::test_a_booking_cancelled_on_the_crm_screen_sends_nothing_and_goes_back_to_follow_up`.
   The cancel is noticed when the next step falls due (at most 15 minutes after a fresh booking, else the next
   countdown / confirmation / +1h check). Telling the AI from `PUT /api/booking` would make it immediate.
3. `devtools/scenarios.py`: `expect_outbox` reads the sent messages when the driver isn't the fake one, so the
   YAMLs can run against crm-local.

## Gaps found (not faked)

- **Countdown / no-show photo**: none for a lead whose vehicle is known only by name (Touch 1 names it from
  `interest.model`, no VIN is recorded as shown), so the countdown goes text-only. Needs the Touch 1 vehicle's
  VIN kept (stream A2/F3 area).
- **Touch 1 goes on the lead's own channel only**; Touches 2-8 and every later follow-up go on text AND email.
  Whether Touch 1 counts as a "follow-up" under the omnichannel rule is for the client.
- **Day 91 Closed - Lost is not written to the CRM lead status** (stays "Lead"; the AI stage shows read-only).
- **Year-1 anniversary text is blocked** for a customer whose only text consent was their inquiry a year ago
  (compliance engine: no opt-in flag). The email goes. Correct per the engine; worth telling the client.
- An open, unworked call task stops new timers for that lead (by design: not doubled); the check completes
  each task as staff would.

## Scenario YAMLs on crm-local: 50 / 76

The 26 failures are environment or other streams' areas, not cadence regressions found by the walk above:
customer time zone not found for the simulated dev customers (STRICTEST row holds touches: pc1_customer_time_zone,
pc3_specific_followup, pc4_reply_skips_nudge, pd4, s10, s13), "lead busy with a turn" retries outlasting the
step timeout (pc1_form_opt_out, pc4_*, pc5_*), first-reply wording / model behaviour after stream G
(p1_context_pack, p5_answer_then_ask, p7_clarify, pb4_buying_signal, s4_email_first_reply, s8_ai_first_reply,
p2_handoff_holding_reply), call-task expectations (pc2_call_task_opens, ph_call_outcome_reaches_ai,
ph_speak_to_a_human, pd2_sold_pending_cadence), pb5_slot_taken, pd7_anniversary_no.
