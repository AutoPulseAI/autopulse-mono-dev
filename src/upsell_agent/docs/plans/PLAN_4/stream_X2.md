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
