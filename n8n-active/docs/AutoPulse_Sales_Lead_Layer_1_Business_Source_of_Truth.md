# AutoPulse.ai Sales Lead Blueprint — Layer 1

## Annotated Business Source of Truth

**Purpose:** Faithfully document the supplied Sales Lead Blueprint
poster, including its explicit rules, wording, branches, and known
source inconsistencies.

### Scope & provenance

This is the **business source-of-truth layer**. It primarily documents
what is shown on the poster. Where interpretation or engineering
guidance is necessary, it is explicitly labeled as an **implementation
note**, **interpretation**, or **unresolved decision**.

This document does **not** define the executable workflow architecture.
Stable workflow IDs, state transitions, interruptions, state ownership,
and implementation decisions belong in **Layer 2 — Workflow
Implementation Specification**.

|                                                                                                                                                                                                                                                              |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| \> Source: `main_workflow_CONFIDENTIAL.png` \> Core principle stated on the diagram: **“TRUTHMODE ALWAYS — Every interaction is honest, transparent, and customer-first.”** \> Tagline: “ONE SYSTEM. THREE INTENT BUCKETS. TWO VEHICLE TYPES. ONE WORKFLOW.” |

## 0. After-Hours & TCPA Compliance Rule (Gate — runs BEFORE any outreach)

This check happens before any outreach and respects TCPA calling hours
(8am–9pm local time at the customer’s location).

1.  **Lead Received** — lead comes in via any source, day or night.
2.  **Contact-Time / After-Hours Check** — AI checks customer local
    time, TCPA rules, consent, and channel.
3.  **Assist Now or Next Business Day** (offer the choice):
    - **Branch A — Customer wants help now:** AI acknowledges and
      continues the conversation immediately (if within TCPA-allowed
      hours).
    - **Branch B — Customer prefers next business day:** AI confirms
      preference, schedules first contact for the next business day when
      outreach opens, and stops outreach now.
4.  Both branches converge → continue to **Sales/Service
    Classification**.

------------------------------------------------------------------------

## 1. New Lead Intake

Capture and structure raw lead data:

- Capture lead data
- Identify source
- Read raw comments
- Identify customer question
- Identify vehicle (if any)
- Identify likely intent
- Collect available customer data

**Output:** AutoPulse understands who the customer is, why they
submitted the lead, and what they asked.

------------------------------------------------------------------------

## 2. Sales Lead Bucket Routing (Source Intent Buckets)

When a lead is classified as **Sales**, it is assigned to one of three
Source Intent Buckets **before** entering the workflow.

### Bucket 1 — Credit / Financing Intent

- **Sources (examples):** Capital One, Chase, Carzing, DealerCentric,
  Credit Application, eUnifi, 700Credit, and others (to be added)
- **Primary intent:** Customer is focused on approval, payment options,
  financing, or credit-related next steps.
- **Word-track emphasis:** Financing options, pre-approval, payment
  structure, required information, and how an appointment helps clarify
  real options.

### Bucket 2 — Trade-In / Sell My Car Intent

- **Sources (examples):** KBB, TrueCar SELL My Car, AccuTrade, CarGurus
  SELL My Car, and others (to be added)
- **Primary intent:** Customer wants to sell or trade a vehicle.
- **Word-track emphasis:** Value, appraisal, vehicle condition, payoff,
  equity, and getting an accurate in-person number. Aggressively collect
  trade data (core intent).

### Bucket 3 — General Sales Intent

- **Sources (examples):** CarGurus (regular), Edmunds, Car Now,
  AutoTrader, Cars.com, Facebook, Instagram, AutoWeb, CarsDirect,
  TrueCar (non-trade), and others (to be added)
- **Primary intent:** Customer is shopping, comparing, asking
  vehicle-specific questions, or exploring purchase options.
- **Word-track emphasis:** Vehicle availability, pricing, features,
  condition, history, alternatives, trade, financing, and whatever the
  lead comments indicate matters most.

**Bucket Override Rule:** If customer behavior clearly indicates a
different primary intent (e.g., a credit lead wants to sell their car),
AI adapts the conversation to that intent while retaining the original
bucket for reporting and analytics.

### Vehicle Type Filter (applies after source-intent bucket is set)

After identifying source intent, determine what type of vehicle the
customer is interested in:

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
  - Specific used VIN / stock \# requested
  - Exact vehicle availability
  - Mileage / condition / history
  - CARFAX / history when available
  - Similar used inventory
  - Price changes / price drops
  - Alternative vehicles if unit sells

**Vehicle Type Override Rule:** AutoPulse continuously updates New/Used
classification based on customer behavior. If a customer switches from
New → Used (or Used → New), AI adapts the conversation while retaining
the original classification for reporting and attribution.

### Bucket Rules & Behavior (side panel, applies to all 3 buckets)

- Bucket determines **intent & language**, not the workflow.
- All three buckets follow the **same core workflow** with unique word
  tracks based on intent.
- **Behavior Override Rule:** If the customer’s responses show different
  intent, AutoPulse adapts the conversation in real time while
  preserving the original bucket for reporting & analytics.

------------------------------------------------------------------------

## 3. Common Sales Workflow (Runs for All 3 Buckets, with Bucket-Specific Word Tracks)

### A. No-Response Cadence (Initial 6-Day Outreach)

Runs **only** while the customer has not responded. Cadence stops
immediately at any point the customer responds, moving them to Active
Conversation.

This table is transcribed **exactly as printed** on the poster (verified
by zooming into the panel):

| Day   | Touch                                                      | Action                                                                                                                                                    |
|-------|------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Day 1 | Touch 1                                                    | Within 60 seconds — First Quality Response. Personalized, addresses their inquiry, uses customer name & intent. Include vehicle link/image if applicable. |
| Day 1 | Touch 2                                                    | 3 hours later — Pattern Interrupt: “Hi, \[Customer Name\]?” If 3-hour mark is after business hours, sends at next opening time.                           |
| Day 2 | Touch 3                                                    | One Personalized Engagement Message — designed to get the customer to respond.                                                                            |
| Day 3 | Touch 4                                                    | One Personalized Engagement Message — new approach based on data & learning.                                                                              |
| Day 3 | Touch 4 *(again — see note)*                               | One Personalized Engagement Message — different strategy to drive response.                                                                               |
| Day 4 | Touch 6 *(Touch 5 does not appear anywhere on the poster)* | One Personalized Engagement Message — different strategy to drive response.                                                                               |
| Day 6 | Touch 7                                                    | One Personalized Engagement Message — final message in the initial cadence.                                                                               |

> ⚠️ **Source inconsistency, not a transcription error:** the poster
> itself prints “Day 3 / Touch 4” twice and has no “Touch 5” anywhere —
> it jumps from Touch 4 to Touch 6. This is very likely a labeling
> mistake in the original artwork (a dropped day/touch pair), but it’s
> reproduced here exactly as printed rather than silently “corrected,”
> since a developer needs to know the source is ambiguous here. **Before
> implementation, this needs a decision from whoever owns the poster** —
> the most probable intended fix is a 7-touch, 6-day sequence such as:
> Day1/T1, Day1/T2, Day2/T3, Day3/T4, Day4/T5, Day5/T6, Day6/T7 — but
> that is an assumption, not something stated on the source.

> **Rule:** Customer responds at ANY point → stop this cadence
> immediately and move to Active Conversation.

### B. Active Conversation Workflow (Starts When Customer Responds)

1.  **Answer Questions** — provide clear, honest answers based on their
    specific needs.

2.  **Identify Intent, Hot Buttons & Objections** — find out what
    matters most; surface concerns early.

3.  **Determine Trade & Fill Missing Data (Mandatory)** — every sales
    customer must end with one of:

    - No Trade
    - Has Trade
    - If trade, collect: Year, Make, Model, Mileage, Condition,
      Payoff/Loan, Expected Value (when relevant)

    > **Implementation note:** the poster’s label is literally “Fill
    > Missing Data,” not “F&I Missing Data” (confirmed by zooming into
    > the panel) — “Fill” refers generically to whatever data is
    > missing, not specifically financing/insurance fields. In practice,
    > “missing data” should be read as scoped to the active bucket: for
    > Bucket 1 (Credit/Financing) leads this reasonably includes
    > financing/F&I fields (e.g., desired payment, approval status, down
    > payment) alongside trade status; for Bucket 2/3 it’s primarily
    > trade fields. This scoping isn’t stated explicitly on the poster
    > and should be confirmed with stakeholders before being hard-coded
    > as a business rule.

4.  **Assume Ready Now** — operating assumption: the customer is ready
    now. Only change if the customer explicitly says otherwise **and**
    provides a reason for delay (this exact “explicitly says otherwise
    AND provides a reason” wording is on the poster).

    > **Implementation note:** the AI should not attempt to judge
    > whether a customer’s stated reason is “valid” in some qualitative
    > sense — the presence of an explicit, stated reason for delay is
    > what triggers the override, not an assessment of how good that
    > reason is. Treat this as a binary gate (reason stated vs. not
    > stated), not a quality filter.

5.  **Drive Appointment Within 72 Hours** — primary objective:
    appointment booked within 72 hours. Give a compelling,
    customer-specific reason to come sooner rather than later (not fake
    urgency).

### C. Appointment Conversion — Ask Up To 3 Times

| Attempt         | Approach                                                                                     |
|-----------------|----------------------------------------------------------------------------------------------|
| Attempt 1       | Appointment ask based on primary intent and value.                                           |
| Attempt 2       | Different approach based on hot button or objection.                                         |
| Attempt 3       | Different value proposition explaining why meeting sooner benefits them.                     |
| Third Rejection | → **Stop pushing for appointment.** Schedule a follow-up, record the reason, then follow up. |

> **State detail (not explicit on the poster, added for implementation
> clarity):** after the 3rd rejection, appointment-push behavior should
> be disabled *for the remainder of the current conversation cycle* —
> the AI keeps answering questions and providing value, but does not
> re-initiate an appointment ask. The qualified follow-up (with its own
> date/time) becomes the new active objective in place of the
> appointment ask. `appointment_attempt_count` should only reset when a
> new outreach cycle begins (e.g., a new cadence, a new inbound lead
> event, or the scheduled follow-up date arrives) — not immediately
> within the same conversation.

------------------------------------------------------------------------

## 4. AI Personalization Engine (“The Brains”)

Every message is personalized using: - Lead Source / Bucket Intent -
Customer Data (name, phone, email, etc.) - Vehicle of Interest - Raw
Lead Comments & Questions - Trade Information (if any) - Previous
Touches & History - Hot Buttons & Objections - Customer Behavior &
Timing

### DMS Integration (When Available)

Use prior DMS transaction history from Sales and/or Service: - Previous
purchases - Service history - Previous trade - Service preferences -
Communication history

**Purpose:** Build trust, personalize the conversation, and provide a
better customer experience.

### Inventory Feed Integration (Live Data)

Use real-time inventory feed to: - Suggest similar / alternative models
& trims - Show alternative vehicles in similar price/payment range -
Alert on NEW inventory arrivals - Alert on PRICE CHANGES & price drops -
Highlight recently added or incoming inventory

**Purpose:** Deliver more choices, create real urgency, and keep the
conversation positive and helpful.

### Positive Outcomes Only

- **As printed on the poster:** “Never say a vehicle is not available.”
  Instead, keep conversation moving forward with:
  - Similar option better for their needs/goals
  - Best fit alternatives
  - Upcoming inventory
  - Price changes/drops
  - More options to consider

> ⚠️ **Reconciliation with TRUTHMODE ALWAYS (added interpretation, not
> on the poster):** read literally, “never say a vehicle is not
> available” conflicts with the diagram’s own top-level principle —
> “every interaction is honest, transparent, and customer-first.” The
> intended behavior is almost certainly about *tone and framing*, not
> concealment: **never fabricate availability or hide the fact that a
> specific vehicle is sold/unavailable.** When a vehicle is genuinely
> unavailable, the AI should say so honestly, and immediately pivot to a
> similar option, a better-fit alternative, upcoming inventory, or
> another concrete next step — rather than dwelling on the negative or
> leaving the customer with a dead end. This distinction (be honest
> about status, but frame the redirect positively) should be made
> explicit in any prompt/logic built from this rule, since “never say X”
> is easy for a model to over-apply into “conceal X.”

------------------------------------------------------------------------

## 5. AI Learning & Optimization Engine

Track everything. Learn constantly. Get better every day.

Tracked dimensions: Touch, Message Strategy, Lead Source, Timing,
Customer Data, Response / No-Response, Appointment / No-Appointment.

- AI learns which combinations generate the highest engagement and uses
  successful approaches more frequently.
- Performance is evaluated **in context** (by source, intent, time of
  day, etc.).
- Do not blindly repeat the same message — use data to choose the next
  best approach.
- Continually A/B test wording, timing, and strategies.
- Goal of every touch: **get the customer to respond.**

------------------------------------------------------------------------

## 6. First Quality Response Rule

For sales leads tied to a specific vehicle, in priority order: 1.
Vehicle link + image (when both available) 2. Vehicle link (if image not
available) 3. Vehicle image (if clean link not available) 4. If not tied
to a specific vehicle, personalize around the customer’s intent instead.

> Always verify vehicle is active & available before sending media.

------------------------------------------------------------------------

## 7. Business Hours Rule

- 3-hour touch on Day 1: if within business hours → send at 3 hours; if
  outside business hours → send at opening next business day.
- All other touches follow business hours unless the customer replies.

------------------------------------------------------------------------

## 8. Escalation Rules

- If the customer asks for a salesperson → escalate immediately.
- If the customer indicates urgent need → escalate immediately.
- If the customer is upset → escalate immediately.
- If the customer requests a phone call → call within 5 minutes during
  business hours.
- All escalations are logged & tracked.

------------------------------------------------------------------------

## 9. Communication Channels

Use the channel the customer came from when possible: SMS/Text, Email,
Phone (Call), Web Chat, Social DM.

> Stay consistent. Be responsive. Be human.

------------------------------------------------------------------------

## Core Principles (Always)

- **Appointment Set:** Booked within 72 hours.
- **Scheduled Follow-Up:** Qualified follow-up with date & time set
  (alternative outcome if appointment isn’t set).
- Personalize every interaction.
- Earn the appointment.
- Provide value in every touch.
- **One Goal:** Earn the customer’s response & their business.

------------------------------------------------------------------------

------------------------------------------------------------------------

## Source Decisions Requiring Confirmation

The poster leaves the following items unresolved or internally
inconsistent:

1.  **No-response cadence numbering:** the poster duplicates Day 3 /
    Touch 4, omits Touch 5, and contains no Day 5 entry.
2.  **Sales/Service sequencing:** the poster references Sales/Service
    Classification but does not define a Service-side workflow or an
    unambiguous implementation sequence between intake and
    classification.
3.  **“Fill Missing Data”:** the exact field set beyond the explicitly
    listed trade fields is not defined.
4.  **Post-third-rejection behavior:** the poster says to stop pushing,
    schedule a follow-up, record the reason, and follow up, but does not
    define when appointment-attempt state resets.
5.  **Cadence exhaustion:** behavior after the final no-response touch
    is not defined.
6.  **Escalation ownership/SLA:** aside from the phone-call target of
    five minutes during business hours, assignment and SLA behavior are
    not specified.
7.  **Business-hours source:** the poster defines the Day-1 +3-hour
    behavior but does not fully define which calendar/timezone governs
    every operational scheduling case.

These should be treated as business questions, not silently resolved by
implementation.
