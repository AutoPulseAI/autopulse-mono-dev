# Master Plan 3: Inventory

> **What this is:** the plan for letting the AI talk about the dealer's
> inventory ("do you have a white RAV4?", "what SUVs do you have under
> 30k?"). It was left out of Plan 1 and Plan 2 on purpose.
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

## What already exists

| Piece | Where | State |
|---|---|---|
| Vehicle records | Platform `vehicles` collection (Mongoose `Vehicle`, `strict: false`, unique per dealer + VIN) | Holds dealer stock **and** vehicles that came from DMS history (customers' own cars, Customer 360). |
| Inventory API | Platform `GET /api/car` | Filters by dealer, make, model, year, `car_type` (new / used), body type, price range, miles range, and more. Maps prices from `internetreduced` / `instoreprice`. |
| Inventory tool | `agentic-upsell/src/upsell_agent/tools/inventory_tool.py` | A stub. Its docstring already asks for raw rows, so every mention can be traced back to a VIN. |
| Grounding nodes | `agent/nodes/recommend.py`, `agent/nodes/verify_grounding.py` | Stubs from the original design, not in the graph. |

## Principles

1. **Stock facts come from records, never from the model.** Every vehicle the AI mentions is a record loaded in code for this turn, with its VIN. Anything the model says about a vehicle that isn't in that record is removed or the draft is rejected, never "corrected".
2. **Fresh or silent.** A vehicle is mentioned only if it was in stock when the turn loaded it, and it is re-checked before anything is sent later (the 24h channel switch).
3. **Prices stay restricted** unless Phase 0 decides otherwise. Inventory answers say what's there, not what it costs.
4. **Stock is looked up in code, not by the model calling functions.** Like Plan 2's answer sources: loaded in code and put into the context pack, so the reply stays within the time budget and every value is traceable.
5. **Every phase ships its own tests and scenarios**, and Plan 1 and Plan 2's tests, scenarios, e2e and burst test keep passing.

---

## Phase overview

| # | Phase | You can see it when |
|---|---|---|
| 0 | Decisions | The answers are written into architecture.md |
| 1 | Inventory read layer | The Debug UI shows the stock records a turn loaded, each with its VIN |
| 2 | Shopping criteria | "White SUV under 30k" becomes structured search criteria from the profile and the message |
| 3 | Answering stock questions | "Do you have a RAV4?" is answered from real stock, or honestly says no |
| 4 | Grounding check | A draft that names a car or a detail not in the loaded records is rejected |
| 5 | Freshness | A car sold since the message was written is never mentioned in a later send |
| 6 | Debug UI and dev inventory | Seeded stock per dev dealer, and an Inventory panel per turn |
| 7 | Evals, shadow and rollout | Inventory evals pass on the real models, and shadow review shows no wrong vehicle facts |

---

## Phase 0: Decisions

1. **What counts as in stock.** The `vehicles` collection also has DMS-history vehicles. Decide the rule that marks a record as dealer stock and not sold: a `source` value, a status field, the inventory feed's last-seen date, or a combination. Check it against the real data of one dealer. **This is the most important decision in this plan.**
2. **Source of truth for reads.**
   - **Option A:** the platform's `GET /api/car`, as the stub suggests. One source of truth and its field mapping, but a network hop inside the 8 s budget.
   - **Option B:** a dealer-scoped, read-only query of `vehicles`, like Customer 360. Faster, but duplicates the field mapping.
   - **Suggested:** Option B for the turn (speed), with a parity check against `/api/car` like Plan 1's `compare-360`.
3. **Prices.**
   - **Suggested:** stay restricted ("the team will confirm pricing").
   - If allowed later: only the dealer's published internet price, word for word, with a "plus taxes and fees" line. State rules on advertised vehicle prices apply to an AI quoting a price too, so confirm with counsel before enabling.
4. **Links.**
   - SMS: none (Plan 1 rule).
   - Email: the vehicle's page on the dealer site, if the record has one.
5. **How many vehicles per reply.**
   - **Suggested:** at most 3 in email, and 1–2 in SMS, which is short.
6. **Feed freshness.** How often the inventory feed updates, and how old a record's last update can be before it's treated as possibly sold. **Suggested:** older than 3 days = not mentioned.
7. **Photos.** Not in this plan (SMS stays text-only).

Write the answers into architecture.md.

---

## Phase 1: Inventory read layer

1. **Implement `tools/inventory_tool.py`** as decided in Phase 0:
   - `search_inventory(dealer_id, criteria, limit)` returns raw records;
   - `get_vehicle(dealer_id, vin)` is used for re-checks.
   It is dealer-scoped and read-only, and applies the in-stock rule.
2. **A typed view** of each record: VIN, stock number, year, make, model, trim, body type, new/used, exterior colour, miles, record last-updated time, and the page link if allowed. The price is loaded only if Phase 0 allows it.
3. **Short cache** (e.g. 60 s per dealer + criteria), so a burst of campaign replies doesn't query the same stock 300 times.
4. **Inventory layer in the context pack:**
   - `inventory`: the records loaded this turn, with each record's `source_id` (the VIN);
   - `inventory_query`: the criteria used;
   - `inventory_checked_at`: when it was loaded.
5. **Trace:** Load context shows the query, how many records matched, and which were given to the AI.

**Tests:**
- The in-stock rule, including DMS-history vehicles excluded and old records excluded.
- Dealer scoping (no cross-dealer read).
- The cache.
- The typed view.

**Scenario:** `p1_inventory_loaded.yaml`. A sales lead for a used SUV; Load context shows matching seeded stock.

**Done when:** a turn's loaded stock is visible in the Debug UI, and a parity check against `/api/car` passes for the dev dealers.

---

## Phase 2: Shopping criteria

1. **Criteria from what we know**, built in code:
   - the profile: desired model, new or used, budget, monthly payment;
   - the current message: colour, body type, "under 30k", "something bigger".
   New criteria slots are added to the slot schema where needed (e.g. `interest.body_type`, `interest.color`), with Plan 2's customer wording and explanations.
2. **Search when it helps.** Stock is loaded when:
   - the customer asks about stock (Plan 2's `answerable` label now covers stock questions);
   - or the profile has enough to search (at least a model, or a body type + new/used).
   Otherwise the turn doesn't search, which saves time and cost.
3. **Loosening.** No exact match loosens the search in a fixed order and records what was loosened:
   1. colour
   2. trim
   3. year ±1
   4. the same body type from another make
   Compose can then say "not in white, but we have it in silver".
4. **Budget handling.** If Phase 0 keeps prices restricted, the budget can still filter the search (the price is used, not said). The reply never states or implies a price.

**Tests:**
- Criteria building from the profile + message, table-driven.
- The search-or-not rule.
- The loosening order and its record.

**Scenario:** `p2_loosened_search.yaml`. "White RAV4" with only a silver one in stock; the trace shows colour loosened.

---

## Phase 3: Answering stock questions

1. **Decide:** a stock question with loaded results is answered by the `answer` rule, using the inventory layer. With no results, the answer is honest ("I'm not seeing one in stock right now; I can have the team let you know if one comes in"), and that is added to `promises`.
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
- `p3_none_in_stock.yaml`: an honest no, with the promise recorded.

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

1. **Before the send:** if the turn took long, the mentioned VINs are re-checked with `get_vehicle` right before sending. A vehicle that sold in the meantime rejects the draft (rewrite without it).
2. **24h channel switch:** the saved follow-up keeps its `mentioned_vins`. At fire time each is re-checked. If any sold, the stock-free version of the message is sent instead: Compose writes one alongside, the same way it already writes an SMS and an email version.
3. **Old records:** anything past Phase 0's freshness limit is never loaded.
4. **Metric:** "sold vehicle mentioned". Must be 0 in the rollout check.

**Tests:** sold before the send, sold before the follow-up (the stock-free version is sent), and old records ignored.

**Scenario:** `p5_sold_before_followup.yaml`. A vehicle is marked sold, then the clock is advanced 24h; the stock-free version goes out.

---

## Phase 6: Debug UI and dev inventory

1. **Dev inventory seed:** 20–40 realistic vehicles per dev dealer, both new and used, several colours and body types. A couple are marked sold and a couple have old feed dates, so the in-stock rule is visible. Clearly separate from the dev DMS-history vehicles.
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
   - "no stock" is honest;
   - no prices;
   - short references resolve;
   - the SMS count limit holds.
2. **Promptfoo:** injection through vehicle descriptions (dealer feed text is data, never instructions).
3. **Real-model run** of the eval gate, with pass rates and cost per turn recorded.
4. **Shadow review:** during a dealer's shadow week, the Shadow tab marks each stock answer right / wrong vehicle fact / should have said no.
5. **Rollout check** adds grounding rejections, sold-vehicle mentions (0) and the inventory query p95 time.

**Done when:** one dealer has been live with inventory answers for a week, with zero wrong vehicle facts and zero sold-vehicle mentions.

---

## Not in this plan

- Prices, payments, discounts, trade-in values (unless Phase 0 allows prices)
- Holding or reserving a vehicle
- Booking test drives
- Photos in messages
- Cross-dealer (group) inventory
- Upselling accessories or products
