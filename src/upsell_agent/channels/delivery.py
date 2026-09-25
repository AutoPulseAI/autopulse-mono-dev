"""What happens when a provider reports on a message we sent (architecture §6,
§9; MASTER_PLAN_1 Stage 10).

Twilio status callbacks, SendGrid event webhooks (api/webhooks.py) and the
Debug UI's "mark SMS failed" button all end up here:

- The message row in `ai_messages` gets the delivery status. A late or
  out-of-order callback never moves it backwards (delivered stays delivered
  even if a "sent" callback arrives after it).
- The platform's copy in the conversation screen gets the same status.
- A failed, undelivered, bounced or dropped message makes its follow-up due
  now instead of in 24 hours. The caller then queues the follow-up job.
- An unsubscribe or spam report turns email consent off for that customer.
"""

import logging
from dataclasses import dataclass
from typing import Any

from upsell_agent import clock
from upsell_agent.channels.consent import set_channel_consent
from upsell_agent.integrations.mongodb import AI_MESSAGES_COLLECTION, dealer_scoped_db, get_db
from upsell_agent.integrations.platform_client import PlatformClient
from upsell_agent.scheduler.followups import make_due_now

logger = logging.getLogger(__name__)

# How far along a message is. A callback with a lower rank than what we
# already have is stale and ignored. Failures sit with "delivered": a message
# is either delivered or failed, never both.
_RANK = {"queued": 0, "accepted": 0, "sent": 1, "delivered": 2, "failed": 2, "undelivered": 2,
         "bounced": 2, "dropped": 2, "opened": 3}
FAILED_STATUSES = {"failed", "undelivered", "bounced", "dropped"}
# Words the platform's status endpoint accepts (aiMessageRecord.js).
PLATFORM_STATUSES = set(_RANK)


@dataclass
class DeliveryResult:
    found: bool
    status: str | None = None
    applied: bool = False
    dealer_id: str | None = None
    followup_due_now: bool = False
    consent_off: bool = False
    detail: str = ""

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


async def _find_message(provider_id: str | None, idempotency_key: str | None) -> dict | None:
    # Callbacks carry the provider's id, not the dealer, so this one lookup is
    # unscoped; everything after it is scoped to the message's dealer.
    messages = get_db()[AI_MESSAGES_COLLECTION]
    if provider_id:
        row = await messages.find_one({"provider_id": provider_id, "direction": "outbound"})
        if row:
            return row
    if idempotency_key:
        return await messages.find_one({"idempotency_key": idempotency_key})
    return None


async def apply_delivery_status(
    platform: PlatformClient,
    status: str,
    *,
    provider_id: str | None = None,
    idempotency_key: str | None = None,
    error: str | None = None,
) -> DeliveryResult:
    row = await _find_message(provider_id, idempotency_key)
    if row is None:
        return DeliveryResult(found=False, status=status, detail="no message with that id")
    dealer_id = row["dealer_id"]
    db = dealer_scoped_db(dealer_id)
    result = DeliveryResult(found=True, status=status, dealer_id=dealer_id)

    current = row.get("delivery_status")
    if status not in _RANK:
        result.detail = f"status {status!r} ignored"
        return result
    if current is not None and _RANK[status] < _RANK.get(current, 0):
        result.detail = f"stale callback: already {current}"
        return result

    await db.collection(AI_MESSAGES_COLLECTION).update_one(
        {"_id": row["_id"]},
        {"$set": {"delivery_status": status, "delivery_status_at": clock.now(),
                  **({"delivery_error": error} if error else {})}},
    )
    result.applied = True
    result.detail = f"{row['channel']} message is {status}"

    if row.get("provider_id") and status in PLATFORM_STATUSES:
        try:
            await platform.update_message_status(dealer_id, row["provider_id"], status)
        except Exception as exc:  # noqa: BLE001 - the conversation screen lagging must not fail the callback
            logger.warning("could not update platform status for %s: %r", row["provider_id"], exc)

    if status in FAILED_STATUSES and not row.get("is_fallback"):
        result.followup_due_now = await make_due_now(
            db, lead_id=row["lead_id"], source_turn_id=row["turn_id"], from_channel=row["channel"],
            reason=f"{row['channel']} {status}" + (f" ({error})" if error else "") + ": switching now",
        )
        if result.followup_due_now:
            result.detail += "; its follow-up fires now"
    return result


async def apply_unsubscribe(*, provider_id: str | None = None, idempotency_key: str | None = None,
                            source: str) -> DeliveryResult:
    """SendGrid unsubscribe / spam report: no more email to this customer."""
    row = await _find_message(provider_id, idempotency_key)
    if row is None:
        return DeliveryResult(found=False, detail="no message with that id")
    db = dealer_scoped_db(row["dealer_id"])
    await set_channel_consent(db, row["customer_id"], "email", False, source=source)
    return DeliveryResult(found=True, dealer_id=row["dealer_id"], consent_off=True, status="unsubscribed",
                          applied=True, detail="email consent turned off")
