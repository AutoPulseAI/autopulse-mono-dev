# Backend (Platform ↔ AI) Implementation Plan — BPLAN 1

> **Owner:** Backend developer. Touches `aidmvcs-be-dev/app/api/**`,
> `aidmvcs-be-dev/app/worker/**`, `aidmvcs-be-dev/app/lib/**`,
> `aidmvcs-be-dev/app/models/**`, plus the root `compose.yml` and `Makefile`.
> **Builds the platform side of:** [`../../architecture/architecture.md`](../../architecture/architecture.md) (§N below).
> **Partner plan:** [`../AI/APLAN_1.md`](../AI/APLAN_1.md).

---

## How the platform works today

This is what we plug into:

| Piece | Today | File |
|---|---|---|
| New leads from DMS | Parsed and saved as `Lead` and `Customer` | `app/worker/leadworker.js`, `app/lib/adfLeadParser.js` |
| Inbound SMS | Twilio → queue → `processSms` → calls **n8n** (`N8N_SMS_API`) for the auto-reply | `app/worker/processSms.js` |
| Inbound email | Mailgun webhook → queue → `emailWorker` → calls **n8n** (`N8N_EMAIL_API`) | `app/api/webhooks/mailgun/route.js`, `app/worker/emailWorker.js` |
| Conversation history (UI) | Every SMS and email is an `Email` document (`communication_type` sms/email, `lead_id`, `dealer_id`) | `app/models/Email.js` |
| Campaigns | Dealer creates and sends them. Per-recipient record in `CampaignLead`. | `app/api/campaigns/**`, `app/worker/campaignWorker.js` |
| Dealer follow-up rules | `FollowUpJob` + `followupService.js` | `app/lib/followupService.js` |
| Outbound email | Nodemailer over Mailgun SMTP | `app/lib/emailservice.js` |
| Service-to-service auth | Shared secret, already built | `app/lib/internalServiceAuth.js`, `app/lib/upsellAgentClient.js` |

**The goal of this plan:** for dealers switched to the AI, the platform
**stops calling n8n**. It **sends events** to the AI service instead, and
**shows the AI's messages** in the existing conversation screen. Dealers not
switched keep working exactly as today.

---

## Phase overview

| Phase | Goal | Done when |
|---|---|---|
| **0** | Decisions + local dev stack | `make ai-up` runs the platform, the AI service and the Dev Console together |
| **1** | Per-dealer AI switch | Admin can set a dealer to off / shadow / live |
| **2** | Send events to the AI service | A new lead or reply for a "live" dealer reaches the AI service, and n8n is not called |
| **3** | Show AI messages in the conversation screen | AI replies appear in the dealer's existing conversation view, marked as AI |
| **4** | No double messaging | A live-AI lead gets no n8n replies and no `FollowUpJob` messages |
| **5** | Endpoints for the dealer UI | Profile, status and "hand back to AI" reachable through the platform with dealer auth |
| **6** | Rollout | One dealer in shadow, then live |

---

## Phase 0 — Decisions and local dev stack

### 0.1 Decisions to settle with the AI developer first

1. **Email provider.** The architecture says SendGrid for AI-sent email. Today the platform sends through Mailgun SMTP and receives through the Mailgun webhook. We need to confirm SendGrid, and set the **reply-to** on AI emails so customer replies still arrive through the existing Mailgun inbound route. Otherwise we never hear the replies.
2. **Twilio numbers.** The AI sends SMS from the same dealer number the customer already texts, so replies keep coming through the existing inbound SMS path.
3. **Event ID rules:**
   - `lead-created` uses the `Lead` ID.
   - `inbound-message` uses the `Email` document ID.

   Both are stable, so a retried event is detected as a duplicate.

### 0.2 Local dev stack

- Add to the root `compose.yml` under a profile named `ai`:
  - the AI service's API
  - its worker
  - the Dev Console

  They use the existing MongoDB and Redis containers.
- Fill the empty root `Makefile` with these commands:

| Command | Does |
|---|---|
| `make ai-up` | Starts MongoDB, Redis, the AI API, worker and Dev Console |
| `make ai-seed` | Loads test dealers, customers, leads and a campaign |
| `make ai-scenarios` | Runs all end-to-end scenarios (same as the Dev Console Progress page) |
| `make ai-test` | Runs the AI service's unit tests |
| `make dev-full` | `ai-up` plus the Next.js app, so events go platform → AI for real |

- Add the environment variables the platform needs to `.env.example`:
  - AI service URL
  - shared secret (already exists)
- In the full local stack, both the platform and the AI service use **fake SMS and email senders**. No real messages ever leave a developer's machine.

**Done when:** a new developer can run `make dev-full` and `make ai-seed`, open the Dev Console, and see the platform's leads.

---

## Phase 1 — Per-dealer AI switch

1. Add an **AI mode** to the dealer record: `off` (default), `shadow` or `live`.
2. An admin API route to read and change it, admin auth only.
3. One helper that every worker uses to read a dealer's AI mode, cached for 60 seconds.

**Done when:** the mode can be changed through the API and the helper returns it. All existing dealers stay `off`, so behaviour is unchanged.

---

## Phase 2 — Send events to the AI service

1. **Event client** in `app/lib/`. It:
   - posts to the AI service with the shared secret
   - uses a 2-second timeout
   - never blocks a worker: failed sends go on a small BullMQ retry queue (5 attempts, growing delays)
2. **New lead.** In `leadworker.js`, after a lead and customer are saved, send `lead-created` with:
   - dealer
   - lead
   - customer
   - the channel the lead came in on
3. **Customer reply.** In `processSms.js` and `emailWorker.js`, after the inbound `Email` record is saved and linked to a lead, send `inbound-message` with:
   - the message text
   - the channel
   - the `Email` ID as the event ID
4. **Branch on AI mode:**

| Mode | n8n auto-reply | Event to AI |
|---|---|---|
| `off` | Called, as today | Not sent |
| `shadow` | Called, as today | Sent, marked shadow |
| `live` | **Not called** | Sent |

**Tests:** a fake AI endpoint receives the right payload for each mode. An AI service outage never loses the event (it retries) and never crashes the worker.

**Done when:** with `make dev-full`, sending a test SMS or email for a `live` dealer shows up in the Dev Console Simulator as a real platform event.

---

## Phase 3 — Show AI messages in the conversation screen

1. **Internal endpoint** `POST /api/internal/ai/messages`, protected by the shared secret. It writes an `Email` document with:
   - dealer
   - lead
   - channel
   - text
   - subject
   - status `sent`
   - the provider message ID
2. Add two fields to the `Email` model:
   - an **AI-generated** flag
   - a **fallback** flag, for messages re-sent on the other channel
3. **Status updates.** A second internal endpoint updates the status of that record when the AI service hears from Twilio or SendGrid (delivered, failed).
4. **Keep inbound dedupe working.** Inbound processing already matches a reply to its lead by sender and recipient. It must also link replies to AI-sent messages, so check that the matching indexes cover AI records.

**Done when:** in `make dev-full`, an AI reply appears in the dealer's normal conversation view with an AI marker and the right delivery status.

---

## Phase 4 — No double messaging

For every lead whose dealer is `live`:

1. **n8n is never called** for auto-replies (covered in Phase 2). Add a test that proves it.
2. **`FollowUpJob` rules are paused** for that lead, because the AI service owns follow-ups now (architecture §6). Existing pending jobs are cleared when the dealer is switched to `live`.
3. **Manual staff replies.** When staff reply by hand through the conversation screen (`conversations/reply`), send a new `lead-paused` event. The AI stops replying to that lead and cancels its pending follow-ups until staff resume it (Phase 5).

   The event is defined in architecture §11.

**Done when:** a scenario of new lead → AI reply → no reply for 24h → one channel switch produces **exactly** the messages the AI sent, and nothing from n8n or `FollowUpJob`.

---

## Phase 5 — Endpoints for the dealer UI

These routes are for the frontend engineer. Each one checks the dealer
session and dealer permission, then calls the AI service server-side,
following the existing pattern in `app/api/upsell/recommend/route.js`.

| Route | Calls | Used for |
|---|---|---|
| `GET /api/ai/leads/[id]/profile` | AI `GET /v1/leads/{id}/profile` | "What the AI knows" panel: slots, missing slots, status |
| `POST /api/ai/leads/[id]/resume` | AI `lead-resumed` event | "Hand back to AI" button on a handed-off or paused lead |
| `POST /api/ai/leads/[id]/pause` | AI `lead-paused` event | "Take over" button |
| `GET / PUT /api/ai/settings` | Phase 1 dealer AI mode | Admin screen |

**Customer 360 check.** The AI service pre-fills slots from
`/api/customers/[id]/360`. Confirm it returns:

- vehicles
- deals
- service records
- service appointments
- trade-ins

Add any that are missing. Agree the shape with the AI developer before they start APLAN Phase 2.

**Done when:** every route returns real data from `make dev-full` and rejects another dealer's lead.

---

## Phase 6 — Rollout

1. **Pick one dealer** and set it to `shadow` for one week. The AI drafts every reply; n8n still sends.
2. **Review** shadow drafts against what n8n sent, using the Dev Console comparison (APLAN Phase 7).
3. **Switch to `live`**, watch the metrics for a week, then add dealers one at a time.
4. **Rollback** is setting the dealer back to `off`, which takes effect within 60 seconds (the cache time).

**Done when:** one dealer is live for a week with no double messages and no lost replies.

---

## Handoffs with the AI developer

| When | What we agree | Our side | Their side |
|---|---|---|---|
| Phase 0 | Email provider, reply-to address, SMS sender numbers | Mail and Twilio setup | Live drivers (APLAN Phase 6) |
| Phase 2 | Event payloads and event ID rules | Send events | Accept them (APLAN Phase 0) |
| Phase 3 | Record-message and update-status endpoint shapes | Build endpoints | Call them after sends |
| Phase 4 | `lead-paused` event | Send it | Handle it |
| Phase 5 | Profile route fields (FPLAN "Fields you can rely on") | Proxy them unchanged | Return them |
| Phase 5 | Customer 360 fields | Extend 360 | Pre-fill slots (APLAN Phase 2) |

---

## Out of this plan

- Dealer-portal pages. They belong to the frontend engineer (`../FRONTEND/FPLAN_1.md`).
- Anything inside `agentic-upsell/`.
