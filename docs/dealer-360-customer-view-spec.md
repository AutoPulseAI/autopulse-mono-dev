# Dealer 360 Customer View — Build Spec (v1)

Status: build-ready. All open questions from planning resolved and confirmed against
the actual `aidmvcs-be-dev` codebase (see "Confirmed decisions" below).

## 1. Scope

**In scope (v1):** a read-only, assembled view of a single Customer, combining:
profile/identity, leads & communications, deals (sales), repair orders, service
appointments, and referenced vehicles.

**Out of scope (v1):**
- Any write/action from the 360 page itself (booking, deal creation, notes). Link out to
  existing operational screens instead.
- Laravel chatbot as a communications source (v2).
- `owner_customer_id` on Vehicle (ownership stays derived, not stored).
- New identity-resolution logic — this feature consumes `customer_id` as already
  resolved by `customerResolver.js`; it does not change resolution behavior.

## 2. Confirmed decisions (do not re-litigate these in implementation)

| Question | Decision | Evidence |
|---|---|---|
| Is `customer_id` persisted on Deal/RepairOrder/ServiceAppointment? | **Yes.** Query directly with `find({dealer_id, customer_id})`. | `customerResolver.js:139` sets it, `batchProcessor.js:49` writes it, schemas are `strict:false` so it persists though undeclared. Verified against salesWorker.js, serviceWorker.js, serviceAppointmentWorker.js, and existing tests. |
| Does Vehicle get an owner field? | **No.** Derive current owner as `customer_id` on the most recent record across Deal ∪ RepairOrder ∪ ServiceAppointment for that VIN (not Deal alone — a vehicle bought elsewhere and only ever serviced here would otherwise show no owner). "Vehicles" tab = vehicles referenced by this customer's deals/ROs/appointments, not "currently owned." | `Vehicle.js` has no ownership field; `vehicleResolver.js` only reads, never writes back to Vehicle. |
| v1 interaction model? | **Read-only**, with links out to existing screens for any action. | DMS writes are timestamp-gated against `source_file_timestamp`; a UI-originated write risks silent overwrite on next sync. |
| Chatbot as comms source? | **Deferred to v2.** | Laravel app on its own SQL DB with its own customer/dealer tables — no confirmed identity bridge to Mongo `Customer`. |

## 3. Data model & API contract

### 3.1 Required index additions
```
Deal.createIndex({ dealer_id: 1, customer_id: 1 })
RepairOrder.createIndex({ dealer_id: 1, customer_id: 1 })
ServiceAppointment.createIndex({ dealer_id: 1, customer_id: 1 })
```

### 3.2 New endpoint: `GET /api/customers/[id]/360`
Auth: same JWT bearer + `isAuthorizedForDealer` gate as existing `/api/customers/[id]`.

Assembles, in parallel:
```
customer        = Customer.findById(id)
leads           = Lead.find({ customer_id: id, dealer_id })
                    // existing Email/SMS threads already reachable via lead_id
deals           = Deal.find({ dealer_id, customer_id: id })
repairOrders    = RepairOrder.find({ dealer_id, customer_id: id })
appointments    = ServiceAppointment.find({ dealer_id, customer_id: id })
vehicles        = derived: unique VINs across deals + repairOrders + appointments,
                   each hydrated from Vehicle.find({ dealerId, vin: { $in: [...] } }),
                   with "current owner" = customer_id on the most recent record
                   (by its own date field — see §3.4) across Deal ∪ RepairOrder ∪
                   ServiceAppointment for that VIN, not Deal alone. A vehicle bought
                   elsewhere and only ever serviced here still resolves an owner.
```

No per-record `source` tag on Deal/RepairOrder/ServiceAppointment — every `normalize*`
function hardcodes `source_import.provider = 'dealervault'` for these three collections,
so a field that's always the same value conveys nothing. The Customer-level origin badge
(§3.3) already covers the DealerVault-vs-inbound distinction. `Lead.source` (email/adf/web)
is the one genuinely meaningful per-record source field and stays as-is on Lead/the Leads
tab — it answers a different question (which channel) than the badge does.

Note, not a requirement to implement: `find({customer_id: id})` can never return a record
with `customer_id: null` — exclusion of unresolved records is true by construction, not
logic to write.

### 3.3 Origin classification (Customer-level, header badge)
Driven directly by `dealervault_upload` / `inbound_lead` booleans on Customer:

| `dealervault_upload` | `inbound_lead` | Badge |
|---|---|---|
| `false` | `true` | **Inbound Lead** |
| `true` | `false` | **DealerVault** |
| `true` | `true` | **Inbound & DealerVault** |
| `false` | `false` | **Unknown** |

### 3.4 Source field mapping (required before implementation — these are raw TSV headers)

Deal/RepairOrder/ServiceAppointment are `strict:false` mirrors of DealerVault TSV columns,
so every field below is a literal space-containing string key (e.g. `doc['Sales Price']`).
Resolve each TBD before or during implementation, not as a mid-build judgment call:

| Collection | Field | Source column(s) | Status |
|---|---|---|---|
| Deal | date | `"Contract Date"` | **Corrected during implementation** — this section originally said `"Delivery Date"`. The already-shipped `app/dealer/sales/[id]/components/DealDetail.js` displays `"Contract Date"` as a deal's date and never surfaces `"Delivery Date"`; that shipped precedent overrides the earlier guess. |
| Deal | price | `"Sales Price"` | Decided |
| Deal | salesperson | `"Salesman 1 Name"` (2 and 3 possible on split deals) | Decided — plan for multi-salesperson display |
| Deal | trade-in | `trade_ins[]` (normalizer already structures this) | Decided — no extra mapping needed |
| RepairOrder | date(s) | `"Open Date"`, `"Close Date"` (two separate dates) | Decided — pick which drives timeline sort, likely `Close Date`, and show both |
| RepairOrder | total | `"Total Sale"` (all-pay) and `"Customer Total Sale"` (customer-pay) | Decided — show both, labeled, not a single collapsed number |
| ServiceAppointment | date/time | `"Appointment Date"` + `"Appointment Time"` (separate strings, not one datetime) | Decided — must combine/parse before the merged Service timeline can sort correctly |

Header "value snapshot" (§4): total deal $ = sum of `"Sales Price"`; total RO $ shows both
`"Total Sale"` and `"Customer Total Sale"` sums, labeled — consistent with the RepairOrder
tab decision above, not a separately chosen number.

## 4. Frontend structure

Extends the existing `app/dealer/customers/[id]/` route — do not create a parallel page;
enhance `CustomerDetail.js` or split it into a header + tabbed sub-components.

**Header (sticky, always visible):**
- Name, primary email/phone, preferred contact method
- Origin badge (table above)
- Value snapshot: total deal $ (Sales Price), total RO $ (Total Sale and Customer Total Sale, both labeled), last activity date
- (No "needs attention" alerts in v1 — that logic doesn't exist yet; don't invent it here)

**Tabs:**
1. **Overview** — merged recent-activity feed across leads/deals/ROs/appointments, most-recent-first
2. **Leads & Communications** — existing lead + conversation accordion, unchanged from today
3. **Sales** — Deal list: vehicle, date, price, salesperson, trade-in
4. **Service** — RepairOrder + ServiceAppointment merged into one timeline (past visits + upcoming). De-dup required: an appointment forward-links to its RepairOrder via `ro_number` once it converts, so without suppression a completed visit shows twice. Suppress an appointment row when its `ro_number` matches an RO already in the result set (or fold it into that RO's row as "originated from appointment").
5. **Vehicles** — one card per VIN referenced in this customer's records, each linking into Sales/Service filtered to that VIN; label clearly as "referenced," not "owned," since a VIN can span customers historically

No "Data & Identity" admin tab in v1 — cut from original draft since provenance is now a
per-record tag on the main endpoint rather than a separate reconciliation surface; revisit
if merge-conflict visibility becomes a real support need.

## 5. Explicit non-goals for this pass
- No performance optimization beyond the two required indexes above — read-time
  assembly is acceptable at current data volume; revisit only if it becomes a measured
  problem.
- No changes to `customerResolver.js` / `vehicleResolver.js` matching behavior.
- No new write paths anywhere in this feature.
