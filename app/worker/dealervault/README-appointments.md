# SV_APPT checkpoint report

The `dealervault-service-appointments` queue now writes DealerTrack SV_APPT rows
to ServiceAppointment. The existing worker entrypoint registers the worker through
`setupDealerVaultWorkers()` and reuses its Redis connection. Batch concurrency is
controlled by `DEALERVAULT_SV_APPT_CONCURRENCY`, default 5.

## Files changed in this milestone

Added:

- `app/worker/dealervault/serviceAppointmentWorker.js`
- `app/worker/dealervault/common/appointmentFields.js`
- `app/worker/dealervault/common/repairOrderResolver.js`
- `test-dealervault-appointments.js`
- this checkpoint report

Updated:

- `app/worker/dealervault/queues.js`, `index.js`, and `app/lib/queue.js`: queue registration, lazy producer access, and shared retry defaults.
- `app/worker/dealervault/common/logger.js`: safe appointment validation and RO/date/delimiter warning codes.
- `scripts/ensure-dealervault-indexes.js`: verify/apply ServiceAppointment's existing unique natural-key index.
- `app/worker/dealervault/README.md`: supported worker and test documentation.

No domain schema/index definitions were changed in this milestone. In particular,
ServiceAppointment remains `strict:false`, and Booking and AppointmentReminder
were neither imported nor modified. Earlier milestone changes in the workspace
were preserved. No production indexes or data were modified.

## ServiceAppointment fields written

The whitelist exactly matches all 105 columns in the monorepo's
`scripts/dealervault/dealertrack_file_types.txt`. Supplied official fields retain
their original header names and string/null values. This includes appointment
dates/times, concerns, operation/advisor fields, waiting/loaner/transport flags,
estimates, vehicle descriptions, all eight VIN-explosion fields, customer/address
and contact-block fields, and all 21 CASS fields.

Unknown fields are retained only in raw staging. Source `_id`, internal dealer
IDs, timestamps, processing metadata, relationship IDs and normalized field names
cannot override worker-owned values.

Worker-owned fields:

| Field | Behavior |
| --- | --- |
| `dealer_id` | Internal dealer ID resolved once per batch from the validated DV ID. |
| `appointment_number` | Required trimmed string; leading zeros retained. |
| `ro_number` | Trimmed string when RO Number was supplied; never cast to a number. |
| `customer_number` | Trimmed string when Customer Number was supplied. |
| `vin` | Shared trim/uppercase usable-VIN normalization, only when VIN was supplied. |
| `appointment_date`, `appointment_time` | Exact source values when supplied; no Date/timezone conversion. |
| `customer_id`, `vehicle_id`, `repair_order_id` | Resolved ObjectId links; explicit unresolved identity inputs set the applicable link to null. |
| `source_file_timestamp`, `source_batch_id`, `source_row_index` | Shared filename timestamp and zero-based row provenance. |
| `source_import` | Provider, filename, SV_APPT type and external dealer ID. |

Absent optional source columns and normalized aliases are omitted. A partial row
with wholly absent identity inputs does not clear its previously stored link.
Explicit blank/null/unresolved identity inputs can clear an obsolete link. Normal
Mongoose timestamps continue to manage `createdAt` and `updatedAt`.

## Relationships

Customer resolution calls the already-approved shared SL/SV helper. Dealer-scoped
DMS customer-number mappings take precedence over contact matching. Otherwise an
unambiguous normalized contact match is reused and can receive the mapping; a
stable Customer Number with no match permits the approved Customer creation path.
Conflicts, ambiguous contacts, merged Customers and insufficient identity remain
unresolved with warnings, while otherwise valid appointments persist.

Customer contact values, existing primary flags, consent and merge history remain
untouched. No Leads are created. Opt Out/Block fields and CASS data are source
metadata on ServiceAppointment only; they do not update canonical Customer
addresses or communication consent. Customer reconciliation stays bounded at
five tasks per batch, with prefetched mapping/contact candidates and existing
mapping-index duplicate-race recovery.

Vehicle lookup is batched by `{ dealerId, vin }`. Only a single matching Vehicle
is linked. Missing/invalid/ambiguous VINs produce the existing shared warnings.
Vehicle fields and inventory documents are never created or updated.

RepairOrder lookup is batched by `{ dealer_id, ro_number: { $in: numbers } }`.
Exactly one match produces `repair_order_id`. An unmatched nonblank number is
retained and produces `SV_APPT_RO_UNRESOLVED`; multiple matches produce
`SV_APPT_RO_AMBIGUOUS`. No RepairOrder is created or modified. An absent or blank
RO Number is legitimate and does not itself generate an RO warning.

Business relationship failures do not reject valid appointments. Database/query
failures remain job-level retryable errors, sanitized by the shared processor;
they are not converted into falsely completed imports.

## Dates, operations and assumptions

There is no existing canonical datetime representation on ServiceAppointment.
The new date/time aliases therefore retain the exact source strings. Optional
date checks use the reference's M/D/YYYY convention, including leap-year/calendar
validation, and issue one `SV_APPT_INVALID_DATE` warning per row with invalid
nonblank date strings. Blank/null/absent dates are allowed. Invalid strings remain
stored and do not reject valid appointments. Time strings are not parsed because
the reference does not establish a time format or timezone.

The date check covers Appointment Date, Appointment Create Date, Last RO Date,
Promise Date, Delivery Date, In Service Date, Birth Date, Customer Create Date and
Customer Last Activity Date. It does not infer a date from other fields or replace
any source values.

Operation Code, Operation Code Description, Recommended Operation Code and
Recommended Operation Code Description remain literal strings. There is no
repeating-group parsing or derived service-operation array. If any contain `|`
or `^`, the worker retains them unchanged and emits the safe
`SV_APPT_OPERATION_DELIMITERS` warning for review. Delimiter presence does not
establish a repeating structure. No actual provider sample with these delimiters
was supplied during this milestone; tests use synthetic values.

## Staging, ordering and retries

The existing 1–100 row and 500,000 UTF-8 byte limits, filename/type/dealer checks,
dealer resolution and raw-staging boundary are reused. All raw rows are persisted
before normalization or relationship writes, with the established staging identity
and canonical digest. Unknown columns and original date/operation strings survive
unchanged in raw staging.

ServiceAppointment uses the shared guarded unordered bulk upserts with natural
key `{ dealer_id, appointment_number }`. Older source timestamps cannot overwrite
newer appointments. Equal timestamps retain the established shared behavior.
Missing appointment index protection produces retryable `INDEX_REQUIRED`.

Completed/completed-with-errors deliveries return stored counts without repeating
domain processing. Failed/incomplete deliveries retry their original staged batch.
Changed digests permanently fail without overwriting the original raw data.
Missing Appointment Number and malformed source structure are row failures;
other valid rows continue. Dates and relationship warnings are stored in per-row
staging outcomes and sanitized operational logs.

## Tests and checkpoint limitations

- 30 appointment unit tests passed.
- 77 shared/PTINV/SL/SV regression unit tests passed.
- The real Redis/BullMQ appointment redelivery test passed using a memory database.
  A simulated acknowledgement failure triggered a retry that reused completed
  staging without duplicate appointments, Customer mappings or counts.
- Opt-in Mongo integration was added for the real unique appointment index,
  concurrent appointment/Customer mapping writes, timestamp guards, BSON ObjectId
  links, dealer isolation and read-only RepairOrder/Vehicle behavior. It could not
  run here: the available Mongo 8.0 image refuses this host's kernel, as verified
  earlier in the session (SERVER-121912).
- Targeted ESLint passed except for the confirmed pre-existing unused
  `getRedisConnection` error in `app/lib/queue.js`.
- `git diff --check` passed.

From `aidmvcs-be-dev`:

```bash
node test-dealervault-common.js
node test-dealervault-parts.js
node test-dealervault-sales.js
node test-dealervault-service.js
node test-dealervault-appointments.js
./node_modules/.bin/eslint app/worker/dealervault scripts/ensure-dealervault-indexes.js test-dealervault-appointments.js
```

Set `DEALERVAULT_TEST_MONGO_URI` to a disposable localhost Mongo server to run the
Mongo test; only a uniquely generated `dealervault_test_appointments_*` database
is created and dropped. Set `DEALERVAULT_TEST_REDIS_PORT` for the separate localhost
Redis test; it removes only its uniquely named test queue.

Before rollout, run the Mongo integration test on a compatible server and verify
required indexes with the explicit index utility and an authorized
`DEALERVAULT_INDEX_MONGO_URI`. Existing Customer limitations are unchanged: different
DMS numbers concurrently using the same contact can create separate Customers,
and merged/conflicting identities need resolution outside these workers.

An RO created after an appointment's completed import is linked only when a new
processable source batch supplies that RO Number. Replaying the same completed
batch deliberately does not refresh relationships. Automatic backfill, reminders,
booking workflows and consent/address policy changes are outside this milestone.
