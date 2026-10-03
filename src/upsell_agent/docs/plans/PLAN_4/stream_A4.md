# Stream A4 - NHTSA recalls (D6) and Vehicle Databases maintenance (D5)

Sources: SOLD-DELIVERED PDF §5, §6, §12, §14; `docs/data/5/vechicle_api.md`; conversation_6.md items 14-16
(client, 30 Sep: "with those integrations we don't need to set up cadences because they alert the ai to send a
message/create a task"; scope Q16: service visits are offered with notes, never booked in this SOW).

## Files
- `integrations/nhtsa.py` - vPIC VIN decode + recalls-by-vehicle client (rate limit, 24h model cache).
- `integrations/vehicle_databases.py` - maintenance v4 client, built from public docs only, mocked in tests.
- `agent/service_events.py` - the A3 interface (OwnershipPort + LocalFallback), event recording, vehicle registry.
- `agent/recalls.py` - D6 monitor, sweep, staff confirm/close.
- `agent/maintenance.py` - D5 due calculation (pure `compute_status`), sweep, mileage/service updates.
- `guardrails/service_claims.py` - recall / maintenance claim checks; hooked into `draft_guard.check_draft(service_facts=)`.
- `api/service_vehicles.py` - read + staff endpoints.
- Shared edits (marked "MASTER_PLAN_4 D5/D6 (stream A4)"): `config.py`, `integrations/mongodb.py`, `worker/jobs.py`,
  `worker/main.py`, `main.py`, `guardrails/draft_guard.py`, `agent/nodes/guard.py`.
- Tests: `tests/unit/test_service_monitors.py`, fixtures `tests/unit/fixtures/nhtsa/` (recorded live 4 Oct 2026).

## NHTSA (verified live, 4 Oct 2026)
- `GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json` - `Results[0].Make/Model/ModelYear`,
  `ErrorCode` "0" = clean; "1" = bad check digit (we refuse to look such a VIN up and tell staff).
- `GET https://api.nhtsa.gov/recalls/recallsByVehicle?make=&model=&modelYear=` - `results[]` with
  `NHTSACampaignNumber, Component, Summary, Consequence, Remedy, ReportReceivedDate (DD/MM/YYYY)`; empty = `Count 0`.
- **No public VIN-level recall API**: `/recalls/recallsByVin`, `/vehicles/byVin` answer 403.
  So every NHTSA match is **model-level**: stored `status=unverified, match_level=model` and raises only a staff
  notice (RECALL_REVIEW). Staff check the VIN (nhtsa.gov/recalls or the OEM) and confirm -> `open, match_level=vin`
  -> customer outreach. `completed` (staff, or a repair order for the VIN naming the campaign number) and
  `not_applicable` stop it.
- Sweep hourly (cron :23), each owned vehicle re-checked every `RECALL_RECHECK_DAYS`=7, ≤`RECALL_SWEEP_BATCH`=100
  per run, ≥1 s between calls, retry after an error in 6 h. VIN decoded once and kept.
- Cadence: first outreach on confirmation, reminders every 30 days, at most 3 in all.

## Vehicle Databases (no calls made; trial not started)
- `GET https://api.vehicledatabases.com/vehicle-maintenance/v4/{vin}`, header `x-authkey`. Off unless
  `VEHICLE_DATABASES_ENABLED=true` and `VEHICLE_DATABASES_API_KEY` set. Schedule fetched once per VIN, refreshed
  after 180 days (30 days after a "no record" 400). 403/429/5xx retry next sweep; 401/402/422 don't.
- The schedule is **mileage-only** (no time intervals in the docs).

## Maintenance rules
- Verified mileage only: RO `Mileage Out`/`RO Mileage` at the RO date, deal `Delivery Mileage`/`Mileage` at the
  contract date, staff readings. Current if ≤120 days old. Never estimated.
- Mileage basis: due when the verified reading is within 1,000 mi of a schedule mileage not yet serviced; the
  latest one reached covers earlier ones; the schedule starts from the delivery mileage (a used car isn't
  chased for pre-sale services).
- Time basis (no current reading): `MAINTENANCE_TIME_INTERVAL_MONTHS`=6 since the last visit/delivery; facts carry no
  mileage and no items.
- No schedule = no maintenance outreach. Each due service alerts once (`maintenance:{vin}:{due_key}`); a
  recall outreach in the last 7 days holds maintenance back. Sweep hourly (cron :41), each vehicle daily; staff
  updates recalculate at once.

## A3 interface
`agent/ownership.py` module-level functions (sync or async):
```
vehicle_is_owned(dealer_id: str, vin: str, *, customer_id: str | None = None) -> bool | None   # None = unknown = no outreach
queue_service_outreach(dealer_id: str, event: dict) -> dict   # returns {"status": "queued"|..., ...}
```
`service_events.ownership_port()` picks them up automatically once both exist; until then the LocalFallback
writes a lead staff notice. A3 may also call `service_events.register_vehicle(dealer_id, vin, customer_id=,
lead_id=, delivered_at=)` on SOLD-DELIVERED and `service_events.stop_vehicle(dealer_id, vin, reason=)` on §8 NO
(the sweeps also discover `stage=sold_delivered` leads themselves). For Compose, put `event["facts"]` into
`state.decision["service_facts"]`: the guard then allows exactly those claims.

Event passed to `queue_service_outreach`:
```json
{"event_id": "...", "event_key": "recall:VIN:20V314000:1", "type": "RECALL_DETECTED" | "MAINTENANCE_DUE",
 "vin": "...", "customer_id": "...", "lead_id": "...", "vehicle": {"year": 2018, "make": "HONDA", "model": "Accord"},
 "offer": "service_visit_request", "customer_facing": true, "summary": "staff-readable line",
 "facts": <recall or maintenance facts>, "created_at": "...", "status": "new", "dealer_id": "..."}
```
Recall facts: `{kind: "recall", source: "NHTSA", vin_confirmed: true, reminder, recall_id, component, description,
remedy, vehicle, year}`. Maintenance facts: `{kind: "maintenance", basis: "mileage"|"time", source, service_items[],
interval_miles, verified_mileage: {miles, observed_at, source}|null, mileage_is_estimate: false,
[months_since_last_visit, last_visit_date, last_visit_was], vehicle, year}`.

## Endpoints (shared-secret auth)
- `GET /v1/vehicles/{vin}/service-status?dealer_id=` -> `{vehicle, recalls[], maintenance, events[]}`
- `GET /v1/vehicles/{vin}/recalls?dealer_id=` -> `[{recall_id, description, component, consequence, remedy,
  manufacturer, report_received_at, detected_at, status: unverified|open|completed|not_applicable, match_level:
  model|vin, source, last_checked_at, vin_confirmation, outreach: {count, last_at, next_allowed_at}, closed_at,
  closed_reason, closed_source, customer_outreach_allowed}]`
- `GET /v1/vehicles/{vin}/maintenance?dealer_id=` -> `{status: {status: due|not_due|schedule_complete|no_schedule|
  unknown|not_owned, basis, reason, current_mileage, latest_mileage, last_service, serviced_through_miles,
  next_service, due: {due_key, basis, interval, facts}, schedule_problem?, held_back?, calculated_at},
  schedule_source, schedule_fetched_at, schedule}`
- `vehicle`: `{vin, year, make, model, customer_id, lead_id, ownership_status, delivered_at, recall_check, recalls_next_check_at}`
- `POST /v1/vehicles/{vin}/recalls/{id}/confirm {dealer_id, by?, note?}`; `.../close {dealer_id, reason, by?, note?}`
- `POST /v1/vehicles/{vin}/mileage {dealer_id, miles, observed_at?, by?}`; `POST /v1/vehicles/{vin}/service
  {dealer_id, at?, miles?, outside?, by?, note?}` -> maintenance view.

## Open items
1. Client: is staff VIN confirmation acceptable as "VIN-specific authoritative support"? Vehicle Databases also has
   a VIN recall API (`/vehicle-recalls/{vin}`) - could serve as the VIN-level source once the trial starts.
2. Client: the time-based interval (6 months is our placeholder; the schedule has none).
3. A dealer visit at/after a schedule mileage counts as that service done (RO operations aren't matched to OEM items).
4. D4 (Day-3 first service) can reuse `maintenance.compute_status(...)["next_service"]`.
5. Pre-existing ruff findings (auth.py B008, mongodb/redis PLW0602, test_qualification_state C408) left alone.
