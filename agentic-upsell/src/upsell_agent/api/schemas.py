"""HTTP request/response contracts.

These are deliberately separate from `agent/state.py` (the internal LangGraph
state). The API contract should stay stable even if the internal agent state
shape changes — callers (the Next.js API route) depend on this file, not on
the agent's internals.
"""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class UpsellRecommendationRequest(BaseModel):
    dealer_id: str
    customer_id: str
    lead_id: str | None = None
    # Why we're asking now — lets the agent apply different reasoning for
    # "just booked a service appointment" vs "quarterly re-engagement sweep".
    trigger: str = Field(
        description="What caused this request, e.g. 'appointment_booked', 'service_visit_closed', 'scheduled_review'"
    )


class UpsellItemType(str, Enum):
    EXTENDED_WARRANTY = "extended_warranty"
    SERVICE_PACKAGE = "service_package"
    TRADE_UP = "trade_up"
    ACCESSORY = "accessory"
    FINANCE_REFINANCE = "finance_refinance"


class GroundedUpsellItem(BaseModel):
    """A single recommendation. Every field here MUST trace back to a tool call result —
    see guardrails/output_validation.py, which enforces this before a response is returned.
    """

    item_type: UpsellItemType
    # The exact identifier returned by a tool (SKU, package id, VIN, offer id) —
    # never a free-text product name the model invented.
    source_id: str
    display_name: str
    price_cents: int | None = None
    reasoning: str = Field(description="Why this customer, why now — grounded in retrieved facts")
    grounding_tool_calls: list[str] = Field(
        description="Names of the tool calls whose results back every claim in this item"
    )
    confidence: float = Field(ge=0.0, le=1.0)


class UpsellRecommendationResponse(BaseModel):
    customer_id: str
    dealer_id: str
    recommendations: list[GroundedUpsellItem]
    # If the agent had something to say but the grounding check rejected it,
    # this is non-empty and `recommendations` may be empty — fail closed, never
    # send an unverified claim to a customer.
    suppressed_reason: str | None = None
    generated_at: datetime
    trace_id: str | None = Field(default=None, description="Langfuse trace id, for debugging/audit")


class UpsellFeedbackRequest(BaseModel):
    """Staff approve/edit/reject a recommendation before it goes out — this is what
    the dealer-portal UI posts back, and it's how long-term memory (memory/long_term.py)
    learns what actually works for this customer.
    """

    customer_id: str
    dealer_id: str
    recommendation_source_id: str
    item_type: UpsellItemType
    trigger: str = Field(description="The trigger that originally produced this recommendation")
    decision: str = Field(description="'approved' | 'edited' | 'rejected'")
    staff_note: str | None = None
