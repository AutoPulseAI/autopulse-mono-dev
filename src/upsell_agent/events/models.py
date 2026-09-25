"""Event payloads the platform sends (architecture §11). These are the
contract with aidmvcs-be-dev: change them only after agreeing with the
platform side (TEAM_SPLIT.md, "Contracts, not code").

Event ID rules (MASTER_PLAN_1 Stage 0): `lead-created` uses the Lead ID,
`inbound-message` uses the platform's Email record ID. Both are stable, so a
retried event is recognised as a duplicate.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Channel = Literal["sms", "email"]


class BaseEvent(BaseModel):
    event_id: str = Field(min_length=1)
    dealer_id: str = Field(min_length=1)


class LeadCreatedEvent(BaseEvent):
    lead_id: str = Field(min_length=1)
    customer_id: str = Field(min_length=1)
    channel: Channel
    # Set by the platform when the dealer's AI mode is `shadow` (Stage 13).
    shadow: bool = False


class InboundMessageEvent(BaseEvent):
    customer_id: str = Field(min_length=1)
    lead_id: str | None = None
    channel: Channel
    message_id: str = Field(min_length=1)
    text: str
    received_at: datetime
    shadow: bool = False


class LeadPausedEvent(BaseEvent):
    lead_id: str = Field(min_length=1)
    reason: str | None = None


class LeadResumedEvent(BaseEvent):
    lead_id: str = Field(min_length=1)


# URL segment -> (worker job name, payload model)
EVENT_TYPES: dict[str, tuple[str, type[BaseEvent]]] = {
    "lead-created": ("handle_lead_created", LeadCreatedEvent),
    "inbound-message": ("handle_inbound_message", InboundMessageEvent),
    "lead-paused": ("handle_lead_paused", LeadPausedEvent),
    "lead-resumed": ("handle_lead_resumed", LeadResumedEvent),
}
