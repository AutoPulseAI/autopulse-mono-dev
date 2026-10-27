"""Follow-ups that should have gone out and didn't (Betsy, 27 Oct 2026 meeting: "I need to know if the cadences are
firing"; the user, 28 Oct 2026: the dashboard shows the numbers, but nobody is told when they stop).

Every hour this looks at the AI's follow-ups that were due more than GRACE ago today (cadence touches, AI Studio
touches, appointment messages) and emails AutoPulse (AI_OPS_ALERT_EMAILS, never the dealer) when, for a dealer, at
least MIN_STUCK of them are still waiting and they are at least STUCK_RATIO of everything that was due: the scheduler
stopped, the CRM wasn't answering, or sends keep failing. Once per dealer per day (ai_system_status
"cadence:<dealer>").
"""

import logging
from datetime import UTC, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import SCHEDULED_FOLLOWUPS_COLLECTION, get_db

logger = logging.getLogger(__name__)

GRACE = timedelta(minutes=30)
WINDOW = timedelta(hours=24)
MIN_STUCK = 10
STUCK_RATIO = 0.3
STATUS_COLLECTION = "ai_system_status"
WATCHED_KINDS = ("cadence_touch", "studio_touch")
WATCHED_PREFIX = "appointment_"


async def run(*, platform: Any) -> dict[str, Any]:
    now = clock.now()
    db = get_db()
    since, cutoff = (now - WINDOW).replace(tzinfo=None), (now - GRACE).replace(tzinfo=None)
    rows = await db[SCHEDULED_FOLLOWUPS_COLLECTION].aggregate([
        {"$match": {"due_at": {"$gte": since, "$lte": cutoff},
                    "$or": [{"kind": {"$in": list(WATCHED_KINDS)}}, {"kind": {"$regex": f"^{WATCHED_PREFIX}"}}]}},
        # Cancelled / superseded / suppressed ones were rightly not sent: only sent, waiting and failed count.
        {"$match": {"status": {"$in": ["sent", "pending", "claimed", "failed"]}}},
        {"$group": {"_id": "$dealer_id", "due": {"$sum": 1},
                    "stuck": {"$sum": {"$cond": [{"$in": ["$status", ["pending", "claimed"]]}, 1, 0]}},
                    "failed": {"$sum": {"$cond": [{"$eq": ["$status", "failed"]}, 1, 0]}}}},
    ]).to_list(None)
    alerted = []
    for row in rows:
        dealer, due, stuck = row["_id"], row["due"], row["stuck"] + row["failed"]
        if stuck < MIN_STUCK or stuck / max(due, 1) < STUCK_RATIO:
            continue
        key = f"cadence:{dealer}"
        status = await db[STATUS_COLLECTION].find_one({"_id": key}) or {}
        last = status.get("alerted_at")
        if last is not None and (last if last.tzinfo else last.replace(tzinfo=UTC)) > now - WINDOW:
            continue
        text = (f"Dealer {dealer}: {stuck} of the {due} AI follow-ups due in the last 24 hours (cadence touches, AI "
                f"Studio touches, appointment messages) still haven't gone out more than {int(GRACE.total_seconds() // 60)} "
                f"minutes after they were due ({row['stuck']} waiting, {row['failed']} failed). Check the worker, the "
                "CRM and the send log.")
        try:
            await platform.send_ops_alert("AutoPulse AI: follow-ups are not going out", text)
        except Exception:  # noqa: BLE001 - an alert never breaks the worker
            logger.exception("could not send the cadence alert for %s", dealer)
            continue
        await db[STATUS_COLLECTION].update_one({"_id": key}, {"$set": {"alerted_at": now, "last": row}}, upsert=True)
        alerted.append(dealer)
    return {"dealers": len(rows), "alerted": alerted}
