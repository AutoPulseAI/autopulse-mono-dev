"""Typed state that flows through the LangGraph graph.

Every node reads and returns a (partial) AgentState. Keeping this typed and
explicit is what makes memory inspectable — you can always answer "what did
the agent know when it made this decision" by looking at one object, instead
of reverse-engineering it from prompt strings.
"""

from typing import Annotated, Any

from pydantic import BaseModel, Field

from upsell_agent.agent.qualification import (
    AppointmentOffer,
    CapturedFact,
    ConversationTurn,
    CustomerObjective,
    LeadType,
)
from upsell_agent.api.schemas import GroundedUpsellItem


class CustomerContext(BaseModel):
    """Output of tools/customer_tool.py — everything the agent knows about this
    customer, pulled fresh from Mongo (Customer/Lead/Deal/RepairOrder/TradeIn),
    not from the model's own memory.
    """

    customer_id: str
    name: str | None = None
    owned_vehicles: list[dict[str, Any]] = Field(default_factory=list)
    last_service_visit: dict[str, Any] | None = None
    open_leads: list[dict[str, Any]] = Field(default_factory=list)
    # From memory/long_term.py — prior upsell decisions for this customer, so the
    # agent doesn't re-offer something already declined twice.
    upsell_history: list[dict[str, Any]] = Field(default_factory=list)


class ToolCallRecord(BaseModel):
    """Every tool call the agent made this run, and exactly what it returned.
    This is the ground truth that guardrails/output_validation.py checks
    recommendations against, and what observability/tracing.py logs.
    """

    tool_name: str
    arguments: dict[str, Any]
    result: Any


def _append(existing: list, new: list) -> list:
    """Reducer for LangGraph's Annotated state fields: accumulate across nodes
    instead of overwriting."""
    return [*existing, *new]


def _merge_facts(existing: dict[str, CapturedFact], new: dict[str, CapturedFact]) -> dict[str, CapturedFact]:
    """Reducer for `captured_facts`: a later turn's value for the same
    field_name overwrites an earlier one (the customer corrected themselves),
    but nothing is ever silently dropped mid-run — this is a merge, not a
    reset, which is what makes CAPTURE cumulative across turns rather than
    per-turn amnesia.
    """
    return {**existing, **new}


class AgentState(BaseModel):
    """Covers BOTH capabilities this service has: the ongoing lead-qualification
    conversation loop (conversations.md — CAPTURE/INTERPRET/LEVERAGE/ADVANCE
    fields below) and the original single-shot triggered product
    recommendation (draft_recommendations/final_recommendations). They are
    kept in one state type because a qualification conversation's outcome
    (an appointment gets booked) is exactly the kind of event that later
    triggers the single-shot recommendation flow — see README.md's open scope
    question on how tightly these two should actually be wired together.
    """

    model_config = {"arbitrary_types_allowed": True}

    # Input
    dealer_id: str
    customer_id: str
    lead_id: str | None = None
    trigger: str

    # --- Qualification conversation loop (conversations.md) ---
    lead_type: LeadType | None = None
    conversation_history: Annotated[list[ConversationTurn], _append] = Field(default_factory=list)
    # CAPTURE: keyed by CapturedFact.field_name. A dict, not a list, because a
    # later turn correcting an earlier answer should replace it, not create a
    # second, stale copy an INTERPRET/LEVERAGE step might read by accident.
    captured_facts: Annotated[dict[str, CapturedFact], _merge_facts] = Field(default_factory=dict)
    # INTERPRET
    customer_objective: CustomerObjective | None = None
    # LEVERAGE + ADVANCE
    appointment_offer: AppointmentOffer | None = None
    objection_attempt_count: int = 0  # bounds the resist-and-relever loop, see agent/graph.py TODO

    # --- Original single-shot triggered recommendation flow ---
    customer_context: CustomerContext | None = None
    tool_calls: Annotated[list[ToolCallRecord], _append] = Field(default_factory=list)
    draft_recommendations: list[GroundedUpsellItem] = Field(default_factory=list)
    grounding_passed: bool | None = None
    final_recommendations: list[GroundedUpsellItem] = Field(default_factory=list)

    # Shared: why nothing is being sent right now, from either flow.
    suppressed_reason: str | None = None
