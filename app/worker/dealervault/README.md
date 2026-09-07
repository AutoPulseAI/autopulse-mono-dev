# DealerVault ingestion: shared infrastructure and PTINV

This milestone implements only `dealervault-parts-inventory`. The existing
`app/worker/worker.js` entrypoint starts one PTINV BullMQ Worker using its Redis
connection. `app/lib/queue.js` exposes the queue through `getQueue()`. Existing
generic queue administration functions keep their previous queue list.

## Producer contract

Lambda parses TSV and sends a job such as:

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
index. The index utility explicitly checks only the dealer mapping index, staging
identity index, and PartInventory natural-key index; it never drops indexes,
changes data, or accesses Customer. It does not load application env files:

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
./node_modules/.bin/eslint app/worker/dealervault app/models/DealerVaultImportBatch.js scripts/ensure-dealervault-indexes.js test-dealervault-common.js test-dealervault-parts.js
```

These tests use Node's test API. They stub database operations by default and never
connect to application databases. For the opt-in integration test, set
`DEALERVAULT_TEST_MONGO_URI` to a disposable Mongo server on localhost and run the
parts test again. It creates a uniquely named `dealervault_test_ptinv_*` database,
tests real indexes/concurrent writes, and drops only that generated test database.

## Customer review and milestone boundary

The existing Customer resolver requires a persisted Lead ID, normalizes contacts,
and searches by dealer-scoped email/phone. Conflicting email/phone matches leave
the Lead unlinked. Enrichment appends missing contacts but several updates filter
only by Customer `_id`. New Customers use recheck-then-`save()` with non-unique
contact indexes, so concurrent creation can duplicate Customers. The code already
documents this race. Merge metadata exists, but no implemented merge workflow or
merged-customer traversal was found in the application/scripts reviewed.

Customer fields, indexes and reconciliation remain unchanged pending separate
approval. PTINV does not import Customer or Vehicle. SL/SV/SV_APPT, Customer/DMS
mapping, Vehicle reconciliation, Lambda implementation, scheduling and DLQ/replay
tooling are not part of this milestone.
