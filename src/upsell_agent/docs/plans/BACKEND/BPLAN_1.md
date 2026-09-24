# Backend (Platform-Side) Implementation Plan — Phase Plan 1

Who this is for: the developer wiring the AI layer into the main platform
(`aidmvcs-be-dev`, the Node.js app). This is the **only** plan of the three
that touches that codebase's `app/api/` and `app/lib/` — see
[`../TEAM_SPLIT.md`](../TEAM_SPLIT.md) for why the three plans are split this
way and how to avoid stepping on each other.

For the "why", see:

- [`../../architecture/architecture.md`](../../architecture/architecture.md) — the design (referenced below as §N)
- [`../../architecture/APIS.md`](../../architecture/APIS.md) — the exact contract you're calling and exposing
- [`../../../../../INTEGRATION.md`](../../../../../INTEGRATION.md) — the auth chain you're extending
- [`../../../../../docs/N8N_CUTOVER_PLAN.md`](../../../../../docs/N8N_CUTOVER_PLAN.md) — the rollout this plan executes
- [`../AI/PLAN_1.md`](../AI/PLAN_1.md) — the Python service this plugs into (you don't write this code, but you call it)

---

## What you own, and what you don't

**You own:** everything under `aidmvcs-be-dev/app/api/` that talks to the AI
service, plus the small additions to existing platform logic (booking,
follow-ups) needed to support it. You do **not** touch
`aidmvcs-be-dev/app/dealer/` (that's Sabih's) or anything under
`agentic-upsell/` (that's the AI developer's Python service).

**The contract, not the code, is what keeps you both independent.** `APIS.md`
already documents every request/response shape. Build against that document,
not against reading the Python source — the AI developer can change their
internals freely as long as the contract holds, and you can build the Node
side before their implementation is finished, since several endpoints
already return real (if stub) responses matching the documented shape.

---

## Phase overview

| Phase | What it builds | Depends on |
|---|---|---|
| 0 | Confirm the existing auth chain | Nothing — already built, verify it |
| 1 | Thin proxy routes for the qualification endpoints | `APIS.md`'s documented shapes (already written) |
| 2 | Two platform-side gaps: booking auth, agency-wide inventory search | Nothing — can start immediately, independent of the AI service |
| 3 | Follow-up handoff | Phase 2's pattern, `AI/PLAN_1.md` Phase 7 (coordinate on the payload shape, don't wait on their code) |
| 4 | Cutover: shadow mode, then live, per dealer | `AI/PLAN_1.md` Phase 9 (a working `/qualify/message`) |

---

## Phase 0 — Confirm the existing auth chain

**Goal:** don't rebuild what's already there.

`app/lib/apiAuth.js`, `app/lib/internalServiceAuth.js`, and
`app/lib/upsellAgentClient.js` already exist and are wired into
`app/api/upsell/recommend/route.js` and `app/api/customers/[id]/360/route.js`.
Read `INTEGRATION.md`'s auth-chain diagram once before starting Phase 1 — every
new route you add follows the exact same two mechanisms (a human session for
anything a browser calls, the shared secret for anything only the AI service
calls), not a new one.

---

## Phase 1 — Proxy routes for the qualification endpoints

**Goal:** every endpoint `APIS.md` documents under "Inbound" that isn't built
yet gets a matching Next.js route, following the pattern
`app/api/upsell/recommend/route.js` already establishes.

**What to build**, one file each, all under `app/api/qualify/`:

- `POST /api/qualify/message` — calls the AI service's `POST /qualify/message`.
  Requires a real dealer session + `isAuthorizedForDealer`, same as
  `app/api/upsell/recommend/route.js` does today — copy that pattern exactly.
- `GET /api/qualify/reviews` — calls the AI service's `GET /qualify/reviews`.
  Same auth pattern.
- `POST /api/qualify/reviews/[id]/decide` — calls the AI service's matching
  endpoint.

**Also build:** `app/lib/qualifyAgentClient.js` — the server-side fetch
wrapper for these three, matching the shape of the existing
`upsellAgentClient.js` (same base URL env var, same shared-secret header).

**You can start this phase today.** `APIS.md` marks these as "planned" on the
AI service's side, but the request/response shapes are already fully
specified — write the route and the client against that document. When the
AI developer's `AI/PLAN_1.md` Phase 9 lands, your code needs no changes,
only a working endpoint to actually call.

**Test:** the same pattern as the existing
`app/api/upsell/recommend/route.js` — confirm a request with no session is
rejected, and confirm `isAuthorizedForDealer` is actually checked against the
request's `dealer_id`, not just present in the code.

---

## Phase 2 — Two platform-side gaps (independent, start anytime)

Both of these are documented gaps in `APIS.md`'s "Two real gaps" section, and
both are needed before the AI service's tools (`AI/PLAN_1.md` Phase 3) can be
finished — but you don't need to wait for that phase to start yours. Agree on
the request/response shape with the AI developer once (a short conversation,
not a blocking dependency), then build independently.

### 2.1 Let a trusted service call the booking API

`POST /api/booking` today only works the way the platform's own UI reaches
it — no path for a trusted service caller. Extend it the same way
`app/api/customers/[id]/360/route.js` was already extended: accept the
shared-secret Bearer token as an alternate to the human-session check, via
`resolveRequestAuthorization` (already in `app/lib/apiAuth.js`, already used
by the 360 route — reuse it, don't rewrite it).

### 2.2 Agency-wide, branch-aware inventory search

`/api/car` today searches one dealer's inventory at a time via `source`.
Agencies own multiple dealers (branches). Build a new endpoint (or extend
`/api/car`, whichever is less disruptive to the existing caller — check with
the team, since Pulse already depends on `/api/car`'s current behavior; a new
endpoint is the lower-risk option) that takes an agency ID and searches every
branch it owns, returning which branch has each matching vehicle.

**Test:** confirm a search under one agency never returns a vehicle from a
dealer outside that agency — same "must not leak across a boundary" pattern
as the dealer-isolation test in `AI/PLAN_1.md` Phase 0.1, just enforced here
instead.

---

## Phase 3 — Follow-up handoff

**Goal:** when the AI service decides a customer has gone quiet (§11), its
summary actually reaches a real follow-up message — through the platform's
**existing** follow-up system, not a new one.

**What to build:** a small addition to the existing follow-up path
(`FollowUpJob` / `app/lib/followupService.js`) that accepts a
summary + suggested channel from the AI service's silence-check call and
schedules it the normal way. This is intentionally small — you're adding one
new way to create a follow-up job, not changing how follow-ups are sent.

**Coordinate, don't block:** agree on the payload shape (what fields the
summary carries) with the AI developer early, since it affects both sides.
You can build the receiving end against an agreed shape before their
`AI/PLAN_1.md` Phase 7 code exists.

---

## Phase 4 — Cutover: shadow mode, then live

**Goal:** execute the rollout `N8N_CUTOVER_PLAN.md` already specifies. This
phase is entirely yours — it's a change to `aidmvcs-be-dev`'s existing worker
files, not to either the AI service or the frontend.

1. **Shadow mode.** In `emailWorker.js`/`processSms.js`, call the AI
   service's `/qualify/message` alongside the existing n8n call. Keep sending
   n8n's response as today; log the AI service's response (it's already
   traced on their side, per `AI/PLAN_1.md` Phase 8) without acting on it.
2. **Match n8n's existing response fields first** (the cutover plan's own
   recommendation) — `outcome`/`reply_text` map onto the fields
   `emailWorker.js` already parses from n8n, so this is a URL change plus a
   thin translation, not a rewrite of the worker's logic.
3. **Per-dealer opt-in flag** — add the setting, start with one dealer.
4. **Keep n8n live as the fallback path.** Don't remove or disable the
   existing `callOllama()` call; branch on the new flag instead.

**Depends on:** `AI/PLAN_1.md` Phase 9 producing a real, working
`/qualify/message`, and Phase 11 (their scale proof) passing before opting in
real dealer traffic, not just shadow mode.
