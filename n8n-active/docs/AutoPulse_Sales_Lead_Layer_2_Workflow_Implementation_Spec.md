# AutoPulse.ai Sales Lead Blueprint — Layer 2

## Workflow Implementation Specification

**Derived from:** Layer 1 — Annotated Business Source of Truth  
**Status:** Proposed executable specification; poster-defined
requirements are distinguished from implementation decisions.

> **Rule of precedence:** If this document conflicts with Layer 1, Layer
> 1 wins unless a stakeholder-approved decision explicitly changes the
> business requirement.

------------------------------------------------------------------------

# 1. Specification Conventions

Each workflow is described using:

**Trigger → Preconditions → Inputs → Decisions → Actions → State Changes
→ Exit Conditions → Interruptions → Next Workflow**

Labels used throughout:

- **\[SOURCE\]** — explicitly defined by the poster / Layer 1.
- **\[DERIVED\]** — implementation structure inferred from
  source-defined behavior.
- **\[UNRESOLVED\]** — requires business-owner confirmation before
  production behavior is fixed.

------------------------------------------------------------------------

# 2. Global Conversation State

A workflow engine should be able to carry at least the following
conceptual state. Field names are illustrative, not a required database
schema.

``` text
identity
    customer_id
    lead_id
    dealership_id

attribution
    lead_source
    original_bucket
    active_intent

vehicle_context
    original_vehicle_type
    active_vehicle_type
    active_vehicle
    inventory_context

conversation
    channel
    conversation_history
    raw_lead_comments
    customer_questions
    hot_buttons
    objections

trade
    trade_status = UNKNOWN | NO_TRADE | HAS_TRADE
    known_trade_fields
    missing_trade_fields

timing
    customer_local_time
    business_hours
    next_scheduled_touch
    follow_up_at

cadence
    cadence_active
    current_touch
    pending_touches

appointment
    appointment_attempt_count
    appointment_push_allowed
    appointment_status
    appointment_time

escalation
    escalation_active
    escalation_reason
    escalation_owner

analytics
    message_strategy
    touch_history
    response_outcomes
    appointment_outcomes
```

**\[DERIVED\]** The distinction between original and active
intent/vehicle type exists to implement the poster’s explicit override
rules without losing reporting attribution.

------------------------------------------------------------------------

# 3. Global Invariants

1.  **TRUTHMODE ALWAYS \[SOURCE\]** — interactions must remain honest,
    transparent, and customer-first.
2.  **Compliance before outreach \[SOURCE\]** — run the TCPA/after-hours
    gate before outbound outreach.
3.  **Customer response interrupts no-response cadence \[SOURCE\]** —
    any response stops the remaining cadence.
4.  **Original attribution survives overrides \[SOURCE\]** — active
    behavior can change without overwriting original bucket/vehicle
    classification.
5.  **Appointment attempts use distinct approaches \[SOURCE\]** — up to
    three asks; after the third rejection, stop pushing.
6.  **Escalation can pre-empt normal automation \[DERIVED\]** — required
    to implement “escalate immediately” without conflicting AI messages.
7.  **Service is handoff-only \[SOURCE LIMIT\]** — no Service workflow
    is defined by this poster.
8.  **Live inventory facts must not be fabricated \[DERIVED from
    TRUTHMODE\]** — positive framing cannot override factual truth.

------------------------------------------------------------------------

# 4. Workflow Registry

| ID    | Workflow                                 | Primary Trigger                      |
|-------|------------------------------------------|--------------------------------------|
| WF-01 | Lead Receipt & Intake                    | New lead arrives                     |
| WF-02 | Compliance / After-Hours Gate            | Before first outbound outreach       |
| WF-03 | Sales / Service Classification           | Lead requires routing                |
| WF-04 | Sales Intent Bucket Routing              | Lead classified as Sales             |
| WF-05 | Vehicle-Type Classification              | Sales bucket established             |
| WF-06 | First Quality Response                   | Sales context available              |
| WF-07 | No-Response Cadence                      | First response sent; customer silent |
| WF-08 | Active Conversation                      | Customer responds                    |
| WF-09 | Intent / Hot Button / Objection Analysis | Active customer turn                 |
| WF-10 | Trade & Missing-Data Discovery           | Active conversation discovery        |
| WF-11 | Inventory Resolution                     | Vehicle/inventory context needed     |
| WF-12 | Appointment Conversion                   | Appointment objective is appropriate |
| WF-13 | Appointment Booking                      | Customer accepts appointment         |
| WF-14 | Third-Rejection Follow-Up                | Third appointment ask rejected       |
| WF-15 | Escalation / Human Handoff               | Escalation condition detected        |
| WF-16 | DMS Context Enrichment                   | Relevant DMS history available       |
| WF-17 | Personalization Assembly                 | Before AI/customer-facing response   |
| WF-18 | Learning / Outcome Capture               | After touch/outcome                  |
| WF-19 | Channel Routing                          | Response is ready to deliver         |

------------------------------------------------------------------------

# 5. WF-01 — Lead Receipt & Intake

**Trigger:** New lead arrives from any supported source.

**Preconditions:** None beyond successful receipt.

**Inputs \[SOURCE\]:** - Lead payload - Lead source - Raw comments -
Customer question - Vehicle, if any - Available customer data

**Decisions:** - Can source be identified? - Can vehicle be
identified? - Can likely intent be inferred? - Is sufficient customer
context available to continue?

**Actions \[SOURCE\]:** - Capture lead data. - Identify source. - Read
raw comments. - Identify customer question. - Identify vehicle if
present. - Identify likely intent. - Collect available customer data.

**State Changes \[DERIVED\]:** - Persist normalized intake context. -
Preserve original raw input for traceability.

**Exit Conditions:** Intake context assembled.

**Interruptions:** None defined.

**Next Workflow:** WF-02 and/or WF-03 according to orchestration order.

**\[UNRESOLVED\]:** The poster does not unambiguously define whether
full intake occurs before Sales/Service classification or whether
classification is part of intake. Do not hard-code this sequencing as a
business rule.

------------------------------------------------------------------------

# 6. WF-02 — Compliance / After-Hours Gate

**Trigger:** Before outbound outreach.

**Inputs \[SOURCE\]:** - Customer local time - TCPA rules - Consent -
Channel - Customer preference

**Decisions \[SOURCE\]:**

``` text
Is outreach currently permitted?
Does customer want help now?
Does customer prefer next business day?
```

**Actions:** - If permitted and customer wants help now → continue. - If
customer prefers next business day → confirm preference, schedule
contact, stop outreach now. - If outreach is not permitted → defer until
permitted.

**State Changes \[DERIVED\]:** - Set next eligible outreach time when
deferred. - Mark outreach as blocked/allowed for current execution.

**Exit Conditions:** Outreach permitted now, or future contact
scheduled.

**Interruptions:** New inbound customer activity may require
re-evaluation.

**Next Workflow:** WF-03 / sales workflow when contact is eligible.

------------------------------------------------------------------------

# 7. WF-03 — Sales / Service Classification

**Trigger:** Lead requires business-flow classification.

**Decision:**

``` text
SALES   -> WF-04
SERVICE -> Service handoff
UNKNOWN -> classification resolution
```

**Actions \[SOURCE LIMIT\]:** - Sales continues through this
specification. - Service exits this specification.

**\[UNRESOLVED\]:** No Service-side behavior is defined by the source
poster.

------------------------------------------------------------------------

# 8. WF-04 — Sales Intent Bucket Routing

**Trigger:** Lead classified as Sales.

**Inputs:** Lead source, comments, inferred intent.

**Decisions \[SOURCE\]:**

``` text
Bucket 1 -> Credit / Financing
Bucket 2 -> Trade-In / Sell My Car
Bucket 3 -> General Sales
```

**Actions:** - Assign original bucket. - Initialize active intent/word
track from bucket.

**Override \[SOURCE\]:**

``` text
IF customer behavior later shows a different primary intent:
    preserve original_bucket
    update active_intent
    adapt word track immediately
```

**Exit:** Bucket assigned.

**Next:** WF-05.

------------------------------------------------------------------------

# 9. WF-05 — Vehicle-Type Classification

**Trigger:** Sales bucket established.

**Decision \[SOURCE\]:**

``` text
NEW
USED
UNKNOWN
```

**New context includes:** model/trim, OEM incentives, lease/finance
programs, rebates, alternatives, incoming inventory, dealer
locate/trade, upgrade/loyalty.

**Used context includes:** VIN/stock, availability, mileage,
condition/history, CARFAX/history, similar inventory, price changes,
alternatives if unit sells.

**Override \[SOURCE\]:**

``` text
IF customer switches New <-> Used:
    preserve original_vehicle_type
    update active_vehicle_type
    adapt conversation
```

**Next:** WF-06 or WF-11 where inventory resolution is required.

------------------------------------------------------------------------

# 10. WF-06 — First Quality Response

**Trigger:** Sufficient sales context exists to respond.

**Inputs:** Customer context, bucket/intent, vehicle context, raw
question, inventory status.

**Decision priority \[SOURCE\]:**

``` text
specific vehicle + link + image -> send link + image
specific vehicle + link only    -> send link
specific vehicle + image only   -> send image
no specific vehicle             -> personalize by intent
```

**Pre-send rule \[SOURCE\]:** Verify vehicle is active and available
before sending media.

**Actions:** Build personalized response via WF-17 and deliver through
WF-19.

**Exit:** - Customer responds → WF-08. - Customer remains silent →
WF-07.

------------------------------------------------------------------------

# 11. WF-07 — No-Response Cadence

**Trigger:** First response sent and customer has not responded.

**Critical interruption \[SOURCE\]:**

``` text
ANY customer response
    -> cancel/suppress remaining cadence
    -> WF-08 immediately
```

**Source cadence \[SOURCE — internally inconsistent\]:**

| Day   | Touch              |
|-------|--------------------|
| Day 1 | Touch 1            |
| Day 1 | Touch 2 (+3 hours) |
| Day 2 | Touch 3            |
| Day 3 | Touch 4            |
| Day 3 | Touch 4 again      |
| Day 4 | Touch 6            |
| Day 6 | Touch 7            |

**Business-hours behavior \[SOURCE\]:** - Day-1 Touch-2 is +3 hours when
inside business hours. - If +3 hours falls outside business hours, send
at next opening. - Other touches follow business hours unless customer
replies.

**Actions \[SOURCE\]:** - Vary message strategy. - Personalize. -
Optimize for customer response.

**State Changes \[DERIVED\]:** - Track touch and strategy. - Maintain
pending cadence schedule.

**Exit:** - Response → WF-08. - Final printed cadence touch completed
with no response → unresolved.

**\[UNRESOLVED\]:** - Correct intended Touch 4/5/6 schedule. - Day 5
behavior. - Behavior after cadence exhaustion.

Do not invent these values in production configuration.

------------------------------------------------------------------------

# 12. WF-08 — Active Conversation

**Trigger:** Any customer response.

**Immediate actions:** 1. Stop pending no-response cadence. 2. Load
current conversation/customer context. 3. Check escalation conditions.
4. Re-evaluate active intent and vehicle type. 5. Answer the customer’s
questions. 6. Run discovery and appointment logic as appropriate.

**Next Workflows:** - WF-09 intent/hot-button/objection analysis - WF-10
trade/missing data - WF-11 inventory resolution - WF-12 appointment
conversion - WF-15 escalation - WF-16 DMS enrichment - WF-17
personalization

**Exit:** Appointment, follow-up, escalation, or continuing active
conversation.

------------------------------------------------------------------------

# 13. WF-09 — Intent / Hot Button / Objection Analysis

**Trigger:** Each meaningful active-conversation turn.

**Inputs:** Current message + conversation history.

**Actions \[SOURCE\]:** - Identify current intent. - Identify hot
buttons. - Identify objections. - Adapt response to what matters most.

**State Changes \[DERIVED\]:** - Update active intent where behavior
override applies. - Preserve original bucket.

**Next:** Return to WF-08; feed WF-12 and WF-17.

------------------------------------------------------------------------

# 14. WF-10 — Trade & Missing-Data Discovery

**Trigger:** Active Conversation stage requiring customer qualification.

**Source requirement \[SOURCE\]:** Determine Trade & Fill Missing Data
(Mandatory).

**Trade terminal classification:**

``` text
NO_TRADE
HAS_TRADE
```

**If HAS_TRADE, source-listed data includes:** - Year - Make - Model -
Mileage - Condition - Payoff / loan - Expected value when relevant

**Actions:** - Determine trade status. - Ask only for missing relevant
data. - Preserve already-known information.

**\[UNRESOLVED\]:** “Fill Missing Data” is not exhaustively defined by
the poster. Financing/F&I fields beyond explicit poster content require
stakeholder confirmation.

**Next:** WF-08 / WF-12.

------------------------------------------------------------------------

# 15. WF-11 — Inventory Resolution

**Trigger:** Vehicle availability/search context is required.

**Inputs:** Active vehicle, vehicle type, customer criteria, live
inventory feed.

**Actions \[SOURCE\]:** - Use live inventory. - Suggest
similar/alternative models and trims. - Surface alternatives in similar
price/payment range. - Surface new arrivals, price changes/drops,
recently added/incoming inventory where relevant.

**Truth handling:**

``` text
IF exact vehicle is available:
    use exact current vehicle context
ELSE:
    do not fabricate availability
    truthfully resolve status under TRUTHMODE
    immediately pivot to useful alternatives
```

The second branch is a **\[DERIVED\] reconciliation** between TRUTHMODE
and the poster’s “Never say a vehicle is not available” wording.

**State Changes:** Update active inventory context.

**Next:** WF-17 → WF-19, then WF-08.

------------------------------------------------------------------------

# 16. WF-12 — Appointment Conversion

**Trigger:** Active sales conversation reaches appointment objective.

**Source objective \[SOURCE\]:** Drive appointment within 72 hours.

**Attempt logic \[SOURCE\]:**

``` text
Attempt 1:
    ask based on primary intent + value

IF rejected:
    capture objection/hot button
    continue conversation

Attempt 2:
    use a different approach based on hot button/objection

IF rejected:
    continue conversation

Attempt 3:
    use a different value proposition explaining customer benefit

IF accepted at any point:
    -> WF-13

IF third rejection:
    -> STOP PUSHING
    -> WF-14
```

**State Changes \[DERIVED\]:** - Track appointment attempt count. -
Track rejection reason where stated.

**Interruption:** WF-15 escalation can pre-empt.

**\[UNRESOLVED\]:** Exact conditions determining when each next attempt
becomes appropriate are not defined.

------------------------------------------------------------------------

# 17. WF-13 — Appointment Booking

**Trigger:** Customer accepts appointment.

**Source-defined outcome:** Appointment set, targeted within 72 hours.

**Derived actions required to operationalize outcome:** -
Determine/confirm date and time. - Persist appointment. - Send
confirmation. - Stop further appointment solicitation. - Stop
conflicting no-response cadence. - Update CRM/conversation state.

**\[UNRESOLVED\]:** The poster does not define appointment-system API
behavior, slot locking, rescheduling, cancellation, reminders, or
downstream appointment lifecycle.

------------------------------------------------------------------------

# 18. WF-14 — Third-Rejection Follow-Up

**Trigger:** Third appointment attempt rejected.

**Source-defined behavior \[SOURCE\]:** - Stop pushing for
appointment. - Schedule a follow-up. - Record the reason. - Follow up.

**Implementation state:**

``` text
appointment_push_allowed = false
```

for the current active push sequence is a **\[DERIVED\]** mechanism for
implementing “stop pushing.”

**\[UNRESOLVED — DO NOT ASSUME\]:** - When `appointment_attempt_count`
resets. - Whether a new inbound message resets attempts. - Whether the
scheduled follow-up resets attempts. - Whether another three appointment
attempts are permitted later. - Whether follow-up enters a new
cadence. - Exact follow-up timing rules.

These require stakeholder approval.

------------------------------------------------------------------------

# 19. WF-15 — Escalation / Human Handoff

**Trigger \[SOURCE\]:** - Customer asks for salesperson. - Customer
indicates urgent need. - Customer is upset. - Customer requests a phone
call.

**Actions:** - Escalate immediately. - Log/track escalation. - For
phone-call request: target call within five minutes during business
hours.

**Derived orchestration behavior:** - Suspend conflicting AI
automation. - Preserve full conversation context. - Route context to the
human/queue.

**\[UNRESOLVED\]:** - Assignment owner. - Non-phone escalation SLA. -
What automation may continue during human ownership. - Resume/release
behavior after human intervention.

------------------------------------------------------------------------

# 20. WF-16 — DMS Context Enrichment

**Trigger:** Relevant DMS history is available.

**Source context may include:** - Previous purchases - Service history -
Previous trade - Service preferences - Communication history

**Action:** Feed relevant context into personalization.

**Exit:** Return enriched context to WF-17.

**\[UNRESOLVED\]:** Data freshness, permitted fields, conflict handling,
and precedence are not defined by this poster.

------------------------------------------------------------------------

# 21. WF-17 — Personalization Assembly

**Trigger:** Before generating a customer-facing message.

**Source inputs:** - Lead source / bucket intent - Customer data -
Vehicle of interest - Raw comments/questions - Trade information -
Previous touches/history - Hot buttons/objections - Customer
behavior/timing - Relevant DMS/inventory context

**Action:** Assemble context appropriate to the current channel, active
intent, and conversation state.

**Invariant:** Original attribution is not overwritten by active
conversational overrides.

**Next:** AI response generation / WF-19.

------------------------------------------------------------------------

# 22. WF-18 — Learning / Outcome Capture

**Trigger:** After meaningful touch/outcome.

**Tracked dimensions \[SOURCE\]:** - Touch - Message Strategy - Lead
Source - Timing - Customer Data - Response / No-Response - Appointment /
No-Appointment

**Source optimization behavior:** - Evaluate performance in context. -
Use successful approaches more frequently. - Do not blindly repeat
messages. - A/B test wording, timing, strategies. - Goal of every touch:
get customer to respond.

**\[UNRESOLVED\]:** Statistical method, experiment assignment, sample
size, promotion criteria, model-training strategy, and governance are
not defined.

------------------------------------------------------------------------

# 23. WF-19 — Channel Routing

**Trigger:** Customer-facing response ready.

**Source channels:** - SMS/Text - Email - Phone/Call - Web Chat - Social
DM

**Source rule:** Use the channel the customer came from when possible.

**Derived state behavior:** Channel changes must not destroy
conversation state or attribution.

**\[UNRESOLVED\]:** Channel-specific formatting, consent, fallback,
delivery-failure, and cross-channel handoff rules are outside what this
poster defines.

------------------------------------------------------------------------

# 24. Cross-Cutting Transition Matrix

| Event                    | Current State                      | Required Transition                             |
|--------------------------|------------------------------------|-------------------------------------------------|
| Customer responds        | No-response cadence                | Cancel pending touches → WF-08                  |
| Intent changes           | Any active conversation            | Preserve original bucket → update active intent |
| New ↔ Used changes       | Any active conversation            | Preserve original type → update active type     |
| Vehicle changes          | Active conversation                | Update active vehicle → WF-11 as needed         |
| Inventory unavailable    | Inventory resolution               | Truthful status + alternatives → continue       |
| Appointment \#1 rejected | Appointment conversion             | Capture objection → continue → distinct \#2     |
| Appointment \#2 rejected | Appointment conversion             | Continue → distinct \#3                         |
| Appointment \#3 rejected | Appointment conversion             | Stop pushing → WF-14                            |
| Appointment accepted     | Appointment conversion             | WF-13                                           |
| Escalation trigger       | Any automatable conversation state | WF-15 immediately                               |
| Phone-call request       | Any conversation state             | WF-15; five-minute target in business hours     |

------------------------------------------------------------------------

# 25. Pre-emption Priority

A practical **\[DERIVED\]** orchestration priority is:

``` text
1. Compliance / legal gate
2. Explicit human escalation
3. Customer's current inbound question
4. Truth / factual data resolution
5. Active intent and objection handling
6. Appointment conversion
7. Scheduled no-response outreach
8. Learning/optimization
```

This prevents a lower-priority scheduled action from overriding a
higher-priority customer or compliance event.

------------------------------------------------------------------------

# 26. Canonical Conversation Algorithm

``` text
ON new lead:
    capture intake context
    run compliance gate before outbound outreach
    classify Sales / Service

    IF Service:
        hand off
        STOP sales workflow

    assign original sales bucket
    initialize active intent
    classify vehicle type
    build first quality response
    deliver through origin channel where possible

    IF no customer response:
        execute source-approved cadence
        BEFORE every touch:
            IF inbound response exists:
                cancel remaining cadence
                enter active conversation

ON every customer response:
    cancel pending no-response touches
    check escalation

    IF escalation:
        hand off immediately
        suppress conflicting automation
        STOP/PAUSE normal automation

    re-evaluate active intent
    re-evaluate vehicle type
    answer explicit questions
    identify hot buttons and objections
    determine trade / fill missing data

    IF inventory context required:
        resolve against live inventory

    apply ready-now assumption unless customer explicitly states otherwise and gives a reason

    IF appointment ask is appropriate:
        choose next source-defined distinct appointment approach

        IF accepted:
            book/confirm appointment
        ELSE IF third rejection:
            stop pushing
            schedule follow-up
            record reason

AFTER meaningful touch/outcome:
    capture learning dimensions
```

------------------------------------------------------------------------

# 27. Open Business Decisions Before Production

These are blockers to a fully deterministic implementation:

| Decision                         | Why it matters                                                  |
|----------------------------------|-----------------------------------------------------------------|
| Correct no-response cadence      | Source contains duplicate Touch 4 and missing Touch 5/Day 5     |
| Cadence exhaustion behavior      | Poster ends at Touch 7 without defining next state              |
| Post-third-rejection reset       | Prevents accidental repeated appointment pressure               |
| Meaning of “Fill Missing Data”   | Determines mandatory qualification fields                       |
| Sales/Service intake sequencing  | Source does not define exact implementation order               |
| Business-hours calendar/timezone | Needed for deterministic scheduling                             |
| Escalation ownership             | Needed for actual human routing                                 |
| Non-phone escalation SLA         | Only phone-call five-minute target is specified                 |
| Human handback/resume behavior   | Needed to prevent AI/human collision                            |
| Appointment slot system          | Needed to operationalize booking                                |
| Channel-specific rules           | Needed for SMS/email/chat delivery behavior                     |
| Learning/A-B governance          | Needed before automated optimization can safely change strategy |

------------------------------------------------------------------------

# 28. Traceability Principle

Every production rule should be traceable to one of:

``` text
SOURCE
    -> directly supported by Layer 1 / poster

APPROVED BUSINESS DECISION
    -> resolves an item explicitly marked UNRESOLVED

DERIVED IMPLEMENTATION
    -> technical mechanism used to implement a source rule
```

A derived implementation must never silently become a business
requirement.

------------------------------------------------------------------------

# 29. Definition of Ready for Workflow Build

The workflow specification is ready to translate into n8n, LangGraph, or
application services when:

1.  The cadence discrepancy is resolved.
2.  Post-third-rejection reset semantics are approved.
3.  “Fill Missing Data” fields are approved.
4.  Escalation ownership and resume behavior are approved.
5.  Appointment availability/booking integration is identified.
6.  Business-hours source and timezone behavior are confirmed.
7.  Channel-specific delivery/compliance rules are defined or delegated
    to existing platform services.

Until then, the unresolved areas should remain configurable or
explicitly blocked rather than guessed.
