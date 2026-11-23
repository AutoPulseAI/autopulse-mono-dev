# AutoPulse – Query Optimization Plan (phase 2)

Full scan of both callers of the live DB, done 13 Nov 2026 by reading the actual hot code in `agentic-upsell/` (the AI) and `aidmvcs-be-dev/` (the dashboard/CRM). Built + proven on the `rs0` cluster first; production is a separate approved step.

> **The one rule for everything below:** it returns the **same rows / same numbers / same AI decision** as today. An optimization changes how many times we hit the DB, how much we transfer, which index we ride, or whether independent reads run at the same time — **never the answer**. Anything that would change the answer, the order of a compliance decision, or data freshness is called out and kept OUT (see "Off-limits" and "Load reducers").

This plan is split the way you asked — **AI side** and **dashboard side** — because they're in very different shape:
- **AI side (`agentic-upsell`) is already fairly well-optimized.** It caches the dealer profile (60 s) and AI Studio (60 s), projects on its hot reads, scopes every call to one dealer, and indexes all its own collections. So the AI wins are **real but narrow** — a few per-turn/per-send reads that can be merged or parallelized. I'm not going to pretend there's a mountain of AI query waste; there isn't.
- **Dashboard side (`aidmvcs-be-dev`) is where the big query waste is** — the same dealer's data scanned many times per request by separate count/group queries.

---

# PART A — AI side (`agentic-upsell`)

This is the path a customer message takes: inbound → a turn (`load_context` → extract → decide → compose → the send check `can_contact` → send). `load_context` runs on **every** turn; `can_contact` runs before **every** outbound message. Those two are the hot paths.

### A1. Merge the two facts queries into one — `slots/store.py`, every turn
`load_profile()` (run every turn) calls **two** separate queries on the **same** `qualification_facts` collection for the same customer:
- `current_facts` → `find({customer_id, valid_to: None, lead_id:{$in:[None,lead_id]}})`
- `fact_history` → `find({customer_id, valid_to:{$ne:None}, lead_id:{$in:[None,lead_id]}})`

They're complementary halves of the same customer's facts. **Replace with one `find({customer_id, lead_id:{$in:[None,lead_id]}})`** and split in Python: `valid_to is None` → current, else → history. **One round-trip instead of two, identical two lists.** (The `{dealer_id,customer_id,path,valid_to}` index already serves it.)
- Why transparent: same filter union, same documents, just partitioned client-side.

### A2. Parallelize the independent per-turn reads — `agent/nodes/load_context.py`, every turn
`load_context` awaits its reads **strictly one after another**, and `asyncio.gather` is used in only 2 files in the whole service — so this is the main AI latency lever. Several of these reads are **independent** and can run concurrently (same data, lower wall-clock):
- `find_campaign_context(...)` and `dealer_profile(...)` (lines 169-170) — different collections, no shared input → `gather` them.
- `current_facts` / `fact_history` (if A1 isn't taken) → `gather` or merge.

**Respect the real data dependencies — do NOT parallelize across them:**
- `sync_lead_history` (imports CRM messages into `ai_messages`) **must** finish before the history `find` (line 156) that reads those rows.
- prefill/`get_customer_360` must finish before `load_profile` reads the facts it wrote.

So this is "gather the genuinely independent reads," not "gather everything." Same context pack, fewer serial round-trips.

### A3. De-duplicate the repeated opt-out read inside one send check — `compliance/engine.py`
`can_contact` reads the customer's latest opt-out **several times in one call**: rule 2 `latest_opt_out(db, customer_id, channel, address)`, then inside `marketing_sms_consent` → `ever_opted_out(...)` **and** `latest_opt_out(...)` again on the same `(customer_id, "sms", to)`. For an SMS send these are the same lookup run 2-3×. **Fetch once, thread the result through** (pass the already-loaded entry into `marketing_sms_consent`). Same decision, fewer reads on the hottest send-path check.
- Why transparent: identical value, identical branch outcomes; only the redundant round-trips go. **Needs care** — confirm `address == to` in the SMS path before collapsing, so a different-address lookup isn't silently reused. That check is the whole safety condition; it's an explicit review step.

### A4. Projection on the history-sync read — `agent/history_sync.py:94`, every lead's first turn
`emails.find(flt).sort("timestamp",-1)` pulls **whole** email docs (big `mail_content`, SES/Twilio headers). It consumes only: `_id`, `timestamp`, `mail_content`/`body`, and whatever `author_of`/`_channel`/`_at` read (`communication_type`, `internal_use`, `ai_generated`, direction/sender, `date`). Add a projection to exactly that set.
- Why transparent: the omitted fields never reach `ai_messages` or a decision — **verify against those three helpers** before committing (the safety condition).

### Already optimized on the AI side (so we don't "fix" what's fine)
`dealer_profile` — cached 60 s + projected (`dealer_profile.py:299`). AI Studio — read ≤ once/minute. `can_contact`'s lead-state/opt-out reads — already projected. All AI-owned collections indexed (`integrations/mongodb.py INDEX_SPECS`). Writes idempotent. The follow-up cron claim is indexed. Nothing to do here.

### OFF-LIMITS on the AI side (would change the answer — do NOT touch)
- **The `can_contact` decision waterfall order** (`compliance/engine.py _decide`). It is an intentional short-circuit: the first blocking rule returns immediately, and some rules **write** (`record_consent`, the `ai_compliance_log` row). Reordering or parallelizing it would do extra work, change which side-effects fire, and risk a wrong compliance outcome. Only A3 (read de-dup) and projections are safe here; the sequence stays exactly as written.
- **Anything that drops a read the AI's decision depends on.** We make reads cheaper/fewer-round-trips, never remove a signal.

---

# PART B — Dashboard / CRM side (`aidmvcs-be-dev`)

This is where the real query waste is: stats/report endpoints that scan the same dealer's data many times per request.

### B1. `leads/stats` — ~9 Mongo passes → 2 (the single biggest win)
`app/api/leads/stats/route.js:248-274`, all over the same `baseQuery = {dealer_id, createdAt:{range}}`:
- 6 × `countDocuments` + 3 × `aggregate $group` (`sources`, `lead_sources`, `statuses`=group by `fe_lead_status`).
- **5 of the 6 counts are already in `statuses`:** `visit_requested`(=`Contacted`), `converted`(=`visited`), `managerial_review`, `appointment_booked` are buckets of it, and `total_leads` is the sum of all buckets. **Derive them in JS from `statuses` → delete 5 queries.** Fold `sources`+`lead_sources`+`statuses` into **one `$facet`**. Keep `new_this_week` (different date window) + the `emails` `communication_types` group. Net **9 Lead ops → 2**, byte-identical response.

### B2. The other stat/count endpoints — same `$facet` collapse
Same pattern, same transparency: `conversations/message-stats/route.js:55,62` (2 counts→1), `admin/stats/route.js` (**16** counts), `dealers/report-analytics/route.js` (6), `leads/vendor-stats/route.js` (4), `leads/admin-stats/route.js`, `conversations/vendor-stats/route.js`. Each collapses to one `$facet`/`$group` with identical outputs.

### B3. Unread aggregation rides the wrong index → `$hint` (backlog #9)
The dashboard "unread" **aggregation** scans ~295k docs (~5M ms) choosing `dealer_id_1` over the selective `lead_id_1` (a plain `find` already picks `lead_id_1`: 26 docs, 3 ms). Add `.hint('lead_id_1')` or reorder `$match`. **Locate first** — the committed count endpoints are dealer-wide, not this per-`lead_id` thread aggregation. No new index, same counts.

### B4. Projections on wide reads
`app/api/customers/[id]/360/route.js` — Deals/RepairOrders/ServiceAppointments are `strict:false` mirrors of DealerTrack TSVs (dozens of wide columns); `assemble.js` reads only a named handful (`Contract Date`, `Sales Price`, `Salesman N Name`, `Close/Open Date`, `Total Sale`, `Customer Total Sale`, `Appointment Date/Time`, `vin`, `customer_id`, `ro_number`). Project that set. Same page, far less transfer. (Apply the same to list endpoints that render a subset of columns.)

### B5. Keyset pagination instead of deep `skip()`
`skip((page-1)*limit)` scans and discards every skipped row. Replace with a range on the sort key (`createdAt`/`_id`): same rows, same order, same page size — only arbitrary "jump to page N" changes (UIs page forward/back, which keyset serves directly). Targets: `leads/route.js:626`, `conversations/route.js`, `conversations/lead/route.js`, `customers/route.js`, and the other `.skip()` endpoints **where pages go deep**; leave shallow ones.

### B6. Unwrap single-branch `$or` (backlog #3)
`{$or:[{message_id:X}]}` → `{message_id:X}`. Removes a planner footgun; sweep while touching the queries above.

### Already optimized on the dashboard side
`.lean()` is in **292 places / 120 files** — the lean sweep is done. The `contactedLeads.js` / `repliedLeadIds` helpers already use batched `$in` aggregations (no N+1). The leads list already batches its enrichments (`attachAiStages`, `bookingDetailsForLeads` take id arrays). Don't re-touch these.

---

# PART C — The two slow-log monsters (cross both sides, highest cost)

These two are the #1 and #2 costs in the whole DB (≈287M ms combined — far more than any dashboard endpoint). Both are **rewrites**, both need their runtime source located first.

### C1. `csvimporteddatas` phone match — normalized-equality (≈107M ms, backlog #6)
`app/lib/dealersocket-worknote.js:312 checkLeadByIdentifiers` → `$or` of **non-anchored `/…/i` regex** on `source_data.WorkPhone/MobilePhone/OtherPhone` → can't use an index → scans ~602k rows/dealer, 7-8 s, ~22k×. The regex only tests format-insensitive **equality** (its branches are the known formats). Store a **digits-only/E.164 phone** at import time, match by equality, index `{SiteId, Franchise, norm_phone}`. Same match set. Needs a backfill; keep regex as fallback until the field exists.

### C2. `followupjobs` dedup aggregation — filter-before-`$lookup` (≈180M ms, backlog #1)
`$lookup leads → $unwind → $match lead.email/phone → $limit 1` joins every job to its lead, then filters — an index can't help a post-join predicate. Resolve the lead first (`leads.findOne({email|phone,dealer_id})`, those indexes exist) → `followupjobs.findOne({leadId, status, last_sent_at})`. Same single result. **Step 0: find the runtime builder** — it's NOT in committed CRM code (`last_sent_at` isn't a `FollowUpJob` field; committed reads are plain `findOne({leadId})`). Don't guess-edit.

---

## Execution order (start here)

| # | Side | Item | Effort | Win | Risk |
|---|---|---|---|---|---|
| 1 | Dash | B1 `leads/stats` facet + derive 5 counts | S | 9→2 passes, hottest dashboard call | none |
| 2 | Dash | B2 message-stats + admin/stats facet | S | many→few passes | none |
| 3 | Both | B6/A-sweep `$or` unwrap | XS | planner safety | none |
| 4 | AI | A1 merge facts queries | XS | 2→1 read every turn | none |
| 5 | AI | A2 gather independent per-turn reads | S | per-turn latency | low (respect deps) |
| 6 | AI | A4 history_sync projection | S | first-turn transfer | none (verify fields) |
| 7 | AI | A3 opt-out read de-dup in can_contact | S | fewer reads per send | low (verify address==to) |
| 8 | Dash | B4 360 projection | S | heaviest page transfer | none (verify fields) |
| 9 | Dash | B3 unread `$hint` | S | 295k-scan→seek | none (explain-proven) |
| 10 | Dash | B5 keyset pagination | M | deep pages stop scanning | low (page math) |
| 11 | Both | C2 followupjobs rewrite | M | #1 cost ≈180M ms | none once located |
| 12 | Both | C1 csv normalized phone | L (backfill) | #2 cost ≈107M ms | low (backfill+fallback) |

Discipline (same as indexing): **one item at a time on `rs0` → `explain()` + assert identical output on a real sample → measure before/after → keep what the numbers prove.** 1-9 are in-place; 10-12 are the larger pieces.

## Validation protocol (zero production risk)
Per item on the `rs0` clone: capture current `explain()` + timing + exact result → apply → `explain()` again and **assert the result is identical** on a real sample → AI items run `make upsell-test` (2,766 offline tests), CRM items `npx next build` + the endpoint's tests. Only then schedule production separately. Live DB untouched until cutover.

## Load reducers — NOT result-identical, decide separately
Kept apart on purpose (they trade freshness for load): short-TTL Redis cache on expensive read-only dashboard aggregates (never compliance/consent/send reads); read dashboards/reports off the `rs0` **secondary** (`readPreference=secondaryPreferred, maxStalenessSeconds:90`). Both eventually-consistent — product decision, not a transparent rewrite.

## Pinpoint before coding
- C2 source (followupjobs `$lookup` builder — not in committed code).
- B3 source (per-`lead_id` unread thread aggregation).
- A4 / B4 field sets (confirm via the helpers / `assemble.js`).

## Side-observation (not query opt)
`app/lib/dealersocket-worknote.js:11,520,529` — hard-coded DealerSocket `privateKey` GUID in the **public** monorepo. Rotate/move to env, separate from this phase.

_As-of 2026-11-13. Evidence: full hot-path read of both services + live slow-query log (2 GB, 788k ops). Read-only; nothing changed on production. Companion to `DB-SCALING.md`, `INDEXING-PLAN.md`, `DB-UPSCALING-BACKLOG.md`._
