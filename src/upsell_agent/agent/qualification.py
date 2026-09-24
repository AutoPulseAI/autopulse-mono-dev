"""Types for the lead-qualification conversation loop specified in
docs/data/conversations.md: CAPTURE → INTERPRET → LEVERAGE → ADVANCE, across
four lead types (Credit, Trade-in, Price/Payment, Service Interval).

This is a DIFFERENT, broader capability than the original single-shot
"recommend a priced product" flow (api/schemas.py's GroundedUpsellItem,
agent/nodes/recommend.py) — it reasons turn-by-turn over an ongoing
conversation, not once per trigger event. See ../../../README.md and
conversations.md itself for the full rationale; this file exists to make that
distinction concrete in code rather than leaving it as a comment.

Everything here is designed around conversations.md's one non-negotiable rule
(its own words): "Never invent information, approvals, pricing, trade values,
availability, or service needs." That rule is why NeverInventCategory and
CapturedFact.source exist — see guardrails/never_invent.py for how they're
enforced, not just documented.
"""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class LeadType(str, Enum):
    """The four buckets conversations.md defines. Maps onto (but is not
    identical to) the n8n blueprint's three "source intent buckets" (Credit,
    Trade-in, General Sales) plus Service, which the n8n blueprint treats
    separately — see n8n-active/docs/AutoPulse_Sales_Lead_Layer_1_Business_Source_of_Truth.md.
    Keeping this as its own enum rather than reusing an n8n-side constant
    because this service doesn't share code with n8n's workflow JSON; the
    mapping between the two needs to be an explicit, reviewed decision if/when
    this service and n8n's conversation logic need to agree on classification
    for the same lead — see README.md's open scope question.
    """

    CREDIT = "credit"
    TRADE_IN = "trade_in"
    PRICE_PAYMENT = "price_payment"
    SERVICE_INTERVAL = "service_interval"
    GENERAL = "general"


class NeverInventCategory(str, Enum):
    """conversations.md, verbatim: "Never invent information, approvals,
    pricing, trade values, availability, or service needs." Each of these is a
    category of claim the agent must NEVER generate itself — it may only
    reflect back a value that (a) the customer stated this conversation
    (see CapturedFact.source == 'customer_stated'), or (b) came from a real
    tool call (ToolCallRecord) for the one category conversations.md allows to
    be grounded that way: SERVICE_NEED, and only when backed by real
    vehicle/service data (see the Service Interval example's own caveat).
    APPROVAL, TRADE_VALUE, PRICE and AVAILABILITY are stricter: conversations.md's
    examples never state real numbers for these even when they'd be
    grounded — they're always deferred to a human ("the team can evaluate...").
    guardrails/never_invent.py treats these two groups differently for exactly
    this reason.
    """

    APPROVAL = "approval"
    PRICING = "pricing"
    TRADE_VALUE = "trade_value"
    AVAILABILITY = "availability"
    SERVICE_NEED = "service_need"


class FactSource(str, Enum):
    CUSTOMER_STATED = "customer_stated"  # the customer said this, this conversation — always trustworthy to reflect back
    TOOL_VERIFIED = "tool_verified"  # confirmed by a real tool call (e.g. vehicle mileage on file)


class CapturedFact(BaseModel):
    """One fact captured from a conversation turn — the CAPTURE step's output.
    Deliberately keeps provenance (source, turn, raw customer wording) rather
    than just a value, because "why does the agent believe this" must be
    answerable from this object alone — see guardrails/never_invent.py, which
    only trusts CUSTOMER_STATED facts for reflecting back numbers in the
    strict categories.
    """

    field_name: str  # e.g. 'trade_mileage', 'trade_payoff_cents', 'target_payment_cents', 'current_mileage'
    value: str | int | float | bool
    source: FactSource
    captured_at_turn: int
    raw_customer_text: str | None = Field(
        default=None, description="Verbatim customer wording this was extracted from, for audit"
    )


class CustomerObjective(BaseModel):
    """The INTERPRET step's output: what the customer's captured facts reveal
    about their actual motivation/constraint — not a fact itself, a derived
    read on it. E.g. conversations.md's Price/Payment example: the captured
    fact is "$550/month", the objective is "keep monthly payment under $550".
    """

    primary_concern: str = Field(
        description="e.g. 'payment_target', 'time_convenience', 'approval_anxiety', 'wants_to_sell_not_trade'"
    )
    summary: str = Field(description="One sentence, grounded in captured_facts, not invented")
    supporting_fact_names: list[str] = Field(
        default_factory=list, description="Which CapturedFact.field_name values this objective was derived from"
    )


class ObjectionRecord(BaseModel):
    """One round of the customer resisting the appointment ask and the agent's
    (bounded) attempt to use a different value lever — conversations.md's
    "If the customer resists, use a different relevant value proposition and
    ask again." Bounded because an unbounded retry loop is a different failure
    mode this state exists to prevent, not just an implementation detail —
    see agent/graph.py's TODO on bounding this.
    """

    turn: int
    customer_objection_text: str
    value_lever_used: str  # which CustomerObjective/CapturedFact combination was leveraged in response


class AppointmentOffer(BaseModel):
    """The ADVANCE step's output. `value_proposition` is the LEVERAGE
    statement — it MUST be traceable to captured_facts/customer_objective, not
    generic copy (conversations.md's explicit failure mode: "generic response"
    with no customer-specific reason).
    """

    value_proposition: str
    proposed_times: list[str] = Field(min_length=1, max_length=3)
    confirmed_time: str | None = None
    objections: list[ObjectionRecord] = Field(default_factory=list)


class ConversationTurn(BaseModel):
    turn_index: int
    speaker: str  # 'customer' | 'ai'
    text: str
    timestamp: datetime
