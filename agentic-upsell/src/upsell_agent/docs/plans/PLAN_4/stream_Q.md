# Stream Q: conversation quality and over-escalation

Client: "The goal is not to escalate every customer creating more work for the dealer and allowing the lead to
go cold. Strike while the iron is hot and get the customer in the dealership." / "Not interested" -> ask why;
a reason -> note it and escalate; only a human closes the lead. / Grammar must be good.

Measured with stream E's harness (`python -m evals.conversation_cost`, 12 scripted conversations, gpt-5-mini for
Extract and Compose, reasoning effort minimal, production timeouts 6 s / 8 s).

## Numbers

| | Baseline (integration, before Q) | Final (stream Q) |
|---|---|---|
| Report | `conversation_cost_baseline_Q_20261004-0145` | `conversation_cost_gpt-5-mini_streamQ_20261004-1309` |
| AI replies / customer messages | 24 / 156 | 138 / 156 |
| Messages left with no AI reply | 144 | 30 |
| Leads that ended with staff | 12 of 12 (11 at their first or second message, by a template fallback) | 8 of 12: 4 right (asked for a person x3, "not interested" + a reason), 3 by two fallbacks in a row, 1 "clearly upset" at exactly 0.80 |
| Template fallbacks | 11 of 24 replies | 9 of 138 |
| Guard retries | 14 | 25 (0.18 per reply, was 0.58) |
| Grammar (stream G's judge, 0-1, mean of 12) | not judged | 0.89 (lowest 0.845; 13 replies under 0.8) |
| Cost per conversation / per reply | $0.0058 / $0.00288 | $0.0319 / $0.00278 |
| Cache hit (input tokens) | 60.5% | 57.7% |
| Reply time p50 / p95 | - | 4.6 s / 8.0 s |
| Bookings made | 0 | 4 |

Cost per conversation went up only because the AI now answers the conversation instead of going silent; cost per
reply fell slightly. The baseline is worse than stream E's own run (81 replies) because the first reply's email
failed stream G's new `touch1_opening_first` check twice on most leads, which handed the lead to staff.

Real-model spend for the whole stream: about $1.30 of the $3 budget (baseline $0.07, iterations $0.80, final
$0.38, grammar judge about $0.05).

The final report predates three last fixes (visit-offer cap, reply-language check, three SMS segments for
Spanish), which were then checked on the Spanish and credit-2 conversations only: the Spanish customer got all
13 replies in Spanish with a booking and no fallback.

## What changed, by item

1. **Over-escalation.**
   - Urgency (`decide.urgency`, `ESCALATING_URGENT_REASONS`): only `safety_problem` and `no_transportation` hand
     off. "I need a truck asap", "by tomorrow", an expiring offer and the 48h needed-by backstop make the visit
     eligible now and give Compose `urgency`. The backstop ignores a day the customer is booking.
   - Extract: nervous / worried is not upset; mentioning a manager is not asking for a person (also the offline
     model's `_HUMAN`).
   - "Not interested anymore" came back as its own reason, so the ask-why was skipped:
     `real_not_interested_reason` drops a reason that only restates the objection (and the Extract rule says so).
   - A time that isn't one we offered: a bare time ("3pm", "10 works") is matched against the offered day
     (`booking_tool.bare_time`), booked when open; when it isn't open the nearest open times are offered
     (`nearest_times`, `visit.time_not_open`). "Same time works" while moving a booking is the booking's own time.
   - A draft rejected twice hands off only the second time in a row (`FALLBACKS_BEFORE_HANDOFF`).
   - False guard rejections that caused most fallbacks: Touch 1's intro is put first by code
     (`compose.place_touch1_intro`); a named vehicle's own year/miles, the customer's "3pm" / "730", times offered
     in an earlier reply, a just-saved date and a service request's day are allowed numbers; a recall the customer
     raised may be talked about (a status claim still needs VIN facts).
   - At most three unanswered visit offers (was reaching "attempt 4 of 3").
2. **Repetition.** A pending value never left `needs_confirming` unless the customer said yes/no, and Decide
   confirmed it every turn. Now once per fact (`ConversationState.confirms`, `MAX_CONFIRMS_PER_VALUE`); it stays
   unconfirmed for staff and is not asked again.
3. **Service leads.** `cadence.touch1_intro(service=True)`: "Thank you for contacting our service team. I am happy
   to help you take care of your 2021 Camry." and no "what are you driving now?".
4. **Vehicle sentences.** Compose rule (name once, natural words, no field list, no VIN) and guard
   (`guardrails/wording.py`: `vin_in_text`, `repeated_vehicle_name`).
5. **Invented names.** `wording.invented_names`: only the dealer's AI agent name (now `dealer.agent_name` in the
   context pack), the dealership's, or a name the customer used.
6. **Unverified features.** `wording.unverified_features`: seating, drivetrain, equipment and car-seat fit are
   not on the stock record, so they are deferred to the team (a question or "you need ..." is not a claim).
7. **Misread values.** `validate.offer_not_payoff` rejects a payoff taken from "Carvana offered me 24k"; Extract
   rule added.
8. **Fallback.** After the first reply the template is built from Decide's plan
   (`templates.render_continue_reply`): take the question to the team, ask the next missing detail, or note it.
9. **Language** (`agent/language.py`). A customer writing in Spanish is answered in Spanish
   (`decision.reply_language`, detected in code from their messages). Touch 1's intro stays the client's exact
   English text (PDF-required); the closing question, the after-hours question and times are translated. The
   grammar rule skips its English-only checks (a/an, lone "i"); the guard rejects an English reply to a Spanish
   customer and Spanish booking words without a booking; Spanish day/time words reach the booking code
   (`dates_to_english`); the fallback templates have Spanish versions; the lead state has `customer_language` and
   a handoff reason says "(the customer writes in Spanish)".

Harness: each turn now records Decide's action and rule, guard violations and rejected drafts;
`evals/grammar_judge.py` gives `--grammar judge` stream G's judge.

Tests: `tests/unit/test_conversation_quality.py` (30), three existing tests updated for the fallback rule, four
`reply_cases.jsonl` urgency cases now expect a visit offer. 1,642 unit tests and 80 evals pass; ruff clean on
changed files.

## Open items

- **For the client:** urgency narrowed (architecture decision 184); a Spanish first reply opens with the English
  Touch 1 intro; a customer who gives an objection with a condition ("not interested in coming in if you can't
  match it") is handed off as "not interested + reason".
- Three leads still reached staff through two fallbacks in a row. Causes seen: SMS over 320 characters, three
  questions in one message, an old restricted question carried forward and reported unanswered, "in stock"
  wording with no vehicle named. Worth a pass on carried-over questions.
- Upset at exactly 0.80 handed off "I'm busy and don't want to waste a trip for a lowball"; consider 0.85.
- The model still states things no record backs ("recalls are handled at no cost", "about an hour to an hour
  and a half", "the service team has openings tomorrow morning"). The guard only catches numbers and the listed
  feature words.
- Spanish: only Spanish is detected; the feature and name checks read English wording only; slot questions in the
  English fallback are not translated (the Spanish fallback asks nothing).
- The after-hours "later" path repeats "the team will pick this up when we open" on every later message
  (credit-3); not touched here.
