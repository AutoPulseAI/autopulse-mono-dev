"""Who a dealer's messages come from (architecture §15, MASTER_PLAN_1 Stage 0):

- SMS: the dealer's own Twilio number (`User.dealer_account_information.sms_conversion_phone`),
  so replies arrive through the platform's existing inbound SMS path.
- Email: the dealer's mailbox (`EmailAccount.email_address`), also used as
  reply-to, so replies arrive through the platform's Mailgun inbound route.

Read from the platform's own records (read only) and cached for 60 seconds,
like the platform caches the AI mode.
"""

import time
from dataclasses import dataclass

from bson import ObjectId

from upsell_agent.integrations.mongodb import (
    PLATFORM_EMAIL_ACCOUNTS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    as_object_id,
    get_db,
)

CACHE_TTL_S = 60.0


@dataclass(frozen=True)
class DealerIdentity:
    dealer_id: str
    name: str | None
    sms_from: str | None
    mailbox: str | None


_cache: dict[str, tuple[float, DealerIdentity]] = {}


async def dealer_identity(dealer_id: str) -> DealerIdentity:
    cached = _cache.get(dealer_id)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    # Keyed by the dealer id itself, so read unscoped (like integrations/dealer_mode.py).
    db = get_db()
    dealer = await db[PLATFORM_USERS_COLLECTION].find_one(
        {"_id": as_object_id(dealer_id)}, {"name": 1, "dealer_account_information": 1}) or {}
    ids = [dealer_id] + ([ObjectId(dealer_id)] if ObjectId.is_valid(dealer_id) else [])
    accounts = await db[PLATFORM_EMAIL_ACCOUNTS_COLLECTION].find(
        {"dealer_id": {"$in": ids}}, {"email_address": 1, "active": 1}).to_list(20)
    active = [a for a in accounts if a.get("active", True) and a.get("email_address")]
    identity = DealerIdentity(
        dealer_id=dealer_id,
        name=dealer.get("name"),
        sms_from=(dealer.get("dealer_account_information") or {}).get("sms_conversion_phone"),
        mailbox=active[0]["email_address"] if active else None,
    )
    _cache[dealer_id] = (time.monotonic() + CACHE_TTL_S, identity)
    return identity


def clear_cache() -> None:
    _cache.clear()
