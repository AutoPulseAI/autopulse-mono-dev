# Master Plan 4: Real-model timing

> **What this is:** on 29 Sept 2026, the OpenAI key was replaced with a working one, and the AI pipeline
> ran against real GPT models for the first time in this project. That run measured real latency and found
> the pipeline's own internal timeouts were tighter than real models need - every real-model turn was
> silently falling back to the template. This plan records that finding and what to do about it.
>
> **Scope rule for this file (set by the user, 29 Sept):** only write down a requirement here if the client
> actually stated it somewhere in `docs/client/` or `docs/data/`. Anything below that isn't a client
> requirement is labelled as ours, not theirs.

---

## What was found

Timing a real Extract call (`openai:gpt-4o-mini`) and a real Compose call (`openai:gpt-4o`) directly, from
inside the running `ai-api` container, with the actual production prompts:

| Step | Measured | The pipeline's old budget | Result |
|---|---|---|---|
| Extract | 3.1-3.7s model time | `EXTRACT_TIMEOUT_S` = 3.0s | Timed out almost every time |
| Compose | ~3.1s model time | `COMPOSE_TIMEOUT_S` = 5.0s | Passed, but with little margin |
| Both together, first reply | ~8.2s wall time | `FIRST_REPLY_DEADLINE_S` = 8.0s | Over budget |

`EXTRACT_TIMEOUT_S` / `COMPOSE_TIMEOUT_S` / `FIRST_REPLY_DEADLINE_S` were set in MASTER_PLAN_2 (architecture
decisions on AI call budgets), before this project ever had a working OpenAI key to test against. They were
never wrong on paper; they had simply never been checked against a real model's actual speed until now.

**Fixed already (29 Sept), in `agentic-upsell/.env` only, no code change:**
```
EXTRACT_TIMEOUT_S=8
COMPOSE_TIMEOUT_S=8
FIRST_REPLY_DEADLINE_S=20
```
With these, a real first reply completes end to end (`load_context → extract → validate → search_stock →
decide → compose → guard → send → schedule`) instead of falling back to the template.

---

## Is there a client-stated speed requirement? Yes - and it isn't 8 seconds

Checked every client document (`docs/data/conversations.md`, `conversation_2.md`, `conversation_3.md`,
`pdf_dump.txt`, both TCPA/omnichannel PDFs, `docs/client/autpulse.workflowblueprint.png`) for any mention of
required speed. One exists, and it's from the client's own blueprint image, section **3A, "NO-RESPONSE
CADENCE," Day 1 Touch 1**:

> **"Within 60 Seconds - First Quality Response"**

That is the client's actual, stated requirement: the first reply must go out within 60 seconds of the lead
arriving, not within 8. `FIRST_REPLY_DEADLINE_S = 8.0` was never a client number - it was this project's own
internal engineering target, set in MASTER_PLAN_2 before either a real model or a client speed requirement
existed to check it against. Nothing else in any client document mentions seconds, response time, latency,
or an SLA of any kind.

**What this means in practice:** the ~8-10 second real-model latency measured above is comfortably inside
the client's real 60-second bar, with roughly 5-6x headroom. The tension raised earlier in this session (raise
`FIRST_REPLY_DEADLINE_S` and accept ~8-10s, vs. keep 8s and use faster models, vs. keep 8s and let it fall
back to the template) turns out to be a false choice created by an internal number that was never the actual
requirement. There is no need to choose a faster model or accept more template fallbacks to hit 8 seconds,
because 8 seconds isn't what the client asked for.

---

## Decided

1. **`FIRST_REPLY_DEADLINE_S` is raised from 8.0 to 20.0** (already done, in `.env`). This is comfortably
   inside the client's 60-second requirement even accounting for network variance, the send step, and a
   guard rewrite. **Not raised all the way to 60s**: the 20s ceiling still leaves the system itself well
   under the client's bar rather than running right up against it, and it matches MASTER_PLAN_2's existing
   "20s for replies after the first" budget, so first replies and later replies now share one number instead
   of needing two.
2. **`EXTRACT_TIMEOUT_S` = 8, `COMPOSE_TIMEOUT_S` = 8** (already done, in `.env`). Each real call measured at
   3.1-3.7s, so this is roughly 2x headroom per call for a slow response, a retry, or a longer conversation's
   larger prompt - without letting one slow call alone burn through the whole 20s reply budget.
3. **The client's 60-second requirement should be the one written into `architecture.md`'s decisions and
   `docs/report/`**, replacing the internal 8-second figure wherever it's quoted as if it were a client
   promise. That correction is not made in this file; it's listed here as a follow-up so it's not lost.

## Not decided, needs the client (or a deliberate internal call, not a quiet one)

- Whether 20 seconds is the right internal ceiling, versus something else under 60. This plan sets 20s as a
  reasonable buffer, not as a re-derived client number - nothing in any client document names a number
  between 8 and 60.
- Whether the *template* fallback (used when even 20s isn't enough - a slow provider, a network issue) is
  still an acceptable "first quality response" under the client's 60-second rule, or whether it should count
  only once a real AI reply goes out. Today's design already tries to guarantee something is sent well inside
  60s either way (template replies typically go out in under 2 seconds); this is a policy question, not a
  timing one.

## Not in this plan

- Re-timing Compose for longer or more complex conversations (only the first-reply case was measured here).
- Any change to the guard, retry, or grounding logic - this plan is purely about the three timeout settings
  above and what the client actually asked for regarding speed.

---
---

# Part 2: SOLD PENDING and SOLD-DELIVERED (new client specs, 29 Sept 2026)

> **What this is:** on 29 Sept 2026 the client sent two more developer specs, continuing directly from where
> MASTER_PLAN_3.md's Part C left off. Part C's C5 ends a Sales Visit with a manager picking one of three
> outcomes - `SOLD PENDING`, `SOLD DELIVERED`, `UNSOLD` - and said the workflow for each outcome was "a
> separate spec, coming next." Two of those three have now arrived.
>
> **Source documents:**
> 1. [`../../data/4/AutoPulse_SOLD_PENDING_Workflow_Developer_Spec.pdf`](../../data/4/AutoPulse_SOLD_PENDING_Workflow_Developer_Spec.pdf)
> 2. [`../../data/4/AutoPulse_SOLD_DELIVERED_Ownership_Retention_Workflow_FINAL (1).pdf`](<../../data/4/AutoPulse_SOLD_DELIVERED_Ownership_Retention_Workflow_FINAL (1).pdf>)
> 3. [`../../data/4/conversations_4.md`](../../data/4/conversations_4.md) - confirms both PDFs are final ("The two final workflows are in your email... for sold pending and sold delivered"), and that a third, separate spec is coming for service workflows ("NHTSA and vehicle databases will dictate those").
>
> **Nothing in this part is built yet.** This is the conflict list and the phase breakdown, the same way
> MASTER_PLAN_3's Phase 0 and Part B's opening table worked: decide first, build second.

---

## Conflicts with the existing plan - need the client's answer before building

### Conflict 1: how many "closed" statuses exist

- **MASTER_PLAN_3.md Part C, C3** (the lead-cadence state machine) has **`Opportunity Closed - No Response`**
  (the Day 91 timeout) as one of its terminal states.
- **The new SOLD-DELIVERED PDF, §1**, in a boxed rule it calls definitive:
  > "The ONLY two CLOSED opportunity statuses are: **CLOSED LOST** and **CLOSED - NO LONGER OWNS**."

Read literally, these can't both be true. `Opportunity Closed - No Response` is neither of the client's two
named statuses. **Two ways to resolve it, not decided here:**
- **(a)** Day 91 closure is renamed to fire as `CLOSED LOST` (a lead that went 91 days with no response *is*
  a lost opportunity, just for a different reason than a Sales Visit that didn't convert), and
  `Opportunity Closed - No Response` stops existing as its own status - only its *reason* is recorded, not a
  separate status value.
- **(b)** The client's "only two" rule was written with the post-Sales-Visit world in mind (Part C's C3-C5)
  and doesn't intend to erase the earlier Day-91 case, meaning a third closed status still exists for leads
  that never got that far.
- (a) is recommended: one client sentence ("the ONLY two") is a stronger signal than an unstated exception,
  and it simplifies the model. ~~**Not decided - ask the client directly**, quoting both documents back to them.~~
- **Resolved 1 Oct 2026 as (a)** (client, [`../../data/6/conversation_6.md`](../../data/6/conversation_6.md), scope Q1): Day 91
  → Closed – Lost, for the lead only, not the customer. MASTER_PLAN_3 C3 is updated.

### Conflict 2: what `UNSOLD` becomes

Part C's C5 requires a Sales Visit to end in **`SOLD PENDING`, `SOLD DELIVERED`, or `UNSOLD`**. Neither new PDF
mentions `UNSOLD` at all - both only define what happens once `SOLD PENDING` or `SOLD DELIVERED` is picked.
**Recommended, not confirmed:** `UNSOLD` transitions the opportunity straight to `CLOSED LOST` (the customer
visited, didn't buy, and per Conflict 1's proposed resolution `CLOSED LOST` is the only "didn't happen" closed
status available). **Not decided - ask the client** whether `UNSOLD` should return the lead to an ordinary
follow-up cadence instead of closing it outright; the SOLD PENDING PDF's own opening line ("SOLD PENDING is
not an unsold lead") implies the client is already drawing exactly this kind of distinction carefully.

**Resolved 1 Oct 2026** (client, scope Q2): UNSOLD goes **back to follow-up for 90 days**, not straight to Closed –
Lost. See MASTER_PLAN_3 C5 (assumed: the 90 days restart from the UNSOLD date; to confirm).

### Conflict 3 (not a wording conflict - a real gap): the platform has none of these statuses today

Checked directly against `aidmvcs-be-dev`'s live `Lead` records and code (`fe_lead_status` is a free-text
field, `strict: false`, no enum). The values actually in use today are `'Sold'`, `'visited'`,
`'Managerial Review'`, `'Appointment Booked'`, `'DND'`, and others - **none of `SOLD PENDING`,
`SOLD - DELIVERED`, `CLOSED LOST`, `CLOSED - NO LONGER OWNS`, `ACTIVE`/`INACTIVE` (customer),
`ACTIVE`/`NO_LONGER_OWNED` (vehicle) exist anywhere in the platform's data model.** This isn't something the
AI service can work around on its own: it needs a platform-side decision on whether these become new
`fe_lead_status` string values (simplest, least platform code change) or a proper new status field family
(cleaner, more platform work). **Not decided - a platform (aidmvcs-be-dev), not AI-service, decision.**

---

## New features the client wants

Two whole new lifecycles, picking up exactly where Part C's C5 (Sales Visit + manager outcome) stops.

### Phase D1: Wiring the manager outcome to a lifecycle

Extends C5 rather than replacing it. Today C5 only requires the outcome *selection*; nothing happens after.

1. Selecting `SOLD PENDING` on the manager-outcome prompt starts Phase D2's workflow immediately and stops
   every other automated follow-up for that opportunity (Part C's "one controlling workflow" rule, unchanged).
2. Selecting `SOLD DELIVERED` starts Phase D3's ownership lifecycle immediately, and if `SOLD PENDING` was
   already active, stops it first (SOLD-DELIVERED PDF §2: "all SOLD PENDING activity stops immediately").
3. Selecting `UNSOLD` does whatever Conflict 2 above resolves to.

**Done when:** each of the three manager-outcome choices reliably starts exactly one lifecycle and stops every
other one already running for that opportunity.

### Phase D2: The SOLD PENDING workflow

1. **A dedicated status**, never entering the standard New Lead / Day 1-90 cadence (SOLD PENDING PDF §1) -
   reuses the "one controlling workflow" mechanism Part C's C3 already establishes.
2. **Weeks 1-4, one touch a week**, each with its own theme (documentation + questions, support check-in,
   purchase/vehicle check-in, a warm relationship-only check-in that must never imply the customer is
   delaying the deal) - §5.
3. **After week 4, one touch every two weeks, indefinitely**, until an outcome is picked - explicitly **no
   Day-90 or any other age-based expiration** (§6, §10, §12 acceptance tests). This is a deliberate exception
   to every other cadence built so far, which all eventually stop or close.
4. **Every touch is CALL + TEXT + EMAIL** with the same 60-minute human-call-escalation timer Part C's C2
   already built for the Day 1-90 cadence - reused, not reinvented (§3, §8).
5. **A response router** (§9): a question the AI can answer, a question needing a human, the customer
   supplying requested information, staff recording delivery or loss, and no response at all - each with its
   own handling, all while remaining SOLD PENDING except the two status-changing rows.
6. **Guardrails specific to this phase** (§7): never fabricate a missing document, a delivery date, financing
   status, or a reason the deal is pending; never repeat an already-answered question; every reply reads like
   a continuation of an existing purchase, not a new sales pitch.

**Done when:** a Sales Visit outcome of SOLD PENDING runs the weeks-1-4 cadence, then the indefinite
biweekly cadence, sends nothing through the Day 1-90 machinery, and only stops on SOLD-DELIVERED, CLOSED LOST,
or an opt-out.

### Phase D3: SOLD-DELIVERED trigger and the three-level status model

The real architectural centerpiece of the ownership PDF - needed before D4-D8 mean anything.

1. **New status fields, three levels** (§10, §14), pending Conflict 3's platform decision:
   - **Opportunity:** `SOLD_DELIVERED` (active, not closed), `CLOSED_LOST`, `CLOSED_NO_LONGER_OWNS`.
   - **Vehicle:** `ACTIVE`, `NO_LONGER_OWNED` - each vehicle has its own ownership record; a customer can have
     several, historical or current (§11).
   - **Customer:** `ACTIVE` (has an open lead/opportunity *or* a currently-owned vehicle - either is enough)
     / `INACTIVE` (neither) - recomputed on every status-changing event, never inferred from missing data
     alone (§9).
2. Selecting `SOLD DELIVERED` records `delivery_date`/`sold_delivered_at`, stops SOLD PENDING, and starts the
   ownership lifecycle (D4-D8) for that vehicle (§2).

**Done when:** the status model's rules from §9-10 hold under test: a customer with one sold car and one open
lead stays ACTIVE if either one alone would keep them so; an opportunity in SOLD-DELIVERED is never treated as
closed anywhere in reporting or automation.

### Phase D4: Day-3 post-delivery check-in and first service offer

One message about 3 days after delivery: asks about questions, offers to book the first recommended service
using the vehicle's maintenance schedule (§4). A "later" answer never gets pressured again; an existing
appointment suppresses the offer.

**Client, 1 Oct 2026 (scope Q16):** this SOW *offers* the service and takes notes; it doesn't book into a
scheduler or read service availability (next SOW). A "yes" becomes a service request to the team with the
customer's preferred day/time and notes (MASTER_PLAN_3 B0.9), never a booking.

### Phase D5: Maintenance reminder engine - **needs a new data source**

**Client, 1 Oct 2026:** the data source is **Vehicle Databases** (vehicledatabases.com; the API, "the cadences we
need for service intervals by OEM"), together with DealerVault service history
([`../../data/5/vechicle_api.md`](../../data/5/vechicle_api.md)). The 15-day sandbox trial starts only near the end of
the build, "as we don't want it to expire before we can actually test it". Maintenance and recalls are
**event-driven, not cadences**: "with those integrations we don't need to set up cadences because they alert the ai to
send a message/create a task" (conversation_6.md). The text below predates this.

VIN → maintenance schedule → known mileage/time → a service is due → outreach (§5). **This needs deciding
where "the vehicle database" actually comes from** - nothing in this codebase or the platform currently holds
manufacturer maintenance schedules. Options: a licensed third-party data feed, the DMS if it already carries
one, or a fixed internal table per make/model as a first cut. **Not decided.** Until then, only the two rules
that don't need the data can be honoured: never invent a maintenance requirement, and prefer time-based
intervals over a guessed mileage.

### Phase D6: NHTSA safety recall monitoring - **a genuinely new external integration**

VIN → NHTSA recall check → an open, VIN-specific recall → outreach (§6). NHTSA publishes a free, public
recall-lookup API (by VIN), so this is buildable, but it is a **new integration this project has never had**:
nothing here has called an external government data source before. Recall data (identifier, description,
detected/status/source/last-checked dates) needs its own storage, independent of the maintenance engine, with
its own outreach cadence so it doesn't compete with maintenance reminders for the customer's attention.
conversations_4.md's own line ("NHTSA and vehicle databases will dictate those [service workflows]") suggests
the client sees Phases D5-D6 as coming with more detail in a still-separate service-workflow spec - **worth
confirming with the client whether to wait for that spec before building D5/D6, or build the mechanics now
against a placeholder data source.**

### Phase D7: Birthday and 10-year ownership anniversary

1. **Birthday**: one message a year, only when a verified birth month/day exists from an authorized source -
   never inferred (§7). Customer-level, not vehicle-level. **Source (client, 1 Oct):** DealerVault, already
   integrated: the platform's DealerVault sales/service/appointment imports carry a `Birth Date` column
   (`aidmvcs-be-dev/app/worker/dealervault/common/salesFields.js`, `serviceFields.js`, `appointmentFields.js`).
2. **Ownership anniversary, years 1 through 10**: one message a year per vehicle, asking a direct YES/NO
   ("do you still have your [Model]?") - §8.
   - **YES:** nothing changes; `ownership_confirmed_at` recorded.
   - **NO:** opportunity → `CLOSED_NO_LONGER_OWNS`, vehicle → `NO_LONGER_OWNED`, all reminders for that
     vehicle stop, and a short, required follow-up captures what they drive now (year/make/model), roughly
     how long they've had it, and where they normally get it serviced - stored as a new, `CUSTOMER_REPORTED`
     vehicle record, explicitly **not** an automatic trade-in pitch (§8, §13).
   - **No response:** status never changes just because they didn't answer (§8).

### Phase D8: Recompute customer ACTIVE/INACTIVE on every relevant change

The rule itself is Phase D3's; this phase is the plumbing that recalculates it whenever a lead opens/closes or
a vehicle's ownership status changes, so it's never stale (§9, §14 `customer_status_recalculated_at`).

### Phase D9: Trade-in / equity / repurchase - explicitly out of scope

Both PDFs say this in so many words: "OUT OF CURRENT SCOPE - ARCHITECTURE RESERVED... NEXT SOW" (SOLD-DELIVERED
§13). D7's replacement-vehicle capture may **collect** the data (current vehicle, acquisition date) but must
**not** act on it - no automatic trade solicitation. Consistent with Plan 1/2/3's existing price and trade-in
restrictions; no new restriction needed, just don't build the engine this data is collected for yet.

---

## Suggested build order

1. **Resolve the three conflicts with the client first** - Phase D1 and D3's status model are meaningless
   until Conflicts 1-3 are answered, and D2/D4/D7's "stop conditions" all depend on the same status names.
2. **D1 → D3 → D2** (the outcome wiring, then the status model it needs, then the SOLD PENDING cadence, which
   is self-contained and needs no new external data).
3. **D4 → D7 → D8** (the ownership-lifecycle touches that need no new external data source).
4. **D5 and D6 last**, and only after the maintenance-data and NHTSA-integration questions above are answered
   - these are the two genuinely new pieces of infrastructure, not just new conversation logic.

## Not in this part

- Anything from D9 (trade-in/equity/repurchase) beyond collecting the replacement-vehicle data D7 already asks for.
- The still-unseen third spec for service workflows that conversations_4.md says is coming next.
- Any change to Part A (inventory) or the earlier parts of Part C (C1-C4) - this part only extends C5 forward.

---
---

# Part 3: Fixes required after MASTER_PLAN_3 Parts A and B (client answers, 1 Oct 2026)

> **What this is:** MASTER_PLAN_3 Parts A and B are built. On 1 Oct 2026 the client answered the questions in
> [`../../scope/scope.pdf`](../../scope/scope.pdf) §17 ([`../../data/6/conversation_6.md`](../../data/6/conversation_6.md)).
> Some answers change what Parts A and B already built; those changes are listed here, so MASTER_PLAN_3's built
> parts stay as the record of what was built. Answers that affect Part C are applied in MASTER_PLAN_3 C3 and C5
> directly (Part C isn't built yet).
>
> **Not applied yet, still being confirmed:** scope questions 5–9, 11–13 and 17–18.

## The client's answers that apply

| Scope Q | Client's answer | Where it lands |
|---|---|---|
| 1 | Day 91 → **Closed – Lost**. It closes the **lead**, not the customer; a new lead from the same customer is worked as a new lead. | MASTER_PLAN_3 C3; Conflict 1 above |
| 2 | UNSOLD → **back to follow-up for 90 days**. | MASTER_PLAN_3 C5; Conflict 2 above |
| 4 | State hours tables sent ([`../../data/6/tcpa_7.pdf`](../../data/6/tcpa_7.pdf), "please use both tables"). | **F1** below |
| 10 (part) | "Not interested / no longer in the market / I'm good" → the AI asks why; once a reason is given, it notes it and escalates. **Only a human can close-lost** it. STOP alone always opts out. | MASTER_PLAN_3 C3 |
| 14 | Sales Visit = **a person setting the status**; third-party check-in tools later. | MASTER_PLAN_3 C3/C5, unchanged ("Visited") |
| 16 | **Service appointments are offered in this SOW and notes taken**; reading service availability and writing into the scheduler is the **next SOW**. | **F2** below; D4 above |
| 19 | National DNC not needed; consent + suppression is enough. | Unchanged (MASTER_PLAN_3 decision 68) |

---

## F1: Per-state contact hours (fixes MASTER_PLAN_3 B0.6 / B3)

**Built today:** `compliance/customer_zone.py` finds the customer's state (ZIP, else state, else area code), but
`compliance/engine.py` applies **one window to everyone**: `MARKETING_WINDOW = 8:00-20:00`, plus 3 marketing texts per
24 hours (B0.6's interim rule).

**Why it's wrong now:** the client's table ([`../../data/6/tcpa_7.pdf`](../../data/6/tcpa_7.pdf)) shows the interim
rule isn't the strictest everywhere:
- **Later start times:** 9:00 in CT, NV, NM, SD and TX; **10:00 in KY**; RI is 9:00-18:00 weekdays and 10:00-17:00 Saturday.
- **Sundays:** banned in AL, LA, MS, SD and RI; TX allows only noon-21:00.
- **Holidays:** banned in AL, LA and RI.

**To build:**
1. `MARKETING_WINDOW` becomes a **versioned per-state table** (window per weekday, Sunday rule, holiday rule, cap),
   built from both of the client's tables and kept as config, not in prompts (TCPA PDF §7, §13).
2. Applied by the state `customer_zone.py` already finds. The stricter of the ZIP state and the area-code state
   wins; an unknown state gets the strictest row.
3. A US federal-holiday calendar for the holiday rules.
4. HOLD gives the next time that's allowed under that state's row.
5. Rows the client marks with an asterisk ("federal default", not individually verified) are research status, not
   legal conclusions (the client's own note): counsel confirms.

**Flag for the client or counsel:** Table 2 says Florida, Oklahoma and Maryland require **prior express written
consent** for automated texts. MASTER_PLAN_3 decision 36 counts the customer's own inquiry as consent for
follow-ups on it; that may not be enough in those states.

**Tests:** one row per state rule (late start, Sunday ban, Texas Sunday noon, holiday, RI Saturday), the
ZIP-vs-area-code stricter rule, unknown state → strictest, and HOLD release times.

---

## F2: Service visits are requested, not booked (fixes MASTER_PLAN_3 B0.9, B4, B5)

**Client (scope Q16):** "service appointments are offered in this SOW and notes taken in, but in the next SOW
availability will be able to be read, they will be able to be written in the scheduler."

**Conflict with what's built:** B4's decision 106 gives **every** lead type the visit offer, service included, and
B5 books the picked time through `POST /api/booking`. So a service lead can get a real platform booking today.

**The change:**
- **Sales visits / test drives:** unchanged; booked as B5 builds them.
- **Service visits** (a service lead now; later the SOLD – DELIVERED Day 3 first-service offer, maintenance and recall
  outreach): the AI **offers** a service visit and asks when suits them, but **creates no booking** and reads no
  service availability. It takes notes instead: the requested day/time ("Thursday morning"), the vehicle, its
  mileage, what it needs, and anything that matters to the customer ("wants to wait for it", "needs a loaner").
- These go to the team as a **service request**: the team notice (`staff_notice`, kind `service_request`) and a
  note on the platform lead's conversation.
- The reply never says booked or confirmed: "I've passed Thursday morning to our service team with your notes;
  they'll confirm the exact time with you."

**Code to change:**
- `agent/visit_offer.py`: for `lead_type == service`, ask for a preferred day/time instead of offering slots.
- Decide (`agent/nodes/decide.py`): never call `tools/booking_tool.py`'s `ensure_booking` for a service visit.
- The guard's booking-wording rule: allows "passed to the service team" for a service request, never
  "booked" / "confirmed".
- MASTER_PLAN_3's "Not in this plan" now reads: booking into a scheduler or reading service availability is next
  SOW; offering a service visit and passing the request with notes **is** in scope.

**Tests:** a service lead gets a preferred-time question (no slots); no `POST /api/booking` for a service lead; the
notice carries the time and notes; "booked" wording on a service request is rejected; sales leads still book.

**Next SOW:** read service availability, offer real times, write the booking into the service scheduler.
