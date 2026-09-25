"""What the worker does for each event (architecture §4-§5, §11).

Kept free of SAQ so tests call these directly. worker/jobs.py is a thin
wrapper that adds the lead lock / dealer cap and passes the payload through.
"""

from datetime import datetime
from typing import Any

from upsell_agent import clock
from upsell_agent.agent.turn import (
    TurnDeps,
    find_lead,
    lead_type_from_lead,
    run_turn,
)
from upsell_agent.channels import consent
from upsell_agent.events.models import (
    InboundMessageEvent,
    LeadCreatedEvent,
    LeadPausedEvent,
    LeadResumedEvent,
)
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
)

# Statuses in which the AI saves the message but does not reply (architecture §5 step 3).
SILENT_STATUSES = {"handoff", "paused", "opted_out"}


async def _cancel_pending_followups(db: DealerScopedDatabase, lead_id: str) -> int:
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "status": "pending"},
        {"$set": {"status": "cancelled", "cancelled_at": clock.now()}},
    )
    return result.modified_count


async def _ensure_lead_state(db: DealerScopedDatabase, lead_id: str, customer_id: str, lead: dict | None) -> dict:
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$setOnInsert": {"lead_id": lead_id, "customer_id": customer_id, "status": "active",
                          "status_reason": None, "lead_type": lead_type_from_lead(lead).value,
                          "created_at": clock.now()}},
        upsert=True,
    )
    return await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id})


async def _set_status(db: DealerScopedDatabase, lead_id: str, status: str, reason: str | None) -> None:
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"status": status, "status_reason": reason, "status_at": clock.now()}}
    )


def _comments(lead: dict | None) -> str:
    if not lead:
        return ""
    data = lead.get("data") or {}
    return str(data.get("comments") or lead.get("comments") or "")


def _parse_received_at(value: str | datetime | None) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def first_reply_turn_id(lead_id: str) -> str:
    return f"lead-created-{lead_id}"


def reply_turn_id(message_row_id: Any) -> str:
    return f"inbound-{message_row_id}"


async def _already_sent(db: DealerScopedDatabase, turn_id: str) -> dict | None:
    """A send for this exact turn already exists: this job is a re-run
    (a retry after a late error, or the queue delivering it twice)."""
    return await db.collection(AI_MESSAGES_COLLECTION).find_one({"turn_id": turn_id, "direction": "outbound"})


async def handle_lead_created(event: LeadCreatedEvent, deps: TurnDeps,
                              received_at: str | datetime | None = None) -> dict[str, Any]:
    db = dealer_scoped_db(event.dealer_id)
    lead = await find_lead(db, event.lead_id)
    state = await _ensure_lead_state(db, event.lead_id, event.customer_id, lead)
    if state["status"] in SILENT_STATUSES:
        return {"status": "skipped", "reason": f"lead is {state['status']}"}
    turn_id = first_reply_turn_id(event.lead_id)
    if previous := await _already_sent(db, turn_id):
        return {"status": "already_answered", "turn_id": turn_id, "send_status": previous.get("status")}

    log = await run_turn(
        dealer_id=event.dealer_id, customer_id=event.customer_id, lead_id=event.lead_id,
        trigger="lead_created", channel=event.channel, inbound_text=_comments(lead),
        shadow=event.shadow, deps=deps, event_received_at=_parse_received_at(received_at), turn_id=turn_id,
    )
    return {"status": "done", "turn_id": log["turn_id"], "outcome": log["outcome"],
            "send_status": log["summary"].get("send_status")}


async def record_inbound(event: InboundMessageEvent) -> str | None:
    """Saves the customer's message (idempotent on the platform message id)
    and returns its lead id. Called BEFORE the lead lock is taken
    (worker/jobs.py), so messages that arrive while a turn is running are
    already on record when the next turn looks for unanswered ones."""
    db = dealer_scoped_db(event.dealer_id)
    lead_id = event.lead_id
    if not lead_id:
        latest = await db.collection(PLATFORM_LEADS_COLLECTION).find(
            {"customer_id": {"$in": [event.customer_id, as_object_id(event.customer_id)]}}
        ).sort("_id", -1).to_list(1)
        lead_id = str(latest[0]["_id"]) if latest else None
    await db.collection(AI_MESSAGES_COLLECTION).update_one(
        {"platform_message_id": event.message_id},
        {"$setOnInsert": {"lead_id": lead_id, "customer_id": event.customer_id, "direction": "inbound",
                          "channel": event.channel, "text": event.text, "platform_message_id": event.message_id,
                          "created_at": event.received_at, "answered_turn_id": None}},
        upsert=True,
    )
    return lead_id


async def _mark_answered(db: DealerScopedDatabase, rows: list[dict], turn_id: str) -> None:
    for row in rows:
        await db.collection(AI_MESSAGES_COLLECTION).update_one({"_id": row["_id"]},
                                                               {"$set": {"answered_turn_id": turn_id}})


async def handle_inbound_message(event: InboundMessageEvent, deps: TurnDeps,
                                 received_at: str | datetime | None = None) -> dict[str, Any]:
    db = dealer_scoped_db(event.dealer_id)
    lead_id = await record_inbound(event)
    if not lead_id:
        return {"status": "saved_only", "reason": "no lead found for this customer"}

    # Everything this customer sent that no turn has answered yet: three
    # quick texts get one reply, not three (architecture §5 step 5).
    unanswered = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"lead_id": lead_id, "direction": "inbound", "answered_turn_id": None}).to_list(None)
    unanswered.sort(key=lambda m: m["created_at"])
    if not unanswered:
        return {"status": "already_answered", "reason": "an earlier turn answered this message"}

    # Step 1, before anything can fail: the customer replied, so no channel switch.
    cancelled = await _cancel_pending_followups(db, lead_id)

    lead = await find_lead(db, lead_id)
    state = await _ensure_lead_state(db, lead_id, event.customer_id, lead)
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"last_inbound_at": event.received_at}}
    )

    # Carrier keywords, handled in code with no AI (architecture §5 step 3).
    # The carrier sends its own confirmation, so we never reply to these.
    for message in unanswered:
        keyword = consent.classify_keyword(message["text"])
        channel = message["channel"]
        if keyword == "stop":
            await consent.set_channel_consent(db, event.customer_id, channel, False, source="customer_stop")
            await _set_status(db, lead_id, "opted_out", f"Customer replied STOP on {channel}")
            await _mark_answered(db, unanswered, "keyword:stop")
            return {"status": "opted_out", "channel": channel, "followups_cancelled": cancelled}
        if keyword == "start" and await consent.is_opted_out(db, event.customer_id, channel):
            await consent.set_channel_consent(db, event.customer_id, channel, True, source="customer_start")
            if state["status"] == "opted_out":
                await _set_status(db, lead_id, "active", None)
            await _mark_answered(db, unanswered, "keyword:start")
            return {"status": "opted_in", "channel": channel, "followups_cancelled": cancelled}

    if state["status"] in SILENT_STATUSES:
        # Staff own this conversation now; don't answer these later on resume.
        await _mark_answered(db, unanswered, f"silent:{state['status']}")
        return {"status": "saved_only", "reason": f"lead is {state['status']}", "followups_cancelled": cancelled}

    latest = unanswered[-1]
    turn_id = reply_turn_id(latest["_id"])
    if previous := await _already_sent(db, turn_id):
        # A re-run of a turn that already answered these messages.
        await _mark_answered(db, unanswered, turn_id)
        return {"status": "already_answered", "turn_id": turn_id, "send_status": previous.get("status"),
                "followups_cancelled": cancelled}
    log = await run_turn(
        dealer_id=event.dealer_id, customer_id=event.customer_id, lead_id=lead_id,
        trigger="inbound_message", channel=latest["channel"],
        inbound_text="\n".join(m["text"] for m in unanswered),
        shadow=event.shadow, deps=deps, event_received_at=_parse_received_at(received_at),
        source_message_id=str(latest["_id"]), turn_id=turn_id,
    )
    await _mark_answered(db, unanswered, log["turn_id"])
    return {"status": "done", "turn_id": log["turn_id"], "outcome": log["outcome"],
            "send_status": log["summary"].get("send_status"), "followups_cancelled": cancelled,
            "batched": len(unanswered)}


async def handle_lead_paused(event: LeadPausedEvent) -> dict[str, Any]:
    db = dealer_scoped_db(event.dealer_id)
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": event.lead_id},
        {"$set": {"status": "paused", "status_reason": event.reason or "Paused by staff", "paused_at": clock.now()},
         "$setOnInsert": {"lead_id": event.lead_id, "created_at": clock.now()}},
        upsert=True,
    )
    cancelled = await _cancel_pending_followups(db, event.lead_id)
    return {"status": "paused", "followups_cancelled": cancelled}


async def handle_lead_resumed(event: LeadResumedEvent) -> dict[str, Any]:
    db = dealer_scoped_db(event.dealer_id)
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": event.lead_id},
        {"$set": {"status": "active", "status_reason": None, "resumed_at": clock.now()},
         "$setOnInsert": {"lead_id": event.lead_id, "created_at": clock.now()}},
        upsert=True,
    )
    return {"status": "active"}
