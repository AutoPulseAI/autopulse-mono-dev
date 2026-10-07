"""Typed models for the two kinds of memory this agent keeps — deliberately
separate from AgentState (the in-run working memory) and from CustomerContext
(the read-only snapshot pulled fresh each run from Mongo/the 360 API).

short-term  = this run's state, checkpointed by LangGraph (memory/short_term.py)
long-term   = durable, cross-run facts about a customer's upsell relationship,
              stored in this service's own MongoDB collection (memory/long_term.py)
"""

from datetime import datetime

from pydantic import BaseModel, Field


class UpsellDecision(BaseModel):
    """One past recommendation and what happened to it — the record that lets
    the agent avoid repeating a declined offer, or notice a pattern.
    """

    item_type: str
    source_id: str
    recommended_at: datetime
    decision: str  # 'approved' | 'edited' | 'rejected' | 'no_response'
    decided_at: datetime | None = None
    staff_note: str | None = None
    trigger: str


class CustomerUpsellProfile(BaseModel):
    """Long-term memory document — one per (dealer_id, customer_id).
    This is what makes the agent's behavior change over time for a given
    customer, instead of re-deriving everything from scratch each run.
    """

    dealer_id: str
    customer_id: str
    decisions: list[UpsellDecision] = Field(default_factory=list)
    # Derived/maintained by memory/long_term.py, e.g. "declined extended_warranty
    # twice" -> suppress that item_type for N days. Kept explicit and inspectable
    # rather than inferred fresh by the model on every run.
    suppressed_item_types: dict[str, datetime] = Field(
        default_factory=dict, description="item_type -> suppressed_until"
    )
    updated_at: datetime
