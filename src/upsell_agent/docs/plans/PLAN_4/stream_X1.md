# PLAN_4 stream X1: compliance fixes from audit 2 (TCPA guardrails)

Source: the independent audit of the build against the client's TCPA PDF (`audit_2_tcpa.md`), the PDF itself,
`docs/data/6/tcpa_7.md` and the client's answers in `docs/data/6/conversation_6.md` (Q10, Q19).
Every item has a regression test that failed before its fix.

## Item 2: explicit opt-outs caught in code

`compliance/opt_out.py`. A short message (6 words or fewer) that only says stop, with politeness or emphasis
around it ("please stop", "STOP ALL", "unsubscribe please", "I said stop", "ok stop now", "STOP. Thanks"), is an
opt-out of every channel (the customer didn't limit it) with our one confirmation. A bare keyword ("STOP", "END.",
"Stop!!! 🛑") is still the carrier keyword on its own channel. New phrases at any length: "stop calling" → calls,
"stop texting" / "stop sending texts" / "dont txt me" / "I don't want any more texts" → texts, "stop emailing" /
"stop sending emails" → email, "stop sending me messages", "opt me out", "remove me", "take me off", "do not
contact", Spanish "no más mensajes" → every channel. Normalisation drops accents, emojis and punctuation.
"Don't stop texting me", "stop by", "stop in at 3", "the car won't stop pulling left", "cancel my appointment",
"opt out of the extended warranty" are not opt-outs; "I'm not interested" is still an objection. Anything unclear
still goes to the model's `possible_opt_out` → REVIEW.

Tests: `tests/unit/test_x1_opt_out_detection.py` (table of positives and negatives; 35 failed before).

## Item 1: the first message on a new lead is a `lead_response`, not a reply (blocker)

Before: `handle_lead_created` → `run_turn` (default `is_reply=True`) → `purpose="reply"`, so the engine's reply
ALLOW skipped opt-out, review, consent, state hours and the cap (audit probes P1 and P2).

Now (`compliance/engine.py`, `events/handlers.py`, `agent/turn.py`):

- New purpose `lead_response` (TCPA PDF §4 "Consumer-initiated lead response"). The engine never gives it the reply
  exemption: invalid contact, opt-out by customer **or phone/email** (the re-import case), DND, the explicit no,
  an open review, the customer's state row (`state_hours`) and the 3-in-24h + state caps all apply. A consumer
  inquiry (origin `inbound`) needs no marketing consent (logged as `consent.status = inquiry`). The dealer's hours
  do not apply to it: the after-hours "now or when we open?" choice covers a closed dealer.
- Origin first (B2 `compliance/origin.py`): a lead that isn't the consumer reaching out (CSV `csv_import`,
  DealerVault, DMS, a campaign, an unmapped source) is evaluated as outbound **marketing**: no consent → BLOCK.
- `handle_lead_created` checks before drafting. BLOCK / REVIEW: nothing is drafted; the lead's other channel is
  tried if it has an address; otherwise a `not_sent` turn log and a logged decision say why. HOLD: a
  `first_reply_held` follow-up is planned for the time the check gives (e.g. 23:30 → 8:00 customer time), fired by
  `fire_held_first_reply` (checked again, then the normal first-reply turn; at 8:00 with the dealer opening at 9:00
  the customer gets the after-hours choice, as before). The customer writing first cancels it (their message is
  answered). Lead-created turns now send with `purpose=lead_response, is_reply=False`.
- Shadow dealers: a HOLD is recorded as the shadow draft (nothing is ever sent) so comparisons stay complete.
- Tests that create leads at real time now pin the clock and a NY customer (`during_opening_hours`, `ny_customer`);
  `test_switch_to_email_is_never_held` moved from 21:00 to 20:30 (a 21:00 first text now waits for 8:00).

Tests: `tests/unit/test_x1_first_reply.py` (P1, P2, CSV import, consumer inquiry ALLOW, 23:30 held then sent at
8:00 with the choice, after closing inside the window, customer writes first, open review). 7 of 8 failed before.

## Item 3: an open REVIEW stops every automated send; it isn't cleared just because the customer wrote

- `compliance/engine.py` rule 6: an open review now stops everything the system starts (marketing, the first
  message, transactional: the countdown with its photo, no-show follow-ups, sold-pending touches). A reply to the
  customer's own message still goes (rule 5 comes first), as does the holding reply on a handed-off lead.
- `events/handlers.py` no longer resolves the review on any new customer message. `agent/turn.py`
  `_resolve_review_if_answered` resolves it (source `customer_answered_review`) only when Extract saw no possible
  opt-out in the new message and `opt_out.answers_review` says it clearly engages: real words (3+, or a 2-word
  question), not a bare "ok"/"why", none of the stop / remove / "too many" / "not interested" vocabulary. Otherwise
  it stays open for staff (DND) or an admin resume (`handle_lead_resumed`, unchanged).

Tests: `tests/unit/test_x1_review.py` (failed before: import + behaviour); `test_compliance.py` review test updated
(transactional under review is now REVIEW).

## Item 4: the CRM's `sms_opt_in` flag is not marketing consent

The CRM sets `phones.$.sms_opt_in = true` on any inbound text (`processSms.js:339`, `aiInbound.js:78` →
`customerResolver.appendPhoneIfMissing`). The engine (`marketing_sms_consent`) no longer grants marketing or
campaign consent from it and no longer writes `platform_sms_opt_in` "granted" entries. A reply to the customer's
own message needs no consent, so the flag's only legitimate use (answering that conversation) is unaffected; its
`false` is still an explicit no. Marketing text consent now comes only from the customer's own inquiry (follow-ups
within 91 days, unchanged) or the customer's own opt-in back after a STOP. The CRM flag and its other uses
(the "SMS opt-in" badge, link logic) are left as they are.

Side effect handled (small, marked change in `scheduler/followups.py plan_next_action`): a dated next step the
customer asked for whose text is blocked for consent now goes by email when email is allowed, instead of not at all.

For counsel: whether a customer's own request for a dated contact ("try me again next year") is itself enough for
a text then; and whether "the customer wrote back" on an outbound / DealerVault lead should keep granting 91 days of
AI follow-up consent (`_customer_wrote`, unchanged here; the audit flagged it).

Tests: `test_compliance.py::test_platform_opt_in_flag_is_not_marketing_consent` (new; ALLOW before), campaign-queue
tests now use a customer START as the real consent.

## Item 6: dealer DND carries to the customer, phone and email

`compliance/engine.py` `_dnd_elsewhere`: after the lead's own DND, any of the dealer's leads with the same
customer id, the same phone (last 10 digits) or the same email (case-insensitive) in DND / Do Not Disturb / Do Not
Contact blocks every channel and purpose (as the lead's own DND always did), so a new web lead and a re-import under
a new customer id are both suppressed. Dealer-scoped like everything else (no cross-dealer suppression).

Tests: `tests/unit/test_x1_dnd.py` (3 of 4 failed before; the 4th checks an unrelated customer is unaffected).

## Item 7: transactional texts follow the state table; call tasks re-checked and windowed; calls count to caps

- `compliance/engine.py`: transactional texts now use the customer's state row(s) (KY 10:00, TX Sunday noon, the
  Sunday / holiday bans) instead of a flat 8:00-21:00. Replies to the customer's own message keep their exemption.
  `test_state_hours.py` KY test now expects a transactional HOLD to 10:00 (it asserted ALLOW before).
- Call tasks (`compliance/call_check.py call_window`, `agent/call_tasks.open_task`, `api/call_tasks.py`): every
  task stores `call_window` {can_call_now, do_not_call_before, do_not_call_after, window, states} from the state's
  live-call row, 8:00-21:00 and the dealer's hours. `GET /v1/call-tasks` recomputes it live for open tasks, and the
  new `GET /v1/call-tasks/{id}/check?dealer_id=` runs (and logs) the call check at the moment of dialling: the
  CRM's click-to-call should call it first (CRM UI change not made here).
- FL / OK / MD "3 per 24 hours": completed call tasks (outcome connected / no_answer / voicemail / other) count with
  marketing texts, in `can_call` (a 4th contact is HELD) and in the engine's state-cap check for texts.

Tests: `tests/unit/test_x1_calls.py` (6, all failed before: new API / behaviour), the KY transactional assertion.
For counsel: whether transactional texts (appointment confirmations) really need the state rows (we apply them,
the stricter reading), and whether the state caps are per subject (we count every marketing text and call).

## Item 8: audit record completeness (§11) and the lead provider's consent object (§6)

- `ai_compliance_log` rows now also carry `lead_source` (+ `origin_rule`), `consent_text_version` (with
  `consent_evidence_id`), top-level `rules_version`, `message_id` (the `ai_messages` row), `template_id`
  (`template:<trigger>` / `template:<action>` when a template wrote it, else None), `opt_out_event_id` (the
  `ai_consent` entry that blocked it), and `delivery` {status, provider_id, updated_at, events[]}: written by the
  Sender after the send ("sent" / "failed") and updated by every provider callback (`channels/delivery.py` →
  `sender.record_delivery`, matched by the send's idempotency key). Only `delivery` is ever updated; the decision
  fields stay add-only. Jurisdiction, local time, frequency, decision, reason and rule were already there.
- `channels/consent.lead_provider_consent`: the provider's consent object (lead `tcpa_consent` / `consent` /
  `lead_consent`, top level or under `data`; aliases normalised; the raw object kept) is stored whole on the
  `ai_consent` entry with `consent_text_version` and `source_url`. It counts as text consent only when complete:
  disclosure text, disclosure version, consent time, the phone we'd text, and SMS among the permitted channels if
  channels are given. Anything less, or AutoTrader's bare `TCPAOptIn: true` line, is CONSENT_REVIEW_REQUIRED (with
  what is missing in the reason). `opted_in: false` is an explicit no.
- `compliance/origin._source` no longer repeats a value present in both `source` and `lead_source`.

Tests: `tests/unit/test_x1_audit.py` (8; all failed before). Open: the CRM lead ingestion (ADF / provider feeds)
must put the provider's consent object on the lead under one of those keys; today only AutoTrader's comment line
arrives, so provider leads stay at REVIEW for campaigns (AI follow-ups on an inbound lead use the own-inquiry rule).

## Item 9: the AI never states or infers consent or eligibility (§10)

- `agent/llm.py` COMPOSE_INSTRUCTIONS: first rule now forbids saying or implying the customer consented, opted
  in, subscribed, agreed, is eligible / qualifies, has an existing relationship, is not on a do-not-call / opt-out
  list, or may be contacted; who may be contacted is decided in code and never mentioned.
- `guardrails/consent_claims.py` + `draft_guard.check_draft` check `no_consent_claims`: a draft with such a phrase
  fails the guard (retry, then the safe fallback / handoff, like any other guard failure). "Reply STOP to opt out"
  and "qualifies for the CPO warranty" pass.

Tests: `tests/unit/test_x1_consent_claims.py` (17; all failed before).

## Item 10: state holidays, IN / ME automated-device rows, New Jersey's cell-phone sales ban

All in the versioned table `compliance/state_hours.py` (RULES_VERSION `tcpa_7/2026-10-04-x1`, logged per decision):

- `state_holidays(state, year)`: RI Victory Day (2nd Monday in August); LA Mardi Gras, Good Friday, All Saints'
  Day; AL Mardi Gras, Confederate Memorial Day (4th Monday in April), Jefferson Davis' Birthday (1st Monday in
  June). Easter computed (Gregorian). The STRICTEST row (unknown state) bans all of them.
- Rows carry `automated` rules: IN ADAD 9:00-20:00 every day; ME weekdays 9:00-17:00, no weekends, 1 per 8 hours.
  `rules_for(states, automated=True)` overlaps them with the live row; the engine uses it for every AI text (all
  are automated), call tasks keep the live row. Unknown state → `STRICTEST_AUTOMATED` (Mon-Fri 10:00-17:00, no
  weekends). Switch: `TCPA_AUTOMATED_DEVICE_ROWS=false`.
- NJ row `unsolicited_sales_ban` (N.J.S.A. 56:8-130): a marketing text to a New Jersey customer is BLOCKed
  (`unsolicited_sales_ban`) unless it follows up their own inbound inquiry, the customer opted (back) in, or a
  lead provider's complete consent record exists. Every number is treated as a cell phone. Switch:
  `TCPA_NJ_CELL_SALES_BAN=false`.

Tests: `tests/unit/test_x1_state_rules.py` (13; failed before). **Counsel must confirm**: the holiday lists (LA and
AL Mardi Gras are parish / county holidays, applied statewide; LA All Saints' Day), whether AI texts are
"automated devices" under IN / ME law (we assume yes), whether the ME 1-per-8h cap is per number across texts and
calls, and how NJ's "unsolicited" reads for a dealer's follow-ups.

## Open items for counsel (all items)

- The `lead_response` exemption from marketing consent for consumer-initiated leads (TCPA PDF §4).
- Transactional texts under the state rows (applied, the stricter reading).
- `_customer_wrote` still gives an outbound / DealerVault lead 91 days of AI follow-ups once the customer writes.
- Whether a customer's request for a dated contact is itself enough for a text then (today: email if no consent).
- State caps counted across all subjects (texts and calls together), not per subject.
- State holidays, IN / ME automated rows, NJ ban: as above. National / state DNC lists: not used (client Q19).
