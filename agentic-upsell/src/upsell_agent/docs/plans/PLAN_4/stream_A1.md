# Stream A1: lead buckets, per-state contact hours (F1), service visits as requests (F2)

Built locally on this stream's branch, never pushed. Unit suite: 1285 passed (1202 before); offline evals: 79 passed.

## 1. Lead buckets (blueprint §2, scope Workflow 1 step 3)

**Files:** `agent/lead_bucket.py` (new), hooks in `agent/turn.py` (one call before the graph),
`agent/nodes/decide.py` (`decision["bucket"]`), `agent/nodes/compose.py` (payload), `agent/llm.py` (Compose rule),
`agent/offline_model.py` (first-reply word-track line), `api/leads.py`, `config.py` (`DEMO_BUCKET_KEYWORDS`).
Tests: `tests/unit/test_lead_bucket.py`.

- Every sales lead is put in `credit` / `trade_in` / `general` on its first turn, from its source
  (`BUCKET_SOURCES`, the blueprint's lists, kept as editable config), else its own comments, else `general`.
  Trade-in is checked first, so "TrueCar SELL My Car" and "CarGurus SELL My Car" beat plain TrueCar/CarGurus.
- Stored on `ai_lead_state`: `bucket`, `original_bucket`, `bucket_method`, `bucket_why`, `bucket_at`,
  `bucket_history`. Shown in `GET /v1/leads/{id}/profile` (`lead.bucket`, `lead.original_bucket`, and a `bucket`
  block with the method, whether it was overridden, and the history).
- The bucket changes **only the wording**: Compose gets `bucket` (intent, the scope's word-track emphasis, and the
  new/used emphasis once the customer has said which). The cadence, the questions we ask and the visit offer don't change.
- **Behaviour override:** a reply with a clearly different primary intent ("I just want to sell my car",
  "can I get approved with bad credit?", "is it still available?") moves `bucket`; `original_bucket` stays.
  Only strong phrases count: mentioning a trade on a credit lead is not a change of intent.
- **Demo hook:** with `DEMO_BUCKET_KEYWORDS=true` (default off), a brand-new conversation (`lead_created`) whose
  first message is exactly `CREDIT`, `TRADE` (or `TRADE-IN`) or `GENERAL` (any case) gets that bucket. The keyword
  is removed from the text the turn answers. On an SMS-started lead (source `sms` → lead type general) it also
  records `interest.lead_type` (sales / trade_in, quote = the keyword), so the AI doesn't then ask "buying, trading
  in or service?".
- **Vehicle type filter:** only the cheap part: the new/used emphasis reaches Compose when `interest.new_or_used`
  is known. Not stored as its own field, and the original new/used isn't kept for reporting (open).

## 2. F1: per-state contact hours

**Files:** `compliance/state_hours.py` (new: the table, the federal holiday calendar, `next_allowed`),
`compliance/engine.py` (rule 8 and 9 hooks, log), `compliance/customer_zone.py` (`states`),
`compliance/call_check.py`. Tests: `tests/unit/test_state_hours.py`; two `test_compliance.py` expectations
updated to the new rule (CA's own row in the reason; an unknown zone now waits for 10:00 Los Angeles).

- One row per state + D.C., built from **both** client tables (stricter wins): window per weekday, Saturday,
  Sunday, holiday ban, cap. `RULES_VERSION = "tcpa_7/2026-10-01"` is logged in every decision
  (`jurisdiction.states`, `jurisdiction.rules_version`).
- Asterisk rows are `verified=False` (research status; counsel confirms).
- The ZIP/DealerVault state and a different area-code state both apply; every row is checked in every possible
  zone. No state, or one not in the table (e.g. PR) → `STRICTEST`, the intersection of every row:
  Mon-Fri 10:00-18:00, Sat 10:00-17:00, no Sundays, no holidays, 3 per 24h.
- HOLD returns the first moment every row, every zone and the dealer's hours allow.
- Replies keep their current exemption; transactional texts keep 8:00-21:00.
- Human call tasks (`call_check.py`) also follow the state row, because Table 1 is literally the states' live-call
  windows, as well as 8:00-21:00.

## 3. F2: service visits are requested, not booked

**Files:** `agent/service_request.py` (new), `agent/visit_offer.py` (`service=True` offers ask for a day/time),
`agent/conversation.py` (`VisitState.service_ask`, `service_request`), `agent/nodes/decide.py` (service visits go to
`service_request.plan` before any booking code), `agent/nodes/guard.py` (service wording rule), `agent/turn.py`
(team notice after the send), `integrations/platform_client.py` (stub `record_note`), `agent/llm.py`,
`agent/offline_model.py` (+ "bring it in" counts as a visit request), `api/leads.py` (`service_requests`).
Tests: `tests/unit/test_service_request.py`.

- A service lead gets the visit offer as "which day and time suit you?". No times are offered, no availability is
  read, and `ensure_booking` / `POST /api/booking` are never called (a test fails if they are).
- Their answer is worked out in code ("Thursday morning" → "Thursday, September 24 in the morning"; "tomorrow at
  2pm" → date + 14:00). The team notice is `staff_notice.kind = service_request`; the request is added to
  `ai_lead_state.service_requests` and to `conversation.visit.service_request`. The notes carry the requested
  time, the vehicle, mileage, the service needed, concerns (wait / loaner / ride / drop-off / work hours /
  warranty / a described problem) and the customer's words. A later "actually Friday instead" moves the request.
- The reply says "I've passed … to our service team with your notes; they'll confirm the exact time with you."
  For a service visit the guard rejects booked / confirmed / scheduled / "see you then" / "all set for", and
  rejects "requested" when no request was passed.
- Sales visits and test drives book exactly as before (a test checks this).

## Decisions made on the client's behalf (please confirm)

1. **Indiana and Maine:** their stricter *automated-device* rules (IN ADAD 9:00-20:00; ME weekdays 9:00-17:00,
   1 per 8h) are **not** applied to AI texts. The rows use the live-call column, as F1 lists them. Those statutes
   are about recorded-message devices. Counsel should confirm. Switching it on is a row change: `_state_caps`
   already enforces any cap in a row.
2. **Unknown state = intersection of all rows**, which is stricter than any single row.
3. **Our 3-per-24h cap stays for everyone.** State caps are applied on top of it; today they are the same 3 per 24h.
4. **Holidays:** only the US federal calendar, counting both the actual day and the observed day.
   RI ("state/federal holidays") and LA/AL ("legal holidays") state-only holidays are **not** included (open).
5. Human call tasks follow the state's live-call row too.
6. Demo keywords also accept `TRADE-IN`. They only work on the first turn of a new lead (`lead_created`).
7. "Bring it in" counts as asking for a visit in the offline model and in the Extract prompt example.

## Open

- **Platform note for a service request:** the platform's `/api/conversations/notes` needs a staff JWT, and
  `/api/internal/ai/messages` has no `is_note`. Only the stub client writes a note today. The live client needs
  an internal notes endpoint (platform side).
- State-specific holiday calendars (RI, LA, AL), for counsel.
- Table 2 consent flags for counsel: PEWC in FL / OK / MD (and CT's default), and NJ's ban on unsolicited sales
  calls to cell phones. Nothing about consent changed here.
- Vehicle type: no stored `vehicle_type` / `original_vehicle_type` for reporting yet.
- MASTER_PLAN_3's "Not in this plan" wording, per F2: not edited here (not this stream's file).
- Touch 1 on a service lead still says "help you with your purchase" and asks "what are you driving now?".
  This was here before this stream, and it's another stream's area.
- `test_compliance.py::test_an_admin_resume_resolves_the_review` failed once in a mixed-file run and passed on
  every rerun (including the full suite). It looks like an order or timing flake that was there before this work.
