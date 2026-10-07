# Plan 3 notes: 26 September 2026

Branch `plan_3`. No Plan 3 code yet. Recorded in `docs/architecture/architecture.md` §15 (decisions 14–16).

## Decided (Part A: inventory)

- **Prices:** off limits. The AI never states or implies a price. A budget can still filter the search.
- **Links:** none in SMS. Email may link the vehicle's page on the dealer site (`inventoryUrl`) if the record has one.
- **Vehicles per reply:**
  - SMS: at most 2 named, from at most 3 loaded. This keeps the existing n8n SMS v8 rule.
  - Email: at most 3. No earlier document set a limit.

## Still open (Part A)

- **What counts as "in stock" — corrected.** This was originally one question; it's really two, and only one is resolved:
  - **Resolved:** "does `vehicles` mix dealer stock with customers' own DMS-history cars?" — No. DealerVault never writes to `vehicles` (only reads it). The only writer in production is the vAuto CSV import. There's no customer-car contamination to filter out.
  - **Still open, and this is the actual remaining question:** whether a given vAuto record is still in stock or already sold. The import only stores `salestatus` when the feed happens to include a `saleStatus` column. Needs one real dealer's data: does a sold car drop out of the next feed run, get flagged, or just sit there stale?
- **Where to read stock from — decided: the API, not a direct query.** No direct-database-query code has ever been shipped. `inventory_tool.py` is `raise NotImplementedError`, and its own docstring (written in Plan 1) already says to call `/api/car`, "rather than re-querying Vehicle documents directly." So Master Plan 3's "Suggested: Option B (direct query)" is overridden — use the API. `/api/car` has real defects that need fixing first: no auth, no in-stock filter, a cost/invoice data leak through `facets`, and broken sort/year/location filters.
- **Interim decision (27 Sept): assume every vehicle `/api/car` returns is in stock.** There's no sold/available filter to apply, so none is applied for now. This is a known gap, not a fix — a sold car can be mentioned until the real "in stock" question above is answered. Applied to `MASTER_PLAN_3.md` Phase 1 (drops the in-stock-rule test) and Phase 5 (its re-check has nothing to check against yet).
- **Year filter — worked around, no code change needed (27 Sept).** `/api/car`'s `year` parameter is broken (regex against a number field, never matches). Its `year_range` parameter isn't — it builds a real `{ $gte, $lte }` query and runs after the broken block, overwriting it. So: always call it with `year_range=<Y>-<Y>` (or `<Y-1>-<Y+1>` for the "year ±1" loosening step), never `year`. `route.js` is Prashanth's, off-limits per the "no edits to non-Ammer code" rule — this fixes it from our side without touching his code at all.
- **When a record is too old to mention — no client answer, so we're deciding it ourselves.** Checked every file in `docs/data/` and the blueprint in `docs/client/`: nothing states a threshold. The blueprint's "verify vehicle is active before sending media" is a send-time check, not a staleness rule, and Phase 5 already covers that separately. **Our own default (not the client's):** a record older than 3 days since its last import isn't mentioned. To be revisited once real feed data answers the "in stock" question above.

## Client asks that override earlier decisions — finalized

Each of these was checked against `docs/client/` and `docs/data/` and now overrides what came before it. Recorded in `architecture.md` §15, decisions 14–20.

### Against real, already-shipped Plan 1/2 code

These aren't drafts — the old side was live, tested behavior. The client's word now wins over it.

| Topic | What shipped (old) | What the client asked (now decided) | Client's exact words / reference |
|---|---|---|---|
| **Links in SMS** | `agent/llm.py:166` — the live Compose prompt: *"sms_text at most 320 characters, no links."* | First quality response to a vehicle-specific lead gets a vehicle link + image (fallback: link only → image only → no vehicle, personalize by intent), once verified active/in stock. | `docs/client/autpulse.workflowblueprint.png`, box "6. FIRST QUALITY RESPONSE RULE"; also box "A. NO-RESPONSE CADENCE" Day 1 Touch 1: *"Include vehicle link and image (if applicable)."* |
| **Prices** | `agent/llm.py:106,134` — price/payment/financing/trade-in-value/discount/approval questions are `restricted`, answered "the team will confirm." **Stays as-is for direct pricing questions.** | New, narrower allowance: a *verified* price drop/OEM change on an already-loaded vehicle may be used as a Day 8–90 follow-up angle. Not an answer to "how much" — an outreach angle only. | `docs/data/pdf_dump.txt` (follow-up PDF, Days 8–30/31–90 cadence: *"verified price change/OEM offer"*, *"Verified price/OEM changes"*); `docs/client/autpulse.workflowblueprint.png`, box "INVENTORY FEED INTEGRATION": *"Alert on PRICE CHANGES & price drops."* |
| **Contact hours** | `architecture.md` decision 11 (a real Plan 2 decision, enforced in `scheduler/contact_window.py`): 8:00–20:00, **dealer's** local time. | 8:00–21:00 (federal TCPA ceiling — the blueprint's "9pm"), in the **customer's** local time. | `docs/client/autpulse.workflowblueprint.png`, box "0. AFTER-HOURS & TCPA COMPLIANCE RULE": *"8am–9pm local time at the customer's location"*; `docs/data/pdf_dump.txt` (TCPA PDF, p.2 "Hours"; p.4 §7). **Still open:** the client hasn't said how the customer's timezone is found. |
| **Handoff triggers** | `slots/policy.py:115` — exactly two triggers: asked for a person, or clearly upset (≥0.8 confidence). | Add: escalate immediately on an urgent need; a direct phone-call request gets a callback within 5 business minutes. | `docs/client/autpulse.workflowblueprint.png`, box "7. ESCALATION RULES". |

### Against Master Plan 3's own draft, never shipped

Nothing here was live code — the plan's authors wrote a placeholder before checking with the client. No conflict with running behavior, just the draft catching up.

| Topic | Draft said | Client asked (now decided) | Client's exact words / reference |
|---|---|---|---|
| **Out-of-stock reply** | Phase 3 (original wording): an honest "I'm not seeing one in stock right now." | Never a bare "not available" — always pair it with the closest alternative, or a promise to check. | `docs/client/autpulse.workflowblueprint.png`, "VEHICLE TYPE OVERRIDE RULE" / inventory guidance boxes. Already applied to `MASTER_PLAN_3.md` Phase 3. |
| **Visit-offer attempts** | Phase B4 item 4 (draft suggestion): "at most twice per lead." | Up to 3 attempts — attempt 2 uses a different hot-button/objection angle, attempt 3 a different value proposition — then stop, record the reason, and schedule a follow-up. | `docs/client/autpulse.workflowblueprint.png`, box "C. APPOINTMENT CONVERSION — ASK UP TO 3 TIMES." |
| **"Urgent need" as a handoff reason** | Phase B0.13's own "Suggested" list (person / upset / declined-visit-twice) never included this — a gap in the draft, not a considered choice against it. | Escalate immediately on urgent need (same client ask as above). | Same as the "Handoff triggers" row above. |

### Still not addressed anywhere

- How the customer's timezone is determined (needed for the contact-hours change above).
- The state-by-state rules table (client says counsel provides it).
- Replying at night inside an outbound campaign.
- Booking slot length and earliest offer time.

## Part B (client asks: after hours, US rules, bookings)

- Decisions come only from the client's own words: the WhatsApp excerpt, the two PDFs and the blueprint. Nothing is invented.
- **Not stated by the client:**
  - how to find the customer's timezone;
  - the state rules table (counsel to provide);
  - replying at night inside an outbound campaign;
  - booking slot length and earliest offer time.

## Changes made in this session

- Read every file in `docs/data/` and `docs/client/` and confirmed what each one is (conversation excerpts, the two client PDFs, their text dump, the blueprint image, the older conversation-examples reference).
- Audited `/api/car` and the `Vehicle` model/import path; found no reliable in-stock/sold field, and several defects in `/api/car` (no auth, cost/invoice data leak via `facets`, broken sort/year/location filters, unescaped regex input, disagreement with n8n on which price field is real).
- Recorded 3 initial Part A decisions (prices restricted, links, vehicles-per-reply cap) in `architecture.md` §15, decisions 14–16.
- Edited `MASTER_PLAN_3.md` Phase 3 so an out-of-stock answer always offers an alternative or a promise, never a bare "not available."
- Checked each of 6 further client asks against `docs/client/` and `docs/data/` line by line, and split them into two kinds: 4 that override real shipped Plan 1/2 code (links, prices, contact hours, handoff triggers), and 2 that only override Master Plan 3's own unbuilt draft (visit-ask count, "urgent need").
- Recorded those 6 as decisions 14–20 in `architecture.md` §15, each with its exact source quote and location.
- Updated `MASTER_PLAN_3.md` throughout to match: Phase 0 items 3, 4 and 7 (prices, links, photos), Phase B0 items 5 and 13 (customer time zone, handoff triggers), Phase B3 (time-of-day rule and scenario), Phase B4 item 4 (visit-attempt count), the phase-overview table, and the "Not in this plan" list.
- Added a new "Open questions from the 26 September client review" section to `MASTER_PLAN_3.md` listing 9 questions the above changes raised (MMS/image sending isn't built, the price-drop guard exception needs careful design, customer-timezone lookup method, dropping the dealer-hours half of the send check, "urgent need" detection, the 5-minute callback needing call-task infrastructure, undefined "different angles" for visit retries, the still-missing state rules table, and two untouched B0 items).
- Wrote this notes file and kept it up to date across the session.
- Corrected the "in stock" note: it had answered a different question than the one still open (no customer-car mixing in `vehicles`, vs. whether a specific record is sold).
- Confirmed no direct-database-query code was ever shipped for inventory; decided to use `/api/car` per `inventory_tool.py`'s own docstring, overriding Master Plan 3's "Option B" suggestion.
- Confirmed no client document states a feed-freshness threshold; set our own 3-day default and labeled it explicitly as ours, not the client's.
