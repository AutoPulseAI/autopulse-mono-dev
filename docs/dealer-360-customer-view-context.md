# Context: Building a "Dealer 360 View" of the Customer — AutoPulse (aidmvcs-be-dev)

## What I'm trying to do
I want to design/build a "360 view" page for a dealer's customer — one screen that
pulls together everything the dealer's system knows about a customer (contact
profile, leads/conversations, vehicles owned, sales history, service history,
appointments, marketing touches) instead of the fragmented views that exist today.

## System overview
- **aidmvcs-be-dev**: Next.js app (App Router), MongoDB via Mongoose. This is the
  core dealer-facing CRM/DMS-adjacent product. Multi-tenant: `agency` owns
  `dealer`s; roles include admin / agency / dealer / vendor / staff.
- **autopulse-chatbot-be-dev**: separate Laravel app (chatbot), not yet explored
  for customer-data overlap — flag as a possible additional data source (chat
  transcripts) if relevant.
- **DealerVault**: a DMS (DealerTrack) data-ingestion pipeline that syncs Sales
  (SL), Service/Repair Orders (SV), Service Appointments (SV_APPT), and Parts
  Inventory (PTINV) TSV exports into Mongo via SQS → BullMQ workers
  (`app/worker/dealervault/*`). This is the main source of "real" transactional
  history for a customer, separate from inbound web leads.

## Current Customer data model (`app/models/Customer.js`)
Fields: `dealer_id`, `name`, `emails[]` (value/is_primary/source/first_seen_lead_id),
`phones[]` (value/is_primary/source/sms_opt_in/first_seen_lead_id),
`followup_preference`, `preferred_communication_mode(_selected)`, `user_language`,
`dealervault_upload` (bool — came from DMS), `inbound_lead` (bool — came from a web
lead), `merged_into` / `merge_history[]` (dedup/merge support), `extra` (Mixed
catch-all — DMS-sourced fields live under `extra.dealervault.customer_numbers`,
which has its own partial unique index per dealer).

Indexes: `{dealer_id, emails.value}`, `{dealer_id, phones.value}`, and a unique
partial index on `{dealer_id, extra.dealervault.customer_numbers}`.

**Key gap:** Customer has no direct `customer_number` field for DMS joins — it's
buried in `extra.dealervault.customer_numbers` (array, one dealer can have several
DMS customer numbers merged onto one Customer record over time).

## How other entities relate to a Customer (this is the crux of the "360" problem)

| Model | Storage | Links to Customer | Links to Vehicle |
|---|---|---|---|
| `Lead` | strict:false, has `customer_id` (real ObjectId ref) | **Direct FK** — `customer_id` | via `vin`/`vehicle_*` fields inside lead data |
| `Deal` (Sales, from SL files) | strict:false, only `dealer_id`, `deal_number`, `vin`, `customer_number` indexed | **Indirect** — `customer_number` (string) must be matched against `Customer.extra.dealervault.customer_numbers` | `vin` |
| `RepairOrder` (Service, from SV files) | strict:false, only `dealer_id`, `ro_number`, `vin`, `customer_number` indexed | **Indirect** — same `customer_number` join | `vin` |
| `ServiceAppointment` (from SV_APPT files) | strict:false, `dealer_id`, `appointment_number`, `ro_number`, `vin` | **No customer_number field at all** — only reachable via `vin`, or by forward-link to its `RepairOrder` once the appointment converts (`ro_number`) | `vin` |
| `PartInventory` (from PTINV files) | strict:false, `dealer_id`, `part_number` | **No customer link** — inventory only; customer-level parts usage would have to come from RepairOrder line items (packed Operation/Part fields), not this collection | n/a |
| `Vehicle` | strict:false, `dealerId`, `vin` (unique per dealer) | **No owner field** — Vehicle is just a VIN-keyed bag of attributes; ownership is inferred transitively through Deal/RepairOrder `vin` matches, not stored on Vehicle itself | — |
| `Email` (conversations) | strict:false | via `lead_id` → `Lead.customer_id` (no direct customer_id on Email) | — |
| `CampaignLead` | has `lead_id` (nullable) | Indirect via `lead_id` → `Lead.customer_id` | — |

**Bottom line:** Today, only `Lead` has a real `customer_id` foreign key to
`Customer`. Everything financial/transactional (Deal, RepairOrder,
ServiceAppointment, PartInventory) is DMS-imported, `strict:false`, and joined
only by loose string keys (`customer_number`, `vin`) scattered per-dealer. A 360
view has to do these joins at query time (or a backfill would need to add a
`customer_id` to Deal/RepairOrder the way `customerResolver.js` already resolves
it during ingestion — see below).

## Existing customer-matching logic (already solved, reusable)
`app/worker/dealervault/common/customerResolver.js` — runs during DealerVault
ingestion. For each imported row it:
1. Groups rows by DMS `customer_number` within the batch.
2. Tries to match an existing `Customer` by `extra.dealervault.customer_numbers`
   first, then falls back to email/phone matching (stricter cross-source
   matching rules: DealerVault-origin customers match on email OR phone; brand
   new cross-source matches require both).
3. Creates a new `Customer` if no match, or flags `CUSTOMER_AMBIGUOUS` /
   `CUSTOMER_MERGED` / `CUSTOMER_UNRESOLVED` warnings when it can't safely
   resolve one.
4. Sets `entry.document.customer_id` on the row **in memory during ingestion**
   — but note: Deal/RepairOrder schemas above don't actually declare/persist a
   `customer_id` field even though the resolver computes one. Worth checking
   `salesWorker.js` / `serviceWorker.js` to see whether that computed
   `customer_id` is actually written to `extra` or dropped — this is a good
   question to dig into before designing the 360 view's join strategy.

`vehicleResolver.js` does the analogous thing for VIN → `Vehicle._id`
(`vehicle_id`), including `VEHICLE_AMBIGUOUS`/`VEHICLE_NOT_FOUND` warnings when a
VIN doesn't cleanly resolve to one Vehicle document.

## What exists today for viewing a customer (starting point, not the 360 view)
- **Page:** `app/dealer/customers/[id]/page.js` → renders
  `app/dealer/customers/[id]/components/CustomerDetail.js`.
- **What it shows now:** customer profile card (emails, phones, follow-up
  preference, preferred contact mode, language, lead count, created/updated) +
  a paginated accordion of that customer's **Leads only**, each expandable to
  show its conversation thread (`ViewConversations`) and ADF payload if
  applicable.
- **It does NOT show:** vehicles owned, sales/deals, service history, upcoming
  appointments, parts, or campaign touches. This is exactly the gap the 360
  view needs to close.
- **API:** `GET /api/customers/[id]?dealer_id=...` — returns the Customer doc
  plus a computed `lead_count`. `GET /api/customers/[id]/adjacent` — prev/next
  customer for list navigation (keyset pagination by updatedAt/createdAt/_id).
  Both auth-gate via JWT bearer token + `isAuthorizedForDealer`.
- **List:** `app/dealer/customers/page.js` + `CustomerList.js`, backed by
  `GET /api/customers`.

## Other customer touchpoints not yet wired to Customer at all
- `Email` model: has `communication_type: email|sms|note`, `is_note`,
  `is_appointment_notification`, read/unread tracking — all keyed by `lead_id`,
  not `customer_id`. A 360 "communications" tab would need to fan out through
  all of a customer's leads to collect these.
- `CampaignLead` / `Campaign`: marketing send tracking, keyed by `lead_id`.
- `DealerWebsiteClick` / `VehicleClick`: site behavior tracking — worth
  checking if these carry any customer/lead identifier for a "engagement"
  section of the 360 view.
- `autopulse-chatbot-be-dev` (Laravel chatbot): unexplored — may hold its own
  conversation history for the same customers; worth a data-source question
  before scoping v1.

## Relevant file paths (for the other Claude chat to reference or for me to dig into further)
- `aidmvcs-be-dev/app/models/{Customer,Lead,Deal,RepairOrder,ServiceAppointment,PartInventory,Vehicle,Email,CampaignLead}.js`
- `aidmvcs-be-dev/app/api/customers/route.js`, `[id]/route.js`, `[id]/adjacent/route.js`
- `aidmvcs-be-dev/app/dealer/customers/page.js`, `[id]/page.js`, `[id]/components/CustomerDetail.js`
- `aidmvcs-be-dev/app/worker/dealervault/common/customerResolver.js` (customer matching logic)
- `aidmvcs-be-dev/app/worker/dealervault/common/vehicleResolver.js` (VIN matching logic)
- `aidmvcs-be-dev/app/worker/dealervault/{salesWorker,serviceWorker,serviceAppointmentWorker,partsInventoryWorker}.js`
- `aidmvcs-be-dev/app/worker/dealervault/README.md`, `README-service.md`, `README-appointments.md`
- `scripts/dealervault/dealertrack_file_types.txt` (source-of-truth column reference for DMS files)

## Open questions worth resolving in the planning conversation
1. Do we add a real `customer_id` field to `Deal`/`RepairOrder`/`ServiceAppointment`
   (persisted at ingestion time, reusing the resolver's already-computed value)
   so the 360 view can do simple `find({customer_id})` queries instead of
   fan-out joins on `customer_number`/`vin` at read time?
2. Should `Vehicle` gain an `owner_customer_id` (current owner) separate from
   historical Deal buyers (a vehicle can change hands)?
3. What's v1 scope: read-only aggregated view (profile + vehicles + deals +
   ROs + appointments + leads/conversations), or also actionable (e.g. book a
   service appointment, start a new deal, log a note) from that one screen?
4. Does the chatbot (Laravel app) need to be folded in, or is that a v2 data
   source?
5. Performance: Deal/RepairOrder/ServiceAppointment are `strict:false` with
   only a few indexed fields — a 360 view assembling many customers' full
   histories (e.g., a dashboard) vs. one customer's full history (this page)
   have very different query-cost profiles; scope the indexes accordingly.
