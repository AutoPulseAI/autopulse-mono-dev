# PLAN_4 stream X2 — workflow and after-sale defects

Source: independent audits of the New Lead Omnichannel PDF (audit 1) and the SOLD PENDING / SOLD DELIVERED
PDFs (audit 3), plus the auditor's five probe tests. Each item below has a regression test that failed before
the fix.

## Items

- **5. No two touches on one calendar day** (probe P1). `agent/cadence.py`: Touch 3 used to ignore the name
  nudge's send date (the nudge belongs to Day 1). A nudge that a hold pushed into a later day's daytime
  (sent at/after 06:00 on a later date) now counts as that day's touch, so Touch 3 moves to the next day.
  Test: `test_cadence.py::test_an_evening_leads_held_nudge_and_touch_3_never_share_a_day`.
