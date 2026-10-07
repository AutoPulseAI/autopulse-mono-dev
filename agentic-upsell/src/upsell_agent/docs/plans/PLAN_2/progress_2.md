# MASTER_PLAN_2 progress: Phases 0–10

Plan: [`MASTER_PLAN_2.md`](MASTER_PLAN_2.md). Next plan (inventory): [`../PLAN_3/MASTER_PLAN_3.md`](../PLAN_3/MASTER_PLAN_3.md).

| Phase | State |
|---|---|
| 0. Decisions | Done |
| 1. Context builder and conversation state | Done, verified end to end |
| 2. Never silent | Done, verified end to end |
| 3. Rolling summary | Done, verified end to end |
| 4. Understanding the customer | Done, verified end to end |
| 5. Conversational Decide | Done, verified end to end |
| 6. Answer sources | Done, verified end to end |
| 7. Plain, explainable replies | Done, verified end to end |
| 8. Dates and time | Done, verified end to end |
| 9. Debug UI updates | Done, checked in a real browser with both the offline and the real-model settings |
| 10. Conversation evals and real-model run | Done except the real-model run: **blocked by the OpenAI key** (see Phase 10) |

## Verification (run on the finished code, after Phase 10)

| Check | Result |
|---|---|
| AI unit tests + DeepEval gate (`make ai-test`, `make ai-evals`) | 641 passed (630 after Phase 8; +2 dev API, +9 conversation evals) |
| Promptfoo injection suite | 12 / 12 (3 new: working memory, rolling summary, dealer details) |
| Eval report, offline model (`make ai-evals-report`) | 22 / 22 cases, 34 turns |
| Eval report, real models | **Not run: the OpenAI key is refused (401 `invalid_organization`)** |
| Scenarios, live in Docker (`make ai-scenarios`) | 36 / 36 (33 after Phase 5 + 1 each for Phases 6, 7, 8). Every scenario also checks that no reply contains internal terms. Re-run after Phase 10: 36 / 36. |
| Platform end to end (`make dev-full` + `make ai-e2e`) | 35 / 35 |
| Platform tests (`make platform-test`) | 61 / 61 |
| Burst test, 300 replies in 60 s | 8 / 8 checks, 0 template fallbacks, other dealer not slowed (after Phase 8; Phases 9-10 don't touch the turn path) |
| Guard failures, live, last 24 h (Phase 6 "done when") | Every failed guard check was one of the deliberate `#retry` / `#fallback` scenarios; no reply with dealer details, dates or explanations failed it |
| Debug UI (`npx tsc -b`, then checked in a real browser) | Type check clean; checked: the "tomorrow" conversation (date said back, "next Friday" confirmed with the actual date), the clarify conversation, plain values in the Slots panel |
| Ruff on every changed file | Clean (8 old `noqa` notes in `evals/test_extraction.py` predate this work) |

After Phase 5: the Decide inspector (9 rules, "not asking" reasons), the answer-then-ask reply, the Summarize step and the summary in the Context pack view were checked in the browser.

After Phase 2: Load context with the pack took 11–93 ms per turn (live turn logs).

---

## Phase 0: Decisions

Recorded in architecture.md §15 (decisions 7–13) and in MASTER_PLAN_2's Phase 0.

- **Inventory** is out of this plan. The full plan for it is [`../PLAN_3/MASTER_PLAN_3.md`](../PLAN_3/MASTER_PLAN_3.md), written assuming Plan 2 is finished. Its first decision is how to tell dealer stock from DMS-history vehicles, which share the platform's `vehicles` collection.
- **Dealer info** comes from the dealer's platform record (`users.dealer_account_information`: store name, address, website, texting number, `weekly_availability`, `time_zone`). Staff contact details are never used.
- **Timezone:** the dealer's `time_zone`, else `America/New_York`. The Debug UI displays Pakistan time (`Asia/Karachi`, labelled PKT) and the dealer's local time where business hours matter.
- **Handoff timeout:** 30 business minutes → one more holding reply + a staff alert; the lead stays with staff; once per handoff.
- **Business hours:** the dealer's `weekly_availability`, else Mon–Sat 9:00–18:00.
- **US messaging law:** an SMS the AI starts on its own goes out only 8:00–20:00 local time. That covers the federal TCPA (8–21) and the stricter state rules (8–20). Replies to the customer's own message and all email go out right away. **Counsel should confirm before the first live dealer.**
- **Ask limit:** 2 per slot, never twice in a row, then parked (used in Phase 5).

Debug UI: every displayed time is in PKT, through one helper (`debug-ui/src/time.ts`).

## Phase 1: Context builder and conversation state

**What changed for the AI:** every turn builds one **context pack**, and Extract and Compose read the same one.

- **Extract now sees the conversation.** It still extracts only from the new messages, and quotes must still be the customer's own words.
- **Working memory** is chosen by a token budget (`CONTEXT_WORKING_TOKENS`, default 3000), not by message count. The last 6 messages are always kept, and one very long message is cut.
- **Customer emails lose their quoted chain** ("On … wrote:", `>` lines, Outlook blocks, signatures) before the AI reads them, and before Validate checks quotes. A value can no longer be taken from our own quoted email.
- **Conversation state** on the lead:
  - asks per slot, with count and reply number;
  - what the last reply asked;
  - the customer's open questions: closed by an AI-written reply that was given them, kept open after a template reply and handed to the next turn;
  - promises: Compose now returns them as a structured field, and templates declare theirs;
  - the last topic.
  - Shadow turns change nothing.
- **The trace:**
  - the turn's start lists every batched message;
  - Load context shows the whole pack in DEV (under `prompt`, so production traces drop it);
  - a new Context pack view in the step inspector shows tokens per layer, what the AI read, asks, open questions and promises.

**New files:**
- `agent/context_pack.py`
- `agent/conversation.py`
- `integrations/dealer_profile.py`
- `tests/unit/test_context_pack.py` (28 tests)
- `scenarios/p1_context_pack.yaml`

**Changed:**
- **Nodes:** `agent/nodes/load_context.py` (builds the pack), `extract.py`, `compose.py`, `decide.py` (open questions carried over), `validate.py` and `guard.py` (cleaned customer text).
- **Models:** `agent/llm.py` (prompts describe the pack; Compose returns `promises`), `agent/offline_model.py` (returns promises).
- **Turn:** `agent/state.py`, `agent/turn.py` (batch in, conversation state out), `agent/templates.py` (each template's asks and promise), `agent/graph.py` (step inputs), `events/handlers.py` (passes the batch).
- **Config:** `config.py` (`CONTEXT_WORKING_TOKENS`).
- **Debug UI:** `StepViews.tsx` (Context pack view, promises in the Compose preview), `NodeInspector.tsx`, `ScenariosTab.tsx` (Plan 2 phases shown as "Plan 2 · Phase N").
- **Scenario runner:** the `expect_context` step.

**Fixed along the way:**
- `pyproject.toml`: the unit tests use `fakeredis[lua]`, since the dealer-slot Lua script needs `lupa`. A fresh `make ai-install` would have failed those tests.
- `tzdata` added as a dependency: Windows has no timezone database.

## Phase 2: Never silent

**What changed for the customer:**

- **Holding replies:**
  - A message on a handed-off lead gets a fixed holding reply ("Thanks, I've passed this to the team…"), at most one every 2 hours.
  - The handoff reply itself counts, so nobody is told the same thing twice in five minutes.
  - Holding replies never schedule a channel switch.
- **Staff check:**
  - A handoff (the customer asked for a person, or the guard failed twice) schedules a check 30 business minutes later.
  - If staff still haven't taken the lead over, the customer gets "Sorry for the wait…" and a staff alert is recorded. Once per handoff.
  - Staff pausing or resuming the lead cancels it; a customer message doesn't.
  - Shadow mode schedules none.
- **Contact window:** the 24h channel switch and the staff check's message wait for 8:00 when they would go by SMS outside 8:00–20:00 dealer time, both when planned and when they fire. Email is never held.
- **Nothing unexplained:**
  - Every customer message the AI doesn't answer gets a "held" turn log (trigger `inbound_held`) with the reason. That covers paused, opted out, STOP, START, and inside the 2-hour window.
  - The message is marked answered by that turn.
  - The go-live check's lost-reply rule is now "no customer message without a reply or a reason", with no exception by lead status. It also lists staff alerts.

**New files:**
- `scheduler/contact_window.py`
- `tests/unit/test_never_silent.py` (31 tests)
- Scenarios: `p2_handoff_holding_reply.yaml`, `p2_handoff_timeout.yaml`, `p2_staff_takeover_cancels_timeout.yaml`

**Changed:**
- **Scheduler:** `scheduler/followups.py`:
  - a `kind` field: `channel_switch` or `handoff_check`;
  - `plan_handoff_check`, firing and deferral;
  - every channel-switch query filtered by kind.
- **Handlers:** `events/handlers.py`: holding replies, held turn logs, and a customer message cancels channel switches only.
- **Turn:** `agent/turn.py`: `handoff_id`, `last_handoff_notice_at`, scheduling the check, due times shown in dealer time.
- **Templates:** `agent/templates.py`: the holding replies.
- **Pipeline:** `agent/pipeline.py`: the Hold and Staff check steps.
- **APIs:**
  - `api/dev.py`: dealer timezone and hours in `/dev/dealers`, and the kind on follow-ups;
  - `api/leads.py`: `pending_staff_check` and `staff_alert` in the lead profile.
- **Observability:** `observability/rollout.py`, `observability/metrics.py` (`staff_checks` counted separately).
- **Dev tools:**
  - `devtools/simulate.py`: dev dealers A (New York), B (Chicago) and C (Los Angeles) get store details and opening hours in the platform form's format.
  - `devtools/scenarios.py`:
    - `advance_clock` can jump to a dealer's local time ("Tue 10:00");
    - `expect_turn` takes `trigger`;
    - `expect_followup` / `expect_no_followup` take `kind`;
    - new `expect_lead` step.
- **Debug UI:**
  - `SchedulerTab.tsx`: dealer's local time, staff-check cards, no "undelivered" button on them;
  - `PipelineGraph.tsx`, `Timeline.tsx`: the new triggers, with PKT times;
  - `App.tsx`: replay header labels.
- **Tests changed on purpose:**
  - pause and STOP now expect a held turn with the reason;
  - the follow-up tests start at a fixed Tuesday 10:00 New York time, so the contact window doesn't make them depend on when they run;
  - the rollout check's renamed rule.
- **Scenarios changed on purpose:** `s2_pause_resume`, `s4_stop_opt_out` assert the held turn.

**Bugs found and fixed while verifying:**
- **Duplicate messages in the Debug UI conversation.** A fired channel switch or staff check sends under a different id from its trace, so the conversation view also listed its reply as an unsent "draft". This was already true of Plan 1's channel switch. A draft is now shown only for turns that attempted no send. Regression tests added.
- **Wrong replay header label.** It said "customer reply" for any turn that wasn't a new lead (including Plan 1's follow-ups). It now uses the trigger's label.
- **Times shown as raw UTC.** Scheduled times in the Schedule step's reasoning were raw UTC ISO strings; they now read in dealer time ("Tue 10:30 EDT").

## Phase 3: Rolling summary

**What changed for the AI:** long conversations keep their beginning.

- **Queued after the send:** a turn whose working memory has dropped messages the summary doesn't cover yet queues `update_summary`, only after its reply went out.
- **The job:**
  - it folds just those messages into `ai_lead_state.summary` with the cheap model (at most 1,500 characters);
  - later turns carry the summary in the context pack;
  - it's incremental: only messages newer than what it already covers and older than working memory.
- **Never slows a reply:**
  - it has its own lock, so a turn never waits for it;
  - a second run for the same lead just skips;
  - it's not in the turn's AI-call budget, and its cost is in the metrics.
- **Safety:** the prompt says who said what, never adds prices or promises, and treats old messages as data. An injected instruction stays attributed to the customer.
- **Trace:** each run is its own turn-log entry (trigger `summary`, the new "Summarize older turns" step in the diagram). The Context pack view shows the summary and how many messages it covers.

**Live check:** `p3_long_thread` (about 40 messages). "It's for my daughter" left working memory and was folded in by three incremental runs (5, then 4, then 3 messages). It was in the summary, and not in working memory, when the last turn ran.

**New files:**
- `agent/summary.py`
- `tests/unit/test_summary.py` (13 tests)
- `evals/test_summary.py` (3 cases: facts kept, open question kept, injection attributed)
- `scenarios/p3_long_thread.yaml`

**Changed:**
- `agent/llm.py`: `ConversationSummary`, prompt and agent.
- `agent/offline_model.py`: offline summarizer, which keeps the customer's words in quotes and drops our lines first.
- `agent/context_pack.py`: summary layer and budget flags.
- `agent/nodes/load_context.py`.
- `agent/turn.py`: queues the summary. `TurnDeps.enqueue`.
- `worker/jobs.py`, `worker/main.py`: the `update_summary` job, and the worker's enqueue.
- `agent/pipeline.py`, `observability/metrics.py`.
- `devtools/scenarios.py`: the `chat` step, summary checks, and summary runs not counted as turns.
- Debug UI: `StepViews.tsx`, `PipelineGraph.tsx`, `Timeline.tsx`.

## Phase 4: Understanding the customer

**What changed for the AI:** Extract reads each message in the conversation.

- **Short replies:** "used", "yes", "2019", "about 60k" answer the slot our last message asked for. The quote is still the customer's own words; a hedged number is saved as needs-confirming.
- **Labelled questions:** answerable, restricted (price, payment, financing, trade-in value, stock), off topic, clarify ("what do you mean", even without "?"), about me. Open questions keep their label.
- **Sentiment split in two:**
  - `upset` with a confidence: only 0.8 or more hands off;
  - `annoyed_at_bot` ("you keep asking the same thing"), which never hands off.
  - Decide's reasoning says when someone was upset but not clearly enough.

**New files:**
- `tests/unit/test_understanding.py` (34 tests)
- 14 new cases in `evals/datasets/extraction_cases.jsonl`, scored by a new Understanding metric (labels, handoff signal, frustration) in `evals/test_extraction.py`
- `scenarios/p4_short_replies.yaml`

**Changed:**
- `agent/llm.py`: `CustomerQuestion`, `ExtractionResult`, prompt rules.
- `agent/offline_model.py`: labels, sentiment, short replies. A bare number answering our number question no longer also lands as a budget.
- `agent/conversation.py`: labels on open questions.
- `slots/policy.py`: `UPSET_HANDOFF_CONFIDENCE`.
- `agent/nodes/extract.py`, `decide.py`, `graph.py`, `turn.py`.
- Debug UI: labels in the Context pack view.

## Phase 5: Conversational Decide

**What changed for the customer:** answer first, then ask, and never loop.

- **Nine rules:** stop, handoff, clarify, answer, confirm, ask, qualified, partly qualified, acknowledge (architecture §8.3).
- **One question per message.**
  - An answer carries at most one follow-up: the confirmation if one is waiting, otherwise one ask.
  - The least-asked detail first; never the one just asked; parked after 2 asks, back after 3 other replies.
  - Asked out (every missing detail asked twice) → partly qualified: status `partly_qualified`, lead to the team, nothing more asked.
- **A frustrated customer** gets a short apology and no question.
- **A lead already qualified** isn't told "that's everything" again on every message.
- **Every question answered:**
  - Compose returns `answered_questions`;
  - the guard rewrites once if a question was skipped;
  - the conversation state closes only the questions that were answered.
- Restricted questions become "the team will confirm", recorded as promises.

**Live checks:**
- `p5_answer_then_ask`: the rigid loop from manual testing. "so far what do u know about me?" is answered from the profile, then exactly one new question (not the one just asked).
- `p5_no_repeat_ask`: a customer who never answers. Never the same thing twice in a row, then partly qualified, then no questions.
- `p5_annoyed_customer`: "You keep asking the same thing!" gets no handoff and no question, just an apology.

**New files:**
- `tests/unit/test_decide_conversation.py` (21 tests)
- `scenarios/p5_answer_then_ask.yaml`, `p5_no_repeat_ask.yaml`, `p5_annoyed_customer.yaml`

**Changed:**
- `slots/policy.py` (rewritten).
- `agent/pipeline.py`: the rules.
- `agent/nodes/decide.py`: conversation state and lead status in.
- `agent/nodes/compose.py`, `agent/llm.py`: per-action rules, `answered_questions`.
- `agent/nodes/guard.py`: the coverage check.
- `agent/conversation.py`: close answered questions; clarify keeps the last ask.
- `agent/turn.py`: `partly_qualified` status.
- `agent/offline_model.py`: replies for every action.
- `devtools/scenarios.py`: `question_marks`, `expect_no_repeat_asks`.
- Debug UI: statuses and outcome colours.
- **Tests changed on purpose:**
  - one ask per message (`test_slots`, `test_turn_pipeline`);
  - the conversation-state helper takes `answered`;
  - the price-question reply eval now expects `answer`.

**Bugs found and fixed while verifying:**
- **A customer who never answers was asked forever:** "partly qualified" used the cooldown, so details kept coming back. It's now defined as "asked twice".
- **Later details were starved:** asking by priority re-asked the first ones a 3rd and 4th time before the last was asked once. It's now least-asked first.
- **Unknown status in the Debug UI:** it showed "new" for a partly qualified lead.

## Phase 6: Answer sources

**What changed for the customer:** questions about the dealership get real answers.

- **Dealer details:** the dealer's own address, phone, website and opening hours come from its platform record (`integrations/dealer_profile.py` `public_info()`) and go into the context pack.
  - A missing detail gets "the team will confirm" (and a promise).
  - Default hours (used only for the handoff timeout) are never told to a customer.
  - Staff contacts never appear.
- **"What do you know about me?"** is answered from `about_customer`: confirmed values in plain words. Values still to confirm are said as such.
- **Plain values:** a new `slots/display.py` turns values into plain words ("$35,000", "60,000 miles", "this week", dates). The same wording is used for confirmations and in the Slots panel.
- **The guard** accepts numbers from the dealer's details and from the customer's values in plain words. Invented numbers are still blocked (tested).

**Live check:** `p6_dealer_hours`. "When are you open on Saturday?" gets "On Saturday we're open 9:00 AM to 5:00 PM." and "Where are you located?" gets the address, both on the first draft.

**New files:**
- `slots/display.py`
- `tests/unit/test_answer_sources.py` (12 tests)
- `scenarios/p6_dealer_hours.yaml`

**Changed:**
- `integrations/dealer_profile.py`: address, phone, website, hours text, `public_info()`.
- `agent/context_pack.py`: the dealer's `info`, `about_customer`, and `display` per slot.
- `agent/nodes/load_context.py`, `compose.py`, `guard.py`.
- `agent/llm.py`: answer rules per label.
- `agent/offline_model.py`: answers from dealer details.
- `slots/policy.py`: confirmations carry `display` and `kind`.
- `slots/profile.py`: `display` in the profile API.

## Phase 7: Plain, explainable replies

**What changed for the customer:** every message is plain English, and "what do you mean?" is really explained.

- **Customer wording:** every detail we ask for has a `customer_question` and an `explanation` with an example (`slots/schema.py` `CUSTOMER_WORDING`). Compose uses them instead of internal hints. No digits, no internal terms, all at grade 8 or below.
- **Style guide** in the Compose prompt: short sentences, everyday words, one question, a short reason when needed, good and bad examples.
- **Clarify** gives the detail's explanation and then asks the same question again; the answer fills that same detail.
- **Internal terms** (field codes, snake_case, "slot", "lead type") are caught by the guard (one rewrite) and by an automatic check after every scenario.
- **Reading level:** a "Plain reply" metric (Flesch-Kincaid grade 8 or below, no internal terms) on every reply case in the eval gate.

**Live check:** `p7_clarify`.
- The AI asks the trade-in's condition; the customer asks "what do you mean?".
- The reply explains what excellent, good, fair and poor mean, then asks the same question.
- "good" then fills it.

**New files:**
- `guardrails/plain_language.py`
- `tests/unit/test_plain_replies.py` (28 tests)
- `scenarios/p7_clarify.yaml`

**Changed:**
- `slots/schema.py`, `slots/requirements.py`, `slots/policy.py` (asks and clarify carry the wording).
- `agent/nodes/compose.py`, `agent/llm.py` (style guide).
- `agent/offline_model.py`, `agent/nodes/guard.py`.
- `devtools/scenarios.py` (the plain-replies check).
- `evals/test_replies.py`.

**A wording problem the tests caught:** the payoff question was two questions ("Do you still owe money on it? If so, about how much?"). It's now one.

## Phase 8: Dates and time

**What changed for the customer:** "tomorrow" means a real day.

- **Resolved in code:** a small resolver (`slots/dates.py`) turns the customer's words into a date and time, using the dealer's local now (so the Debug UI clock moves it too). It covers:
  - today, tomorrow, the day after tomorrow;
  - weekdays, and "next Friday";
  - next week, this weekend;
  - "in two weeks";
  - "the 15th", "Oct 3", "10/3";
  - end of the month;
  - times ("at 3", "5:30pm").
- **Stored:** the new `interest.needed_by` holds the date, with the customer's words as its quote, and sets the timeline (tomorrow means this week).
- **Unclear dates are confirmed, not guessed:**
  - "Next Friday" becomes "Just to check, is that Friday, October 2?".
  - "Tomorrow" said after midnight is confirmed too.
  - The timeline waits for the confirmation.
- **Past dates are rejected** with the reason ("'yesterday' is in the past (Monday, September 21)").
- **Said back plainly:** "Got it - Wednesday, September 23 (tomorrow)." The guard accepts that date's numbers.

**Live check:** `p8_tomorrow`, with the dealer's clock on a Tuesday morning.
- "I need it by tomorrow" is saved as Wednesday, with a this-week timeline, and said back.
- "Actually next Friday" is confirmed with the actual date.
- "yes" saves it.

**New files:**
- `slots/dates.py`
- `tests/unit/test_dates.py` (88 tests: phrases across New York, Chicago and Los Angeles, midnight, one moment in two timezones, past dates, the timeline, full turns)
- 3 date cases in the extraction eval
- `scenarios/p8_tomorrow.yaml`

**Changed:**
- `slots/schema.py`: `interest.needed_by`, `volunteered` / `extractable`.
- `slots/validators.py`: a time the customer gave is kept; platform timestamps stay dates.
- `agent/nodes/validate.py`: dates resolved, and the timeline from confirmed dates.
- `agent/nodes/extract.py`, `agent/llm.py`: dates as the customer's words.
- `agent/nodes/compose.py`: `just_captured`.
- `agent/offline_model.py`.
- Debug UI: `SlotsPanel.tsx`, `types.ts` (plain values).

**Bugs found and fixed while verifying:**
- **Wrong thing confirmed:** "next Friday" got "your timeline is this month, right?" instead of the date, because the unclear date had also set a to-confirm timeline. The timeline now waits for the date to be confirmed.
- **Date taken from quoted words:** "Just reply 'the car is ready today'" was taken as the customer's date. Quoted text is skipped (apostrophes aren't quotes).
- **Date taken from an hours question:** "What are your hours on Saturday?" gave a date. Dates in sentences about opening hours are skipped, and the next date in the message is used.
- **Platform timestamps changed shape:** they would have kept a time of day. Only resolved dates keep times.

## Phase 9: Debug UI updates

**What changed for a tester:** any reply can be explained from the Debug UI alone.

- **Models banner** (header): "Offline model (rules, not AI)", or "AI: gpt-4o-mini / gpt-4o". Hover it for what that means. It comes from `/dev/ping`, which now reports the running models.
- **Test tags** (`#retry`, `#fallback`, `#reject`) appear only with the offline model, each with a one-line explanation. With real models they're hidden. Checked both ways in the browser.
- **Conversation panel** beside the Slots panel:
  - each asked detail, how often, marked "just asked" or "asked out";
  - open questions with their labels;
  - promises;
  - what the last reply was about;
  - the rolling summary.
  Served by `/dev/leads/{id}/slots`.
- **Decide inspector:**
  - the questions it answers first;
  - the one follow-up (a question or a check);
  - what a clarification explains;
  - "The customer is frustrated…";
  - every "Not asking X: why".
- **Context pack view** (Load context step): adds the dealer details the AI may use (and what the dealer never entered), and what it may say it knows about the customer.

**New files:**
- `debug-ui/src/components/ConversationPanel.tsx`
- `debug-ui/src/components/ModelsBanner.tsx`

**Changed:**
- `api/dev.py`: models in `/dev/ping`; conversation state and summary on the slots endpoint.
- `App.tsx`, `Simulator.tsx`, `StepViews.tsx`, `NodeInspector.tsx`, `types.ts`, `api.ts`.
- `tests/unit/test_dev_routes.py`: 2 tests.

## Phase 10: Conversation evals and the real-model run

- **Conversation evals** (`evals/test_conversations.py`, `datasets/conversation_cases.jsonl`): 9 whole conversations run through the real event handlers, with the clock on a Tuesday morning in New York. They cover:
  - a question answered mid-flow;
  - dealer hours;
  - never the same thing twice in a row;
  - short replies filling the right detail, in two cases;
  - "what do you mean?";
  - frustration;
  - "tomorrow";
  - never silent.
  - Every reply is also checked for reading level and internal terms.
- **The eval harness** (`evals/harness.py`) now goes through the handlers like the worker, so earlier messages are in working memory. It can plant a rolling summary or dealer details.
- **Promptfoo:** 3 new injection cases, through the new inputs: an earlier message, the summary, and the dealer's own store name.
- **Report** (`make ai-evals-report`, `evals/report.py`): every reply and conversation case, with:
  - pass rates;
  - template fallbacks;
  - how often the guard accepted the first draft;
  - reply time and cost per reply.
  It checks the models answer before running anything.
- **Real-model run: attempted, blocked by the key.**
  - The key in `agentic-upsell/.env` is refused by OpenAI with **HTTP 401 `invalid_organization`** ("You do not have access to the organization tied to the API key"), even on a plain `GET /v1/models`, and nothing in the environment overrides the organization.
  - With every model call failing, all 36 turns fell back to the safe template within about 300 ms. Every safety and injection case still passed. So a broken key degrades safely, and the go-live check flags it through the template-fallback rate. But the AI behaviours themselves couldn't be judged.
  - **To finish:** put a working key in `agentic-upsell/.env`, then run `MODEL_EXTRACT=openai:gpt-4o-mini MODEL_COMPOSE=openai:gpt-4o make ai-evals-report`, `make ai-evals` with the same variables, and a pass through the manual test script with the real models (the Debug UI banner confirms which models are running).
  - Expect to tune prompts from the results, and check that Extract (3 s limit) and Compose (5 s per attempt) are fast enough with the larger context.
- **Manual test script** (`docs/runbooks/manual_test_script.md`): 9 conversations for testers. They cover:
  - the rigid loop;
  - "tomorrow";
  - plain wording and "what do you mean?";
  - never silent;
  - frustration;
  - dodging;
  - dealer questions;
  - price and stock;
  - long threads.
  Each has what a good reply looks like, bad signs, and where in the Debug UI to check why.
  - Every conversation in it matches a scenario that passes on the offline model.
  - The timing of the "never silent" steps was checked live before writing them down. The first draft had the wrong number of clock moves: the staff check's message also resets the 2-hour holding-reply limit.
- **Architecture:** the diagram in architecture.md §1 now shows the context pack, the Hold path, the staff check, the contact window and the summary job.

## Notes and caveats

- **Contact window uses the dealer's timezone** as a stand-in for the customer's, which isn't known. It's an engineering rule chosen to stay inside the TCPA and state quiet hours. Have counsel confirm it.
- **The staff alert is recorded, not sent.** It lives on the lead, in the profile API and in the go-live check. The platform has no notify endpoint yet; sending alerts to staff (email/SMS/dashboard) is a platform change still to decide.
- **Real-model timing not measured yet.** Extract now reads the conversation too (a few hundred to ~3,000 more input tokens). With the offline model nothing changed. Measure Extract's time against its 3 s limit once a real key is set (`make ai-evals` with real models).
- **Debug UI and frontend changes:** the Vite dev server in Docker doesn't notice file changes on this Windows mount. After changing Debug UI code, restart it: `docker compose --profile dev restart ai-debug-ui`.
- **One transient platform start-up failure** was seen: the platform worker's MongoDB connection timed out once while `make dev-full` started. A second start was clean, and every check passed. If it recurs, re-run `make dev-full`.
- **Customer timezone:** dates use the dealer's timezone, as the contact window does. A customer in another timezone saying "tomorrow" late at night could be a day off; unclear cases are confirmed.
- **The offline model is a rule-based stand-in:**
  - its summary drops the oldest lines when over the length limit;
  - its answers to "answerable" questions are "the team will confirm";
  - its labels are keyword rules.
  - The real models do these properly, and the evals check them. Run `make ai-evals` with the real models before any dealer goes live.
- **Once, the AI containers were found in `stub` platform mode** before an end-to-end run, and I didn't find the cause. `make dev-full` sets them to `live`; if `make ai-e2e` times out waiting for the first reply, re-run `make dev-full`.
- **Nothing is committed.**
