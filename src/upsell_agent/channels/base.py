"""What every channel driver (fake, Twilio, SendGrid) must look like.

The sender (Stage 4) owns idempotency and consent; a driver only delivers one
already-approved message and reports what the provider said.
"""

from dataclasses import dataclass
from typing import Literal, Protocol

Channel = Literal["sms", "email"]


@dataclass(frozen=True)
class OutboundMessage:
    dealer_id: str
    lead_id: str
    customer_id: str
    channel: Channel
    to: str
    text: str
    subject: str | None = None
    idempotency_key: str | None = None


@dataclass(frozen=True)
class SendResult:
    provider_id: str
    status: str  # provider's own status word, e.g. "queued", "accepted"


class ChannelSendError(Exception):
    """A provider refused or failed to take the message.

    `retryable` separates "try again shortly" (timeouts, 5xx, rate limits)
    from "this will never work" (invalid number, blocked recipient), so the
    sender doesn't burn its attempts on a permanent failure.
    """

    def __init__(self, message: str, *, retryable: bool = True, suppress: bool = False,
                 opted_out: bool = False) -> None:
        super().__init__(message)
        # `suppress`: the message must not go to this recipient at all (not on
        # the test allowlist, or the provider says they opted out). Recorded as
        # suppressed, not failed, so it never triggers the other channel.
        # `opted_out`: the provider knows the customer opted out (Twilio 21610);
        # our consent record is updated to match (architecture §9).
        self.retryable = retryable and not suppress
        self.suppress = suppress
        self.opted_out = opted_out


class ChannelDriver(Protocol):
    name: str

    async def send(self, message: OutboundMessage) -> SendResult: ...
