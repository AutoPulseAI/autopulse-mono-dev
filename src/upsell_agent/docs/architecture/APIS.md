# APIs

Every HTTP boundary this service has: what it exposes (inbound, called by
the main platform), and what it calls out to (outbound, calls into the main
platform and one external provider). For the auth mechanics behind these,
see [`../../../../INTEGRATION.md`](../../../../INTEGRATION.md). For what each
capability is actually for, see [`architecture.md`](architecture.md).

Status markers used below: **live** = implemented and tested, **planned** =
designed, not yet built.

---

## Inbound — what this service exposes

Called only by `aidmvcs-be-dev`'s server-side code, never by a browser
directly. Every route below except `/health` requires the shared-secret
Bearer token described in `INTEGRATION.md`.

### `POST /upsell/recommend` — **live**

The original, single-shot capability: given a trigger event, produce priced
product recommendations. Currently returns an honest "not implemented" stub
rather than fake data — see `architecture.md` §12 for why this whole
capability is blocked on a real product/pricing data source, not on this
endpoint's own logic.

**Request**

| Field | Type | Required | Notes |
|---|---|---|---|
| `dealer_id` | string | yes | |
| `customer_id` | string | yes | |
| `lead_id` | string | no | |
| `trigger` | string | yes | e.g. `appointment_booked`, `service_visit_closed`, `scheduled_review` |

**Response**

| Field | Type | Notes |
|---|---|---|
| `customer_id`, `dealer_id` | string | echoed back |
| `recommendations` | list | each item has `item_type`, `source_id`, `display_name`, `price_cents`, `reasoning`, `grounding_tool_calls`, `confidence` — every field must trace to a real tool result, see `architecture.md` §7.1 |
| `suppressed_reason` | string or null | non-null and `recommendations` empty when there was something to say but it failed the fact-check |
| `generated_at` | timestamp | |
| `trace_id` | string or null | Langfuse trace id, for debugging |

### `POST /upsell/feedback` — **live**

Staff approves/edits/rejects a recommendation. Feeds the cooldown logic — an
item type rejected enough times gets suppressed for a set window, see
`architecture.md` §5.

**Request**

| Field | Type | Required |
|---|---|---|
| `dealer_id`, `customer_id` | string | yes |
| `recommendation_source_id` | string | yes |
| `item_type` | enum | yes |
| `trigger` | string | yes — the trigger that originally produced this recommendation |
| `decision` | string | yes — `approved` \| `edited` \| `rejected` |
| `staff_note` | string | no |

**Response:** `status`, plus the current `suppressed_item_types` for that
customer after this feedback is applied.

### `GET /upsell/health` — **live**

No auth required (infra liveness probe). Returns `{"status": "ok"}`.

### `POST /qualify/message` — **planned, not yet built**

The primary capability described in `architecture.md` §3/§9 — handles one
inbound customer message in an ongoing qualification conversation: assembles
context, updates what's known, calls tools as needed, produces a reply,
checked before it's returned.

**Planned request**

| Field | Type | Required | Notes |
|---|---|---|---|
| `dealer_id` | string | yes | |
| `lead_id` | string | yes | identifies the conversation thread — see `architecture.md` §5.4 for how this links to customer-level history |
| `customer_id` | string | yes | |
| `channel` | string | yes | `email` \| `sms` \| `chat` — affects reply formatting and which contact info is used |
| `message_text` | string | yes | the customer's actual message |
| `conversation_thread` | list | no | prior turns, if the caller already has them; this service also maintains its own memory (§5) so this is a convenience, not the only source |

**Planned response**

| Field | Type | Notes |
|---|---|---|
| `outcome` | string | `reply` (send `reply_text`) \| `needs_review` (the bot paused for a human — see `architecture.md` §10; nothing to send yet) \| `fallback` (a limit or check failed; `reply_text` is the safe holding message and the conversation is flagged) \| `blocked_input` (the input-safety check flagged the message; nothing is sent) |
| `reply_text` | string or null | the checked, ready-to-send reply; null when `outcome` is `needs_review` or `blocked_input` |
| `review_id` | string or null | present when `outcome` is `needs_review` — the id to use with the approval endpoints below |
| `lead_status` | string | this service's read on where the lead stands now — mirrors the shape `emailWorker.js`/`processSms.js` already expect from n8n today, see `../../../../docs/N8N_CUTOVER_PLAN.md` on matching that existing contract for a lower-risk cutover |
| `booked_appointment` | object or null | present if the appointment-booking tool was actually used this turn |
| `presented_options` | list | any vehicles/options shown this turn (architecture.md §5.2) |
| `trace_id` | string or null | |

### `POST /qualify/silence-check` — **planned, not yet built**

Triggered on a schedule (by whatever the platform's existing follow-up
scheduler already runs on, not a new scheduler this service owns) to check
conversations that have gone quiet past the threshold in `architecture.md`
§11, summarize them, and hand that summary off — see the Outbound section
below for where that summary goes.

### `GET /qualify/reviews?dealer_id=...` — **planned, not yet built**

Lists everything currently paused waiting for a human (`architecture.md`
§10): risky tool calls the bot chose on its own, replies that failed their
checks too many times, conversations that hit a budget limit, suspected
manipulation attempts. Feeds the "Needs review" list in the dealer portal
(`../plans/FRONTEND/FPLAN_1.md`, Phase 2).

**Planned response, per item**

| Field | Type | Notes |
|---|---|---|
| `review_id` | string | |
| `lead_id`, `customer_id` | string | |
| `reason` | string | `risky_tool_call` \| `checks_failed` \| `budget_exceeded` \| `suspected_manipulation` |
| `explanation` | string | plain-English reason, e.g. "the reply stated a trade value the customer never gave" |
| `pending_action` | object or null | what the bot wanted to do: a draft reply, or a tool call with its inputs |
| `created_at` | timestamp | |

### `POST /qualify/reviews/{review_id}/decide` — **planned, not yet built**

A staff member's decision. The paused conversation resumes from exactly
where it stopped, using this decision — nothing is re-run.

**Planned request**

| Field | Type | Required | Notes |
|---|---|---|---|
| `decision` | string | yes | `approve` \| `edit` \| `reject` |
| `edited_reply` | string | only when `decision` is `edit` | |
| `staff_note` | string | no | kept with the record; real cases like this become new test cases |

**Planned response:** the same shape as `/qualify/message`'s response — the
result of the resumed turn.

---

## Outbound — what this service calls

### Into `aidmvcs-be-dev`

| Call | Status | Auth | Used for |
|---|---|---|---|
| `GET /api/customers/{id}/360?dealer_id=...` | **live** | Shared secret (accepted as an alternate to the normal human-session check — see `INTEGRATION.md`) | Customer lookup tool (`architecture.md` §4) |
| `GET /api/car?source=...` | **live**, but see caveat | **None** — this endpoint has no auth for any caller today, a pre-existing gap in the main platform, not something introduced or fixed here | Inventory lookup tool. Called as-is; fixing its auth needs separate sign-off since another live integration (the website chatbot) already depends on it working unauthenticated |
| Branch/location-aware inventory search across an agency's dealers | **planned** | Not yet designed — `/api/car` today is scoped to one dealer at a time via `source`; an agency-wide, branch-aware version doesn't exist yet | Branch/location lookup tool (`architecture.md` §4) |
| `POST /api/booking` | **planned** | Not yet extended for a trusted-service caller — currently only reachable the way the main platform's own UI reaches it | Appointment-booking tool (`architecture.md` §4) — needs the same shared-secret-acceptance treatment the 360 route already got before this service can call it |
| Follow-up scheduling handoff (silence summary → existing `FollowUpJob` system) | **planned** | Not yet designed | `architecture.md` §11 — this service produces the summary, the existing system owns scheduling/sending |

### To external providers

| Call | Used for |
|---|---|
| OpenAI (model calls) | Every reasoning step — fact extraction, understanding what the customer wants, drafting replies (via Pydantic AI, see `FRAMEWORKS.md`) |
| Langfuse | Tracing (see `FRAMEWORKS.md`) — best-effort, skipped if not configured locally |

---

## Two real gaps this table makes concrete

1. **Branch/location-aware inventory search doesn't exist as an API yet.**
   `architecture.md` §4 requires it for agency chatbots (so the bot can tell a
   customer which branch has the car), but today's `/api/car` is scoped to
   one dealer's inventory at a time. This needs actual design work on the
   main platform side, not just a new call from this service.
2. **The booking API has no path for a trusted service to call it.** The
   appointment-booking tool can't be built until `/api/booking` gets the same
   kind of shared-secret acceptance `/api/customers/[id]/360` already has.
