# PLAN_4 stream X2 — workflow and after-sale defects

Source: independent audits of the New Lead Omnichannel PDF (audit 1) and the SOLD PENDING / SOLD DELIVERED
PDFs (audit 3), plus the auditor's five probe tests. Each item below has a regression test that failed before
the fix.

## Items

- **5. No two touches on one calendar day** (probe P1). `agent/cadence.py`: Touch 3 used to ignore the name
  nudge's send date (the nudge belongs to Day 1). A nudge that a hold pushed into a later day's daytime
  (sent at/after 06:00 on a later date) now counts as that day's touch, so Touch 3 moves to the next day.
  Test: `test_cadence.py::test_an_evening_leads_held_nudge_and_touch_3_never_share_a_day`.
- **1. BLOCKER - staff pause -> resume restarts the workflow** (probe P5). New `followups.replan_workflow`,
  called from `handle_lead_resumed`: re-plans what the lead's *current* stage runs, never touching the stage or
  the Day 91 clock: Short-Term cadence continues from its stored state (touch number / themes / last touch, so
  no duplicate same-day touch; a pending name nudge is skipped since a person has spoken to the customer; the
  Days 1-7 call tasks restart with it), Specific Follow-Up's dated step, Appointment Set steps (a confirmed
  appointment for the same time keeps its confirmation and gets no Y/N), No Show's next step, Sold Pending /
  Sold Delivered touches if none is pending. Tests: `test_x2_workflow.py::test_resume_*`.
- **2. No Show never depends on the message being sendable** (probes P2, P4). The +1h check is planned at
  +1h even when the send check would hold it, and when it fires (same appointment, still Appointment Set) it
  moves the stage to No Show first, whatever the lead's status / dealer mode / send check. Only the message is
  gated. A showroom message that can't go out by appointment + 2h (`appointment.NO_SHOW_MESSAGE_LATEST`) is
  replaced by the +24h "how did everything go" message at the next allowed time. The no-show chain (+24h
  message, then the close back into follow-up) continues whatever happened to a message, and the close step
  (it sends nothing) ignores who holds the lead. Day 91 now also closes an Appointment Set / No Show lead whose
  appointment is more than 2 days past with nothing resolving it, and a long-past booking no longer counts as
  pending. Tests: `test_x2_workflow.py` (staff-held no-show, after-closing no-show, stale appointment).
- **3. Call checkpoint after every AI follow-up** (probe P3). The day-before confirmation and both no-show
  messages now start the 60-minute call timer (not the 15-minute details or the countdown: human follow-up isn't
  appropriate there - PDF p.9 "when human follow-up is appropriate"). The visit follow-up (3rd-decline re-offer)
  now goes on text + email and starts it; the after-hours morning message starts it. `call_task` is allowed at
  Appointment Set / No Show; entering those stages still cancels the old stage's timers and open tasks. Each
  timer stores `planned_stage` and is cancelled at fire time if the stage moved since its touch (also closes the
  audit 3 race where a SOLD PENDING timer opened after Sold Delivered). The workday cap (stream T) still applies
  at fire time. Already covered before: SOLD PENDING touches, the specific follow-up check-back, Touch 1, cadence.
  Birthday / anniversary never start one. Tests: `test_x2_workflow.py::test_the_confirmation_*`, `*visit_follow_up*`.
- **4. "Call within 5 minutes" (blueprint box 8).** `agent/call_tasks.py`: a customer-requested call task opened
  while the dealership is open gets `due_by = now + 5 min` (`REQUESTED_CALL_SLA`). When `mark_missed` reaches it
  still open, it is *escalated* instead of missed: `escalated_at`, `sla_missed`, a `call_escalation` staff notice
  and a CRM note ("Requested call not made in 5 minutes"); the task stays open until the end of the agent's day,
  then is missed as before. Requested tasks opened outside hours open at calling hours and get the 5 minutes then.
  Test: `test_x2_workflow.py::test_a_requested_call_is_due_in_5_minutes_and_escalates_when_it_isnt_made`.
