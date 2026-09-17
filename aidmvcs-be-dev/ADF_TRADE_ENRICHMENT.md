# Optional ADF trade enrichment

## Flow and isolation

Raw ADF capture in `app/worker/emailWorker.js` offers source references to the
`adf-trade-enrichment` BullMQ queue. Existing Lead creation, Customer resolution,
first-prospect/first-vehicle selection, acknowledgement and n8n calls are unchanged.
Trade detection parses the XML independently using the same syntax parser. The
producer waits at most one second for queue submission, catches enrichment errors,
and never waits for OpenAI or TradeIn persistence. No trade means no job/API call.

The worker reloads RawAdfPayload, locates the candidate, sanitizes it, calls OpenAI,
then reloads the dealer-scoped Lead and verifies its persisted `customer_id` against
a non-merged Customer. It rechecks Lead ownership immediately before an atomic
`$setOnInsert` upsert. An absent/ambiguous Lead or unresolved Customer cannot create
a trade. No customer ID from job creation is trusted.

Each job has six total attempts with exponential backoff starting at two seconds
(2, 4, 8, 16, 32 seconds). OpenAI has a 15-second request/body timeout. Validated,
sanitized extraction is cached in job data so linkage/DB retries do not repeat the
API call. Invalid or unsupported model facts are terminal; transient extraction,
index and customer-link failures retry. Failed jobs remain for operator review.
After resolving a late customer link or deployment issue, retry that failed job
through existing BullMQ tooling; re-adding a retained job ID does not retry it.
If queue submission itself fails, replay raw capture after Redis recovery. There
is no new transactional outbox or automatic backfill in this change.

## Privacy boundary and supported input

Only the following nullable facts reach OpenAI: VIN, year, make, model, trim,
mileage in miles, exterior/interior color, condition, and conservative vehicle notes.
No raw XML, customer identifier, message identifier, source key, dealer identifier,
or entire comments field is included. The strict output schema disallows additional
properties. Application validation also rejects invented facts, including VIN and
condition, even if the response satisfies the schema. Missing facts stay null.

Detection recognizes trade/current-vehicle containers, vehicle interest/type/role
attributes, flat trade-prefixed fields, nested/provider namespaces and trade-related
comments. Multiple structured vehicles have separate candidates. XML is limited
to 2 MB, traversal depth 40, 10,000 visited nodes and 20 candidates. DTD/entity
declarations are excluded from enrichment without changing the Lead parser.

Sanitization reconstructs typed vehicle fields instead of forwarding redacted
prose. Makes/colors/conditions use allowlists, model/trim use bounded vehicle-label
syntax and sensitive-token rejection, and VIN must have 17 valid VIN characters.
Free-text processing retains recognized year/make/model, labelled VIN, mileage,
explicit condition and safe phrases such as `minor scratches` or `new tires`.
Clauses containing sensitive/monetary markers are dropped whole. Unrecognized
prose, unknown makes, non-mile odometers and ambiguous multi-vehicle descriptions
are intentionally omitted, not guessed. This favors privacy over extracting every
provider-specific detail; expand these rules only with privacy regression fixtures.
A candidate needs a supplied valid VIN or year + make + model before OpenAI and
again before persistence. Essentially empty records are not created.

Queue payloads initially contain only source IDs and an application-generated
candidate key; retries may additionally contain the sanitized facts. New structured
logs contain event names, internal ObjectIds and fixed failure codes, never raw
ADF, customer prose, provider errors or OpenAI request/response bodies.

### Separate existing privacy remediation (not changed)

`emailWorker.js` passes `currentEmail` and conversation data to `callOllama`/n8n,
including during the existing ADF acknowledgement path. That payload can contain
the raw email/ADF body and restricted fields. The new trade sanitizer does **not**
sanitize that existing transfer. Audit and minimize the n8n payload separately;
preserving its current behavior was an explicit requirement of this implementation.

## Ownership, provenance and VIN compatibility

TradeIn retains customer-level ownership (`customer_id`) and the producing
opportunity (`lead_id`), plus `raw_adf_payload_id`, `source_message_id` and
`source_candidate_key`. The key is SHA-256 of the candidate's path/array position
in the independently parsed, immutable RawAdfPayload. It is never model-generated.
The partial unique index covers `(dealer_id, raw_adf_payload_id, source_candidate_key)`.
Thus concurrent replay of a source candidate creates at most one record; multiple
vehicles in one payload and the same VIN in future payloads/appraisals are allowed.
This is source-level idempotency, not global VIN or semantic deduplication.

RawAdfPayload distinguishes body and attachments under the same inbound message.
Separate captured payloads have separate provenance and may represent separate
trade records even if they contain the same vehicle. Enrichment operates on the
payloads the existing pipeline captures: body first, then attachments only when
body Lead parsing fails, stopping at the first usable attachment. It does not
introduce additional attachment fetching or change that selection behavior.

VIN assumptions were found in TradeIn's required field, the trade API validation,
and the trade form. VIN remains required for manual creation. Existing ADF-derived
trades can be edited without adding a VIN as long as year/make/model remain present;
missing VIN displays as `VIN not provided`. Null year/mileage values are accepted
by the numeric validators. Condition and notes are displayed in the trade panel.
SalesTab's separate embedded deal trades already tolerate missing VIN and were
not modified. No unrelated trade UI or customer logic was refactored.

## Rollout

1. Deploy with `ADF_TRADE_ENRICHMENT_ENABLED` unset or `false` (default off).
2. Explicitly set `TRADE_INDEX_MONGO_URI` to the intended staging/production
   database using your secret manager. Run `npm run indexes:trade:check`, then
   `npm run indexes:trade:apply`, then check again. Check exits 1 when the index
   is missing/incompatible and 0 when verified. Apply is idempotent, creates only
   the source unique index, and never drops indexes or repairs conflicting data.
   Automatic creation of this unique index by Mongoose is disabled. The worker
   also verifies it exists before extraction/persistence (60-second check cache).
3. Configure `OPENAI_API_KEY` (existing `OPENAPI_KEY` alias also supported, with
   precedence) and optionally `OPENAI_TRADE_MODEL` (default `gpt-4o-mini`, must
   support strict JSON-schema Chat Completions). This path uses `store: false`;
   that is not a claim of zero retention under your provider account settings.
4. Set `ADF_TRADE_ENRICHMENT_ENABLED=true` on the email/enrichment worker runtime
   and restart it. Both run from the existing `app/worker/worker.js` entry point.
   Use the same existing Redis connection settings; no n8n deployment is needed.
5. Verify staging trades, source uniqueness and failed-job logs before production.
   To stop enrichment, disable the flag and restart; existing jobs/data remain.

The index script does not load `.env` or connect until given an explicit URI.
No production database/index operations or live OpenAI requests are part of the
local automated test suite.

## Tests

Run `npm run test:adf-trade`. Tests cover existing parser selection, no-trade input,
provider structures/free text, strict request payload sanitation, missing fields,
timeout/invalid output, normal ingestion despite queue failure, persisted customer
resolution, retry reuse, concurrent/replayed candidates, future appraisals,
schema minimum identity, index deployment checks and safe logs. DB/Redis/OpenAI
are mocked; verify the actual unique index and worker retries in staging as well.
