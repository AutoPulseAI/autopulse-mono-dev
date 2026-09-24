# Integration with the existing AutoPulse platform

This service does not replace anything in `aidmvcs-be-dev` or `n8n-active`. It's a new, separate
capability that plugs in at two points.

## 1. Data: shares the existing MongoDB and Redis

- `integrations/mongodb.py` connects to the **same** MongoDB database `aidmvcs-be-dev` uses
  (`Lead`, `Customer`, `Vehicle`, `Deal`, `RepairOrder`, `CampaignLead`, etc. — see
  [`../docs/architecture/architecture.md#43-data-model-mongodb`](../docs/architecture/architecture.md)).
  This service reads that data and writes its own collections (`upsell_profile`, `upsell_recommendation`,
  `upsell_decision_log`) into the same database — no new datastore to run, back up, or keep in sync.
- `integrations/redis_client.py` connects to the same Redis `aidmvcs-be-dev`'s BullMQ queues already run on.
  LangGraph's checkpointer uses its own keyspace there; it does not touch the existing BullMQ queues.

## 2. Frontend: a new section in the existing dealer portal (not a new app)

Per the team's decision, the UI lives inside `aidmvcs-be-dev/app/dealer/`, not as a separate Next.js app.
That means:

- **Auth, dealer-scoping and the design system are already solved** — a page under `app/dealer/upsell/`
  runs behind the existing `dealerauth` + subscription middleware, exactly like every other dealer page.
- **The browser never calls this Python service directly.** It calls a Next.js API route
  (`app/api/upsell/*`), which forwards the request server-side to this service — the same pattern the app
  already uses for n8n (`N8N_EMAIL_API`, `N8N_SMS_API`, etc. in `app/lib/queue.js` and the workers). This
  keeps the agent service's URL and any internal auth token out of the browser, and keeps the existing
  session/permission checks as the single source of truth for "is this user allowed to see this dealer's
  data."

```
Browser (dealer portal)
   │
   ▼
Next.js API route  app/api/upsell/recommend/route.js
   │  ① Bearer-JWT dealer session verified + isAuthorizedForDealer(dealer_id) — app/lib/apiAuth.js
   │  ② server-side fetch to this service, Authorization: Bearer <UPSELL_SERVICE_SHARED_SECRET>
   ▼
agentic-upsell FastAPI service   POST /upsell/recommend
   │  ③ require_internal_auth dependency verifies that same shared secret — api/auth.py
   ▼
LangGraph agent  →  tools (Customer 360, inventory, pricing)  →  guardrails  →  typed response
   │
   │  tools/customer_tool.py needs Customer 360 data →
   ▼
Next.js API route  app/api/customers/[id]/360/route.js
   │  ④ Authorization: Bearer <UPSELL_SERVICE_SHARED_SECRET> — accepted as an alternate to a
   │    human JWT by app/lib/apiAuth.js's resolveRequestAuthorization(); isAuthorizedForDealer
   │    is SKIPPED for this caller because dealer_id was already verified at step ①
   ▼
MongoDB (Customer/Lead/Deal/RepairOrder/ServiceAppointment/Vehicle)
```

**Two different auth mechanisms, deliberately**: steps ① is a *human* session (Bearer JWT, verified
against a real `User` + `isAuthorizedForDealer`) — this is the ONLY point in the chain that decides
"is this specific logged-in person allowed to see this specific dealer's data." Steps ②/③/④ are a
*service* identity (a shared secret, checked with constant-time comparison on both ends — see
`aidmvcs-be-dev/app/lib/internalServiceAuth.js` and `src/upsell_agent/api/auth.py`) — this only proves
"this call really came from the other trusted service," it carries no human-permission semantics of its
own, which is why step ④ explicitly skips `isAuthorizedForDealer` rather than trying to fake a user
identity for it.

**`/api/car` (inventory) is NOT part of this auth chain.** It has no auth check at all today, for any
caller — a pre-existing gap (see `docs/architecture/architecture.md`'s Known Caveats), not something
introduced or fixed by this integration. `tools/inventory_tool.py` / `autopulse_api_client.search_inventory()`
call it as-is. Retrofitting auth onto it needs separate sign-off, since Pulse already depends on it
working unauthenticated today.

### Files in place

- `aidmvcs-be-dev/app/lib/apiAuth.js` — **new**, shared helper: `resolveRequestAuthorization(req)`
  resolves either a human dealer session or a trusted internal-service caller. Used by the two files
  below; the ~14 other routes that duplicate their own local `loadAuthenticatedUser()` were left
  untouched (out of scope for this change).
- `aidmvcs-be-dev/app/lib/internalServiceAuth.js` — **new**, the shared-secret check itself
  (constant-time comparison via SHA-256 digest, fails closed if unconfigured).
- `aidmvcs-be-dev/app/lib/upsellAgentClient.js` — server-side fetch wrapper; sends the shared secret,
  throws a clear config error if it's missing rather than sending an unauthenticated request.
- `aidmvcs-be-dev/app/api/upsell/recommend/route.js` — **real auth implemented**: requires a valid
  dealer/agency/admin session and checks `isAuthorizedForDealer` against the request's `dealer_id`
  before calling this service. (An earlier version of this file claimed `middleware.js` covered this
  route — it does not; `middleware.js`'s matcher only covers `/agency*` and `/dealer*` page paths, not
  `/api/*`. That was a real gap, now closed.)
- `aidmvcs-be-dev/app/api/customers/[id]/360/route.js` — **edited**: now accepts the shared-secret path
  as an alternate to the existing human-JWT check, via the new shared `apiAuth.js` helper. The human path's
  behavior is unchanged.
- `aidmvcs-be-dev/app/dealer/upsell/page.js` — placeholder page, **not yet linked from `Sidebar.js`**
  (deliberately, so an empty feature doesn't show up in production nav — add the link once it has real
  content).
- `src/upsell_agent/api/auth.py` — **new**, the FastAPI-side check, applied to `/upsell/recommend` and
  `/upsell/feedback` (not `/upsell/health`, left open for infra liveness probes).
- `src/upsell_agent/integrations/autopulse_api_client.py` — `get_customer_360()` is fully implemented
  now (was a stub); `search_inventory()` still calls the currently-unauthenticated `/api/car`.

New env var needed on the `aidmvcs-be-dev` side (no `.env.example` is committed there — see the repo
root `readme.md`'s "Configuration" section for how settings are documented instead):

| Var | Purpose |
|---|---|
| `UPSELL_AGENT_API_URL` | Base URL of this service, e.g. `http://localhost:8100` in dev |
| `UPSELL_SERVICE_SHARED_SECRET` | Same value as this service's `.env` — see `.env.example` here for how to generate one |

## 3. What does NOT change

- The 5 live n8n workflows (email/SMS/lead reply, Write with AI, translation) are untouched.
- `emailWorker.js` / `processSms.js` continue to own first-response replies. This service is invoked
  separately — e.g. after a lead is marked `Appointment Booked`, after a service visit closes, or on a
  scheduled cadence — not on every inbound message.
- No change to `docker-compose.yml` infra beyond (optionally) adding this service as a container once it's
  ready to run alongside the rest — for now it runs standalone via `uvicorn` during development.
