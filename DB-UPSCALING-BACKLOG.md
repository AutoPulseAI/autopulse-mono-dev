# AutoPulse – DB Upscaling Backlog (NON-indexing)

Findings discovered during the 13 Nov 2026 production index audit that are **not** plain indexing work — query rewrites, governance, and the other `DB-SCALING.md` levers. Park here; pick up when the indexing pass is done.

> Source of evidence: read-only harvest of the live `database` box (172.31.16.69) mongod slow-query log (2 GB, 788k slow ops) + the code in `aidmvcs-be-dev/` and `agentic-upsell/`. Indexing items live in the indexing plan, not here.

---

## 1. `followupjobs` aggregation — #1 slow query, needs a REWRITE (not an index)

**The query (≈399k slow ops, each scans ~430k docs):**
```
aggregate(followupjobs) → $lookup leads (leadId→_id) → $unwind → 
  $match { "lead.email"/"lead.phone": X, "lead.dealer_id": Y, status:"completed", last_sent_at:{$gte: …} } → $limit 1
```
**Why it's slow:** it **joins every follow-up job to its lead first, then filters** on the joined `lead.email`/`lead.phone`. An index can't help a predicate that runs *after* the `$lookup`. ~430k docs examined **per call**, ~399k times.

**Fix (returns the identical result, just reordered — optimization, not a behavior change):**
- Resolve the lead first: `leads.findOne({ email|phone, dealer_id })` — `leads.email_1` / `leads.phone_1` already exist → get `_id`.
- Then query `followupjobs.findOne({ leadId: _id, status:"completed", last_sent_at:{$gte} })`.
- Or, if the shape must stay an aggregation, put a `$match` on the **followupjobs-local** fields (`status`, `last_sent_at`) *before* the `$lookup` so the join set shrinks first.

**Still TODO:** pinpoint the exact source file (it builds this pipeline dynamically; candidates around lead messaging/dedup). Confirm `last_sent_at` is a real `followupjobs` field (not in the `FollowUpJob` schema, which has `sentAt` + `strict:false`).

**Impact:** this single rewrite is the biggest latency win available — far bigger than any index.

---

## 2. Index ↔ code drift (governance)

Production carries **far more indexes than the Mongoose schemas declare**:
- `emails`: **18 live** indexes, but `Email.js` declares **3** (`lead_conversation_cursor`, `ai_idempotency_key_unique`, `dealer_sms_pair_latest`).
- `leads`: **20 live**, but `Lead.js` declares **1** (`{dealer_id, customer_id}`).

So most live indexes were created by ad-hoc scripts or by hand and are **not reproducible from code** — a fresh deploy/seed would not recreate them, and there's no single source of truth for what *should* exist.

**Future task:** once the indexing pass decides the keepers, codify them — declare in the schema or in an `ensure-*-indexes.js` script (the `emails` partial indexes already use `scripts/ensure-email-indexes.js` with `_autoIndex:false`; follow that pattern) — and document the rest. Goal: the index set is defined in one place and reproducible.

**Permission gap (blocks measuring index usage):** the app user `ravi` lacks the `indexStats` privilege, so `$indexStats` fails on production (`not authorized … $indexStats`). That means we **cannot measure which indexes are actually read** on the live DB. Consequence for the indexing pass: we only drop **provably-redundant** indexes (a longer index covers them); we do **not** drop "maybe unused" non-redundant ones, because we can't prove they're unused. To measure real usage later, create a **read-only monitoring user with `clusterMonitor`** (read-only, safe) and re-run `$indexStats` — then additional dead indexes can be found and removed.

---

## 3. `$or` query hygiene

Several hot queries are wrapped as single-branch `$or`, e.g. `emails` `{$or:[{message_id:X}]}`. Harmless once `message_id` is indexed, but the `$or` wrapper is unnecessary and, in multi-branch form, **every branch needs its own index or the whole query collection-scans**. Worth a sweep of `$or` usage in the CRM/AI query code when doing query optimization.

---

## 4. Other `DB-SCALING.md` levers not yet started

From the plan in `DB-SCALING.md`, still open after indexing:
- **Connection pooling** sized per service (CRM web 50 / worker 20, AI API 20 / worker 50).
- **Redis caching** for dashboards (short TTL) and dealer profiles (cleared on update); never compliance data.
- **Read/write split** — route dashboards/reports to a secondary (`maxStalenessSeconds: 90`); AI/compliance/bookings stay on primary. (The `rs0` cluster makes this possible now.)
- **Bulk writes** (`ordered:false`, 500–1000 batches) for campaigns / DealerVault.
- **Write concern** `majority`+`wtimeout` once 3 data nodes exist.
- **Server tuning / monitoring** — profiler, `$indexStats`, replication lag, CloudWatch CPU credits.

---

## 5. Collections worth a growth/TTL review (not indexing)

- `webhooklogs` — 127,758 docs, **only `_id`** index, append-heavy. Confirm nothing queries it by other fields; if it's write-only audit data, consider a **TTL index** / capped retention to bound growth.
- `csvimporteddatas` — 1,556,205 docs (largest). Mostly import staging; review retention.

---

## 6. `csvimporteddatas` phone-match query — #2 cost in the whole DB (≈107M ms), needs a REWRITE

The DealerVault enrichment lookup matches an incoming lead to imported rows by email or phone:
```
{ $or: [ {"source_data.Email": X},
         {"source_data.WorkPhone":  {$regex:/(1908…|908…|\+1908…|…)/i}},
         {"source_data.MobilePhone": {$regex:/…/i}},
         {"source_data.OtherPhone":  {$regex:/…/i}} ],
  "source_data.SiteId": S, "source_data.Franchise": F } sort {createdAt:-1}
```
**Why no index can fix it:** the phone branches use a **non-anchored `$regex`** (matches the number anywhere in the field), which **cannot use an index** — so MongoDB scans every row for that dealer (`SiteId`+`Franchise` ≈ 602k of 1.5M) on each call, 7–8 s each, ~22k times.

**Fix (code):** store a **normalized phone** field (digits-only, E.164) on `csvimporteddatas` at import time, and match by **equality** on it (plus a normalized email). Then a single index `{source_data.SiteId:1, source_data.Franchise:1, <normalized_phone>:1}` / email makes it a seek. Until then, indexing cannot help this query.

## 7. Not an index problem — `leads {$and, dealer_id}` (≈18M ms, 52k ops)

High total time but **only ~216 docs examined** per op — so it's slow from lock/CPU contention under load, not from scanning. No index will help; revisit under general load/contention tuning, not indexing.

## 9. Dashboard "unread" aggregation picks the wrong index (not a missing index)

Production shows `emails {dealer_id, lead_id, read}` **aggregations** scanning ~295k docs, 10k×, ~5M ms. But on the clone a direct `find({dealer_id, lead_id, read})` uses the selective **`lead_id_1`** index (26 docs, 3 ms) — so the lookup is **not** missing an index. The aggregation is choosing `dealer_id_1` (all the dealer's emails) over `lead_id_1`. Fix = investigate that aggregation (add `.hint('lead_id_1')` or restructure the `$match`/stage order so the planner picks the selective index), **not** a new index. (This is why candidate A3 in `INDEXING-PLAN.md` was rejected.)

## 8. Stray collection `emailai.ravi`

The time-ranked audit showed a few slow ops against a collection literally named `ravi` (3 `$or` COLLSCANs). Looks like a leftover manual/test collection. Verify it's junk and drop it (housekeeping, not indexing).

---

_Created 2026-11-13 during the indexing audit. Companion to `DB-SCALING.md` (the main plan) and `INDEXING-PLAN.md`._
