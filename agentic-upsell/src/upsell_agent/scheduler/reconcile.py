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
from upsell_agent.agent.history_sync import PLATFORM_EMAILS_COLLECTION, sync_lead_history
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.dealer_mode import dealer_allowed
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
# No AI follow-up within this long of a staff message to the customer (the user, 28 Oct 2026).
STAFF_QUIET = timedelta(days=7)
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


OLD_CRM_STOP = "old_crm_stop"


async def opt_out_from_old_crm(db: DealerScopedDatabase, customer_id: str, lead_id: str, said: str) -> None:
    from upsell_agent.channels.consent import set_channel_consent
    for channel in ("sms", "email"):
        await set_channel_consent(db, customer_id, channel, False, OLD_CRM_STOP, lead_id=lead_id,
                                  evidence={"said": said, "where": "a message to the CRM before the AI took the lead"})


async def repair_old_crm_stops() -> int:
    """28 Oct 2026: 23 leads picked up overnight whose customer had said STOP to the old CRM were marked opted out by
    status only, which the start-up step reset to active. They are found by that reset and given a real opt-out.
    Safe to run on every start: a customer already opted out this way is skipped."""
    from upsell_agent.channels.consent import AI_CONSENT_COLLECTION
    from upsell_agent.compliance.opt_out import classify_keyword, sounds_like_stop
    db_all = get_db()
    rows = await db_all[AI_LEAD_STATE_COLLECTION].find(
        {"adopted_at": {"$exists": True}, "status_reason": {"$regex": "decision 137"}},
        projection={"lead_id": 1, "dealer_id": 1, "customer_id": 1}).to_list(None)
    fixed = 0
    for row in rows:
        if not row.get("dealer_id") or not row.get("customer_id") or not ObjectId.is_valid(str(row.get("lead_id"))):
            continue
        db = dealer_scoped_db(row["dealer_id"])
        if await db.collection(AI_CONSENT_COLLECTION).find_one(
                {"customer_id": row["customer_id"], "consent_source": OLD_CRM_STOP}, projection={"_id": 1}):
            continue
        said = next((m for m in await db.collection(PLATFORM_EMAILS_COLLECTION).find(
            {"lead_id": ObjectId(row["lead_id"]), "status": {"$in": ["received", "incoming"]}},
            projection={"mail_content": 1}).to_list(200)
            if classify_keyword(str(m.get("mail_content") or "")) == "stop"
            or sounds_like_stop(str(m.get("mail_content") or ""))), None)
        if said:
            await opt_out_from_old_crm(db, row["customer_id"], row["lead_id"], str(said.get("mail_content") or "")[:200])
            fixed += 1
    return fixed


async def note_stopped_inquiries() -> int:
    """The user, 28 Oct 2026: leads the customer asked us to stop about before the staff note existed get it now,
    and are closed (Closed - Lost). Safe to run on every start: a lead already noted is skipped."""
    from upsell_agent.events.handlers import note_inquiry_stopped
    written = 0
    rows = await get_db()[AI_LEAD_STATE_COLLECTION].find(
        {"inquiry_opt_out": {"$exists": True}, "dealer_id": {"$exists": True}},
        projection={"lead_id": 1, "dealer_id": 1, "customer_id": 1, "inquiry_opt_out": 1}).to_list(None)
    for row in rows:
        stop = next((v for v in (row.get("inquiry_opt_out") or {}).values() if isinstance(v, dict)), None)
        if not stop or not row.get("dealer_id") or not row.get("lead_id"):
            continue
        db = dealer_scoped_db(row["dealer_id"])
        if await db.collection("ai_crm_notes").find_one({"key": f"inquiry_stopped:{row['lead_id']}",
                                                         "status": "written"}, projection={"_id": 1}):
            continue
        result = await note_inquiry_stopped(db, row["lead_id"], stop.get("said") or "",
                                            customer_id=row.get("customer_id"), close=True)
        written += result.get("status") == "written"
    return written


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
    rows = await db.collection(PLATFORM_EMAILS_COLLECTION).find(
        {"lead_id": {"$in": [lead["_id"], lead_id]}, "is_note": {"$ne": True}, "communication_type": {"$ne": "note"}},
        projection={"status": 1, "mail_content": 1, "timestamp": 1, "ai_generated": 1}).to_list(500)
    from upsell_agent.compliance.opt_out import classify_keyword, sounds_like_stop
    said_stop = next((r for r in rows if str(r.get("status")) in ("received", "incoming") and (
        classify_keyword(str(r.get("mail_content") or "")) == "stop" or sounds_like_stop(str(r.get("mail_content") or "")))),
        None)
    if said_stop:
        # The user, 28 Oct 2026: a customer who told the old CRM to stop is never followed up by the AI. The opt-out
        # goes on the consent record, which stops everything the system starts on both channels (a lead status alone
        # was reset at the next start - consent.migrate_silenced_opt_outs, decision 137).
        await opt_out_from_old_crm(db, customer_id, lead_id, str(said_stop.get("mail_content") or "")[:200])
        return {"lead_id": lead_id, "stage": (stage or {}).get("stage"), "history": history, "opted_out": True}
    staff_at = max((_aware(r.get("timestamp")) for r in rows if not r.get("ai_generated") and str(r.get("status"))
                    not in ("received", "incoming", "note") and _aware(r.get("timestamp"))), default=None)
    if staff_at and now - staff_at < STAFF_QUIET:
        # The user, 28 Oct 2026: no AI follow-up within 7 days of a staff message to the customer (the hold, which
        # only stops the AI's own timed messages - a customer's reply is still answered).
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {"customer_hold": {
            "at": now, "until": staff_at + STAFF_QUIET, "reason": "staff messaged the customer within the last 7 days"}}})
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
    # The user, 28 Oct 2026 ("leads 60, 20, 10 days old must be in the cadences too"): this read the newest
    # BATCH * 5 leads and then skipped the ones the AI already knew - with 4,053 leads in 90 days, the newest 1,000
    # were all known, so no lead older than about 30 days was ever adopted (2,100 open leads with no follow-up). Only
    # leads the AI doesn't know yet are read now, so every run moves through the whole 90 days.
    known_ids = [ObjectId(s["lead_id"]) for s in await states.find(
        {"lead_id": {"$exists": True}}, projection={"lead_id": 1}).to_list(None) if ObjectId.is_valid(s["lead_id"])]
    leads = await db.collection(PLATFORM_LEADS_COLLECTION).find(
        {"_id": {"$gte": oldest, "$lte": newest, "$nin": known_ids}}).sort("_id", -1).to_list(BATCH * 5)
    known: set[str] = set()
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
