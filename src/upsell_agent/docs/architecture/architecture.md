# agentic-upsell — Technical Architecture

> What the service does and why: [`PURPOSE.md`](PURPOSE.md).
> Libraries and why each was picked: [`STACK.md`](STACK.md), [`FRAMEWORKS.md`](FRAMEWORKS.md).

---

## 1. Architecture diagram

```
   ┌──────────┐        ┌──────────────────────────┐
   │   DMS    │──lead─▶│  aidmvcs-be-dev (Next.js)│◀── customer replies (SMS / email)
   └──────────┘        │  saves Lead & Customer   │
                       └────────────┬─────────────┘
                                    │  event: "new lead" / "new reply"
                                    ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  API process (FastAPI)                                                   │
   │  checks shared secret → ignores duplicates → puts a job on the queue     │
   └────────────────────────────────────┬─────────────────────────────────────┘
                                        │  job queue (SAQ on Redis)
                                        ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  WORKER process (SAQ)                                                    │
   │                                                                          │
   │   ┌───────────────────── Turn pipeline (LangGraph) ────────────────────┐ │
   │   │                                                                    │ │
   │   │  Load     ─▶  Extract  ─▶  Validate ─▶  Decide  ─▶ Compose ─▶ Guard│ │
   │   │  context      (AI)         (code)       (code)     (AI)      (code)│ │
   │   │                                                                    │ │
   │   └──────────────────────────────────────┬─────────────────────────────┘ │
   │                                          │ approved draft                │
   │                                          ▼                               │
   │   ┌──────────────┐   schedule    ┌───────────────┐                       │
   │   │  Scheduler   │◀──────────────│    Sender     │──▶ Twilio  (SMS)      │
   │   │  (24h check) │──── resend ──▶│               │──▶ SendGrid (email)   │
   │   └──────────────┘               └───────────────┘                       │
   └──────────────────────────────────────────────────────────────────────────┘
          │                    │                        │
          ▼                    ▼                        ▼
   ┌─────────────┐     ┌───────────────┐        ┌─────────────┐
   │  MongoDB    │     │    Redis      │        │  Langfuse   │
   │ facts, msgs,│     │ queue, locks, │        │  traces     │
   │ follow-ups  │     │ graph state   │        │             │
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
   - The lead is handed to a human or opted out → save the message and don't reply.
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
- **Firing.** A scheduled job runs every minute on every worker.
  1. It claims due follow-ups one at a time with a single atomic database update, so two workers can never send the same one.
  2. Just before sending, it checks again whether the customer has replied. If so, it cancels.
- **Sending.** It sends the **same message** on the other channel. Compose writes both an SMS version and an email version up front, so no AI call is needed at this point.
- **Once only.** A switched message never schedules another switch.
- **Failed SMS.** If Twilio reports an SMS as failed or undelivered, the follow-up fires immediately instead of waiting 24 hours.
- **Stuck claims.** A worker can crash mid-send. A claim older than 5 minutes that hasn't been sent is put back as due.

**Why MongoDB and not delayed queue jobs:** cancelling is one database
update, the schedule survives a Redis restart, and the dealer UI can show
pending follow-ups.

---

## 7. The turn pipeline (LangGraph)

| Step | Who | What happens |
|---|---|---|
| **Load context** | Code | Loads the lead's AI state, the customer's current profile (slots), the last 20 messages, and campaign info if relevant. On the first turn, the profile is pre-filled from the platform's Customer 360 data (vehicles, deals, service records, appointments). |
| **Extract** | AI, cheap model | Reads the new customer text. Returns found values, each with the exact words it came from and a confidence score. Also returns: questions the customer asked, whether they want a human, whether they sound upset. |
| **Validate** | Code | Accepts a value only if all four checks pass (below). Rejected values are logged. |
| **Decide** | Code | Picks exactly one next step (§8.3). |
| **Compose** | AI, stronger model | Writes the message for that step: an SMS version (max 320 characters) and an email version (subject + body). |
| **Guard** | Code | Blocks invented prices, trade-in values, approvals or availability, and checks channel format. A failure gets **one** rewrite. A second failure sends a safe template and flags the lead for a human. |

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
2. Customer wants a human or is upset → **hand off** (the AI pauses on this lead until staff resume it).
3. A value needs confirming → **confirm** it.
4. Required slots are missing or stale → **ask** for up to 2 of them, highest priority first, and answer any question the customer asked.
5. Nothing missing → **qualified**: notify the dealer, answer questions, stop asking.

The same profile and the same customer message always produce the same next
step.

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
| `ai_lead_state` | Per lead: lead type, status (active / qualified / handoff / paused / opted out) and the reason, last inbound and outbound times |
| `qualification_facts` | Slot values with source, dates and replace history (exists) |
| `ai_messages` | Every inbound and outbound message: channel, text, SMS and email versions, campaign ID, delivery status |
| `scheduled_followups` | Pending, claimed, sent or cancelled channel switches with due time |
| `ai_events` | Event IDs already processed (auto-deleted after 7 days) |
| `ai_turn_log` | Per turn: what was extracted, what was rejected, the decision, drafts, guard results, cost, time (auto-deleted after 90 days) |
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

Progress and per-file changes: `docs/plans/PLAN_1/progress_1.md`.

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
