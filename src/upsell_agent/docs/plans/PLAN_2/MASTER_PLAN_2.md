# Master Plan 2: Context and Conversation

> **What this is:** the next plan after [`../PLAN_1/MASTER_PLAN_1.md`](../PLAN_1/MASTER_PLAN_1.md).
> Plan 1 built a safe, working pipeline. Manual testing in the Debug UI showed
> that it talks like a form, not a person:
>
> - it repeats the same question;
> - it ignores what the customer asks;
> - it doesn't know what "tomorrow" is;
> - it can go silent.
>
> This plan makes **context** the foundation of every turn, then builds
> conversational behaviour on top of it.
>
> **Design:** [`../../architecture/architecture.md`](../../architecture/architecture.md).
> **Progress:** written to `PLAN_2/progress_2.md` as each phase is finished.

---

## Why: what manual testing found

| # | What the tester saw | Cause in the code today |
|---|---|---|
| 1 | "What's your model?" → "What do you know about me?" → "What's your model?" | Decide ([slots/policy.py](../../../slots/policy.py)) asks while any required slot is empty. Compose is told "do exactly the action" ([agent/llm.py](../../../agent/llm.py)). Nothing counts how often a slot was asked. |
| 2 | "Tomorrow" isn't understood | No prompt has today's date or the dealer's timezone. [slots/validators.py](../../../slots/validators.py) knows "today" but not "tomorrow", "Friday" or "next Tuesday". |
| 3 | Replies are unclear, and "what do you mean?" isn't answered | The prompt only asks for "one short friendly sentence". Asks come from internal slot hints. There is no clarify path. |
| 4 | Sometimes no reply at all | `SILENT_STATUSES` ([events/handlers.py](../../../events/handlers.py)): once a lead is in handoff, every later message is saved and never answered. Handoff is easy to trigger (`negative_sentiment`, or the guard failing twice). Batched messages can also look ignored. |
| 5 | The #retry / #fallback / #reject buttons are confusing | They are offline-model test tags. With a real model they do nothing. |

### The gaps in context underneath 1, 3 and 4

1. **Extract works without the conversation.** It gets only the current message and the slot names asked last turn ([agent/nodes/extract.py](../../../agent/nodes/extract.py)). Replies like "yes", "the second one", "same as before" or "what do you know about me?" are read without the question they answer.
2. **Decide doesn't track the conversation.** It sees only the slot profile. It can't know what was already asked, how many times, or what the customer asked that is still unanswered.
3. **Fixed windows and no summary.** Compose sees 10 messages ([agent/nodes/compose.py](../../../agent/nodes/compose.py)), Load context loads 20, and past that the model sees nothing. A long email thread loses its beginning.
4. **No record of open items:** the customer's unanswered questions, or promises we made ("the team will confirm the price").
5. **Each step builds its own context.** Extract and Compose get different views, so they can disagree about the same turn.

Everything is already **saved**: every message in `ai_messages`, and every slot with the customer's own words. What's missing is what each turn **reads** and what it **remembers about the conversation itself**.

---

## Principles

1. **Code keeps the hard rules; the model runs the conversation.**
   - Opt-out, handoff, no prices or approvals, and the guard stay in code, and they are deterministic.
   - Slot filling becomes a **goal**, not a script.
2. **One context, built once per turn.** A single context builder assembles one context pack. Every AI step reads the same pack, and the Debug UI shows it.
3. **Layered memory:**
   - working memory: recent turns word for word;
   - rolling summary: older turns;
   - structured facts: slots;
   - conversation state: asks, open questions, promises;
   - long-term: Customer 360.
4. **Never silent.** Every inbound message gets a reply, a holding reply, or a visible reason in the trace why not (opted out, paused by staff).
5. **Deterministic where it can be.** Dates are resolved in code. Counts and cooldowns are kept in code. The model is never trusted with arithmetic.
6. **Keep the budgets.** Replies stay within 8 s (first reply) and 20 s (others), and at most 4 AI calls per turn. Anything that's not needed for the reply (the summary) runs after the send.
7. **Every phase ships its own tests and scenarios.** The offline model is updated in step, so tests and scenarios keep running without a key.

---

## Phase overview

| # | Phase | You can see it when |
|---|---|---|
| 0 | Decisions | The answers are written into architecture.md |
| 1 | **Context builder and conversation state** (foundation) | The Debug UI's Load context node shows one context pack. Extract and Compose both read it. |
| 2 | Never silent | A lead in handoff still gets a holding reply, and a stale handoff comes back or alerts again |
| 3 | Rolling summary | A 40-message thread's opening facts are still in the context pack |
| 4 | Understanding the customer | "Yes" is read as the answer to the last question. Every question is labelled. |
| 5 | Conversational Decide | "What do you know about me?" gets an answer, and the same slot is never asked twice in a row |
| 6 | Answer sources (read-only tools) | Dealer hours and "what you know about me" are answered from real data, and the guard accepts them |
| 7 | Plain, explainable replies | "What do you mean?" gets a simpler re-explanation with an example |
| 8 | Dates and time | "Tomorrow" is saved as the correct date in the dealer's timezone |
| 9 | Debug UI updates | Context tab, conversation state panel, test tags only with the offline model |
| 10 | Conversation evals and real-model run | Multi-turn eval gate passes on the real models |

Phase 1 comes first because every later phase reads what it builds.
Phase 2 is early because silence is the worst thing a customer can experience,
and its main fix doesn't depend on the rest.

**Rule for every phase:** its unit tests are written and passing, and its
scenario files pass on the Debug UI Scenarios tab, before the next phase
starts. Plan 1's tests, scenarios, e2e and burst test must still pass.

---

## Phase 0: Decisions (decided)

The full wording is in architecture.md §15, decisions 7–13.

1. **Inventory:** left out of this plan. Stock questions are "restricted" ("the team will check what's in stock for you"). Planned separately in [`../PLAN_3/MASTER_PLAN_3.md`](../PLAN_3/MASTER_PLAN_3.md).
2. **Dealer info:** read from the dealer's platform record (`users`, type dealer, `dealer_account_information`), which the dealer fills in at registration and in the admin dealer form.
   - Customer-facing fields only: store name, address, city, state, postal code, website, texting number, alternative number, opening hours (`weekly_availability`), timezone.
   - Staff contact details are never given out.
   - Empty fields → "the team will confirm".
3. **Dealer timezone:** `dealer_account_information.time_zone`, falling back to `America/New_York`. The Debug UI **displays** times in Pakistan time (`Asia/Karachi`) for the testing team, plus the dealer's local time where business hours matter. No rule uses the tester's timezone.
4. **Handoff timeout:** 30 business minutes. Then one more holding reply and a staff alert, and the lead stays with staff. Once per handoff.
5. **Business hours:** the dealer's `weekly_availability`, otherwise Monday–Saturday 9:00–18:00 dealer time.
   - **US law:** a message the AI starts on its own goes out by SMS only between 8:00 and 20:00 local time. Otherwise it waits for 8:00.
   - That covers the 24h channel switch and the handoff-timeout holding reply.
   - 8:00–20:00 fits both the federal TCPA's 8:00–21:00 and the stricter state windows.
   - Replies to a message the customer just sent go out right away. Email has no time-of-day rule.
   - Counsel to confirm before the first live dealer.
6. **Ask limit:** at most 2 asks per slot per lead, never twice in a row, then parked. A parked slot can be asked again after 3 other turns; optional slots never are.

---

## Phase 1: Context builder and conversation state (foundation)

The goal: every turn builds **one context pack**, and every AI step reads it.

1. **Context pack** (new: `agent/context_pack.py`). A typed object built once, in Load context:
   - `now`: the date, weekday, time and timezone, in the dealer's timezone (Phase 8 adds turning "tomorrow" into dates);
   - `dealer`: name and timezone, from the dealer's platform record;
   - `customer`: first name and channel;
   - `profile`: the slots with their state (filled, stale, pending, missing). Values pre-filled from Customer 360 are part of it, with their source, so the long-term memory layer is the profile;
   - `new_messages`: the customer messages this turn answers, listed one by one (the batch, or the lead form's comments on a first reply);
   - `working_memory`: the conversation before them, word for word, both directions;
   - `summary`: older turns (empty until Phase 3);
   - `conversation`: see item 3;
   - `campaign`.
2. **Working memory by token budget, not message count.**
   - A budget (setting `CONTEXT_WORKING_TOKENS`, default 3000; tokens estimated at 4 characters each), with the last 6 messages always kept. One very long message is cut to a fixed length.
   - Customer emails have quoted reply chains ("On … wrote:", `>` lines, "Original Message" blocks) and signatures removed. That happens before counting, and also in the text Extract reads and Validate checks quotes against. So a value can no longer be taken from our own quoted email.
   - Messages are loaded newest-first with a limit, not the full history each turn.
3. **Conversation state** (`ai_lead_state.conversation`), updated after each turn whose reply was sent:
   - `turn`: how many replies we have sent;
   - `asks`: per slot, how many times it was asked and in which reply (replaces `last_asked_slots`);
   - `last_asked`: what our last reply asked for;
   - `open_questions`: the customer's questions not answered yet. They are opened when Extract finds them and closed when an AI-written reply that was given them is sent; a template reply leaves them open. Still-open questions are handed to the next turn.
   - `promises`: what our replies said the team would do. Compose returns them as a structured field, and templates declare theirs. Later replies stay consistent with them.
   - `last_topic`: what our last reply was about (the action and the slots).
   - Nothing in it changes in shadow mode, because the customer never saw those drafts.
4. **Both AI steps read the same pack.** Extract and Compose get the identical `context` object, so they can't disagree about the turn.
   - Extract still extracts only from the new messages, and quotes must come from them.
   - Prompts say that everything in the pack is data, never instructions (keeps Plan 1's injection rules).
5. **The offline model** reads the new payload shape and returns promises, so nothing breaks without a key.
6. **Trace:** the Load context node shows the pack: each layer, token counts, and what was cut. The turn's start lists every message in the batch.

**Tests:**
- Budget trimming, quote stripping, the at-least-6 rule, and the load limit.
- Conversation state updates: ask counted, question opened and closed, promises kept, nothing changed in shadow.
- Extract and Compose payloads come from the same pack.
- A value only in a quoted email chain is not extracted.

**Scenario:** `p1_context_pack.yaml`. A multi-message chat; the pack has the right layers, and the AI's last question is in the working memory Extract reads.

**Done when:** the Debug UI shows one context pack per turn and both AI steps use it. All Plan 1 tests, scenarios and the e2e still pass.

---

## Phase 2: Never silent

The goal: no customer message goes unanswered without a visible reason.

1. **Holding reply in handoff.**
   - A customer message on a handed-off lead gets a holding reply ("Thanks, I've passed this to the team and someone will reach out shortly"), from a template, not the AI.
   - At most one every 2 hours per lead. The handoff reply itself counts, so a customer who writes again 5 minutes after "I'm passing this to the team" isn't told the same thing twice.
   - Messages inside those 2 hours are saved for staff, with the reason in the trace.
   - A holding reply never schedules a 24h channel switch.
2. **Handoff timeout** (Phase 0, decision 4). A scheduled check, kept in `scheduled_followups` as its own kind (`handoff_check`). It reuses the Plan 1 scheduler: atomic claim, stuck-claim reset, re-checks under the lead lock.
   - It is due 30 business minutes after the handoff.
   - If the lead is still handed off (the same handoff), the dealer is still live and staff haven't taken it over, it sends one more holding reply and records a staff alert on the lead.
   - Staff pausing or resuming the lead (Plan 1 Stage 11) cancels it. A customer message doesn't.
3. **Contact window** (Phase 0, decision 5). A proactive SMS (the 24h channel switch or the timeout's holding reply) is only sent between 8:00 and 20:00 dealer time. Outside it, the message is scheduled for the next 8:00: when it's planned, and again when it fires.
4. **Paused and opted out stay silent** (the right behaviour), but the trace and the turn log always say **why** nothing was sent. So do STOP and START keywords.
5. **Batching made visible.** When several messages are answered in one turn, the trace lists every message included (from Phase 1). The reply must cover each open question from all of them; Phase 5 enforces this.
6. **Rollout check:** "customer messages with no reply and no recorded reason". Every inbound message must end up with a reply turn or a recorded reason; the count must be 0. Staff alerts are listed too.
7. **Dev dealers** get realistic dealer records (store details and opening hours), so business hours and the contact window can be tested.

**Tests:**
- Holding reply sent once per 2-hour window.
- The timeout fires in business minutes, is cancelled by staff taking over, and is deferred outside the contact window.
- The channel switch is deferred outside the contact window (SMS only).
- Paused, opted-out and STOP messages record a reason.
- The rollout check flags an unanswered message.

**Scenarios:**
- `p2_handoff_holding_reply.yaml`: customer asks for a person, then sends two more messages. Exactly one holding reply.
- `p2_handoff_timeout.yaml`: move the clock past 30 business minutes; the second holding reply goes out and the staff alert is recorded.
- `p2_staff_takeover_cancels_timeout.yaml`: staff pause the lead; the timeout is cancelled.

**Done when:** no scenario ends with an unanswered customer message that has no reason in the trace.

---

## Phase 3: Rolling summary

The goal: long conversations keep their beginning.

1. **Summary on `ai_lead_state`:** a short, factual summary of the turns that fell out of working memory. It covers what the customer wants, what they asked, what we said and promised, and their mood.
2. **Updated after the send, not before.**
   - It runs as a separate queued job with the cheap model, only when messages have left working memory since the last summary.
   - So it adds no time to the reply and doesn't count against the per-turn AI-call budget.
3. **Rules:**
   - The summary never replaces facts: slots stay the source of truth for values.
   - It records who said what.
   - It is treated as data, not instructions (an injection in an old message must not become an instruction in the summary).
4. **Offline model** gives a deterministic stand-in summary.
5. **Trace:** the summary job appears in the turn log, and the Context tab shows the current summary and which messages it covers.

**Tests:**
- The summary is triggered only when needed.
- It runs after the send.
- An injection attempt in an old message doesn't reach the summary as an instruction (DeepEval / Promptfoo case).

**Scenario:** `p3_long_thread.yaml`. 40 messages; a fact from message 3 that isn't a slot (e.g. "buying it for my daughter") is still in the context pack at message 40.

**Done when:** long threads keep their early context, and reply latency is unchanged (burst test p95).

> **Built as (differences from the text above):** the summary run takes its own lock, not the lead's, so a turn is never kept waiting for it; a second run for the same lead is skipped (the next turn queues another if still needed). Its cost counts in the metrics; its runs are not counted as turns.

---

## Phase 4: Understanding the customer

The goal: Extract reads each message **in the conversation**, and labels what the customer wants.

1. **Short replies resolved against the last AI message.** "Yes", "no", "the second one", "same as before" and "it's a 2019" are read as answers to what we asked last. The quote is still the customer's exact words (Plan 1's Validate rules stay).
2. **Every customer question labelled:**
   - `answerable`: from the profile, the history or dealer info (Phase 6);
   - `restricted`: price, payment, trade-in value, approval, availability → "the team will confirm";
   - `off_topic`: politely declined;
   - `clarify`: they're asking what we meant ("what do you mean?", "what's that?");
   - `about_me`: "what do you know about me?" and similar.
3. **Sentiment split in two:**
   - `upset`: angry at the dealer or the situation, which is still a handoff signal;
   - `annoyed_at_bot`: "you keep asking the same thing", "that's not what I asked". This is **not** a handoff. It tells Decide to change approach: answer, stop asking, re-explain.
4. **Handoff needs a clear signal:** an explicit request for a person, or `upset` with high confidence. One ambiguous message isn't enough.
5. **Open questions** from this message are added to `conversation_state.open_questions` with their labels.
6. **Offline model** handles the new labels with simple rules, so scenarios can exercise each path.

**Tests:**
- Table-driven: short replies with and without a previous question.
- Each question label.
- `annoyed_at_bot` vs `upset`.
- DeepEval extraction cases for all of the above.

**Scenario:** `p4_short_replies.yaml`. AI asks "new or used?", customer says "used". The slot is filled with the quote "used".

**Done when:** short answers fill the right slot, and frustration with the bot no longer causes a handoff.

> **Built as:** "clearly upset" means upset with confidence 0.8 or more. The labels, upset (with its confidence) and `annoyed_at_bot` replace the old `customer_questions` and `negative_sentiment` fields everywhere.

---

## Phase 5: Conversational Decide

The goal: answer first, then ask, and never loop.

1. **New Decide order.** Still a pure function, still traced rule by rule:
   1. `stop`: opted out
   2. `handoff`: an explicit request for a person, or clearly upset
   3. `clarify`: the customer asked what we meant → re-explain the last question (Phase 7)
   4. `answer`: there are open questions → answer them (restricted ones get "the team will confirm")
   5. `confirm`: a value is waiting for confirmation
   6. `ask`: required slots missing, respecting the ask limits
   7. `qualified`: nothing missing
2. **Answering and asking together.** `answer` and `confirm` can carry **at most one** ask with them ("answer, then ask"), so the conversation keeps moving without ignoring the customer.
   - After `annoyed_at_bot`, the reply only answers or re-explains, with no ask.
3. **Ask limits** from `conversation_state.asks`, as decided in Phase 0:
   - never the same slot twice in a row;
   - at most 2 asks per slot per lead, then parked;
   - one ask per message (was 2), because two questions in one text read like a form.
4. **All asked out.** If every missing slot is parked, the lead goes to the team as "partly qualified" with what we have. The AI keeps answering questions but stops asking.
5. **Closing open questions.** After a sent reply, the questions it covered are marked answered. The guard checks that a reply meant to answer questions actually addresses them. If not, it rewrites (the existing retry path).
6. **Promises recorded.** When a reply says the team will confirm something, it is added to `promises`, so the next turns don't contradict it.
7. **Compose instructions** change from "do exactly the action" to: answer the open questions first, then at most the one ask given, in the conversation's context.

**Tests:**
- Every rule and its order, table-driven.
- The ask limits.
- Partly qualified.
- Open questions closed after the send.
- The promise recorded.

**Scenarios:**
- `p5_answer_then_ask.yaml`: "what do you know about me?" mid-flow gets an answer, then one ask.
- `p5_no_repeat_ask.yaml`: the customer dodges the model question twice. It's never asked twice in a row, then parked.
- `p5_annoyed_customer.yaml`: "you keep asking the same thing". No handoff, no ask, a helpful answer.

**Done when:** the rigid-loop conversation from manual testing plays out naturally in the Simulator.

> **Built as (differences from the text above, and why):**
> - **Two more rules:** `acknowledge`, a reply without a question when nothing can be asked right now (e.g. the only thing missing was just asked, or the customer is frustrated with us); and `qualified` doesn't fire again on a lead that's already qualified, so it isn't told "that's everything" on every message.
> - **Partly qualified** means every missing detail has been asked **twice**, whatever the cooldown. With "all parked right now", a parked detail comes back after 3 replies, so with several details the lead never ended and a customer who never answered was asked forever.
> - **The least-asked detail comes first**, then priority. Asking by priority alone re-asked the first details a third and fourth time while later ones hadn't been asked at all.
> - **`confirm` carries no extra ask:** one question per message. `answer` carries at most one follow-up, which is the confirmation if one is waiting.
> - **Answer coverage is checked** through Compose's `answered_questions` field. The guard compares it with the questions Decide gave it, and the conversation state closes only the questions the reply says it answered.

---

## Phase 6: Answer sources (read-only tools)

The goal: the AI has real data to answer with, and never invents it.

1. **Profile summary:** answers "what do you know about me?" from confirmed slots and Customer 360 only, never from guesses. Pending values are phrased as "I think…, is that right?".
2. **Dealer info** (Phase 0, decision 2): name, hours, address, phone. If a field is missing, the answer is "the team will confirm".
3. **Inventory:** not in this plan unless Phase 0 says otherwise. Stock questions are `restricted`.
4. **Tools are read-only and loaded in code**, then put into the context pack (not model-called functions), so the reply stays within the time budget and every value is traceable.
5. **The guard learns the new sources.** Numbers from dealer info (hours, street number, phone) and from the profile summary count as known values, like campaign text in Plan 1. Invented numbers are still blocked.

**Tests:**
- Profile summary uses only confirmed values.
- Missing dealer info gives "the team will confirm".
- The guard accepts dealer-info numbers and still rejects invented ones.

**Scenario:** `p6_dealer_hours.yaml`. "When are you open?" is answered with the seeded hours, and the guard passes.

**Done when:** answerable questions get real answers and the guard failure rate doesn't go up (metrics).

> **Built as:**
> - **The dealer's default hours** (used for the handoff timeout when a dealer entered none) are never told to a customer: `hours` is then listed as missing.
> - **The phone number** is the store's number if entered, otherwise the dealer's texting number. Staff numbers never.
> - **Still-to-confirm values** in "what do you know about me?" are said as a statement ("I think …, but I still need to confirm that"), not a question, to keep one question per message.
> - **Confirmations** show the value in plain words ("60,000 miles", not 60000).

---

## Phase 7: Plain, explainable replies

The goal: every message is clear to a customer who has never heard dealership jargon.

1. **Style guide in the Compose prompt:**
   - plain English at roughly a grade 6–8 reading level;
   - one question per message;
   - a short reason when the question isn't obvious ("so we can estimate your trade-in, roughly how many miles?");
   - no internal terms;
   - a few example replies (good and bad).
2. **Customer wording per slot** in the slot schema ([slots/schema.py](../../../slots/schema.py)):
   - `customer_question`: how to ask it plainly;
   - `explanation`: one line on why we ask and what it means, with an example.
   - Compose uses these instead of the internal `ask_hint`.
3. **Clarify path** (Phase 5's `clarify` rule). Re-explain the last question in simpler words, with the slot's explanation and an example, without moving on to a new ask.
4. **Reading-level check** in the evals (a deterministic metric, like Plan 1's custom ones). Replies above the target level fail.

**Tests:** every required slot has a question and an explanation; clarify re-asks the same slot, never a new one; the reading-level metric.

**Scenario:** `p7_clarify.yaml`. AI asks about trade-in condition, customer says "what do you mean?". Simpler re-explanation, same slot.

**Done when:** no reply in the scenarios uses internal slot names or jargon, and the clarify scenario passes.

> **Built as:**
> - **Internal terms are also a guard check** (one rewrite), not only an eval. After every scenario, the runner checks every reply it produced for them.
> - **The customer wording contains no digits**, since the guard would treat those as invented numbers. Model names like RAV4 are fine.
> - **Reading level** is the Flesch-Kincaid grade (target 8 or below) in the eval gate's new "Plain reply" metric, and in a unit test over all the wording.

---

## Phase 8: Dates and time

The goal: "tomorrow", "Friday" and "next Tuesday at 3" become real dates in the dealer's timezone.

No MCP server. The date is local and predictable, and a network call would eat into the reply budget.

1. **`now` in the context pack:** date, weekday, time and the dealer's timezone, from `clock.now()`. The Debug UI's clock controls keep working.
2. **Resolved in code**, with a date library (e.g. `dateparser`, relative to `now` and the dealer's timezone), not by the model's arithmetic. Extract returns the customer's words. Code turns them into a date.
3. **Stored as both** the customer's words and the resolved date. The timeline slot's buckets (`now`, `this_week`, …) are worked out from the resolved date, so "tomorrow" also fills the timeline.
4. **Unclear dates are confirmed, not guessed.** "Next Friday" is saved as pending and confirmed with the actual date ("Just to check, is that Friday the 2nd?").
5. **Past dates** ("yesterday" for a visit) are rejected by Validate with a reason.
6. **Replies say dates plainly** ("tomorrow, Saturday the 27th"), and the guard allows dates that came from the resolver.

**Tests:**
- Table-driven phrases × timezones × clock times: today, tomorrow, weekday names, "next week", "in 2 weeks", "the 15th".
- Late night and around midnight: "tomorrow" at 23:30 dealer time.
- Past dates rejected.

**Scenario:** `p8_tomorrow.yaml`. With the clock set to a known date, "tomorrow" resolves to the right date and is confirmed in the reply.

**Done when:** the date tests pass across timezones, and the scenario shows the right date.

> **Built as:**
> - **No date library:** a small resolver in `slots/dates.py`, so every rule is visible and tested and nothing depends on the machine's locale.
> - **The customer's date** goes in a new `interest.needed_by` slot. It's taken from what they say but never asked for directly.
> - **"Next Friday"** is taken as next week's Friday and always confirmed.
> - **"Tomorrow" said between midnight and 4am** is confirmed.
> - **An unclear date sets the timeline only once confirmed**, so the customer is asked about the date, not about a timeline.
> - **Words in quotes** ("reply 'it's ready today'") and **dates in questions about opening hours** aren't taken as the customer's date.

---

## Phase 9: Debug UI updates

1. **Context tab (or Load context inspector):** the full context pack per turn, with each layer, its token count, and what was cut.
2. **Conversation state panel** next to the Slots panel: ask counts and parked slots, open questions and their labels, promises, the summary.
3. **Decide shows the new rules:** clarify and answer, the ask limits, and why a slot was skipped.
4. **Test tags only with the offline model.** #retry, #fallback and #reject appear only when `MODEL_EXTRACT` / `MODEL_COMPOSE` are `offline`, each with a one-line explanation:
   - `#retry`: the guard rejects the first draft;
   - `#fallback`: the template reply is sent;
   - `#reject`: Validate rejects a value.
   With real models, they're hidden.
5. **A banner shows which models are running** (offline or real), so a tester always knows what they're testing.

**Done when:** a tester can explain any reply from the Debug UI alone: what the AI saw, what it knew, and why it said it.

> **Built as:**
> - **The context pack** is shown in the Load context inspector (not a separate tab), including the dealer details and what the AI may say it knows. A separate tab would duplicate it and lose the link to the turn.
> - **The Conversation panel** sits beside the Slots panel. It marks each asked detail as "just asked" or "asked out", and shows open questions with labels, promises, the last topic and the summary.
> - **The Decide inspector** adds: the questions it answers, the one follow-up, what a clarification explains, and every "not asking" reason.
> - **The models banner and the test tags** come from `/dev/ping`, which now reports the running models.

---

## Phase 10: Conversation evals and real-model run

1. **Multi-turn eval cases** (DeepEval, deterministic metrics where possible):
   - a customer question gets an answer;
   - the same slot is never asked twice in a row;
   - short replies fill the right slot;
   - "what do you mean?" is re-explained;
   - frustration with the bot → no handoff and no ask;
   - "tomorrow" gives the right date;
   - every inbound message gets a reply or a recorded reason;
   - reading level within the target.
2. **Promptfoo:** injection cases for the new inputs (summary, working memory, dealer info).
3. **Real-model run:** the whole eval gate on the real models (`MODEL_EXTRACT` / `MODEL_COMPOSE` with the team's key). Record pass rates and cost per turn.
4. **Manual test script** in `docs/runbooks/`: the conversations from the manual testing that found these issues, with what a good reply looks like, for testers to replay in the Simulator.
5. **Progress:** `progress_2.md` with every phase's results, and the architecture diagram updated.

**Done when:** the eval gate passes on the real models, and the manual test script passes when run by a tester.

> **Built as:**
> - **Conversation evals:** 9 multi-turn cases in `evals/test_conversations.py`, run through the real event handlers, with the clock fixed to a Tuesday morning in New York.
> - **Promptfoo:** 3 new injection cases, through an earlier message (working memory), a planted summary and the dealer's store name.
> - **The report:** `make ai-evals-report` records pass rates, template fallbacks, how often the guard accepted the first draft, reply time and cost per reply.
> - **The real-model run was attempted and blocked:** the configured OpenAI key is refused (HTTP 401 `invalid_organization`: the key's organization isn't accessible). With every model call failing, every reply fell back to the safe template, and all safety and injection cases still passed. The report now checks the models first and stops with the provider's message. **Still to do:** re-run with a working key; that's the remaining "done when".
> - **Manual test script:** `docs/runbooks/manual_test_script.md`. Each of its conversations is also a passing scenario on the offline model.

---

## Not in this plan

- Inventory search (unless Phase 0 adds it)
- Pricing, payments, trade-in values, approvals (still restricted)
- Booking appointments through the bot
- Upselling
- Voice, or channels beyond SMS and email
- Dealer-portal UI
