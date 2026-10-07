# PLAN_4 stream T: Days 1-7 human call tasks, call outcome full slot, missed call tasks

## 1. Days 1-7 morning + afternoon call tasks

Omnichannel PDF §3 "Human call tasks - Days 1-7". `scheduler/daily_call_tasks.py` (kind `daily_call_task` in
`scheduled_followups`).

- **Setting**: `dealer_account_information.ai_daily_call_tasks` ("on" | "off", unset = on, per the PDF), read by
  `integrations/dealer_profile.py` (`daily_call_tasks`). On the CRM's AI Settings page as a switch (scope Q8 is
  still open: whether these and the 60-minute task are the same thing; off keeps only the 60-minute one).
- **Windows**: from the dealer's opening hours: morning = opening..12:00, afternoon = 12:00..closing, on working days
  only, for cadence Days 1-7 (Day 1 = `cadence.started_at`'s local date).
- **Chain**: one waiting record per lead. `plan()` is idempotent (dedupe by `slot_key`), called from every
  `plan_cadence_touch` (so it starts with the cadence and restarts on re-entry) and after each record closes.
- **At window start, re-checked**: setting on, dealer live, stage Short-Term (`KIND_STAGES["daily_call_task"] =
  SHORT_TERM`), not opted out, no meaningful reply since the window began. Then dedupe: an open call task covers
  the half-day; a waiting 60-minute timer due inside the window covers it; at most 2 call tasks per lead per
  dealer-local day (the 60-minute task's re-check also applies this cap while the setting is on; customer-requested
  calls are exempt). Then `can_call` (phone, voice opt-out, DND, customer time + state live-call row, dealer
  hours): HOLD inside the window waits, past it is skipped; BLOCK suppresses.
- **Opened task**: `source: "daily"`, `slot`, `day`, `assigned_to` = the lead's `assigned_to`, `due_by` = window end.
- **Cancelling**: a reply / staff takeover (`cancel_call_task`) cancels this half-day's task (open or waiting) and
  keeps later ones; leaving Short-Term (appointment, Sales Visit, opt-out, Specific Follow-Up, closed) cancels the
  open daily task and the waiting record (`lifecycle.cancel_stale_work`). A staff pause no longer cancels the
  daily chain itself (`events/handlers.py`), only the current half-day.

## 2. Call outcome modal: full slot

`CallOutcomeModal.js` books through `aiFetch`, whose error now carries `status` and `body` (`aiShared.js`). A 409 /
slot 422 becomes `bookingConflictFrom(...)` and shows `SlotFullNotice` (message, "Book {next available}", the day's
other times) under the appointment fields, with the existing type select; nothing else (note, task close) is saved
until the booking succeeds.

## 3. Missed call tasks

Every task opened now has `due_by` (window end for a daily task; the dealer's closing time that day for the
60-minute / requested ones) and `assigned_to`. `call_tasks.mark_missed()` runs at the start of every `fire_due`
(each minute): open past `due_by` -> `missed`, `missed_at`, the staff notice is cleared. A missed task can still be
completed late (`resolve` accepts it; `missed_at` stays, so it still counts). `GET
/v1/staff/call-tasks/missed-by-agent?dealer_id&days=30`; the CRM's Call Tasks "Done" tab shows Missed rows (with a
"Record late call" button) and a per-agent missed count (assigned-only staff see their own). No BDC report.

## Tests

AI: 1585 unit tests pass (22 new in `tests/unit/test_daily_call_tasks.py`; `test_call_tasks.py` count updated),
80 evals pass (offline). CRM: `node --test test-ai-*.js test-customer-360.js test-customers-api.js` 102 pass (3 new).
Ruff / ESLint clean on changed files.

## Open items

- Scope Q8 (are the daily tasks and the 60-minute task the same?) is unanswered; default is on.
- Opening hours stand in for agent schedules (no per-agent schedule in the platform), as for the 60-minute task.
- "Click-to-Call completion is captured": the page's Call button still opens `tel:` and then forces the outcome
  prompt; no telephony integration captures completion.
- Tasks opened before this change have no `due_by` and are never marked missed.
- Not clicked through in a browser.
