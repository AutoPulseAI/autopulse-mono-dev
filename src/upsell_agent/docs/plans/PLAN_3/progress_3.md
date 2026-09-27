# MASTER_PLAN_3 progress

Plan: [`MASTER_PLAN_3.md`](MASTER_PLAN_3.md). Build order (27 Sept): Part A (except the deferred items) → C1 → B1 → B5 → B4 → C3 → C4 → C5 → C6.

| Phase | State |
|---|---|
| A0. Decisions | Done (architecture.md §15, decisions 14–36) |
| A1. Inventory read layer | **Done, verified end to end (27 Sept 2026)** |
| A2. Shopping criteria | **Done, verified end to end (27 Sept 2026)** |
| A3. Answering stock questions | Not started |
| A4. Grounding check | Not started |
| A5. Freshness (sold re-checks) | Not started (needs a "sold" signal: C5's manager outcome) |
| A6. Debug UI and dev inventory | Not started (Phase 1 added a first dev stock set and the Stock section) |
| A7. Evals, shadow and rollout | Not started |

---

## Phase A1: Inventory read layer

### What was built

| Piece | Where |
|---|---|
| `search_inventory(dealer_id, criteria, source)` and `get_vehicle(dealer_id, vin, source)` | `tools/inventory_tool.py` (was a stub) |
| Criteria from the profile (`interest.model` split into year / make / model or a body word, and `interest.new_or_used`) | `inventory_tool.criteria_from_profile` |
| Typed view (`InventoryRecord`), all from `/api/car`'s response: VIN (`source_id`), year, make, model, trim, body type, new/used, exterior colour, miles, page link. **No price, stock number or import time.** | `inventory_tool.InventoryRecord` |
| Two sources behind one switch (`PLATFORM_CLIENT`): the real `GET /api/car`, and a port of the route over the local database for dev | `LiveInventorySource`, `StubInventorySource` |
| 60 s cache per dealer + query; `get_vehicle` never cached; a failed search never cached | `inventory_tool._cache` |
| Context pack layers `inventory`, `inventory_query`, `inventory_checked_at` (+ an `inventory` token count) | `agent/context_pack.py` |
| Held back from Extract and Compose (`HELD_FROM_MODELS`) until the grounding check (Phase 4) exists | `context_pack.py`, `nodes/compose.py`, `nodes/extract.py` |
| Load context searches when the profile names a vehicle, records query / matched / given to the AI / left out and why; a platform error means a turn without stock, never a failed turn | `agent/nodes/load_context.py` |
| Dev stock: 12 vehicles per dev dealer, shaped like the vAuto import | `devtools/dev_inventory.py`, loaded by `make ai-seed` or alone with `python -m upsell_agent.devtools.dev_inventory` |
| Stub-vs-live parity check | `devtools/compare_inventory.py` |
| Scenario steps `add_stock`, `expect_inventory`, `compare_inventory` | `devtools/scenarios.py` |
| Stock section in the Load context inspector; "Plan 3 · Phase A1" scenario group | `debug-ui/src/components/StepViews.tsx`, `ScenariosTab.tsx` |

### How `/api/car`'s defects are handled (no change to `route.js`)

- **Dealer id not enforced:** always sent, and any returned row whose `dealer.id` isn't this dealer is dropped.
- **Broken `year` filter:** an exact year is sent as `year_range=Y-Y`; `year` is never sent (checked in unit tests, the scenario, and against the running route).
- **Unescaped regex input:** regex characters are escaped and commas removed before sending.
- **No in-stock filter:** none applied (Phase 0 item 1 interim decision). **A sold car can still be loaded** until C5's manager outcome ("Sold pending" / "Sold delivered") marks it sold.
- **Cost data in `facets`:** `facets` is never sent.

### Changed 27 Sept (after review)

- **No freshness rule.** The 3-day import-age limit was our own default, not a client rule; removed from the code, tests, scenario and plan (Phase 0 item 6). Old records load like any other.
- **No stock number, no import time.** Neither was asked for by the client, and import time only served the freshness rule. With both gone, the tool reads `/api/car`'s response alone: the extra read of the `vehicles` collection is removed.
- **Side effect in dev only:** the dev seed's DMS-history customer cars (same `vehicles` collection) can now come back in a search. In production only the vAuto feed writes `vehicles`, so this doesn't happen there.
- **Debug UI nodes are clickable again (pre-existing bug).** React Flow gave the graph's nodes `pointer-events: none` because they were neither draggable nor selectable, so a click fell through to the canvas and panned it. `PipelineGraph.tsx` now passes `onNodeClick`; `PipelineNode.tsx` marks the node `nopan nodrag`.

### Scenario deviation

The plan's scenario says "a used SUV". Body type as a search criterion is Phase 2 (`interest.body_type`), and Extract doesn't fill `interest.model` with "SUV", so `p1_inventory_loaded.yaml` uses "a used Toyota RAV4" (an SUV). Stock is searched from the second turn, because the first turn's Load context runs before Extract has read the lead form. Phase 2 (criteria from the current message) removes that delay.

### Verification

| Check | Result |
|---|---|
| AI unit tests (`make ai-test`) | 633 passed after the 27 Sept changes (585 before Phase 1; +48 in `tests/unit/test_inventory_tool.py`) |
| Mutation check on the new tests | Each of these broke at least one test (before the 27 Sept changes): sending `year`, no regex escaping, no dealer check, no cache |
| Offline eval gate (`pytest evals`) | 56 / 56 |
| Scenarios, live in Docker (`make ai-scenarios`) | 36 / 38 on stub: both failures are the parity checks (`s6_customer360_parity`, `p1_inventory_parity`) which need the platform running. With the platform's web server running: `p1_inventory_loaded` and `p1_inventory_parity` pass |
| Parity, stub vs the real `/api/car` (Phase 1 "done when") | 70 / 70 searches match for both dev dealers (every make/model, new, used, exact year, no match) |
| Against the real route | `year_range=2021-2021` returns only the 2021 car; `get_vehicle` for another dealer returns nothing |
| Debug UI type check (`tsc -b --noEmit` in the `ai-debug-ui` container) | Clean |
| Ruff on changed files | Clean |
| Burst test (`make ai-burst`, 300 replies in 600 s) | 8 / 8 checks: 0 errors, 0 template fallbacks, reply p95 2.5 s, other dealer not slowed |
| Debug UI in a real browser | New lead "new Toyota RAV4" + a reply: clicking the Load context node shows the Stock section (query, `/api/car` parameters, records with VIN); the reply mentions no vehicle |

---

## Phase A2: Shopping criteria — readiness review (27 Sept 2026)

Before building, the phase's text was checked against the running code rather than re-read from the plan alone — the same way Phase 0/1's `/api/car` defects were caught before they were built into a bug. Three things needed a decision; all three are recorded in MASTER_PLAN_3.md's Phase 2 section (not repeated in full here) and confirmed with the user:

1. **Where the search runs.** `load_context` is the graph's entry point and runs before `extract`/`validate`, so Phase 1's search can only ever see the profile as it stood *before* this turn's message. Phase 2 needs "the current message" and "the customer asked about stock" as triggers, neither of which exists yet at `load_context` time. **Decided:** a new graph node, `search_stock`, runs after `validate`, replacing (not duplicating) Phase 1's search. Also removes the "search only starts on turn 2" limitation noted in Phase 1's scenario deviation above.
2. **Trim can't be a `/api/car` search parameter.** Confirmed directly against `aidmvcs-be-dev/app/api/car/route.js`: it returns `trim` but has no query parameter for it. **Decided:** trim is filtered client-side after the broader search returns, not sent as a request parameter like the other three loosening steps.
3. **Colour matching is case-sensitive on the platform**, unlike make/model/body type/condition (confirmed in `route.js`). **Decided:** colours are matched against the dealer's own real stock values (read fresh, not a guessed casing convention) before being sent.

One more item was reconsidered, not just decided: reclassifying stock questions from `restricted` to `answerable` (the original Phase 2 item 2 wording) turned out lower-risk than first assumed — `slots/policy.py` routes every non-`clarify` question the same way regardless of label, and the offline model already falls back to "the team will confirm" for any `answerable` question it can't specifically answer. **Decided:** split the stock-vs-price detection now (useful either way, since they're currently one merged rule), but keep stock questions labelled `restricted` until Phase 3, which flips the label in the same change that adds the real answering logic. Phase 3 item 0 now records this explicitly.

**"Something bigger" — decided 27 Sept, not deferred.** No client document or existing code defines a body-type size order, so one was agreed and written into MASTER_PLAN_3.md Phase 2 item 2 as our own default (flagged for client feedback): 4 size tiers (Coupe/Convertible/Hatchback → Sedan/Wagon → SUV → Minivan/Van/Truck), "bigger" moves up one tier, further if that tier is empty too — the same idea as the colour/trim/year loosening chain.

**Verdict: Phase 2 is ready to build.** All four architectural/implementation gaps found in the review have a recorded decision. Nothing is open.

---

## Phase A2: Shopping criteria — built (27 Sept 2026)

### What was built

| Piece | Where |
|---|---|
| New graph step **Search stock**, after Validate (`load_context → extract → validate → search_stock → decide → …`). Phase 1's search in Load context is removed: one search per turn, from this turn's validated profile, from the first turn | `agent/nodes/search_stock.py`, `agent/graph.py`, `agent/pipeline.py`, `agent/nodes/load_context.py` |
| Criteria from the profile: vehicle (year / make / model / trim), new or used, body type, colour, budget. Values still waiting to be confirmed don't count | `tools/inventory_tool.criteria_from_profile`, `split_trim` |
| New slots `interest.body_type` (enum, 9 body types) and `interest.color` (text): extractable, never asked, never required | `slots/schema.py`, `slots/validators.py` (body-type synonyms) |
| Offline model reads body type, colour and trim words (not from a trade-in sentence) | `agent/offline_model.py` |
| Search-or-not: a stock question, or a make/model, or a body type + new/used (or "bigger" with a known body type). Otherwise nothing is fetched | `search_stock.search_trigger` |
| Loosening in the fixed order colour → trim → year ±1 → same body type any make → new/used (last step added 28 Sept), each step recorded with what was tried | `tools/stock_search.find_stock` |
| Trim checked on our side against each record's own trim (never sent: /api/car has no trim parameter) | `stock_search.trim_matches` |
| Colour case-correction: matched ignoring case (grey = gray) against the dealer's own stored values, sent in the stored spelling; no match means that step loosens without a query that can't match | `stock_search.match_colour` |
| "Something bigger": 4 size tiers, up one tier, and up again while a tier is empty | `stock_search.SIZE_TIERS` |
| Budget → `price_range=0-<budget>` (filters only; records still have no price, the query stays held back from the models) | `InventoryCriteria.to_params` |
| Stock and price questions split into two rules; both still labelled `restricted` (Phase 3 flips stock) | `agent/question_topics.py`, `offline_model._label`, `agent/llm.py` prompt text |
| Stub source handles `exterior_color` (literal, case-sensitive, like route.js) and `price_range` | `StubInventorySource` |
| Parity check covers colour (stored and lower case), budget and a size tier | `devtools/compare_inventory.py` |
| Scenario step `expect_inventory` reads Search stock; adds `loosened`, `colour_sent`, `trigger`, `only_loaded` | `devtools/scenarios.py` |
| Debug UI: Search stock node (top row), its inspector shows why it searched, the criteria, colour correction, each loosening step, the /api/car request and the records | `PipelineGraph.tsx`, `NodeInspector.tsx`, `StepViews.tsx`, `ScenariosTab.tsx` |

### Decisions made while building (flag if you disagree)

- **Monthly payment isn't a filter.** Turning a monthly amount into a price needs finance maths (rate, term, down payment) we'd be inventing. Only `interest.budget` filters.
- **Trim is split off by a fixed list of trim words** ("RAV4 XLE Hybrid" → RAV4 + "XLE Hybrid"); "Grand Cherokee", "Model Y" stay whole.
- **"Same body type from another make"** keeps the customer's body type if they said one, else learns it from the dealer's own stock of that model. If neither exists, the step is skipped and recorded, never guessed.
- **Colour is an exact colour match** (ignoring case, grey = gray): "white" does not match "Pearl White".
- **New/used is loosened last (decided with the user, 28 Sept; our default, flagged for client feedback).** Found in Debug UI review: "anything bigger?" on a new RAV4 found no new minivans/vans/trucks and stopped with nothing. Now the final step drops new/used and offers the other.
- **Debug UI wording (28 Sept review):** the Stock panel says "N matched · 3 given to the AI (max 3 per reply)", and shows "From the profile" separately from "Actually searched", so a size-up no longer looks like it searched for the named model.
- **A stock question with nothing to search on** ("what do you have?") loads the dealer's newest stock.

### Verification

| Check | Result |
|---|---|
| AI unit tests | 719 passed after the 28 Sept condition-loosening step (715 at first build; 633 before Phase 2; +86 in `tests/unit/test_shopping_criteria.py`; Phase 1 wired tests moved to Search stock). Plus 56 evals: 775 total |
| Mutation check | 9 / 9 caught: colour sent as said, trim before colour, trim sent to /api/car, year ±2, no size-up again, unconfirmed values used, body type alone searching, budget not sent, stock merged into the price rule |
| Offline eval gate | 56 / 56 |
| Scenarios, live in Docker | 39 / 39, including `p2_loosened_search` and both live parity checks |
| Parity, stub vs the real `/api/car` | 142 / 142 (lower-case colours return 0 on both: the route's colour match is case-sensitive, confirmed live) |
| Ruff on changed files / Debug UI `tsc` | Clean / clean |
| Debug UI in a real browser | "Do you have a red Toyota RAV4?" then "Used please. Anything bigger?": Search stock shows colour sent as `Red`, size loosened SUV → Minivan/Van/Truck, a used red F-150 loaded with its VIN |
