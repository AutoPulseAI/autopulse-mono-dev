# agentic-upsell — Technical Architecture

> What the service does and why: [`PURPOSE.md`](PURPOSE.md).
> Libraries and why each was picked: [`STACK.md`](STACK.md), [`FRAMEWORKS.md`](FRAMEWORKS.md).

---

## 1. Architecture diagram

```
   ┌──────────┐        ┌──────────────────────────┐
   │   DMS    │──lead─▶│  aidmvcs-be-dev (Next.js)│◀── customer replies (SMS / email)
   └──────────┘        │  saves Lead & Customer   │    dealer record: hours, address, timezone
                       └────────────┬─────────────┘
                                    │  event: "new lead" / "new reply" / "lead paused"
                                    ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  API process (FastAPI)                                                       │
   │  checks shared secret → ignores duplicates → puts a job on the queue         │
   └────────────────────────────────────┬─────────────────────────────────────────┘
                                        │  job queue (SAQ on Redis)
                                        ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  WORKER process (SAQ)                                                        │
   │                                                                              │
   │   lead with staff / paused / opted out ──▶ Hold: holding reply (at most one  │
   │                                            every 2h) or a recorded reason    │
   │                                                                              │
   │   ┌──────────────────────── Turn pipeline (LangGraph) ────────────────────┐  │
   │   │  Load context ──▶ one CONTEXT PACK read by both AI steps:             │  │
   │   │    recent messages (token budget) · rolling summary · profile ·       │  │
   │   │    what we may say we know · conversation state (asks, open           │  │
   │   │    questions, promises) · dealer details · dealer's local time        │  │
   │   │                                                                       │  │
   │   │  Extract ─▶ Validate ─▶ Decide ─▶ Compose ─▶ Guard                    │  │
   │   │  (AI:       (code:      (code:     (AI:       (code: invented         │  │
   │   │  labelled   quotes,     9 rules,   plain      numbers, internal       │  │
   │   │  questions, dates       answer     English,   terms, questions left   │  │
   │   │  short      resolved    first, one one        unanswered; one         │  │
   │   │  replies)   in code)    ask)       question)  rewrite, then template) │  │
   │   └──────────────────────────────────────┬────────────────────────────────┘  │
   │                                          │ approved draft                    │
   │                                          ▼                                   │
   │   ┌───────────────────────┐   schedule   ┌───────────────┐                   │
   │   │  Scheduler            │◀─────────────│    Sender     │──▶ Twilio  (SMS)  │
   │   │  24h channel switch · │── resend ───▶│  (consent,    │──▶ SendGrid(email)│
   │   │  staff check after a  │              │  idempotent)  │                   │
   │   │  handoff · SMS only   │              └───────┬───────┘                   │
   │   │  8:00-20:00 dealer    │                      │ after the send            │
   │   │  time                 │                      ▼                           │
   │   └───────────────────────┘              Summary job (cheap model): folds    │
   │                                          messages that left working memory   │
   └──────────────────────────────────────────────────────────────────────────────┘
          │                    │                        │
          ▼                    ▼                        ▼
   ┌─────────────┐     ┌───────────────┐        ┌─────────────┐
   │  MongoDB    │     │    Redis      │        │  Langfuse   │
   │ facts, msgs,│     │ queue, locks, │        │  traces     │
   │ lead state, │     │ graph state   │        │             │
   │ follow-ups, │     │               │        │             │
   │ turn log    │     │               │        │             │
   └─────────────┘     └───────────────┘        └─────────────┘

   Twilio / SendGrid delivery status ──▶ API process ──▶ updates message status
```

---

## 2. Processes

There are two processes from one codebase. Both share MongoDB and Redis with
`aidmvcs-be-dev`.

| Process | Tech | What it does | What it never does |
|---|---|---|---|
| **API** | FastAPI + Uvicorn | Receives events and delivery callbacks, drops duplicates, queues a job, returns immediately | Call the AI, send messages |
| **Worker** | SAQ (Redis job queue) | Runs every job: conversation turns, sending, the follow-up timer | Accept HTTP traffic |

To handle more load, run more workers. Workers keep no state of their own.
Everything lives in MongoDB and Redis.

---

## 3. The core rule

The AI does **two** things only:

1. **Extract:** read the customer's text and pull out values ("about 60k miles" becomes mileage 60,000).
2. **Compose:** write the message text.

Everything else is plain code, so it behaves the same way every time:

- Lead type
- Which question to ask next
- Whether the profile is complete
- When to send, and on which channel
- Whether a message is safe to send

---

## 4. Flow 1 — New lead, first reply

1. The platform saves the lead from the DMS and sends us a **new lead** event.
2. The API checks the event ID. If it has already been seen, it's ignored. Otherwise a job is queued.
3. The worker takes the lead lock, so no other job works on this lead at the same time.
4. The worker checks the customer hasn't opted out of that channel.
5. The turn pipeline (§7) runs. Extract reads the lead's own comments, which often already contain answers ("trading in my 2018 Civic").
6. The message is sent on the **same channel the lead came from**.
7. A 24-hour follow-up is scheduled (§6).

**Speed:** the target is under 8 seconds from event to message sent. If the AI
is slow or fails, a ready-made template for that lead type is sent instead. A
new lead never waits.

---

## 5. Flow 2 — Customer replies (normal and campaign)

1. The platform sends us a **new reply** event.
2. The worker **first cancels any pending follow-ups** for this lead. The customer replied, so no channel switch is needed.
3. Quick checks run in code, with no AI:
   - The reply is STOP or UNSUBSCRIBE → mark the customer opted out and don't reply.
   - The lead is **handed to a human** → a short holding reply from a fixed template ("I've passed this to the team"), at most one every 2 hours; inside those 2 hours the message is saved for staff.
   - The lead is **paused** (a person is replying) or **opted out** → save the message and don't reply.
   - Whatever happens, the message is never left without a reason: a short "held" entry in the turn log says what was done and why (§15, decision 12).
4. The worker takes the lead lock. If another job holds it, this job retries in 2 seconds.
5. The worker collects **all** unanswered messages from this customer. Three texts in a row get one reply, not three.
6. The turn pipeline runs, and the reply goes out on the channel the customer just used.
7. A new 24-hour follow-up is scheduled.

**Campaign replies** use exactly the same flow. When loading context, the
worker checks whether the last message we sent this customer in the past 14
days came from a campaign (the platform's `CampaignLead` records). If it did,
the campaign's text and goal are passed to Compose, so the AI knows what the
customer is replying to. The dealer creates and sends campaigns. The AI only
answers.

---

## 6. Flow 3 — No reply, switch channel

- **Scheduling.** After each message we send, a follow-up record is saved in MongoDB with:
  - the lead
  - the message
  - the other channel
  - a due time 24 hours from now

  This only happens if we have the customer's contact for the other channel and they haven't opted out of it.
- **Contact window.** The switch is a message the AI starts on its own, so if it goes by SMS it is only sent between 8:00 and 20:00 dealer time. One that falls due outside that window waits for the next 8:00, both when it is planned and when it fires. Email isn't held (§15, decision 11).
- **Firing.** A scheduled job runs every minute on every worker.
  1. It claims due follow-ups one at a time with a single atomic database update, so two workers can never send the same one.
  2. Just before sending, it checks again whether the customer has replied. If so, it cancels.
- **Sending.** It sends the **same message** on the other channel. Compose writes both an SMS version and an email version up front, so no AI call is needed at this point.
- **Once only.** A switched message never schedules another switch.
- **Failed SMS.** If Twilio reports an SMS as failed or undelivered, the follow-up fires immediately instead of waiting 24 hours.
- **Stuck claims.** A worker can crash mid-send. A claim older than 5 minutes that hasn't been sent is put back as due.

**Staff check after a handoff.** The same collection and the same firing job
also hold one other kind of scheduled item. When a lead is handed to a person,
a check is due **30 business minutes** later (opening hours only, dealer
time). If staff still haven't taken the lead over by then, the customer gets
one "sorry for the wait" message and a staff alert is recorded on the lead.
The lead stays with staff. A customer message doesn't cancel the check; staff
pausing or resuming the lead does. Its SMS follows the contact window too.

**Why MongoDB and not delayed queue jobs:** cancelling is one database
update, the schedule survives a Redis restart, and the dealer UI can show
pending follow-ups.

---

## 7. The turn pipeline (LangGraph)

| Step | Who | What happens |
|---|---|---|
| **Load context** | Code | Builds the turn's **context pack**, which both AI steps read:<br>• the dealer's local date and time;<br>• the dealer's own details a customer may be told (address, phone, website, opening hours), from its platform record; anything missing is "the team will confirm";<br>• what we know about the customer, in plain words: confirmed values, and separately those still to confirm;<br>• the customer's profile (slots, including what was pre-filled from Customer 360 on the first turn);<br>• the new messages this turn answers;<br>• the conversation before them, word for word, within a token budget (the last 6 messages always kept; customer emails without their quoted chain);<br>• a **rolling summary** of everything older, updated after each send by a separate job with the cheap model, so it adds no time to the reply;<br>• the **conversation state**: what we asked and how often, the customer's still-open questions, what we promised;<br>• campaign info if relevant. |
| **Extract** | AI, cheap model | Reads the new customer text in the light of the context pack (usually our last message is what they're answering). Short replies ("used", "yes", "2019") are read as answers to what we asked last. Returns found values, each with the exact words it came from (in the new text only) and a confidence score. Also returns:<br>• each question the customer asked, labelled: answerable / restricted / off topic / "what do you mean?" / "what do you know about me?";<br>• whether they asked for a person;<br>• whether they're upset, and how sure that is;<br>• whether they're frustrated with the conversation itself. |
| **Validate** | Code | Accepts a value only if all four checks pass (below). Rejected values are logged. |
| **Decide** | Code | Picks exactly one next step (§8.3). |
| **Compose** | AI, stronger model | Writes the message for that step from the same context pack: an SMS version (max 320 characters), an email version (subject + body), a list of what the message promises the team will do, and which of the customer's questions it answered.<br>Plain English, about a grade 6-8 reading level, one question per message, using each detail's customer question and explanation. Dates are said plainly ("Wednesday, September 30 (tomorrow)"). |
| **Guard** | Code | Blocks invented prices, trade-in values, approvals or availability; internal terms a customer wouldn't understand (field codes, "slot"); and a reply that skipped a question it was meant to answer. Checks channel format. Numbers from the dealer's own details and the customer's values in plain words count as known. A failure gets **one** rewrite. A second failure sends a safe template and flags the lead for a human. |

**Dates.** The customer's words ("tomorrow", "next Friday at 3", "the 15th") are turned into a real date **in code**, against the dealer's local now, never by the model:
- the date is saved next to the words, and sets the timeline;
- an unclear date ("next Friday", or "tomorrow" said after midnight) is confirmed with the actual date first;
- a past date is rejected with the reason.

**Checks in Validate:**

1. The field exists in the slot list.
2. The value is valid: year between 1980 and next year, mileage between 0 and 500k, known options only.
3. The quoted words really appear in the customer's message. This stops the AI inventing a value.
4. Confidence is at least 0.7. If it's lower, the value is saved as "needs confirming" and the next message asks the customer to confirm it.

**Key points:**

- **The pipeline never sends.** It returns an approved draft. The worker does the sending. So retrying a step can never send a message twice.
- **MongoDB is the source of truth.** Redis only holds in-progress state for the current turn (LangGraph's shallow saver, 7-day idle expiry). If it's lost, the next turn rebuilds everything from MongoDB.
- **Limits per turn:** extract 3s, compose 5s per attempt, at most 4 AI calls, and a whole-turn cap of 8s (first reply) or 20s (other replies). Hitting any limit sends the template, never nothing.

---

## 8. Slots (customer profile)

### 8.1 What we collect

| Group | Fields |
|---|---|
| **Vehicles owned** (one or more) | year, make, model, trim, mileage, purchase date, bought from which dealer, new or used when bought |
| **Service history** (per vehicle) | which vehicle, service type, date, done at which dealer |
| **Trade-in** | has a trade, which vehicle, mileage, condition, payoff owed |
| **What they want now** | lead type, new or used, model, budget or monthly payment, timeline |
| **Appointments** | date, purpose, dealer |
| **Contact** | preferred channel, best time to reach |

Slot definitions live in one file as a list. Each entry has:

- name and type
- validation rule
- ask priority
- how long before it goes stale

Adding a slot means adding a line to that list.

The "which dealer" fields are plain text the customer tells us. They never
give access to another dealer's data.

### 8.2 Required slots per lead type

| Lead type | Required before the lead counts as qualified |
|---|---|
| Sales | new or used, model, budget or payment, timeline, has a trade |
| Trade-in | trade vehicle, mileage, condition, payoff |
| Service | vehicle, mileage, service needed, best time |
| General | lead type, then the matching row above |

If a sales customer says they have a trade, the trade-in slots become required too.

The lead type is set in code from the lead's source in the platform. The AI's
guess is only used when the source doesn't tell us.

### 8.3 How Decide picks the next step

It checks these in order and stops at the first one that applies:

1. Customer opted out → **stop**.
2. Customer asked for a person, or is **clearly** upset (not just one ambiguous message) → **hand off**. The AI steps back on this lead until staff resume it.
3. Customer asked what our last message meant → **clarify**: explain it again, with nothing new asked.
4. Customer asked questions → **answer** them first, then at most **one** follow-up: a confirmation if one is waiting, otherwise one ask.
5. A value needs confirming → **confirm** it.
6. A required detail can be asked → **ask** for **one**.
7. Nothing missing → **qualified**: notify the dealer, stop asking.
8. Every missing detail has been asked twice → **partly qualified**: the lead goes to the team with what we have, and nothing more is asked.
9. Otherwise → **acknowledge**: reply without a question.

Asking follows the conversation state (§15, decision 13):
- the least-asked detail comes first;
- never the detail our last message asked for;
- a detail asked twice is parked until 3 other replies have gone out;
- a customer frustrated with the conversation itself ("you keep asking the same thing") is asked nothing. That frustration is **not** a handoff.

A reply meant to answer questions must answer every one of them. The guard
sends it back for one rewrite if it doesn't.

The same profile, conversation state and customer message always produce the
same next step.

### 8.4 How values are stored

- Every value is saved with its **source**:
  - Platform record: trusted.
  - Extracted from a customer message: linked to that exact message.
- The AI's own words or guesses are **never** saved.
- A new value for the same field **replaces** the old one. The old one is kept with an end date as history.

---

## 9. Sending

- **Twilio (SMS)** and **SendGrid (email)** only. The DMS is inbound only.
- **No double sends.** Every outgoing message is written to MongoDB **before** sending, with a unique key for that turn and channel. If the job retries after a successful send, the key already exists and the send is skipped.
- **Consent.** Checked right before every send, including follow-ups:
  - Twilio's opt-out (STOP) is mirrored into our consent records.
  - So are SendGrid unsubscribes.
- **Failures.** A send failure retries up to 3 times with growing delays.
- **Delivery status.** Twilio and SendGrid call back to the API, which updates the message status.

---

## 10. Data (MongoDB)

Every collection this service owns stores `dealer_id`. All access goes through
the existing dealer-scoped data layer, which refuses cross-dealer reads and
writes. The one exception is the follow-up job's "find due follow-ups" query,
which covers all dealers by design and scopes to the claimed record's dealer
right after.

| Collection | Holds |
|---|---|
| `ai_lead_state` | Per lead:<br>• lead type, status (active / qualified / partly qualified / handoff / paused / opted out) and the reason;<br>• last inbound and outbound times;<br>• the **conversation state** (asks per slot, open questions with their labels, promises, last topic);<br>• the **rolling summary** of what came before working memory;<br>• the current handoff, when the customer was last told the team has it, and any staff alert |
| `qualification_facts` | Slot values with source, dates and replace history (exists) |
| `ai_messages` | Every inbound and outbound message: channel, text, SMS and email versions, campaign ID, delivery status |
| `scheduled_followups` | Scheduled messages with their due time and status: the 24h channel switch, and the staff check after a handoff (`kind`) |
| `ai_events` | Event IDs already processed (auto-deleted after 7 days) |
| `ai_turn_log` | Per turn: what was extracted, what was rejected, the decision, drafts, guard results, cost, time. Also a short entry for every customer message the AI didn't answer, with the reason, and for each channel switch and staff check that fired (auto-deleted after 90 days) |
| `ai_consent` | Per customer and channel: opted out or not, set by STOP / START replies |

**Platform data** (`Lead`, `Customer`, `Vehicle`, `Deal`, `RepairOrder`,
`ServiceAppointment`, `TradeIn`, `Campaign`, `CampaignLead`) is **read only**, mostly through the
Customer 360 API.

**Redis** (separate logical DB from the platform's queues) holds:

- the job queue
- lead locks
- per-dealer counters
- LangGraph turn state

---

## 11. API endpoints

| Endpoint | Called by | Purpose |
|---|---|---|
| `POST /v1/events/lead-created` | Platform | New lead arrived |
| `POST /v1/events/inbound-message` | Platform | Customer replied |
| `POST /v1/events/lead-paused` | Platform | Staff took over (button or manual reply). The AI stops replying and cancels pending follow-ups. |
| `POST /v1/events/lead-resumed` | Platform | Staff hands a lead back to the AI |
| `POST /v1/webhooks/twilio/status` | Twilio | SMS delivery status |
| `POST /v1/webhooks/sendgrid/events` | SendGrid | Email delivery and unsubscribe events |
| `GET /v1/leads/{id}/profile` | Platform UI | Slots with state, source and history; missing slots; required progress; lead status and reason; pending follow-up |
| `GET /v1/metrics?dealer_id=&days=` | Platform admin / ops | The numbers to watch (first reply, fallbacks, guard failures, cost, qualified rate) |
| `GET /v1/rollout-check?dealer_id=&days=` | Platform admin / ops | Go-live checks: no double messages, no lost replies, numbers within limits |
| `GET /health` | Ops | MongoDB and Redis reachable |

- **Auth for events:** the existing shared secret between the platform and this service.
- **Auth for webhooks:** the provider's signature.
- **Responses:** every event endpoint returns immediately (202) and the work happens in the worker.

---

## 12. Load and concurrency

| Problem | How it's handled |
|---|---|
| Two jobs for the same lead at once | Redis lock per lead. The second job is re-queued: 2s later, growing to 10s, for up to ~48 minutes. |
| The same job running twice (a retry, or the queue re-delivering it) | The turn id comes from what triggered it, so the send's idempotency key blocks a second message. |
| Customer sends several texts quickly | One turn answers all unanswered messages |
| One dealer's campaign floods replies | Each dealer is limited to 10 turns running at once (one atomic check), and each worker runs 20 jobs, so a busy dealer never takes every slot. Burst-tested: 300 replies in 10 minutes, other dealers unaffected. |
| AI provider rate limits | Retry inside the turn's time limit, then send the template |
| Two workers firing the same follow-up | Atomic claim in MongoDB |
| Redis filling up | Only the latest graph state is kept, and it expires after 7 idle days |

---

## 13. Monitoring and testing

**Langfuse:** one trace per turn, with a span for each step and each AI call,
tagged with dealer, lead type and trigger. The trace ID is saved in
`ai_turn_log`.

**Numbers to watch:**

- first-reply time
- how often the template is used
- guard failures
- rejected extractions
- cost per dealer per day
- qualified-lead rate

**Tests:**

| What | How |
|---|---|
| Decide logic and validation rules | Plain unit tests covering every lead type with missing, stale and conditional slots |
| Extraction quality | DeepEval against real example conversations (`docs/data/conversations.md`) |
| Message safety | DeepEval and Promptfoo: no invented numbers, asks the right thing, resists prompt injection |
| Follow-ups | Two workers racing for one follow-up; a reply arriving just before it fires; stuck claims |
| Sending | Retries don't double-send; opted-out customers are skipped |
| Dealer isolation | Cross-dealer access must fail (exists) |
| End to end | New lead → message → 24h later (fake clock) → channel switch; a reply cancels it |

---

## 14. Build status

| Piece | Status |
|---|---|
| Worker, events, pipeline, trace, Debug UI (Stages 1-3) | Built |
| Sending, first reply, platform wiring, Customer 360 (Stages 4-6) | Built |
| Slot engine, AI steps, campaign replies (Stages 7-9) | Built |
| 24h channel switch with delivery webhooks (Stage 10) | Built |
| No double messaging with n8n / FollowUpJob, staff takeover (Stage 11) | Built |
| Live Twilio / SendGrid drivers, allowlist, burst hardening, eval gate (CI), metrics (Stage 12) | Built. The drivers are tested against mocked provider APIs; the first real use is `make ai-provider-check`. |
| Shadow comparison, go-live checks, DEV copy, rollback (Stage 13) | Built. The real rollout of a dealer follows `docs/runbooks/rollout.md`. |
| Context pack and conversation state (MASTER_PLAN_2 Phase 1) | Built |
| Rolling summary, understanding the customer, conversational Decide (MASTER_PLAN_2 Phases 3-5) | Built |
| Never silent: holding replies, staff check after a handoff, SMS contact window, a reason for every unanswered message (MASTER_PLAN_2 Phase 2) | Built |
| Answer sources, plain explainable replies, dates (MASTER_PLAN_2 Phases 6-8) | Built |
| Debug UI updates, conversation evals, manual test script (MASTER_PLAN_2 Phases 9-10) | Built. The real-model eval run is waiting on a working OpenAI key (`make ai-evals-report` with the real models). |
| Inventory | Planned: `docs/plans/PLAN_3/MASTER_PLAN_3.md` |

Progress and per-file changes: `docs/plans/PLAN_1/progress_1.md` (Plan 1), `docs/plans/PLAN_2/progress_2.md` (Plan 2).

**Models:** extract and compose run on a deterministic offline model by default
(`MODEL_EXTRACT` / `MODEL_COMPOSE = offline`), so dev and tests need no API
key. Set them to an OpenAI model name with a real `OPENAI_API_KEY` to use a
real model.

**Queue library:** SAQ, not arq. arq requires redis-py below 6, which conflicts
with the LangGraph Redis saver. SAQ runs on the same Redis.

---

## 15. Decisions made

1. **Inbound messages.** The platform receives them: Twilio for SMS, the Mailgun webhook for email. It forwards them to us as events.
2. **The dealer UI.** After every send, this service calls a platform internal endpoint that records the message as an `Email` document flagged as AI-generated, so the existing conversation screen shows it (BPLAN Phase 3).
3. **Email provider.** SendGrid for AI-sent email. The reply-to address routes customer replies back through the platform's existing Mailgun inbound route.
4. **SMS sender.** AI texts go out from the dealer's existing Twilio number, so replies arrive through the existing inbound SMS path.
5. **Event IDs.** `lead-created` uses the Lead ID. `inbound-message` uses the platform's `Email` record ID.
6. **Environment flag.** Only `ENVIRONMENT=DEV` turns on debug-only behaviour (the `/dev/*` routes, live trace stream, stored prompts, seed script). Any other value, or none, is production.

### Decided for MASTER_PLAN_2 (Phase 0)

7. **Inventory.** Not in Plan 2. Stock questions are "restricted" and get "the team will check what's in stock for you". The inventory work is planned in `docs/plans/PLAN_3/MASTER_PLAN_3.md`.
8. **Dealer info.** Read from the dealer's own platform record: the `User` document of type dealer, filled in when the dealer registers and in the admin dealer form, under `dealer_account_information`.
   - The AI may use what a customer would see on the dealer's website:
     - `store_name` (or the record's `name`)
     - `store_address`, `store_city`, `store_state`, `store_postal`
     - `store_website`
     - the dealer's texting number `sms_conversion_phone`, and `alternative_contact_number`
     - `weekly_availability` (opening hours)
     - `time_zone`
   - Staff contact details (the general manager's and F&I manager's phone and email) are never given to customers.
   - A field that's empty is answered with "the team will confirm".
9. **Dealer timezone.** `dealer_account_information.time_zone` (the platform's own default is `America/New_York`). With no value, `America/New_York` is used.
   - Every dealer-facing time rule uses it: business hours, the contact window, and dates in replies.
   - The Debug UI shows times in Pakistan time (`Asia/Karachi`), for the team testing it. It also shows the dealer's local time where business hours matter. Display only: no rule uses the tester's timezone.
10. **Business hours.** From `dealer_account_information.weekly_availability`: per weekday, whether the store is open and its opening and closing times, in the dealer's timezone. If a dealer has none, Monday to Saturday 9:00 to 18:00 is used.
11. **Contact window (US messaging law).** Two kinds of message:
    - **A reply to a message the customer just sent** goes out right away, at any hour. The customer started that exchange. This includes the holding reply below.
    - **A message the AI starts on its own (proactive)** goes out by SMS only between 8:00 and 20:00 in the customer's local time. Proactive messages are the 24h channel switch and the handoff-timeout holding reply. A proactive SMS that falls due outside the window waits for the next 8:00.
      - 8:00–20:00 is the strictest common window: the federal TCPA allows 8:00–21:00, and several states (for example Florida) allow 8:00–20:00.
      - The customer's own timezone isn't known yet, so the dealer's timezone is used; dealership customers are almost always local.
      - Email has no time-of-day rule, so a proactive email isn't held.
    - STOP / opt-out and consent are already checked before every send (§9).
    - This is an engineering rule chosen to stay inside those laws, not legal advice. Have counsel confirm it before the first live dealer.
12. **While a lead is with staff (handoff) and the handoff timeout.**
    - A customer message on a handed-off lead gets a short **holding reply** from a fixed template (no AI): "Thanks, I've passed this to the team and someone will reach out shortly."
    - At most one holding reply every **2 hours** per lead. Messages inside those 2 hours are saved for staff, and the reason is recorded in the trace.
    - Paused (a person is replying) and opted-out leads get no holding reply. The reason is recorded in the trace.
    - When a lead is handed to a person, a check is scheduled for **30 business minutes** later: minutes inside the dealer's business hours only.
    - If by then staff haven't taken the lead over (replied, paused it or resumed it), the customer gets one more holding reply. A staff alert is recorded on the lead, and shown in the Debug UI and the go-live checks.
    - The lead stays with staff: the AI doesn't take it back on its own. This happens once per handoff.
    - The holding reply, when it's proactive, follows the contact window above.
13. **Ask limit.**
    - A required detail is asked at most **2** times per lead, and never twice in a row.
    - After 2 asks it's parked. A parked detail can be asked again only after 3 other turns, and optional details never are.
