# AI Layer Implementation Plan — APLAN 1

> **Owner:** AI developer. Only touches `agentic-upsell/**`.
> **Builds:** [`../../architecture/architecture.md`](../../architecture/architecture.md). Section numbers below (§N) refer to that file.
> **Why:** [`../../architecture/PURPOSE.md`](../../architecture/PURPOSE.md).
> **Partner plan:** [`../BACKEND/BPLAN_1.md`](../BACKEND/BPLAN_1.md). The platform side (events, conversation screen, per-dealer switch).

---

## How to read this plan

- Build the phases in order. Each phase ends with something you can **see
  working in the Dev Console** (Phase 0). "Done when" is the check.
- Every phase ships with tests. A phase isn't done if its tests aren't in CI.
- This plan never waits on the backend developer. Until the platform sends
  real events, the Dev Console plays the platform's role and calls our event
  endpoints directly.

---

## Phase overview

| Phase | Goal | Done when (seen in Dev Console) |
|---|---|---|
| **0** | Foundations + Dev Console | Create a fake lead → a job runs → a hard-coded reply appears in the outbox |
| **1** | Sending + instant first reply (templates, no AI yet) | A new lead gets a template reply in under 2s. Retrying a job never double-sends. |
| **2** | Slot engine (pure code) | Profile panel shows filled / missing / stale / needs-confirming slots. Next step is correct for every lead type. |
| **3** | Turn pipeline with AI | Chat as a customer. Slots fill from your replies. Trace panel shows every step. |
| **4** | Campaign replies | Reply to a seeded campaign message → the AI's answer refers to the campaign |
| **5** | 24h channel switch | Advance the clock 24h → the same message appears on the other channel. Replying first cancels it. |
| **6** | Real providers + hardening | Real SMS/email to test numbers. Burst test passes. Evals gate CI. |
| **7** | Shadow mode + rollout | One real dealer in shadow: AI drafts are visible but not sent |

---

## Phase 0 — Foundations and Dev Console

### 0.1 Clean up the old design

- Change the lead type list to **sales / trade-in / service / general** (§8.2).
- Replace the old upsell fields in the graph state with the turn fields:
  - profile
  - extraction
  - decision
  - draft
  - retry count
- Unregister the `/upsell/recommend` and `/upsell/feedback` routes. Keep the files for later.
- Add settings:
  - model names for extract and compose
  - time limits (§7)
  - per-dealer turn cap (10)
  - channel driver: `fake` or `live`
  - platform client: `stub` or `live`
  - a dev-mode switch
- Fix the stale § references in code comments and tests.

### 0.2 Worker process

- Add SAQ (not arq, which conflicts with the LangGraph Redis saver). Create the worker entrypoint on Redis DB 1 (the same logical DB as the checkpointer).
- The worker and API both start from one codebase with two commands (§2).
- Health check covers MongoDB and Redis.

### 0.3 Event endpoints (§11)

- Add `lead-created`, `inbound-message`, `lead-paused` and `lead-resumed`.
- `lead-paused` sets the lead to paused and cancels its pending follow-ups. `lead-resumed` sets it back to active.
- Each one:
  1. checks the shared secret
  2. drops duplicates using the event ID (`ai_events`, 7-day auto-delete)
  3. queues a job
  4. returns 202
- The jobs are empty stubs for now. They log and exit.

### 0.4 Collections and indexes (§10)

Create these with their indexes, all through the existing dealer-scoped layer:

- `ai_lead_state`
- `ai_messages`
- `scheduled_followups`
- `ai_events`
- `ai_turn_log`

Keep `qualification_facts`. Drop `qualification_session_summaries`, which the new architecture doesn't use.

### 0.5 Test doubles

- **Fake channel driver:** "sending" writes to a `dev_outbox` collection instead of calling Twilio or SendGrid. It's used in dev and in tests.
- **Stub platform client:** returns Customer 360 data from the seed data, so the AI work doesn't need the Next.js app running.
- **Controllable clock:** all "now" values come from one clock the Dev Console can move forward. Needed for Phase 5.

### 0.6 Dev Console

A small internal web app for checking progress. It is never deployed to
production.

- **Tech:** Streamlit, in `agentic-upsell/devconsole/`, run as its own process.
- **How it talks to the service:** only over HTTP, through the public endpoints plus a set of `/dev/*` endpoints.
- **Where `/dev/*` exists:** only when dev mode is on. In production those routes are not registered at all.
- **Seed script** (`make ai-seed`) loads the local MongoDB with:
  - 2 dealers (to test isolation)
  - about 10 customers with vehicles, service history, deals, appointments and trade-ins
  - one campaign with sent `CampaignLead` records
  - leads of each type

**Pages:**

| Page | Shows | Lets you |
|---|---|---|
| **Simulator** | A chat window per lead, with SMS and email tabs | Create a new lead (dealer, lead type, channel, comments). Reply as the customer. Send STOP. |
| **Lead inspector** | Lead status, profile slots (filled, missing, stale, needs confirming, with the source of each), message timeline (channel, fallback marker, delivery status) | Hand a lead back to the AI (resume) |
| **Turn trace** | For each turn: what was extracted, what was rejected and why, the decision, both drafts, guard results, time, cost, Langfuse link | Inspect why the AI said something |
| **Scheduler** | Pending, claimed, sent and cancelled follow-ups with due times | Advance the clock by 1h or 24h. Mark an SMS as failed. |
| **Progress** | Every scenario (below) with pass/fail and last run time, grouped by phase | Run all scenarios, or run one |

**Scenarios.** Scripted end-to-end conversations kept as data files in
`agentic-upsell/scenarios/`. Each one says what happens and what must be
true afterwards. Example: "new sales lead by SMS → reply within 8s → customer
says '2019 Civic, about 60k' → trade-in mileage is 60,000". Each phase adds
its scenarios. The Progress page and `make ai-scenarios` (used in CI) run the
same files. **This is how everyone sees how far the implementation has got.**

**Done when:** `make ai-up` starts MongoDB, Redis, the API, the worker and
the console. Creating a lead in the Simulator shows a hard-coded reply in the
timeline. The Progress page lists the Phase 0 scenarios as passing.

---

## Phase 1 — Sending and instant first reply (no AI yet)

1. **Lead state.** Create and update `ai_lead_state`: lead type from the lead's source (a mapping table in code), status, and last inbound and outbound times.
2. **Sender (§9).**
   - Write the message to `ai_messages` with a unique key per turn and channel **before** sending.
   - Check consent.
   - Send through the channel driver.
   - Save the provider ID and status.
   - Retry up to 3 times with growing delays.
   - Then call the platform's record-message endpoint so the message shows in the dealer's conversation view (BPLAN Phase 3). Use the stub platform client until that endpoint exists.
3. **Templates.** One first-reply template per lead type and channel (SMS ≤ 320 characters; email subject and body). These stay as the permanent fallback.
4. **Concurrency (§12).**
   - Per-lead Redis lock. A job that finds the lock taken retries in 2s.
   - Per-dealer cap of 10 turns running at once. Extra jobs wait.
5. **First-reply flow (§4)** wired end to end using the template only. Record the time from event to send.

**Tests:**
- The same event twice sends one message.
- A job retry after a successful send doesn't send again.
- An opted-out channel is skipped.
- Two jobs for one lead run one after the other.
- Dealer B's lead can't be touched while working as dealer A.

**Done when:** the Phase 1 scenarios pass and the Simulator shows the template reply in under 2s.

---

## Phase 2 — Slot engine (plain code, no AI)

1. **Slot list (§8.1).** One file listing every slot with:
   - type
   - validation rule
   - ask priority
   - staleness period
   - a short "what to ask for" hint

   Repeating groups (vehicles, service records, appointments) are supported.
2. **Required slots per lead type (§8.2),** including "has a trade = yes" pulling in the trade-in slots.
3. **Profile builder.** Reads `qualification_facts` and returns each slot's current value. Each value is marked current, stale or needs confirming. Stale counts as missing.
4. **Pre-fill.** On a lead's first turn, fill slots from Customer 360 (vehicles, deals, service records, appointments, trade-ins). The source is saved as "platform record".
5. **Writer (§8.4).**
   - Saves a value with its source and the message it came from.
   - Closes the previous value with an end date instead of overwriting it.
   - Refuses anything with source "AI guess".
6. **Decide (§8.3).** The five-rule order:
   1. stop
   2. hand off
   3. confirm
   4. ask up to 2
   5. qualified

   It's a pure function with no database or AI access.
7. **Profile endpoint** `GET /v1/leads/{id}/profile`. It returns exactly the fields the frontend relies on (FPLAN "Fields you can rely on"):
   - slots grouped, each with state, source, source message, captured time and earlier values
   - missing slots
   - required progress
   - lead status and reason
   - the pending follow-up (added in Phase 5)

**Tests:** table-driven tests that cover every lead type with:
- nothing filled
- partly filled
- a stale value
- a value that needs confirming
- the trade-in condition
- everything filled

Most of this plan's unit tests live here.

**Done when:** the Lead inspector shows the pre-filled profile for seeded customers, and a "next step" preview matches the expected step for every scenario profile.

---

## Phase 3 — Turn pipeline with AI

1. **Graph (§7):** load context → extract → validate → decide → compose → guard. One retry loop from guard back to compose. Fallback to the template.
2. **Extract.** Pydantic AI with the cheap model. Typed result:
   - values found, each with the exact customer words it came from and a confidence score
   - questions the customer asked
   - whether they want a human
   - whether they're upset
   - a lead type hint
3. **Validate.** The four checks (§7):
   1. the slot exists
   2. the value is valid
   3. the quoted words appear in the customer text
   4. confidence ≥ 0.7, otherwise "needs confirming"

   Rejections are logged with the reason.
4. **Compose.** Pydantic AI with the stronger model. Always returns an SMS version and an email version. The prompt gets:
   - the decision
   - a short profile summary
   - the last 20 messages
   - campaign context, when there is one
5. **Guard.** The existing invented-numbers check plus a channel format check (length, subject present). One rewrite. A second failure sends the template and flags the lead for a human.
6. **Limits (§7).**
   - Extract: 3s.
   - Compose: 5s per attempt.
   - At most 4 AI calls per turn.
   - Whole turn: 8s for a first reply, 20s otherwise.
   - Any limit hit sends the template.
7. **Inbound flow (§5).**
   1. Cancel pending follow-ups first.
   2. STOP or UNSUBSCRIBE → opted out, no reply.
   3. Lead handed off, paused by staff, or opted out → save only.
   4. Take the lock and batch all unanswered messages into one turn.
   5. Reply on the same channel.
8. **First reply uses the AI.** Extract runs on the lead's own comments. The template stays as the fallback when the 8s limit is hit.
9. **Logging.** One Langfuse trace per turn, and one `ai_turn_log` record with the trace ID.

**Tests:**
- Extraction accuracy with DeepEval, against examples from `docs/data/conversations.md`.
- Invented numbers are always blocked.
- A timeout sends the template.
- Three quick texts produce one reply.

**Done when:** a full chat in the Simulator fills a sales and a trade-in profile to "qualified". The Turn trace shows every step. The Phase 3 scenarios pass.

---

## Phase 4 — Campaign replies

1. **Attribution.** When loading context, check whether our most recent outbound to this customer in the last 14 days was a campaign message (the platform's `CampaignLead`). If so, load the campaign's text and goal.
2. Pass the campaign context to Compose. After that, the normal slot flow continues.

**Tests:**
- A reply within 14 days picks up the campaign.
- A reply after 14 days, or to a non-campaign message, doesn't.

**Done when:** replying to the seeded campaign in the Simulator gives an answer that refers to the campaign, and the Turn trace shows the campaign ID.

---

## Phase 5 — 24-hour channel switch

1. **Schedule (§6).** After every non-fallback send, create a follow-up for the other channel, due in 24h. This only happens if we have that contact and the customer hasn't opted out.
2. **Fire.** A scheduled job runs every minute on every worker.
   1. It claims due follow-ups one at a time with a single atomic update.
   2. It checks again for a customer reply, and checks consent and lead status.
   3. It sends the stored alternate version (no AI call).
   4. It marks the follow-up sent.
   - A fallback never schedules another fallback.
3. **Stuck claims.** A claim older than 5 minutes that wasn't sent goes back to pending.
4. **Delivery webhooks.**
   - The Twilio status and SendGrid event endpoints update message status.
   - A failed or undelivered SMS makes its follow-up due immediately.
   - SendGrid unsubscribes turn off email consent.
   - Signatures are checked on both.

**Tests:**
- Two workers race for one follow-up and only one sends.
- A reply arriving one second before the due time cancels the follow-up.
- A worker crash mid-send leads to a reset, then exactly one send.
- The clock is moved in tests; no real waiting.

**Done when:** in the Scheduler page, "advance 24h" sends the email version of an unanswered SMS. Replying first moves the follow-up to cancelled. "Mark SMS failed" fires it straight away.

---

## Phase 6 — Real providers and hardening

1. **Live drivers.** Twilio (Messaging Service per dealer) and SendGrid (dealer sender address, reply-to agreed with the backend, BPLAN Phase 0). Credentials come from environment or dealer config. Never in code.
2. **Test on real phones and inboxes** with the team's test numbers only. Keep an allowlist in non-production environments.
3. **Burst test.** Simulate 300 campaign replies for one dealer in 10 minutes.
   - No failures.
   - Other dealers' reply times aren't affected.
   - First replies stay under 8s.
4. **Eval gate in CI.** DeepEval (extraction and reply quality) and Promptfoo (prompt-injection attempts) run on every change to prompts or the graph. A failure blocks the merge.
5. **Numbers.** A Dev Console page and a simple report showing:
   - first-reply time
   - template-fallback rate
   - guard failures
   - rejected extractions
   - cost per dealer per day
   - qualified-lead rate

**Done when:** the burst test passes, the eval gate is required in CI, and a real test SMS and email go out and come back.

---

## Phase 7 — Shadow mode and rollout

Depends on BPLAN Phases 1–3.

1. **Shadow mode.** When the platform marks a dealer as "shadow", every turn runs fully but the sender records the message as "shadow" instead of sending it. No follow-ups are scheduled.
2. **Compare.** For one week, compare our shadow drafts with what n8n actually sent (the platform's conversation records) in the Dev Console. Review a sample by hand.
3. **Go live** for one dealer, then more, one at a time.

**Done when:** one dealer runs live with n8n auto-replies off for them, and the metrics from Phase 6 are within agreed limits.

---

## Handoffs with the backend developer

| When | What we agree | Their side | Our side |
|---|---|---|---|
| Before Phase 1 | Event payloads for `lead-created`, `inbound-message`, `lead-paused`, `lead-resumed` (§11), and event ID rules | Send them from the platform workers and staff actions | Accept them |
| Before Phase 2 | Profile endpoint fields | Proxy route for the dealer UI | Return exactly those fields |
| Before Phase 1 | How we record AI messages in the platform's conversation list | Internal endpoint that writes an `Email` record | Call it after every send |
| Before Phase 2 | Customer 360 has everything the slots need (vehicles, service, deals, appointments, trade-ins) | Add missing fields | Pre-fill from it |
| Before Phase 6 | SendGrid sender and reply-to addresses so replies come back through the existing inbound email route | Mail setup | Use them in the live driver |
| Before Phase 7 | Per-dealer mode: off / shadow / live | Store it, send it with each event | Respect it |

---

## Out of this plan

- Upselling
- Inventory search
- Booking appointments through the bot
- Pricing
- Dealer-facing UI (see `../FRONTEND/FPLAN_1.md`)
