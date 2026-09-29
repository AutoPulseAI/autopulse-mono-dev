# MASTER_PLAN_3 progress

Plan: [`MASTER_PLAN_3.md`](MASTER_PLAN_3.md). Build order (27 Sept; Bq added 28 Sept): Part A (except the deferred items) → C1 → Bq → B1 → B5 → B4 → C3 → C4 → C5 → C6.

| Phase | State |
|---|---|
| A0. Decisions | Done (architecture.md §15, decisions 14–36) |
| A1. Inventory read layer | **Done, verified end to end (27 Sept 2026)** |
| A2. Shopping criteria | **Done, verified end to end (27 Sept 2026)** |
| A3. Answering stock questions | Not started. Built together with A4 (28 Sept); readiness review: decisions A–O recorded (28 Sept) (see MASTER_PLAN_3 Phase 3). Links and MMS moved into A3 |
| A4. Grounding check | Not started. Built together with A3 |
| A5. Freshness (sold re-checks) | Not started (needs a "sold" signal: C5's manager outcome) |
| A6. Debug UI and dev inventory | Not started (Phase 1 added a first dev stock set and the Stock section) |
| A7. Evals, shadow and rollout | Not started |
| B0. Decisions (Part B) | Readiness review 28 Sept: decisions 55–71 recorded (architecture.md §15). Campaign texts pass the send check through a shared queue and are still sent by the platform (decision 66, corrected 29 Sept). REVIEW kept, resolved without a new screen (decision 72). Consent-ask email withdrawn for now (decisions 67, 73). **Part B's decisions are complete; ready to build once C1 is built** |
| C1. Compliance engine (with B2/B3) | **Done, verified end to end (29 Sept 2026).** Built ahead of Part A Phases 3–7 at the user's request (C1 needs nothing from Part A). Includes the approved platform campaign changes. Flags: decisions 75 and 78–86 |
| Bq. Two questions per message | **Closed (29 Sept–1 Oct).** Decisions 88–89. 825 unit tests, 56/56 evals, offline model |
| B1. After-hours first reply | **Closed (29 Sept–1 Oct).** Decisions 90–98, plus three fixes from live testing (real-model choice drop, stray `wants_visit`, repeated greeting / re-offer on a plain ack). Platform notification for the team still to build (decision 96, flagged). **Next: B5** |
| B2. Inbound or outbound | **Done inside C1 (29 Sept).** Real `Lead.source` values still to be checked on real data (decision 85) |
| B3. Send check | **Done inside C1 (29 Sept)**, including item 7's platform campaign changes. Not built: item 7's optional campaign-form note |
| B4–B6 | Not started. B5 must also wire B1's `wants_visit` into booking (B5 item 8). **Known gaps accepted for B5:** old platform reminders after a move/cancel (until C5), and a cancelled booking leaves the lead "Appointment Booked" (interim) |

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

