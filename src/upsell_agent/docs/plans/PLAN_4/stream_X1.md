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
