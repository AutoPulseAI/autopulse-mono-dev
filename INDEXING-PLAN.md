# AutoPulse – Indexing Plan (for review)

Final indexing changes for the DB-scaling work, derived from a **read-only** audit of the live DB (13 Nov 2026) + the code. **Nothing has been changed on production.** Build + prove on the `rs0` test cluster first; apply to production only after sign-off.

> **Guarantee:** every change here is **transparent to results** — an index only changes *speed*, never *what a query returns*. Removing a redundant index can't change results either (a longer index already covers it). The AI's decisions and the dashboard numbers stay identical.

**Method:** ranked all 788k slow-query log entries by **total time** (count × duration = real load), mapped each hot shape to the code (`aidmvcs-be-dev/`, `agentic-upsell/`). Non-indexing findings (query rewrites) are in `DB-UPSCALING-BACKLOG.md`.

---

## A. ADD

| # | Collection | Index | Why (evidence) | Where to add |
|---|---|---|---|---|
| A1 | `emails` | `{ message_id: 1 }` | `twilio/route.js:53` `findOne({message_id,…})` on every delivery callback + `processSms.js` threading + dashboard `$or`. No `message_id` index today → full/large scans of 768k docs. **Addresses >100M ms** across 5 query shapes (rows #4,#5,#7,#10,#15 of the time-ranked audit). | `Email.js` + `scripts/ensure-email-indexes.js` |
| A2 | `emails` | `{ dealer_id: 1, createdAt: -1 }` | Dashboard aggregation `{dealer_id, createdAt:{range}}`. All email indexes are on `date`, **not `createdAt`** → no index → scans 301k, 19.5k×, ~9.4M ms. | `Email.js` (confirm `createdAt` is the right field vs `date` — see Q1) |

### Candidate adds — propose, then prove on the cluster before committing
| # | Collection | Index | Why |
|---|---|---|---|
| ~~A3~~ | ~~`emails`~~ | ~~`{ dealer_id, lead_id, read }`~~ | **REJECTED on cluster (2026-11-13):** a direct `find({dealer_id,lead_id,read})` already uses `lead_id_1` (26 docs, 3 ms). No missing index — the production 295k scan is the *aggregation* picking `dealer_id_1` over `lead_id_1` → moved to backlog (needs a `$hint`/restructure, not a new index). |
| A4 | `ai_messages` | `{ dealer_id: 1, platform_message_id: 1 }` | AI lookup `{dealer_id, platform_message_id}`; no index on `platform_message_id` → scans 44k, 7.8k×, ~1.5M ms. (index managed on the AI side — confirm location) |

---

## B. HIGH-PRIORITY LIVE FIX — `emails.ai_idempotency_key` (needs cluster testing to pick the form)

**Problem (confirmed live — COLLSCANs logged `2026-11-13 12:35`, minutes before the audit):** the AI send-check does `findOne({ ai_idempotency_key: "<key>" })` before every send. The existing index is **partial + unique** with `partialFilterExpression:{ai_idempotency_key:{$type:'string'}}` (in `Email.js`, deployed by `scripts/ensure-email-indexes.js`). The bare equality lookup **does not match the partial filter, so it is not used** → full scan of 769k docs on every send-check. **#3 cost in the whole DB (~67M ms).**

**Why the partial filter exists:** to keep the `unique` constraint while letting the millions of non-AI emails (no key) through — a plain `unique` index would collide on nulls.

**Fix — test these on the cluster with `explain()`, keep whichever the lookup actually uses:**
1. Make the query match the existing index: `findOne({ ai_idempotency_key: key, ... })` with the predicate the partial filter needs (code) — cheapest if it works.
2. Replace with `unique: true, sparse: true` plain `{ai_idempotency_key:1}` (indexes only docs that have the field; lookups by value use it).
3. Or re-express the `partialFilterExpression` (e.g. `{$exists:true}`) so the bare lookup qualifies.

Decision rule: whichever makes `explain()` show **IXSCAN** for the real `findOne({ai_idempotency_key:X})` while preserving one-key-per-AI-send uniqueness.

---

## C. REMOVE — redundant indexes (safe by construction; each proven on the cluster first)

An index is listed here only if a **longer index already covers it** (prefix rule) or it's a **reverse-sort duplicate** or a **leading-`_id`** index — so dropping it cannot remove a query's plan.

| Collection | Drop | Covered by |
|---|---|---|
| `emails` | `dealer_id_1` | any `dealer_id_1_*` compound (prefix) |
| `emails` | `lead_id_1` | `lead_conversation_cursor {lead_id,timestamp,_id}` (prefix) |
| `emails` | `_id_1_parent_message_id_1` | `_id_` — leading `_id` is unique → useless |
| `emails` | one of `dealer_id_1_date_1` / `dealer_id_1_date_-1` | the other (reverse sort) |
| `leads` | `dealer_id_1` | any `dealer_id_1_*` compound (prefix) |
| `leads` | `fe_lead_status_1` | `idx_fe_status_dealer_created_desc` (prefix) |
| `leads` | one of `idx_dealer_fe_status_created_asc` / `_desc` | the other (reverse sort) |
| `csvimporteddatas` | `csv_import_id_1` | `csv_import_id_1_record_index_1` (prefix) — 1.5M docs, biggest write saving |
| `campaigntrackings` | `dealer_id_1` | `dealer_id_1_event_timestamp_-1` (prefix) |
| `campaigntrackings` | `campaign_id_1` | `campaign_id_1_phone_1` / `_email_1` / `_event_type_1` (prefix) |
| `campaigntrackings` | `campaign_lead_id_1` | `campaign_lead_id_1_event_type_1_event_timestamp_1` (prefix) |
| `campaigntrackings` | `campaign_lead_id_1_event_type_1` | same 3-field index (prefix) |
| `campaignleads` | `campaign_id_1` | `campaign_id_1_email_1` / `_phone_1` / `_createdAt_-1` (prefix) |
| `dealerwebsiteclicks` | `dealer_id_1` | `dealer_id_1_clickedAt_-1` etc. (prefix) |
| `dealerwebsiteclicks` | `shortCode_1` | `shortCode_1_clickedAt_-1` etc. (prefix) |

Removal is done in **both** places: `dropIndex` on the DB **and** remove any matching `schema.index(...)` / ensure-script line so a deploy doesn't recreate it. (Most of these aren't in the schemas — see the index↔code drift note in `DB-UPSCALING-BACKLOG.md`.)

---

## D. What we deliberately will NOT touch

**Indexes that might be unused but are NOT redundant.** Measuring real per-index usage needs `$indexStats`, and the app user `ravi` lacks that privilege on production (granting it = a prod change we won't make). So we only drop **provably-redundant** indexes; we do **not** guess at "unused." To catch dead-but-not-redundant indexes later, create a read-only `clusterMonitor` user and re-run `$indexStats` (tracked in `DB-UPSCALING-BACKLOG.md`).

---

## E. Not indexing (see `DB-UPSCALING-BACKLOG.md`)

- `followupjobs` aggregation (#1 cost, 180M ms) — `$lookup` before filtering → rewrite.
- `csvimporteddatas` phone match (#2 cost, 107M ms) — non-anchored `$regex` can't use an index → normalize phones + equality.
- `leads {$and, dealer_id}` (18M ms) — only 216 docs examined → contention, not an index gap.

---

## F. Validation plan (zero production risk)

1. On the **test cluster** (clone of prod): create each ADD → run the real query with `explain()` → confirm COLLSCAN/large-scan → IXSCAN, **same results**, measure before/after.
2. For each REMOVE: `explain()` the queries that used it → drop → re-`explain()` → confirm still IXSCAN via the covering index, no regression. Settles the two "keep which direction" choices.
3. Resolve B (`ai_idempotency_key`) on the cluster per the decision rule above.
4. Only then apply the same set to production, as a separate approved step.

---

## G. Open questions for the AI/UI owner

- **Q1:** Dashboard filters `emails.createdAt` — is that intended, or should it use `date` (already indexed)? If `date`, A2 isn't needed.
- **Q2:** `ai_messages` indexes — where are they managed (AI service / a script)? Needed for A4 and the fix in B.
- **Q3:** Any index in section C your AI/UI code relies on that we should keep despite the redundancy?
- **Q4:** Any slow query you know of that isn't captured here?

_As-of 2026-11-13. Evidence: live `database` box slow-query log (2 GB, 788k ops) + code. Read-only; nothing changed on production._
