"""A dealer's AI mode (off / shadow / live), read from the platform's own
dealer record (`users`, the Mongoose `User` model).

The platform decides the mode and sends it with every event (the `shadow`
flag). The AI service reads it itself only for work that happens long after an
event: a 24-hour follow-up must not go out if the dealer was switched back to
`off` or `shadow` in the meantime (MASTER_PLAN_1 Stage 13 rollback).

Same rule as aidmvcs-be-dev/app/lib/ai/aiMode.js `effectiveAiMode`: no dealer
record, auto-replies turned off, or an unknown value all mean `off`.
"""

import os
from typing import Literal

from upsell_agent.integrations.mongodb import PLATFORM_USERS_COLLECTION, as_object_id, get_db

AiMode = Literal["off", "shadow", "live"]
AI_MODES: tuple[AiMode, ...] = ("off", "shadow", "live")


def dealer_allowed(dealer_id: object) -> bool:
    """AI_DEALER_ALLOWLIST (comma-separated dealer ids): when set, every other dealer is `off`, whatever its
    record says. Set when this service runs against a shared/live database (`make crm-live-db`), so only the
    test dealer is ever touched; aidmvcs-be-dev/app/lib/ai/aiMode.js reads the same variable."""
    allow = {d.strip() for d in os.environ.get("AI_DEALER_ALLOWLIST", "").split(",") if d.strip()}
    return not allow or str(dealer_id) in allow


def effective_ai_mode(dealer: dict | None) -> AiMode:
    if not dealer:
        return "off"
    if "_id" in dealer and not dealer_allowed(dealer["_id"]):
        return "off"
    if (dealer.get("setting") or {}).get("autoReplyEnabled") is False:
        return "off"
    mode = dealer.get("ai_mode")
    return mode if mode in AI_MODES else "off"


async def dealer_ai_mode(dealer_id: str) -> AiMode:
    # The dealer record is the one platform document keyed by the dealer id
    # itself, so it is read unscoped (there is no dealer_id field to scope by).
    dealer = await get_db()[PLATFORM_USERS_COLLECTION].find_one(
        {"_id": as_object_id(dealer_id)}, {"ai_mode": 1, "setting": 1})
    return effective_ai_mode(dealer)
