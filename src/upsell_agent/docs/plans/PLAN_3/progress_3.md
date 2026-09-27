# MASTER_PLAN_3 progress

Plan: [`MASTER_PLAN_3.md`](MASTER_PLAN_3.md). Build order (27 Sept): Part A (except the deferred items) → C1 → B1 → B5 → B4 → C3 → C4 → C5 → C6.

| Phase | State |
|---|---|
| A0. Decisions | Done (architecture.md §15, decisions 14–36) |
| A1. Inventory read layer | **Done, verified end to end (27 Sept 2026)** |
| A2. Shopping criteria | Not started |
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
