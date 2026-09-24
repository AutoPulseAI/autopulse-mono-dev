# AI Layer Implementation Plan — Phase Plan 1

Who this is for: whoever builds the AI layer (this Python service) and wires it
into the main platform. Written in plain English — this is a build order to
follow, not a technical reference. For the "why" behind anything here, see:

- [`../../architecture/architecture.md`](../../architecture/architecture.md) — the design (18 sections, referenced throughout below as §N)
- [`../../architecture/STACK.md`](../../architecture/STACK.md), [`FRAMEWORKS.md`](../../architecture/FRAMEWORKS.md), [`APIS.md`](../../architecture/APIS.md) — what's built with, and the API contract
- [`../../../../../INTEGRATION.md`](../../../../../INTEGRATION.md) — how this service talks to `aidmvcs-be-dev`
- [`../../../../../docs/N8N_CUTOVER_PLAN.md`](../../../../../docs/N8N_CUTOVER_PLAN.md) — how this replaces n8n, and why that happens last
- [`../FRONTEND/FPLAN_1.md`](../FRONTEND/FPLAN_1.md) — the matching frontend plan (separate document, not duplicated here)
- [`../BACKEND/BPLAN_1.md`](../BACKEND/BPLAN_1.md) — the matching platform-integration plan; everything in *this* document that touches `aidmvcs-be-dev` is that plan's job, not yours — see [`../TEAM_SPLIT.md`](../TEAM_SPLIT.md)

---

## The rules that shape the build order

**Build the harness in the order a message actually flows through it.**
`architecture.md` §2 lays out eight layers — input safety, context, the
enough-to-answer check, tool safety, output checks, budget, memory,
visibility. The phases below follow that order because each layer mostly
depends on the ones before it working: the output checks (§7) can't be tested
without something to draft a reply first (§6.3), which can't work without
memory (§5) to read from.

**Memory comes before almost everything else**, not because it's simple, but
because §6.2 (context assembly) and §7.1 (the facts check) both depend on it
being real. Building the reply logic against a memory layer that's still a
stub means rebuilding that logic later.

**Scale (§17) is foundational, not a later optimization.** Two of its
requirements — one Redis snapshot per conversation, not every snapshot
(§17.3), and every database call going through a single dealer-filtered layer
(§17.7) — are much cheaper to build in from day one than to retrofit once
real data exists. They're both in Phase 0.

**Nothing gets wired into `aidmvcs-be-dev`'s live message-sending path until
the harness is proven.** Phases 0–8 build and test this service in isolation.
Phase 9 exposes the real API. Phase 10 confirms it's ready for production
traffic. The actual cutover — shadow mode first — is
[`BACKEND/BPLAN_1.md`](../BACKEND/BPLAN_1.md) Phase 4, not this plan; see
`N8N_CUTOVER_PLAN.md` for why that order matters (a change here can put a
wrong reply in front of a real customer).

**Every phase ends with tests, not just working code.** A phase isn't done
when it runs once by hand — it's done when there's a test that fails if it
breaks later.

**Status marker used below:** each phase lists the files it touches, and
whether that file already exists as a stub (`NotImplementedError`, per
`architecture.md` §18) or is new.

---

## Phase overview

| Phase | What it builds | Depends on |
|---|---|---|
| 0 | Foundations: dealer isolation, Redis snapshot fix, memory schema | Nothing — build this first |
| 1 | Memory: the save and read path | Phase 0 |
| 2 | Input safety + turning a message into full context | Phase 1 (reads memory) |
| 3 | Tools: inventory, branch lookup, booking, customer lookup, and the rules around them (your side of these tools — `BACKEND/BPLAN_1.md` Phase 2 builds the platform endpoints they call) | Phase 0 (tool safety needs the approval mechanism from Phase 0's data layer) |
| 4 | The "enough to answer?" check and drafting a reply | Phases 2, 3 |
| 5 | Checking the reply before it sends, and the budget | Phase 4 |
| 6 | Wiring it all into one LangGraph flow, with human approval | Phases 1–5 |
| 7 | Going silent — producing the summary (`BACKEND/BPLAN_1.md` Phase 3 delivers it) | Phase 6 |
| 8 | Visibility: tracing every turn, and the test suite | Alongside Phases 1–7, formalized here |
| 9 | The real API | Phase 6 (needs a working graph to call) |
| 10 | Confirm production-readiness — the actual cutover is `BACKEND/BPLAN_1.md` Phase 4 | Phase 9 |
| 11 | Scale proof | Phase 10 |

A separate, smaller track — the original single-shot product-recommendation
capability (§3's "post-conversion upsell") — is listed at the end, since it's
blocked on a data source that doesn't exist yet (§12) and isn't part of this
build order.

---

## Phase 0 — Foundations

**Goal:** the two things everything else depends on, and the extended memory
schema, before any logic gets built on top of them.

### 0.1 One data layer, dealer-filtered, no exceptions (§17.7)

This is the most important item in the whole plan. With many dealers and
thousands of customers each, a single database call that forgets to filter by
dealer is a data breach, not a bug.

**What to build:** a single module that every other piece of code goes
through to read or write Mongo — no other file talks to the database
directly. It **requires** a dealer ID on every call and adds the filter
itself, so no individual query can forget it. `integrations/mongodb.py`
already exists as the connection setup; this phase adds the enforced-access
layer on top of it.

**Test:** a dedicated test that requests Dealer B's data while acting as
Dealer A, for every collection this service touches, and confirms it fails.
This test runs in CI on every change from here on, not just once.

**Also build: the indexes, before this collection sees real traffic.** There's
no schema migration here — this is a brand-new set of collections, not a
change to anything `aidmvcs-be-dev` already has, so there's no existing data
to migrate. But an unindexed collection is a real outage waiting to happen
once dealers have thousands of customers each, so create these as part of
this phase, not as a fix once something's slow:

| Collection | Index | Why |
|---|---|---|
| Customer facts (§5.3) | `(dealer_id, customer_id)` compound | Every fact read/write filters on both — this is also the index that makes the dealer-isolation rule above fast, not just correct |
| Conversation messages (§5.2) | `(dealer_id, lead_id)` compound | Every turn's history read filters on both |
| Conversation messages (§5.2) | `(dealer_id, last_message_at)` compound | What Phase 7's silence-check scans by — needed before that phase, not at Phase 7 itself |
| Session summaries (§5.5) | `(dealer_id, customer_id, session_end)` compound | Cross-conversation lookup (Phase 1.5) reads this sorted by time |

### 0.2 Redis: one snapshot per conversation, not every one (§17.3)

**What to build:** `memory/short_term.py` currently uses `AsyncRedisSaver`,
which keeps a full history of every step. Swap it for
`AsyncShallowRedisSaver` (same package, verified to exist and take the same
`redis_url` constructor), which keeps only the latest snapshot per
conversation. The full history already lives in MongoDB once Phase 1 is
built (§5.2), so nothing is lost.

**Also build:** the idle-expiry rule from §17.3 — a conversation with no
activity for a set period (starting value: 7 days) is dropped from Redis. If
a message arrives for an expired conversation, its working state is rebuilt
from MongoDB.

**Test:** expire a conversation's Redis state mid-conversation by hand, send
a message for it, and confirm it resumes correctly. This is one of the four
rollout tests from §17.9 — build it now, not just before launch.

### 0.3 Extend the memory schema (§5.3, §5.4)

**What to build:** `agent/qualification.py`'s `CapturedFact` and `FactSource`
currently have two trust levels (`CUSTOMER_STATED`, `TOOL_VERIFIED`). Extend
to the four from §5.3 (customer-stated, tool-verified, bot-extracted-from-a-message,
bot-inferred), and add the fields §5.4 needs: `valid_from`, `valid_to`,
`replaced_by`, and a per-fact-type staleness rule reference. `memory/models.py`'s
`CustomerUpsellProfile` is a separate, already-correct model for the other
(upsell) track — don't conflate the two.

**Test:** unit tests for the schema itself (already the pattern used in
`tests/unit/test_qualification_state.py`) — confirm a new fact with the same
field name closes out the old one's `valid_to` rather than leaving two
"current" facts.

---

## Phase 1 — Memory: the save and read path (§5)

**Goal:** everything a conversation needs to remember, actually gets
remembered, correctly, immediately.

### 1.1 Save immediately (§5.2)

**What to build:** every message and every reply is written to MongoDB the
moment it happens — not batched, not only at the end of a conversation.
`memory/long_term.py` already has a "final snapshot" pattern for the upsell
track; this phase adds the per-turn, per-message write for the qualification
track, into the collections designed in §5.7 (conversation messages,
customer facts, session summaries).

### 1.2 The trust-tiered writer (§5.3)

**What to build:** the single function every other piece of code calls to
save a fact. It takes a `FactSource` and enforces the rule from §5.3's table:
customer-stated and tool-verified facts are always saved; bot-extracted facts
are saved but linked to the exact message they came from; bot-inferred facts
are never saved as facts at all — only usable within the current turn, never
persisted. This function is the single enforcement point for "the bot's own
words never become facts" — nothing else should write to the facts
collection directly.

**Test:** try to save a `BOT_INFERRED` fact and confirm it's rejected (or
silently not persisted, per the design) rather than ending up queryable
later.

### 1.3 Staleness rules (§5.4)

**What to build:** a small table of age limits per fact type (budget, trade-in
mileage, preferred channel, etc. — see §5.4's table for which ones decay and
which don't), and a function that marks a fact as current, replaced, or
stale when it's read. Availability-type facts (is this car still in stock)
are never trusted from memory at all — they're marked "must re-check", which
Phase 3's inventory tool honors.

### 1.4 Sessions (§5.5)

**What to build:** a gap-detection rule — a customer message after a quiet
period (starting value: 3 days) starts a new session inside the same
conversation. The previous session gets a summary written (linked back to its
raw messages, per §5.2 — never the only copy).

### 1.5 Cross-conversation lookup (§5.6)

**What to build:** extend `tools/customer_tool.py`'s existing (already
implemented) Customer 360 call so that, in addition to what it returns today,
it also returns this service's own memory of past conversations with this
customer — via the dealer-filtered data layer from Phase 0.1, searchable by
customer ID, not conversation ID.

### Phase 1 tests (the memory test suite from §13)

Build these now, not later — they're what makes every phase after this one
trustworthy:

| Test type | What it checks |
|---|---|
| Recall within a conversation | A fact given 5 messages ago is used correctly now |
| Recall across conversations | A fact from 3 weeks ago, different conversation, is found |
| A fact that changed | Budget $30k → $25k: the newer one is used, the old one is marked replaced, not deleted |
| Now vs. then | "What's my budget?" gets current; "what was it before?" gets the historical one |
| Nothing to recall | Asking about a recommendation that never happened returns "no record," not a guess |
| Stale data | A car shown last week is re-checked, not reused, before being offered again |

---

## Phase 2 — Input safety and context assembly (§6.1, §6.2)

**Goal:** by the time anything reaches the model, the message has been
checked for manipulation, rewritten into something that makes sense on its
own, and paired with a clean, time-sorted, conflict-free picture of what's
known.

### 2.1 Input safety (§6.1)

**What to build:** `guardrails/` gets a new check (alongside the existing
`policy.py`, `never_invent.py`, `output_validation.py`) that scans incoming
text — the customer's message, and anything pulled from an email body or
attachment — for manipulation attempts before it reaches the model. A message
that's clearly an attack doesn't get a bot reply at all; it's flagged for a
human (this becomes one of the four "needs review" reasons from
`APIS.md`'s planned `GET /qualify/reviews`).

### 2.2 Rewrite into a full question (§6.2, step 1)

**What to build:** a node — `agent/nodes/rewrite_query.py` — that takes the
raw message plus recent conversation history and produces a standalone
version ("what u got" → "what SUVs under $30k do you have near Dallas?").
Both versions are kept; nothing downstream works from the raw message alone
again.

### 2.3 Assemble context (§6.2, steps 2–4)

**What to build:** `agent/nodes/retrieve_context.py` already exists as a stub
with the right idea (pull everything the agent needs, record every tool call)
— this phase replaces its `NotImplementedError` with the real
implementation: pull current facts (Phase 1.3), pull relevant past-conversation
history if the rewritten question needs it (Phase 1.5), settle any
conflicting facts into one answer before handing anything to the model
(never two competing numbers), and keep the whole bundle small and ordered
(most important things first and last, per §6.2 step 4).

**Test:** feed it a customer with a replaced fact and confirm the model-facing
context shows only the settled, current version — never both.

---

## Phase 3 — Tools and the rules around them (§4)

**Goal:** the bot can actually look things up and take real actions, safely.

### 3.1 Inventory lookup

**What to build:** `tools/inventory_tool.py` exists as a stub calling
`/api/car` — replace the stub with the real call (the endpoint itself is
already live, per `APIS.md`).

### 3.2 Branch/location lookup (agency chatbots)

**What to build:** `tools/branch_lookup_tool.py` (new) — a thin client
calling the agency-wide inventory endpoint. That endpoint is a real,
documented gap (`APIS.md` §"Two real gaps") on the platform side —
**`BACKEND/BPLAN_1.md` Phase 2.2 builds it, not this plan.** Agree on the
request/response shape with the backend developer once (`TEAM_SPLIT.md`'s
handoff point 1), then build this file against that shape.

### 3.3 Appointment booking

**What to build:** `tools/booking_tool.py` (new) — a thin client calling
`/api/booking`. Making that endpoint accept a trusted-service caller is also
a documented gap that **`BACKEND/BPLAN_1.md` Phase 2.1 builds, not this
plan.** Same handoff: agree on the shape, build independently.

### 3.4 Customer lookup

Already implemented (`tools/customer_tool.py`), extended further in Phase
1.5. Nothing new here beyond that.

### 3.5 The tool rules (§4.2)

**What to build:** `guardrails/policy.py` already has `is_contact_allowed`
and `is_item_suppressed` as stubs for the *other* (upsell) track. This phase
adds the qualification-track rules as their own functions: a risk level per
tool (read-only / writes data / high-risk — written down in one place, not
decided per call), the provenance rule (a write-real-data action the
**customer** clearly asked for can proceed; one the **bot decided on its
own** goes to human approval), and the rule that high-risk actions always
need a human regardless of any stored setting.

**Test:** simulate a message that tries to get the bot to book an appointment
on its own initiative (not something the customer asked for) and confirm the
policy routes it to approval, not straight to the booking tool.

---

## Phase 4 — Deciding what to say (§6.3, drafting)

**Goal:** the bot never guesses and never flatly refuses — it answers, looks
something up first, or asks.

### 4.1 The "enough to answer?" check (§6.3)

**What to build:** `agent/nodes/enough_to_answer.py` (new) — a small,
separate check that runs before any reply is drafted and returns one of:
enough to answer, need a lookup (routes to Phase 3's tools), need to ask the
customer, or genuinely out of scope (redirect politely, never a flat
refusal).

### 4.2 Drafting the reply

**What to build:** `agent/nodes/draft_reply.py` (new — this is the
qualification-track equivalent of the existing `agent/nodes/recommend.py`,
which is the *other* track and shouldn't be reused here). Uses Pydantic AI
with a typed output, built from the context assembled in Phase 2 and any
tool results from Phase 3.

---

## Phase 5 — Checking the reply, and the budget (§7, §8)

**Goal:** nothing reaches a customer unless it passes every check, and
nothing runs forever or costs without limit.

### 5.1 The facts check (§7.1)

**Already built and tested** — `guardrails/never_invent.py`'s
`check_appointment_offer` exists and has 7 passing tests. This phase connects
it to the real draft from Phase 4.2 instead of test fixtures; no new logic
needed unless the extended fact schema from Phase 0.3 requires updating the
check's field names.

### 5.2 The behavior check (§7.2)

**What to build:** new — a check that looks for refusal/out-of-scope language
in the draft while the conversation state shows an active, in-scope
qualification conversation. Same fail-closed treatment as 5.1: a violation
means retry, not send.

### 5.3 The support score (§7.3)

**What to build:** new — a separate scoring pass, 0.0 to 1.0, on how well the
draft is backed by what's actually known. Starting cutoff: 0.90, tuned from
real results once there's real traffic to tune against.

### 5.4 Two-tier retry (§7.4)

**What to build:** the retry logic that decides *which* kind of retry a
failure needs — a cheap rewrite-only retry when the facts were fine but the
wording wasn't, or a full re-lookup when the information itself was missing.
This lives in the graph wiring (Phase 6), but the checks in 5.1–5.3 need to
report *which* kind of failure they are, not just pass/fail.

### 5.5 Budget (§8)

**What to build:** `agent/budget.py` (new) — a plain data object tracking
attempts, model calls, tool calls, cost, and elapsed time against the
ceilings in §8's table, checked at every step. When exceeded: stop
immediately, send the safe fallback message, flag for human review (another
of the four "needs review" reasons).

**Test:** force a budget ceiling in a test and confirm the graph actually
stops rather than continuing past it.

---

## Phase 6 — Wiring it into one graph, with human approval (§9, §10)

**Goal:** everything built in Phases 1–5 runs as one real, working LangGraph
flow — this is where the design in `architecture.md` §9's diagram becomes
actual code.

**What to build:** `agent/graph.py` currently has an empty `build_graph()`
with `TODO` comments marking exactly this work. Register every node built so
far, wire the transitions from §9's diagram (including the bounded retry
loop from Phase 5.4 and the budget check from Phase 5.5 at every step), and
switch the checkpointer to the real one from Phase 0.2.

**Human approval (§10):** use LangGraph's own pause/resume — when the tool
policy (Phase 3.5), a repeated check failure (Phase 5), or a budget limit
(Phase 5.5) requires a human, the graph pauses, its state is saved (already
true once Phase 0.2 is wired), a pending-approval record is written (new —
this is what `APIS.md`'s planned `GET /qualify/reviews` reads from), and the
graph resumes from that exact point once a decision comes back.

**Test:** an end-to-end test that runs a full conversation through the real
graph (not mocked node-by-node) and separately, one that pauses for approval,
submits a decision, and confirms it resumes correctly rather than re-running
from the start.

---

## Phase 7 — Going silent (§11)

**Goal:** a customer who stops replying doesn't get abandoned, but this
service doesn't rebuild a scheduler that already exists.

**What to build:** `agent/silence_check.py` (new) — using the index from
§17.2/§17.6 ("last customer message time"), find conversations that crossed
the quiet threshold, summarize each one (from the real messages, per §5.2 —
never from an older summary), and send that summary out through `/qualify/silence-check`
(Phase 9). Where it goes after that — the main platform's **existing**
follow-up system (`FollowUpJob` / `followupService.js`) — is
**`BACKEND/BPLAN_1.md` Phase 3's job, not this plan's.** Agree on the summary
payload's fields with the backend developer once (`TEAM_SPLIT.md`'s handoff
point 2), then build this file against that shape.

---

## Phase 8 — Visibility and the full test suite (§13)

This runs alongside every phase above in practice — formalized as its own
phase here because it needs deliberate design, not incidental logging.

### 8.1 Tracing

**What to build:** `observability/tracing.py` exists as a stub — wire real
Langfuse tracing, **and** write the same per-turn record to MongoDB (§13),
including which facts and past messages were included or excluded as stale
(this is what makes a bad answer traceable to "bad memory" vs. "bad
writing").

### 8.2 The eval suite

**What to build:** `evals/test_hallucination.py` exists with one dataset file
and a sanity test — this phase builds it out into the real suite:

- The 8 worked examples from `../../data/conversations.md` (4 lead types ×
  success/failure), as DeepEval test cases, not just a JSONL file.
- The three real failure scenarios that shaped revisions 2–3 of the
  architecture (no inventory lookup, wrong refusal, lost memory) as
  permanent regression cases.
- The memory test suite from Phase 1.
- Promptfoo cases attempting to manipulate the bot (per `FRAMEWORKS.md`),
  run against the input-safety check from Phase 2.1.

This suite is what gates every future change from here on — per
`architecture.md` §1, "a way to catch bad replies before they ship" is one of
the three reasons this service exists at all.

---

## Phase 9 — The real API (`APIS.md`)

**Goal:** everything built so far is reachable over HTTP, matching the
contract already documented.

**What to build:** in `api/routes.py`, replace the `POST /upsell/recommend`
stub's *sibling* — the real, planned `POST /qualify/message` — with a call
into the Phase 6 graph, returning the `outcome`/`reply_text`/`review_id`
shape `APIS.md` already specifies. Add `GET /qualify/reviews` and
`POST /qualify/reviews/{review_id}/decide` (Phase 6's approval flow), and
`POST /qualify/silence-check` (Phase 7).

**Test:** the existing pattern in `tests/unit/test_api_health.py` (auth
required, honest stub responses) extended to cover these new endpoints —
including a real request/response round trip against the Phase 6 graph, not
just an auth check.

---

## Phase 10 — The main platform can now call you

**Goal:** your side of the cutover is ready. **The actual wiring — shadow
mode, response-shape bridging, the per-dealer flag, all of it — is
`BACKEND/BPLAN_1.md` Phase 4, not this plan.** `N8N_CUTOVER_PLAN.md` has the
full detail of what they'll do.

Your job in this phase is narrow: make sure `/qualify/message`'s response
(Phase 9) is solid enough to be called by real production traffic — every
field `APIS.md` documents is populated correctly, the trace (Phase 8.1)
captures enough to debug a bad reply after the fact, and the eval suite
(Phase 8.2) is passing. Once that's true, tell the backend developer it's
ready; you don't need to touch `aidmvcs-be-dev` yourself.

---

## Phase 11 — Scale proof and rollout (§17.9)

**Goal:** before any dealer's live traffic depends on this service, the four
scale tests from §17.9 pass for real, not just in theory:

| Test | What it proves |
|---|---|
| Load test | A simulated campaign burst (§17.1's worst case) stays under the reply time cap and nothing fails |
| Cost test | A realistic day of traffic costs close to the §17.1 estimate, not wildly more |
| Recovery test | An expired Redis conversation (Phase 0.2) rebuilds from MongoDB without the customer noticing |
| Isolation test | The dealer-filtering test from Phase 0.1, run once more against real infrastructure, not just unit-level mocks |

Once these pass, widen the per-dealer opt-in from Phase 10 gradually, watching
cost-per-dealer (Phase 8.1's trace data) and the eval suite's ongoing pass
rate as real traffic grows.

---

## Separate track: the single-shot product-recommendation capability

Not part of the phase order above. `agent/nodes/recommend.py`,
`guardrails/output_validation.py`, and `tools/pricing_tool.py` already exist
as stubs for this — per `architecture.md` §12, this capability is blocked on
a real pricing/promotions/finance-offer data source that doesn't exist
anywhere in the platform yet. That's a product decision (where does the data
come from), not an engineering task on this service's side. Pick this track
up once that decision is made; nothing in Phases 0–11 depends on it.
