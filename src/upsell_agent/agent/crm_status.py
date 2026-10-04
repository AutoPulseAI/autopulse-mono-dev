"""The AI's own closings shown as the lead's CRM status (PLAN_4 stream S).

When the AI closes an opportunity itself - the Day 91 sweep (Closed - Lost) or a customer's "no, I don't own it
any more" to an ownership anniversary (Closed - No Longer Owns) - the CRM lead's status says so too, through
`POST /api/internal/ai/leads/status` (shared secret, like the DND sync in events/handlers.py `_mark_lead_dnd`).

The CRM decides whether to apply it (aidmvcs-be-dev app/lib/ai/aiDnd.js `markLeadClosedFromAi`): it never
overwrites a status staff set after the AI closed the lead, nor a staff status the AI could not have been working
from (Sold, Visited, DND, ...). Staff closings are never sent back (the CRM already has them), so there is no loop.

Only for a live dealer (a shadow dealer's AI changes nothing the customer or staff see). A CRM that can't be
reached never stops the close itself: the result is kept on the lead state (`crm_status_sync`) and a failed one is
retried by the next Day 91 sweep.
"""

import logging
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION, DealerScopedDatabase, get_db

logger = logging.getLogger(__name__)

# The AI's own closing events and the CRM status each one shows.
CRM_STATUS_FOR_EVENT = {
    "day_91": "Closed - Lost",
    "no_longer_owns": "Closed - No Longer Owns",
}
RETRY_LIMIT = 200


def _client(platform: Any | None) -> Any:
    if platform is not None:
        return platform
    from upsell_agent.config import get_settings
    from upsell_agent.integrations.platform_client import get_platform_client
    return get_platform_client(get_settings())


async def sync_closed(db: DealerScopedDatabase, lead_id: str, event_kind: str, *, reason: str,
                      closed_at: Any = None, platform: Any | None = None) -> dict[str, Any]:
    """Shows the AI's closing on the CRM lead. Never raises. Returns what happened (kept on the lead state)."""
    from upsell_agent.integrations.dealer_mode import dealer_ai_mode

    status = CRM_STATUS_FOR_EVENT.get(event_kind)
    if not status:
        return {"status": "not_needed"}
    closed_at = closed_at or clock.now()
    try:
        mode = await dealer_ai_mode(db.dealer_id)
    except Exception:  # noqa: BLE001 - an unknown mode is treated as not live
        mode = "unknown"
    if mode != "live":
        result: dict[str, Any] = {"status": "skipped", "reason": f"dealer AI mode is {mode}", "crm_status": status}
    else:
        try:
            answer = await _client(platform).set_lead_status(db.dealer_id, lead_id, status, reason=reason,
                                                             closed_at=closed_at)
            result = {"status": "updated" if answer.get("updated") else "kept", "crm_status": status,
                      **({"reason": answer["reason"]} if answer.get("reason") else {})}
        except Exception as exc:  # noqa: BLE001 - the close stands whatever the CRM answers
            logger.exception("could not show lead %s as %s in the CRM", lead_id, status)
            result = {"status": "failed", "crm_status": status, "error": str(exc)[:300], "event": event_kind,
                      "reason_text": reason}
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"crm_status_sync": {**result, "at": clock.now(), "closed_at": closed_at}}})
    return result


async def retry_failed(*, platform: Any | None = None, limit: int = RETRY_LIMIT) -> dict[str, Any]:
    """Tries again every closing the CRM didn't take (unreachable). Run by the Day 91 sweep."""
    from upsell_agent.integrations.mongodb import dealer_scoped_db

    rows = await get_db()[AI_LEAD_STATE_COLLECTION].find({"crm_status_sync.status": "failed"}).to_list(limit)
    done = 0
    for row in rows:
        sync = row.get("crm_status_sync") or {}
        if not row.get("dealer_id") or not row.get("lead_id"):
            continue
        result = await sync_closed(dealer_scoped_db(row["dealer_id"]), row["lead_id"], sync.get("event", ""),
                                   reason=sync.get("reason_text") or "", closed_at=sync.get("closed_at"),
                                   platform=platform)
        done += result["status"] != "failed"
    return {"retried": len(rows), "synced": done}
