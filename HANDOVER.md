# AutoPulse DB Scaling — Handover & Cutover Decision

**For:** the developer who owns the live code + live DB, and will run the validation of the scaled cluster.
**Purpose:** answer the one critical question — *when the `db-scaling` branch merges to `main`, can the app write to BOTH the old live DB and the new scaled DB, or does merging force us to make the new cluster the one and only DB?* — and lay out exactly what to do, with IPs and the job defined.

> **Security note:** this file is committed to a **public** repo. It contains **no passwords**. Connection credentials (user `ravi` + password) come **separately** from the private `AutoPulse-Server-Access.txt`, never here, never in a group chat.

---

## TL;DR (read this first)

1. **Merging the code does NOT create dual-write.** Both services (CRM + AI) connect to a **single** `MONGODB_URI`. There is no code anywhere that writes to two databases. Writing to "both DBs" is a **feature that does not exist yet** — merging the branch will not give it to you.
2. **Merging the code does NOT, by itself, pick a database.** *Which* DB the app uses is set **100% by the `MONGODB_URI` env var**, not by the code. Same code → point it at the old DB *or* at the new cluster; it writes to whichever one URI names, and only that one.
3. **So "merge = cutover" is a choice, and it should be the LAST step, not the test step.** Merge the scaled code to `main` **and** switch `MONGODB_URI` to the new cluster **together, at the very end**, only after the cluster is proven. At that moment you retire the old DB.
4. **To test live data on the new cluster NOW, do NOT merge.** Mirror live writes to the new cluster by a method that leaves the live site 100% untouched (options below). Keep the live site on the old DB + current code until the numbers prove the new cluster.
5. **Your instinct is correct:** *"if dual-writing would break things, don't merge now — just write to the new cluster, test it, and merge when it's proven and we're ready to shift traffic."* That is exactly the senior-recommended path. This doc makes it concrete.

---

## Current live topology (as of 2026-11-23)

| Piece | Where | Notes |
|---|---|---|
| **Website + CRM + AI + chatbot app** | `Autopulseapplication` — t2.xlarge (4 vCPU, 16 GB), **public 54.88.250.148**, **private 172.31.82.184** | CRM `aidmvcs-be-v2` (PM2, port 3001) + worker `aidmvcs-worker-v2`; AI service port 8100. Code at `/var/www/html/autopulse-prod-v2/`. Redis on 127.0.0.1:6379 (CRM db0, AI db1). www.autopulse.ai + chat.autopulse.ai. |
| **LIVE DB (the one in production right now)** | `database` — t2.large (2 vCPU, 8 GB), **private 172.31.16.69:27017** | **MongoDB 8.0.19, STANDALONE** (not a replica set), DB `emailai`. Reachable only from the web server. App user `ravi` is **app-only — no admin/profiling privilege**. |
| **Chatbot brain + its Postgres/MySQL** | 3.208.33.227 | Separate; we have no login. Not part of this work. |

**How the live app connects today:** `MONGODB_URI` in the server's `.env` → `172.31.16.69` (the live standalone). One DB. That is the only thing production writes to.

---

## The scaled cluster (`rs0`) — built, tested, NOT yet live

Replica set `rs0`, a full clone of live `emailai`, upgraded to **MongoDB 8.0.38 / FCV 8.0**. Indexing + query-optimizations + pooling + Redis caching + queue rate-limits applied. Stress-tested to **~230k writes/min, 0 errors** (real traffic ≈ 10k/min); degrades gracefully, never crashes/corrupts/loses data. Full detail in `DB-SCALING.md`.

| Role (AWS instance name — **not** the floating replica role) | Address |
|---|---|
| `autopulse-dbscale-primary` (prompt `ip-172-31-28-18`) | **172.31.28.18:27017** (public 54.90.91.80) — data/writes |
| `autopulse-dbscale-secondary` (prompt `ip-172-31-38-100`) | **172.31.38.100:27017** (public 3.80.175.83) — data/reads |
| Arbiter (on the secondary box) | 172.31.38.100:27018 — vote only |

Replica-set URI shape (credentials come from the private access file):
`mongodb://<user>:<pw>@172.31.28.18:27017,172.31.38.100:27017/emailai?authSource=emailai&replicaSet=rs0`
(append `&readPreference=secondaryPreferred` for dashboard/report reads.)

---

## THE CRITICAL QUESTION, answered from the code

> *"When this branch merges to main, can we still write to both the old DB and the new DB — or do we have to make our new DBs the main DB and forget the old one?"*

**Provable facts from the code:**
- `aidmvcs-be-dev/app/lib/mongodb.js` → `mongoose.connect(process.env.MONGODB_URI, …)`. One URI. One connection.
- `agentic-upsell/src/upsell_agent/integrations/mongodb.py` → `AsyncIOMotorClient(settings.mongodb_uri, …)`. One URI. One client. Every read/write goes through this single client.
- **No second client, no mirror, no "write to A and B" anywhere.** Dual-write is not implemented.

**Therefore:**
- **You cannot "write to both" just by merging.** The code has no concept of a second DB. Merging the branch changes query/cache/pool/rate-limit *behavior*, but it still writes to the **one** DB the URI names.
- **Merging does not force the new cluster to be primary either.** If you merge and leave `MONGODB_URI` on the old DB, the app keeps writing to the old DB (see the startup caveat below). If you merge and change the URI to `rs0`, that is a **full cutover** — from that moment the app writes only to `rs0` and the old DB is out of the loop.
- **Writing to both at once requires NEW code** — a fail-safe second-client mirror — that has to be built and reviewed. It is the task, not a side-effect of the merge.

### ⚠️ One more thing merging does, even pointed at the old DB
On startup the app **ensures indexes and runs data migrations** against whatever DB it connects to:
- AI `ensure_indexes()` (called from `main.py` lifespan) creates all `INDEX_SPECS` **and** runs `migrate_legacy_consent`, `migrate_silenced_opt_outs`, `repair_old_crm_stops` (turns old CRM STOPs into real opt-outs), `note_stopped_inquiries`.
- The DB-SCALING indexing work expects the `emails`/`ai_messages` **idempotency-key** index to be **dropped and recreated** in its new `$exists:true` form (`ensure-email-indexes.js`; see `INDEXING-PLAN.md §B` + the migration note in `mongodb.py`).

So "just merge and keep the old URI" is **not a clean no-op** — it would apply index builds + consent migrations to the **live** DB on the next deploy. Treat a merge-to-main as a real production event, planned with the indexing/migration steps, not a quiet code bump.

---

## What to actually do — test first, merge last

**Goal (the real job):** get **real live traffic/data onto the `rs0` cluster**, watch the logs/metrics for a few days, and confirm the optimizations behave and the numbers match — **without putting the live site at any risk.**

### Step order
1. **Do NOT merge `db-scaling` to `main` yet.** Keep live on the old DB + current prod code.
2. **Mirror live → `rs0`** by one of the options below (leaves the live write path untouched).
3. **Seed `rs0` complete first** — fresh full copy of live `emailai` so comparisons aren't skewed by missing history (done once 2026-11-12; re-sync fresh at the start of the window).
4. **Watch both** for a few days (monitoring section below) and **compare** — does `rs0` keep up with real write volume (0 dropped), do dashboard numbers match live, are the slow-query/index patterns what the optimizations predicted.
5. **Only once proven:** merge `db-scaling` → `main` **and** switch `MONGODB_URI` to the `rs0` replica-set URI, **in the same planned cutover**, run the indexing/idempotency migration steps, finish the security hardening, then retire the old DB.

### How to mirror live → rs0 (pick one — this is your call, you have full access)

| Option | What it is | Risk to live | Validates | Catch |
|---|---|---|---|---|
| **A. `mongosync` (DB-level, no app change)** | MongoDB's cluster-to-cluster sync continuously copies live → rs0. | **Lowest** (no app/code change). | rs0 under real data + write volume; you run query/latency comparisons on it. | `mongosync` needs the **source to be a replica set** (it reads the oplog). **Live is a STANDALONE**, so first convert live to a single-node replica set (add `replSetName`, restart `mongod`, `rs.initiate()`) — a short, planned live maintenance. Does **not** exercise the app's live query mix. |
| **B. App-level dual-write (fail-safe shadow)** | New code: a second Mongo client; every write also fires at rs0, **wrapped so a slow/down rs0 never breaks or slows the live write** (log-and-continue). Reads stay on live. | **Low IF fail-safe is correct** — the fail-safe is the whole safety condition. | The real app write path on rs0 (closest to production behavior). | Must be **built + code-reviewed** (doesn't exist yet). Deploy it as a **minimal, isolated change** — not by merging the whole scaling branch to main. |
| **C. Full cutover** | Point `MONGODB_URI` at rs0 now. | **High** — bets production on an unproven cluster. | Everything, for real. | Premature. This is the final step, not the test. |

**Recommendation:** **A** if you want zero app risk and are OK with the one-time "make live a single-node replica set" step (which is also the natural first move toward the eventual cutover). **B** if you specifically want to prove the app's own query/cache/pool behavior on rs0 — build it fail-safe and deploy it on its own, not via the main merge. **Avoid C until the end.**

---

## Monitoring — already on, here's how to read it

Turned on 2026-11-23:
- **rs0 primary + secondary:** queryable profiler ON (`db.setProfilingLevel(1,{slowms:100})` on `emailai`, per node). Query it: `db.system.profile.find().sort({ts:-1})`. *Resets to 0 on a mongod restart* — re-enable, or add `operationProfiling.mode: slowOp` to `mongod.conf` to persist.
- **Live DB:** `ravi` has no profiling privilege, so the profiler isn't enabled there, BUT the live `mongod` **already logs every slow query >100 ms to its log file by default** (same source the Nov-13 audit used). Read it on the `database` box. *(Richer live monitoring — queryable profiler + `$indexStats` — needs a `clusterMonitor`/admin Mongo user; see `DB-UPSCALING-BACKLOG.md`.)*

All three capture ">100 ms" slow queries, so live vs rs0 is comparable during the window. Also watch: `db.serverStatus().connections`, `rs.printSecondaryReplicationInfo()` (replication lag), `free -h` (no swap on the test boxes), and CloudWatch CPU credits (t2 burstable).

---

## Open items before any cutover (not now — at the flip)

From `DB-SCALING.md` security-hardening + load-test findings, all still open:
- **Open the secondary box SG to the app server on 27017** (`172.31.82.184/32`). During testing the app server couldn't reach `172.31.38.100`, so when the PRIMARY role floated there, writes failed with "No primary available." The app must reach **every** data node (the primary role floats).
- **Revert the temporary `rs.reconfig`** that pinned `172.31.28.18` to `priority:10` (set during testing) back to equal priorities.
- **Close 27017 to the internet** (currently `0.0.0.0/0` for testing), **restrict SSH**, **rotate the Mongo password** (the test cluster reuses live's), reconfirm `bindIp` private + auth + keyfile.
- **Consider moving the arbiter off the secondary box** (that one box holds 2 of 3 votes today → single point of quorum loss).
- **Add the 3rd data node** before enabling write-concern `majority` (#8).

---

## Credentials & the rest of the docs

- **Credentials (user `ravi` + password, connection strings):** private `AutoPulse-Server-Access.txt`, sent separately. **Never** in this repo.
- **Companion docs in this repo root:** `DB-SCALING.md` (master plan, full progress log, dual-write plan, cutover steps), `INDEXING-PLAN.md` (indexes + the idempotency-key migration), `QUERY-OPTIMIZATION-PLAN.md` (query rewrites, done vs rs0-gated), `DB-UPSCALING-BACKLOG.md` (non-index findings still parked).
- **Scaled code branch:** `db-scaling` (merged up to date with latest feature work). The scaling-specific pieces: `app/worker/rateLimit.js` + its wiring (queue rate caps, #9), `app/lib/dashboardCache.js` (Redis dashboard cache, #4), env-driven pool sizes in the two connection modules (#3), the `$facet` collapses in the stat endpoints (#2).

_Created 2026-11-23. Companion to `DB-SCALING.md`._
