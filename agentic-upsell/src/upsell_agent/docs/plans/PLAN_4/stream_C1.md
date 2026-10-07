# Stream C1: the CRM runs locally and the AI works through its APIs

Direction from the user: all sending, dates/times and messages go through the CRM's own APIs so everything shows
in the CRM. The Debug UI does not ship.

## Start it

```
docker compose up -d mongodb redis     # MongoDB localhost:27018, Redis localhost:6380 (or: make ai-up)
make platform-install                  # once: npm ci in aidmvcs-be-dev
make ai-install                        # once: uv sync in agentic-upsell
make crm-local                         # CRM web + workers + its own AI API/worker; seeds when empty; Ctrl+C stops
make crm-e2e                           # 40 checks against the running stack
make crm-compare                       # what the AI reads (Customer 360, /api/car) vs its own copy
make crm-seed                          # demo data from scratch
```

| What | Where |
|---|---|
| CRM | http://localhost:3100/dealer (admin: /admin) |
| AI API | http://localhost:8110/health |
| Database | `mongodb://localhost:27018/autopulse_local` |
| Redis | localhost:6380, db 4 (CRM queues), db 5 (AI queue `ai-turns-crm-local`) |
| n8n stand-in | http://localhost:3998/hits (must stay empty for the AI dealer) |
| Stubbed sends | collection `dev_provider_outbox` |

Logins, password `AutopulseDemo#1`:
- dealer owner `demo-dealer@autopulse.local` (the OTP is returned by the login call and the page moves on; the OTP
  mail itself is stubbed and logged by `[web]` as `[provider-stub]`)
- staff `sam.sales@autopulse.local`, `maya.manager@autopulse.local`
- admin `admin@autopulse.local` (no OTP)

`make crm-local` never touches the shared `autopulse-ai-*` containers: it runs the AI service from source with uv on
its own port, Redis db and queue. Ports and database can be changed with `CRM_LOCAL_WEB_PORT`, `CRM_LOCAL_AI_PORT`,
`CRM_LOCAL_MONGODB_URI`, `CRM_LOCAL_REDIS_DB`. Real models: `AI_MODEL_EXTRACT=openai:gpt-4o-mini
AI_MODEL_COMPOSE=openai:gpt-4o make crm-local` (default: the offline stand-in).

`make dev-full` / `make ai-e2e` (the older setup with the AI containers) now default to MongoDB 27018 / Redis 6380;
port 27017 on this machine is another project's database.

## What was built

**Send through the CRM.** `CHANNEL_DRIVER=platform` (`channels/platform.py`) posts to
`POST /api/internal/ai/messages/send` (shared secret). The CRM sends with its own `sendSMS` / `sendEmail` from the
dealer's Twilio number / mailbox, writes the AI `Email` row (same idempotency key as before, so the sender's later
record call is answered with the same row), and returns the provider id. Delivery status still comes through
`/api/internal/ai/messages/status`. `media_urls` (on `OutboundMessage`, `SendRequest` and the record payload) become
Twilio `MediaUrl` for a text, inline images for an email, and `attachments` on the conversation record. Photos by
text need the dealer field `ai_mms_enabled`; without it the text goes alone. Answers: 200 sent, 422 + `opted_out`
(STOP: suppressed, consent off), 422 permanent, 502 retryable.

**Local stub.** `PROVIDER_SEND_STUB=true` (`app/lib/providerStub.js`) makes `sendSMS`, `sendEmail` and the account
mails no-ops that return a fake provider id and write to `dev_provider_outbox`. Ignored when `NODE_ENV=production`.
`crm-local` and `dev-full` always set it.

**Booking.** `/api/booking` accepts the shared secret (the AI), a staff JWT, or no token (the public customer page,
as before). `app/lib/bookingService.js` holds one check for every path: inside `weekly_availability`, and at most
`dealer_account_information.booking_max_per_slot` bookings (default 1) per `booking_slot_minutes` (default 30).
A taken slot is `409 {error: "slot_taken", message, alternatives}`; closed / outside hours / past is 422. Also:
`GET ?dealer_id&date` lists the day's slots, `GET ?booking_id` returns one booking, a repeated booking by the same
lead returns the existing one, a race for the last place is settled by creation order, `PUT` applies a new date/time
with the same check and takes `showed`. `Booking` gained `showed`, `showed_at`, `created_by`; `email` / `phone` are
no longer required (SMS-only leads). The lead-status route ("Appointment Booked") runs the same check and now saves a
`Booking` too, so staff and AI bookings share one calendar; Visited / No Show set `showed`. The AI side raises
`SlotTakenError` on 409 and offers fresh times.

**No double messages for an AI-live dealer.** Skipped by the CRM: booking confirmation and update messages
(booking route and status route), appointment reminders and post-appointment follow-ups (not created; ones created
earlier are cancelled when they come due), managerial review messages, the no-show message, rule-based FollowUpJobs
(already gated). n8n is not called (tripwire check B7). `shadow` and `off` dealers behave as before.

**Statuses.** `Closed - Lost` added to the three StatusModals, LeadList, leadListlatest (filter + badge), to
`STAFF_OWNED_STATUSES` and to the AI's `STAFF_STATUS_EVENTS` (`staff_closed_lost`). Sold Pending, Sold Delivered and
Unsold were already there. Closed - Lost or Sold Delivered on a Sold Pending lead reaches the AI (checks E5, E6).
The lead list shows the AI's stage read only under the status (`ai_stage_label`, from `ai_lead_state`).

**DND both ways.** Customer opts out of every channel with the AI → `POST /api/internal/ai/leads/dnd` → lead DND
+ an internal note, CRM follow-ups and reminders cleared (F1). Staff DND → `lead-paused` → AI stage Opted Out (F2).

**Notes.** `POST /api/internal/ai/leads/notes {dealer_id, lead_id, text, kind}` and
`LivePlatformClient.add_lead_note` (for service requests; nothing calls it yet).

**Read-only sources, checked against the local CRM.** Customer 360: 9/9 customers match between the AI's own copy and
`/api/customers/<id>/360`. Stock: 295/295 searches match `/api/car`. Dealer name, agent name and hours come from the
dealer record (visible in the first reply). Nothing needed fixing.

## Decisions

- The send endpoint writes the `Email` row only for a successful send; a failure is recorded by the AI service after
  its retries, as before.
- For an AI-live dealer the platform's booking confirmation is skipped for staff and customer-page bookings too; the
  AI is told (`Appointment Booked`) and sends the client's appointment messages.
- Staff can overbook on purpose (`allow_overbook: true`) and can enter a past time; the AI and the customer page
  cannot.
- Redis isolation is by `REDIS_DB` (new, default 0) on every CRM connection.
- The seed keeps customers' owned cars out of `vehicles` (that collection is stock); the 360 takes them from deals.

## Stubbed / not real locally

- Twilio, SMTP/SES and account mails (provider stub). Mailgun campaign sends still have placeholder credentials.
- n8n (tripwire stand-in). The AI models (offline stand-in unless `AI_MODEL_*` is set).
- Vehicle photos are placehold.co URLs.

## Open items

- The StatusModals don't offer `allow_overbook`; a 409 shows as an alert in the lead list only (LeadList,
  leadListlatest). The booking and conversation screens still show their generic error.
- Staff users in the seed have no Role; the owner login is the one to use.
- Booking capacity has no settings screen: set `booking_max_per_slot` / `booking_slot_minutes` on the dealer record.
- The AI's own availability read treats any booking as a full slot; with `booking_max_per_slot` > 1 it offers fewer
  times than the CRM would accept.
- `make ai-e2e` (older container setup) was not re-run here: it needs the shared AI containers recreated with
  `PLATFORM_CLIENT=live`, which this stream must not touch.
- One unit test (`test_compliance.py::test_an_admin_resume_resolves_the_review`) failed once in a full run and passed
  on every rerun; not touched by this stream.
