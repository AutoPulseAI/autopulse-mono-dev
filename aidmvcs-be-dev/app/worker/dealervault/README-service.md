# SV milestone implementation report

SV is handled by `dealervault-service` in [serviceWorker.js](serviceWorker.js).
The existing worker entrypoint registers it through `setupDealerVaultWorkers()`.
`DEALERVAULT_SV_CONCURRENCY` defaults to 5 batch jobs per process. Customer
reconciliation reuses SL's bounded 5-task helper; Vehicle lookups are prefetched,
and RepairOrder writes use the shared unordered timestamp-guarded bulk helper.

## Files changed for this milestone

Added:
- `app/worker/dealervault/serviceWorker.js`
- `app/worker/dealervault/common/repeatingGroups.js`
- `app/worker/dealervault/common/serviceFields.js`
- `test-dealervault-service.js`
- `test-support/dealervault-memory.js` (shared fixtures extracted from SL tests)
- this report

Updated:
- `app/worker/dealervault/queues.js`, `index.js`, and `app/lib/queue.js`: service queue registration and shared producer retry defaults.
- `app/worker/dealervault/common/logger.js`: safe missing-RO/repeating-parse codes.
- `app/worker/dealervault/common/staging.js` and `app/models/DealerVaultImportBatch.js`: explicit source timestamp on newly staged batches.
- `scripts/ensure-dealervault-indexes.js`: check/apply RepairOrder's already-declared unique natural-key index.
- `test-dealervault-sales.js`: reuse extracted fixtures without changing SL assertions.
- `app/worker/dealervault/README.md`: supported worker/setup documentation.

RepairOrder, Customer and Vehicle schemas and their domain indexes were not changed
in this milestone. No production indexes were applied. Existing SL work in the
workspace was preserved. SV_APPT is not implemented.

## Source and RepairOrder fields

The whitelist contains all 200 official SV fields, verified against
`scripts/dealervault/dealertrack_file_types.txt`. Source header names and original
string/null values are retained only when present. Unknown fields are raw-only;
untrusted internal identifiers, relationship IDs, timestamps and parsed operation
objects cannot override worker-owned fields.

RepairOrder uses `{ dealer_id, ro_number }`. RO Number is required and trimmed
without dropping leading zeros. Customer Number is trimmed if supplied; usable
VINs use the shared trim/uppercase rules. Missing optional source columns and their
normalized identifiers are omitted, so a partial update does not replace existing
values with null. Explicit null/empty source values remain explicit.

Worker fields are `dealer_id`, `ro_number`, optional `customer_number`/`vin`,
`source_file_timestamp`, `source_batch_id`, `source_row_index`, `source_import`,
resolved `customer_id`/`vehicle_id`, and optional `service_operations`.
Relationship IDs are ObjectIds when resolved. Explicit but unresolved identity
inputs set the relevant relationship to null; entirely absent customer/contact
or VIN inputs omit that relationship update, preserving a previous link.

The existing `strict:false` RepairOrder design accommodates these additions.
There is no schema redesign, numeric/date casting, inventory mutation, or new
source-ordering policy. Older exports cannot overwrite newer records; equal
timestamps retain the shared PTINV/SL behavior.

Raw staging occurs before normalization/reconciliation. Original repeating strings,
unknown fields and row order remain in `raw_records_json`. Filename, file type,
dealer, batch, digest and source timestamp are stored as metadata. Raw row position
is the zero-based JSON-array position and is retained in row outcomes/domain
provenance. Existing staging documents are not rewritten to backfill timestamps.
Completed batches reuse counts; failed/incomplete batches retry their original raw
data; changed digests permanently fail without replacing raw data.

## Repeating fields and representation

The reference identifies pipe/caret encoding globally and groups operation/labor/
parts detail in columns 85–122. It does not separately annotate every column as
repeating. Treating this entire block as potentially repeating is an explicit
mapping assumption. Original strings are always retained, so the derived mapping
can be revised without losing source information.

The exact mapped block is:

| Column | Source header | Key in each service operation |
| --- | --- | --- |
| 85 | Operation Codes | `operation_codes` |
| 86 | Operation Code Descriptions | `operation_code_descriptions` |
| 87 | Tech Labor Line | `tech_labor_line` |
| 88 | Tech Number | `tech_number` |
| 89 | Tech Name | `tech_name` |
| 90 | Upsell | `upsell` |
| 91 | Labor Cause | `labor_cause` |
| 92 | Labor Complaint | `labor_complaint` |
| 93 | Labor Correction | `labor_correction` |
| 94 | Labor Comments | `labor_comments` |
| 95 | Recommended Operation Codes | `recommended_operation_codes` |
| 96 | Recommendations | `recommendations` |
| 97 | Operation Line Number | `operation_line_number` |
| 98 | Operation Sale Types | `operation_sale_types` |
| 99 | Operation Line Cost | `operation_line_cost` |
| 100 | Operation Line Sale | `operation_line_sale` |
| 101 | Labor Cost | `labor_cost` |
| 102 | Labor Sale | `labor_sale` |
| 103 | Parts Cost | `parts_cost` |
| 104 | Parts Sale | `parts_sale` |
| 105 | Misc Cost | `misc_cost` |
| 106 | Misc Sale | `misc_sale` |
| 107 | Gas/Oil/Grease Cost | `gas/oil/grease_cost` |
| 108 | Gas/Oil/Grease Sale | `gas/oil/grease_sale` |
| 109 | Sublet Cost | `sublet_cost` |
| 110 | Sublet Sale | `sublet_sale` |
| 111 | Labor Tech Hours | `labor_tech_hours` |
| 112 | Labor Bill Hours | `labor_bill_hours` |
| 113 | Labor Tech Rate | `labor_tech_rate` |
| 114 | Labor Bill Rate | `labor_bill_rate` |
| 115 | Parts Labor Line Number | `parts_labor_line_number` |
| 116 | Parts Line Number | `parts_line_number` |
| 117 | Parts Sale Type | `parts_sale_type` |
| 118 | Part Number | `part_number` |
| 119 | Part Description | `part_description` |
| 120 | Part Quantity | `part_quantity` |
| 121 | Parts Unit Cost | `parts_unit_cost` |
| 122 | Parts Unit Sale | `parts_unit_sale` |

`common/repeatingGroups.js` only splits `|` and then `^`. It preserves all
empty positions, whitespace and unequal inner lengths, with no service-specific
alignment logic. A non-string argument raises a generic TypeError; the worker
turns invalid supplied repeating cells into the safe `SV_REPEAT_PARSE_ERROR`
row failure.

`service_operations` is an array aligned by outer group index. Each object has
`group_index` and one array of strings for each provided repeating column:

```js
// Operation Codes: "A^^C||D^"
// Labor Tech Hours: "1.0|0.5"
[
  { group_index: 0, operation_codes: ["A", "", "C"], labor_tech_hours: ["1.0"] },
  { group_index: 1, operation_codes: [""], labor_tech_hours: ["0.5"] },
  { group_index: 2, operation_codes: ["D", ""], labor_tech_hours: [""] }
]
```

Shorter provided columns get `[""]` for missing outer groups. Inner arrays remain
unequal; values are not zipped, flattened, filtered, trimmed or shifted. Absent
columns are omitted from every operation. An empty string parses as `[[""]]`.
Explicit null repeating columns retain null in source storage but do not generate
parsed values. If only null repeating fields are supplied, the derived array is
empty; if no repeating fields are supplied, the derived update is omitted.

The derived array reflects the repeating columns supplied by the current row;
it does not infer associations to absent columns retained from an older partial
update. It also does not infer that inner technician, labor and part indexes
share a business identity beyond their outer-group alignment.

The worker limits derived values, including padding, to 100,000 per row before
materializing operation objects. This bounds delimiter-expansion memory costs.
Exceeding it produces a row-level `SV_REPEAT_PARSE_ERROR`; the original row remains
staged and other valid rows continue.

## Customer and Vehicle behavior

SV calls the existing shared SL resolvers. Dealer resolution happens once per
batch; all relationship lookups and Customer mutations use that dealer.

An existing DMS mapping wins. Otherwise unambiguous normalized contacts can attach
the mapping; no candidate plus a stable Customer Number permits approved Customer
creation. Missing identity, conflicts, ambiguous contacts and merged Customers
produce warnings without rejecting an otherwise valid RO. No Leads, inferred
consent, contact replacement, or independent deduplication strategy is introduced.
Existing SL limitations remain: different DMS numbers racing with the same contact
can create separate Customers because contact indexes remain nonunique.

Vehicle resolution uses `{ dealerId, vin }` and only reads inventory. Unmatched,
missing, invalid or ambiguous VINs leave a relationship warning and preserve
the source VIN if supplied. Vehicle documents are never created or updated.

Business relationship failures do not reject valid RepairOrders. Infrastructure
errors in Customer/Vehicle queries or RepairOrder persistence remain sanitized,
job-level retryable failures; they are not silently converted to completed imports.

## Validation results and reproduction

- SV: 30 unit tests passed.
- Shared/PTINV/SL regression suites: 47 unit tests passed.
- Disposable Redis/BullMQ SV retry integration: passed, using memory database
  fixtures. A simulated acknowledgement failure caused redelivery, which reused
  completed staging without duplicate RepairOrders, Customers or counts.
- Real Mongo integration test added but skipped: the available Mongo 8.0 image
  refuses to start on this host's kernel (SERVER-121912, confirmed during SL).
  This test covers real BSON preservation, indexes, concurrent upserts,
  source ordering and inventory immutability on a compatible localhost server.
- Targeted ESLint passes except for the pre-existing unused
  `getRedisConnection` in `app/lib/queue.js`.
- `git diff --check` passes.

From `aidmvcs-be-dev`:

```bash
node test-dealervault-common.js
node test-dealervault-parts.js
node test-dealervault-sales.js
node test-dealervault-service.js
./node_modules/.bin/eslint app/worker/dealervault app/models/DealerVaultImportBatch.js scripts/ensure-dealervault-indexes.js test-dealervault-service.js test-dealervault-sales.js test-support/dealervault-memory.js
```

Set `DEALERVAULT_TEST_MONGO_URI` to a disposable localhost Mongo server for the
opt-in Mongo test. Only a newly generated `dealervault_test_service_*` database
is used and dropped. Set `DEALERVAULT_TEST_REDIS_PORT` to a disposable localhost
Redis port for the separate broker integration. It creates and removes only its
unique test queue.

Before rollout, verify indexes with `scripts/ensure-dealervault-indexes.js`
using the explicitly authorized `DEALERVAULT_INDEX_MONGO_URI`, and run the Mongo
integration test on a compatible server. Confirm the 85–122 outer-group mapping
against a representative provider export before relying on cross-column business
associations. No additional Customer/index approval is needed for the implemented
SV scope.
