# Ammer Master Plan 3: Inventory, contact rules and appointments (Local Conflicting Version)

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
| Vehicle records | Platform `vehicles` collection (Mongoose `Vehicle`, `strict: false`, unique per dealer + VIN) | Holds dealer stock **and** vehicles that came from DMS history (customers' own cars, Customer 360). |
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
| 3 | Answering stock questions | "Do you have a RAV4?" is answered from real stock, or honestly says no |
| 4 | Grounding check | A draft that names a car or a detail not in the loaded records is rejected |
| 5 | Freshness | A car sold since the message was written is never mentioned in a later send |
| 6 | Debug UI and dev inventory | Seeded stock per dev dealer, and an Inventory panel per turn |
| 7 | Evals, shadow and rollout | Inventory evals pass on the real models, and shadow review shows no wrong vehicle facts |

---

## Phase 0: Decisions

1. **What counts as in stock.**
2. **Source of truth for reads.**
3. **Prices.**
4. **Links.**
5. **How many vehicles per reply.**
6. **Feed freshness.**
7. **Photos.**

---

## Phase 1: Inventory read layer

1. **Implement `tools/inventory_tool.py`**:
   - `search_inventory(dealer_id, criteria, limit)` returns raw records, calling `/api/car`.
   - `get_vehicle(dealer_id, vin)` is used for re-checks.
   - Scoped per dealer, read-only, applies in-stock rule.
2. **A typed view** of each record: VIN, stock number, year, make, model, trim, body type, new/used, exterior colour, miles, record last-updated time, page link.
3. **Short cache** (60s).
4. **Context Pack integration.**
5. **Traceability in Debug UI.**

**Tests:** In-stock rule filtering out DMS history/sold cars, dealer scoping, cache.
