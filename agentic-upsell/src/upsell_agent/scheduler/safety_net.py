"""Every hour: an active lead in a working stage always has a next step.

The user, 26 Oct 2026: about 100 leads since live sending were left with nothing planned - a handoff released without a
new touch, touches cancelled while the AI was switched off and not restarted, a quiet-hours hold cancelled instead of
moved. Nothing showed it: a message that never goes raises nothing. Betsy's 20 Oct rule (a lead leaves a staff change
with a touch planned) is applied everywhere: a lead with nothing pending gets its next cadence touch, planned through the
same path and send check as every other message the system starts.

From SAFETY_NET_FROM only (the user: "start things from today"); older leads are reviewed by hand.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)

logger = logging.getLogger(__name__)

ENABLED = True  # AI Studio > Compliance > Safeguards
SAFETY_NET_FROM = datetime(2026, 10, 26, 4, 0, tzinfo=UTC)  # midnight New York, 26 Oct 2026
WORKING_STAGES = ("new_lead", "no_contact_made", "contact_made_no_next_action")
OPEN = ("pending", "standby", "claimed")
SETTLE = timedelta(minutes=30)
# Another of the customer's leads already has a workflow talking to them.
BUSY_STAGES = ("appointment_set", "appointment_no_show", "sales_visit", "sold_pending", "sold_delivered")  # a first reply or a status change may still be planning its own step


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def check_dealer(dealer_id: str) -> dict[str, Any]:
    """Plans the next touch for each of the dealer's leads that has none. Never raises for one lead."""
    from upsell_agent.agent.duplicates import workflow_lead_id
    from upsell_agent.agent.turn import find_lead
    from upsell_agent.scheduler.followups import plan_cadence_touch

    db = dealer_scoped_db(dealer_id)
    states, followups = db.collection(AI_LEAD_STATE_COLLECTION), db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    now = clock.now()
    planned: list[str] = []
    rows = await states.find({"status": "active", "stage": {"$in": list(WORKING_STAGES)}}).to_list(None)
    for st in rows:
        lead_id = st["lead_id"]
        created = _aware(st.get("opportunity_created_at")) or _aware(st["_id"].generation_time)
        if not created or created < SAFETY_NET_FROM or now - created < SETTLE:
            continue
        if (changed := _aware(st.get("status_at"))) and now - changed < SETTLE:
            continue
        if await workflow_lead_id(db, lead_id) != lead_id:
            continue  # a linked duplicate: the customer's open lead has the conversation
        if st.get("customer_id") and await states.find_one(
                {"customer_id": st["customer_id"], "lead_id": {"$ne": lead_id}, "stage": {"$in": list(BUSY_STAGES)}},
                projection={"_id": 1}):
            # Christine Pache, 26 Oct 2026: her appointment ran on her other lead (now in the no-show workflow); a sales
            # touch on this one would go out alongside it. That workflow is her next step.
            continue
        if await followups.find_one({"lead_id": lead_id, "status": {"$in": list(OPEN)},
                                     "kind": {"$ne": "daily_call_task"}}, projection={"_id": 1}):
            continue
        try:
            lead = await find_lead(db, lead_id)
            if not lead or not lead.get("customer_id"):
                continue
            result = await plan_cadence_touch(db, lead_id=lead_id, customer_id=str(lead["customer_id"]),
                                              channel=st.get("channel") or "sms", lead=lead, lead_state=st,
                                              turn_id=f"safety-net-{lead_id}-{now:%Y%m%d%H}")
        except Exception:  # noqa: BLE001 - one lead never stops the others
            logger.exception("safety net: could not plan a touch for lead %s", lead_id)
            continue
        await states.update_one({"lead_id": lead_id}, {"$set": {"safety_net": {"at": now, "result": str(
            result.get("reason") or result.get("status") or result)[:200]}}})
        planned.append(lead_id)
        logger.warning("safety net: lead %s had no next step - %s", lead_id, result.get("reason") or result)
    return {"dealer_id": dealer_id, "planned": planned}


async def run() -> dict[str, Any]:
    from upsell_agent.scheduler.reconcile import live_dealers

    if not ENABLED:
        return {"planned": 0, "reason": "AI Studio: the safety net is off"}
    out = [await check_dealer(d) for d in await live_dealers()]
    return {"planned": sum(len(r["planned"]) for r in out), "dealers": out}
