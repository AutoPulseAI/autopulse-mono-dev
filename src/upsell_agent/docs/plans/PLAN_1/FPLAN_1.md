# Frontend Implementation Plan — FPLAN 1

> **Owner:** Frontend engineer. Only touches `aidmvcs-be-dev/app/dealer/**`.
> **Builds the dealer-facing side of:** [`../../architecture/architecture.md`](../../architecture/architecture.md).
> **Why:** [`../../architecture/PURPOSE.md`](../../architecture/PURPOSE.md).
> **Partner plans:** [`../BACKEND/BPLAN_1.md`](../BACKEND/BPLAN_1.md) (the routes you call) and [`../AI/APLAN_1.md`](../AI/APLAN_1.md).

---

## Three rules

1. **Build on the existing pages, not new ones.** The portal already has a
   conversation view, a lead list and a customer page. Staff look at these
   every day, so the AI's work belongs on them.
2. **The browser never calls the AI service.** Pages only call the
   platform's own `/api/ai/*` routes (BPLAN Phase 5). Those routes check the
   dealer's login and permissions before anything reaches the AI service.
3. **Build against mock data first, then switch to the real route.** Each
   phase lists the route and fields it needs. Build the screen with a local
   mock of that shape. When the backend marks the route done, point the page
   at it. Don't invent fields that aren't listed here. Ask first.

---

## Phase overview

| Phase | Adds | Where | Needs (from backend) |
|---|---|---|---|
| **1** | AI marker on messages | Conversation view | AI flag on `Email` records (BPLAN Phase 3) |
| **2** | "What the AI knows" panel | Conversation view side panel and customer page | `GET /api/ai/leads/[id]/profile` (BPLAN Phase 5) |
| **3** | AI status and controls | Conversation view, lead list | Same profile route + pause/resume routes (BPLAN Phase 5) |
| **4** | Upcoming follow-up notice | Conversation view | Same profile route (follow-up fields) |
| **5** | AI mode display | Dealer settings | `GET /api/ai/settings` (BPLAN Phase 5) |

Phases 1 to 4 can all be built with mock data from day one.

---

## Phase 1 — Show which messages the AI sent

**Where:** `app/dealer/conversations/` and anywhere else a message thread is
shown (lead detail).

**Build:**

- An **"AI"** badge on every message with the AI-generated flag. It should be small but impossible to miss.
- On messages with the fallback flag, a line of text such as **"Re-sent by email: no reply to SMS after 24h"** (or the reverse), so staff understand why the same text appears twice.
- The delivery status of AI messages (sent, delivered, failed), using the same style the conversation view already uses for other messages.

**Done when:** in `make dev-full`, an AI reply shows the badge, and a
channel-switched message shows the fallback note.

---

## Phase 2 — "What the AI knows" panel

**Where:**

- a collapsible side panel in the conversation view for the selected lead
- the same content as a tab on `app/dealer/customers/[id]/`

**Data:** the profile route returns the customer's slots in groups, plus the
missing ones.

**Build:**

- **Groups:**
  - Vehicles owned
  - Service history
  - Trade-in
  - What they want now
  - Appointments
  - Contact
- **Each slot shows:**
  - the value
  - where it came from: "customer said", with a link that scrolls to that message, or "platform record"
  - when it was captured
- **States, each clearly different:**
  - **Filled**: normal
  - **Missing (required)**: a "still to ask" label
  - **Stale**: greyed, with "said 3 months ago, will re-confirm"
  - **Needs confirming**: "AI is checking this with the customer"
- **History:** a "changed" link on a slot shows its earlier values, for example "Budget $25k (today), was $30k (3 weeks ago)".
- **Progress:** a small bar such as "4 of 5 required details collected". It shows "Qualified" when complete.

**Rule:** only values the customer said or the platform holds should ever
appear here. If something looks like the AI made it up, report it as a bug.

**Done when:** the panel shows a seeded customer's pre-filled profile, and it
updates after refresh as a Simulator chat fills slots.

---

## Phase 3 — AI status and staff controls

**Where:** conversation view header and the lead list.

**Build:**

- **Status badge** on each lead: AI active, Qualified, Handed to you, Paused by staff, Opted out.
- **Reason line** for handed-off leads, using the reason from the profile route. For example: "Customer asked for a person", "Customer seems upset", "AI couldn't write a safe reply".
- **Two buttons:**
  - **Take over**: pauses the AI on this lead. This also happens automatically when staff send a manual reply.
  - **Hand back to AI**: resumes it. Ask for confirmation first.
- **Lead list filters:**
  - **"Needs you"**: handed-off leads, newest first
  - **"Qualified by AI"**: leads with all required details collected

**Done when:** "Take over" stops AI replies in `make dev-full`, "Hand back"
resumes them, and both filters list the right seeded leads.

---

## Phase 4 — Upcoming follow-up notice

**Where:** conversation view, just above the reply box.

**Build:**

- If a follow-up is pending, show for example **"If no reply, AI will re-send this by email tomorrow at 3:40 PM."**
- After it's sent, the Phase 1 fallback note takes over. If it's cancelled because the customer replied, show nothing.
- This is read-only. Staff who don't want it can use "Take over", which cancels it.

**Done when:** the notice appears after an AI SMS and disappears when the
customer replies (Dev Console Scheduler page).

---

## Phase 5 — AI mode display

**Where:** `app/dealer/settings/`.

**Build:** a read-only card with a short plain-English explanation of the
dealer's current mode:

- **Off**: AI isn't replying.
- **Shadow**: AI is drafting but not sending; your current setup still replies.
- **Live**: AI replies and follows up.

Admins change the mode through the admin API during rollout (BPLAN Phase 1).
A toggle screen can come later if needed.

---

## Fields you can rely on

Build mocks with exactly these fields. Anything else needs a conversation with
the backend developer first.

**`Email` record additions (Phase 1):**

- AI-generated flag
- fallback flag
- delivery status (existing field)

**Profile route (Phases 2 to 4):**

- **Lead:**
  - status
  - status reason
  - lead type
- **Slots, grouped. Each slot has:**
  - value
  - state (filled, missing, stale or needs confirming)
  - source (customer or platform)
  - source message ID
  - captured time
  - earlier values
- **Required progress:** collected count and total.
- **Pending follow-up:** channel and due time, or nothing.

**Settings route (Phase 5):** AI mode.

---

## Out of this plan

- The old product-recommendation screen (`app/dealer/upsell/`). Upselling is out of scope; leave the page unlinked.
- The Dev Console. It's an internal tool in `agentic-upsell/` owned by the AI developer, not part of the dealer portal.
