"""Fake channel driver: "sending" writes the message to the dev_outbox
collection instead of calling Twilio or SendGrid. Used in DEV and in tests so
no real message ever leaves a developer's machine.
"""

import uuid

from upsell_agent import clock
from upsell_agent.channels.base import ChannelSendError, OutboundMessage, SendResult
from upsell_agent.integrations.mongodb import DEV_OUTBOX_COLLECTION, dealer_scoped_db


class FakeChannelDriver:
    name = "fake"

    def __init__(self, *, fail_first: int = 0, permanent_failure: bool = False) -> None:
        """`fail_first` makes the first N sends raise a retryable error, and
        `permanent_failure` makes every send raise a non-retryable one: how
        tests exercise the sender's retry and give-up paths."""
        self._failures_left = fail_first
        self._permanent_failure = permanent_failure
        self.calls = 0

    async def send(self, message: OutboundMessage) -> SendResult:
        self.calls += 1
        if self._permanent_failure:
            raise ChannelSendError("fake provider rejected the recipient", retryable=False)
        if self._failures_left > 0:
            self._failures_left -= 1
            raise ChannelSendError("fake provider timed out", retryable=True)

        provider_id = f"fake-{uuid.uuid4().hex[:12]}"
        await dealer_scoped_db(message.dealer_id).collection(DEV_OUTBOX_COLLECTION).insert_one(
            {
                "lead_id": message.lead_id,
                "customer_id": message.customer_id,
                "channel": message.channel,
                "to": message.to,
                "subject": message.subject,
                "text": message.text,
                "idempotency_key": message.idempotency_key,
                # MASTER_PLAN_4 F3: the photo that would have gone as MMS / inline in the email.
                "media_urls": list(message.media_urls),
                "provider_id": provider_id,
                "created_at": clock.now(),
            }
        )
        return SendResult(provider_id=provider_id, status="accepted")
