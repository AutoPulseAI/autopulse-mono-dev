# Stream H: "speak to a human" → a call or a text, and call outcomes that reach the AI

Client action item (Friday meeting): "Review the AI's response when a customer asks to speak with a human and
address the requested call-or-text choice." Extra scope (coordinator): staff call outcomes from the CRM's Call
Tasks prompt must reach the AI, not only be saved as a note.

## Behaviour

| Customer says | AI reply (offline wording) | Staff side |
|---|---|---|
| "Can I talk to a real person?" (no method) | "Happy to get someone from our team for you, Hana. Would you like a call at the number ending in 4567, or a text from a team member?" One question, nothing else; **not** handed off yet. | nothing yet |
| → "A call please" / "call" / "either" / "that number" | "You got it, Hana - a member of our team will call you at the number ending in 4567 shortly." | call task **open now** (`reason: Customer asked for a call`, `requested: true`), staff notice; handoff |
| → same, outside calling hours | "... will call you at the number ending in 4567 at 9:00 AM tomorrow, when we're able to call." | a `call_task` follow-up (`requested`) due at the next allowed time; "call_requested" notice; opens then even though the lead is handed off |
| → "text" / unclear answer | "You got it, Hana. A member of our team will text you here shortly." | `text_requested` notice ("wants a text from a person"); handoff, AI silent |
| → "never mind" | normal conversation resumes | — |
| "Can someone call me?" / "have a person text me" | skips the question, as above | as above |
| Upset/urgent + asks for a person | immediate handoff, reply says how (call by default, text when calls aren't possible) | call task notice says "upset or urgent: please call first" |
| Voice opt-out / DND / no usable phone | never offered a call: "We won't call. A member of our team will text you here shortly." | `text_requested`, no call task |
| "Don't call me, but a person can text me" | the voice opt-out is recorded and the request continues to the turn (not swallowed by the opt-out confirmation) | `text_requested` |
| "call me Friday" | unchanged: dated next step (decision 131) | unchanged |

Rules:
- Decide rule `offer_human` (slots/policy.py, after `handoff`, before `ask_why`). Method is read in code
  (agent/human_contact.py), not by the model. The conversation keeps `human_contact {choice, offered_turn}`
  and `awaiting_human_choice`.
- The call check is compliance/call_check.can_call (record=False in Decide; the scheduler's own check logs it
  when a waiting task opens).
- Full numbers never reach Compose: only `phone_last4` (agent/human_contact.for_compose). Guard and the reply
  eval allow the last 4 digits and the "when" texts as known values.
- A customer-requested call task is not cancelled by the customer's later messages or staff taking over
  (`keep_requested`), nor by the handoff status when it was waiting for calling hours. Stage changes still
  cancel it.
- `agent/llm.py`: one marked rule (`[PLAN_4 stream H] offer_human ...`) and `human_contact` listed in the input.

## Call outcomes → the AI (agent/call_outcomes.py, POST /v1/call-tasks/{id}/complete)

Body gains `lead_outcome`, `follow_up {date, time?, channel sms|email|voice, owner ai|human, notes}`,
`opt_out_scope all|voice`. Applied once per task.

- specific_followup → `customer_replied` event with `next_action` (same §6 structure as "call me Friday",
  `entered_by` = staff name) → Contact Made - Specific Follow-Up. Owner AI: `plan_next_action` schedules the
  check-back (a "phone call" follow-up checks back by text with `call_requested`, so staff get the "please call"
  notice that day) and a handed-off lead goes back to the AI. Owner human: recorded only.
- contact_no_action → Contact Made - No Next Action; a cadence touch is planned if none is waiting; back to AI.
- no_contact → nothing changes.
- wrong_number → channels/suppression.suppress_contact on the called phone (invalid + bad_contact notice).
- opted_out → consent opt-out on every channel + stage Opted Out (CRM also sets DND); or voice only + a
  `do_not_call` notice (no DND).
- appointment → the CRM's booking route, now with the appointment type select; nothing in the AI.

CRM: app/lib/ai/aiCallOutcome.js (validation/shape), the `[id]` route uses it, CallOutcomeModal adds follow-up
owner, appointment type, "wrong number" lead outcome, opt-out scope; Call Tasks shows a "Customer asked for a
call" badge; Alerts label `text_requested` = "Wants a text from a person".

## Tests
- tests/unit/test_human_contact.py (pure method reading + every path through the real turn), 
  tests/unit/test_call_outcomes.py (each outcome), test_slots rule order, test-ai-layer.js (CRM shaping).
- Scenarios: scenarios/ph_speak_to_a_human.yaml, scenarios/ph_call_outcome_reaches_ai.yaml (new
  `call_outcome` step). Not run here (they need the worker/stack, which this stream must not touch).

## Open items
- Email-channel leads are offered "a call or an email"; whether the client wants SMS offered there too.
- A clearly upset customer who did not ask for a person still gets today's generic handoff wording.
- The CRM booking for "appointment" still isn't sent to the AI as a call outcome (the CRM's status route
  already informs the AI of the booking through its existing flow).
