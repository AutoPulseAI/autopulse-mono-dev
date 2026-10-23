"""The AI switches itself off when its model provider can't serve it (Betsy, 23 Oct 2026: "We need AI off if no credits",
"No message is better than a garbage message", "we need to be notified immediately by email - me and Bibi only, NOT
the dealer").

On 23 Oct the OpenAI account ran out of credit: every turn fell back to the safe template, the same message went out
again and again, and customers opted out. Now:

- **Down.** A turn whose model call fails for a provider reason (no credit / quota, a bad or revoked key, the account
  or billing) marks the provider down, sends nothing, and raises `ProviderDown`. While down, no AI turn starts: every
  customer message, new lead and AI follow-up is held, nothing is sent, and AutoPulse is emailed once
  (AI_OPS_ALERT_EMAILS through the CRM, never the dealer).
- **Held.** The worker keeps each held event (`ai_held_events`); scheduled follow-ups wait and retry
  (scheduler/followups.py).
- **Back.** Every couple of minutes while down, one tiny model call checks the provider. When it answers, the AI
  is back on, the held events are replayed in order (each customer gets their real answer), and AutoPulse is
  emailed again.

A single slow or failed call that isn't the provider's account (a timeout, a 500) is not this: that turn keeps its
safe reply as before.
"""

import logging
import re
from datetime import timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import get_db

logger = logging.getLogger(__name__)

STATUS_COLLECTION = "ai_system_status"
HELD_EVENTS_COLLECTION = "ai_held_events"
STATUS_ID = "llm"
CACHE_FOR = timedelta(seconds=20)

# What only the provider's account explains: no credit / quota, a bad or revoked key, billing, a deactivated account.
PROVIDER_ACCOUNT_ERROR = re.compile(
    r"insufficient_quota|credit_balance|no credits remaining|exceeded your current quota|billing|"
    r"invalid_api_key|incorrect api key|account_deactivated|status_code:\s*401|status_code:\s*403\b|"
    r"authenticationerror|permissiondeniederror", re.IGNORECASE)


class ProviderDown(Exception):
    """The model provider can't serve the AI: nothing may be sent; hold the event."""


_cache: dict[str, Any] = {"at": None, "down": False}


def is_provider_failure(text: Any) -> bool:
    return bool(text) and bool(PROVIDER_ACCOUNT_ERROR.search(str(text)))


async def is_down() -> bool:
    now = clock.now()
    if _cache["at"] is not None and now - _cache["at"] < CACHE_FOR:
        return bool(_cache["down"])
    row = await get_db()[STATUS_COLLECTION].find_one({"_id": STATUS_ID}) or {}
    _cache.update(at=now, down=bool(row.get("down")))
    return bool(_cache["down"])


def _forget() -> None:
    _cache.update(at=None)


async def mark_down(reason: str, *, platform: Any | None = None) -> bool:
    """Marks the provider down; True (and AutoPulse is emailed) only when it wasn't already."""
    from pymongo import ReturnDocument
    before = await get_db()[STATUS_COLLECTION].find_one_and_update(
        {"_id": STATUS_ID}, {"$set": {"down": True, "since": clock.now(), "reason": str(reason)[:500]}},
        upsert=True, return_document=ReturnDocument.BEFORE)
    if before and before.get("down"):
        _forget()
        return False  # already down: one email per outage
    _forget()
    logger.error("AI provider down - the AI is off until it answers again: %s", reason)
    await _alert(platform, "AutoPulse AI is OFF - the AI model provider stopped answering",
                 "The AI model provider (OpenAI) refused the AI's requests, so the AI has switched itself off: no "
                 "messages are being sent - no AI replies and no backup messages.\n\n"
                 f"Reason: {str(reason)[:400]}\n\n"
                 "Customer messages, new leads and follow-ups are being held. As soon as the provider answers again "
                 "(for example once credit is added), the AI switches back on by itself and answers every held "
                 "message in order. You'll get another email when it does.")
    return True


async def mark_up(*, platform: Any | None = None, held: int = 0) -> bool:
    result = await get_db()[STATUS_COLLECTION].update_one(
        {"_id": STATUS_ID, "down": True}, {"$set": {"down": False, "up_at": clock.now()}})
    _forget()
    if not result.modified_count:
        return False
    logger.warning("AI provider answering again - the AI is back on (%s held events to replay)", held)
    await _alert(platform, "AutoPulse AI is back ON",
                 "The AI model provider is answering again, so the AI has switched itself back on. "
                 f"{held} held customer message(s), new lead(s) and event(s) are being answered now, in order.")
    return True


async def hold_event(function: str, event: dict[str, Any], received_at: str | None) -> None:
    await get_db()[HELD_EVENTS_COLLECTION].insert_one({
        "function": function, "event": event, "received_at": received_at, "held_at": clock.now(),
        "dealer_id": event.get("dealer_id"), "lead_id": event.get("lead_id")})


async def held_events(limit: int = 500) -> list[dict[str, Any]]:
    return await get_db()[HELD_EVENTS_COLLECTION].find({}).sort("held_at", 1).to_list(limit)


async def release(event_id: Any) -> None:
    await get_db()[HELD_EVENTS_COLLECTION].delete_one({"_id": event_id})


async def probe(settings: Any) -> tuple[bool, str]:
    """One tiny call to the extract model: does the provider answer?"""
    try:
        from pydantic_ai import Agent
        agent = Agent(settings.model_extract, output_type=str,
                      instructions="Reply with the single word OK.")
        await agent.run("ping")
        return True, "the model answered"
    except Exception as exc:  # noqa: BLE001 - any failure means: still down
        return False, repr(exc)[:300]


async def _alert(platform: Any | None, subject: str, text: str) -> None:
    """Email AutoPulse (AI_OPS_ALERT_EMAILS, through the CRM) - never the dealer. Never raises."""
    try:
        if platform is None:
            from upsell_agent.config import get_settings
            from upsell_agent.integrations.platform_client import get_platform_client
            platform = get_platform_client(get_settings())
        await platform.send_ops_alert(subject, text)
    except Exception:  # noqa: BLE001 - the switch-off itself stands whatever the email does
        logger.exception("could not send the AI ops alert %r", subject)
