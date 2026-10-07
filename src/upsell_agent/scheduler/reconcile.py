"""Reconciliation: CRM leads and customer messages the AI never heard about (PLAN_4 stream X3 items 5 and 6).

Events can be lost (the AI service down longer than the CRM's retries, Redis down on the CRM side, a deploy) and a
dealer switched to `live` has leads that were open before. Every RECONCILE_EVERY, for each dealer whose AI is
`live`, this sweep finds:

1. **New leads with no AI state** (created within RECENT_WINDOW, nothing sent to them yet by anyone): submitted as
   `lead-created` (event id = Lead _id, exactly what the CRM would have sent), so they get their first reply.
2. **Open leads the AI never saw** (older, or already answered by n8n/staff - e.g. open when the dealer went live):
   *adopted* without a first reply - AI state, a stage and opportunity clock from the lead's own creation date,
   its CRM history imported (agent/history_sync.py), and the next cadence touch planned from where it stands.
3. **Customer messages with no AI record** (within RECENT_WINDOW, after the AI took the lead, not answered by a
   person since): submitted as `inbound-message` (event id = Email _id).

Idempotent: events go through the normal intake (events/intake.py), which drops an event id it has already
accepted, and every turn's sends are idempotent; an adoption is claimed by inserting the lead's AI state, so two
workers never adopt the same lead. Nothing here sends anything itself.
"""

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.agent import duplicates, lifecycle
from upsell_agent.agent.customer_key import lead_customer_id
from upsell_agent.integrations.dealer_mode import dealer_allowed
from upsell_agent.agent.history_sync import PLATFORM_EMAILS_COLLECTION, sync_lead_history
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    DealerScopedDatabase,
    dealer_scoped_db,
    get_db,
)

logger = logging.getLogger(__name__)

RECENT_WINDOW = timedelta(hours=48)
# The CRM's own event path gets this long before the sweep steps in (its retries take about a minute).
GRACE = timedelta(minutes=5)
# Open leads older than this are not adopted (their 90-day follow-up period is over).
ADOPT_MAX_AGE = timedelta(days=90)
BATCH = 200
_CLOSED_CRM = {"closed - lost", "closed lost", "sold", "dnd", "closed - no longer owns", "dead", "lost"}

Submit = Callable[[str, Any], Awaitable[Any]]


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _channel(lead: dict) -> str | None:
    pref = str((lead.get("data") or {}).get("channel") or lead.get("response_mode") or
               lead.get("followup_preference") or "").lower()
    has_phone = len("".join(c for c in str(lead.get("phone") or "") if c.isdigit())) >= 10
    has_email = "@" in str(lead.get("email") or "")
    if pref == "email" and has_email:
        return "email"
    if pref == "sms" and has_phone:
        return "sms"
    return "sms" if has_phone else "email" if has_email else None


async def live_dealers() -> list[str]:
    rows = await get_db()[PLATFORM_USERS_COLLECTION].find(
        {"ai_mode": "live", "setting.autoReplyEnabled": {"$ne": False}}, projection={"_id": 1}).to_list(None)
    return [str(r["_id"]) for r in rows if dealer_allowed(r["_id"])]


async def _anyone_wrote(db: DealerScopedDatabase, lead_id: Any) -> bool:
    """Has anyone (AI, n8n, staff) already sent the customer something on this lead?"""
    return bool(await db.collection(PLATFORM_EMAILS_COLLECTION).find_one(
        {"lead_id": {"$in": [lead_id, str(lead_id)]}, "status": {"$in": ["sent", "pending"]},
         "is_note": {"$ne": True}, "communication_type": {"$ne": "note"}}, projection={"_id": 1}))


async def adopt_lead(db: DealerScopedDatabase, lead: dict, *, reason: str) -> dict[str, Any] | None:
    """Takes over an open lead without a first reply (see the module docstring). None when another worker already
    has it, or the lead has no way to identify / reach the customer."""
    lead_id = str(lead["_id"])
    customer_id = lead_customer_id(lead, db.dealer_id)
    channel = _channel(lead)
    if not customer_id or not channel:
        return None
    now = clock.now()
    claimed = await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$setOnInsert": {"lead_id": lead_id, "customer_id": customer_id, "status": "active", "status_reason": None,
                          "created_at": now, "adopted_at": now, "adopted_reason": reason}},
        upsert=True)
    if claimed.upserted_id is None:
        return None
    if primary := await duplicates.find_primary(db, lead):
        return {"lead_id": lead_id, **await duplicates.link_duplicate(db, lead_id, customer_id, primary)}
    stage = await lifecycle.apply(db, lead_id, [lifecycle.Event("lead_created", source="adopted", reason=reason)],
                                  lead=lead, customer_id=customer_id)
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id})
    history = await sync_lead_history(db, lead_id=lead_id, customer_id=customer_id, lead_state=state)
    from upsell_agent.scheduler.followups import plan_cadence_touch
    touch = await plan_cadence_touch(db, lead_id=lead_id, customer_id=customer_id, channel=channel,
                                     turn_id=f"adopted-{lead_id}", lead=lead, first_contact_done=True)
    return {"lead_id": lead_id, "stage": (stage or {}).get("stage"), "history": history, "cadence_touch": touch}


async def reconcile_dealer(dealer_id: str, *, submit: Submit) -> dict[str, int]:
    db = dealer_scoped_db(dealer_id)
    now = clock.now()
    counts = {"lead_created": 0, "adopted": 0, "inbound": 0}
    states = db.collection(AI_LEAD_STATE_COLLECTION)

    # 1 + 2: leads with no AI state.
    oldest = ObjectId.from_datetime(now - ADOPT_MAX_AGE)
    newest = ObjectId.from_datetime(now - GRACE)
    leads = await db.collection(PLATFORM_LEADS_COLLECTION).find(
        {"_id": {"$gte": oldest, "$lte": newest}}).sort("_id", -1).to_list(BATCH * 5)
    known = {s["lead_id"] for s in await states.find(
        {"lead_id": {"$in": [str(lead["_id"]) for lead in leads]}}, projection={"lead_id": 1}).to_list(None)}
    for lead in leads:
        if str(lead["_id"]) in known or counts["lead_created"] + counts["adopted"] >= BATCH:
            continue
        crm_status = str(lead.get("fe_lead_status") or lead.get("lead_status") or "").strip().lower()
        if crm_status in _CLOSED_CRM:
            continue
        created = _aware(lead.get("createdAt")) or lead["_id"].generation_time
        customer_id = lead_customer_id(lead, dealer_id)
        channel = _channel(lead)
        if not customer_id or not channel:
            continue
        if now - created <= RECENT_WINDOW and not await _anyone_wrote(db, lead["_id"]):
            await submit("lead-created", LeadCreatedEvent(event_id=str(lead["_id"]), dealer_id=dealer_id,
                                                          lead_id=str(lead["_id"]), customer_id=customer_id,
                                                          channel=channel))
            counts["lead_created"] += 1
        elif await adopt_lead(db, lead, reason="open lead the AI had never seen (reconciliation)"):
            counts["adopted"] += 1

    # 3: customer messages with no AI record.
    rows = await db.collection(PLATFORM_EMAILS_COLLECTION).find({
        "lead_id": {"$ne": None}, "status": {"$in": ["incoming", "received"]}, "ai_generated": {"$ne": True},
        "is_note": {"$ne": True}, "communication_type": {"$in": ["sms", "email"]},
        "timestamp": {"$gte": now - RECENT_WINDOW, "$lte": now - GRACE}}).sort("timestamp", 1).to_list(BATCH)
    for row in rows:
        if str(row.get("message_id") or "").startswith("lead-"):
            continue  # the lead form's own comments, answered by the first reply
        if await db.collection(AI_MESSAGES_COLLECTION).find_one({"platform_message_id": str(row["_id"])},
                                                                projection={"_id": 1}):
            continue
        lead_id = str(row["lead_id"])
        state = await states.find_one({"lead_id": lead_id})
        at = _aware(row.get("timestamp"))
        if not state or not at or (_aware(state.get("created_at")) or now) > at:
            continue  # the AI didn't have the lead yet: history, not a message to answer
        if await db.collection(PLATFORM_EMAILS_COLLECTION).find_one(
                {"lead_id": row["lead_id"], "message_by": {"$ne": None}, "timestamp": {"$gt": row["timestamp"]}},
                projection={"_id": 1}):
            continue  # a person already answered it
        lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": row["lead_id"]}) or {}
        customer_id = state.get("customer_id") or lead_customer_id(lead, dealer_id)
        if not customer_id:
            continue
        await submit("inbound-message", InboundMessageEvent(
            event_id=str(row["_id"]), dealer_id=dealer_id, customer_id=customer_id, lead_id=lead_id,
            channel="sms" if row.get("communication_type") == "sms" else "email", message_id=str(row["_id"]),
            text=str(row.get("mail_content") or ""), received_at=at))
        counts["inbound"] += 1
    return counts


async def reconcile(*, submit: Submit) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for dealer_id in await live_dealers():
        try:
            results[dealer_id] = await reconcile_dealer(dealer_id, submit=submit)
        except Exception as exc:
            logger.exception("reconciliation failed for dealer %s", dealer_id)
            results[dealer_id] = {"error": repr(exc)[:300]}
    return results
