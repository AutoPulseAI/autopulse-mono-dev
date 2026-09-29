"""Typed state that flows through one conversation turn (architecture §7).

Every node reads and returns a (partial) AgentState. Keeping this typed and
explicit is what makes a turn inspectable — "what did the agent know when it
made this decision" is answered by looking at one object, and the Debug UI
shows exactly these fields per node.

Long-lived data (slots, messages, lead status) lives in MongoDB and is loaded
by `load_context` at the start of every turn. This state only holds what one
turn needs while it runs.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from upsell_agent.agent.qualification import (
    AppointmentOffer,
    CapturedFact,
    ConversationTurn,
    LeadType,
)

Channel = Literal["sms", "email"]
# resume_at_opening: the after-hours morning message (MASTER_PLAN_3 B1).
# visit_followup: the dated fresh visit offer after a 3rd decline (MASTER_PLAN_3 B4 item 4).
Trigger = Literal["lead_created", "inbound_message", "resume_at_opening", "visit_followup"]


class ToolCallRecord(BaseModel):
    """Every tool call the agent made this run, and exactly what it returned.
    Kept for the deferred upsell capability (guardrails/output_validation.py).
    """

    tool_name: str
    arguments: dict[str, Any]
    result: Any


def _append(existing: list, new: list) -> list:
    """Reducer for LangGraph's Annotated state fields: accumulate across nodes
    instead of overwriting."""
    return [*existing, *new]


def _merge_facts(existing: dict[str, CapturedFact], new: dict[str, CapturedFact]) -> dict[str, CapturedFact]:
    """Reducer for `captured_facts`: a later value for the same field_name
    overwrites an earlier one (the customer corrected themselves), but nothing
    is ever silently dropped mid-run — a merge, not a reset.
    """
    return {**existing, **new}


class AgentState(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    # --- Input: what started this turn ---
    dealer_id: str
    customer_id: str
    lead_id: str | None = None
    trigger: str
    channel: Channel | None = None
    turn_id: str | None = None
    # Customer text this turn answers, as received: the lead's own comments on
    # the first reply, or every unanswered inbound message batched together.
    inbound_text: str = ""
    # The ai_messages rows of that batch (none on a first reply). Load context
    # lists them one by one in the context pack.
    new_message_ids: list[str] = Field(default_factory=list)
    shadow: bool = False
    # A new lead's first reply goes straight to the template while
    # FIRST_REPLY_MODE=template (MASTER_PLAN_1 Stage 4; Stage 8 turns it off).
    first_reply_via_template: bool = False
    customer_name: str | None = None

    # --- Loaded context ---
    lead_type: LeadType | None = None
    conversation_history: Annotated[list[ConversationTurn], _append] = Field(default_factory=list)
    captured_facts: Annotated[dict[str, CapturedFact], _merge_facts] = Field(default_factory=dict)
    campaign: dict[str, Any] | None = None
    # slots/profile.py Profile.to_api(): every slot's value and state.
    profile: dict[str, Any] | None = None
    # agent/context_pack.ContextPack.model_dump(): what Extract and Compose see.
    context_pack: dict[str, Any] | None = None
    # The new messages as the models read them (a customer email's quoted
    # chain removed). Extract reads it and Validate checks quotes against it.
    customer_text: str = ""

    # --- One entry per pipeline step (§7): extract → validate → decide → compose → guard ---
    extraction: dict[str, Any] | None = None
    validation: dict[str, Any] | None = None
    decision: dict[str, Any] | None = None
    draft: dict[str, Any] | None = None
    guard_result: dict[str, Any] | None = None
    retry_count: int = 0
    # used_template: the reply came from agent/templates.py for any reason.
    # used_fallback: specifically because the guard rejected the AI's drafts.
    used_template: bool = False
    used_fallback: bool = False
    # Why the template is being used (a step failed, the guard said no twice).
    fallback_reason: str | None = None
    # The guard rejected the AI twice: a person should look at this lead.
    flag_human: bool = False
    outcome: str | None = None

    # Read by guardrails/never_invent.py until Stage 8 rewires the guard to
    # check `draft` directly.
    appointment_offer: AppointmentOffer | None = None

    # Why nothing is being sent right now, if anything.
    suppressed_reason: str | None = None
