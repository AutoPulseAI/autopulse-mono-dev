# Master Plan 3: Inventory, contact rules and appointments

> **What this is:** three parts.
>
> - **Part A: Inventory** (Phases 0–7). Letting the AI talk about the dealer's
>   inventory ("do you have a white RAV4?", "what SUVs do you have under
>   30k?"). It was left out of Plan 1 and Plan 2 on purpose.
> - **Part B: Client requests of 25 September 2026** (Phases B0–B6).
>   After-hours leads, strict US rules for outbound messaging, and booking
>   appointments as the main goal. Source: [`../../data/conversation_2.md`](../../data/conversation_2.md).
> - **Part C: the client's two developer specs** (Phases C1–C6): the TCPA
>   compliance engine and the new-lead follow-up workflow.
>
> **Build order. Decided 27 Sept, replacing "Part B first":** build first the part
> that has no other part of this plan as a prerequisite. Part B turned out to
> depend on Part C (B3's send check is the same engine as C1's `can_contact`),
> so it can't go first.
>
> | Part / phase | Needs first |
> |---|---|
> | **A** Phases 1–4, 6–7 | Nothing in this plan (only Plan 2 and the existing `/api/car`) |
> | A Phase 0 item 3 (price-drop exception) | **C4** (the Day 8–90 cadence it is used in) — deferred until C4 ships |
> | A Phase 0 item 7 (MMS) | Nothing — driver work on `channels/twilio.py` |
> | A Phase 5 (freshness) | Phase 0 item 1 (real feed data), not another part |
> | A Phase 3's visit offer ("want to come see it?") | B4 — added once B4 ships; Phase 3 works without it |
> | **C1** compliance engine | Nothing — build it once; B2 (origin) and B3 (send rules) become its inputs and rule set |
> | B1 after-hours reply | C1 (the "later" path and every send go through the send check), customer time zone (B0.5) |
> | C2 call tasks (**skipped for now**) | C1 |
> | B0.13 5-minute callback (**skipped for now**) | C2 |
> | B4 visit offer | B5 (the offered times) |
> | B5 booking | Nothing — uses the platform's existing `POST`/`PUT /api/booking` unchanged |
> | C3 state machine | C1 |
> | C4 cadence | C3 (C2's call tasks are skipped, so C4 runs as SMS + email only) |
> | C5 appointment flows (**shipping**, 27 Sept) | B5, C3, C4 (a no-show goes back into C4's follow-ups) |
>
> **Order:** Part A (except the deferred items) → C1 (with B2/B3 folded in) →
> B1 → B5 → B4 → C3 → C4 (then A's price-drop exception) → C5 → C6.
> **C2 is skipped for now (27 Sept)**, and with it B0.13's 5-minute callback.
>
> **Platform code rule (27 Sept):** the platform (`aidmvcs-be-dev`) is not
> changed by this plan, except two approved changes: B3's campaign check (worker
> + campaign report), and C5's manager outcome selection. Everything else is
> done in the AI service, using platform endpoints and data as they are today.
>
> **Assumes:** [`../PLAN_2/MASTER_PLAN_2.md`](../PLAN_2/MASTER_PLAN_2.md) is finished end to end:
>
> - one context pack per turn;
> - conversation state (asks, open questions, promises);
> - the rolling summary;
> - questions labelled `answerable` / `restricted` / …;
> - Decide's `answer` rule;
> - read-only answer sources loaded in code;
> - the guard knowing those sources.
>
> Today, stock questions are labelled `restricted` and answered with "the team
> will check what's in stock for you". This plan makes them answerable from real
> stock, safely.
>
> **Progress:** `PLAN_3/progress_3.md`, written as each phase is finished.

---

## Open questions from the 26 September client review

Six client requirements were checked against `docs/client/` and `docs/data/` and now override earlier decisions or draft suggestions (recorded in `architecture.md` §15, decisions 14–20, and in `docs/report/26-9-26/NOTES.md`). Applying them surfaced nine open questions.

**Status after the 27 September review** (recorded in `architecture.md` §15, decisions 21–36, and `docs/report/27-9-26/NOTES.md`). Items marked **our default** were decided by us without a client answer and are flagged for client feedback.

1. **MMS/image sending — decided: MMS through Twilio.** Twilio SMS is already built (`channels/twilio.py`); it gains `MediaUrl` support, using the vehicle's `imagesSecure` URL. Still to do: cost/reliability review, and check that the image URL is public and under the carrier size limit before sending. Phase 0 item 7.
2. **Price-drop guard exception — not a client question, a design task.** Moved into Phase 0 item 3. Deferred until Part C's C4 (the Day 8–90 cadence it is used in) ships.
3. **Customer time zone — decided:** ZIP/state first, then the phone's area code. **Our default** when neither works: the window that is legal in every continental US zone at once. B0.5.
4. **Dealer hours for outbound — decided: kept.** A message the system starts must fall inside the dealer's opening hours **and** the customer-local window. A reply to a customer's message is exempt. Source: blueprint box "7. BUSINESS HOURS RULE" ("All other touches follow business hours unless customer replies"). B0.5, B3.
5. **"Urgent need" — decided:** an Extract label with a confidence and a fixed reason list, plus a pure-code backstop (`interest.needed_by` within 48 hours). **Our default** reason list and threshold; example set to be confirmed by the client. B0.13.
6. **5-minute callback — skipped for now,** together with C2 (staff call tasks), which would need new platform backend and UI.
7. **"Different angle" — decided:** from the client's own words (blueprint box C, Omnichannel PDF Day 6, `conversations.md`), with a fixed angle set we defined. **Our default** list; to be confirmed by the client. B4 item 4.
8. **State rules table — still not provided. Interim decision:** the strictest known state rule is applied everywhere until counsel's table arrives. B0.6.
9. **Replies at night, booking rules — decided with our defaults.** A customer's message is acknowledged right away at any hour; the conversation continues right away only inside the customer's 8:00–21:00, as the blueprint says. Booking defaults set by us. B0.8, B0.10. Both flagged for client feedback.

---

# Part A: Inventory

## What already exists

| Piece | Where | State |
|---|---|---|
| Vehicle records | Platform `vehicles` collection (Mongoose `Vehicle`, `strict: false`, unique per dealer + VIN) | In production, only the vAuto inventory feed writes here (DealerVault doesn't; see Phase 0 item 1). Only the AI's dev seed adds customer-owned cars. |
| Inventory API | Platform `GET /api/car` | Filters by dealer, make, model, year, `car_type` (new / used), body type, price range, miles range, and more. Maps prices from `internetreduced` / `instoreprice`. |
| Inventory tool | `agentic-upsell/src/upsell_agent/tools/inventory_tool.py` | A stub. Its docstring already asks for raw rows, so every mention can be traced back to a VIN. |
| Grounding nodes | `agent/nodes/recommend.py`, `agent/nodes/verify_grounding.py` | Stubs from the original design, not in the graph. |

## Principles

1. **Stock facts come from records, never from the model.** Every vehicle the AI mentions is a record loaded in code for this turn, with its VIN. Anything the model says about a vehicle that isn't in that record is removed or the draft is rejected, never "corrected".
2. **Fresh or silent.** A vehicle is mentioned only if it was in stock when the turn loaded it, and it is re-checked before anything is sent later (the 24h channel switch).
3. **Prices stay restricted for direct questions.** Inventory answers say what's there, not what it costs. **Decided 26 Sept:** a narrow exception for follow-up touches only — see Phase 0 item 3.
4. **Stock is looked up in code, not by the model calling functions.** Like Plan 2's answer sources: loaded in code and put into the context pack, so the reply stays within the time budget and every value is traceable.
5. **Every phase ships its own tests and scenarios**, and Plan 1 and Plan 2's tests, scenarios, e2e and burst test keep passing.

---

## Phase overview

| # | Phase | You can see it when |
|---|---|---|
| 0 | Decisions | The answers are written into architecture.md |
| 1 | Inventory read layer | The Debug UI shows the stock records a turn loaded, each with its VIN |
| 2 | Shopping criteria | "White SUV under 30k" becomes structured search criteria from the profile and the message |
| 3 | Answering stock questions | "Do you have a RAV4?" is answered from real stock; with none, the reply is never a bare "no" — it always offers the closest alternatives or a promise to check |
| 4 | Grounding check | A draft that names a car or a detail not in the loaded records is rejected |
| 5 | Freshness | A car sold since the message was written is never mentioned in a later send |
| 6 | Debug UI and dev inventory | Seeded stock per dev dealer, and an Inventory panel per turn |
| 7 | Evals, shadow and rollout | Inventory evals pass on the real models, and shadow review shows no wrong vehicle facts |

---

## Phase 0: Decisions

1. **What counts as in stock. Half resolved 26 Sept; interim call made 27 Sept.**
   - The "`vehicles` mixes dealer stock with DMS-history customer cars" premise is wrong in production: DealerVault never writes to `vehicles` (its own READMEs say so), so the only writer is the vAuto CSV import (`aidmvcs-be-dev/app/lib/import.js`). There's no customer-car contamination to filter out.
   - **Still open, and this is the real question:** whether a specific `vehicles` record, from that feed, is still in stock or already sold. The import only sets `salestatus` when the feed happens to send a `saleStatus` column; there's no confirmed answer for what happens to a record once its car sells (removed from the next feed run, left in place, or flagged). **Needs one real dealer's data to answer.**
   - **Interim decision (27 Sept):** assume every record `/api/car` returns is in stock. No sold/available filter exists to apply, so none is applied for now. **Known gap this leaves open:** a sold vehicle can be mentioned to a customer until this is resolved. Phase 1's tests and Phase 5's before-send re-check are written against this same limitation — see the notes on both phases below. This is not a permanent decision; it's what lets Phase 1 be built while item 1 above is still being answered.
   - **Where "sold" will come from (27 Sept):** the manager outcome added in C5 ("Sold pending" / "Sold delivered"). Once that ships, it marks the vehicle as no longer in stock, and Phase 5's re-checks use it. Until then every vehicle counts as in stock.
2. **Source of truth for reads. Decided 26 Sept, overriding "Suggested: Option B" below.**
   - **Option A — use this:** the platform's `GET /api/car`. `inventory_tool.py`'s own docstring (written in Plan 1, before this plan existed) already states this intent: *"Calls the existing `/api/car` endpoint... rather than re-querying Vehicle documents directly — one source of truth for 'what's actually in stock.'"* No direct-query code has ever been shipped — the function is `raise NotImplementedError`.
   - ~~Option B: a dealer-scoped, read-only query of `vehicles`, like Customer 360. Faster, but duplicates the field mapping. Suggested for speed.~~ Not used. Nothing built it, and it would duplicate `/api/car`'s field mapping for no confirmed benefit.
   - **Open question this creates:** `/api/car` has real defects today (no dealer-id enforcement, no in-stock filter, a cost/invoice data leak through `facets`, broken sort/year/location filters, unescaped regex input). Two of these affected Phase 1 directly, and both are handled without touching the route: no in-stock filter (the interim decision above) and the broken year filter (the workaround below).
   - **Year filter — worked around at the call site, no route change needed (27 Sept).** `route.js`'s `year` parameter builds a regex against a field stored as a number, so it never matches. The same route's `year_range` parameter is unaffected — it builds a proper `{ $gte, $lte }` numeric query and runs after the broken `year` block, overwriting it. `inventory_tool.py` should always pass `year_range=<Y>-<Y>` for an exact year (or `year_range=<Y-1>-<Y+1>` for Phase 2's "year ±1" loosening), never the bare `year` parameter. This route is Prashanth's, not Ammer's, so per the "no edits to non-Ammer code" rule it isn't touched — this workaround needs no code change to `route.js` at all.
3. **Prices. Decided 26 Sept (architecture.md decision 14).**
   - A direct price/payment/financing/discount/approval question stays restricted ("the team will confirm pricing"), as Plan 2 already ships.
   - **Client exception, follow-up touches only:** a *verified* price drop or OEM price change on a vehicle already loaded this turn may be used as a Day 8–90 outreach angle (`docs/data/pdf_dump.txt`, follow-up PDF cadence table; `docs/client/autpulse.workflowblueprint.png`, "INVENTORY FEED INTEGRATION"). Never invented, never in answer to a direct pricing question.
   - **Design task (not a client question):** the guard currently blocks any price mention outright (`guardrails/draft_guard.py`). It needs a narrow exception: a price figure is allowed only when it matches the loaded record's price field *and* the turn is a Day 8–90 follow-up, not a live-conversation answer. It needs its own tests so it can't be used to sneak a price into an ordinary reply.
   - **Deferred (27 Sept):** Day 8–90 follow-ups don't exist until Part C's C4 ships, so this exception is built after C4, not with the rest of Part A. See the build order at the top.
4. **Links. Decided 26 Sept (architecture.md decision 15), overriding the line below.**
   - ~~SMS: none (Plan 1 rule).~~ **Client override:** the first quality response to a vehicle-specific lead includes a vehicle link and image, when both are verified available; link only if no image; image only if no clean link; otherwise personalize around intent instead of a vehicle (`docs/client/autpulse.workflowblueprint.png`, "6. FIRST QUALITY RESPONSE RULE" and "A. NO-RESPONSE CADENCE" Day 1 Touch 1).
   - Email: the vehicle's page on the dealer site, if the record has one. (Unchanged — the client didn't ask for a change here.)
   - **Open question:** the live SMS Compose prompt (`agent/llm.py:166`) still says "no links" and needs updating once this phase is built, so the two documents don't disagree in the meantime.
5. **How many vehicles per reply. Decided (architecture.md decision 16), unaffected by the 26 Sept client review.**
   - SMS: at most 2 named, from at most 3 loaded (the existing n8n SMS v8 rule).
   - Email: at most 3.
6. **Feed freshness. Decided 27 Sept: no age limit.** A record is not dropped for how long ago it was imported. (A 3-day limit was our own default from 26 Sept, never a client rule; removed.) Whether a vehicle may be mentioned depends only on it being in stock (item 1). The blueprint's "Always verify vehicle is active & available before sending media" is Phase 5's before-send re-check.
7. **Photos. Decided 26 Sept, overriding the line below.**
   - ~~Not in this plan (SMS stays text-only).~~ **Client override:** item 4 above requires sending an actual vehicle image in SMS when no clean link is available, not just a link. This is a real vehicle photo (MMS), not text.
   - **Corrected 27 Sept:** the real Twilio driver is built and live-capable (`channels/twilio.py`, wired via `CHANNEL_DRIVER=live` in `channels/live.py`/`config.py`; the rollout runbook already lists it as a go-live item). It is text-only: `TwilioSmsDriver.send()` posts `To`/`From`/`Body` to Twilio's Messages API and never sets `MediaUrl`.
   - **Decided 27 Sept (architecture.md decision 21): MMS through Twilio.** `channels/twilio.py` gains `MediaUrl` support (and `channels/fake.py` the same), sending the vehicle's own `imagesSecure` URL, no re-hosting. Before sending, code checks the image URL is public and under the carrier size limit (about 5 MB); if not, the message falls back per item 4's order (link only, then no vehicle). Never an unrelated or stand-in photo. Still to do before it's live: a cost review (an MMS costs roughly 3× an SMS). No dependency on Part B or C.

Write the answers into architecture.md.

---

## Phase 1: Inventory read layer

1. **Implement `tools/inventory_tool.py`** as decided in Phase 0:
   - `search_inventory(dealer_id, criteria, limit)` returns raw records, calling `/api/car` with `year_range` (never the broken `year` parameter — see Phase 0 item 2);
   - `get_vehicle(dealer_id, vin)` is used for re-checks.
   It is dealer-scoped and read-only. **It does not apply an in-stock rule yet** — Phase 0 item 1's interim decision (27 Sept) is to treat every returned record as in stock, until real feed data settles what "sold" looks like.
2. **A typed view** of each record, all from `/api/car`'s response: VIN, year, make, model, trim, body type, new/used, exterior colour, miles, and the page link if allowed. No stock number (the client didn't ask for one) and no import time (no freshness rule, Phase 0 item 6). The price is loaded only if Phase 0 allows it.
3. **Short cache** (e.g. 60 s per dealer + criteria), so a burst of campaign replies doesn't query the same stock 300 times.
4. **Inventory layer in the context pack:**
   - `inventory`: the records loaded this turn, with each record's `source_id` (the VIN);
   - `inventory_query`: the criteria used;
   - `inventory_checked_at`: when it was loaded.
5. **Trace:** Load context shows the query, how many records matched, and which were given to the AI.

**Tests:**
- Old records are still loaded (no age limit, Phase 0 item 6). (No in-stock-rule test — there isn't one yet; see Phase 0 item 1's interim decision.)
- Dealer scoping (no cross-dealer read).
- The cache.
- The typed view.
- The `year_range` workaround: an exact-year search returns correct results; confirm the bare `year` parameter is never sent.

**Scenario:** `p1_inventory_loaded.yaml`. A sales lead for a used SUV; Load context shows matching seeded stock.

**Done when:** a turn's loaded stock is visible in the Debug UI, and a parity check against `/api/car` passes for the dev dealers.

---

## Phase 2: Shopping criteria

> **Readiness review, 27 Sept:** the phase text below was checked against the running code (not re-read from the plan alone) before building, the same way Phase 0/1's `/api/car` defects were checked. Three decisions came out of that review and are recorded here; nothing below is a guess made during implementation.

1. **Where the search runs — decided 27 Sept, changes Phase 1's wiring.** `load_context` is the graph's entry point (`agent/graph.py`), running *before* `extract`/`validate`. Phase 1's search lives inside `load_context` and can only ever see the profile as it stood *before* this turn's message was read — that's why Phase 1's own scenario needs a second turn before stock shows up. Phase 2 needs "the current message" and "the customer asked about stock" as search triggers, and neither exists yet at `load_context` time.
   - **Decided:** a new graph node, **`search_stock`**, runs *after* `validate` (`load_context → extract → validate → search_stock → decide → compose → …`). It builds criteria from `state.profile` (already this turn's validated profile — the same value `compose_context()` in `agent/nodes/compose.py` already re-reads for the same reason) and from Extract's question labels (item 6 below), then patches `inventory` / `inventory_query` / `inventory_checked_at` onto `state.context_pack`, the same way `compose_context()` already patches `profile` onto it — no change to the `ContextPack` Pydantic model itself.
   - **Phase 1's `load_context`-time search is removed, not duplicated.** One search per turn, using the most current information, not two.
   - **Side benefit:** this also removes the "search only starts on turn 2" limitation noted in Phase 1's progress doc — Extract already runs on turn 1 (the lead-form text), so `search_stock` finds stock from turn 1 too.
2. **Criteria from what we know**, built in code:
   - the profile: desired model, new or used, budget, monthly payment (all available via `state.profile` post-validate, per item 1);
   - the current message: colour, body type, "under 30k" (a budget cap, parsed like the existing money patterns in `agent/offline_model.py`).
   - **"Something bigger" — decided 27 Sept, our own default, flagged for client feedback.** No size ordering of body types exists anywhere in the schema or the client's documents, so one is defined here rather than guessed during implementation:

     | Tier | Body types |
     |---|---|
     | 1 — smallest | Coupe, Convertible, Hatchback |
     | 2 — compact family car | Sedan, Wagon |
     | 3 — more room | SUV |
     | 4 — largest | Minivan, Van, Truck |

     "Something bigger" moves the search up one tier from whatever body type the customer was already looking at; if that tier has nothing, it moves up again, the same idea as the colour/trim/year loosening chain. Uses the 9 body types `tools/inventory_tool.py`'s `BODY_WORDS` already recognises (Phase 1). Not a client requirement — ordinary common sense, like the plan's other "our default" items (e.g. decisions 26, 28, 30 in `architecture.md`).
   New criteria slots are added to the slot schema (`interest.body_type`, `interest.color`) as **extractable, not required** — confirmed against `slots/requirements.py`, where "required" is a separate opt-in list per lead type, so adding these to `slots/schema.py` alone does not make Decide start asking about them; they're only captured when a customer mentions them. The real model's Extract already reads `allowed_slots` straight from the schema (`agent/nodes/extract.py`); only the offline test model needs hand-written extraction added (`agent/offline_model.py`), the same pattern as the existing `new_or_used` parsing.
3. **Search when it helps.** Stock is loaded when:
   - the customer asks about stock — see item 6 below for how that's detected in this phase;
   - or the profile has enough to search (at least a model, or a body type + new/used).
   Otherwise the turn doesn't search, which saves time and cost.
4. **Loosening.** No exact match loosens the search in a fixed order and records what was loosened:
   1. colour — a real `/api/car` parameter (`exterior_color`), sent case-corrected (item 5).
   2. trim — **not a `/api/car` parameter at all.** Checked directly against `aidmvcs-be-dev/app/api/car/route.js`: the route returns each vehicle's `trim` in the response, but has no query parameter for it (no `searchParams.get('trim')` anywhere in the file) — unlike colour, year and body type, which the route does let us filter by. So "loosen trim" can't be done by changing the request, the way the other three steps are. **Decided 27 Sept:** trim is filtered on our side, in code, after the broader make/model/condition search comes back — fetch once without a trim filter, then check each returned record's own `trim` field; "loosen trim" means stop checking it. This is a different code path from the other three loosening steps, not a variation on the same one.
   3. year ±1 — Phase 1's existing `year_range` mechanism, just widened.
   4. the same body type from another make — drop `make`, keep `body_type`.
   5. new or used — **decided 28 Sept, added after the Debug UI review found a gap:** "anything bigger?" on a new RAV4, with nothing new in the next size tier, returned nothing rather than offering a used one. Last in the order, so it's tried only once everything else has been loosened. **Our default**, flagged for client feedback.
   Compose can then say "not in white, but we have it in silver".
5. **Colour matching — decided 27 Sept.** `route.js` matches `make`/`model`/`body_type`/`car_type` case-insensitively (`createCaseInsensitiveFilters`, a `^value$/i` regex), but `exterior_color` is a **literal, case-sensitive** `$in` match — confirmed by reading the route directly. A colour sent as the customer said it ("white") can silently match nothing against a stored "White". **No fixed casing is assumed.** Before sending a colour, the tool reads the dealer's own distinct colour values from their stock, matches the customer's word against that list case-insensitively, and sends back whatever casing is actually stored for that dealer — never a guessed convention.
6. **"Restricted" vs. "answerable" for stock questions — decided 27 Sept, changed from the original wording below.**
   - ~~Stock is loaded when the customer asks about stock (Plan 2's `answerable` label now covers stock questions)~~. Checked against the code: `agent/llm.py`'s `QUESTION_LABELS` prompt text and `agent/offline_model.py`'s `_RESTRICTED` regex both currently treat stock-availability wording ("in stock", "available", "still there", "do you have") as the *same* concern as price/financing/discount/approval wording, in one merged rule. Flipping stock questions to `answerable` requires splitting that rule apart regardless of anything else, since pricing questions must stay `restricted`.
   - Checked whether flipping the label early (before Phase 3 exists to actually answer from stock) is safe: it is — `slots/policy.py` routes *every* non-`clarify` question to the same `answer` action regardless of label, and the offline model's `_answers()` already falls back to "the team will confirm" for any `answerable` question it doesn't specifically know how to answer (today, that's true of stock questions). So relabelling alone wouldn't produce a wrong answer, just an unchanged one.
   - **Decided:** split the detection now — separate the stock-availability wording from the price/financing wording, as two distinct, separately testable rules instead of one merged regex/prompt clause. **Keep stock questions labelled `restricted` until Phase 3**, which flips the label in the same change that adds the real "answer from loaded stock" logic. This avoids a label in the Debug UI/evals that claims more than the system can currently do.
7. **Budget handling.** The budget can filter the search (the price is used, not said) as long as Phase 0 keeps prices restricted. **Already safe by construction:** `InventoryRecord` has no price field (Phase 1), and `inventory_query` — which would carry the raw budget number — is already in `HELD_FROM_MODELS` (`agent/context_pack.py`), so it never reaches the model even indirectly via the trace. The reply never states or implies a price.

**Tests:**
- Criteria building from the profile + message, table-driven.
- The search-or-not rule.
- The loosening order and its record, including the trim step's client-side filter.
- Colour case-correction against a dealer's real stock values.
- `search_stock` uses this turn's validated profile, not the one `load_context` saw (a value changed by this turn's message is reflected the same turn).
- The stock/price detection split: a stock-availability question is no longer caught by the same rule as a price question, but both still route as `restricted` in this phase.

**Scenario:** `p2_loosened_search.yaml`. "White RAV4" with only a silver one in stock; the trace shows colour loosened.

---

## Phase 3: Answering stock questions

0. **Relabel stock questions `answerable`.** Phase 2 split the stock-availability wording out of the price/financing detection rule but deliberately left it marked `restricted` (Phase 2 item 6), since nothing could yet answer it. This phase is what the label change is waiting for: flip stock-availability questions to `answerable` in the same change as item 1 below, so the label and the real behaviour ship together.
1. **Decide:** a stock question with loaded results is answered by the `answer` rule, using the inventory layer. With no exact match, the reply is never a bare "not available" — the client's blueprint requires an alternative offered alongside it (`docs/client/autpulse.workflowblueprint.png`, "VEHICLE TYPE OVERRIDE RULE" / inventory guidance). Order:
   - Phase 2's loosened search found something close (different colour, trim, year, or the same body type from another make): offer that instead ("Not in white, but we have it in silver — want details?").
   - Nothing close either: name the closest thing on the lot if one exists, otherwise say the team will check and add it to `promises` ("I don't have one in stock right now, but I can have the team let you know the moment one comes in").
   - The bare "we don't have that, no alternative offered" reply is a guard failure, not an acceptable outcome.
2. **Compose rules:**
   - Mention only vehicles from `inventory`.
   - Describe them only with their record's fields.
   - Keep to Phase 0's per-channel count.
   - Put each mentioned VIN in a structured output field (`mentioned_vins`), not only in the text.
3. **Conversation state:**
   - The vehicles mentioned are recorded (`shown_vehicles`), so the next turns don't repeat them.
   - "The second one" / "the silver one" can be resolved against them (Plan 2 Phase 4's short replies).
   - Interest in a shown vehicle fills `interest.model` with its details and source VIN.
4. **Still restricted:** holding a vehicle, price, discounts, payments, trade-in value and booking a test drive. These get "the team will confirm", as today.

**Tests:**
- Answer with results, answer with none.
- `mentioned_vins` present.
- A second reference resolved.
- Shown vehicles not repeated.

**Scenarios:**
- `p3_do_you_have.yaml`: a yes answer naming a real seeded vehicle.
- `p3_none_in_stock.yaml`: no exact or close match — the reply offers the closest alternative or records a promise to check, never a bare no.

---

## Phase 4: Grounding check

The existing stubs (`agent/nodes/verify_grounding.py`, `guardrails/output_validation.py`) become real, as part of the guard:

1. Every VIN in `mentioned_vins` must be in this turn's `inventory`. Otherwise the draft is rejected.
2. Every vehicle-like mention in the text (year, make, model, trim, colour, miles) must match one of the mentioned records. A made-up trim or colour is rejected.
3. The text must not mention a vehicle that isn't in `mentioned_vins`.
4. Prices and payments are still blocked by the existing never-invent rules.
5. A rejection uses the normal path: one rewrite with the guard's feedback, then the template and a staff flag.
6. **Metric:** grounding rejections per turn, on the Metrics tab and in the rollout check. Target 0 after the rewrite.

**Tests:** each rejection rule, a valid multi-vehicle draft passing, and the rewrite path.

**Scenario:** `p4_invented_trim.yaml`. With the offline model's new `#badtrim` test tag (offline only), the guard rejects the draft and the rewrite passes.

---

## Phase 5: Freshness

**Depends on Phase 0 item 1 being resolved.** Everything below assumes `get_vehicle` can tell a sold car from an available one. Until real feed data answers that, this phase's re-checks have nothing to check against — they'll pass every vehicle as fine, the same way Phase 1 currently assumes all-in-stock. This phase can be built now, but its actual safety guarantee (rollout's "sold vehicle mentioned: must be 0") doesn't hold until Phase 0 item 1 is answered.

1. **Before the send:** if the turn took long, the mentioned VINs are re-checked with `get_vehicle` right before sending. A vehicle that sold in the meantime rejects the draft (rewrite without it).
2. **24h channel switch:** the saved follow-up keeps its `mentioned_vins`. At fire time each is re-checked. If any sold, the stock-free version of the message is sent instead: Compose writes one alongside, the same way it already writes an SMS and an email version.
3. ~~**Old records:** anything past Phase 0's freshness limit is never loaded.~~ Removed 27 Sept: no age limit (Phase 0 item 6).
4. **Metric:** "sold vehicle mentioned". Must be 0 in the rollout check.

**Tests:** sold before the send, sold before the follow-up (the stock-free version is sent), and old records ignored.

**Scenario:** `p5_sold_before_followup.yaml`. A vehicle is marked sold, then the clock is advanced 24h; the stock-free version goes out.

---

## Phase 6: Debug UI and dev inventory

1. **Dev inventory seed:** 20–40 realistic vehicles per dev dealer, both new and used, several colours and body types. A couple are marked sold only once Phase 0 item 1 settles how "sold" looks (until then there's no in-stock rule to show). Clearly separate from the dev DMS-history vehicles.
2. **Inventory panel** in the turn inspector:
   - the query;
   - the loosening steps;
   - the records loaded;
   - which VINs the draft mentioned;
   - the grounding result per vehicle.
3. **A simulator shortcut** to mark a vehicle sold, for testing freshness by hand.
4. **Offline model:** answers stock questions from the inventory layer by simple rules, and `#badtrim` exercises the grounding check.

---

## Phase 7: Evals, shadow and rollout

1. **Evals:**
   - answers only name loaded vehicles;
   - no invented trims, colours or miles;
   - "no stock" always comes with an alternative or a promise, never a bare no;
   - no prices;
   - short references resolve;
   - the SMS count limit holds.
2. **Promptfoo:** injection through vehicle descriptions (dealer feed text is data, never instructions).
3. **Real-model run** of the eval gate, with pass rates and cost per turn recorded.
4. **Shadow review:** during a dealer's shadow week, the Shadow tab marks each stock answer right / wrong vehicle fact / should have said no.
5. **Rollout check** adds grounding rejections, sold-vehicle mentions (0) and the inventory query p95 time.

**Done when:** one dealer has been live with inventory answers for a week, with zero wrong vehicle facts and zero sold-vehicle mentions.

---

# Part B: Client requests (25 September 2026)

## What the client asked for

| # | Client's words (short) | In plain terms | Built today? |
|---|---|---|---|
| 1 | "If a lead comes in after hours, send a confirmation with the option to connect now or during business hours." | A lead at 11pm gets a first message that lets the customer choose: carry on now, or be contacted when the dealership opens. | **No.** The first reply goes out straight away at any hour and offers no choice. The 8:00–20:00 window covers only follow-ups the AI sends on its own ([scheduler/contact_window.py](../../../scheduler/contact_window.py)). |
| 2 | "Dealer Vault contacts, drip service or sales equity campaigns need the TCPA US rules strictly enforced. That is outbound, where a lead is inbound." | Contacting people who didn't just reach out (old DMS contacts, drips, equity campaigns) is marketing. It needs consent, quiet hours in the **customer's** time, opt-out and do-not-call handling. | **Partly.** The AI sends no campaigns (the platform does) and keeps its own follow-ups to 8:00–20:00 **dealer** time. Nothing tells inbound and outbound apart, checks consent or uses the customer's time zone. In the platform, only appointment reminders have quiet hours ([appointmentReminderService.js](../../../../../../aidmvcs-be-dev/app/lib/appointmentReminderService.js), 9:00–20:00 dealer time). |
| 3 | "The main goals are always qualifying the customer and using their responses to schedule an APPOINTMENT. Don't escalate every customer; strike while the iron is hot." | The conversation should end with a booked visit, not a handoff to staff. | **No.** Booking was out of scope in Plans 1 and 2. A qualified lead is passed to staff, and Compose is told never to say a visit is booked ([agent/llm.py](../../../agent/llm.py)). |

## What already exists

| Piece | Where | State |
|---|---|---|
| Bookings | Platform `Booking` model and `POST`/`PUT /api/booking` | Creates a booking (`pending` / `confirmed` / `cancelled` / `completed`), sets the lead to "Appointment Booked", sends a confirmation on the lead's last channel, and creates reminders. Used by staff and by the platform's public customer booking page; no login needed. The AI uses it as is (B5). |
| Dealer calendar | Platform `dealer/booking` (LeadCalendar) | Staff see bookings here. |
| Reminders | Platform `appointmentReminderService.js` | Its own quiet hours, 9:00–20:00 dealer time. Can be switched off per dealer on the dealer's Settings → Reminder settings page (see C5). |
| SMS consent | Platform `Customer.phones[].sms_opt_in` | A yes/no flag per phone. Set to true only when that customer texts the dealer (`worker/processSms.js:339`); the phone entry keeps its `source` and `added_at`. Nothing else sets it (not lead forms, not DealerVault). Counted as consent from 27 Sept (B0.4). |
| Staff status pauses the AI | Platform `lib/ai/aiStaff.js` (`notifyAiOfStaffStatus`) | Staff moving a lead to "Appointment Booked", "Visited", "Sold", "DND" or "Managerial Review" pauses the AI. Only called from the staff status route (`api/conversations/lead/status/route.js:747`), **not** from `POST /api/booking` — so a booking made through that endpoint doesn't pause the AI (checked 27 Sept). |
| Business hours, dealer time zone, dates | Plan 2: `integrations/dealer_profile.py`, `slots/dates.py`, `scheduler/contact_window.py` | Ready to reuse for "are we open?", offering times, and reading "Saturday at 10". |
| Campaigns | Platform `Campaign` model, `api/cron/campaigns`, `worker/campaignWorker.js` | One kind only (checked 27 Sept): a dealer writes one email or SMS, picks a list of leads and a date/time; at that time the cron queues one job per lead and the worker sends them. No type field, no drip or equity campaigns, nothing inbound. No compliance check before sending. |

## Principles

1. **The visit is the goal.** Every qualified or partly qualified lead gets a visit offer before anything is passed to staff. A handoff is for when the customer needs a person, not a default ending.
2. **Compliance is code, not prompt.** One send check decides "send now / wait until / blocked", with the reason recorded, for every message the AI or a campaign sends. The model is never asked whether a message is legal.
3. **When unsure, treat it as outbound.** An unknown origin, unknown consent or unknown time zone gets the strictest rule.
4. **Never claim a booking that doesn't exist.** "You're booked" is said only when the booking record was created in this turn.
5. Plan 2's rules still hold (never silent, plain words, all tests and scenarios keep passing), **except the question limit: at most 2 questions per message, not 1 (decided 27 Sept, architecture.md decision 35).** Plan 2's one-question rule was our own design, not a client rule. This changes Plan 2 code: Decide may give Compose up to 2 asks (`slots/policy.py`), and Compose's instructions and style guide say "at most two questions" (`agent/llm.py`). Built as a small change of its own before Part B's phases, with Plan 2's tests updated to match.

## Phase overview

| # | Phase | You can see it when |
|---|---|---|
| B0 | Decisions | The answers are written into architecture.md, with counsel's sign-off on B0.2–B0.6 |
| B1 | After-hours first reply | A lead at 23:00 dealer time gets "chat now or during business hours?", and each answer leads to the right path (the choice itself is about the dealer's hours; the customer-local send window from B0.5/B3 governs when the reply can actually go out) |
| B2 | Inbound or outbound | Every lead and message shows its origin in the Debug UI, and unknown means outbound |
| B3 | Send check (US rules) | An outbound SMS with no consent is blocked; one due at 7:30 customer time waits until it's both 8:00 customer time and the dealer is open; each shows its reason |
| B4 | The visit as the goal | A qualified lead is offered a visit instead of being handed to staff; handoffs drop |
| B5 | Booking the visit | "Saturday at 10 works" creates a booking in the dealer's calendar, and the customer gets a confirmation |
| B6 | Debug UI, evals and rollout | Evals for booking and compliance pass on the real models, and the rollout check tracks booking rate and blocked sends |

**Order (27 Sept):** Part B no longer goes first; see the build order at the top of this plan. B2 and B3 are built as part of C1's compliance engine, and B1 follows it.

---

## Phase B0: Decisions

1. **What "after hours" means.** Suggested: outside the dealer's opening hours (`weekly_availability`, otherwise Monday–Saturday 9:00–18:00), not the 8:00–20:00 contact window. A lead at 19:00 is after hours but can still be texted.
2. **The first reply to an inbound lead at night.** The customer just asked to be contacted, but it's still a text at night. Options:
   - **A:** reply by SMS at any hour (fastest; today's behaviour);
   - **B:** at night (20:00–8:00 customer time), reply by email if we have one, and hold the SMS until 8:00;
   - **C:** reply by SMS at night only if the lead arrived in the last few minutes (the customer is waiting for it).
   ~~**Suggested:** C, with B as the fallback.~~ **Decided 27 Sept (architecture.md decision 29), our default, flagged for client feedback:** the same rule as item 8 — the customer wrote first, so one reply (answering them and offering the after-hours choice) goes out right away at any hour. The conversation continues right away only inside 8:00–21:00 customer-local time; outside it, it resumes at the next 8:00 customer time, and the customer is told so. This follows the blueprint's "AI acknowledges and continues the conversation immediately (**if within TCPA allowed hours**)" (box 0, "CUSTOMER WANTS HELP NOW"). **Counsel to confirm.**
3. **What counts as outbound.** A list of lead sources and campaign types, e.g.
   - outbound: Dealer Vault / DMS imports, sales equity, drips, service reminders sent as marketing, re-engagement;
   - inbound: website forms, third-party lead providers, phone-ups, a customer writing first.
   Needs the platform's real `Lead.source` values. **No campaign type (27 Sept):** the platform has one kind of campaign, always dealer-initiated, so every campaign counts as outbound (B2).
4. **Consent. Decided 27 Sept (architecture.md decision 36).** A marketing text the business starts (AI follow-ups, platform campaigns) needs consent. Replies to a message the customer just sent never do. Email needs none (unsubscribe link and the dealer's postal address, CAN-SPAM). Checked in this order:
   1. **An explicit "no" wins:** STOP / unsubscribe; the platform phone marked `sms_opt_in: false`; or the lead form saying the customer didn't opt in (e.g. `TCPAOptIn: false`). No marketing text, including follow-ups on their inquiry (agreed 27 Sept). Their first reply still goes out, since it's a reply.
   2. **The platform's opt-in flag counts as consent.** The platform sets `sms_opt_in: true` on a phone when that customer texts the dealer (`lib/customerResolver.js`, `worker/processSms.js:339`), and the phone entry records its `source` and `added_at`.
   3. **Consent from the lead form.** Some lead providers send it inside the lead's comments: the AutoTrader sample has `TCPAOptIn: true|false;` (`aidmvcs-be-dev/autotrader_lead.json`). Read in the AI service from the lead text, no platform change. Only AutoTrader's format is known; others are added as real leads show them (a report lists providers whose leads carry no readable consent).
   4. **The customer's own inquiry is consent to follow up on that inquiry.** A lead they submitted, or a message they sent us, allows the AI's follow-ups about what they asked (C4's cadence, visit offers, booking messages) until that opportunity closes (Day 91). It doesn't cover unrelated marketing, such as a platform campaign. **Counsel to confirm.**
   5. **Asking by email.** A contact with no text consent (e.g. a DealerVault import) can get one email: "Want updates by text? Reply YES." A YES reply is saved as consent. Asked once per contact per dealer, never repeated if unanswered (agreed 27 Sept).
   6. Otherwise: no marketing text; email only.

   Each consent is saved in the AI service's own record (`ai_consent`, already used for STOP/START) with its source, time and the evidence (the flag's source, the quoted lead-form line, the lead or message id, or the YES email's id). Changes Plan 1's rule in `channels/consent.py`, where an unset flag currently allows texting.
5. **Customer time zone. Window decided 26 Sept (architecture.md decision 18); lookup method decided 27 Sept (decision 23).**
   - **Client decision, overrides the "both" rule below:** outbound SMS only when it's 8:00–21:00 in the **customer's** own local time (`docs/client/autpulse.workflowblueprint.png`, "0. AFTER-HOURS & TCPA COMPLIANCE RULE"; `docs/data/pdf_dump.txt`, TCPA PDF p.2 "Hours" and p.4 §7). This replaces the dealer-time 8:00–20:00 rule Plan 2 shipped (`scheduler/contact_window.py`).
   - **Time zone lookup — decided 27 Sept (architecture.md decision 23):**
     1. **ZIP code, else state.** The platform `Customer` record has no address field. ZIP and State exist on the customer's DealerVault sales and service rows (`worker/dealervault/common/salesFields.js`, `serviceFields.js`, linked by `customer_id`), and on a lead form when the form collects them. So DMS/DealerVault contacts (the outbound ones) usually have one; web leads may not.
     2. **Else the phone's area code.** Less reliable: people keep their number when they move.
     3. **Else (our default, flagged for client feedback):** only the hours that are legal in every continental US time zone at once (11:00–20:00 Eastern = 8:00–17:00 Pacific under the default 8:00–20:00 window of B0.6). Never the dealer's time zone alone.
     The zone and how it was found are saved on the lead.
   - **Dealer hours for outbound — decided 27 Sept (architecture.md decision 24), resolving the old open question:** a message the system starts (follow-ups, campaigns, the 24h channel switch, the handoff-timeout reply) must fall inside **both** the dealer's opening hours (`weekly_availability`, else Monday–Saturday 9:00–18:00) **and** the customer-local window. A reply to a message the customer just sent is exempt from the dealer-hours check. Sources: blueprint box "7. BUSINESS HOURS RULE" ("If outside business hours → send at opening next day… **All other touches follow business hours unless customer replies**"); blueprint box 0 ("This check happens BEFORE any outreach"); Omnichannel PDF p.1 (every automated send stays subject to "dealer schedule, time-window" guardrails).
6. **State rules.** Some states are stricter than the federal TCPA; for example, Florida and Oklahoma limit marketing texts to 8:00–20:00 and to 3 per 24 hours on the same subject. **Counsel provides the state table**; code applies it by the customer's state. **Still open** — no table has been provided.
   - **Who they apply to:** the customer's (recipient's) state, not the dealer's. They cover marketing / solicitation messages the business starts, not replies to a message the customer sent. Some state laws also treat a phone with that state's area code as a resident, so when the ZIP state and the area-code state differ, the stricter of the two applies.
   - **Interim decision 27 Sept (architecture.md decision 25):** until the table arrives, the strictest known state rule is applied to **every** customer, whatever their state: marketing SMS only 8:00–20:00 customer-local time, and at most 3 marketing messages per customer per 24 hours, counted across the AI and campaigns. This is tighter than the client's 8:00–21:00 (decision 18); the stricter one wins until the table says otherwise. **A state rules table from counsel is required to apply state rules properly** (and to loosen states that allow more). Other state rules we don't have reliable details on (e.g. Sunday or holiday limits) aren't in the default; the table must cover them.
7. **Do-not-call.** An internal do-not-contact list per dealer (from STOP / unsubscribe, already kept by Plan 1), and whether numbers without consent are scrubbed against the national Do Not Call registry (a paid service).
8. **Replies inside an outbound conversation.** When a customer answers an equity campaign at 22:00, does our reply wait until 8:00? ~~**Suggested:** reply right away (the customer wrote first), but follow-ups keep the outbound rules.~~ **Decided 27 Sept (architecture.md decision 29), checked against the client's after-hours rule, flagged for client feedback:** the customer wrote first, so it isn't outreach (blueprint box 0 applies "BEFORE any outreach"; box 7 exempts touches where the customer replies). One reply answering them goes out right away at any hour. But the blueprint also says the AI "continues the conversation immediately (**if within TCPA allowed hours**)", so outside 8:00–21:00 customer-local time that reply tells them the team will pick it up at 8:00 and asks nothing more; the conversation resumes then. Follow-ups keep the outbound rules. **Counsel to confirm.**
9. **Visit types.** Sales visit / test drive, and service. **Suggested:** sales visits and test drives first. Service booking stays with the service team for now, because service scheduling usually lives in the DMS.
10. **Booking rules. Decided 27 Sept (architecture.md decision 30) as our defaults, per-dealer settings, flagged for client feedback** (no client document states any of these):
    - slot length: 30 minutes;
    - bookings per slot: 2;
    - earliest time offered: at least 2 hours from now, and inside opening hours;
    - last slot of the day: starts at least 30 minutes before closing;
    - how far ahead: 7 days.
11. **Confirmed or requested.** Does an AI booking go in as `confirmed`, or `pending` until staff confirm? **Decided 27 Sept (decision 30), our default, flagged for client feedback:** a per-dealer setting, `pending` by default. Pending: the customer hears "I've requested Saturday at 10:00; the team will confirm shortly."
12. **When to offer a visit.** Suggested:
    - as soon as we know what they want (the model or type) and roughly when; the rest of the questions can happen at the dealership;
    - or right away when the customer shows a buying signal ("can I come see it?", "test drive", "is it still there?").
13. **When to hand off. Decided 26 Sept (architecture.md decision 20): two more triggers added to the shipped pair below.**
    - Already shipped (`slots/policy.py`): the customer asks for a person; they are clearly upset (Plan 2's 0.8 rule).
    - Still suggested, unconfirmed by the client: they declined a visit and still have a question only staff can answer (price, trade-in value, finance) — see B4 item 4 for the updated decline count.
    - **Client addition:** escalate immediately when the customer indicates an urgent need (`docs/client/autpulse.workflowblueprint.png`, "7. ESCALATION RULES").
    - **Client addition:** when the customer explicitly requests a phone call, respond with a call within 5 business minutes (same source).
    - **Urgent need detection — decided 27 Sept (architecture.md decision 26).** Today, code judges almost nothing about a message's meaning: lead type is a regex on the lead source (`slots/requirements.py`), and the only keywords handled in code are STOP/START (`channels/consent.py`) and yes/no confirmations (`agent/nodes/validate.py`). Everything else is labelled by Extract, and code decides with a threshold (e.g. upset ≥ 0.8, `slots/policy.py`). Urgency follows the same pattern:
      1. Extract gets `urgent`, `urgent_confidence` and `urgent_reason`, one of: no transportation / car broke down; needs a vehicle within 48 hours; safety problem with the current car; a deadline elsewhere (another offer, lease ending). **Our default** list.
      2. Code hands off when `urgent` and confidence ≥ 0.8 (**our default**, the same bar as upset).
      3. Pure-code backstop: when the date resolver (`slots/dates.py`) puts `interest.needed_by` within 48 hours, the lead is urgent without asking the model.
      4. An eval set of about 20 "urgent vs. just eager" examples; a sample goes to the client to confirm where the line sits. **Flagged for client feedback.**
    - **The 5-minute callback — skipped for now (27 Sept, updating architecture.md decision 27):** it needs C2's staff call tasks, and C2 is skipped because it would need new platform backend and UI.

---

## Phase B1: After-hours first reply

1. **Detect:** a new inbound lead outside opening hours (B0.1), in the dealer's time zone. It's shown in the context pack's `now` layer as `open_now: false` with the next opening time.
2. **The first reply** answers what the customer wrote, and adds one choice instead of a question:
   "We're closed right now and open again at 9:00 tomorrow. I can help you here now, or the team can pick this up when we open. Which would you like?"
   On SMS at night it follows B0.2 (decided 27 Sept): the reply goes out right away, and outside 8:00–21:00 customer-local time "now" means the conversation resumes at 8:00 customer time, and the reply says so.
3. **Understanding the answer:** Extract gets a new field `contact_preference`: `now` / `later` / none. Short replies ("now", "tomorrow is fine", "morning") are read against the choice, like Plan 2's short replies.
4. **Paths:**
   - **Now:** the normal conversation carries on.
   - **Later:** a short thank-you, no more questions tonight, and a new follow-up kind `resume_at_opening` due at the next opening time. At opening, the team gets the lead with a summary, and the AI sends one message ("Good morning, the team is in now…"), within B3's rules.
   - **No answer:** the normal 24h follow-up, sent within B3's rules.
5. **Conversation state** records the choice, so it's never asked again for this lead.

**Tests:** after-hours detection per dealer time zone and hours; each path; the choice asked once; a `later` answer stops questions until opening.

**Scenarios:**
- `pb1_after_hours_now.yaml`: a lead at 23:00, the customer says "now", the conversation carries on.
- `pb1_after_hours_later.yaml`: the customer says "tomorrow", then the clock moves to 9:00 and the resume message goes out.

**Done when:** both scenarios pass, and a lead during opening hours gets no choice.

---

## Phase B2: Inbound or outbound

**Rewritten 27 Sept: no platform changes, no campaign type.** The client asked for strict rules on outbound contact and not on inbound leads (`conversation_2.md`; TCPA PDF §4 "Inbound vs. Outbound Classification"), so we still need to know which is which. We work it out in the AI service:

1. **Leads:** from `Lead.source`, which the AI already reads to set the lead type (`slots/requirements.py`). A B0.3 mapping table: DealerVault/DMS imports → outbound; website forms, third-party lead providers, phone-ups → inbound.
2. **Campaign replies:** every platform campaign is the dealer reaching out, so a conversation that started from a campaign (`agent/campaigns.py`, `find_campaign_context`) is outbound. **No campaign type is tracked:** the platform has only one kind of campaign (a dealer-written blast to a list of leads), no drip/equity types, and no inbound campaigns.
3. **Our own messages:** a reply to a customer's message vs. a message the AI starts (follow-ups), as the contact window already distinguishes.
4. The origin is saved in the AI's lead state and shown in the context pack. Missing or unknown means `outbound` (principle 3).
5. A report of lead sources the table couldn't map, for the client to classify.
6. **Purpose, not campaign type (27 Sept).** The client's TCPA spec asks for every outbound message to be classified by **purpose** (§4; checklist "Every outbound attempt has dealer/seller, purpose and channel classification"): marketing (sales, trade/equity, promotions, service-interval outreach from DMS data) vs. service/transactional (appointment confirmations, operational updates). So each send carries a purpose, set in code: AI follow-ups and every platform campaign → marketing; booking confirmations, C5's Y/N and countdown messages → transactional. `can_contact`'s `purpose` argument (C1) takes it.

**Tests:** the mapping table, the unknown default, and the origin travelling from platform to AI.

**Scenario:** `pb2_origin.yaml`: a website lead shows inbound, a Dealer Vault import shows outbound, a campaign reply shows outbound, and a lead with no source shows outbound.

---

## Phase B3: Send check (US rules)

One check, used by the AI sender and the AI follow-up scheduler. **The platform's campaign sender** is the one approved exception to the no-platform-changes rule (27 Sept), see item 7. The platform's appointment reminders keep their own 9:00–20:00 dealer-time rule (not changed).

1. **`may_send(customer, channel, origin, kind, at)`** returns `send`, `wait_until <time>` or `blocked <reason>`. Rules:
   - **Opt-out:** STOP / unsubscribe blocks everything except the opt-out confirmation (already in Plan 1; moved here).
   - **Consent:** a marketing SMS the business starts needs consent from one of B0.4's sources (opt-in flag, lead form, the customer's own inquiry for follow-ups on it, or a YES by email); otherwise it's blocked. An explicit "no" always blocks.
   - **Do-not-contact:** the dealer's list, and the national registry if B0.7 says so.
   - **Time of day:** 8:00–21:00 in the customer's local time (B0.5, decided 26 Sept), with state rules on top (B0.6) — until counsel's table arrives, that means 8:00–20:00 for every customer (B0.6 interim decision). **And** inside the dealer's opening hours for anything the system starts (B0.5, decided 27 Sept); replies to the customer are exempt from the dealer-hours part. Otherwise the send waits.
   - **Frequency:** per-state limits counted across the AI and campaigns. Interim (B0.6): at most 3 marketing messages per customer per 24 hours, everywhere, until the state table arrives.
   - **Email:** no time limit; an unsubscribe link and the dealer's postal address on marketing emails (CAN-SPAM).
2. **Customer time zone** is worked out in code (B0.5: ZIP/state, then area code, then the all-zones safe window) and saved on the lead, with how it was found.
3. **Consent record:** ~~the platform stores when, how and for which dealer consent was given, next to `sms_opt_in`. The lead forms and imports are updated to fill it.~~ **Decided 27 Sept (B0.4):** kept in the AI service's `ai_consent` record, filled from the platform's opt-in flag, the lead form's consent line, the customer's own inquiry and YES replies to the email ask. No platform change. The platform's campaign worker checks the same record (a campaign isn't a follow-up on an inquiry, so only the other sources count for it).
4. **Audit trail:** every decision is saved with its reason and the rule that applied, so a dealer can show why a message was or wasn't sent.
5. **Plan 2's contact window** (`scheduler/contact_window.py`) becomes part of this check.
6. **Metrics:** sends blocked or delayed, by reason. "Sent outside the allowed hours" must be 0.
7. **Platform campaigns (approved platform change, 27 Sept).** A campaign is scheduled in the dealer's form, then sent later one lead at a time by `worker/campaignWorker.js`. The check therefore runs in that worker, per lead (each lead has its own time zone), not when the manager clicks "Schedule". Changes:
   - **Backend (worker):** before each lead's send, ask the check. `send` → send; `wait_until` → re-queue that lead's job for that time; `blocked` → don't send, record the reason on the `CampaignLead`.
   - **Frontend (needed, small; approved 27 Sept):** today the campaign report only shows sent / delivered / failed. Held and blocked leads would otherwise show nothing, or wrongly as "failed". The report page (`dealer/campaigns/[id]/report/page.js`) gets "Held until <time>" and "Blocked: <reason>" counts and per-lead labels.
   - **Frontend (optional):** a note in the campaign form when the chosen time is outside the window for some leads ("12 leads can't be texted at this time; they'll receive it from 8:00 their time").
   - So a manager scheduling at the wrong time gets no error: the campaign runs, and leads outside the window are held and sent when allowed, which the report shows.

**Tests:** table-driven, one row per rule and state: each consent source (opt-in flag, `TCPAOptIn: true`, own inquiry, email YES), an explicit no (`TCPAOptIn: false`, `sms_opt_in: false`, STOP) beating every source, a campaign not covered by the inquiry rule, opt-out, a customer in another time zone, a frequency cap reached, email always allowed, and unknown data treated strictly.

**Scenarios:**
- `pb3_no_consent_blocked.yaml`: a platform campaign SMS to a DealerVault contact with no consent is blocked in the campaign worker, with the reason; the contact gets the one "want updates by text?" email instead.
- `pb3_form_opt_out.yaml`: an AutoTrader lead with `TCPAOptIn: false` gets its first reply (a reply is allowed) but no follow-up texts; email follow-ups continue.
- `pb3_customer_time_zone.yaml`: a New York dealer and a Los Angeles customer (found by ZIP, B0.5); a follow-up due at 9:00 New York time waits until the dealer is open **and** it's 8:00 Los Angeles time (11:00 New York). A second customer with no ZIP and a non-US area code gets only the all-zones safe window.

**Done when:** every AI sender and the platform's campaign worker go through the check, and counsel has reviewed the rules table. (The platform's appointment reminders keep their own rule.)

---

## Phase B4: The visit as the goal

1. **Decide gets a rule `offer_visit`,** between `answer` and `ask`. It fires when:
   - what B0.12 needs is known;
   - or Extract flags a buying signal (a new `wants_visit` field: "can I come see it", "test drive", "is it still there?").
2. **The endings change:**
   - `qualified` and `partly_qualified` no longer end with a handoff. They lead to `offer_visit`.
   - The lead goes to the team **when a visit is booked**, or on the handoff reasons in B0.13.
   - Every current handoff reason is reviewed against B0.13.
3. **The offer:** one message, two or three concrete times from Phase B5 (not "when would you like to come in?"), plain words, no pressure. It still answers the customer's question first, and it counts as one of the message's (at most 2) questions.
4. **When the customer declines. Decided 26 Sept (architecture.md decision 19), overriding the count below.**
   - ~~At most twice per lead.~~ **Client override:** up to **3** attempts. Attempt 2 uses a different hot-button/objection angle; attempt 3 uses a different value proposition. After the third decline: stop pushing, record the reason, and schedule a dated follow-up (`docs/client/autpulse.workflowblueprint.png`, "C. APPOINTMENT CONVERSION — ASK UP TO 3 TIMES").
   - The visit isn't offered again for 3 replies in between attempts (like Plan 2's parked asks) — unchanged, the client didn't speak to spacing between attempts, only the count.
   - **Angles — decided 27 Sept (architecture.md decision 28).** The client defined the shape; we defined the fixed lists (**our default**, flagged for client feedback):
     - **Attempt 1:** the offer based on their main interest and its value (blueprint box C: "Appointment ask based on primary intent and value").
     - **Attempt 2, a different approach based on the hot button or objection** (blueprint box C). Code picks from the objection Extract saw: time/convenience ("I'm busy"), "just looking", "want numbers first", credit worry, unsure of trade value. None seen → the customer's own stated priority (e.g. "minimizing wait time" in `docs/data/conversations.md`'s service example).
     - **Attempt 3, a different value proposition explaining why meeting sooner benefits them** (blueprint box C). From the Omnichannel PDF's Day 6 list of truthful reasons: appraisal, comparison, financing review, management review, right-team meeting. Picked by lead bucket: credit → financing review; trade-in → appraisal; general sales → comparison.
     - Each attempt uses the customer's own facts as the reason, never a made-up one (`conversations.md`: the successful service example built its reason from "62,000 miles + maintenance not done + busy"; a failed one "did not overcome the 'waste my time' objection").
     - The angle used is saved in conversation state, so no attempt repeats one. Tests: attempts 2 and 3 use a different angle from attempt 1 and from each other.
5. **Conversation state:** visit offers made, the times offered, declined or not.
6. **Follow-ups:** an unanswered visit offer gets the 24h follow-up with fresh times, inside B3's rules.
7. **Metrics:** visit offer rate, booking rate, handoff rate. The client's goal is fewer handoffs and more bookings, so both are shown per dealer.

**Tests:** when `offer_visit` fires and when it doesn't; the buying signal; a decline parks the offer; the new endings; a qualified lead is no longer handed off.

**Scenarios:**
- `pb4_offer_after_qualified.yaml`: a sales lead answers the key questions and gets a visit offer, not a handoff.
- `pb4_buying_signal.yaml`: "can I come see it this weekend?" on the first reply gets times straight away.
- `pb4_declined.yaml`: "not yet" parks the offer, and the conversation carries on.

---

## Phase B5: Booking the visit

1. **Available times, in code:**
   - built from the dealer's opening hours, existing platform bookings, and the booking rules in B0.10;
   - loaded into the context pack as `visit_times`, 2–3 options in the customer's time zone, in plain words ("Saturday at 10:00 AM").
2. **Reading the customer's pick:** "the second one", "Saturday 10 works", "after 5 tomorrow". Matched in code to the offered times using Plan 2's date resolver. A time that wasn't offered is checked against availability; an unclear answer gets one confirming question.
3. **Creating the booking — decided 27 Sept: the existing `POST /api/booking`, unchanged. No new endpoint, no platform code change.** Checked against `aidmvcs-be-dev/app/api/booking/route.js`:
   - **It works for us as is.** `/api/*` is outside the platform's login middleware, so the AI service can call it. It creates the `Booking` as `pending` (the model's default, matching B0.11), sets the lead to "Appointment Booked", sends its own confirmation SMS or email (on the lead's last channel), saves that confirmation in the conversation, and creates the reminders.
   - **Fields:** `dealer_id`, `lead_id`, `customerName`, `email`, `phone`, `bookingDate` (`YYYY-MM-DD`, dealer time), `bookingTime`, `notes` (the customer summary, item 6).
   - **Handled on our side** (all AI-service code):
     - **Availability:** the endpoint never checks for clashes. We read existing bookings and apply B0.10's rules before offering or booking a time.
     - **Retries:** the endpoint has no idempotency; a retry books twice. We check for an existing booking for this lead and time before calling it, and record the call.
     - **No second confirmation:** the endpoint already sends one, so the AI's reply doesn't send its own.
     - **Time format:** send `bookingTime` as 24-hour `HH:MM`; the endpoint only converts whole-hour "10 AM" style values.
     - **Moving a booking:** `PUT /api/booking` with `bookingId`, `booking_date`, `booking_time` **and** `booking_status` (without `booking_status` the new date/time is silently ignored, `route.js:594`). It re-creates the reminders.
   - **Email and phone are both required** (`models/Booking.js`). Without one the save fails, after the route has already set the lead to "Appointment Booked" (`route.js:272` runs before `booking.save()`), leaving the lead half-updated. So before booking (**agreed 27 Sept**), the AI asks for whichever is missing:
     - SMS-only customer: the AI asks for an email ("What's the best email for your confirmation?").
     - Email-only customer: the AI asks for a phone number. The number is asked for the booking and its reminders only; being given it is not consent to marketing texts (B0.4).
     - If the customer won't give it: no booking; the requested time goes to the team as a note, and the reply says the team will confirm.
   - If the time was just taken, the reply offers the next free times instead.
4. **The AI isn't paused by its own booking — already true, nothing to build.** `notifyAiOfStaffStatus` is only called from the staff status route, not from `/api/booking`. After the booking, the lead is in a `booked` state in the AI's own lead state: the AI answers questions and asks nothing more.
5. **Changes:** "can we make it 11 instead?" offers new times and moves the booking (`PUT`, above); "I can't make it" cancels it (`PUT` with `booking_status: cancelled`), offers new times once, and tells the team. **To check before building:** a cancel through `PUT` doesn't change the lead's status or delete the platform reminders; whether those reminders still fire for a cancelled booking needs confirming in `appointmentReminderService.js`.
6. **The team is told** of every booking, with the customer's summary (what they want, budget, trade-in), so staff are ready when they arrive.
7. **Guard:** "booked", "confirmed" and "see you on…" are allowed only when this turn created or confirmed a booking; otherwise the draft is rejected. Compose's "never say booked" rule is replaced by this.

**Tests:** time building (hours, existing bookings, earliest time); matching the customer's pick; no double booking on retry; slot taken; move (with `booking_status` sent) and cancel; asking for the missing email or phone; no second confirmation from the AI; no pause after an AI booking; the guard's booked rule.

**Scenarios:**
- `pb5_book_visit.yaml`: an offer, "the second one", a booking created, and a confirmation sent.
- `pb5_slot_taken.yaml`: the chosen time is taken meanwhile, and new times are offered.
- `pb5_reschedule.yaml`: a booked customer asks to move it.

**Platform e2e:** an AI booking appears in the dealer calendar, the lead shows "Appointment Booked", and reminders are created.

**Done when:** the three scenarios and the e2e pass, and a booking never pauses the AI.

---

## Phase B6: Debug UI, evals and rollout

1. **Debug UI:**
   - each send shows its origin and the send check's decision with the reason;
   - a Visit panel: times offered, the customer's pick, the booking and its status;
   - the Scheduler tab also shows the customer's local time;
   - the simulator can create an outbound lead and set consent on or off.
2. **Evals:**
   - conversations that end in a booking;
   - a decline respected;
   - no "booked" without a booking;
   - the after-hours choice;
   - outbound sends blocked for each reason.
3. **Real-model run** of the eval gate, with the booking rate and cost per turn recorded.
4. **Manual test script:** after hours now and later, booking, rescheduling, and an outbound customer without consent.
5. **Rollout check** adds: booking rate, handoff rate, sends outside the allowed hours (must be 0), and sends without consent (must be 0).

**Done when:** one dealer has been live for a week with zero sends outside the rules, and a booking rate and handoff rate the client agrees with.

---

## Not in this plan

- Prices in direct answer to a pricing question, payments, discounts, trade-in values, approvals (a *verified* price-drop mention in a Day 8–90 follow-up touch is now the one exception — Phase 0 item 3, decided 26 Sept)
- Holding or reserving a vehicle
- Booking service appointments (B0.9 suggests sales visits and test drives first)
- Writing bookings back to the DMS
- Photos in the conversational reply flow generally (the one exception — a vehicle image in the first quality response — is now required, Phase 0 items 4 and 7, decided 26 Sept; sent by MMS through Twilio, decided 27 Sept)
- Cross-dealer (group) inventory
- Upselling accessories or products
- Staff call tasks (C2) and the 5-minute callback (B0.13) — skipped for now, 27 Sept
- Any platform code change other than B3's campaign check and C5's manager outcome selection (27 Sept)

---

# Part C: TCPA AI Compliance Guardrails & Omnichannel Workflow Spec Implementation

> **Source Documents:**
> 1. [`../../data/AutoPulse_TCPA_AI_Compliance_Guardrails_Developer_Spec.pdf`](../../data/AutoPulse_TCPA_AI_Compliance_Guardrails_Developer_Spec.pdf)
> 2. [`../../data/AutoPulse_New_Lead_Follow_Up_Workflow_OMNICHANNEL_FINAL.pdf`](../../data/AutoPulse_New_Lead_Follow_Up_Workflow_OMNICHANNEL_FINAL.pdf)
> 3. [`../../data/conversation_3.md`](../../data/conversation_3.md)
>
> **What this is:**
> Part B introduced basic inbound/outbound origin tracking and an initial `may_send` check. Part C formalizes the client's mandatory developer specs for TCPA & AI Compliance Guardrails and the Omnichannel New Lead Follow-Up State Machine. **B3's `may_send` and C1's `can_contact` are one engine, built once in C1** (27 Sept).
>
> **27 Sept status:** principles 2 and 3 below (call tasks, the 1-hour call timer) are **skipped for now** with C2. C3 is AI-service only. C5 ships, including the manager outcome (a platform change).
>
> **Key Principles:**
> 1. **Compliance Engine Gate:** The AI *never* decides whether a message is legal. Every send passes through a deterministic Compliance Engine returning `ALLOW`, `HOLD`, `REVIEW`, or `BLOCK`. `BLOCK` / `REVIEW` can never be overridden by the AI or users.
> 2. **Omnichannel Mandate (CALL + TEXT + EMAIL):** Every scheduled follow-up touch engages all permitted channels simultaneously (AI SMS + AI Email + Human Call Task).
> 3. **1-Hour Call Escalation Timer:** Every AI touch starts a 60-minute connection timer. If no meaningful contact occurs within 60 minutes, a human call task is activated for dealership staff (respecting agent work hours).
> 4. **Master State Machine & Priority:** Strict state machine handling (`New Lead`, `Short-Term Follow-Up`, `No Contact Made`, `Contact Made - No Next Action`, `Contact Made - Specific Follow-Up`, `Appointment Set`, `Appointment No Show`, `Sales Visit`, `Opted Out / Suppressed`, `Opportunity Closed - No Response` on Day 91).

---

## Phase Overview (Part C)

| # | Phase | You can see it when |
|---|---|---|
| C1 | Compliance Engine & Evidence Schema | Sends return `ALLOW`/`HOLD`/`REVIEW`/`BLOCK`, natural-language opt-outs route to `REVIEW`/suppression, and evidence metadata is saved |
| C2 | Omnichannel Rule & 1-Hour Call Escalation | Scheduled follow-up sends SMS + Email and starts a 60-min timer that activates a staff call task if no response |
| C3 | Master State Machine & Priority Engine | Lead transitions cleanly through Short-Term, Specific, Appointment, No-Show, Sales Visit, and Day 91 closure with pre-send rechecks |
| C4 | Short-Term Cadence & Required Touch Rules | Touch 1 ends with "Tell me, what are you driving now?", Touch 2 sends "{FirstName}?" nudge 3 hours later, and Days 2-7 follow thematic angles |
| C5 | Appointment Confirmation, No-Show & Sales Visit | 15-min confirmation sent, Day-before Y/N router handles replies, +1h No Show triggers check-in, and Sales Visit requires manager outcome |
| C6 | Edge Cases & Operational Hardening | Wrong number/bad phone suppressed, email hard-bounces handled, duplicate leads merged, and photo fallbacks enforced |

---

## Phase C1: Compliance Engine & Evidence Schema

1. **Deterministic Compliance Engine (`can_contact` service):**
   - Signature: `can_contact(customer_id, dealer_id, channel, purpose, timestamp) -> ALLOW | HOLD | REVIEW | BLOCK`.
   - LLM Guardrail: The LLM is explicitly forbidden from creating, inferring, or changing consent statuses or overriding compliance decisions.
2. **Consent Evidence Profile:** (stored in the AI service's `ai_consent`; sources decided in B0.4: the platform's opt-in flag, the lead form's consent line, the customer's own inquiry, and YES replies to the email ask.)
   - Store immutable consent evidence: `consent_status`, `consent_type`, `consent_timestamp`, `consent_source`, `consent_text_version`, `consent_evidence_id`, `consenting_seller_id`, `source_url`.
   - DMS/DealerVault rule: DMS presence *never* implies consent (`TCPA_PERMISSION = YES`).
3. **Natural-Language Opt-Out & Ambiguity Handling:**
   - Explicit keywords: `STOP`, `END`, `CANCEL`, `UNSUBSCRIBE`, `QUIT`.
   - Natural language: "don't text me", "leave me alone", "remove my number", "take me off your list".
   - Ambiguous phrases route to `REVIEW` and immediately suspend automated marketing.
4. **AI Voice Channel Control:**
   - AI outbound voice treated as a separate, higher-risk channel, disabled by default.
5. **Auditable Compliance Event Logging:**
   - Record timestamp, dealer_id, customer_id, channel, purpose, consent_evidence_id, jurisdiction, local_time, DNC results, frequency check, decision, and decision_reason for every attempted send.

**Tests:** `can_contact` table-driven tests for all 4 outcomes, natural-language opt-out parsing, evidence immutability, and compliance audit log generation.

---

## Phase C2: Omnichannel Rule & 1-Hour Human Call Escalation

> **Skipped for now (27 Sept).** Staff call tasks don't exist on the platform (no task model or task screen; the only "click to call" is a plain `tel:` link on the campaign report page), so this would need new platform backend and UI. B0.13's 5-minute callback, which relies on it, is skipped with it. C4's follow-ups run as SMS + email without call tasks until this is revisited.

1. **Omnichannel Execution Rule:**
   - Scheduled follow-up triggers all permitted and valid channels: AI Text + AI Email + Human Call Task checkpoint.
2. **1-Hour Connection Timer & Call Escalation:**
   - On successful AI SMS/Email send, start a 60-minute connection timer.
   - Watch for meaningful customer reply/contact during the 60 minutes.
   - If contact occurs: cancel the pending human call task.
   - If no contact at 60 minutes: activate/surface the human call task in the platform UI for staff (Click-to-Call supported).
3. **Work Hours & Compliance Guardrail:**
   - Human call tasks respect agent work schedules and time-of-day compliance rules; defer to next eligible call window if outside hours.
   - Re-check current lead status immediately before activating stale call tasks.

**Tests:** 60-minute timer activation, cancellation on reply, task creation on expiration, agent schedule deferral, and pre-activation state recheck.

---

## Phase C3: Master Lifecycle State Machine & Priority Engine

> **Decided 27 Sept: backend only, in the AI service. No platform changes.** The stage is kept in the AI's own lead state, not on the platform's `Lead`. Its inputs are things the AI already sees or can read: customer replies, bookings made through `/api/booking`, and the statuses staff set on the platform (Appointment Booked, Visited, Sold, DND, No Show, Managerial Review), which arrive as the `lead-paused` event or can be read from the lead. "Sales Visit" = staff setting **Visited** (the platform has no automatic check-in). Staff don't see C3's stage names on their screens.

1. **State Machine Statuses:**
   - `New Lead`, `Short-Term Follow-Up`, `No Contact Made`, `Contact Made - No Next Action`, `Contact Made - Specific Follow-Up`, `Appointment Set`, `Appointment No Show`, `Sales Visit`, `Opted Out / Suppressed`, `Opportunity Closed - No Response`.
2. **Event Priority & Race-Condition Control:**
   - Order of precedence: `1. OPT-OUT / COMPLIANCE BLOCK` > `2. SALES VISIT` > `3. APPOINTMENT SET` > `4. CONTACT MADE - SPECIFIC FOLLOW-UP` > `5. APPOINTMENT NO SHOW` > `6. CONTACT MADE - NO NEXT ACTION` > `7. NO CONTACT MADE` > `8. NEW LEAD`.
   - Pre-send re-check: Re-read status, reply state, appointment state, sales visit state, and compliance check before executing any queued action.
3. **Opportunity Clock & Day 91 Expiration:**
   - `opportunity_created_at` is immutable and never resets on cadence re-entry.
   - Day 91 closes active opportunity while retaining customer record and history.

**Tests:** State transitions across all events, priority resolution when events conflict, pre-send re-check canceling stale tasks, and Day 91 opportunity closure.

---

## Phase C4: Short-Term Cadence & Required Touch Rules

1. **Touch 1 Structure (Immediate):**
   - Opens with the client's required intro (Omnichannel PDF p.3): "Hello {customer_first_name}, this is {agent_name} from {dealership_name} in {city}, {state}. Thank you for your interest in our {vehicle_year} {vehicle_model}. I am excited to help you with your purchase."
   - Answers customer lead questions.
   - Mandated closing prompt line: *"Tell me, what are you driving now?"*.
   - **Decided 27 Sept (architecture.md decision 34): B1 and B4 override the required ending.** Touch 1 is the AI's first reply. When it's after hours, it ends with B1's "now or when we open?" choice; when the customer shows a buying signal, it ends with B4's visit offer. Only when neither applies does it end with "Tell me, what are you driving now?". This goes against the client's "ALWAYS end" wording, so it's flagged for client feedback.
   - The question limit is 2 per message (decision 35). On Touch 1, "what are you driving now?" counts as one of the two (it asks about the car they'd trade in), so at most one other question fits. The override order above still decides the **ending**.
2. **Touch 2 Name Nudge (3 Hours Later):**
   - If no response after 3 hours (inside permitted window), send nudge: `"{FirstName}?"`.
3. **Days 2–7 Follow-up Angles:**
   - Day 2: Vehicle visual (photo).
   - Day 3: Financing help prompt (no fabricated terms).
   - Day 4: Trade-in appraisal prompt.
   - Day 5: Verified vehicle feature/value highlight.
   - Day 6: Appointment value proposition.
   - Day 7: Direct closing appointment offer.
4. **Days 8–90 Extended Cadence:**
   - Days 8–30: 1 outreach cycle/week (SMS + Email).
   - Days 31–90: 1 outreach cycle/month (SMS + Email).

**Tests:** Touch 1 required ending validation, Touch 2 3-hour trigger execution, thematic angle selection, and weekly/monthly cadence transitions.

---

## Phase C5: Appointment Confirmation, No-Show & Sales Visit Workflows

> **Decided 27 Sept: C5 ships** (architecture.md decision 33). What we build:
>
> - **Day-before Y/N confirmation and its router** (AI service): "Y" → `PUT /api/booking` with `booking_status: confirmed`; "N" → offer new times straight away (B5's move); unclear → ask once more; no answer → stays booked, unconfirmed. Skipped for same-day appointments.
> - **Daily countdown** with a different vehicle photo each day before the appointment (AI service, MMS). Skipped for same-day appointments.
> - **No-show** (AI service): +1 hour after the appointment with no "Visited" → "I am looking for you in the showroom — are you here and working with someone?" (with a photo); +24 hours with no reply → "How did everything go when you came in?"; still no reply → back into C4's follow-ups (stage "Contact Made – No Next Action", as the client requires).
> - **Showed:** staff setting "Visited" on the appointment day → `PUT /api/booking` with `booking_status: completed`.
> - **Manager outcome — planned to be shipped (platform change, approved 27 Sept):** "Sold pending", "Sold delivered" and "Unsold" added to the lead status dropdowns (`dealer/leads/components/StatusModal.js`, `dealer/conversations/components/StatusModal.js`, the lead list filters), accepted by the status route (`api/conversations/lead/status/route.js`), and added to `STAFF_OWNED_STATUSES` (`lib/ai/aiStaff.js`) so they pause the AI. After a lead is set to "Visited", the status screen asks for one of the three outcomes (new UI behaviour).
> - **Not built:** the client's "15 minutes after booking" details message. The platform's booking endpoint already sends a confirmation straight away; sending ours too would double it.
> - **Dealer setup (no code):** for AI dealers, the platform's reminders are switched off on Settings → Reminder settings ("enabled" off; `post_enabled` stays off), so our countdown and Y/N replace them. To be added to the rollout runbook (`docs/runbooks/rollout.md`) when C5 is built.
> - **No-show clash (our default, flagged):** the platform always sends its own no-show message when staff set "No Show". If staff set it before our +1 hour message, ours is skipped (theirs already went). Dealers are told not to set "No Show" on AI leads; our flow handles it.
>
> What exists already, checked against the platform:
>
> | C5 piece | Already done by the platform? | If we build it |
> |---|---|---|
> | Details text/email after booking | **Yes:** `POST /api/booking` sends a confirmation straight away | Nothing to build; skip ours |
> | Reminders before the appointment | **Yes:** `appointmentReminderService.js`, per-dealer settings | Would duplicate unless switched off. **Can be switched off, no code change:** dealer Settings → Reminder settings (`dealer/settings/reminder-settings`), "enabled" toggle (`appointment_reminder_settings.enabled`; off also stops the post-appointment messages) |
> | Messages after the appointment | **Yes, if the dealer turns them on:** same settings page, `post_enabled` (off by default) | Would clash with the no-show messages; must stay off for AI dealers |
> | Day-before "Does this still work? Reply Y or N", and reading the reply | No (the platform's reminders don't ask Y/N) | AI service: send, read Y/N, mark `confirmed` via existing `PUT /api/booking`, reschedule on N. No platform change |
> | Daily countdown with a vehicle photo | No | AI service (needs MMS) |
> | No-show: +1h "are you here?", +24h "how did it go?", then back to follow-ups | **Partly:** when *staff* set "No Show", the platform sends its own no-show message (`status/route.js:609`) | AI service, timed from the booking; "no visit" = staff haven't set Visited. **Conflict:** if staff also click "No Show", the customer gets the platform's message and ours. **This one has no switch:** the platform always sends it when staff set "No Show" (`status/route.js:609`, no setting checked) |
> | Visit stops all automation | **Yes:** staff setting "Visited" already pauses the AI | Nothing to build |
> | Manager must pick SOLD PENDING / SOLD DELIVERED / UNSOLD | No (the platform has only "Sold") | **Platform change** (new status options in the existing status dropdown, `StatusModal.js`, plus the status route). **Planned to be shipped (27 Sept)**; see above |
>
> The platform's rule-based follow-ups (`followupService.js`) are **not** a conflict: they're already switched off for dealers whose AI is live (`aiOwnsFollowUps`).
>
> The numbered items below are the client's spec as written (Omnichannel PDF §7–10); the table above decides what of it we'd actually build.

1. **Appointment Confirmation Sequence:**
   - 15 minutes post-booking: Send appointment details text & email confirmation.
   - Day before appointment: Text & Email `"Hello {customer_first_name}... confirming our meeting for {date} at {time}. Does this time still work? Please reply Y for Yes or N for No."`.
   - Confirmation Router: `Y` -> mark `appointment.confirmed = true`; `N` -> trigger immediate reschedule workflow; Ambiguous -> ask for clarification.
2. **Appointment No-Show Flow:**
   - Trigger: Appointment time + 1 hour with no qualifying `Sales Visit`.
   - Touch 1 (+1 hr): SMS + Email + Photo: *"I am looking for you in the showroom - are you here and working with someone?"*.
   - Touch 2 (+24 hrs if no reply): SMS + Email: *"How did everything go when you came in?"*.
   - No reply after Touch 2 -> route to `Contact Made - No Next Action` -> Short-Term Follow-Up.
3. **Sales Visit Trigger & Manager Outcome:**
   - Customer check-in at dealership SALES sets `Sales Visit` immediately and halts all automated follow-up.
   - If on appointment date: marks `appointment.showed = true`.
   - Requires manager outcome selection: `SOLD PENDING`, `SOLD DELIVERED`, or `UNSOLD`.

**Tests:** 15-min confirmation, day-before Y/N routing, +1h No Show trigger, +24h check-in, routing to Short-Term, and Sales Visit manager outcome mandate.

---

## Phase C6: Edge Cases & Operational Hardening

1. **Wrong Person / Bad Number:**
   - Mark as bad number / data suppression outcome; permanently cease outreach to that number.
2. **Hard-Bounce Email:**
   - Suppress invalid email address upon provider hard bounce; permit remaining valid channels (SMS) to continue.
3. **Duplicate Lead Handling:**
   - Merge/link duplicate leads to existing customer record; prevent duplicate active workflow instances.
   - **27 Sept:** merging leads means changing the platform's `Lead`/`Customer` records, which this plan doesn't do. On our side only: when two leads belong to the same customer, only one runs an AI workflow.
4. **Photo Fallback Guardrail:**
   - If requested vehicle photo is unavailable, never send unrelated or fabricated photos; fall back to non-photo text message.

**Tests:** Bad number suppression, email hard-bounce channel isolation, duplicate lead merge prevention, and photo fallback enforcement.

