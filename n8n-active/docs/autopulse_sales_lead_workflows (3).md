# AutoPulse.ai Sales Lead Blueprint — Complete Workflow Map

> Source: `main_workflow_CONFIDENTIAL.png`
> Core principle stated on the diagram: **"TRUTHMODE ALWAYS — Every interaction is honest, transparent, and customer-first."**
> Tagline: "ONE SYSTEM. THREE INTENT BUCKETS. TWO VEHICLE TYPES. ONE WORKFLOW."
>
> **Governing principle for this document:** Poster-defined behavior = requirement. Derived workflow behavior = proposed implementation until approved. Sections 0–9 and Core Principles document the poster (with clearly marked annotations where the poster is ambiguous or needs reconciliation); the Workflow Registry section is a proposed implementation layer, not an approved specification, until confirmed with the business owner.

---

## 0. After-Hours & TCPA Compliance Rule (Gate — runs BEFORE any outreach)

This check happens before any outreach and respects TCPA calling hours (8am–9pm local time at the customer's location).

1. **Lead Received** — lead comes in via any source, day or night.
2. **Contact-Time / After-Hours Check** — AI checks customer local time, TCPA rules, consent, and channel.
3. **Assist Now or Next Business Day** (offer the choice):
   - **Branch A — Customer wants help now:** AI acknowledges and continues the conversation immediately (if within TCPA-allowed hours).
   - **Branch B — Customer prefers next business day:** AI confirms preference, schedules first contact for the next business day when outreach opens, and stops outreach now.
4. Both branches converge → continue to **Sales/Service Classification**.

---

## 1. New Lead Intake

Capture and structure raw lead data:

- Capture lead data
- Identify source
- Read raw comments
- Identify customer question
- Identify vehicle (if any)
- Identify likely intent
- Collect available customer data

**Output:** AutoPulse understands who the customer is, why they submitted the lead, and what they asked.

---

## 2. Sales Lead Bucket Routing (Source Intent Buckets)

When a lead is classified as **Sales**, it is assigned to one of three Source Intent Buckets **before** entering the workflow.

### Bucket 1 — Credit / Financing Intent
- **Sources (examples):** Capital One, Chase, Carzing, DealerCentric, Credit Application, eUnifi, 700Credit, and others (to be added)
- **Primary intent:** Customer is focused on approval, payment options, financing, or credit-related next steps.
- **Word-track emphasis:** Financing options, pre-approval, payment structure, required information, and how an appointment helps clarify real options.

### Bucket 2 — Trade-In / Sell My Car Intent
- **Sources (examples):** KBB, TrueCar SELL My Car, AccuTrade, CarGurus SELL My Car, and others (to be added)
- **Primary intent:** Customer wants to sell or trade a vehicle.
- **Word-track emphasis:** Value, appraisal, vehicle condition, payoff, equity, and getting an accurate in-person number. Aggressively collect trade data (core intent).

### Bucket 3 — General Sales Intent
- **Sources (examples):** CarGurus (regular), Edmunds, Car Now, AutoTrader, Cars.com, Facebook, Instagram, AutoWeb, CarsDirect, TrueCar (non-trade), and others (to be added)
- **Primary intent:** Customer is shopping, comparing, asking vehicle-specific questions, or exploring purchase options.
- **Word-track emphasis:** Vehicle availability, pricing, features, condition, history, alternatives, trade, financing, and whatever the lead comments indicate matters most.

**Bucket Override Rule:** If customer behavior clearly indicates a different primary intent (e.g., a credit lead wants to sell their car), AI adapts the conversation to that intent while retaining the original bucket for reporting and analytics.

### Vehicle Type Filter (applies after source-intent bucket is set)

After identifying source intent, determine what type of vehicle the customer is interested in:

- **New Vehicle:**
  - New model / trim requested
  - OEM incentives
  - Lease / finance programs
  - Rebates & eligibility
  - Model / trim alternatives
  - Incoming inventory
  - Dealer trades / locate options
  - Upgrade / loyalty opportunities
- **Used Vehicle:**
  - Specific used VIN / stock # requested
  - Exact vehicle availability
  - Mileage / condition / history
  - CARFAX / history when available
  - Similar used inventory
  - Price changes / price drops
  - Alternative vehicles if unit sells

**Vehicle Type Override Rule:** AutoPulse continuously updates New/Used classification based on customer behavior. If a customer switches from New → Used (or Used → New), AI adapts the conversation while retaining the original classification for reporting and attribution.

### Bucket Rules & Behavior (side panel, applies to all 3 buckets)
- Bucket determines **intent & language**, not the workflow.
- All three buckets follow the **same core workflow** with unique word tracks based on intent.
- **Behavior Override Rule:** If the customer's responses show different intent, AutoPulse adapts the conversation in real time while preserving the original bucket for reporting & analytics.

---

## 3. Common Sales Workflow (Runs for All 3 Buckets, with Bucket-Specific Word Tracks)

### A. No-Response Cadence (Initial 6-Day Outreach)
Runs **only** while the customer has not responded. Cadence stops immediately at any point the customer responds, moving them to Active Conversation.

This table is transcribed **exactly as printed** on the poster (verified by zooming into the panel):

| Day | Touch | Action |
|---|---|---|
| Day 1 | Touch 1 | Within 60 seconds — First Quality Response. Personalized, addresses their inquiry, uses customer name & intent. Include vehicle link/image if applicable. |
| Day 1 | Touch 2 | 3 hours later — Pattern Interrupt: "Hi, [Customer Name]?" If 3-hour mark is after business hours, sends at next opening time. |
| Day 2 | Touch 3 | One Personalized Engagement Message — designed to get the customer to respond. |
| Day 3 | Touch 4 | One Personalized Engagement Message — new approach based on data & learning. |
| Day 3 | Touch 4 *(again — see note)* | One Personalized Engagement Message — different strategy to drive response. |
| Day 4 | Touch 6 *(Touch 5 does not appear anywhere on the poster)* | One Personalized Engagement Message — different strategy to drive response. |
| Day 6 | Touch 7 | One Personalized Engagement Message — final message in the initial cadence. |

> ⚠️ **Source inconsistency, not a transcription error:** the poster itself prints "Day 3 / Touch 4" twice and has no "Touch 5" anywhere — it jumps from Touch 4 to Touch 6. This is very likely a labeling mistake in the original artwork (a dropped day/touch pair), but it's reproduced here exactly as printed rather than silently "corrected," since a developer needs to know the source is ambiguous here. **Before implementation, this needs a decision from whoever owns the poster** — the most probable intended fix is a 7-touch, 6-day sequence such as: Day1/T1, Day1/T2, Day2/T3, Day3/T4, Day4/T5, Day5/T6, Day6/T7 — but that is an assumption, not something stated on the source.

> **Rule:** Customer responds at ANY point → stop this cadence immediately and move to Active Conversation.

### B. Active Conversation Workflow (Starts When Customer Responds)

1. **Answer Questions** — provide clear, honest answers based on their specific needs.
2. **Identify Intent, Hot Buttons & Objections** — find out what matters most; surface concerns early.
3. **Determine Trade & Fill Missing Data (Mandatory)** — every sales customer must end with one of:
   - No Trade
   - Has Trade
   - If trade, collect: Year, Make, Model, Mileage, Condition, Payoff/Loan, Expected Value (when relevant)

   > **Implementation note:** the poster's label is literally "Fill Missing Data," not "F&I Missing Data" (confirmed by zooming into the panel) — "Fill" refers generically to whatever data is missing, not specifically financing/insurance fields. In practice, "missing data" should be read as scoped to the active bucket: for Bucket 1 (Credit/Financing) leads this reasonably includes financing/F&I fields (e.g., desired payment, approval status, down payment) alongside trade status; for Bucket 2/3 it's primarily trade fields. This scoping isn't stated explicitly on the poster and should be confirmed with stakeholders before being hard-coded as a business rule.

4. **Assume Ready Now** — operating assumption: the customer is ready now. Only change if the customer explicitly says otherwise **and** provides a reason for delay (this exact "explicitly says otherwise AND provides a reason" wording is on the poster).

   > **Implementation note:** the AI should not attempt to judge whether a customer's stated reason is "valid" in some qualitative sense — the presence of an explicit, stated reason for delay is what triggers the override, not an assessment of how good that reason is. Treat this as a binary gate (reason stated vs. not stated), not a quality filter.
5. **Drive Appointment Within 72 Hours** — primary objective: appointment booked within 72 hours. Give a compelling, customer-specific reason to come sooner rather than later (not fake urgency).

### C. Appointment Conversion — Ask Up To 3 Times

| Attempt | Approach |
|---|---|
| Attempt 1 | Appointment ask based on primary intent and value. |
| Attempt 2 | Different approach based on hot button or objection. |
| Attempt 3 | Different value proposition explaining why meeting sooner benefits them. |
| Third Rejection | → **Stop pushing for appointment.** Schedule a follow-up, record the reason, then follow up. |

> **Post-Third-Rejection:**
>
> **Source-defined** (on the poster):
> - Stop pushing.
> - Schedule follow-up.
> - Record reason.
> - Follow up.
>
> **Implementation unresolved** (not stated on the poster — do not treat as a requirement until confirmed):
> - When `appointment_attempt_count` resets.
> - Whether a new inbound message from the customer resets it.
> - Whether the scheduled follow-up date arriving resets it.
> - Whether another round of up to 3 appointment attempts is allowed later, or whether the customer is permanently off the appointment-push track for this lead.

---

## 4. AI Personalization Engine ("The Brains")

Every message is personalized using:
- Lead Source / Bucket Intent
- Customer Data (name, phone, email, etc.)
- Vehicle of Interest
- Raw Lead Comments & Questions
- Trade Information (if any)
- Previous Touches & History
- Hot Buttons & Objections
- Customer Behavior & Timing

### DMS Integration (When Available)
Use prior DMS transaction history from Sales and/or Service:
- Previous purchases
- Service history
- Previous trade
- Service preferences
- Communication history

**Purpose:** Build trust, personalize the conversation, and provide a better customer experience.

### Inventory Feed Integration (Live Data)
Use real-time inventory feed to:
- Suggest similar / alternative models & trims
- Show alternative vehicles in similar price/payment range
- Alert on NEW inventory arrivals
- Alert on PRICE CHANGES & price drops
- Highlight recently added or incoming inventory

**Purpose:** Deliver more choices, create real urgency, and keep the conversation positive and helpful.

### Positive Outcomes Only
- **As printed on the poster:** "Never say a vehicle is not available." Instead, keep conversation moving forward with:
  - Similar option better for their needs/goals
  - Best fit alternatives
  - Upcoming inventory
  - Price changes/drops
  - More options to consider

> ⚠️ **Reconciliation with TRUTHMODE ALWAYS (added interpretation, not on the poster):** read literally, "never say a vehicle is not available" conflicts with the diagram's own top-level principle — "every interaction is honest, transparent, and customer-first." The intended behavior is almost certainly about *tone and framing*, not concealment: **never fabricate availability or hide the fact that a specific vehicle is sold/unavailable.** When a vehicle is genuinely unavailable, the AI should say so honestly, and immediately pivot to a similar option, a better-fit alternative, upcoming inventory, or another concrete next step — rather than dwelling on the negative or leaving the customer with a dead end. This distinction (be honest about status, but frame the redirect positively) should be made explicit in any prompt/logic built from this rule, since "never say X" is easy for a model to over-apply into "conceal X."

---

## 5. AI Learning & Optimization Engine

Track everything. Learn constantly. Get better every day.

Tracked dimensions: Touch, Message Strategy, Lead Source, Timing, Customer Data, Response / No-Response, Appointment / No-Appointment.

- AI learns which combinations generate the highest engagement and uses successful approaches more frequently.
- Performance is evaluated **in context** (by source, intent, time of day, etc.).
- Do not blindly repeat the same message — use data to choose the next best approach.
- Continually A/B test wording, timing, and strategies.
- Goal of every touch: **get the customer to respond.**

---

## 6. First Quality Response Rule

For sales leads tied to a specific vehicle, in priority order:
1. Vehicle link + image (when both available)
2. Vehicle link (if image not available)
3. Vehicle image (if clean link not available)
4. If not tied to a specific vehicle, personalize around the customer's intent instead.

> Always verify vehicle is active & available before sending media.

---

## 7. Business Hours Rule

- 3-hour touch on Day 1: if within business hours → send at 3 hours; if outside business hours → send at opening next business day.
- All other touches follow business hours unless the customer replies.

---

## 8. Escalation Rules

- If the customer asks for a salesperson → escalate immediately.
- If the customer indicates urgent need → escalate immediately.
- If the customer is upset → escalate immediately.
- If the customer requests a phone call → call within 5 minutes during business hours.
- All escalations are logged & tracked.

---

## 9. Communication Channels

Use the channel the customer came from when possible: SMS/Text, Email, Phone (Call), Web Chat, Social DM.

> Stay consistent. Be responsive. Be human.

---

## Core Principles (Always)

- **Appointment Set:** Booked within 72 hours.
- **Scheduled Follow-Up:** Qualified follow-up with date & time set (alternative outcome if appointment isn't set).
- Personalize every interaction.
- Earn the appointment.
- Provide value in every touch.
- **One Goal:** Earn the customer's response & their business.

---

## Workflow Registry (Implementation Layer — Not on the Poster)

Everything above this line primarily documents the poster. Any interpretation or implementation guidance added by this document is explicitly marked as such (see, for example, the TRUTHMODE reconciliation note, the "Fill Missing Data" scoping note, and the "reason stated vs. valid reason" note). Everything from here down is an **added implementation layer** — it translates the diagram into stable, referenceable workflow units so a developer can build against it without re-interpreting the picture each time. Treat the sections above as the source-of-truth business description (poster content plus clearly marked annotations), and this section as the executable specification derived from it.

| ID | Workflow | Trigger |
|---|---|---|
| WF-01 | Lead Intake | New lead arrives from any source |
| WF-02 | Compliance Gate | Immediately after lead arrival, before any outreach |
| WF-03 | Intent/Bucket Routing | Lead confirmed as Sales |
| WF-04 | Vehicle Classification | Immediately after bucket assignment |
| WF-05 | First Response | Vehicle type classified (or classification returns unknown) |
| WF-06 | No-Response Cadence | First response sent, no reply received |
| WF-07 | Active Conversation | Any customer reply, at any point |
| WF-08 | Trade / Missing-Data Discovery | Active Conversation stage 3 |
| WF-09 | Appointment Conversion | Active Conversation stage 5 |
| WF-10 | Inventory Resolution | A vehicle/availability question is asked |
| WF-11 | Escalation | Escalation trigger phrase/condition detected |
| WF-12 | Follow-Up / Reset | 3rd appointment rejection, or cadence exhausted with no response |

### WF-06 — No-Response Cadence
- **Inputs:** lead bucket, vehicle type, prior touch count, business-hours calendar
- **Decisions:** which day/touch is next (see cadence table above — note the source's own Touch-4/Touch-5 ambiguity); whether current time is in business hours
- **Actions:** send next scheduled touch with a distinct message strategy from prior touches
- **State changes:** increments touch counter; does not change bucket/vehicle classification
- **Exit conditions:** customer responds (→ WF-07); Day 6/Touch 7 sent with no response (→ WF-12, "cadence exhausted" path — not explicitly defined on the poster)
- **Interruptions:** any inbound customer message cancels all remaining scheduled touches immediately
- **Next workflow:** WF-07 (on response) or WF-12 (on exhaustion)

### WF-07 — Active Conversation
- **Inputs:** full conversation history, active bucket, active vehicle type, DMS/inventory context
- **Decisions:** current intent vs. original bucket (override check); current vehicle type vs. original classification (override check); escalation check
- **Actions:** answer questions; surface hot buttons/objections; run WF-08; run WF-09
- **State changes:** may update *active* intent/vehicle-type while preserving *original* bucket/classification for reporting (this original-vs-active distinction is explicit on the poster via the two Override Rules)
- **Exit conditions:** appointment booked (success); 3rd rejection (→ WF-12); escalation detected (→ WF-11, suspends normal flow)
- **Interruptions:** escalation can pre-empt this workflow at any point
- **Next workflow:** WF-09 (appointment attempt), WF-11 (escalation), or WF-12 (reset)

### WF-09 — Appointment Conversion
- **Inputs:** attempt count (0–3), prior objection/hot-button data, primary intent
- **Decisions:** which of the 3 distinct approaches to use next (must differ from prior attempts — not just repeat the same ask)
- **Actions:** ask for the appointment using the attempt-appropriate framing
- **State changes:** increments `appointment_attempt_count`
- **Exit conditions:** accepted → book within 72 hrs, stop further asks; rejected 3x → WF-12
- **Interruptions:** none specified beyond escalation
- **Next workflow:** appointment booking (terminal success state) or WF-12

### WF-12 — Follow-Up / Reset
- **Inputs:** reason for delay/rejection (if captured), original bucket/vehicle classification
- **Actions (source-defined):** stop pushing for an appointment; schedule a qualified follow-up with a specific date/time; record the reason; follow up
- **State changes / exit conditions — unresolved, not a requirement until confirmed:** whether/when `appointment_attempt_count` resets; whether a new inbound customer message resets it; whether the scheduled follow-up date arriving resets it; whether another round of up to 3 appointment attempts is permitted later. None of this is stated on the poster — treat WF-12 as "stop, schedule, record, follow up" only until the business owner confirms the reset behavior.
- **Next workflow:** the follow-up interaction itself is not specified beyond "follow up" — likely re-enters WF-07, but the trigger and timing for that re-entry are unresolved.

*(WF-01 through WF-05, WF-08, WF-10, and WF-11 follow the same Trigger → Inputs → Decisions → Actions → State Changes → Exit Conditions → Interruptions → Next Workflow shape and can be filled in the same way as the codebase takes shape; the five above were the ones with the most state-transition ambiguity worth resolving first.)*

### Cross-Cutting State Transitions & Interruptions

```text
Customer responds during scheduled cadence
    -> cancel ALL pending cadence touches immediately
    -> enter WF-07 (Active Conversation)

Customer's stated intent diverges from original bucket
    -> preserve original_bucket (reporting/attribution)
    -> update active_intent
    -> switch word track to match active_intent

Customer's vehicle interest changes (different vehicle, same type)
    -> update active_vehicle
    -> re-query availability/context (WF-10)
    -> do NOT restart the conversation from scratch

Customer switches New <-> Used
    -> preserve original_vehicle_type (reporting/attribution)
    -> update active_vehicle_type

Vehicle turns out to be sold/unavailable
    -> tell the customer honestly (see TRUTHMODE reconciliation note above)
    -> query live inventory for alternatives
    -> rank and present alternatives
    -> continue the conversation toward the next objective (appointment or follow-up)

Appointment attempt #1 rejected
    -> capture the stated objection/hot button
    -> continue answering questions
    -> attempt #2 must use a different approach, not a repeat of #1

Appointment attempt #2 rejected
    -> continue conversation
    -> attempt #3 must use a distinct value proposition, not a repeat of #1 or #2

Appointment attempt #3 rejected
    -> stop pushing for an appointment (source-defined)
    -> establish a qualified follow-up date/time, record the reason (source-defined)
    -> see WF-12: exact reset/re-attempt semantics are unresolved, not a requirement

Escalation condition detected (salesperson request, urgency, upset, phone-call request)
    -> suspend conflicting AI automation immediately
    -> preserve full conversation context for the human
    -> route to appropriate human/queue
    -> log escalation reason
    -> (phone-call request specifically: target human contact within 5 minutes during business hours)

Appointment successfully booked
    -> stop the no-response cadence (if still pending)
    -> stop further appointment solicitation
    -> persist appointment record
    -> send confirmation to customer
    -> hand off to downstream appointment/CRM workflow
```

---

## End-to-End Flow Summary (Linear View)

```
Lead Received
   → TCPA/After-Hours Check
       → [Wants Help Now] → Continue immediately (if within TCPA hours)
       → [Prefers Next Business Day] → Confirm + schedule next-business-day contact, stop outreach now
   → New Lead Intake / Sales-Service Classification
       [exact sequencing between intake and classification is not defined on the poster — the poster's compliance strip says "continue to Sales/Service Classification," while New Lead Intake is drawn as its own numbered section; this summary does not assert which happens first]
       → If Sales: continue to Sales Bucket Routing
       → If Service: handoff only — Service workflow is not defined on this poster
   → Bucket Routing (Bucket 1: Credit/Financing | Bucket 2: Trade-In/Sell | Bucket 3: General Sales)
       → Vehicle Type Filter (New vs. Used) — continuously re-evaluated
   → Common Sales Workflow
       ├─ A. No-Response Cadence (Day 1–6, 7 touches) — runs until customer responds
       └─ B. Active Conversation Workflow (triggered by any response)
             1. Answer Questions
             2. Identify Intent/Hot Buttons/Objections
             3. Determine Trade & Fill Missing Data (Mandatory)
                 → establish No Trade / Has Trade
                 → if trade, collect missing trade data (Year, Make, Model, Mileage, Condition, Payoff/Loan, Expected Value)
                 → additional meaning of "Fill Missing Data" (e.g., whether it extends to F&I fields) remains implementation/stakeholder-defined
             4. Assume Ready Now
             5. Drive Appointment within 72 hrs
                 → C. Appointment Conversion (up to 3 attempts)
                       → Success: Appointment Set (within 72 hrs)
                       → 3rd Rejection: Stop pushing → Schedule Follow-Up (log reason) — see "Post-Third-Rejection" note above for what remains unresolved
   [Throughout: AI Personalization Engine + DMS/Inventory integration feed every message]
   [Throughout: AI Learning Engine tracks & optimizes every touch]
   [Throughout: First Quality Response Rule governs vehicle link/image priority]
   [Throughout: Business Hours Rule governs send timing]
   [Throughout: Escalation Rules can interrupt at any point → human handoff]
   [Throughout: Communication Channel Rule — respond via channel of origin]
```
