"""Types for the lead-qualification conversation loop specified in
docs/data/conversations.md, across the lead types in architecture §8.2
(sales, trade-in, service, general).

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

from datetime import UTC, datetime, timedelta
from enum import Enum

from pydantic import BaseModel, Field, model_validator


class LeadType(str, Enum):
    """The lead types the slot engine has required-slot lists for
    (architecture §8.2). Set in code from the lead's source in the platform;
    the model's guess is only used when the source maps to GENERAL.
    """

    SALES = "sales"
    TRADE_IN = "trade_in"
    SERVICE = "service"
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
    """Trust tier a fact was captured under — docs/architecture/architecture.md
    §8.4's four-tier model, in decreasing order of trust. Extended from two to
    four tiers in the previous AI plan (git history)

    1. CUSTOMER_STATED — the customer said this, this conversation. Always
       trustworthy to reflect back, including in guardrails/never_invent.py's
       strict categories.
    2. TOOL_VERIFIED — confirmed by a real tool call this turn (e.g. vehicle
       mileage on file, inventory availability).
    3. BOT_EXTRACTED — the bot pulled this out of the customer's raw message
       text (e.g. inferring a budget from "I don't want to go over thirty
       something"). Saved, but MUST carry CapturedFact.source_message_id so a
       human can check the extraction against the customer's actual words —
       never treated as equivalent to CUSTOMER_STATED for a strict-category
       claim.
    4. BOT_INFERRED — the bot's own reasoning/guess, not traceable to
       anything the customer said or a tool returned. NEVER persisted as a
       fact — memory/long_term.py's trust-tiered writer (Phase 1.2) is the
       enforcement point; a BOT_INFERRED fact is usable only within the turn
       it was produced, then discarded. Kept in this enum (rather than
       omitted) so code can construct one in-memory and have the writer
       reject it, instead of every caller needing its own ad-hoc check.
    """

    CUSTOMER_STATED = "customer_stated"
    TOOL_VERIFIED = "tool_verified"
    BOT_EXTRACTED = "bot_extracted"
    BOT_INFERRED = "bot_inferred"


# Per-fact-type staleness rule (§8.1): how long a fact stays "current" before
# a read should mark it "needs re-confirming" instead of treating it as still
# true. `vehicle_availability` maps to timedelta(0) — "always stale" — since
# §8.1 says availability-type facts are never trusted from memory at all;
# Phase 3's inventory tool re-checks every time regardless of what's stored.
# Small and hand-picked on purpose, not derived from anything: this is a
# product judgment call, and changing a number here should be a one-line,
# easy-to-find edit, not a hunt through the codebase. The actual "mark this
# fact stale on read" logic is Phase 1.3's job, not this file's — this is
# just the reference table that logic reads from.
STALENESS_RULES: dict[str, timedelta] = {
    "trade_mileage": timedelta(days=30),
    "trade_payoff_cents": timedelta(days=14),
    "target_payment_cents": timedelta(days=30),
    "current_mileage": timedelta(days=30),
    "preferred_channel": timedelta(days=180),
    "vehicle_availability": timedelta(0),
}
DEFAULT_STALENESS = timedelta(days=30)


def staleness_rule_for(field_name: str) -> timedelta:
    """The age limit for a given fact field. Falls back to DEFAULT_STALENESS
    for any field_name not yet listed in STALENESS_RULES, rather than
    raising — new fact types get captured before this table is updated for
    them, and "moderately conservative default" is a safer failure than
    "crashes on an unrecognized field".
    """
    return STALENESS_RULES.get(field_name, DEFAULT_STALENESS)


class CapturedFact(BaseModel):
    """One fact captured from a conversation turn — the CAPTURE step's output.
    Deliberately keeps provenance (source, turn, raw customer wording) rather
    than just a value, because "why does the agent believe this" must be
    answerable from this object alone — see guardrails/never_invent.py, which
    only trusts CUSTOMER_STATED facts for reflecting back numbers in the
    strict categories.

    Temporal-validity fields (valid_from, valid_to, replaced_by) added in
    Phase 0.3, per §8.1: a CapturedFact instance is a point-in-time record,
    never edited in place once written — see supersede() below for how an
    older fact gets closed out when a newer one for the same field arrives.
    """

    field_name: str  # e.g. 'trade_mileage', 'trade_payoff_cents', 'target_payment_cents', 'current_mileage'
    value: str | int | float | bool
    source: FactSource
    captured_at_turn: int
    raw_customer_text: str | None = Field(
        default=None, description="Verbatim customer wording this was extracted from, for audit"
    )
    source_message_id: str | None = Field(
        default=None,
        description=(
            "Required when source is BOT_EXTRACTED — links back to the exact customer "
            "message this was pulled from, so it can be checked against their actual words (§8.4)"
        ),
    )
    valid_from: datetime = Field(default_factory=lambda: datetime.now(UTC))
    valid_to: datetime | None = Field(
        default=None, description="Set once a newer fact for the same field_name replaces this one; null = still current"
    )
    replaced_by: str | None = Field(
        default=None, description="Identifier of the CapturedFact that superseded this one, once replaced"
    )

    @model_validator(mode="after")
    def _bot_extracted_needs_source_message(self) -> "CapturedFact":
        if self.source == FactSource.BOT_EXTRACTED and not self.source_message_id:
            raise ValueError("a BOT_EXTRACTED fact must carry source_message_id (§8.4)")
        return self


def supersede(old_fact: CapturedFact, replaced_by_id: str, at: datetime | None = None) -> CapturedFact:
    """Returns a COPY of old_fact marked as replaced (valid_to closed out,
    replaced_by set) rather than mutating it in place — a CapturedFact
    already written to Mongo is a point-in-time record; closing it out is a
    new fact about that record, not an edit to history. Called by
    memory/long_term.py's trust-tiered writer (Phase 1.2) whenever a new fact
    shares a field_name with one that's still current, so the store never
    ends up with two "current" facts for the same field_name at once.
    """
    return old_fact.model_copy(update={"valid_to": at or datetime.now(UTC), "replaced_by": replaced_by_id})


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
