# agentic-upsell — Technical Architecture

> What the service does and why: [`PURPOSE.md`](PURPOSE.md).
> Libraries and why each was picked: [`STACK.md`](STACK.md), [`FRAMEWORKS.md`](FRAMEWORKS.md).
> This file covers how it's built: processes, pipeline, data, and contracts.

---

## 1. Runtime overview

One Python codebase, deployed as two processes that share MongoDB and Redis
with `aidmvcs-be-dev`.

```
                aidmvcs-be-dev (Next.js)                          Twilio / SendGrid
   DMS ──▶ saves Lead/Customer, receives customer replies        (delivery webhooks)
                      │ POST /v1/events/*  (shared secret)               │
                      ▼                                                  ▼
 ┌───────────────────────── api  (FastAPI + Uvicorn) ─────────────────────────────┐
 │ validate → dedupe on event_id → enqueue job → 202            status webhooks   │
 └──────────────────────────────────┬─────────────────────────────────────────────┘
                                    │ arq job (Redis db 1)
 ┌──────────────────────────────────▼─────────────── worker  (arq) ───────────────┐
 │ handle_lead_created / handle_inbound      fire_due_followups (cron, every 60s) │
 │   1. per-lead lock + per-dealer limit        claim due → re-check reply →      │
 │   2. pre-checks (opt-out, paused)            send alt-channel variant          │
 │   3. run turn graph (LangGraph) ───────┐                                       │
 │   4. idempotent send  ─────────────────┼──▶ channels/ ──▶ Twilio SMS           │
 │   5. schedule 24h fallback             │                  SendGrid email       │
 └────────────────────────────────────────┼───────────────────────────────────────┘
                                          ▼
      Turn graph: load_context → extract → validate → decide → compose → guard
                     (Pydantic AI for extract + compose; everything else plain code)

  MongoDB: platform collections (read) + ai_* / qualification_* collections (owned)
  Redis:   arq queue, locks, dealer semaphores, LangGraph shallow checkpoints
  Langfuse: one trace per turn, mirrored to ai_turn_log
```

| Process | Entrypoint | Does |
|---|---|---|
| `api` | `uvicorn upsell_agent.main:app` | Accepts events and provider webhooks, enqueues jobs. No LLM calls, no sends. |
| `worker` | `arq upsell_agent.worker.main.WorkerSettings` | Runs every job: turns, sends, the follow-up cron. Scales horizontally. |

**The rule behind the whole design:** the LLM only does two things, extract
slot values and write text. Classification, next-question choice,
completeness, timing and channel choice are all pure functions in code.

---

## 2. Components

| Component | Module | Tech | Responsibility |
|---|---|---|---|
| Event API | `api/routes_events.py` | FastAPI, Pydantic | Ingress contract (§7), shared-secret auth (`api/auth.py`), `event_id` dedupe |
| Webhooks | `api/routes_webhooks.py` | FastAPI, `twilio` / SendGrid signature verify | Delivery status → `ai_messages.status` |
| Job runner | `worker/main.py`, `worker/jobs.py` | **arq** (asyncio, Redis) | Job handlers, retries with backoff, cron |
| Concurrency | `worker/locks.py` | Redis `SET NX PX`, counters | Per-lead lock, per-dealer in-flight cap |
| Turn graph | `agent/graph.py`, `agent/nodes/*` | **LangGraph** + `AsyncShallowRedisSaver` | One conversation turn, bounded retry loop |
| LLM calls | `agent/nodes/extract.py`, `compose.py` | **Pydantic AI** (OpenAI provider) | Typed outputs, `UsageLimits`, timeouts |
| Slot engine | `slots/schema.py`, `profile.py`, `policy.py`, `validators.py` | Pydantic, pure Python | Slot definitions, current profile, `next_action()` |
| Guardrails | `guardrails/never_invent.py` (built), `guardrails/channel_format.py` | Pure Python | Block invented numbers, enforce SMS/email format |
| Channels | `channels/sender.py`, `twilio_sms.py`, `sendgrid_email.py`, `consent.py` | `twilio`, `sendgrid` SDKs | Idempotent send, consent check |
| Scheduler | `scheduler/followups.py` | MongoDB + arq cron | Schedule, cancel, atomically claim 24h fallbacks |
| Data access | `integrations/mongodb.py` (built) | Motor | `DealerScopedDatabase`, the only way to touch per-dealer data |
| Platform reads | `integrations/autopulse_api_client.py` (built) | httpx | Customer 360 for pre-filling slots |
| Tracing | `observability/tracing.py` | Langfuse | Per-turn trace, mirrored to `ai_turn_log` |

New dependencies: `arq`, `twilio`, `sendgrid`.

---

## 3. Pipelines

### 3.1 New lead → first reply (Job 1)

```
POST /v1/events/lead-created {event_id, dealer_id, lead_id, customer_id, channel}
  api:    insert ai_events{_id: event_id} (unique) → dup? return 200 : enqueue handle_lead_created → 202
  worker: acquire lock(dealer:lead) + dealer slot
          pre-checks: consent for channel, ai_lead_state.status == active
          graph(trigger=lead_created, deadline=8s)
             extract runs over the lead's own comments ("trading my 2018 Civic")
          on deadline/LLM error → template[lead_type] from slots/templates.py
          send via channel of origin → schedule fallback (§3.4)
```

**Latency target:** p95 under 8s from event to provider accept. There's no
business-hours wait (see [`PURPOSE.md`](PURPOSE.md)). Hitting the deadline
never blocks the send; the template is the floor.

### 3.2 Customer reply → next message (Jobs 2 and 3)

```
POST /v1/events/inbound-message {event_id, dealer_id, customer_id, lead_id?, channel, message_id, text, received_at}
  api:    dedupe → enqueue handle_inbound → 202
  worker:
    1. cancel_pending_followups(lead)             ← always first, before anything can fail
    2. deterministic pre-checks, no LLM:
         STOP/UNSUBSCRIBE keywords → consent off, status=opted_out, no reply
         status in {handoff, opted_out} → save message only, no reply
    3. acquire lock(dealer:lead); if held → re-enqueue with 2s defer
    4. collect ALL unanswered inbound for this lead (handles 3 texts in a row as one turn)
    5. graph(trigger=inbound)
    6. send on the channel the customer just used → schedule fallback
```

**Campaign replies (Job 3)** go through the same pipeline. `load_context`
attributes the reply to a campaign when the customer's latest outbound
message within 14 days carries a `campaign_id` (from `CampaignLead`). The
campaign's `body` and `goal` are then added to the compose prompt. The AI
never selects recipients or sends campaign messages.

### 3.3 Turn graph (LangGraph)

```
load_context ─▶ extract ─▶ validate ─▶ decide ─▶ compose ─▶ guard ─┬─▶ END (OutboundDraft)
                                                    ▲              │
                                                    └── retry ×1 ──┤
                                                                   └─▶ fallback_template ─▶ END
```

| Node | Kind | Input → Output |
|---|---|---|
| `load_context` | code | Mongo: `ai_lead_state`, current profile (§4), last 20 messages, campaign context. Profile is pre-filled from Customer 360 on the first turn. |
| `extract` | **LLM** (cheap model) | New customer text → `SlotExtraction` (below) |
| `validate` | code | Keeps only valid updates, flags the rest for confirmation |
| `decide` | code | `slots.policy.next_action(profile, lead_type, extraction, flags) → Action` |
| `compose` | **LLM** (strong model) | `Action` + profile summary + recent messages + campaign → `ComposedMessage` |
| `guard` | code | `never_invent` + `channel_format`. Fail → one rewrite, then fallback template + `flag_for_human` |

The graph **returns a draft and doesn't send**. The worker owns side
effects (persist, send, schedule), so graph retries can never double-send.
Thread ID: `f"{dealer_id}:{lead_id}"` (`memory/short_term.thread_id_for`).
The Redis checkpoint only holds in-turn scratch state, like the retry count,
so a crashed worker can resume. MongoDB is the source of truth. An expired
checkpoint costs nothing because `load_context` rebuilds from Mongo every
turn.

**LLM contracts (Pydantic AI `output_type`):**

```python
class SlotUpdate(BaseModel):
    path: str             # must exist in slots.schema, e.g. "trade_in.mileage", "vehicles[new].make"
    value: str | int | float | bool
    quote: str            # exact span of customer text it came from
    confidence: float     # 0..1

class SlotExtraction(BaseModel):
    updates: list[SlotUpdate]
    customer_questions: list[str]
    lead_type_hint: LeadType | None
    wants_human: bool
    negative_sentiment: bool

class ComposedMessage(BaseModel):
    sms_text: str                 # ≤ 320 chars (2 segments)
    email_subject: str
    email_body: str
```

`compose` always produces **both channel variants**. The 24h fallback sends
the stored alternate variant, so it needs no LLM call at fire time and is
fully deterministic.

**Budgets** (Pydantic AI `UsageLimits` + `asyncio.timeout`, values in
`config.py`):

| | extract | compose (each attempt) | whole turn |
|---|---|---|---|
| Timeout | 3s | 5s | 8s first reply, 20s otherwise |
| Requests | 1 | 1 | 4 |
| Output tokens | 500 | 600 | — |

### 3.4 Silence → channel fallback (Job 4)

```
after every send from this service (not from a fallback):
  if other channel has contact + consent:
    insert scheduled_followups{dealer_id, lead_id, source_message_id,
      to_channel, due_at: now+24h, status: pending}

cron fire_due_followups (every 60s, each worker; safe to overlap):
  loop:
    doc = find_one_and_update({status: pending, due_at <= now},
                              {$set: {status: claimed, claimed_at: now}})   ← atomic claim
    if none: break
    if inbound exists for lead after source_message.sent_at → status=cancelled; continue
    if consent/state changed → status=cancelled; continue
    send source_message's alt variant on to_channel (is_fallback=true) → status=sent
    stale claims (claimed > 5 min, not sent) are reset to pending by the same cron
```

- Any inbound message cancels with `update_many({lead_id, status: pending}, {$set: {status: cancelled}})`, which is step 1 of §3.2.
- One switch per message: fallback sends never schedule another fallback.
- A Twilio `failed`/`undelivered` status callback sets `due_at = now` on that message's follow-up, so the switch happens immediately.
- Why Mongo and not arq delayed jobs: cancellation is one indexed update, the schedule survives a Redis flush, and the platform UI can query it directly.

---

## 4. Slot engine

### 4.1 Schema (`slots/schema.py`)

Declarative. Adding a slot is a data change, not a code change.

```python
@dataclass(frozen=True)
class SlotDef:
    path: str                  # "trade_in.payoff_cents"
    type: type                 # int / str / bool / date / Enum
    validator: Callable        # range/enum/normalise; raises on invalid
    priority: int              # ask order, lower first
    staleness: timedelta | None
    ask_hint: str              # what compose should ask for, not the wording
```

| Group | Paths (repeating groups keyed by index) |
|---|---|
| `vehicles[i]` | year, make, model, trim, mileage, purchase_date, purchased_from_dealer, condition_when_bought (new/used) |
| `service[i]` | vehicle_ref, service_type, date, done_at_dealer |
| `trade_in` | has_trade, vehicle_ref, mileage, condition, payoff_cents |
| `interest` | lead_type, new_or_used, model, budget_cents \| monthly_payment_cents, timeline |
| `appointments[i]` | date, purpose, dealer |
| `contact` | preferred_channel, best_time |

`*_dealer` fields are free-text values the customer states. They never
resolve to another tenant's `dealer_id`.

```python
REQUIRED_BY_LEAD_TYPE = {
    SALES:    ["interest.new_or_used", "interest.model", "interest.budget_or_payment",
               "interest.timeline", "trade_in.has_trade"],
    TRADE_IN: ["trade_in.vehicle_ref", "trade_in.mileage", "trade_in.condition", "trade_in.payoff_cents"],
    SERVICE:  ["vehicles[*].year|make|model", "vehicles[*].mileage", "interest.service_needed", "contact.best_time"],
    GENERAL:  ["interest.lead_type"],
}
CONDITIONAL = {("trade_in.has_trade", True): REQUIRED_BY_LEAD_TYPE[TRADE_IN]}
```

`LeadType` becomes `sales | trade_in | service | general`, replacing the
current enum in `agent/qualification.py`. The lead type is set in code from
`Lead.source`/`Lead.type` via `LEAD_SOURCE_TO_TYPE`. `lead_type_hint` from
the LLM is used only when that mapping gives `general`.

### 4.2 Validation (`validate` node)

An update is **accepted** only if all of these hold:

1. `path` resolves in the schema.
2. `SlotDef.validator(value)` passes (year 1980..next year, mileage 0..500k, enum membership, cents ≥ 0).
3. `quote` is a normalised substring of the customer's text. This is the deterministic grounding check.
4. `confidence ≥ 0.7`.

If 1–3 pass but 4 fails, the value is saved as `pending_confirmation` and
`decide` asks the customer to confirm it. If any of 1–3 fails, it's dropped
and logged in `ai_turn_log`.

Accepted values are written as `CapturedFact` (`source=BOT_EXTRACTED`,
`source_message_id` set). The previous current value is closed with
`supersede()`. Pre-filled platform values are `TOOL_VERIFIED`. The model's
own output is never written (`BOT_INFERRED` is rejected by the writer).

### 4.3 Policy (`slots/policy.py`), a pure function

```python
def next_action(profile, lead_type, extraction, flags) -> Action:
    if flags.opted_out:                         return Stop()
    if extraction.wants_human or flags.upset:   return Handoff()
    if profile.pending_confirmation:            return Confirm(profile.pending_confirmation[:1])
    missing = sorted(
        (s for s in required(lead_type, profile) if not profile.is_current(s)),  # stale ⇒ missing
        key=lambda s: SCHEMA[s].priority)
    if missing:                                 return Ask(missing[:2], answer=extraction.customer_questions)
    return Qualified(answer=extraction.customer_questions)   # notify dealer, stop asking
```

Same profile and same extraction always give the same `Action`. This
function is where most unit tests live.

---

## 5. Data model (MongoDB)

All owned collections carry `dealer_id` and are accessed only through
`DealerScopedDatabase`. The one exception is the follow-up cron's claim
query, which is cross-dealer by design and scopes by the claimed document's
`dealer_id` immediately after.

| Collection | Key fields | Indexes |
|---|---|---|
| `ai_lead_state` | lead_id, customer_id, lead_type, status (`active\|qualified\|handoff\|opted_out`), last_inbound_at, last_outbound_at | `(dealer_id, lead_id)` unique |
| `qualification_facts` (built) | customer_id, path, value, source, source_message_id, valid_from, valid_to, replaced_by, pending_confirmation | `(dealer_id, customer_id, path, valid_to)` |
| `ai_messages` | lead_id, customer_id, direction, channel, text, variants{sms,email}, campaign_id, is_fallback, idempotency_key, provider_id, status | `(dealer_id, lead_id, created_at)`, `idempotency_key` unique, `provider_id` |
| `scheduled_followups` | lead_id, source_message_id, to_channel, due_at, status | `(status, due_at)` partial on `status ∈ {pending, claimed}`, `(dealer_id, lead_id, status)` |
| `ai_events` | _id = event_id, received_at | TTL 7 days |
| `ai_turn_log` | lead_id, trigger, extraction, rejected_updates, action, drafts, guard_results, tokens, cost, latency_ms, langfuse_trace_id | `(dealer_id, lead_id, created_at)`, TTL 90 days |

The platform collections this service reads (`Lead`, `Customer`, `Vehicle`,
`Deal`, `RepairOrder`, `ServiceAppointment`, `CampaignLead`) go through
Customer 360 where possible and are never written to.

---

## 6. Sending (`channels/`)

```python
async def send(draft, channel, lead) -> SentMessage:
    key = f"{draft.turn_id}:{channel}"
    insert ai_messages{idempotency_key: key, status: "queued"}   # DuplicateKeyError ⇒ already sent, return
    consent.require(lead.customer_id, channel)                   # raises ⇒ status=suppressed
    provider_id = await CHANNELS[channel].send(...)              # Twilio / SendGrid
    update status="sent", provider_id
```

- **Twilio:** Messaging Service SID per dealer, `status_callback` → `/v1/webhooks/twilio/status`. Advanced Opt-Out handles STOP on the carrier side, and we mirror it into consent.
- **SendGrid:** dealer from-address, `Reply-To` routed to the platform's inbound address, and the event webhook goes to `/v1/webhooks/sendgrid/events`. Unsubscribe groups are mirrored into consent.
- Provider retries: arq retries the job with exponential backoff (3 attempts). The idempotency key makes a retry after a successful provider call a no-op.

---

## 7. API contract

All `/v1/events/*` require `Authorization: Bearer <UPSELL_SERVICE_SHARED_SECRET>`
(existing `api/auth.py`). Webhooks verify the provider signature instead.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/v1/events/lead-created` | `event_id, dealer_id, lead_id, customer_id, channel` | 202 / 200 if duplicate |
| POST | `/v1/events/inbound-message` | `event_id, dealer_id, customer_id, lead_id?, channel, message_id, text, received_at` | 202 / 200 |
| POST | `/v1/events/lead-resumed` | `event_id, dealer_id, lead_id` (staff un-pauses a handoff) | 202 |
| POST | `/v1/webhooks/twilio/status` | Twilio form | 204 |
| POST | `/v1/webhooks/sendgrid/events` | SendGrid JSON | 204 |
| GET | `/v1/leads/{lead_id}/profile?dealer_id=` | — | current profile, missing required slots, status |
| GET | `/health` | — | Mongo + Redis ping |

The existing `/upsell/recommend` and `/upsell/feedback` stay unwired. They're
out of scope (see [`PURPOSE.md`](PURPOSE.md)).

---

## 8. Concurrency and scale

| Concern | Mechanism |
|---|---|
| Two jobs for one lead racing | Redis lock `lock:{dealer}:{lead}` (`SET NX PX 30000`). A held lock means re-enqueue with a 2s defer. |
| Customer sends a burst of texts | Turn consumes all unanswered inbound messages, so one reply goes out, not three |
| Campaign reply burst from one dealer | Per-dealer in-flight cap (Redis `INCR`/`DECR` with TTL, default 10). Over cap means defer. |
| Throughput | Add worker replicas. Every job is stateless apart from Mongo/Redis. |
| LLM rate limits | Pydantic AI retry on 429 inside the turn deadline, then template fallback |
| Cron overlap across workers | Atomic `find_one_and_update` claim |
| Redis growth | Shallow checkpointer + 7-day idle TTL (built) |

---

## 9. Observability and testing

- **Langfuse:** one trace per turn (`trace_id` stored in `ai_turn_log`), spans for each node and LLM call, tagged `dealer_id`, `lead_type`, `trigger`.
- **Metrics from `ai_turn_log`:**
  - first-reply latency p95
  - template-fallback rate
  - guard-fail rate
  - rejected-extraction rate
  - cost per dealer per day
  - qualified-lead rate
- **Tests:**

| Layer | Tool | Covers |
|---|---|---|
| `slots.policy`, validators | pytest (pure) | Every lead type × missing/stale/conditional slot combination |
| Extraction | DeepEval + fixtures from `docs/data/conversations.md` | Precision/recall per slot path, quote grounding |
| Compose + guard | DeepEval, Promptfoo | No invented numbers, asks the chosen slot, injection attempts |
| Scheduler | pytest + real Mongo | Claim race (2 workers), cancel-on-reply race, stale claim reset |
| Sender | pytest | Idempotency on retry, consent suppression |
| Isolation | pytest | Cross-dealer read/write raises `CrossDealerAccessError` (built) |
| End to end | pytest + fake Twilio/SendGrid | lead-created → send → 24h (frozen clock) → fallback → reply cancels |

---

## 10. Build status

| Piece | State |
|---|---|
| Dealer-scoped Mongo layer, indexes bootstrap | Built |
| Shallow Redis checkpointer with idle TTL | Built |
| `CapturedFact` with source and supersede | Built |
| `never_invent` guard | Built |
| Shared-secret auth | Built |
| `LeadType` enum | Change to `sales/trade_in/service/general` |
| `AgentState` | Replace upsell fields with turn fields (`profile`, `extraction`, `action`, `draft`, `retry_count`) |
| `slots/`, `channels/`, `scheduler/`, `worker/`, event routes | To build |

---

## 11. Open technical questions

1. **Inbound ownership.** This design assumes `aidmvcs-be-dev` receives DMS leads and customer replies (Twilio inbound, SendGrid Inbound Parse) and calls `/v1/events/*`. If this service should own the provider inbound webhooks instead, `api/routes_webhooks.py` gains two routes and the rest is unchanged.
2. **Message visibility in the dealer UI.** Does the platform read `ai_messages` directly, or should this service also write into the platform's existing conversation collection?
