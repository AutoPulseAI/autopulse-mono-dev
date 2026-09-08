# DealerVault ingestion: PTINV, SL, SV and SV_APPT

The supported queues are `dealervault-parts-inventory`, `dealervault-sales`, and
`dealervault-service`, and `dealervault-service-appointments`. The existing
`app/worker/worker.js` entrypoint starts one BullMQ Worker for each using its Redis
connection. `app/lib/queue.js` exposes the queue through `getQueue()`. Existing
generic queue administration functions keep their previous queue list.

SV's exact repeating-field mapping, parsed representation, partial-row behavior,
and milestone validation report are in [README-service.md](README-service.md).
SV_APPT fields, relationship behavior, date handling and checkpoint results are in
[README-appointments.md](README-appointments.md).

## Producer contract

A producer parses TSV and sends a job such as (the producer is outside this milestone):

```js
{
  fileName: 'DVD46315_20260902_1846_PTINV.txt',
  fileType: 'PTINV',
  dvDealerId: 'DVD46315',
  batchId: 4,
  records: [{ 'Part Number': '001', 'Part Description': 'Example part' }]
}
```

The envelope must contain 1–100 records and serialize to at most 500,000 UTF-8
bytes. `batchId` must be a nonnegative safe integer. Filename dealer/type must
agree with the envelope and the timestamp must be valid. Retain exact reference
headers and text values; supported cell values are strings or null. Part Number
must be a nonblank string. When present, row File Type, DV Dealer ID and Vendor
Dealer ID must agree with the envelope. Bad individual rows fail individually.

The source authority is `scripts/dealervault/dealertrack_file_types.txt` at the
monorepo root. PTINV's 29 reference columns are explicitly allowlisted. Domain
records retain their original header names and text values, with an additional
trimmed `part_number`. Leading zeros, monetary strings, and blank source cells
are preserved. Unknown fields remain in raw staging only. Incoming internal
identifiers, tenant fields, timestamps, metadata, and Mongo operators cannot
override worker-owned domain fields.

Producers should use a stable job ID: SHA-256 of the JSON array
`[dvDealerId, fileName, fileType, batchId]`. Batch membership and IDs must remain
stable on redelivery. Reusing an identity with different content is rejected.
`queues.js` exports defaults of three attempts with exponential backoff starting
at 2,000 ms, `removeOnComplete: 100`, and `removeOnFail: false`. The application
queue factory applies these defaults. **Lambda must set the same producer
options**; worker options cannot impose retries on externally created jobs.
Completed-job retention is limited, so Mongo staging/domain idempotency remains
necessary after BullMQ forgets a job ID. Terminal failures remain in BullMQ.

## Staging and retry behavior

Raw batches live in the isolated `DealerVaultImportBatch` collection; there is
no new HTTP endpoint, and the existing CSV APIs cannot expose this collection.
The unique identity is `{ dealer_id, fileName, fileType, batchId }`.

- Same identity/digest with `completed` or `completed_with_errors`: return the
  stored counts without processing rows again.
- Same identity with a different digest: permanent `BATCH_CONTENT_CONFLICT`;
  preserve the original raw batch.
- Same identity/digest with `pending`, `processing`, or `failed`: process the
  existing raw batch again, replacing attempt counts rather than adding to them.

`raw_records_json` stores the full raw records as JSON text, preserving nulls,
empty objects, and arbitrary incoming keys. `JSON.parse()` reconstructs the batch.
The SHA-256 digest uses canonical object-key ordering while retaining array order.
Staging includes source identifiers, internal dealer ID, received/processed/failed
counts, timestamp-rejected (`unchanged`) count, row outcomes, sanitized error
codes, and start/completion timestamps. Customer names, contacts, financial values,
raw records, database error text, and stack traces are never emitted by these workers.

Raw staging must succeed before domain writes. Known validation failures are
saved before the bulk write. Valid rows then use one unordered bulk. A business
failure does not retry the whole batch: the worker finishes with
`completed_with_errors`. Missing/ambiguous dealers and malformed envelopes throw
BullMQ `UnrecoverableError`. Database, staging, and network failures throw sanitized
retryable errors. If an interrupted bulk has an unknown partial outcome, successful
row counts are not inferred; the next retry safely reconciles the staged batch.

No lease or heartbeat is implemented. Concurrent duplicate attempts may execute,
but unique indexes prevent duplicate documents, counts are absolute, and pending/
failed status updates cannot regress a terminal completed staging record.
The first successful terminal staging result is retained. Completed batches with
invalid rows are not automatically replayed; replay tooling remains a later task.

## Source timestamps and idempotency

`common/upserts.js` owns the shared timestamp guard and duplicate-key recovery.
PTINV always uses `{ dealer_id, part_number }`. Domain records store:

- `source_file_timestamp`: `YYYYMMDDHHMM` from the filename, compared as a string.
- `source_batch_id` and `source_row_index`: batch ID and zero-based row position.
- `source_import`: provider, filename, file type, and external dealer ID.

An ordinary conditional upsert accepts an absent/null timestamp or a timestamp
no newer than the incoming one. The unique natural-key index rejects an attempted
insert when a newer record already exists. The helper recognizes that specific
index, rereads within dealer scope, and counts newer stored records as unchanged.
Concurrent insert races get one additional guarded upsert; unresolved database
errors remain retryable. Other duplicate indexes are never silently ignored.

Equal timestamps may overwrite each other; batch and row positions are provenance,
not ordering tie-breakers. File timestamps are compared in the provider's existing
filename time convention; no timezone interpretation is introduced. Snapshots
never delete parts absent from a file. Existing `createdAt` values are preserved.

## Setup and verification

Use the existing application dependencies and `REDIS_HOST`, `REDIS_PORT`,
`REDIS_PASSWORD`, and Mongo environment configuration. Set
`DEALERVAULT_PTINV_CONCURRENCY` to a positive integer; default is `5` concurrent
batch jobs per worker process. There is no worker per record/job. Mongo is reused
once connected; domain operations are batched and race recovery is sequential
and bounded by the 100-record job limit.

Before starting producers, populate authoritative `dv_dealer_id` values on
`User` documents with `type: 'dealer'`. There is no guessed/default dealership.
All other operations use the resolved internal dealer ID. This milestone does
not populate mappings or add a dealer-management UI.

**Verify required indexes before running the worker.** The staging schema disables
automatic indexing. Source ordering depends on PartInventory's existing unique
index. The index utility checks the dealer mapping, staging identity,
PartInventory, Deal, RepairOrder and ServiceAppointment natural keys, and the approved Customer DMS mapping index.
It never drops indexes or changes data. It does not load application env files:

```bash
# From aidmvcs-be-dev; provide an authorized target URI through the environment.
node scripts/ensure-dealervault-indexes.js
# Only when intentionally creating the required missing indexes:
node scripts/ensure-dealervault-indexes.js --apply
```

Both commands require `DEALERVAULT_INDEX_MONGO_URI`. Check mode is read-only and
exits nonzero for missing/incompatible indexes. Apply mode stops on conflicting
indexes or data without attempting destructive repairs.

Start the existing worker entrypoint through the deployment's process manager.
The checked-in PM2 configuration points to its deployment-specific path; the
existing `npm run worker` script points to a missing `workers/startWorker.js`.
No deployment paths or process-manager configuration were changed here.

Run the focused tests and lint from `aidmvcs-be-dev`:

```bash
node test-dealervault-common.js
node test-dealervault-parts.js
node test-dealervault-sales.js
node test-dealervault-service.js
node test-dealervault-appointments.js
./node_modules/.bin/eslint app/worker/dealervault app/models/Customer.js app/models/DealerVaultImportBatch.js scripts/ensure-dealervault-indexes.js test-dealervault-common.js test-dealervault-parts.js test-dealervault-sales.js
```

These tests use Node's test API. They stub database operations by default and never
connect to application databases. For the opt-in integration test, set
`DEALERVAULT_TEST_MONGO_URI` to a disposable Mongo server on localhost and run the
parts test again. It creates a uniquely named `dealervault_test_ptinv_*` database,
tests real indexes/concurrent writes, and drops only that generated test database.

## Customer review

The existing Customer resolver requires a persisted Lead ID, normalizes contacts,
and searches by dealer-scoped email/phone. Conflicting email/phone matches leave
the Lead unlinked. Enrichment appends missing contacts but several updates filter
only by Customer `_id`. New Customers use recheck-then-`save()` with non-unique
contact indexes, so concurrent creation can duplicate Customers. The code already
documents this race. Merge metadata exists, but no implemented merge workflow or
merged-customer traversal was found in the application/scripts reviewed.

The existing Lead resolver remains unchanged. SL reuses its contact normalizers,
with separate dealer-scoped reconciliation that does not require or create Leads.
PTINV does not reconcile Customers or Vehicles.

## SL sales

Use queue `dealervault-sales`, `fileType: 'SL'`, an `_SL.txt` filename, and the same
envelope/limits as PTINV. Require nonblank string `Deal Number`; trim it while
preserving leading zeros. All 376 official SL columns are allowlisted and retain
their exact source names/string or null values. Unknown fields survive only in raw
staging. Core fields are `dealer_id`, `deal_number`, trimmed `customer_number`,
normalized `vin`, source timestamp/batch/row metadata, and trusted `customer_id`
and `vehicle_id` ObjectId links (null if unresolved). Deal's existing `strict:false`
schema accommodates these links; neither Deal nor Vehicle schema is changed.

SL uses the shared guarded unordered upserts with key `{ dealer_id, deal_number }`.
An older export cannot overwrite a newer Deal. Equal timestamps follow PTINV's
last-write behavior. An accepted newer row with an unresolved relationship sets
that link to null, avoiding a stale link from a different buyer or VIN. An older
row may still establish a Customer mapping before its Deal write is rejected;
existing contact values are never overwritten by SL.

Customer resolution:

- Dealer-scoped `extra.dealervault.customer_numbers` mapping wins over contacts.
- Otherwise normalize Email 1/2/3 and Home/Cell/Work Phone using existing rules;
  prefetch candidates within the dealer. Exactly one candidate receives the DMS
  mapping with `$addToSet`. Existing contacts, primary flags, consent and other
  Customer data are untouched.
- If none match and a Customer Number exists, create a Customer with that mapping,
  primary buyer name and normalized contacts. Initial primary flags follow the
  existing creation convention; no consent or Lead history is inferred.
- Without Customer Number, link only an unambiguous existing contact match.
- Multiple contact candidates, conflicting contacts, and merged Customers remain
  unresolved with warnings. SL does not traverse or alter merge history.
- Same-number rows in one batch share a resolution, using their combined primary
  contacts. Competing jobs recover a mapping-index duplicate by reading its winner.
  Different DMS numbers racing with the same contact may still create separate
  Customers: contact indexes remain nonunique, and no automatic merge is attempted.

The approved unique partial index is
`{ dealer_id: 1, 'extra.dealervault.customer_numbers': 1 }`, restricted to documents
with string mapping values. Mappings written here are arrays of trimmed strings.
It prevents different Customers claiming the same number within one dealer.
Customer remains strict; the existing `extra` field holds the mapping. Only this
new mapping index disables automatic creation, so importing Customer continues to
provision its existing contact lookup indexes normally. The explicit index utility
must run before SL to deploy the mapping index after checking data.
It stops on conflicting data/indexes without merging or removing records. SL also
checks the Customer mapping and Deal natural-key index before reconciliation;
missing or incompatible protection produces retryable `INDEX_REQUIRED`.
Successful runtime checks are cached for 60 seconds per model/index and then
revalidated. Concurrent checks share one request; failures are never cached.

Vehicle resolution prefetches only the sold VIN using `{ dealerId, vin }`.
VIN normalization trims and uppercases alphanumeric values, allows historical
lengths, and rejects common placeholders; no VIN checksum validation is imposed.
Missing, invalid, unmatched or ambiguous VINs leave the relationship null with
a warning. No Vehicle is created or updated. The entire co-buyer block remains
source data on Deal; no co-buyer Customer is created. `trade_ins[0]` and `[1]`
preserve Trade 1/2 VIN, year, make, model, odometer, actual_cash_value, gross and
payoff as source-faithful values. Empty trade blocks are empty objects.

Per-row warning codes live in staging `row_outcomes[].warnings` and sanitized
logs with zero-based row indexes. Warnings do not increment failed-row counts or
reject valid Deals. Bad business rows produce `completed_with_errors`; database
failures leave the staged batch retryable. Completed delivery reuse never repeats
Customer reconciliation or adds counts/raw data.

`DEALERVAULT_SL_CONCURRENCY` defaults to 5 batch jobs per process. Within a batch,
Customer reconciliation runs at most 5 tasks at once; contact/mapping/VIN lookups
are prefetched and Deal persistence uses one unordered bulk. In-flight tasks drain
before a failed attempt returns. There is no lease or heartbeat.

For real database tests, set `DEALERVAULT_TEST_MONGO_URI` to a disposable localhost
Mongo server and run `node test-dealervault-sales.js`. Only a newly generated
`dealervault_test_sales_*` database is used and dropped. Set
`DEALERVAULT_TEST_REDIS_PORT` for the separate localhost Redis delivery/retry test;
it uses a unique test queue and a memory database, and removes only that queue.

Production index deployment, scheduling, producer/Lambda processing,
and DLQ/replay tooling are outside this milestone.
