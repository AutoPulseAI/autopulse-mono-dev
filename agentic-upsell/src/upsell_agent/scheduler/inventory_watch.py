"""Stale inventory alert (Betsy, 26 Oct 2026: "How can we safeguard ourselves from stale inventory? We need a
process or alert in place").

The inventory stopped updating on 12 Sep 2026 and nobody knew for six weeks: the AI offered sold cars and a link led
to search results. Every hour, for each dealer whose AI is on, this looks at the dealer's stock (the CRM's `vehicles`,
filled by the feed import every 12 hours) and emails AutoPulse (AI_OPS_ALERT_EMAILS, never the dealer) when:

  stale   no car of theirs has been updated for STALE_AFTER - the feed or the import has stopped
  shrunk  the cars in stock fell below SHRINK_RATIO of the last count - a partial or broken feed file

Once per problem per day (ai_system_status "inventory:<dealer>"), and once more when it's healthy again.
"""

import logging
from datetime import UTC, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import PLATFORM_USERS_COLLECTION, PLATFORM_VEHICLES_COLLECTION, get_db

logger = logging.getLogger(__name__)

STALE_AFTER = timedelta(hours=36)
SHRINK_RATIO = 0.5
REMIND_EVERY = timedelta(hours=24)
STATUS_COLLECTION = "ai_system_status"


def _aware(value: Any) -> Any:
    return value.replace(tzinfo=UTC) if value is not None and getattr(value, "tzinfo", 1) is None else value


async def dealer_health(dealer_id: str) -> dict[str, Any]:
    vehicles = get_db()[PLATFORM_VEHICLES_COLLECTION]
    newest = await vehicles.find_one({"dealerId": dealer_id}, sort=[("updatedAt", -1)], projection={"updatedAt": 1})
    in_stock = await vehicles.count_documents({"dealerId": dealer_id, "removedAt": None})
    return {"last_update": _aware((newest or {}).get("updatedAt")), "in_stock": in_stock}


def problems(health: dict[str, Any], last_count: int | None, now: Any) -> list[str]:
    out = []
    last = health["last_update"]
    if last is None:
        out.append("no inventory at all")
    elif now - last > STALE_AFTER:
        out.append(f"not updated since {last:%a %b %d %H:%M} UTC ({int((now - last).total_seconds() // 3600)} hours)")
    if last_count and health["in_stock"] < last_count * SHRINK_RATIO:
        out.append(f"cars in stock fell from {last_count} to {health['in_stock']}")
    return out


async def run(*, platform: Any = None) -> dict[str, Any]:
    """One hourly check of every dealer whose AI is on. Never raises."""
    now = clock.now()
    db = get_db()
    report: dict[str, Any] = {}
    try:
        dealers = await db[PLATFORM_USERS_COLLECTION].find(
            {"type": "dealer", "ai_mode": {"$in": ["live", "shadow"]}}, {"name": 1}).to_list(500)
    except Exception:  # noqa: BLE001
        logger.exception("inventory watch could not list dealers")
        return {"status": "error"}
    for dealer in dealers:
        dealer_id = str(dealer["_id"])
        status_id = f"inventory:{dealer_id}"
        status = await db[STATUS_COLLECTION].find_one({"_id": status_id}) or {}
        health = await dealer_health(dealer_id)
        found = problems(health, status.get("in_stock"), now)
        name = dealer.get("name") or dealer_id
        alerted_at = _aware(status.get("alerted_at"))
        update: dict[str, Any] = {"checked_at": now, "problems": found}
        if not found:
            update["in_stock"] = health["in_stock"]  # the count to compare with next time, only from a healthy run
            if status.get("problems"):
                await _alert(platform, f"AutoPulse inventory OK again - {name}",
                             f"The inventory for {name} is updating again: {health['in_stock']} cars in stock, last "
                             f"updated {health['last_update']:%a %b %d %H:%M} UTC.")
        elif alerted_at is None or now - alerted_at > REMIND_EVERY or found != status.get("problems"):
            await _alert(platform, f"AutoPulse inventory problem - {name}",
                         f"The inventory for {name} needs a look: {'; '.join(found)}.\n\n"
                         f"Cars in stock now: {health['in_stock']}. Until it's fixed, the AI and the CRM show old "
                         "stock and prices - sold cars may be offered.\n\nCheck that the inventory feed file is still "
                         "arriving (VEHICLE_UPLOAD_DIR on the server) and that https://www.autopulse.ai/api/import "
                         "runs (every 12 hours).")
            update["alerted_at"] = now
        await db[STATUS_COLLECTION].update_one({"_id": status_id}, {"$set": update}, upsert=True)
        report[name] = found or "ok"
    return {"status": "checked", "dealers": report}


async def _alert(platform: Any, subject: str, text: str) -> None:
    try:
        if platform is None:
            from upsell_agent.config import get_settings
            from upsell_agent.integrations.platform_client import get_platform_client
            platform = get_platform_client(get_settings())
        await platform.send_ops_alert(subject, text)
    except Exception:  # noqa: BLE001 - the check itself stands whatever the email does
        logger.exception("could not send the inventory alert %r", subject)
