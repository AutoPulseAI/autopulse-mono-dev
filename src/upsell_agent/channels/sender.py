"""Sends one approved message (architecture §9, MASTER_PLAN_1 Stage 4).

The order matters:

1. **Claim the send.** Write the message to `ai_messages` with a unique
   idempotency key (`<turn>:<channel>`) BEFORE talking to any provider. A
   retried job finds the row and does not send again.
2. **Find the recipient** from the lead, then the customer's primary contact.
3. **The send check** (compliance/engine.py `can_contact`, MASTER_PLAN_3
   C1): ALLOW sends; HOLD leaves the row `held` (resumable) with the time it
   may go; REVIEW and BLOCK suppress it with the reason. Every decision is
   in the compliance log.
4. **Send** through the channel driver, retrying retryable failures with a
   doubling delay.
5. **Record it on the platform** so it shows in the dealer's conversation
   screen (BPLAN Phase 3). A recording failure never un-sends the message;
   it is stored on the row for follow-up.

Row statuses: queued → sending → sent | failed; or held / suppressed / shadow.
A row left in `sending` means a worker died mid-send and we cannot know if
the provider got it; a retry marks it `unknown` and does NOT resend, because
never double-messaging a customer beats never losing a message.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Literal

from pymongo.errors import DuplicateKeyError

from upsell_agent import clock
from upsell_agent.channels.base import ChannelDriver, ChannelSendError, OutboundMessage
from upsell_agent.channels.consent import resolve_recipient, set_channel_consent
from upsell_agent.compliance.engine import Purpose, can_contact
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import PlatformClient

logger = logging.getLogger(__name__)

Channel = Literal["sms", "email"]
SendStatus = Literal["sent", "failed", "held", "suppressed", "shadow", "duplicate", "unknown"]

# A retry only resumes a row that never reached a provider.
_RESUMABLE = {"queued", "held"}
PLATFORM_RECORD_ATTEMPTS = 3


@dataclass
class SendRequest:
    dealer_id: str
    lead_id: str
    customer_id: str
    turn_id: str
    channel: Channel
    text: str
    subject: str | None = None
    # True for the 24-hour re-send on the other channel (Stage 10).
    is_fallback: bool = False
    shadow: bool = False
    # When the platform event reached us, for the event-to-send latency.
    event_received_at: datetime | None = None
    # For the send check (MASTER_PLAN_3 B2 item 6): what the message is for,
    # and whether it answers a message the customer just sent.
    purpose: Purpose = "marketing"
    is_reply: bool = True

    @property
    def idempotency_key(self) -> str:
        return f"{self.turn_id}:{self.channel}" + (":fallback" if self.is_fallback else "")


@dataclass
class SendOutcome:
    status: SendStatus
    idempotency_key: str
    channel: Channel
    message_id: str | None = None
    to: str | None = None
    provider_id: str | None = None
    attempts: int = 0
    reason: str | None = None
    platform_record_id: str | None = None
    latency_ms: int | None = None
    reasoning: list[str] = field(default_factory=list)
    # The send check's decision (compliance/engine.py), and for HOLD when it may go.
    compliance: dict[str, Any] | None = None
    hold_until: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class Sender:
    def __init__(
        self,
        driver: ChannelDriver,
        platform: PlatformClient,
        *,
        max_attempts: int = 3,
        retry_base_s: float = 0.5,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._driver = driver
        self._platform = platform
        self._max_attempts = max(1, max_attempts)
        self._retry_base_s = retry_base_s
        self._sleep = sleep

    async def send(self, req: SendRequest) -> SendOutcome:
        db = dealer_scoped_db(req.dealer_id)
        messages = db.collection(AI_MESSAGES_COLLECTION)
        key = req.idempotency_key
        why: list[str] = [f"Idempotency key {key}"]

        # 1. Claim the send.
        existing = await messages.find_one({"idempotency_key": key})
        if existing and existing.get("status") not in _RESUMABLE:
            if existing.get("status") == "sending":
                await messages.update_one({"_id": existing["_id"]}, {"$set": {"status": "unknown"}})
                why.append("A previous attempt died mid-send; not resending (status → unknown).")
                return self._outcome("unknown", req, existing, why, reason="previous attempt died mid-send")
            why.append(f"Already processed as '{existing.get('status')}'; not sending again.")
            return self._outcome("duplicate", req, existing, why, reason=f"already {existing.get('status')}")
        if existing:
            row_id = existing["_id"]
            why.append("Resuming a claimed send that never reached the provider.")
        else:
            try:
                inserted = await messages.insert_one(self._new_row(req))
            except DuplicateKeyError:
                why.append("Another worker claimed this send first; not sending.")
                return SendOutcome("duplicate", key, req.channel, reason="claimed concurrently", reasoning=why)
            row_id = inserted.inserted_id

        async def finish(status: SendStatus, **fields: Any) -> SendOutcome:
            await messages.update_one({"_id": row_id}, {"$set": {"status": status, **fields}})
            row = await messages.find_one({"_id": row_id}) or {}
            return self._outcome(status, req, row, why, reason=fields.get("reason"))

        # 2. Recipient.
        lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(req.lead_id)})
        customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(req.customer_id)})
        to = resolve_recipient(lead, customer, req.channel)
        if not to:
            why.append(f"No {req.channel} contact on the lead or customer record.")
            return await finish("suppressed", reason=f"no {req.channel} contact on file")
        why.append(f"Recipient {to}")

        # 3. The send check.
        check = await can_contact(
            dealer_id=req.dealer_id, customer_id=req.customer_id, lead_id=req.lead_id, channel=req.channel,
            purpose=req.purpose, is_reply=req.is_reply, to=to, lead=lead, customer=customer,
            source="ai_reply" if req.is_reply else "ai_followup", request_id=key)
        why.append(f"Send check: {check.summary()}")
        compliance = check.as_dict()
        if check.outcome == "HOLD":
            outcome = await finish("held", to=to, reason=check.reason, held_until=check.until,
                                   compliance=compliance)
            outcome.compliance, outcome.hold_until = compliance, compliance["until"]
            return outcome
        if not check.allowed:
            outcome = await finish("suppressed", to=to, reason=f"{check.outcome}: {check.reason}",
                                   compliance=compliance)
            outcome.compliance = compliance
            return outcome

        # Shadow mode: the whole turn runs, nothing leaves (Stage 13).
        if req.shadow:
            why.append("Dealer is in shadow mode: drafted, not sent.")
            return await finish("shadow", to=to, reason="shadow mode")

        # 4. Send, with retries.
        attempts = 0
        last_error: ChannelSendError | None = None
        while attempts < self._max_attempts:
            attempts += 1
            await messages.update_one({"_id": row_id}, {"$set": {"status": "sending", "to": to, "attempts": attempts}})
            try:
                result = await self._driver.send(
                    OutboundMessage(
                        dealer_id=req.dealer_id, lead_id=req.lead_id, customer_id=req.customer_id,
                        channel=req.channel, to=to, text=req.text, subject=req.subject, idempotency_key=key,
                    )
                )
            except ChannelSendError as exc:
                if exc.suppress:
                    why.append(f"Provider refused this recipient: {exc}")
                    if exc.opted_out:
                        await set_channel_consent(db, req.customer_id, req.channel, False,
                                                  source=f"{self._driver.name}_opted_out")
                        why.append(f"The customer had opted out of {req.channel}; consent turned off.")
                    return await finish("suppressed", to=to, attempts=attempts, reason=str(exc))
                last_error = exc
                why.append(f"Attempt {attempts} failed ({'retryable' if exc.retryable else 'permanent'}): {exc}")
                # Back to a resumable state before sleeping, so a crash during
                # the wait is safe to resume.
                await messages.update_one({"_id": row_id}, {"$set": {"status": "queued"}})
                if not exc.retryable or attempts >= self._max_attempts:
                    break
                await self._sleep(self._retry_base_s * (2 ** (attempts - 1)))
                continue

            sent_at = clock.now()
            latency_ms = _ms_between(req.event_received_at, sent_at)
            why.append(f"Sent via {self._driver.name} on attempt {attempts}: provider id {result.provider_id}")
            outcome = await finish(
                "sent", to=to, provider_id=result.provider_id, provider_status=result.status,
                sent_at=sent_at, attempts=attempts, latency_ms=latency_ms,
            )
            outcome.platform_record_id = await self._record(req, to, "sent", result.provider_id, sent_at, row_id, why)
            outcome.reasoning = why
            return outcome

        why.append(f"Gave up after {attempts} attempt(s).")
        outcome = await finish("failed", to=to, attempts=attempts, reason=str(last_error), failed_at=clock.now())
        outcome.platform_record_id = await self._record(req, to, "failed", None, clock.now(), row_id, why)
        outcome.reasoning = why
        return outcome

    async def _record(self, req: SendRequest, to: str, status: str, provider_id: str | None,
                      at: datetime, row_id: Any, why: list[str]) -> str | None:
        """5. Show it in the dealer's conversation screen. Never raises."""
        payload = {
            "dealer_id": req.dealer_id, "lead_id": req.lead_id, "customer_id": req.customer_id,
            "channel": req.channel, "to": to, "text": req.text, "subject": req.subject, "status": status,
            "provider_id": provider_id, "idempotency_key": req.idempotency_key, "turn_id": req.turn_id,
            "is_fallback": req.is_fallback, "sent_at": at.isoformat(),
        }
        messages = dealer_scoped_db(req.dealer_id).collection(AI_MESSAGES_COLLECTION)
        last_error = ""
        for attempt in range(1, PLATFORM_RECORD_ATTEMPTS + 1):
            try:
                record_id = await self._platform.record_message(req.dealer_id, payload)
            except Exception as exc:  # noqa: BLE001 - recording must never undo a send
                last_error = repr(exc)
                if attempt < PLATFORM_RECORD_ATTEMPTS:
                    await self._sleep(self._retry_base_s * attempt)
                continue
            await messages.update_one({"_id": row_id}, {"$set": {"platform_record_id": record_id}})
            why.append(f"Recorded in the platform conversation (Email {record_id}).")
            return record_id
        logger.error("could not record message %s on the platform: %s", req.idempotency_key, last_error)
        await messages.update_one({"_id": row_id}, {"$set": {"platform_record_error": last_error}})
        why.append(f"Could not record it on the platform: {last_error}")
        return None

    @staticmethod
    def _new_row(req: SendRequest) -> dict[str, Any]:
        return {
            "idempotency_key": req.idempotency_key, "direction": "outbound", "status": "queued",
            "lead_id": req.lead_id, "customer_id": req.customer_id, "turn_id": req.turn_id,
            "channel": req.channel, "text": req.text, "subject": req.subject, "is_fallback": req.is_fallback,
            "shadow": req.shadow, "event_received_at": req.event_received_at, "created_at": clock.now(),
            "attempts": 0,
        }

    @staticmethod
    def _outcome(status: SendStatus, req: SendRequest, row: dict, why: list[str], reason: str | None = None) -> SendOutcome:
        return SendOutcome(
            status=status, idempotency_key=req.idempotency_key, channel=req.channel,
            message_id=str(row["_id"]) if row.get("_id") is not None else None, to=row.get("to"),
            provider_id=row.get("provider_id"), attempts=row.get("attempts", 0), reason=reason,
            platform_record_id=row.get("platform_record_id"), latency_ms=row.get("latency_ms"), reasoning=why,
        )


def _ms_between(start: datetime | None, end: datetime) -> int | None:
    if start is None:
        return None
    if start.tzinfo is None and end.tzinfo is not None:
        end = end.replace(tzinfo=None)
    elif start.tzinfo is not None and end.tzinfo is None:
        start = start.replace(tzinfo=None)
    return max(0, round((end - start).total_seconds() * 1000))
