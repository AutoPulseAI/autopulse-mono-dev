"""Messages that reached the customer but never showed in the CRM (the user, 28 Oct 2026: "add retries").

The sender records every sent message in the dealer's conversation screen and tries 3 times within about 1.5
seconds (channels/sender.py _record). When the CRM is slow (the 10 AM burst) all 3 fail and the message is missing
from the conversation and from the dashboard counts - 231 such messages in the 7 days to 28 Oct. Every 5 minutes this
tries them again, for up to MAX_AGE; the CRM keeps one record per idempotency key, so a retry never doubles one.
"""

import logging
from datetime import UTC, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import AI_MESSAGES_COLLECTION, dealer_scoped_db, get_db

logger = logging.getLogger(__name__)

MAX_AGE = timedelta(days=7)
BATCH = 100


async def run(*, platform: Any) -> dict[str, int]:
    rows = await get_db()[AI_MESSAGES_COLLECTION].find({
        "direction": "outbound", "status": "sent", "shadow": {"$ne": True},
        "platform_record_id": None, "platform_record_error": {"$exists": True},
        "created_at": {"$gte": (clock.now() - MAX_AGE).replace(tzinfo=None)},
    }).sort("created_at", 1).to_list(BATCH)
    done = failed = 0
    for row in rows:
        sent_at = row.get("sent_at") or row.get("created_at")
        sent_at = sent_at.replace(tzinfo=UTC) if getattr(sent_at, "tzinfo", 1) is None else sent_at
        payload = {
            "dealer_id": row.get("dealer_id"), "lead_id": row.get("lead_id"), "customer_id": row.get("customer_id"),
            "channel": row.get("channel"), "to": row.get("to"), "text": row.get("text"), "subject": row.get("subject"),
            # The delivery report may already have come in while the CRM had no record to put it on.
            "status": row.get("provider_status") if row.get("provider_status") in (
                "delivered", "undelivered", "failed") else "sent", "provider_id": row.get("provider_id"), "idempotency_key": row.get("idempotency_key"),
            "turn_id": row.get("turn_id"), "is_fallback": bool(row.get("is_fallback")),
            "sent_at": sent_at.isoformat() if sent_at else None, "media_urls": list(row.get("media_urls") or []),
        }
        try:
            record_id = await platform.record_message(row["dealer_id"], payload)
        except Exception as exc:  # noqa: BLE001 - tried again at the next run
            failed += 1
            await get_db()[AI_MESSAGES_COLLECTION].update_one(
                {"_id": row["_id"]}, {"$set": {"platform_record_error": repr(exc)[:300]},
                                      "$inc": {"platform_record_retries": 1}})
            continue
        await dealer_scoped_db(row["dealer_id"]).collection(AI_MESSAGES_COLLECTION).update_one(
            {"_id": row["_id"]}, {"$set": {"platform_record_id": record_id, "platform_recorded_late_at": clock.now()},
                                  "$unset": {"platform_record_error": ""}})
        done += 1
    if failed:
        logger.warning("re-recording sent messages in the CRM: %s recorded, %s still failing", done, failed)
    return {"recorded": done, "still_failing": failed}
