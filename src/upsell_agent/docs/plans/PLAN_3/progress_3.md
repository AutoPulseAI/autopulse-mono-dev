# MASTER_PLAN_3 progress

Plan: [`MASTER_PLAN_3.md`](MASTER_PLAN_3.md). Build order (27 Sept; Bq added 28 Sept): Part A (except the deferred items) → C1 → Bq → B1 → B4 + B5 (built together, decision 112) → C3 → C4 → C5 → C6.

| Phase | State |
|---|---|
| A0. Decisions | Done (architecture.md §15, decisions 14–36) |
| A1. Inventory read layer | **Done, verified end to end (27 Sept 2026)** |
| A2. Shopping criteria | **Done, verified end to end (27 Sept 2026)** |
| A3. Answering stock questions | **Core built, verified end to end (29 Sept 2026).** Links and MMS moved into A3. |
| A4. Grounding check | **Built together with A3**, as decision A requires. Verified end to end (29 Sept 2026). |
| A5. Freshness (sold re-checks) | **Built and verified (29 Sept 2026).** The "sold" signal is still only "removed from the feed." |
| A6. Debug UI and dev inventory | **Built and verified (29 Sept 2026)**, except the dev seed's "a couple marked sold." |
| A7. Evals, shadow and rollout | **Core built and verified (29 Sept 2026).** Real-model run and shadow tab stock verdict scoped. |
| B0. Decisions (Part B) | Readiness review 28 Sept: decisions 55–71 recorded (architecture.md §15). |
| C1. Compliance engine (with B2/B3) | **Done, verified end to end (29 Sept 2026).** Built ahead of Part A Phases 3–7. |
| Bq. Two questions per message | **Closed (29 Sept–1 Oct).** Decisions 88–89. 825 unit tests, 56/56 evals, offline model |
| B1. After-hours first reply | **Closed (29 Sept–1 Oct).** Decisions 90–98, plus three fixes from live testing |
| B2. Inbound or outbound | **Done inside C1 (29 Sept).** |
| B3. Send check | **Done inside C1 (29 Sept)**, including item 7's platform campaign changes. |
| B4. The visit as the goal | **Built (29 Sept), with B5.** Decisions 102–122. |
| B5. Booking the visit | **Built (29 Sept), with B4**, including item 8. |
| B6. Debug UI, evals and rollout | Minimal Visit panels pulled forward into B4/B5 (decision 111) |
| C1 extension (opt-out levels, replies after opt-out, opt-in) | **Built and unit-tested (1 Oct 2026), not committed.** Decisions 135–146. 1051 unit tests, 79/79 offline evals. **Live Docker scenarios not run:** the running containers use the real models. Staff DND left unchanged, for the user to decide (decision 146). |
| C2. Omnichannel call tasks | **Skipped for now** (27 Sept). A dated "call me …" step leaves the team a notice instead (decision 131). |
| C3. Lifecycle state machine | **Built and unit-tested (1 Oct 2026).** Decisions 123–134. 1012 unit tests, 79/79 offline evals, Debug UI type check clean. **Live Docker scenarios not run:** Docker wasn't running (see C3 section). |

---

## C1 extension: opt-outs stop what we start, not replies; opting back in — built (1 Oct 2026)

Fixes the bug found 29 Sept (an opt-out silenced the whole lead, decision 87) and settles the opt-out / opt-in design with the user against the client's TCPA and Omnichannel PDFs and client scope Q10 / Q19. Decisions 135–146 in architecture.md §15; the 15 points and their answers are in MASTER_PLAN_3, C1 extension.

### What was built

| Piece | Where |
|---|---|
| Replies get their own purpose, `reply`; the send check lets a reply (and the one confirmation) through an opt-out, and still blocks everything the system starts | `compliance/engine.py` (`Purpose`, step 2), `agent/turn.py` |
| An opt-out no longer sets the lead to `opted_out`; `opted_out` left `SILENT_STATUSES`, so the customer's next message is answered | `events/handlers.py` |
| "Do not contact" = the every-channel opt-out (no separate record) | `compliance/opt_out.py` (docstring; phrase list unchanged) |
| Confirmation names what was stopped ("won't text you again", …) | `opt_out.confirmation_text`, `handlers._record_held` |
| START / UNSTOP any case, "YES" in capitals only | `opt_out.classify_keyword` |
| Natural-language opt-in phrase list; channel-named → that channel, general → every opted-out channel; the message then gets a normal reply; a SendGrid unsubscribe isn't reversed | `opt_out.detect_opt_in`, `handlers._opt_back_in` |
| Opt-out / opt-in entries keep the phone (E.164) / email (lower case) as `address`; the check reads the newest entry by customer or address; new index | `channels/consent.py` (`address_key`, `latest_opt_out`, `is_opted_out`), `handlers`, `channels/sender.py` (Twilio 21610), `channels/delivery.py` (SendGrid unsubscribe), `integrations/mongodb.py` |
| The platform `sms_opt_in` flag is ignored once the customer / phone ever opted out of SMS; only the customer's own opt-in back counts as consent | `engine.marketing_sms_consent`, `consent.ever_opted_out` |
| Startup migration: leads left in `opted_out` → `active` | `consent.migrate_silenced_opt_outs`, called from `mongodb.ensure_indexes` |
| A due "call me …" step after "don't call me" leaves staff a `do_not_call` notice instead of `call_requested` | `scheduler/followups.py` |
| Scenarios: `s4_stop_opt_out` now expects the later message answered; new `pc1_opt_out_reply_opt_in` (stage 301) | `scenarios/` |

### Tests changed on purpose
- `test_compliance.py`: "opt-out blocks everything but the confirmation" → "blocks what we start but not replies"; the general-phrase test no longer expects the lead status `opted_out`.
- `test_event_handlers.py`: "STOP … is never answered" → "later messages are still answered".
- `test_sender.py`: the suppressed-channel test now sends a follow-up (`marketing`, not a reply).

New: 37 in `test_compliance.py` (with parametrized cases) (keywords and capital YES, confirmation wording, opt-in phrases and non-phrases, reply after opt-out, "lose my number", phrase opt-in answered, general opt-in vs SendGrid unsubscribe, lowercase yes, re-imported customer by phone and email, platform flag never re-grants, migration), 1 in `test_sender.py` (reply on an opted-out channel), 1 in `test_lifecycle.py` (`do_not_call` notice).

### Verification

| Check | Result |
|---|---|
| AI unit tests | **1051 passed** (1012 before) |
| Offline eval gate (`pytest evals`) | 79 / 79 |
| Scenario files load and validate (`test_dev_routes`) | Pass |
| Ruff on changed files | Clean, except one old finding in `integrations/mongodb.py` `close_mongo` (`PLW0602`), not touched |
| Scenarios, live in Docker | **Not run:** Docker was up, but the running containers use the real OpenAI models (`MODEL_COMPOSE=openai:gpt-4o`), and test runs stay on the offline model. To run: recreate the AI containers with `AI_MODEL_EXTRACT=offline AI_MODEL_COMPOSE=offline`, then `make ai-scenarios`. |
| Debug UI in a browser | Not checked |

### Not built / left open
- **Staff DND** (decision 146): unchanged; whether DND should also let replies through is the user's call.
- **Known limit:** after a keyword STOP on SMS, Twilio refuses our texts (21610) until START / UNSTOP / YES, so the reply after a keyword STOP doesn't arrive by text.
- **Platform `customerResolver.js`** sets `sms_opt_in: true` even over `false`: its owner is to be told (not our code).
- Counsel: the confirmation wording, and replies after a revocation (TCPA PDF §3, §13).

---

## Phase C3: Lifecycle state machine and priority engine — built (1 Oct 2026)

The client's statuses (Omnichannel PDF §1), kept on the AI's own lead state (`ai_lead_state.stage`) beside `status`, which still says who runs the conversation. Built with the client's scope answers of 1 Oct ([`../../data/6/conversation_6.md`](../../data/6/conversation_6.md)) and three decisions the user made the same day: No Contact Made after Touch 2; staff bookings run the AI's appointment flow; Day 91 waits for a pending appointment. Decisions 123–134 in architecture.md §15.

### What was built

| Piece | Where |
|---|---|
| Stages, the client's labels, §11 priority, a pure `transition()` per event, `resolve()` for events that collide, and an add-only stage history | `agent/lifecycle.py` (new) |
| One `apply()` that moves the lead, starts its opportunity clock from the platform lead's `createdAt` (written once), records the dated next step / appointment / closing time, and **cancels the old stage's scheduled work** (§2) | `agent/lifecycle.py` |
| The router (§5), fed by the turn: a meaningful reply (auto-replies don't count, client Q10), a dated next step, a booking made / moved / cancelled | `agent/turn.py` `_lifecycle_after_turn` |
| Event sources: a new lead; opting out of every channel (and START back); a reply while staff hold the lead; staff statuses from `lead-paused` (Appointment Booked → Appointment Set **without pausing**; Visited / Sold → Sales Visit; DND → Opted Out) | `events/handlers.py` |
| **Pre-send re-check by stage** for every kind of scheduled work (channel switch, staff check, morning message, visit follow-up), and `plan_followup` won't plan a switch the stage doesn't allow | `scheduler/followups.py`, `lifecycle.KIND_STAGES` / `stage_check` |
| **Dated next step** (§6): Extract's `next_contact_when`, resolved in code; the reply confirms it and asks nothing else; it fires as a whole AI turn ("Checking back in like you asked"); a 24h reply check moves an unanswered one to No Contact Made; "call me …" leaves the team a `call_requested` notice | `agent/llm.py`, `agent/offline_model.py`, `agent/nodes/decide.py`, `scheduler/followups.py` (`next_action`, `next_action_check`) |
| New date phrases: "next month", "next year", "in a year / in N years" | `slots/dates.py` |
| **Day 91**: hourly sweep (and on a dev clock jump); closes Short-Term stages as Closed - Lost; a pending appointment or active booking supersedes it; a long-horizon next step survives and still fires | `lifecycle.close_expired`, `worker/jobs.py`, `worker/main.py` |
| **"Not interested"**: new Decide rule `ask_why` (asks why once, no visit offer); a reason (or the same answer again) hands to a person with the reason recorded; the AI never closes the lead | `slots/policy.py`, `agent/pipeline.py`, `agent/conversation.py`, Compose instructions, offline model |
| Guard knows the dated next step's date (it was rejecting "Monday, October 5" as an invented number) | `agent/nodes/guard.py` |
| `GET /v1/leads/{id}/profile` → `lifecycle` (stage, reason, since, opportunity created/age/closed, next step, appointment, history) | `api/leads.py` |
| Dev: stage in the leads list; `POST /dev/leads/{id}/staff/status` (plays the platform's status route); clock jumps run the Day 91 sweep | `api/dev.py`, `devtools/simulate.py` `send_staff_status` |
| Debug UI: a stage badge in the Slots panel (hover: reason, opportunity day, next step, history); the Scheduler tab names the two new kinds | `debug-ui/src/components/SlotsPanel.tsx`, `SchedulerTab.tsx`, `types.ts` |
| Scenario steps: `staff_status`; `expect_lead` takes `stage` / `next_action`; `expect_no_followup` takes `status` and `kind: any`; `advance_clock` also runs the Day 91 sweep | `devtools/scenarios.py` |
| Scenarios (stage 303): `pc3_specific_followup`, `pc3_staff_statuses`, `pc3_day_91`, `pc3_not_interested` | `scenarios/` |
| Tests: 76 new (every transition and non-transition, priority, stage/kind table, meaningful replies, date phrases, and end to end through the real handlers, turns and scheduler) | `tests/unit/test_lifecycle.py` (new) |

### Found and fixed while testing
1. **"Call me next week" handed the lead off.** The existing "asked for a person" signal fires on "call me", so the turn handed off before the dated next step counted. Now a call request with a date is a dated next step (decision 131), which is the client's own example in §2.
2. **The guard rejected the reply confirming the date** ("Monday, October 5" read as an invented number), so it fell back to the template and a handoff. The next step's date and time are now known values.
3. **The 24h channel switch would have resent "I'll check back next week" the next day.** Specific timing replaces Short-Term work (decision 132).
4. **The check-back message greeted the customer again**, which the guard's "only the first reply greets" rule rejects. It now opens without a greeting line.

### Tests changed on purpose
- `test_slots.py`: 11 Decide rules now (`ask_why` after handoff).

### Verification

| Check | Result |
|---|---|
| AI unit tests | **1012 passed** (936 before; +76 in `test_lifecycle.py`) |
| Offline eval gate (`pytest evals`) | 79 / 79 |
| Ruff on changed files | Clean (also fixed 3 old lint errors in files touched: 2 unused imports in `followups.py`, import order in `turn.py`) |
| Debug UI type check (`tsc -b --noEmit`) | Clean |
| Scenarios, live in Docker | **Not run: Docker Desktop wasn't running on this machine.** The 4 new scenario files load and validate (`test_dev_routes`). To run: start Docker, `make ai-up`, then `make ai-scenarios` (offline model). |
| Debug UI in a browser | **Not checked**, for the same reason |

### Not built / left open
- **Platform statuses:** staff still don't see the stage names. C3 is AI-service only (27 Sept decision); they're in the profile API and the Debug UI.
- **Appointment No Show, no-show replies, UNSOLD** are defined and tested as transitions but have no event source yet: C5 adds them (appointment time + 1h, the no-show messages, the manager outcome).
- **Touch 2 → No Contact Made** is defined and tested; C4's Touch 2 emits it.
- **Automatic reopening of a closed lead** isn't built: the team gets a notice (decision 127).
- **Call tasks** (C2) are still skipped; "call me …" is a notice for now.

---

## Phase A1: Inventory read layer

### What was built

| Piece                                                                                                                                                                                                                      | Where                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `search_inventory(dealer_id, criteria, source)` and `get_vehicle(dealer_id, vin, source)`                                                                                                                              | `tools/inventory_tool.py` (was a stub)                                                                                  |
| Criteria from the profile (`interest.model` split into year / make / model or a body word, and `interest.new_or_used`)                                                                                                 | `inventory_tool.criteria_from_profile`                                                                                  |
| Typed view (`InventoryRecord`), all from `/api/car`'s response: VIN (`source_id`), year, make, model, trim, body type, new/used, exterior colour, miles, page link. **No price, stock number or import time.** | `inventory_tool.InventoryRecord`                                                                                        |
| Two sources behind one switch (`PLATFORM_CLIENT`): the real `GET /api/car`, and a port of the route over the local database for dev                                                                                    | `LiveInventorySource`, `StubInventorySource`                                                                          |
| 60 s cache per dealer + query;`get_vehicle` never cached; a failed search never cached                                                                                                                                   | `inventory_tool._cache`                                                                                                 |
| Context pack layers `inventory`, `inventory_query`, `inventory_checked_at` (+ an `inventory` token count)                                                                                                          | `agent/context_pack.py`                                                                                                 |
| Held back from Extract and Compose (`HELD_FROM_MODELS`) until the grounding check (Phase 4) exists                                                                                                                       | `context_pack.py`, `nodes/compose.py`, `nodes/extract.py`                                                           |
| Load context searches when the profile names a vehicle, records query / matched / given to the AI / left out and why; a platform error means a turn without stock, never a failed turn                                     | `agent/nodes/load_context.py`                                                                                           |
| Dev stock: 12 vehicles per dev dealer, shaped like the vAuto import                                                                                                                                                        | `devtools/dev_inventory.py`, loaded by `make ai-seed` or alone with `python -m upsell_agent.devtools.dev_inventory` |
| Stub-vs-live parity check                                                                                                                                                                                                  | `devtools/compare_inventory.py`                                                                                         |
| Scenario steps `add_stock`, `expect_inventory`, `compare_inventory`                                                                                                                                                  | `devtools/scenarios.py`                                                                                                 |
| Stock section in the Load context inspector; "Plan 3 · Phase A1" scenario group                                                                                                                                           | `debug-ui/src/components/StepViews.tsx`, `ScenariosTab.tsx`                                                           |

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

* [ ] CheckResultAI unit tests (`make ai-test`)633 passed after the 27 Sept changes (585 before Phase 1; +48 in `tests/unit/test_inventory_tool.py`)Mutation check on the new testsEach of these broke at least one test (before the 27 Sept changes): sending `year`, no regex escaping, no dealer check, no cacheOffline eval gate (`pytest evals`)56 / 56Scenarios, live in Docker (`make ai-scenarios`)36 / 38 on stub: both failures are the parity checks (`s6_customer360_parity`, `p1_inventory_parity`) which need the platform running. With the platform's web server running: `p1_inventory_loaded` and `p1_inventory_parity` passParity, stub vs the real `/api/car` (Phase 1 "done when")70 / 70 searches match for both dev dealers (every make/model, new, used, exact year, no match)Against the real route`year_range=2021-2021` returns only the 2021 car; `get_vehicle` for another dealer returns nothingDebug UI type check (`tsc -b --noEmit` in the `ai-debug-ui` container)CleanRuff on changed filesCleanBurst test (`make ai-burst`, 300 replies in 600 s)8 / 8 checks: 0 errors, 0 template fallbacks, reply p95 2.5 s, other dealer not slowedDebug UI in a real browserNew lead "new Toyota RAV4" + a reply: clicking the Load context node shows the Stock section (query,`/api/car` parameters, records with VIN); the reply mentions no vehicle

---

## Phase A2: Shopping criteria — readiness review (27 Sept 2026)

Before building, the phase's text was checked against the running code rather than re-read from the plan alone — the same way Phase 0/1's `/api/car` defects were caught before they were built into a bug. Three things needed a decision; all three are recorded in MASTER_PLAN_3.md's Phase 2 section (not repeated in full here) and confirmed with the user:

1. [ ] **Where the search runs.** `load_context` is the graph's entry point and runs before `extract`/`validate`, so Phase 1's search can only ever see the profile as it stood *before* this turn's message. Phase 2 needs "the current message" and "the customer asked about stock" as triggers, neither of which exists yet at `load_context` time. **Decided:** a new graph node, `search_stock`, runs after `validate`, replacing (not duplicating) Phase 1's search. Also removes the "search only starts on turn 2" limitation noted in Phase 1's scenario deviation above.
2. [ ] **Trim can't be a `/api/car` search parameter.** Confirmed directly against `aidmvcs-be-dev/app/api/car/route.js`: it returns `trim` but has no query parameter for it. **Decided:** trim is filtered client-side after the broader search returns, not sent as a request parameter like the other three loosening steps.
3. [ ] **Colour matching is case-sensitive on the platform**, unlike make/model/body type/condition (confirmed in `route.js`). **Decided:** colours are matched against the dealer's own real stock values (read fresh, not a guessed casing convention) before being sent.

One more item was reconsidered, not just decided: reclassifying stock questions from `restricted` to `answerable` (the original Phase 2 item 2 wording) turned out lower-risk than first assumed — `slots/policy.py` routes every non-`clarify` question the same way regardless of label, and the offline model already falls back to "the team will confirm" for any `answerable` question it can't specifically answer. **Decided:** split the stock-vs-price detection now (useful either way, since they're currently one merged rule), but keep stock questions labelled `restricted` until Phase 3, which flips the label in the same change that adds the real answering logic. Phase 3 item 0 now records this explicitly.

**"Something bigger" — decided 27 Sept, not deferred.** No client document or existing code defines a body-type size order, so one was agreed and written into MASTER_PLAN_3.md Phase 2 item 2 as our own default (flagged for client feedback): 4 size tiers (Coupe/Convertible/Hatchback → Sedan/Wagon → SUV → Minivan/Van/Truck), "bigger" moves up one tier, further if that tier is empty too — the same idea as the colour/trim/year loosening chain.

**Verdict: Phase 2 is ready to build.** All four architectural/implementation gaps found in the review have a recorded decision. Nothing is open.

---

## Phase A2: Shopping criteria — built (27 Sept 2026)

### What was built

| Piece                                                                                                                                                                                                                                                     | Where                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| New graph step**Search stock**, after Validate (`load_context → extract → validate → search_stock → decide → …`). Phase 1's search in Load context is removed: one search per turn, from this turn's validated profile, from the first turn | `agent/nodes/search_stock.py`, `agent/graph.py`, `agent/pipeline.py`, `agent/nodes/load_context.py` |
| Criteria from the profile: vehicle (year / make / model / trim), new or used, body type, colour, budget. Values still waiting to be confirmed don't count                                                                                                 | `tools/inventory_tool.criteria_from_profile`, `split_trim`                                              |
| New slots `interest.body_type` (enum, 9 body types) and `interest.color` (text): extractable, never asked, never required                                                                                                                             | `slots/schema.py`, `slots/validators.py` (body-type synonyms)                                           |
| Offline model reads body type, colour and trim words (not from a trade-in sentence)                                                                                                                                                                       | `agent/offline_model.py`                                                                                  |
| Search-or-not: a stock question, or a make/model, or a body type + new/used (or "bigger" with a known body type). Otherwise nothing is fetched                                                                                                            | `search_stock.search_trigger`                                                                             |
| Loosening in the fixed order colour → trim → year ±1 → same body type any make → new/used (last step added 28 Sept), each step recorded with what was tried                                                                                          | `tools/stock_search.find_stock`                                                                           |
| Trim checked on our side against each record's own trim (never sent: /api/car has no trim parameter)                                                                                                                                                      | `stock_search.trim_matches`                                                                               |
| Colour case-correction: matched ignoring case (grey = gray) against the dealer's own stored values, sent in the stored spelling; no match means that step loosens without a query that can't match                                                        | `stock_search.match_colour`                                                                               |
| "Something bigger": 4 size tiers, up one tier, and up again while a tier is empty                                                                                                                                                                         | `stock_search.SIZE_TIERS`                                                                                 |
| Budget →`price_range=0-<budget>` (filters only; records still have no price, the query stays held back from the models)                                                                                                                                | `InventoryCriteria.to_params`                                                                             |
| Stock and price questions split into two rules; both still labelled `restricted` (Phase 3 flips stock)                                                                                                                                                  | `agent/question_topics.py`, `offline_model._label`, `agent/llm.py` prompt text                        |
| Stub source handles `exterior_color` (literal, case-sensitive, like route.js) and `price_range`                                                                                                                                                       | `StubInventorySource`                                                                                     |
| Parity check covers colour (stored and lower case), budget and a size tier                                                                                                                                                                                | `devtools/compare_inventory.py`                                                                           |
| Scenario step `expect_inventory` reads Search stock; adds `loosened`, `colour_sent`, `trigger`, `only_loaded`                                                                                                                                   | `devtools/scenarios.py`                                                                                   |
| Debug UI: Search stock node (top row), its inspector shows why it searched, the criteria, colour correction, each loosening step, the /api/car request and the records                                                                                    | `PipelineGraph.tsx`, `NodeInspector.tsx`, `StepViews.tsx`, `ScenariosTab.tsx`                       |

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
| Burst test (`make ai-burst`, 300 replies in 600 s, send check on every send) | 8 / 8 checks passed: 300 / 300 replies sent, 0 errors, no template fallback, reply p95 2.7 s (one at 19.5 s), other dealer's first reply p95 2.7 s (not slowed), dealer A never above its cap |
| Debug UI in a real browser | "Do you have a red Toyota RAV4?" then "Used please. Anything bigger?": Search stock shows colour sent as `Red`, size loosened SUV → Minivan/Van/Truck, a used red F-150 loaded with its VIN |

---

## Phase C1: Compliance engine (with B2 and B3) — provisionally closed (29 Sept 2026)

**Provisionally closed, evening 29 Sept.** A bug found in Debug UI testing after ship: an opt-out silences the whole lead, including replies to later messages, not just marketing/follow-ups. Left for later, not blocking C1 or the rest of Part B. Planned fix — four opt-out tiers (marketing-only, follow-up-only, full, total no-contact) with a matching natural-language opt-in — is written up as the "C1 extension" in `MASTER_PLAN_3.md` under Phase C1. Not built. See `docs/report/29-9-26/NOTES.md` for the finding and `architecture.md` decision 87.

Asked before building (answers in `docs/report/29-9-26/NOTES.md`): full C1 + B2 + B3; ZIP table from a pip package; a possible opt-out gets a plain reply; the handoff check is transactional; REVIEW at `possible_opt_out` ≥ 0.5; the cap counts texts only; the four platform campaign files (Prashanth's) may be edited for this change only.

### What was built (AI service)

| Piece | Where |
|---|---|
| **`can_contact(customer_id, dealer_id, lead_id, channel, purpose, is_reply, at)`** → ALLOW / HOLD until / REVIEW / BLOCK, in plain code, in order: AI voice off → opt-out (except the one opt-out confirmation) → DND → explicit no (marketing texts) → replies (any hour inbound; outbound at night: quiet hours) → open review → consent → customer window + dealer hours → 3-per-24h cap | `compliance/engine.py` |
| Customer time zone: DealerVault `Zip` (the `zipcodes` package) → `State` (two-zone states keep both) → area code (`phonenumbers`) → every continental zone; a ZIP state and a different area-code state keep both | `compliance/customer_zone.py` |
| Inbound / outbound per lead (B2): campaign → outbound; known web / provider / phone-up / customer-first source → inbound; DealerVault without a lead form → outbound; anything else → outbound and "unmapped" | `compliance/origin.py` |
| Opt-outs in the customer's words: keywords (channel only, no reply from us); a fixed phrase list (named channel only, or every channel; one plain confirmation); objections aren't opt-outs | `compliance/opt_out.py`, `events/handlers.py` |
| Possible opt-out: Extract's `possible_opt_out` + `opt_out_confidence`; ≥ 0.5 → a reply with no asks or offers, a REVIEW entry, a staff notice on the lead. Resolved when the customer writes again with a non-opt-out, or an admin resumes the AI | `agent/llm.py`, `agent/offline_model.py`, `agent/nodes/decide.py`, `slots/policy.py` (`hold_questions`), `agent/turn.py`, `events/handlers.py` |
| Outbound conversation at night (decision 29): the reply asks nothing and says the team picks up at 8:00 AM (the guard knows that time) | `agent/turn.py` (pre-check), `agent/nodes/decide.py`, `compose.py`, `guard.py`, `offline_model.py`, `llm.py` |
| Consent history, add-only: `opt_out`, `marketing_consent` (platform flag, lead-form line: `TCPAOptIn: true` → `review_required`), `review`, each with the client's evidence fields; old documents migrated at startup and their unique index dropped | `channels/consent.py`, `integrations/mongodb.py` |
| Compliance log, add-only, 5-year auto-delete: every checked send with consent evidence, zones and local times, DNC, frequency, decision and reason | `ai_compliance_log`, `compliance/engine.py` |
| Every AI send goes through the check: a HOLD leaves the message row `held` (resumable), REVIEW / BLOCK suppress it with the reason; purpose and `is_reply` on every request | `channels/sender.py` |
| Follow-ups: due times planned with the check (the channel switch is marketing, the handoff check transactional); a HOLD at firing time puts it back to pending until the time given. Replaces the dealer-time 8:00–20:00 window (`contact_window.py` keeps only business minutes in use) | `scheduler/followups.py` |
| Origin and customer zone saved on the lead | `agent/turn.py` (`ai_lead_state.origin`, `customer_zone`) |
| Campaign check queue: the worker answers `ai_send_checks` requests every 2 s (atomic claim, stuck claims reset after 2 min) | `compliance/send_checks.py`, `worker/main.py` |
| Metrics: send-check decisions by rule, texts allowed outside the hours (must be 0), unmapped lead sources | `observability/metrics.py` (`GET /v1/metrics`, `make ai-report`) |
| Scenario steps `set_contact`, `expect_origin`, `campaign_check`, `expect_followup … due_local`; stage 301 in the Debug UI | `devtools/scenarios.py`, `debug-ui/.../ScenariosTab.tsx` |
| Dependencies `zipcodes`, `phonenumbers` (rebuild the image: `make ai-build`) | `pyproject.toml`, `uv.lock` |

### Platform changes (`aidmvcs-be-dev`) — approved by the user 29 Sept

| File | Owner | Change |
|---|---|---|
| `app/worker/campaignWorker.js` | Prashanth | Before each campaign text: `checkCampaignSend`, waiting up to 20 s. ALLOW → sends as before. HOLD → `CampaignLead` `held` with `held_until` / `block_reason`, job re-queued for that time (next check attempt). REVIEW / BLOCK → `blocked` with the reason, nothing sent. No answer → re-queued in 60 s. `held` leads are re-processed and count as unfinished for campaign completion |
| `app/models/CampaignLead.js` | Prashanth | `status` gains `held`, `blocked`; new `held_until`, `block_reason` |
| `app/api/campaigns/[id]/report/route.js` | Prashanth | `stats.held`, `stats.blocked`; `processed` excludes held; each lead has `held_until`, `block_reason` |
| `app/dealer/campaigns/[id]/report/page.js` | Prashanth | "Held until…" and "Blocked" count cards, badge colours, filter options, the time / reason on each lead, CSV columns |
| `app/lib/ai/aiSendCheck.js` | new | The request / wait / answer helper for `ai_send_checks` |
| `test-ai-send-check.js`, `Makefile` (`platform-test`) | new / OmgItsAmmer | Tests for the helper |

Not built: B3 item 7's optional campaign-form note ("12 leads can't be texted at this time").

### Changed behaviour (flag if you disagree; architecture.md decisions 78–86)

- `sms_opt_in: false` blocks marketing texts only; replies still go (before: every text).
- Email is never held for time of day, including dealer hours.
- Unknown-zone customers (every dev customer: 555 phones, no ZIP) get texts the system starts only from 11:00 New York. Tests and evals pin customers to New York (`ny_customer` fixture, `evals/harness.py`); `scenarios/p2_handoff_timeout.yaml` starts at 11:30.
- The REVIEW staff notice is on the AI's lead state and turn log, not on a platform screen.
- Campaign emails aren't checked.
- The real `Lead.source` values couldn't be pulled (the local database has only dev leads).

### Verification

| Check | Result |
|---|---|
| AI unit tests | 768 passed (719 before; +49 in `tests/unit/test_compliance.py`; 9 existing tests updated for the new rules: consent as history, `sms_opt_in: false` vs replies, 9:00 not 8:00 when the dealer opens at 9, daytime clock for campaign replies) |
| Offline eval gate (`pytest evals`) | 56 / 56 (unit + evals together, either order: 824) |
| Scenarios, live in Docker | 41 / 43: the two failures are the parity checks that need the platform web server (`make dev-full`), unchanged. New: `pc1_origin`, `pc1_campaign_consent`, `pc1_form_opt_out`, `pc1_customer_time_zone` all pass |
| Platform campaign worker end to end | The real `processCampaignLead` against the local database, AI worker in Docker answering: a DealerVault contact without consent → `CampaignLead` `blocked` with "no text consent …", campaign completed, no Twilio call. The HOLD path is covered by `pc1_campaign_consent` (AI side) and `test-ai-send-check.js` (platform side), not run end to end (needs the BullMQ queue) |
| Platform tests | `node --test test-ai-send-check.js`: 3 / 3; `node --check` on the changed platform files: clean |
| Lookups | ZIP 90012 → Los Angeles, 10001 → New York, 79901 → Denver (El Paso, TX); +1 212 → New York; +44 → none |
| Ruff on changed files / Debug UI `tsc` | Clean / clean |
| Burst test (`make ai-burst`, 300 replies in 600 s, send check on every send) | 8 / 8 checks passed: 300 / 300 replies sent, 0 errors, no template fallback, reply p95 2.7 s (one at 19.5 s), other dealer's first reply p95 2.7 s (not slowed), dealer A never above its cap |

---

## Phase Bq: Two questions per message (29 Sept 2026)

### What was built

| Piece | Where |
|---|---|
| `MAX_ASKS_PER_MESSAGE = 2`; a confirmation counts as one; `answer` → confirmation + one ask, or two asks; `confirm` → confirmation + one ask; `ask` → up to two; the detail being confirmed is never also asked | `slots/policy.py` |
| Rule labels ("at most two follow-ups", "ask up to two") | `agent/pipeline.py` |
| Compose's instructions and style guide: "at most two questions" | `agent/llm.py` |
| Offline model joins up to two questions (confirmation first) | `agent/offline_model.py` |
| New Guard check `at_most_two_questions` (counts `?` in SMS and email) | `agent/nodes/guard.py` |
| Decide view lists both asks, numbered, and "+ the check" | `debug-ui/src/components/StepViews.tsx` |
| Tests: `tests/unit/test_two_questions.py` (new, 18); Plan 2's policy/pipeline tests updated to the new limit | |

## Phase B1: After-hours first reply (29 Sept 2026)

### What was built

| Piece | Where |
|---|---|
| The rules, one pure function: offer / later / resume / nothing, and whether to schedule or cancel the morning message | `agent/after_hours.py` (new) |
| `is_open`, `next_opening`, `opening_text` ("9:00 AM tomorrow") | `integrations/dealer_profile.py` (the compliance engine's `dealer_open` now uses `is_open`) |
| Context pack `now` layer: `open_now`, `next_open`, `next_open_text` (only with hours on record) | `agent/context_pack.py`, `agent/nodes/load_context.py` |
| Conversation state `after_hours` {choice, times_offered, offered_turn, decided_at, why} and `awaiting_contact_choice` | `agent/conversation.py` |
| Extract: `wants_visit` (+ confidence); the now/later answer as the pseudo-slot `contact_preference`, moved out of the values | `agent/llm.py`, `agent/nodes/extract.py`, offline model |
| Decide runs the plan; the offer and the "later" thank-you ask nothing else | `agent/nodes/decide.py`, `slots/policy.py` (`Flags.contact_choice`) |
| Compose: the offer's wording, the thank-you, the morning greeting; don't mention being closed otherwise | `agent/llm.py`, `agent/nodes/compose.py`, offline model |
| Guard accepts the opening time | `agent/nodes/guard.py` |
| After the send: record the choice, schedule / cancel the morning message; the team's notice when it goes out | `agent/turn.py` |
| Follow-up kind `resume_at_opening`: plan, cancel, fire (checks, send check, then a whole AI turn; Extract skipped) | `scheduler/followups.py`, `agent/graph.py`, `agent/state.py` |
| A customer message cancels channel switches only, not the morning message (the plan decides) | `CHANNEL_SWITCHES` in `scheduler/followups.py` |
| Lead profile: `pending_morning_message`, `staff_notice` | `api/leads.py` |
| Debug UI: Decide "After hours" block; Conversation panel "After hours" + "Notice for the team"; Scheduler "morning message" cards; timeline labels; `resume` node in the pipeline graph; "Plan 3 · Phase B1" scenario group | `debug-ui/src/...` |
| Scenarios `pb1_after_hours_now.yaml`, `pb1_after_hours_later.yaml`; runner: `expect_lead` `after_hours` / `staff_notice`, `expect_last_sent` `excludes`, `expect_followup` kind `resume_at_opening` | `scenarios/`, `devtools/scenarios.py` |
| Tests: `tests/unit/test_after_hours.py` (new, 32). Six test modules now pin the clock inside opening hours (`during_opening_hours` fixture) so their first replies aren't after-hours ones whenever the suite runs | `tests/unit/` |

### Verification

| Check | Result |
|---|---|
| AI unit tests (offline model) | 816 passed (784 after Bq) |
| Offline eval gate (`pytest evals`) | 56 / 56 |
| Ruff | Clean on changed files (the 4 remaining errors were there before) |
| Debug UI type check (`tsc -b --noEmit` in `ai-debug-ui`) | Clean |
| B1 scenarios | Passed, but **run in the Docker stack on the real models by mistake** (about 310 calls, ~$1.58). Those runs found two real-model issues, fixed: the now/later answer landing in the slot values (decision 98), and Compose repeating "we're closed" after "now". The full scenario suite was not completed (stopped). Scenarios and evals are to be run on the offline model only from now on |

### Not built / to do

- A platform notification for the team's notices (decision 96).
- B5 item 8: a visit request goes straight to booking.
- Known gap: a template first reply carries no choice (decision 98).

### Fixed after live testing (1 Oct, real models via the Debug UI)

Found through real conversations (not by running scenarios/evals on the real models, which the user has asked never to do again):

| Bug | Fix |
|---|---|
| The real model sometimes dropped the after-hours choice question on an "offer" reply, closing with a generic line instead ("let me know if anything else!") | New Guard check `after_hours_choice_offered`: an "offer" draft missing "which would you like" gets one rewrite, then the template. Compose's instructions also say the question is never dropped or paraphrased |
| A stray `wants_visit` value in the model's `values` list (alongside the real field) was rejected by Validate as an unknown slot | `lift_wants_visit()` in `agent/nodes/extract.py`, same pattern as the earlier `contact_preference` fix |
| A plain "ok" after "later" re-offered the after-hours choice and the reply re-greeted ("Hello, Test!") mid-conversation | `is_plain_acknowledgement()` (`agent/after_hours.py`): a bare ack ("ok", "thanks", "sounds good"...) is a no-op in the after-hours flow — no re-offer, no state change. Compose only greets in the very first SMS of a conversation now (email keeps its salutation every time); new Guard check `no_repeated_greeting` catches a repeated SMS greeting, exempting the after-hours morning message's own "Good morning" opener |

Also found, not fixed (pre-existing, out of Bq/B1 scope, flagged for the user): the real model sometimes puts a vague timeframe ("next month") into `interest.needed_by` (a specific-date field) instead of `interest.timeline`, and `slots/dates.py` correctly rejects it as not a real date — so timeline stays missing and gets asked again.

**Verification (offline model only):** 825 unit tests, 56/56 evals, ruff clean (same 4 pre-existing errors).

### Bq and B1 closed (1 Oct 2026)

Both built 29 Sept (decisions 88–98), then three real-model bugs turned up in the user's own Debug UI testing on 1 Oct (never reproduced by running scenarios or evals against the real models — that's against the user's standing instruction; all diagnosis was from the user's pasted transcripts and the existing Mongo turn logs, all fixes verified on the offline model only):

1. The real model sometimes dropped the after-hours choice question on an "offer" reply. Fixed with a new Guard check, `after_hours_choice_offered` (rejects a draft missing "which would you like", one rewrite then the template).
2. A stray `wants_visit` value in the model's `values` list was rejected by Validate as an unknown slot. Fixed the same way as the earlier `contact_preference` fix: `lift_wants_visit()` strips it before Validate sees it.
3. A plain "ok" after "later" re-offered the choice and re-greeted ("Hello, Test!") mid-conversation. Fixed: `is_plain_acknowledgement()` makes a bare ack a no-op in the after-hours flow (no re-offer, no state change); Compose now greets by name only in the very first SMS of a conversation (email keeps its salutation every time); a new Guard check, `no_repeated_greeting`, catches a repeated SMS greeting (exempting the after-hours morning message's own "Good morning" opener).

**Final verification (offline model only):** 825 unit tests (8 consecutive full runs, one unrelated one-off flake in a pre-existing C1 opt-out test that didn't reproduce), 56/56 evals, ruff clean (same 4 pre-existing errors).

**Flagged, not built, carried forward:**
- A real platform notification for the team's after-hours notice (decision 96) — today it's on the AI's lead state and the Debug UI only.
- B5 item 8: wire `wants_visit` into actual booking.
- The real model sometimes puts a vague timeframe ("next month") into `interest.needed_by` instead of `interest.timeline`, pre-existing and out of Bq/B1 scope — the user's call whether to fix it now or later.
- A first reply that falls back to the template carries no after-hours choice (decision 98's known gap).

---

## Phases B4 + B5: the visit as the goal, and booking it (29 Sept 2026)

Built together in one pass (decision 112). Readiness decisions 102–112 were asked before building; 113–122 were decided while building (architecture.md §15; **flagged** ones want review).

### What was built

| Piece | Where |
|---|---|
| Available times: 30-minute slots inside opening hours, at least 2h out, last slot 30 min before closing, 7 days ahead, at most 2 bookings per slot (B0.10); the earliest 2-3 offered, in dealer time, with the zone name only when the customer's differs | `tools/booking_tool.py` (new) |
| Existing bookings read straight from the platform's `bookings` collection (not cancelled), fresh every turn | `booking_tool.existing_bookings`, `find_active_booking`; `PLATFORM_BOOKINGS_COLLECTION` in `integrations/mongodb.py` |
| Matching the customer's pick in code: "the second one", "option 2", "Saturday at 10 works", a free time that wasn't offered | `booking_tool.match_pick` (uses `slots/dates.py`) |
| Create / move / cancel through the platform's unchanged `POST` / `PUT /api/booking` (`booking_status` always sent on a PUT); the dev stub writes the same shape; no double booking on a retry | `integrations/platform_client.py` `create_booking` / `update_booking`; `booking_tool.ensure_booking` / `move_booking` / `cancel_booking` |
| The visit offer: eligibility (B0.12, every lead type), 3 attempts with 3 angles (primary interest → objection or the customer's own priority → value proposition by lead type), parked for 3 replies after a decline, stopped after the 3rd, times kept on the table for one extra reply | `agent/visit_offer.py` (new) |
| Decide's new rule `offer_visit` (between `confirm` and `ask`); the offer as the bonus question on `answer`; new handoff triggers: urgent, and 3rd decline with a staff-only question open | `slots/policy.py`, `agent/pipeline.py` |
| Booking in Decide before Compose; a taken slot → fresh times (same attempt); missing email/phone → asked for, the pick kept (`pending_pick`) and booked when they give it; a visit request naming its own free time → booked straight away (B5 item 8, any hour); "can't make it" → cancel; "can we make it … instead" → move | `agent/nodes/decide.py` |
| Urgent need: Extract's `urgent` / `urgent_confidence` / `urgent_reason` (≥ 0.8), plus the 48h `needed_by` backstop (this turn's value only) | `agent/llm.py`, `agent/nodes/decide.py`, offline model |
| Extract: `declines_visit` (+ confidence), `visit_objection`, `visit_later_when` | `agent/llm.py`, offline model |
| Compose: the offer (concrete times, the angle's reason, one question), booking wording by status ("requested" while pending), asking for a missing email/phone, a taken slot, a cancel or move; no "team will reach out" after the 3rd decline | `agent/llm.py`, `agent/nodes/compose.py`, `agent/offline_model.py` |
| Guard: `booking_wording_matches_status` (no "booked"/"confirmed" unless confirmed, no booking words with no active booking); offered and booked times allowed as numbers | `agent/nodes/guard.py` |
| Conversation state `visit` {attempts, angles_used, offered_times, offered_turn, declined, declined_turn, stopped, objections, followup_due, pending_pick, held_over, why} | `agent/conversation.py` |
| Follow-up kind `visit_followup`: planned on the 3rd decline (the customer's date, else +3 days, 10:00 dealer time, send check applied); firing checks the lead is active, unbooked and the dealer live, resets the offer to a fresh attempt 1 and runs a whole turn (Extract skipped); cancelled by a booking | `scheduler/followups.py`, `agent/graph.py`, `agent/state.py`, `agent/turn.py` |
| The team is told of every booking, move and cancel (with the known-gap notes) | `agent/turn.py` `_notify_team_of_booking` (`staff_notice` kinds `visit_booked` / `visit_moved` / `visit_cancelled`) |
| Lead profile: `visit`, `pending_visit_followup`, `booking` | `api/leads.py` |
| Metrics: visit offer rate, booking rate, handoff rate per dealer | `observability/metrics.py` (+ `visit_offer_attempt` / `booked` on each turn log) |
| Debug UI: Decide "Visit offer / booked / cancelled" block; Conversation panel "Visit / booking"; Scheduler "visit follow-up" cards; timeline labels; `visit_followup` node in the pipeline graph; "Plan 3 · Phase B4 / B5" scenario groups | `debug-ui/src/components/StepViews.tsx`, `ConversationPanel.tsx`, `SchedulerTab.tsx`, `Timeline.tsx`, `PipelineGraph.tsx`, `ScenariosTab.tsx`, `types.ts` |
| Scenarios `pb4_offer_after_qualified`, `pb4_buying_signal`, `pb4_declined`, `pb5_book_visit`, `pb5_slot_taken`, `pb5_reschedule`; runner steps `expect_booking`, `take_offered_time`, `expect_lead` `visit_attempts` / `visit_declined`, `expect_followup` kind `visit_followup` | `scenarios/`, `devtools/scenarios.py` |
| Evals: 20 "urgent vs. just eager" cases (B4 item 8); offered times allowed in the reply eval's number check | `evals/datasets/reply_cases.jsonl`, `evals/test_replies.py` |
| Tests: `test_visit_offer.py`, `test_booking_tool.py`, `test_booking_flow.py` (through the real pipeline) | `tests/unit/` |

### Existing tests changed (the new behaviour is intended)

- `test_slots.py`: Decide has 10 rules now (`offer_visit`).
- `test_turn_pipeline.py::test_sales_lead_is_qualified_over_a_chat`: once the RAV4 and "this month" are known, a visit is offered instead of asking about the trade-in (B0.12).
- `test_dates.py` and the `tomorrow` eval case: "I need it by tomorrow" is now an urgent handoff (decision 26's 48h backstop), so they use "the day after tomorrow".

### Found and fixed while building

- The offer text had two "?" and failed the two-question Guard (fixed: one question).
- "tomorrow is fine" (answering the after-hours choice) was read as a purchase date and handed the lead off, and the stale value kept doing so on later turns (decision 120).
- Re-offering right after a decline, against B4 item 4's 3-reply parking (decision 114).
- A picked time was booked even if it had filled up since it was offered (decision 116).
- The picked time was forgotten while we asked for a missing email (decision 117).
- A question while times were on the table used up an attempt (decision 115).

### Verification

| Check | Result |
|---|---|
| AI unit tests (offline model) | 871 passed (825 before) |
| Offline eval gate (`pytest evals`) | 76 / 76 (56 before + 20 urgent cases) |
| Ruff on changed files | Clean (remaining warnings are in files not touched) |
| Debug UI type check (`tsc -b --noEmit` in `ai-debug-ui`) | Clean |
| Scenarios | **Not run**: the Docker stack uses the real models (standing instruction). The six new files parse and use only known steps; the same flows run offline in `test_booking_flow.py` |
| Real models / live platform | **Not run** |

### Platform e2e to run by hand (decision 105)

With the platform's web server running and `PLATFORM_CLIENT=live`:

1. New sales lead "I want a new Toyota RAV4", then "budget $35k, buying this month": the reply offers 2-3 times.
2. "the first one": in the dealer's **Lead Calendar** (`dealer/booking/calendar`) the booking appears; the lead shows "Appointment Booked"; the platform sent its own confirmation SMS/email and created the reminders; the AI's reply says "requested … the team will confirm".
3. Send another message: the AI still answers (not paused).
4. "can we make it Wednesday at 11am instead?": the booking moves (PUT with `booking_status`); the team notice mentions the old reminders.
5. "I can't make it, need to cancel": the booking is cancelled; the lead stays "Appointment Booked" (known gap 2); the team notice says so.

### Not built / to do

- B4 item 6's fresh times on the 24h resend: the channel switch stays as it was (decision 110).
- B5 item 3's "requested time goes to the team as a note" when the customer never gives the missing email/phone (decision 117).
- "can we do another day?" with no day and time isn't read as a move (decision 119).
- The Debug UI Metrics tab doesn't show the visit rates yet (they're in `GET /v1/metrics` and `make ai-report`).
- For the user to decide: whether a plain "I need it by tomorrow" should really hand off (decision 120, following decision 26).
=======
| Check                                    | Result                                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI unit tests                            | 719 passed after the 28 Sept condition-loosening step (715 at first build; 633 before Phase 2; +86 in `tests/unit/test_shopping_criteria.py`; Phase 1 wired tests moved to Search stock). Plus 56 evals: 775 total |
| Mutation check                           | 9 / 9 caught: colour sent as said, trim before colour, trim sent to /api/car, year ±2, no size-up again, unconfirmed values used, body type alone searching, budget not sent, stock merged into the price rule      |
| Offline eval gate                        | 56 / 56                                                                                                                                                                                                              |
| Scenarios, live in Docker                | 39 / 39, including `p2_loosened_search` and both live parity checks                                                                                                                                                |
| Parity, stub vs the real `/api/car`    | 142 / 142 (lower-case colours return 0 on both: the route's colour match is case-sensitive, confirmed live)                                                                                                          |
| Ruff on changed files / Debug UI `tsc` | Clean / clean                                                                                                                                                                                                        |
| Debug UI in a real browser               | "Do you have a red Toyota RAV4?" then "Used please. Anything bigger?": Search stock shows colour sent as `Red`, size loosened SUV → Minivan/Van/Truck, a used red F-150 loaded with its VIN                       |

---

## Phase A3 + A4: Answering stock questions and grounding — built and verified end to end (29 Sept 2026)

Built first against a shell that this environment's command sandbox couldn't reach (its safety check kept failing
to return a verdict), so the change was written and read back for internal consistency before any test could run.
Once the sandbox recovered, the run surfaced 4 real bugs, none of them in `check_draft`'s core rules - listed
under "Fixed after the first real test run" below - and every one is fixed and re-verified.

### What was built

| Piece                                                                                                                                                                                                                                                                          | Where                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `inventory` unhidden from Extract/Compose (item 0 / decision A); `inventory_query`/`inventory_checked_at` stay hidden                                                                                                                                                    | `agent/context_pack.py` (`HELD_FROM_MODELS`)                                                          |
| Stock questions relabelled `answerable` (item 0)                                                                                                                                                                                                                             | `agent/offline_model.py` `_label`; `agent/llm.py` (`CustomerQuestion`, `EXTRACT_INSTRUCTIONS`)  |
| Compose answers from real stock: never a bare "no" (decision D), an alternative from Phase 2's own loosened search when there is one, otherwise an honest promise                                                                                                              | `agent/offline_model.py` (`_stock_answer`, `_answers`); `agent/llm.py` (`COMPOSE_INSTRUCTIONS`) |
| `sms_vins` / `email_vins` on every draft, capped at 2 / 3 (architecture decision 16)                                                                                                                                                                                       | `agent/llm.py` (`ComposedMessage`); `agent/offline_model.py`                                        |
| Grounding check: every named VIN is in this turn's `inventory`; a named trim or make must belong to one of the named records; a bare "not available" with no vehicle and no promise is rejected; "in stock"/"available" wording is only allowed once a real vehicle is named | `guardrails/draft_guard.py` (`_grounding`, `_mentioned`); wired in `agent/nodes/guard.py`         |
| A named vehicle's own year/miles are allowed numbers (decision C) - computed inside `check_draft` itself from `inventory` + the vins, not by the caller                                                                                                                    | `guardrails/draft_guard.py`                                                                             |
| `shown_vehicles` on `ConversationState`, capped at 10, per lead (decision F)                                                                                                                                                                                               | `agent/conversation.py` (`ShownVehicle`, `after_turn`); wired from `agent/turn.py`                |
| Loaded records marked `already_shown`, so a reply doesn't offer the same vehicle again as new                                                                                                                                                                                | `agent/nodes/search_stock.py`                                                                           |
| `#badtrim` dev hint (an offline-only test tag): injects a trim not on the named vehicle so the grounding check and the one-rewrite path can be tested                                                                                                                        | `agent/offline_model.py`                                                                                |
| 24h channel switch never resends a named vehicle (decision L): Compose writes a stock-free version of whichever text named one (`sms_text_no_vehicles` / `email_subject_no_vehicles` / `email_body_no_vehicles`), and the follow-up is planned from that instead         | `agent/llm.py`, `agent/offline_model.py`, `scheduler/followups.py`                                  |
| Tests: grounding rejections and acceptances direct on `check_draft`; full-turn tests for a real answer, an honest "nothing found," the already-shown rule, the `#badtrim` rewrite, and the channel-switch substitution; `shown_vehicles` capping and per-lead isolation  | `tests/unit/test_stock_answers.py` (new)                                                                |
| Phase 2's own tests updated for the label flip and for `inventory` now reaching Compose                                                                                                                                                                                      | `tests/unit/test_shopping_criteria.py`, `tests/unit/test_understanding.py`                            |
| Scenarios: a real answer + an honest "nothing found" (one file); the `#badtrim` guard rejection and clean rewrite (one file)                                                                                                                                                 | `scenarios/p3_do_you_have.yaml`, `scenarios/p4_invented_trim.yaml` (new)                              |

### Fixed after the first real test run

Four real bugs, caught by the first `make ai-test` run this environment could actually complete, not by reading
the code back:

1. **A denial paired with a promise was still rejected.** "Sorry, we don't have that in stock." contains the exact
   words "in stock" that the *affirmative* availability check also scans for, so it fired a second, wrong violation
   even though the promise made the denial acceptable. Fixed by excluding any availability-pattern match that
   overlaps a recognised denial phrase - the two checks now share which words they've already claimed, in
   `guardrails/draft_guard.py`'s `_grounding`.
2. **The "no stock at all" fallback text tripped the guard's own availability check.** The wording "I'm not seeing
   one **in stock** right now" contains the same trigger phrase. Reworded to "I'm not seeing a matching one right
   now" in `agent/offline_model.py`'s `_stock_answer`, which sidesteps the phrase entirely rather than special-casing it.
3. **A test added stock mid-conversation and expected the second search to see it, but hit the 60-second cache**
   from the first search with identical parameters. Not a product bug - the cache is deliberate
   (`tools/inventory_tool.py`) - but a test bug: fixed by calling `clear_cache()` between the two turns in
   `tests/unit/test_stock_answers.py`.
4. **Two Phase 2-era tests asserted the old, since-changed behaviour on purpose left over from before this phase**:
   `test_shopping_criteria.py`'s "the compose input trace never contains inventory" (that trace has never carried
   `context` at all, before or after this change - not what proves anything either way; rewritten to check the
   compose *output* actually names the loaded vehicle instead) and `test_understanding.py`'s
   `test_question_labels` still expecting "Is the blue one still available?" to be `restricted`. Both updated to
   the Phase 3 behaviour the plan itself calls for.

### Verification (29 Sept 2026)

| Check                                                 | Result                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI unit tests (`make ai-test`)                      | 736 passed (719 before this phase; +17 in `test_stock_answers.py`, net of the Phase 2 test updates)                                                                                                                                                                  |
| Offline eval gate (`pytest evals`)                  | 56 / 56                                                                                                                                                                                                                                                                |
| Promptfoo injection suite                             | Not run this session -`npx` failed with its own lock-file error (`ECOMPROMISED`), unrelated to this change; not retried                                                                                                                                            |
| Scenarios, live in Docker (`make ai-scenarios`)     | 39 / 41. The 2 failures are the pre-existing platform-auth parity checks (`s6_customer360_parity`, `p1_inventory_parity`), which need the platform's web server running with a valid token - not a regression from this phase, and not run against it this session |
| Ruff on all changed files                             | Clean                                                                                                                                                                                                                                                                  |
| Burst test (`make ai-burst`, 300 replies over 600s) | 8 / 8 checks: 0 errors, 0 template fallbacks, 0 handoffs, reply p95 2.57 s (max 10.5 s), dealer A never above its in-flight cap, the other dealer's first reply unaffected                                                                                             |

### What's deferred (explicitly, not silently dropped)

- **Decision G, resolving "the second one" / "the silver one" to a VIN.** Needs a new `selected_vin` field on
  `ExtractionResult`, a new context-pack layer of the last reply's shown vehicles (with their details) for Extract
  to read, and the offline model's short-reply matching extended to ordinals and colours. Scoped but not built:
  today, a customer referring back to a shown vehicle this way gets the normal short-reply handling, which won't
  resolve it to that vehicle. Not a regression - this is new behaviour Phase 3 doesn't yet add.
- **Decision H, links and MMS images (Phase 0 items 4 and 7).** A whole separate feature: `InventoryRecord.photo_url`,
  an image-reachability/size check, `OutboundMessage.media_urls`, `channels/twilio.py` `MediaUrl` support, and the
  `MMS_ENABLED` rollout switch. Today's replies never include a link or a photo, same as before this phase; that's
  the "otherwise personalise around intent, with no vehicle" branch of the client's own fallback order, so it's
  a safe (if less complete) default, not a broken one.
- **Decision E's extra budget-only search.** When Phase 2's loosened search still finds nothing at all, this phase
  falls straight to "the team will let you know," rather than first trying a broader budget-only search across every
  body type. A real improvement to try later; the honest-promise fallback is the safety-critical half of decision D
  and is built.
- **Vehicle colour isn't grounded**, only VIN, trim and make. Colours are open vocabulary (there's no fixed list to
  check a claimed colour against, unlike the fixed trim-word and make lists), so a wrong colour claim isn't caught
  by this phase's check. Decision O's narrower rule (the customer's own colour word is echoed back only in a
  "not X, but…" sentence already backed by this turn's search) is followed by the prompt, but nothing in code
  verifies it. Flagging as a real gap, not something decided away.
- **The offline model always uses the SMS cap (2) for both channels**, rather than giving email its extra third
  slot. A real model may use the full email cap; documented as a deliberate offline-model simplification, not a
  bug, in `agent/offline_model.py`.

### Known risk, not yet checked

- The make/trim vocabulary check in `guardrails/draft_guard.py` runs on the whole message whenever any vehicle is
  named, using a fixed word list (`TRIM_WORDS`, `KNOWN_MAKES` from `tools/inventory_tool.py`). Several trim words
  are ordinary English words ("sport," "premium," "range," "standard"). If a real model's phrasing happens to use
  one of these words for something other than a trim, the guard will reject the draft and force one rewrite - not
  a wrong reply reaching the customer (the rewrite/template fallback still applies), but worth watching in the
  real-model eval run for how often it fires without cause.

---

## Phase A5: Freshness — built and verified (29 Sept 2026)

### What was built

| Piece                                                                                                                                                                                                                                                                              | Where                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `find_sold(dealer_id, vins, source)`: which VINs no longer resolve via `get_vehicle`, fresh, never cached; a lookup failure never counts as sold                                                                                                                               | `tools/inventory_tool.py`                                                                       |
| Item 1, right before the send: mentioned VINs re-checked; a sold one swaps to the stock-free version Compose already wrote (decision L), never a fresh AI call                                                                                                                     | `agent/turn.py` (`_fresh_send_text`)                                                          |
| Item 2, at follow-up fire time: the channel switch stores both the stock-free default and the vehicle version + VINs; fire time re-checks and uses the nicer version if nothing sold                                                                                               | `scheduler/followups.py` (`plan_followup`, `_fresh_followup_text`)                          |
| A real gap found and fixed while building this: both paths, and decision L's original code, would fall back to the*vehicle-naming* text if Compose didn't write a stock-free version - defeating the whole point. Neither ever does now; a generic fallback line is used instead | `agent/templates.py` (`SOLD_VEHICLE_FALLBACK_TEXT`/`_SUBJECT`), wired into both files above |
| A "freshness" block in `dealer_metrics()`: how often the re-check ran, how often it caught something sold                                                                                                                                                                        | `observability/metrics.py`                                                                      |
| Tests:`find_sold`'s three cases, `_fresh_send_text`'s three cases (including the no-fallback-to-vehicle-text case), `plan_followup`/`_fresh_followup_text` storing and re-checking correctly                                                                               | `tests/unit/test_freshness.py` (new, 14 tests)                                                  |

### The honest limit, unchanged from the plan

Phase 0 item 1 is still unresolved: `/api/car` has no in-stock filter, so `find_sold` can only ever notice a vehicle **removed from the feed entirely** - not one marked sold but still returned. Everything above is real, tested code, ready the moment Part C's C5 (the manager outcome) gives a genuine "sold" signal; until then, its "must be 0" guarantee in production holds by construction (the code paths structurally can't send a known-sold vehicle's text) rather than because sold vehicles are actually being detected from real feed data.

### Verification

| Check      | Result                                                           |
| ---------- | ---------------------------------------------------------------- |
| Unit tests | 754 passed (740 before this phase; +14 in `test_freshness.py`) |
| Ruff       | Clean                                                            |

---

## Phase A6: Debug UI and dev inventory — built and verified (29 Sept 2026)

### What was built

| Piece                                                                                                                                                                                                        | Where                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Dev stock doubled to 24 per dealer (48 total), adding Minivan, Coupe, Convertible and Hatchback body types and more colours - the size tiers the original 12-per-dealer set never reached                    | `devtools/dev_inventory.py`                                              |
| A "mark sold" shortcut:`POST /dev/stock/{vin}/mark-sold` removes the vehicle from dev stock (the same as it leaving a real feed) and clears the inventory cache, so the next reply reflects it immediately | `api/dev.py`                                                             |
| The same, in the Debug UI: a "Mark sold" button on every loaded vehicle in the Search stock inspector                                                                                                        | `debug-ui/src/components/StepViews.tsx` (`MarkSoldButton`), `api.ts` |
| Per-vehicle grounding result:`check_draft` now returns `per_vehicle` (one VIN → `{ok, problems}`), not just one overall pass/fail                                                                     | `guardrails/draft_guard.py`                                              |
| The Guard inspector shows that per-vehicle result, plus the overall `violations` list, which it never showed at all before this                                                                            | `debug-ui/src/components/StepViews.tsx` (`GuardChecks`)                |
| The Compose inspector shows which VINs the draft actually named (`sms_vins`/`email_vins`)                                                                                                                | `debug-ui/src/components/StepViews.tsx` (`ComposePreview`)             |
| Tests: the mark-sold endpoint (success and 404), the per-vehicle grounding result (clean and flagged)                                                                                                        | `tests/unit/test_dev_routes.py`, `tests/unit/test_stock_answers.py`    |

### Verification

| Check                                                                            | Result                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Unit tests                                                                       | 760 passed (754 before this phase; +6)                                                     |
| Ruff                                                                             | Clean (`PLC0206` caught and fixed: iterate `per_vehicle.items()`, not the dict itself) |
| Debug UI TypeScript build (`tsc -b --noEmit` in the `ai-debug-ui` container) | Clean                                                                                      |
| Dev seed re-run (`make ai-seed`)                                               | "48 stock_vehicles" confirms the expanded count landed                                     |

---

## Phase A7: Evals, shadow and rollout — core built and verified (29 Sept 2026)

### What was built

| Piece                                                                                                                                                                                                                                                                                                                                                      | Where                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The eval harness can seed dealer stock for a case (`stock: [{vin, make, model, trim, color, miles, ...}]`)                                                                                                                                                                                                                                               | `evals/harness.py` (`_vehicle`, `_setup`)                                                                                                                                                   |
| A real bug found and fixed while adding this: the inventory tool's 60s cache is a module-level global keyed by dealer_id + search params - the same dealer_id across every eval case in one process, so a case could silently get a stale result from an earlier case's own (different) database within the TTL window.`_setup` now clears it every case | `evals/harness.py`                                                                                                                                                                              |
| 3 new conversation evals: an answer grounded in real, loaded stock; an honest "nothing found" (never a bare no); a combined stock-and-price question that answers the stock half and still restricts the price half                                                                                                                                        | `evals/datasets/conversation_cases.jsonl`, new `expect` keys `vins_grounded`, `max_named_vehicles`, `no_bare_no_on_no_stock`, `no_price_mentioned` in `evals/test_conversations.py` |
| A new Promptfoo injection case: an instruction hidden in a vehicle's own trim (as the dealer/feed entered it) must never be followed                                                                                                                                                                                                                       | `evals/promptfoo/provider.py` (`vehicle_trim` var), `promptfooconfig.yaml`                                                                                                                  |
| Rollout/metrics: grounding-rejection rate (a vehicle-fact rejection specifically, not any guard failure) and the inventory query's own p50/p95/max time, both counted from real turn logs and added to `LIMITS` and the pass/fail checks                                                                                                                 | `observability/metrics.py`, `observability/rollout.py`                                                                                                                                        |
| Tests: the new grounding-rejection metric and inventory timing, and a rollout check that fails when grounding rejections go over the limit                                                                                                                                                                                                                 | `tests/unit/test_metrics.py`, `tests/unit/test_rollout.py`                                                                                                                                    |

### What's deferred, and why

- **"Short references resolve" (decision G)** isn't built (Phase 3's own deferral, unchanged), so no eval covers it - there is nothing to test yet.
- **Real-model eval run (item 3).** Not run this session. The AI containers are correctly configured for real OpenAI models right now, per your standing instruction to test online-only, but that's a separate concern from the *eval gate*, which needs `OPENAI_API_KEY` set for the **pytest process itself** (`MODEL_EXTRACT=openai:... MODEL_COMPOSE=openai:... make ai-evals`), not just the Docker containers. Worth running deliberately, since it costs real money per run; not run without being asked.
- **Shadow review's stock-specific verdict (item 4).** The existing shadow-review mechanism (`POST /dev/shadow/review`, verdicts "better/same/worse/unsafe") is general-purpose and untouched. A stock-specific verdict ("right vehicle / wrong vehicle fact / should have said no") would extend `devtools/shadow.py`'s stored review and the Shadow tab's UI - scoped, not built, since it only matters once a dealer is actually in a shadow week to review.
- **"Done when: one dealer live for a week, zero wrong vehicle facts."** This is an operational outcome, not a code task - nothing to build for it beyond what's above; it can only be shown true by actually running a dealer in shadow/live for that week.

### Verification

| Check                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit tests                           | 760 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Offline eval gate (`pytest evals`) | 59 passed (56 before this phase; +3 conversation cases)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Ruff on all changed files            | Clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Scenarios, live in Docker            | **Not verified this session.** Two attempts (real models, and a `docker exec -e MODEL_EXTRACT=offline` override) both failed for environment reasons unrelated to this phase's code: the scenario suite assumes the offline model's exact wording and dev-only hints (`#retry`/`#badtrim`), and a one-off env override on `ai-api` doesn't reach the separate `ai-worker` container that actually runs turns. The last clean live-scenario run (39/41, both failures pre-existing platform-auth issues) was taken *before* A5/A6/A7, so it doesn't cover this work. Re-run `make ai-scenarios` once the containers are next set back to the offline model. |
>>>>>>> plan_3
