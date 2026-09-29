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
   │   │  24h channel switch · │── resend ───▶│  (send check, │──▶ SendGrid(email)│
   │   │  staff check after a  │              │  idempotent)  │                   │
   │   │  handoff · due times  │              └───────┬───────┘                   │
   │   │  from the send check  │                      │ after the send            │
   │   │  (§9)                 │                      ▼                           │
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
   - The reply is STOP or UNSUBSCRIBE → mark the customer opted out of that channel and don't reply (the carrier confirms).
   - The reply asks us to stop in their own words ("stop contacting me", "don't text me") → opted out of the channel it names, or every channel when it names none, and one plain confirmation goes out (§15, decisions 74–75).
   - A possible opt-out that isn't clear (Extract's `possible_opt_out` ≥ 0.5) → a plain reply that asks nothing, and REVIEW: marketing stops until the customer writes again or an admin resumes the AI (decision 72).
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
- **Send check.** The switch is a marketing message the AI starts on its own, so it goes through the send check (§9): consent, the customer's own hours and the dealer's opening hours, the 3-per-24h cap. Its due time is planned with the check, and one whose time comes outside it when it fires goes back to pending until the time the check gives. Email isn't held. (Replaces the 8:00–20:00 dealer-time window of decision 11.)
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
pausing or resuming the lead does. Its SMS goes through the send check too, as a transactional message.

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
| **Search stock** | Code | MASTER_PLAN_3 Part A Phase 2. Builds shopping criteria from this turn's just-validated profile (vehicle, new/used, body type, colour, budget) and searches the dealer's stock (`tools/inventory_tool.py`, `tools/stock_search.py`). Only when it helps: a stock question, a named make/model, or a body type with new/used. No exact match loosens in order — colour → trim → year ±1 → same body type any make → new/used — each step recorded. Colour is matched against the dealer's own stored spelling (the platform's colour match is case-sensitive); trim is checked in code, since `/api/car` has no trim parameter. Patches `inventory` / `inventory_query` / `inventory_checked_at` onto the context pack, held back from both AI steps until the grounding check (Phase 4) exists. |
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
- **The send check** (MASTER_PLAN_3 C1, `compliance/engine.py`). Right before every send, including follow-ups, `can_contact(customer, dealer, lead, channel, purpose, is_reply, at)` returns ALLOW, HOLD until a time, REVIEW or BLOCK, in plain code, checked in this order:
  1. AI voice calls are off.
  2. An opt-out on this channel blocks everything but the one opt-out confirmation (STOP, a phrase, Twilio's STOP, a SendGrid unsubscribe).
  3. A lead staff set to "DND" is blocked.
  4. An explicit no (the phone's `sms_opt_in: false`, the lead form's `TCPAOptIn: false`) blocks marketing texts.
  5. A reply to the customer's own message goes: at any hour in a conversation the customer started (inbound); in an outbound one, outside 8:00–21:00 customer time it asks nothing and says the team picks up at 8:00.
  6. An open review (a possible opt-out) stops marketing.
  7. A marketing text the business starts needs consent: the platform's opt-in flag, or for the AI's follow-ups the customer's own inquiry (91 days). A lead-form "yes" alone is REVIEW. Email needs none.
  8. A text the system starts goes only inside the dealer's opening hours and the customer's window in every zone they may be in: marketing 8:00–20:00, transactional 8:00–21:00. Email has no time rule.
  9. At most 3 marketing texts per customer per 24 hours, across the AI and campaigns.

  The customer's zone comes from their DealerVault ZIP, else state, else area code, else every continental zone at once. Inbound or outbound is decided per lead (`compliance/origin.py`). Every decision is added to `ai_compliance_log`. Platform campaign texts go through the same check through a shared queue (§15, decision 66).
- **Consent records** (`ai_consent`) are an add-only history: Twilio's STOP and SendGrid unsubscribes are mirrored in as new entries.
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
| `ai_lead_state` | Per lead:<br>• lead type, status (active / qualified / partly qualified / handoff / paused / opted out) and the reason;<br>• last inbound and outbound times;<br>• the **conversation state** (asks per slot, open questions with their labels, promises, last topic);<br>• the **rolling summary** of what came before working memory;<br>• the current handoff, when the customer was last told the team has it, and any staff alert;<br>• inbound or outbound, the customer's time zone (each with how it was found), an open review and its staff notice (MASTER_PLAN_3 C1) |
| `qualification_facts` | Slot values with source, dates and replace history (exists) |
| `ai_messages` | Every inbound and outbound message: channel, text, SMS and email versions, campaign ID, delivery status |
| `scheduled_followups` | Scheduled messages with their due time and status: the 24h channel switch, and the staff check after a handoff (`kind`) |
| `ai_events` | Event IDs already processed (auto-deleted after 7 days) |
| `ai_turn_log` | Per turn: what was extracted, what was rejected, the decision, drafts, guard results, cost, time. Also a short entry for every customer message the AI didn't answer, with the reason, and for each channel switch and staff check that fired (auto-deleted after 90 days) |
| `ai_consent` | Add-only history per customer and channel (decision 77): opt-outs and opt-ins (STOP / START, phrases, provider unsubscribes), marketing-consent evidence (platform opt-in flag, lead-form line) and open / resolved reviews. The current state is the latest entry. Never edited or deleted |
| `ai_compliance_log` | Every send check's decision with what was checked: consent evidence, zones and local times, do-not-contact, frequency, decision and reason. Add-only, auto-deleted after 5 years |
| `ai_send_checks` | Shared with the platform's campaign worker: one check request per campaign text, answered by this service on that entry only (decision 66) |

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
| `GET /v1/metrics?dealer_id=&days=` | Platform admin / ops | The numbers to watch (first reply, fallbacks, guard failures, cost, qualified rate, send-check decisions, texts allowed outside the hours (must be 0), unmapped lead sources) |
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
| Inventory read layer, shopping criteria (MASTER_PLAN_3 Part A Phases 1–2) | Built |
| Answering stock questions, grounding check, freshness, evals (MASTER_PLAN_3 Part A Phases 3–7) | Planned: `docs/plans/PLAN_3/MASTER_PLAN_3.md` |
| Send check (compliance engine) with origin, customer time zone, consent history, opt-out phrases, REVIEW, audit log and the platform campaign check (MASTER_PLAN_3 C1, with B2/B3) | **Provisionally closed (29 Sept)**. The platform side is in `aidmvcs-be-dev` (campaign worker, `CampaignLead`, campaign report). Known bug deferred, not blocking: an opt-out silences replies too, not just marketing (decision 87); planned fix is the C1 extension in `docs/plans/PLAN_3/MASTER_PLAN_3.md` |

Progress and per-file changes: `docs/plans/PLAN_1/progress_1.md` (Plan 1), `docs/plans/PLAN_2/progress_2.md` (Plan 2), `docs/plans/PLAN_3/progress_3.md` (Plan 3).

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
      - The customer's own timezone isn't known yet, so the dealer's timezone is used; dealership customers are almost always local. (Superseded for Plan 3 by decisions 18 and 23–25.)
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

### Decided for MASTER_PLAN_3 Part A (Phase 0)

14. **Prices.** A direct price/payment/financing/discount/approval question stays restricted ("the team will confirm"), as Plan 2 already ships (`agent/llm.py` QUESTION_LABELS). A budget may filter the search without being stated back. **Client override, follow-up touches only:** a *verified* price drop or OEM price change on a vehicle already loaded this turn may be used as an outreach angle in the Day 8–90 cadence — never invented, never in response to a direct pricing question. Source: `docs/data/pdf_dump.txt` (follow-up PDF, Days 8–30/31–90 cadence rows: "verified price change/OEM offer", "Verified price/OEM changes"); `docs/client/autpulse.workflowblueprint.png`, box "INVENTORY FEED INTEGRATION" ("Alert on PRICE CHANGES & price drops").
15. **Links.** **Client override**, superseding the earlier "no SMS links" placeholder: the first quality response to a vehicle-specific lead includes a vehicle link and image when both are available and the vehicle is verified active/in stock; link only if no image; image only if no clean link; otherwise personalize around intent instead of a vehicle. Source: `docs/client/autpulse.workflowblueprint.png`, box "6. FIRST QUALITY RESPONSE RULE" and box "A. NO-RESPONSE CADENCE" (Day 1 Touch 1: "Include vehicle link and image (if applicable)"). Applies to both SMS and email; the live SMS Compose prompt (`agent/llm.py:166`, "no links") needs updating to match once this phase is built.
16. **Vehicles per reply.**
    - SMS: at most **2** vehicles named in a reply, from at most **3** loaded. This is the existing rule in the n8n SMS pipeline (`n8n-active/v8-phase1/SMS_v8_PHASE1_TEST_PLAN.md`). The client hasn't spoken to this number; kept as-is.
    - Email: at most **3**. No earlier document set an email limit; kept as-is.
17. **Out of stock.** **Client override:** never a bare "not available". Always pair it with the closest alternative from the loosened search, or, with nothing close, a promise that the team will check. Source: `docs/client/autpulse.workflowblueprint.png`, "VEHICLE TYPE OVERRIDE RULE" / inventory guidance boxes. Reflected in `docs/plans/PLAN_3/MASTER_PLAN_3.md` Phase 3.
18. **Contact hours.** **Client override, supersedes decision 11:** 8:00–21:00 (the blueprint says "9pm"; the TCPA PDF's own federal citation is 8:00–21:00, so this doc treats the blueprint's "9pm" as the same federal 21:00 boundary) in the **customer's** local time, not the dealer's. Source: `docs/client/autpulse.workflowblueprint.png`, box "0. AFTER-HOURS & TCPA COMPLIANCE RULE" ("8am–9pm local time at the customer's location"); `docs/data/pdf_dump.txt` (TCPA PDF, p.2 "Hours" row, and p.4 §7: "Determine the consumer's applicable jurisdiction and local time before every covered outbound attempt"). Existing code (`scheduler/contact_window.py`) implements the old dealer-time rule and needs rework. **Updated 27 Sept:** the time zone lookup is decision 23, the dealer-hours condition decision 24, and until counsel's state table arrives the window is tightened to 8:00–20:00 by decision 25.
19. **Visit-offer attempts.** **Client override**, supersedes Master Plan 3's own draft suggestion of 2: up to **3** attempts, each a different angle (attempt 2: a different hot-button/objection response; attempt 3: a different value proposition), then stop pushing, record the decline reason, and schedule a dated follow-up. Source: `docs/client/autpulse.workflowblueprint.png`, box "C. APPOINTMENT CONVERSION — ASK UP TO 3 TIMES".
20. **Handoff triggers.** **Client addition** to the two triggers Plan 2 already ships (`slots/policy.py`: asked for a person; clearly upset ≥0.8 confidence): also escalate immediately when the customer indicates an urgent need, and when the customer explicitly requests a phone call, respond with a call within 5 business minutes. Source: `docs/client/autpulse.workflowblueprint.png`, box "7. ESCALATION RULES". **Updated 27 Sept:** urgent-need detection is decision 26; the callback reuses Part C's call tasks (decision 27).

### Decided 27 Sept (MASTER_PLAN_3 review)

Items marked **our default** were decided by us because no client document answers them; each is flagged for client feedback.

21. **Vehicle photos: MMS through Twilio.** Twilio SMS is already built (`channels/twilio.py`, `CHANNEL_DRIVER=live`) but text-only. It gains `MediaUrl` support, sending the vehicle's own `imagesSecure` URL. Code checks the URL is public and under the carrier size limit (about 5 MB) first; otherwise decision 15's fallback order applies. Never an unrelated photo. A cost review (MMS ≈ 3× SMS) is still to do.
22. **Build order.** Build first the part with no other part of MASTER_PLAN_3 as a prerequisite: Part A (except the price-drop exception, which waits for Part C's C4, and Phase 5, which waits for real feed data). Then C1's compliance engine with B2/B3 folded in, then the rest as listed at the top of MASTER_PLAN_3. Replaces "Part B first".
23. **Customer time zone.** In order:
    1. ZIP, else state: from the customer's DealerVault sales/service rows (the platform `Customer` record has no address) or the lead form.
    2. Else the phone's area code.
    3. Else (**our default**) only the hours legal in every continental US zone at once.
    Saved on the lead with how it was found. Replaces decision 11's "dealer's timezone" stand-in.
24. **Dealer hours for outbound.** A message the system starts must fall inside the dealer's opening hours (decision 10) **and** the customer-local window (decisions 18, 25). A reply to a message the customer just sent is exempt from the dealer-hours check. Source: blueprint box "7. BUSINESS HOURS RULE" ("All other touches follow business hours unless customer replies"), box 0 ("This check happens BEFORE any outreach"), Omnichannel PDF p.1 ("dealer schedule, time-window" guardrails). Applies to the 24h channel switch and handoff-timeout reply too, so `scheduler/contact_window.py` needs rework.
25. **State rules: strictest known rule everywhere (interim).** State telemarketing rules apply by the **customer's** state (the stricter of the ZIP state and the area-code state when they differ), and cover messages the business starts, not replies. Counsel's state table hasn't arrived, so every customer gets the strictest known rule (Florida/Oklahoma): marketing SMS only 8:00–20:00 customer-local, and at most 3 marketing messages per customer per 24 hours across the AI and campaigns. This is tighter than decision 18's 8:00–21:00; the stricter wins until the table says otherwise. **A counsel-approved state rules table is required to apply state rules properly**; it must also cover rules not in this default (e.g. Sunday/holiday limits).
26. **Urgent need.** Extract labels it (`urgent`, `urgent_confidence`, `urgent_reason` from a fixed list: no transportation / broke down; needs a vehicle within 48h; safety problem; deadline elsewhere). Code hands off at confidence ≥ 0.8. Pure-code backstop: `interest.needed_by` resolved within 48 hours. The list, threshold and example set are **our default**; examples go to the client to confirm.
27. **Call tasks and the callback: skipped for now.** Staff call tasks (C2) would need new platform backend and UI (the platform has no task model or screen), and MASTER_PLAN_3 doesn't change platform code except B3's campaign check. B0.13's 5-minute callback depends on C2 and is skipped with it.
28. **Visit-offer angles.** Attempt 1: main interest and value. Attempt 2: the objection or hot button seen (time/convenience, just looking, wants numbers first, credit worry, unsure of trade value). Attempt 3: a value reason from the Omnichannel PDF's Day 6 list (appraisal, comparison, financing review, management review, right-team meeting), by lead bucket. Always built from the customer's own facts; the angle used is saved so none repeats. Shape from blueprint box C; lists are **our default**.
29. **Replies at night.** A customer's own message (a new lead, or a reply to a campaign) is not outreach: one reply goes out right away at any hour. The conversation continues right away only inside 8:00–21:00 customer-local time; outside it, the reply says the team picks up at 8:00, asks nothing more, and the conversation resumes then. This follows the blueprint's "continues the conversation immediately (if within TCPA allowed hours)". Follow-ups keep the outbound rules. **Our default** reading; flagged for client and counsel. **28 Sept: now applies to outbound conversations only; inbound conversations continue at any hour (decision 56).**
30. **Booking defaults** (per-dealer settings, **our default**; no client document states them): 30-minute slots, 2 bookings per slot, earliest offer ≥ 2 hours ahead and inside opening hours, last slot ≥ 30 minutes before closing, up to 7 days ahead, AI bookings go in `pending`.
31. **No platform code changes** in MASTER_PLAN_3, with two approved exceptions: (a) the campaign worker (`worker/campaignWorker.js`) runs the send check per lead, and the campaign report page shows "Held until…" / "Blocked: …"; (b) C5's manager outcome selection (decision 33). Inbound/outbound is worked out in the AI service; no campaign type (the platform has one kind of campaign, always dealer-initiated). The lead stage (C3) lives in the AI service.
32. **Booking.** Through the existing `POST`/`PUT /api/booking`, unchanged; it doesn't pause the AI. Availability, no double booking, no second confirmation, `HH:MM` times and sending `booking_status` on a move are handled in the AI service. The booking needs both email and phone: the AI asks for whichever is missing (a phone given for the booking isn't marketing consent); if the customer won't give it, the requested time goes to the team.
33. **C5 ships.** Built in the AI service: the day-before Y/N confirmation and its router (confirm via `PUT /api/booking`), a daily countdown with vehicle photos, the +1h / +24h no-show messages then back into follow-ups, and "showed" when staff set Visited. Not built: the client's 15-minute details message (the booking endpoint already sends a confirmation). For AI dealers the platform's own reminders are switched off in the dealer's Reminder settings (no code). The platform's no-show message has no switch: if staff set "No Show" first, our +1h message is skipped (**our default**). **Manager outcome** (Sold pending / Sold delivered / Unsold): planned to be shipped, as a platform change to the status dropdowns, the status route and `STAFF_OWNED_STATUSES`, plus a prompt for the outcome after "Visited". Source: Omnichannel PDF §7–10.
34. **First-reply ending.** The client's Touch 1 must "ALWAYS end" with "Tell me, what are you driving now?" (Omnichannel PDF p.3). B1's after-hours choice and B4's visit offer override it; otherwise the driving question is used. Flagged for client feedback.
35. **At most 2 questions per message** (was 1). MASTER_PLAN_2's one-question rule was our own design ("two questions in one text read like a form"), not a client requirement. Decide may give Compose up to 2 asks, and Compose's instructions say "at most two questions". Supersedes the "one question per message" wording in §7 and §8.3 once built.
36. **Consent for marketing texts** (texts the business starts; replies never need it; email needs none). In order:
    1. An explicit no wins: STOP, a phone marked `sms_opt_in: false`, or the lead form saying no (e.g. AutoTrader's `TCPAOptIn: false`); it also stops follow-ups on their inquiry (agreed 27 Sept; the first reply still goes out).
    2. The platform's opt-in flag (`sms_opt_in: true`, set when the customer texts the dealer) counts as consent.
    3. Consent in the lead form, read from the lead text in the AI service (AutoTrader sends `TCPAOptIn: true|false;` in the comments; other providers' formats added as found). **29 Sept: a bare `true` is "review required", not consent (decision 76).**
    4. The customer's own inquiry (a lead they submitted or a message they sent) is consent to follow up on that inquiry until the opportunity closes, not for unrelated marketing such as platform campaigns. Counsel to confirm.
    5. One email asking "Want updates by text? Reply YES" to contacts without text consent (e.g. DealerVault imports); a YES is consent. Asked once per contact per dealer, never repeated (agreed 27 Sept). **28 Sept: on hold, the client never asked for it (decision 67).**
    6. Otherwise no marketing text; email only.
    Saved in `ai_consent` with source, time and evidence. No platform change. Replaces Plan 1's "an unset flag allows texting" in `channels/consent.py` for marketing texts.

### Decided 27–28 Sept (MASTER_PLAN_3 Part A, Phase 2)

37. **Stock/price question split.** `agent/llm.py`'s `QUESTION_LABELS` prompt text and `agent/offline_model.py`'s question-labelling rule treated stock-availability wording ("in stock", "available", "do you have") and price/financing wording as one merged `restricted` rule. Split into two rules (`agent/question_topics.py`): a stock question and a price question. Both still route to `restricted` in Phase 2 — nothing yet answers a stock question from real stock — so the split changes no behaviour on its own; it's what Phase 3 flips one half of.
38. **Search stock runs after Validate, not inside Load context.** Phase 1 built the search inside `load_context`, which runs before `extract`/`validate` and so could only ever see the profile as it stood before the turn's own message. A new graph step, `search_stock`, runs after `validate` instead (`load_context → extract → validate → search_stock → decide → …`), replacing Phase 1's search rather than adding a second one. Side effect: stock now shows up from the first turn, not the second.
39. **Trim is filtered client-side; colour is case-corrected against the dealer's own stock.** Checked directly against `aidmvcs-be-dev/app/api/car/route.js`: it returns each vehicle's `trim` but has no query parameter for it, so "loosen trim" is done in code after a broader search returns, not by re-querying. `exterior_color` is a literal, case-sensitive match on the platform (unlike make/model/body type/condition, which are case-insensitive), confirmed by reading the route and by the live parity check (a lower-case colour matches 0 records on both the stub and the real route). The tool reads the dealer's own distinct colour values before sending one, and sends back their exact stored spelling.
40. **Inventory Phases 3 and 4 are built and shipped together (28 Sept).** `inventory` stays hidden from the models (`HELD_FROM_MODELS`) until the grounding check exists. It is unhidden in the same change that adds that check, so no vehicle mention ever reaches a customer without a grounding check. All open items in both phases are settled in MASTER_PLAN_3 before implementation starts.
41. **The offline model's stock answering moves to Phase 3 (28 Sept)**, from Phase 6 item 4, because Phase 3's scenarios run on the offline model. It answers only from the `inventory` layer, fills `mentioned_vins`, and follows the same alternative-or-promise order as the real model. `#badtrim` ships with it, since Phases 3 and 4 ship together.
42. **The availability guard is narrowed, not removed (28 Sept).** It enforces the client rule "never invent … availability" (`docs/data/conversations.md` rule 8). It was built as a blanket block when the AI had no stock data, so any availability claim was necessarily invented. Now that claims can be verified, availability wording is allowed only when every VIN in `mentioned_vins` is in this turn's `inventory`. A vehicle's year and miles are allowed only from a mentioned record. Money amounts are never allowed from vehicle records.
43. **"Not available" plus an alternative is allowed; a bare no is not (28 Sept).** The client forbids only a reply that says no and offers nothing. Decide chooses `offer_vehicles` or `promise_to_check` in code. The guard rejects a stock reply that names no vehicle and makes no promise. It allows "not available" wording only alongside a named loaded vehicle or a promise, and only when this turn's search ran and its exact step found nothing.
44. **After all loosening steps fail (28 Sept; our default, flagged for client feedback):** with a known budget, stock in the customer's condition (new or used) within that budget; otherwise a promise to let them know when one arrives. Never stock picked at random, and every alternative records why it was offered.
45. **`shown_vehicles` per lead (28 Sept).** Stored in each lead's own conversation state (`{vin, turn, channel}`, cap 10), never shared across leads. Shown vehicles stay in search results, marked `already_shown`; Compose doesn't offer them again as new. If all loaded vehicles were shown, Decide moves to the next loosening step or decision 44.
46. **Vehicle references are resolved in code (28 Sept).** Extract returns `selected_vin` from the last reply's shown vehicles. Code accepts it only if it's in the lead's `shown_vehicles` and fills `interest.model` from the record, with `source_vin` on the slot. An ambiguous reference becomes a `clarify` question.
47. **Links and MMS images ship in Phase 3 (28 Sept)**, in the client's first-quality-response order. Links only from a listed record's `page_url`. Images only from a listed record's `photo_url`, chosen by code and checked (https, reachable, image type, ≤ 5 MB) before sending, with fallback down the order. Twilio `MediaUrl` support, behind a per-dealer `MMS_ENABLED` switch until the cost review is done.
48. **A stock and price question in one message (28 Sept):** stock is answered and price is left to the team. The guard still rejects prices.
49. **Phases 3+4 are done when (28 Sept)** every scenario passes live, zero grounding rejections are left after the rewrite on the offline evals, the burst test passes within budget, and the Debug UI shows per-vehicle grounding and the media choice.
50. **All vehicles are still assumed in stock (28 Sept)** through Phases 3 and 4, until C5's "Sold" outcome exists. Known gap.
51. **The 24h channel switch sends a stock-free version (28 Sept)** until Phase 5's re-check exists.
52. **`sms_vins` and `email_vins` (28 Sept)** replace a single `mentioned_vins`. Each version is checked against its own list and limit (SMS ≤ 2, email ≤ 3).
53. **Unlisted vehicle names are caught (28 Sept)** using the dealer's own makes and models plus a fixed list of common makes. A name matching none of the version's listed records is rejected.
54. **The customer's own vehicle words (28 Sept)** are allowed only when repeating what they asked for in a "not X, but …" sentence backed by this turn's search (decision 43). They never describe an offered vehicle and are never treated as a fact about stock.
40. **"Something bigger" size tiers — our own default, flagged for client feedback.** No client document or existing schema defines a body-type size ordering. Four tiers were agreed: Coupe/Convertible/Hatchback → Sedan/Wagon → SUV → Minivan/Van/Truck. "Bigger" moves up one tier, further if that tier is empty too, the same idea as the colour/trim/year loosening chain.
41. **Loosening order ends with new/used — decided 28 Sept, our default, flagged for client feedback.** Found in a Debug UI review: "anything bigger?" on a new vehicle, with nothing new in the next size tier, returned nothing instead of offering a used one. New/used is now the last loosening step (colour → trim → year ±1 → same body type any make → new/used), tried only once everything else has been loosened, so a customer's stated condition is respected until there's truly nothing else to offer.

**Still open (Phase 0 items 1, 2 and 6).** Findings so far:

- **No reliable stock/sold field.** `Vehicle` is `strict: false` with only `dealerId` defined. The one writer, the vAuto CSV import (`aidmvcs-be-dev/app/lib/import.js`), stores `salestatus` only when the feed has a `saleStatus` column. It also sets `importedAt` on every import and keeps the feed's `lastmodifieddate`. Neither is a sold flag. The n8n inventory resolver guesses from eight possible field names and returns "unknown" when none is present.
- **DMS history is not written to `vehicles`.** DealerVault ingestion reads `vehicles` by `{ dealerId, vin }` but never creates or updates a record (`app/worker/dealervault/README*.md`). Only the AI dev seed (`devtools/simulate.py`) writes customer-owned cars there. So in production, `vehicles` is the vAuto feed. The open question is whether a sold car is removed from the feed, left in place, or given a `saleStatus`.
- **Needs one real dealer's data** (the local database has only dev-seeded records): which fields are filled in, and how often `importedAt` moves for cars still on the lot.
- **Interim decision (27 Sept), until the above is resolved:** treat every record `/api/car` returns as in stock. There is no sold/available filter to apply, so none is applied. This is a real gap — a sold car can be mentioned — until item 1 is answered from real feed data. Phase 5's before-send re-check (`get_vehicle`) is also toothless against this today, since there's no sold signal for it to check either.
- **`/api/car`'s broken year filter has a call-site workaround — no route change needed.** The route's `year` parameter builds a regex against a field stored as a number, so it never matches (`filter.year = { $in: [/^2019$/i] }` against an integer field). The same route's `year_range` parameter is unaffected: it builds `{ $gte, $lte }` on the same field and runs *after* the broken `year` block, overwriting it. Passing `year_range=2019-2019` for an exact year (or `year_range=<Y-1>-<Y+1>` for Phase 2's "year ±1" loosening step) returns correct results without touching `route.js`. Per the "no edits to non-Ammer code" rule (this route is Prashanth's), `inventory_tool.py` should call it this way rather than requesting a fix to the route.

### Decided 28 Sept (MASTER_PLAN_3 Part B readiness review)

Checked against the AI service and the platform code (`aidmvcs-be-dev`). Full reasoning in `docs/report/28-9-26/NOTES.md`.

55. **One send check, C1's signature.** `can_contact(customer_id, dealer_id, lead_id, channel, purpose, is_reply, at) -> ALLOW | HOLD <until> | REVIEW <reason> | BLOCK <reason>`. Replaces B3's `may_send` (3 outcomes, different inputs). `REVIEW` stops marketing messages until a person resolves it but still lets a reply go out.
56. **Inbound conversations continue at any hour. Supersedes decision 29 for inbound leads.** A conversation the customer started (an inbound lead) is answered and continued right away whatever the customer's local time. B1's "now or during business hours?" choice is about the dealer's hours only, and "now" means now. Sources: the client's chat (`conversation_2.md`: "if he says yes i need it now then it will start communication right away"; strict rules are for outbound DealerVault drips/equity, "where a lead is more classified as an inbound task"); TCPA PDF §4 (consumer-initiated responses get "response rules"; outbound marketing gets full checks) and §7 (the time window applies to "covered outbound" attempts). **Conflicting client source, flagged for client confirmation:** blueprint box 0 says the AI "continues the conversation immediately (if within TCPA allowed hours)". Decision 29 still applies to outbound conversations (a campaign reply, a DealerVault contact). Proactive messages on an inbound lead (follow-ups, the resume message, the 24h channel switch) keep the outbound rules (decisions 24, 25).
57. **B1's "later" path is not a handoff.** At opening, the team gets a summary as a notification; the AI stays in charge and its morning message moves the conversation on (answers, then a visit offer or the next question). Staff can take over at any time: a staff reply in the conversations screen, a staff-owned status or an admin pause already pauses the AI (`lib/ai/aiStaff.js`).
58. **Known gap, tolerated until C5: old platform reminders after a move or cancel.** `PUT /api/booking` creates new reminders on a move without cancelling the old ones, cancels none on a cancel, and the reminder sender never checks booking status. C5 switches the platform's reminders off for AI dealers, which ends it. Until then the team notification says so. The AI service doesn't write to the platform's reminder records.
59. **Known gap, interim: a cancelled booking leaves the lead "Appointment Booked".** The status is left as is; the team is asked to update it; the AI's own lead state goes back to active. Not a permanent solution. The proper fix is platform code, not approved in this plan: `PUT /api/booking` on cancel cancels the lead's reminders, moves the lead to a status that isn't staff-owned and clears its booking fields; on a move it cancels the old reminders first; the reminder sender skips cancelled bookings; and the reminders' `booking_id` (which stores the lead id today) is fixed.
60. **Booking wording in the guard.** Allowed whenever the lead has a real, non-cancelled booking, read fresh from the platform each turn, not only in the turn that created it. `pending` → "requested"; `confirmed` → "confirmed" / "booked". No active booking → rejected.
61. **Visit times are in the dealership's time zone**, with the zone name added only when the customer's known zone differs. The customer travels to the dealership, and the platform's confirmation uses dealer time.
62. **When to offer a visit (B0.12).** As soon as the vehicle (model or type) and a rough buying timeframe are known, or right away on a buying signal. Budget and trade-in can wait for the dealership.
63. **`visit_followup`, a new follow-up kind (B4).** After the third declined visit offer: due on the date the customer gave, otherwise +3 days; goes through the send check; one fresh offer. Replaced by C4's cadence when C4 ships.
64. **Handoff reasons after B4.** Asked for a person and clearly upset (both already built, `slots/policy.py`); urgent need (decision 26, now built in B4, which no phase did before); declined 3 visit offers with a staff-only question still open. A staff-only question alone isn't a handoff: "the team will confirm", and the visit offers continue. `qualified` / `partly_qualified` are no longer handoffs.
65. **Inbound/outbound is decided per lead.** Campaign reply → outbound; known website/provider/phone-up source → inbound; DealerVault import (`dealervault_upload`) with no lead form of its own → outbound; anything else → outbound and reported. DealerVault is outbound because it is the dealer's DMS list of past customers, none of whom asked to be contacted now (client chat; TCPA PDF §4–5). A DealerVault customer who submits a web form has an inbound lead.
66. **Campaign texts pass the send check through a shared queue; the platform still sends them (corrected 29 Sept).** When a campaign fires, the platform's campaign worker writes one check request per lead into a shared queue collection. The AI service runs the send check and writes its answer onto that queue entry only; it never sends campaign texts and never writes platform records. The worker reads the answer: ALLOW → sends as today; HOLD → re-queues for the given time; BLOCK → marks the `CampaignLead` blocked with the reason. An ALLOW counts toward the 3-per-24h cap as soon as it's given. One copy of the rules, no live call between services, and requests wait if the AI service is down. Rejected: a per-lead HTTP call, a Node copy of the rules, a pre-computed record, and the AI service sending campaign texts itself. The campaign report already exists (`dealer/campaigns/[id]/report/page.js`, `GET /api/campaigns/[id]/report`) and is extended: `CampaignLead.status` gains `held` / `blocked` with `held_until` / `block_reason`, and the API and page count and show them. Changes how decision 31(a) is done; still within that approved platform change.
67. **The consent-ask email is on hold: the client never asked for it.** No client source mentions asking for text consent by email, "Reply YES" or buttons; it was our own 27 Sept proposal. The 28 Sept buttons design is withdrawn. Rule applied: do what the client asked. So decision 36 step 5 is not built unless the user decides otherwise, and contacts without text consent get email only. The client's consent requirements that do apply: DealerVault never creates consent; evidence, disclosure text and version are kept and immutable; missing evidence → `CONSENT_REVIEW_REQUIRED`; the AI never creates or infers consent; counsel approves the wording (TCPA PDF §2, §5, §6, §10, §12).
68. **No national Do Not Call registry check.** Marketing texts already need consent. Leads staff set to "DND" join the dealer's internal do-not-contact list.
69. **Counsel's review doesn't block building or shipping.** Part B is built with the rules decided in this section; counsel reviews them later.
70. **Two-zone states.** When only the state is known and it spans two time zones, only the hours legal in both are used. ZIP and area-code lookups use tables (`phonenumbers` for area codes). Extends decision 23.
71. **Two questions per message is its own phase, Bq,** built after C1 and before B1 (B1's choice and B4's offer each use one of the two). Implements decision 35.
72. **Resolving a REVIEW (29 Sept).** Kept: the client asks for it (TCPA PDF "Ambiguity" and §3). No review screen is built. Staff get a notification quoting the message; marketing stays stopped until the customer writes again with a non-opt-out message, or an admin resumes the AI on that lead (`resumeAiForLead`); staff setting "DND" makes it do-not-contact.
73. **Consent-ask email withdrawn for now (29 Sept),** confirming decision 67.

### Decided 29 Sept (MASTER_PLAN_3 C1 readiness review)

74. **Natural-language opt-outs.** A fixed phrase list in code ("don't text me", "leave me alone", "take me off your list", "stop contacting me", …) → opt-out (BLOCK). Extract's `possible_opt_out` with a confidence → REVIEW; the model can only make a send stricter, never allow one. Objections like "I'm not interested" aren't opt-outs (TCPA PDF §3). Today only exact keywords are caught (`channels/consent.py`).
75. **Opt-out scope and confirmation.** Keyword STOP / UNSUBSCRIBE and phrases that name a channel ("don't text me") stop that channel only. Phrases that name no channel ("stop contacting me", "leave me alone") stop all channels. **Flagged: the user questioned this; channel-only is the alternative.** A natural-language opt-out gets one plain, non-marketing confirmation on its channel; a keyword STOP gets none from us (the carrier confirms). Counsel reviews the wording later.
76. **A bare lead-form consent flag isn't consent.** AutoTrader's `TCPAOptIn: true` is kept as evidence with status "review required" (`CONSENT_REVIEW_REQUIRED`, TCPA PDF §6), not counted as consent. Changes decision 36 step 3. It only affects platform campaigns; inquiry follow-ups are still allowed by step 4. `TCPAOptIn: false` still blocks.
77. **Add-only compliance records, kept 5 years.** Consent becomes a history in `ai_consent` (each change a new entry, never edited; current state = the latest entry per customer, dealer and channel), replacing today's overwrite in place. The per-send compliance log is add-only too. Both kept 5 years (longer than the TCPA's 4-year window for lawsuits); counsel may change it.

### Decided 29 Sept (C1 build, with B2/B3)

Asked before building: all of B2 and B3 go into C1; the four platform campaign files may be edited (Prashanth's; approved for this change only); ZIP → zone from a pip package; a possible opt-out gets a plain reply; the handoff check is transactional; REVIEW at `possible_opt_out` ≥ 0.5; the cap counts texts only. Decided while building (items marked **flagged** want the user's or client's review):

78. **Purpose per message.** Replies and the AI's follow-ups (the 24h channel switch) are `marketing`; the handoff-check reply and holding replies `transactional`; the natural-language opt-out confirmation `opt_out_confirmation` (allowed even when opted out). Replies never need consent and never count toward the cap.
79. **Windows.** Marketing texts the system starts: 8:00–20:00 customer time (decision 25) and dealer hours. Transactional ones: 8:00–21:00 customer time (decision 18) and dealer hours. **Email is never held**, including the dealer-hours part of decision 24, following B3 item 1 ("Email: no time limit"). **Flagged.**
80. **An explicit no stops marketing texts, not replies.** `sms_opt_in: false` or `TCPAOptIn: false` block texts the business starts; the reply to the customer still goes (decision 36 step 1). Before C1, `sms_opt_in: false` blocked every text.
81. **Inquiry consent** covers the AI's follow-ups on a lead that is inbound, or where the customer has written to us, for 91 days from the lead. Never a campaign.
82. **Campaign check timing.** The campaign worker waits up to 20 s for the answer, then re-queues the lead after 60 s; the AI worker answers the queue every 2 s. A HOLD re-queues the lead for the time given, and it is checked again then. REVIEW is shown on the report as "Blocked: Needs review: …". Campaign emails aren't checked (decision 66 covers texts). **Flagged.**
83. **REVIEW notice.** The staff notice quoting the message is stored on the AI's lead state (`staff_notice`) and in the turn log. No platform screen shows it yet (that would need another platform change). **Flagged.**
84. **Opt-out phrases.** "Remove my number" stops SMS and AI voice; "don't call me" stops AI voice only; a phrase that names no channel stops SMS, email and voice (decision 75). A phrase naming a channel the customer isn't writing on stops that channel, sends the confirmation, and leaves the lead active.
85. **Lead sources.** The real `Lead.source` values couldn't be read (the local database has only dev leads). The inbound list is built from what the platform code writes: ADF lead-provider names, `website`, `sms`, `email`, phone-ups; `campaign` is outbound; DealerVault / DMS / import words are outbound. The dev simulator's `dev-*` sources count as website leads. Unmapped sources appear in `GET /v1/metrics` for the client to classify. **Flagged.**
86. **Old consent records** (one document per customer, overwritten in place) are turned into add-only entries at startup, and their unique index is dropped. `ai_consent` has no auto-delete; `ai_compliance_log` is deleted after 5 years.

### Decided 29 Sept (C1 closed provisionally, evening)

87. **C1 is closed provisionally**, a known bug and an incomplete opt-in/opt-out design left for later, not blocking it or the rest of Part B. Found in Debug UI testing: an opt-out currently silences the whole lead, including replies to the customer's own later messages, not just marketing (via `events/handlers.py`'s `SILENT_STATUSES`, and `engine.py`'s opt-out check running ahead of its reply check) — stricter than the TCPA PDF's "stop automated marketing" wording (decision 74). Planned fix, not built: four opt-out tiers (marketing-only, follow-up-only, full marketing+follow-up, total no-contact) crossed with channel scope, plus a matching natural-language opt-in (today only `start` / `unstop` / `yes` reverse anything, and only on the one channel that was opted out). Full plan: `docs/plans/PLAN_3/MASTER_PLAN_3.md`, "C1 extension" under Phase C1. **Flagged**, needs a decision on phrase-to-tier detection and the `yes` keyword's risk before it's built.
