# Master Plan 1 — One Developer, Correct Order

> **What this is:** [`AI/APLAN_1.md`](AI/APLAN_1.md) and
> [`BACKEND/BPLAN_1.md`](BACKEND/BPLAN_1.md) merged into one ordered list, so a
> single developer can build everything start to finish without going back.
> Each stage only depends on stages above it.
>
> **Design:** [`../architecture/architecture.md`](../architecture/architecture.md) (§N below).
> **Frameworks:** [`../architecture/FRAMEWORKS.md`](../architecture/FRAMEWORKS.md) (LangGraph, Pydantic AI, DeepEval, Langfuse, Promptfoo).
> **Why:** [`../architecture/PURPOSE.md`](../architecture/PURPOSE.md).
>
> **Where this file overrides the other two:**
>
> - [`FRONTEND/FPLAN_1.md`](FRONTEND/FPLAN_1.md) is **not used**. There's no dealer-portal work in this plan.
> - The Streamlit Dev Console in APLAN 0.6 is **replaced** by the Debug UI (Stage 3).
> - BPLAN Phase 5's dealer-UI routes are **dropped**. Only the admin routes remain (Stage 11).
>
> For anything else, the APLAN/BPLAN section named in each stage has the
> detail.

---

## Stage overview

| #  | Stage                                  | Codebase   | You can see it when                                                                                            |
| -- | -------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| 0  | Decisions                              | —         | The four answers are written into architecture §15                                                            |
| 1  | Local stack and foundations            | both       | `make ai-up` starts everything, and the worker runs a test job                                               |
| 2  | Event intake                           | AI service | An event posted by hand is queued, run once, and a duplicate is ignored                                        |
| 3  | **Debug UI**                     | AI service | A simulated lead animates through the (stub) pipeline in the browser                                           |
| 4  | Sending and template first reply       | AI service | A new lead gets a template reply in under 2s. The Send node lights up.                                         |
| 5  | Platform → AI wiring                  | platform   | A lead created in the platform reaches the Debug UI, and the reply appears in the dealer's conversation screen |
| 6  | Customer 360 check                     | platform   | 360 returns vehicles, deals, service, appointments, trade-ins                                                  |
| 7  | Slot engine                            | AI service | Slots panel shows pre-filled, missing, stale. Decide node shows which rule fired.                              |
| 8  | AI turn pipeline                       | AI service | A full chat fills a profile to "qualified", and every node shows input, reasoning and output                   |
| 9  | Campaign replies                       | AI service | A campaign reply shows the campaign in Load context and in the reply                                           |
| 10 | 24h channel switch                     | AI service | "Advance 24h" animates the message switching channel. Replying first cancels it.                               |
| 11 | No double messaging and staff takeover | platform   | A live lead gets only AI messages. A manual staff reply pauses the AI.                                         |
| 12 | Real providers and hardening           | both       | Real test SMS and email go out and come back. Burst test and eval gate pass.                                   |
| 13 | Shadow and rollout                     | both       | One real dealer in shadow, then live                                                                           |

**Rule for every stage:** its tests are written and passing, and its scenario
files (Stage 3) pass on the Debug UI Scenarios page, before the next stage
starts.

---

## Stage 0 — Decisions (half a day)

Answer these first. Later stages depend on them.

1. **Email provider.** SendGrid for AI email (the platform uses Mailgun today). Also decide the reply-to address, so customer replies still come back through the platform's Mailgun inbound route.
2. **SMS sender.** AI texts go out from the dealer's existing Twilio number, so replies keep arriving through the existing inbound SMS path.
3. **Event IDs.** `lead-created` uses the Lead ID. `inbound-message` uses the `Email` record ID.
4. **Environment flag.** `ENVIRONMENT=DEV` turns on everything debug-only. Any other value, or no value, means production behaviour. The setting's default changes from `development` to production-safe.

Write the answers into architecture §15/§16.

---

## Stage 1 — Local stack and foundations

*From BPLAN Phase 0.2 and APLAN Phases 0.1, 0.2, 0.4, 0.5.*

**Platform side (root of repo):**

1. Add these to `compose.yml` under a `dev` profile, reusing the existing MongoDB and Redis:
   - the AI service's API
   - its worker
   - the Debug UI
2. Fill the root `Makefile`:
   - `ai-up`
   - `ai-seed`
   - `ai-test`
   - `ai-scenarios`
   - `dev-full` (the stack plus the Next.js app)
3. Add the AI service URL to the platform's `.env.example`.

**AI service:**

4. **Clean up the old design.**
   - Change lead types to sales / trade-in / service / general.
   - Replace the upsell fields in the graph state with the turn fields.
   - Unregister the `/upsell/*` routes.
   - Fix stale § references in comments and tests.
5. **New settings:**
   - model names
   - time limits
   - per-dealer cap
   - channel driver (`fake` / `live`)
   - platform client (`stub` / `live`)
   - `ENVIRONMENT`
6. **Worker process** with SAQ on Redis DB 1, and a health check. (Not arq: it pins redis-py below 6, which breaks the LangGraph Redis saver.)
7. **Collections and indexes** (§10), through the dealer-scoped layer. Drop the unused session-summaries collection.
8. **Test doubles:**
   - a fake channel driver that writes to `dev_outbox`
   - a stub platform client that returns seed data
   - one controllable clock used everywhere
9. **Seed script:**
   - 2 dealers
   - about 10 customers with vehicles, service, deals, appointments and trade-ins
   - one sent campaign
   - leads of each type

**Done when:** `make ai-up` and `make ai-seed` run cleanly and a test job
round-trips through the worker.

---

## Stage 2 — Event intake

*From APLAN Phase 0.3.*

1. Add endpoints for `lead-created`, `inbound-message`, `lead-paused` and `lead-resumed` (§11).
2. Each one:
   1. checks the shared secret
   2. drops duplicate event IDs
   3. queues a job
   4. returns 202
3. `lead-paused` and `lead-resumed` only change the lead status and cancel follow-ups. The other two jobs are stubs for now.

**Done when:** posting the same event twice runs the job once. Tests cover auth failure and duplicates.

---

## Stage 3 — Debug UI

Build this **before** the real pipeline so every later stage is visible the
moment it works. It replaces FPLAN and the Streamlit Dev Console.

### 3.1 What it is

- A separate web app in `agentic-upsell/debug-ui/`, run as its own container.
- **Tech:** Vite + React + TypeScript, React Flow for the pipeline diagram, Framer Motion for animation, Tailwind for styling.
- **Connection:** only to the AI service's `/dev/*` endpoints. Never to the platform, never to production.

### 3.2 DEV-only, three layers

1. **API.** The AI service only registers `/dev/*` routes and the live trace stream when `ENVIRONMENT=DEV`. In any other environment those routes don't exist (404), and no trace events are published.
2. **Deploy.** The Debug UI container is only in the `dev` compose profile. It is never part of a production build or deployment.
3. **UI check.** On load, the Debug UI calls `/dev/ping`. If that fails, it shows "Debug UI is only available in DEV" and nothing else.

### 3.3 Where the trace comes from

- Every pipeline step reports four events: started (with its input), finished (with output, reasoning, time, tokens and cost), retried, and failed.
- In DEV these events are:
  - published live over a Redis channel
  - streamed to the browser with server-sent events (`/dev/stream`)
- The same data is saved in `ai_turn_log`, so any past turn can be replayed.
- Full prompts are stored only in DEV.

### 3.4 Screen layout (one main screen)

```
┌───────────────┬──────────────────────────────────────┬────────────────────┐
│  SIMULATOR    │        PIPELINE (animated)           │  NODE INSPECTOR    │
│               │                                      │                    │
│ lead picker   │  Load → Extract → Validate → Decide  │ Input              │
│ + new lead    │              ↓                       │ Reasoning          │
│               │  Schedule ← Send ← Guard ← Compose   │ Output             │
│ chat (SMS /   │              ↺ retry  ⤷ fallback     │ Time · tokens ·    │
│ email tabs)   │                                      │ cost               │
│               ├──────────────────────────────────────┤                    │
│ STOP button   │  SLOTS: filled / missing / stale /   │                    │
│               │         needs confirming             │                    │
├───────────────┴──────────────────────────────────────┴────────────────────┤
│  TIMELINE:  turn list · replay ◀ ▶ · speed 0.5× 1× 2× · step-by-step      │
└───────────────────────────────────────────────────────────────────────────┘
Other tabs: Scheduler · Scenarios
```

### 3.5 Animation

- **Node states:** idle (grey) → running (pulsing glow) → done (green check) → failed (red shake) → skipped (faded).
- **Data flow:** a small chip travels along each edge with a summary of what's passed on, for example "3 values found" or "Ask: mileage, payoff".
- **Validate:** each extracted value animates into an **Accepted** or **Rejected** bin. Rejected values show which of the 4 checks failed.
- **Decide:** the 5 rules are listed in order. Each is checked in turn with a sweep, and the rule that fired is highlighted with the reason, for example "4. Missing: mileage, payoff".
- **Retry and fallback:** the Guard → Compose loop lights up with a retry counter. The fallback branch lights up amber when the template is used.
- **Slots panel:** a slot animates to filled (green), needs confirming (amber) or stale (grey) the moment it changes.
- **Scheduler tab:** follow-up cards with a live countdown. When one fires, the message visibly moves from the SMS lane to the email lane. Cancelled cards strike through.
- **Replay:** any past turn replays with the same animation at 0.5×, 1× or 2×, or one step at a time.
- **Reduced motion:** respects the browser's reduced-motion setting and falls back to instant state changes.

### 3.6 What each node shows in the inspector

| Node         | Input                      | Reasoning                                                                      | Output                         |
| ------------ | -------------------------- | ------------------------------------------------------------------------------ | ------------------------------ |
| Load context | Event                      | What was loaded and why (message count, campaign found or not, pre-fill used)  | Context summary                |
| Extract      | Customer text, prompt      | Each value with its quoted words and confidence                                | Extraction result              |
| Validate     | Extraction                 | Each value × 4 checks, pass or fail                                           | Accepted and rejected values   |
| Decide       | Profile, extraction        | Rules checked in order, the one that fired and why                             | The next step                  |
| Compose      | Next step, context, prompt | A short "why I wrote it this way" note from the model (debug only, never sent) | SMS version, email version     |
| Guard        | Drafts                     | Each check's result, and the reason for any rewrite                            | Approved draft or fallback     |
| Send         | Draft                      | Channel choice, consent result, duplicate-send key                             | Provider result (fake or live) |
| Schedule     | Sent message               | Why a follow-up was or wasn't created                                          | Follow-up and due time         |

### 3.7 Other tabs

- **Scheduler:** pending, claimed, sent and cancelled follow-ups. Buttons to advance the clock by 1h or 24h, and to mark an SMS as failed.
- **Scenarios:** scripted conversations kept as data files in `agentic-upsell/scenarios/`, grouped by stage, with pass/fail and a "run" button. `make ai-scenarios` runs the same files in CI. **This page shows how far the build has got.**

### 3.8 In this stage

Build the full UI, the DEV gating, the trace stream and replay. The pipeline
nodes are **stubs** that report fake input and output, so the animation can
be built and tested now. Each later stage replaces a stub with the real node.

**Done when:**

- Creating a lead in the Simulator animates through all stub nodes live, and replay works.
- With `ENVIRONMENT` set to anything else, `/dev/*` returns 404 and the UI shows the disabled message.

---

## Stage 4 — Sending and template first reply

*From APLAN Phase 1.*

1. **Lead state** in `ai_lead_state`. The lead type comes from the lead's source.
2. **Sender.**
   - Write to `ai_messages` with a unique key before sending.
   - Check consent.
   - Send through the channel driver.
   - Retry 3 times.
   - Then call the platform's record-message endpoint (stubbed until Stage 5).
3. **First-reply templates** per lead type and channel. These are the permanent fallback.
4. **Locks and limits:** per-lead lock, and at most 10 turns running at once per dealer.
5. **First-reply flow** with the template only. The Send and Schedule nodes become real (Schedule only logs for now).

**Done when:** the Send node shows real output, a reply arrives in under 2s,
retries never double-send, and dealer isolation tests pass.

---

## Stage 5 — Platform → AI wiring

*From BPLAN Phases 1, 2, 3.*

1. **AI mode per dealer:** off (default), shadow or live. Plus a helper that reads it, cached for 60s.
2. **Event client** in `app/lib/`. 2s timeout, and failed sends go to a BullMQ retry queue. It never blocks a worker.
3. **Send `lead-created`** from `leadworker.js`.
4. **Send `inbound-message`** from `processSms.js` and `emailWorker.js`.
5. **Branch on mode:**
   - Off: as today.
   - Shadow: n8n replies and the event is also sent, marked shadow.
   - Live: the event is sent and **n8n is not called**.
6. **Record-message endpoint** in the platform. It writes an `Email` record with new **AI-generated** and **fallback** flags, plus a status-update endpoint. The AI service switches from the stub to the live call.

**Done when:** in `make dev-full`, a test lead for a live dealer shows up
animating in the Debug UI, and the AI's reply appears in the dealer's
existing conversation screen.

---

## Stage 6 — Customer 360 check

*From BPLAN Phase 5, Customer 360 part only.*

1. Confirm `/api/customers/[id]/360` returns:
   - vehicles
   - deals
   - service records
   - service appointments
   - trade-ins
2. Add anything missing.
3. Update the AI service's stub platform client to return the same shape.

**Done when:** the live and stub clients return the same fields for a seeded customer.

---

## Stage 7 — Slot engine

*From APLAN Phase 2.*

1. **Slot list** (§8.1): type, validation rule, priority, staleness period and ask hint for each slot.
2. **Required slots per lead type**, including trade-in slots when "has a trade" is yes.
3. **Profile builder:** each slot is current, stale or needs confirming. Stale counts as missing.
4. **Pre-fill** from Customer 360 on a lead's first turn.
5. **Writer:** saves the source, closes the old value instead of overwriting, and refuses AI guesses.
6. **Decide:** the five-rule order as a pure function.
7. **Profile endpoint** (§11).
8. The Load context and Decide nodes become real.

**Done when:** the Slots panel shows a seeded customer's pre-filled profile,
the Decide node animates the rule that fired, and the table-driven tests
pass for every lead type.

---

## Stage 8 — AI turn pipeline

*From APLAN Phase 3.*

1. **Extract** (cheap model, typed output with quotes and confidence).
2. **Validate** (4 checks).
3. **Compose**: stronger model. It returns the SMS version, the email version and a debug-only "why" note.
4. **Guard**: invented numbers and channel format, one rewrite, then template fallback.
5. **Limits:** 3s extract, 5s compose, 4 AI calls, and 8s (first reply) or 20s (other replies) per turn.
6. **Inbound flow:**
   1. cancel follow-ups first
   2. STOP → opted out
   3. handed off, paused or opted out → save only
   4. batch all unanswered messages into one turn
7. **First reply** switches from template-only to AI, with the template as the 8s fallback.
8. **Langfuse trace** per turn, and its trace ID stored in `ai_turn_log`.
9. **All nodes are now real.** Remove the stubs.

**Done when:** a Simulator chat fills a sales and a trade-in profile to
"qualified". Every node shows real input, reasoning and output. The DeepEval
extraction tests pass.

---

## Stage 9 — Campaign replies

*From APLAN Phase 4.*

1. If our last outbound message to this customer in the past 14 days was a campaign message, load the campaign's text and goal.
2. Pass them to Compose.

**Done when:** replying to the seeded campaign shows "campaign found" in Load context, and the reply refers to the campaign.

---

## Stage 10 — 24h channel switch

*From APLAN Phase 5.*

1. **Schedule** a follow-up for the other channel after every non-fallback send.
2. **Fire.** A scheduled job runs every minute and claims due follow-ups atomically.
   1. Check again for a reply, consent and lead status.
   2. Send the stored alternate version.
   3. Never fall back twice.
3. **Stuck claims** older than 5 minutes are reset.
4. **Delivery webhooks** (Twilio status, SendGrid events):
   - update message status, in `ai_messages` and through the platform status endpoint
   - a failed SMS fires its follow-up immediately
   - an unsubscribe turns off consent
5. **Profile endpoint** now includes the pending follow-up.

**Done when:** on the Scheduler tab, "advance 24h" animates the switch,
replying first cancels it, and the two-worker race test sends exactly once.

---

## Stage 11 — No double messaging and staff takeover

*From BPLAN Phase 4 and the admin routes from Phase 5.*

1. Prove with a test that n8n is never called for a live dealer's lead.
2. **Pause `FollowUpJob`** for live leads, and clear pending jobs when a dealer is switched to live.
3. **Manual staff reply** through `conversations/reply` sends `lead-paused`.
4. **Admin-only API routes:**
   - read and change a dealer's AI mode
   - resume a paused lead (sends `lead-resumed`)

**Done when:** the scenario new lead → AI reply → no answer for 24h → switch
→ staff reply produces exactly the AI's messages. After that, the AI stays
silent, and nothing comes from n8n or `FollowUpJob`.

---

## Stage 12 — Real providers and hardening

*From APLAN Phase 6.*

1. **Live Twilio and SendGrid drivers**, using the Stage 0 decisions. An allowlist of test numbers and addresses applies outside production.
2. **Real test messages**: send, reply, confirm the reply comes back through the platform.
3. **Burst test:** 300 campaign replies for one dealer in 10 minutes.
   - No failures.
   - Other dealers aren't slowed.
   - First replies stay under 8s.
4. **Eval gate in CI:** DeepEval and Promptfoo, required on prompt and graph changes.
5. **Metrics tab** in the Debug UI:
   - first-reply time
   - template-fallback rate
   - guard failures
   - rejected extractions
   - cost per dealer
   - qualified rate

**Done when:** the burst test and eval gate pass, and a real SMS and email round trip works.

---

## Stage 13 — Shadow and rollout

*From APLAN Phase 7 and BPLAN Phase 6.*

1. **Shadow mode:** turns run fully, but the message is stored as "shadow" and not sent. No follow-ups.
2. **Shadow for one dealer** for one week. Compare AI drafts with what n8n sent in the Debug UI (on a DEV copy of the data, never against production).
3. **Go live** with that dealer, watch the metrics for a week, then add dealers one at a time.
4. **Rollback** is setting the dealer back to off, which takes effect within 60s.

**Done when:** one dealer has been live for a week with no double messages and no lost replies.

---

## Not in this plan

- Dealer-portal UI (FPLAN)
- Upselling
- Inventory search
- Booking through the bot
- Pricing
