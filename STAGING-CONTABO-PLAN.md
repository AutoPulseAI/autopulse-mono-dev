# AutoPulse mono-dev — Staging on Contabo (scaled-DB validation)

**For:** whoever sets up and runs the Contabo staging environment (self + companion dev).
**Status:** PLAN — not built yet. The CI/CD workflow and the sync job are described here; building them waits on the Contabo credentials/secrets.

> **Security:** this file is in a **public** repo. **No credentials here.** Server host/user/SSH key and all `.env` values go into **GitHub Actions secrets** and the private `AutoPulse-Server-Access.txt`, never this file.

---

## What we're doing (and why)

Run a **full copy of the mono-dev app (CRM + AI) on Contabo** as a **staging environment**, pointed at the **scaled `rs0` MongoDB cluster** (not the live AWS DB). Purpose: validate the scaled DB + the scaling code under a real, running app, **without touching live production** on AWS.

- **Live/prod stays exactly as is:** `main` → AWS (existing `.github/workflows/deploy.yml`), pointed at the live standalone DB `172.31.16.69`.
- **Staging is new and separate:** a long-lived **`staging` branch** → Contabo, pointed at `rs0` (primary for writes, secondary for dashboard reads).
- Keep `rs0` fresh with a **periodic sync from the live DB** (every 15–30 min) so staging sees real, current data.

### Branch strategy
| Branch | Deploys to | DB | Via |
|---|---|---|---|
| `main` | AWS production | live standalone `172.31.16.69` | `deploy.yml` (existing) |
| **`staging`** (new, long-lived) | **Contabo** | **`rs0` replica set** | **new `staging.yml` (to build)** |
| `db-scaling`, feature branches | — | — | merge into `staging` to test, into `main` to ship |

Why a dedicated `staging` branch instead of deploying off `db-scaling`: `db-scaling` is a feature branch meant to merge and close; a permanent environment should hang off a permanent branch. Merge anything you want to try into `staging`; it auto-deploys to Contabo.

---

## CI/CD — modeled on the connect-api / connect-web pipelines

Reuse the proven pattern from `autopulse-connect-api/.github/workflows/ci.yml` and `autopulse-connect-web/.github/workflows/deploy.yml`:

**New file:** `.github/workflows/staging.yml` in this repo.
- **Trigger:** `push` to `staging` (+ `pull_request` → build-only, + `workflow_dispatch`).
- **`build` job:** checkout → `setup-node@v4` (Node 22, yarn cache) → `yarn install --frozen-lockfile` → build **both** apps (CRM `next build`; AI Python deps/venv) → tar `release.tgz` artifact. (Optionally reuse `deploy.yml`'s "which app changed" detection so a CRM-only push doesn't rebuild the AI.)
- **`deploy` job** (only on `staging` push): download artifact → SSH to Contabo → scp the release + the staging `.env` secret(s) → run a server-side `deploy/remote-deploy.sh` that installs into the staging paths and reloads PM2.

**Difference from connect (one app) → here (two apps):** mono-dev ships the **CRM (Next.js)** *and* the **AI (Python/uvicorn + SAQ)**, so the build packages two releases (or one combined tar) and `remote-deploy.sh` reloads two PM2 apps — mirror how `deploy.yml` already handles both on AWS, just targeting Contabo paths/ports.

**Same Contabo server as the connect apps, but isolated:** different install paths, PM2 app names, and **ports** so staging CRM/AI don't collide with the connect web/API already on that box (connect web+API are on `:8090`). Pick a distinct port block for staging CRM (e.g. `:3101`) and AI (e.g. `:8101`) — confirm what's free on the box.

**GitHub Actions secrets to add (names, not values):**
- `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY` — the Contabo box (can reuse the connect ones if it's the same box/user).
- `STAGING_CRM_ENV` — the whole CRM `.env` pasted as one secret (incl. `MONGODB_URI` → `rs0`, the scaling env vars, SES keys, etc.).
- `STAGING_AI_ENV` — the whole AI `.env` pasted as one secret.
- (optional) `DEPLOY_DOMAIN` variable if staging gets its own nginx host/SSL.

---

## Staging DB config (`rs0`)

In `STAGING_CRM_ENV` / `STAGING_AI_ENV`, `MONGODB_URI` points at the replica set (credentials from the private access file):
```
mongodb://<user>:<pw>@172.31.28.18:27017,172.31.38.100:27017/emailai?authSource=emailai&replicaSet=rs0
```
- Dashboard/report reads: append `&readPreference=secondaryPreferred` (read off the secondary, #6).
- Pool sizes per process (#3): CRM web `MONGO_MAX_POOL_SIZE=50`, CRM worker `20`, AI API `20`, AI worker `50`.
- Queue rate caps (#9) and dashboard cache (#4) use their env defaults; tune per env if needed.
- **Network reachability:** Contabo is OUTSIDE the AWS VPC, so it reaches `rs0` over the **public** IPs (primary 54.90.91.80, secondary 3.80.175.83) and the boxes' security groups must allow Contabo's IP on 27017. (During the test phase 27017 is open `0.0.0.0/0`; see the hardening checklist in `DB-SCALING.md` before any prod use.)

---

## Periodic live → `rs0` sync (every 15–30 min)

A scheduled job copies fresh data from the **live DB** into `rs0` so staging stays current. Options (decide at build time):
- **Simplest:** a cron on a box that can reach both DBs running `mongodump` (live) → `mongorestore --drop` (rs0), scoped to the collections that change. Runs every 15–30 min.
- **Cleaner:** convert live to a single-node replica set and use `mongosync` for continuous sync (see `HANDOVER.md` — live is currently a standalone, so this needs the one-time conversion).

> ⚠️ **Known trade-off (accepted for now):** a `mongorestore`-style sync **reintroduces the old indexes** and **undoes our index cleanup** (the idempotency `$type` index comes back → the AI send-check COLLSCANs ~768k docs again; the 15 redundant indexes return). During the staging/test phase this is **OK** — we're validating data flow and app behavior, not index-perfect latency. **Fix = re-run the indexing commands below after each full sync, and definitely at final cutover.**

---

## ⚠️ INDEXING — run these when the full production DB is shifted onto `rs0` (and after any full re-sync)

A fresh `mongodump`/`mongorestore` from the old DB brings back **all** the old indexes. To restore the scaled index set, run the two cleanups below on the `rs0` **primary** (`autopulse-dbscale-primary` / `ip-172-31-28-18`). Full rationale in `INDEXING-PLAN.md` (§B idempotency, §C redundant) and the "Cutover — index steps" section of `DB-SCALING.md`.

**1. Idempotency-key `$type` → `$exists` fix (the critical COLLSCAN fix).** Drop the old `$type` partial-unique indexes; the app recreates them as `$exists:true` on startup (`ensure-email-indexes.js` + AI `ensure_indexes()`):
```javascript
// on rs0 primary, db = emailai
db.emails.dropIndex('ai_idempotency_key_unique');
db.ai_messages.dropIndex('idempotency_key_1');
// then restart the CRM + AI so they recreate these as unique partial {$exists:true}
// (or create by hand: unique:true, partialFilterExpression:{<field>:{$exists:true}})
```

**2. Drop the 15 redundant indexes** (each is covered by a longer index — safe; `INDEXING-PLAN.md §C` is authoritative). Reverse-sort pairs: drop one direction, keep the other.
```javascript
// wrapped so a missing one doesn't stop the rest
function dropIf(coll, idx){ try { db[coll].dropIndex(idx); print('dropped '+coll+'.'+idx);} catch(e){ print('skip '+coll+'.'+idx+': '+e.message);} }
dropIf('emails','dealer_id_1');
dropIf('emails','lead_id_1');
dropIf('emails','_id_1_parent_message_id_1');
dropIf('emails','dealer_id_1_date_1');            // keep dealer_id_1_date_-1
dropIf('leads','dealer_id_1');
dropIf('leads','fe_lead_status_1');
dropIf('leads','idx_dealer_fe_status_created_asc'); // keep ..._desc
dropIf('csvimporteddatas','csv_import_id_1');
dropIf('campaigntrackings','dealer_id_1');
dropIf('campaigntrackings','campaign_id_1');
dropIf('campaigntrackings','campaign_lead_id_1');
dropIf('campaigntrackings','campaign_lead_id_1_event_type_1');
dropIf('campaignleads','campaign_id_1');
dropIf('dealerwebsiteclicks','dealer_id_1');
dropIf('dealerwebsiteclicks','shortCode_1');
```

**3. Confirm the new indexes exist** (the app also recreates these on startup): `emails {message_id:1}`, `emails {dealer_id:1,createdAt:-1}`, `ai_messages {dealer_id:1,platform_message_id:1}`, and the `$exists:true` unique partials from step 1. Spot-check with `db.<coll>.getIndexes()`.

> These are the same steps in `DB-SCALING.md` → "Cutover — index steps." If `rs0` keeps the data it already holds (no re-dump), nothing needs redoing — the index set is already correct. The re-run is only needed after a full restore/sync.

---

## Environment ownership map — which env belongs to which app

Project **AutoPulse**, repo **`autopulse-mono-dev`**, staging deploy → Contabo `217.77.10.180`, under `/opt/autopulse-staging`.

| Sub-app | What it is | GitHub secret (the whole `.env`) | On-box path | Port | Safety flags it carries |
|---|---|---|---|---|---|
| `aidmvcs-be-dev` | CRM / dashboard (Node/Next.js) | **`STAGING_CRM_ENV`** | `/opt/autopulse-staging/aidmvcs-be-dev/.env` | 3101 | `PROVIDER_SEND_STUB=true` (no real email/SMS) |
| `agentic-upsell` | AI service (Python/uvicorn + SAQ) | **`STAGING_AI_ENV`** | `/opt/autopulse-staging/agentic-upsell/.env` | 8101 | `CHANNEL_DRIVER=fake`, `MODEL_EXTRACT/COMPOSE=offline`, `VEHICLE_DATABASES_ENABLED=false` (no real sends, no OpenAI / vehicle-API spend) |
| *(shared — box access)* | Contabo SSH | `SERVER_HOST` (217.77.10.180), `SERVER_USER` (root), `SERVER_SSH_KEY` | — | — | — |
| *(shared — DB)* | scaled MongoDB | `MONGODB_URI` set **inside both** env secrets | rs0 primary `54.90.91.80:27017` (public, `directConnection=true`) | 27017 | — |

**Who reads the safety flags:** the app itself, at runtime — the CRM Node process reads `PROVIDER_SEND_STUB` (`app/lib/providerStub.js`, used by `email.js`/`sms.js`); the AI Python process reads `CHANNEL_DRIVER` / `MODEL_*` / `VEHICLE_DATABASES_ENABLED` (`config.py`). There is **no "staging detector"** — safety lives entirely in these env values, so never paste a prod env into the staging secrets.

**Paid keys stripped from the staging envs** (removed by the owner so staging can't spend a cent): CRM — `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, `MAILGUN_*`, `SMTP_*`/`THIRD_SMTP_*`, `OPENAI_API_KEY`/`OPENAPI_KEY` (+ consider `CLOUDFLARE_*`, `HESTIA_*`); AI — `OPENAI_API_KEY`, `TWILIO_*`, `VEHICLE_DATABASES_API_KEY`. Kept: `JWT_SECRET`, `UPSELL_SERVICE_SHARED_SECRET`, `MONGODB_URI` (needed to run).

## Still to decide before building (need from the owner)
1. **Contabo credentials** → so I can scaffold `staging.yml` + `remote-deploy.sh` and you add the GitHub secrets.
2. **Ports/paths** free on the Contabo box for the staging CRM + AI (not colliding with the connect apps on `:8090`).
3. **Sync method** — cron `mongodump`/`mongorestore` (simple, reintroduces indexes) vs `mongosync` (needs live → single-node replica set first).
4. Whether staging needs its **own domain/SSL** (`DEPLOY_DOMAIN`) or runs on an IP:port.

_Created 2026-11-26. Companion to `DB-SCALING.md`, `HANDOVER.md`, `INDEXING-PLAN.md`._
