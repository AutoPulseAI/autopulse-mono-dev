"""The 24-hour channel switch (architecture §6, MASTER_PLAN_1 Stage 10).

**Schedule.** After a turn's message is sent, one follow-up is saved in
`scheduled_followups`: the same message in the other channel's version
(Compose writes both up front, so firing needs no AI call), due 24 hours
later. Only when the customer has a contact on that channel and hasn't opted
out of it. A newer message supersedes the lead's older pending follow-up, so a
lead never has more than one. If the original message named a vehicle
(MASTER_PLAN_3 Phase 3), the stock-free version Compose wrote alongside it is
stored as the default `text`/`subject` - the safe choice if firing never gets
to re-check it - alongside the vehicle version and the VINs it named
(`vehicle_text`/`vehicle_subject`/`mentioned_vins`). **At fire time** (Phase 5
item 2), those VINs are re-checked fresh; if none sold, the nicer vehicle
version is sent after all, in place of the stored stock-free default.

**Fire.** A cron job on every worker runs every minute (worker/main.py). It
resets stuck claims, then claims due follow-ups one at a time with a single
atomic update, so two workers can never take the same one. For each claim,
under the lead lock:

1. Check again: has the customer replied since? Is the lead handed off,
   paused or opted out? Is the dealer still `live`? Any "yes" cancels it.
2. Send the stored version on the other channel through the normal sender
   (idempotency key `<turn>:<channel>:fallback`, consent checked again).
3. Never schedule another one: a switched message is the last automatic try.

**Stuck claims.** A worker can die mid-fire. A claim older than 5 minutes goes
back to pending. If the provider may already have the message, the sender
finds its row in `sending` and marks it `unknown` instead of sending again.

Status flow: pending → claimed → sent | cancelled | suppressed | failed |
unknown; or pending → superseded (a newer message replaced it).

**Two kinds** share this collection and its claim / fire machinery (`kind`):

- `channel_switch` (the default; older records have no `kind`): above.
- `handoff_check` (MASTER_PLAN_2 Phase 2, architecture §15 decision 12): 30
  business minutes after a lead is handed to a person. If staff still
  haven't taken it over, the customer gets one "still on it" holding reply and
  a staff alert is recorded on the lead. Once per handoff. A customer message
  doesn't cancel it; staff pausing or resuming the lead does.

**Contact window** (decision 11): both are messages the AI starts on its own,
so an SMS is only sent 8:00-20:00 in the dealer's timezone. One that falls
outside is planned for, or pushed back to, the next 8:00
(scheduler/contact_window.py).
"""

import asyncio
import contextlib
import logging
import os
import socket
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from datetime import timedelta
from typing import Any

from pymongo import ReturnDocument

from upsell_agent import clock
from upsell_agent.agent.templates import (
    SOLD_VEHICLE_FALLBACK_SUBJECT,
    SOLD_VEHICLE_FALLBACK_TEXT,
    render_holding_reply,
)
from upsell_agent.channels.consent import check_channel, resolve_recipient
from upsell_agent.channels.sender import SendOutcome, SendRequest
from upsell_agent.config import get_settings
from upsell_agent.integrations.dealer_mode import dealer_ai_mode
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.observability.trace import TurnTracer
from upsell_agent.scheduler.contact_window import (
    add_business_minutes,
    is_proactive_sms_allowed,
    proactive_send_time,
)
from upsell_agent.tools.inventory_tool import find_sold, get_inventory_source
from upsell_agent.worker.locks import Busy

logger = logging.getLogger(__name__)

FOLLOWUP_DELAY = timedelta(hours=24)
STUCK_CLAIM_AFTER = timedelta(minutes=5)
# A follow-up whose lead is busy (a turn is running) is retried this much later.
BUSY_RETRY_AFTER = timedelta(seconds=30)
# Per cron run; anything left waits for the next minute.
FIRE_BATCH_LIMIT = 500
# Follow-ups fired at once by one worker (no AI call: a lookup and a send).
FIRE_CONCURRENCY = 10

# Lead statuses in which staff own the conversation (events/handlers.py).
SILENT_STATUSES = {"handoff", "paused", "opted_out"}

KIND_CHANNEL_SWITCH = "channel_switch"
KIND_HANDOFF_CHECK = "handoff_check"
# Matches channel switches, including records from before `kind` existed.
CHANNEL_SWITCHES = {"kind": {"$ne": KIND_HANDOFF_CHECK}}
HANDOFF_TIMEOUT_BUSINESS_MINUTES = 30

LeadLock = Callable[[str, str], AbstractAsyncContextManager[Any]]


def _no_lock(_dealer_id: str, _lead_id: str) -> AbstractAsyncContextManager[Any]:
    return contextlib.nullcontext()


def worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def other_channel(channel: str) -> str:
    return "email" if channel == "sms" else "sms"


# --- Schedule -----------------------------------------------------------------

async def plan_followup(
    db: DealerScopedDatabase,
    *,
    sent: SendOutcome,
    draft: dict[str, Any],
    lead: dict | None,
    customer: dict | None,
    lead_id: str,
    customer_id: str,
    turn_id: str,
    channel: str,
    action: str | None,
) -> dict[str, Any]:
    """Saves the follow-up for a message a turn just sent. Returns what
    happened, for the Schedule step's trace: `created` plus either the new
    follow-up or the reason there isn't one."""
    other = other_channel(channel)
    if action == "handoff":
        return {"created": False, "reason": "lead handed to a person; staff follow up, not the AI"}
    if sent.status not in ("sent", "failed"):
        return {"created": False, "reason": f"message not sent ({sent.status})"}

    # MASTER_PLAN_3 Phase 3 decision L / Phase 5 item 2: the stock-free version
    # is the stored default (safe if this never gets re-checked), but the
    # vehicle version and its VINs are kept too, so firing can use the nicer
    # version once it re-checks the vehicle hasn't sold since. Never falls
    # back to the vehicle version if the stock-free one is missing (decision
    # L's original gap): that would store exactly what this exists to avoid.
    mentioned_vins = list((draft.get(f"{other}_vins")) or [])
    if other == "sms":
        vehicle_text, vehicle_subject = draft.get("sms_text"), None
        text = draft.get("sms_text_no_vehicles") or (SOLD_VEHICLE_FALLBACK_TEXT if mentioned_vins else vehicle_text)
        subject = None
    else:
        vehicle_text, vehicle_subject = draft.get("email_body"), draft.get("email_subject")
        text = draft.get("email_body_no_vehicles") or (SOLD_VEHICLE_FALLBACK_TEXT if mentioned_vins else vehicle_text)
        subject = draft.get("email_subject_no_vehicles") or (
            SOLD_VEHICLE_FALLBACK_SUBJECT if mentioned_vins else vehicle_subject)
    if not text:
        return {"created": False, "reason": f"the draft has no {other} version"}

    to = resolve_recipient(lead, customer, other)
    if not to:
        return {"created": False, "reason": f"no {other} contact on file"}
    consent = await check_channel(db, customer_id, customer, other, to)
    if not consent.allowed:
        return {"created": False, "reason": f"{other}: {consent.reason}"}

    now = clock.now()
    # A permanent send failure doesn't wait a day: try the other channel now
    # (architecture §6 "Failed SMS" - same rule at send time).
    wanted = now if sent.status == "failed" else now + FOLLOWUP_DELAY
    profile = await dealer_profile(db.dealer_id)
    due_at = proactive_send_time(wanted, other, profile.tz)
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    superseded = await followups.update_many(
        {"lead_id": lead_id, "status": "pending", **CHANNEL_SWITCHES},
        {"$set": {"status": "superseded", "reason": "a newer message was sent", "closed_at": now}},
    )
    held = due_at > wanted
    reason = f"{channel} send failed: switching now" if sent.status == "failed" else None
    if held:
        reason = (reason + "; " if reason else "") + "SMS held to the 8:00-20:00 contact window"
    doc = {
        "kind": KIND_CHANNEL_SWITCH, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id,
        "source_message_id": sent.message_id, "source_provider_id": sent.provider_id,
        "from_channel": channel, "to_channel": other, "to": to, "text": text, "subject": subject,
        "status": "pending", "due_at": due_at, "created_at": now, "claim_count": 0, "reason": reason,
    }
    if mentioned_vins:
        # Phase 5 item 2: kept so firing can re-check and use the nicer
        # version if the vehicle(s) are still there.
        doc.update(mentioned_vins=mentioned_vins, vehicle_text=vehicle_text, vehicle_subject=vehicle_subject)
    inserted = await followups.insert_one(doc)
    return {"created": True, "followup_id": str(inserted.inserted_id), "to_channel": other, "to": to,
            "due_at": due_at.isoformat(), "superseded": superseded.modified_count,
            "due_now": sent.status == "failed" and not held, "held_to_contact_window": held,
            "timezone": profile.timezone}


async def plan_handoff_check(
    db: DealerScopedDatabase,
    *,
    lead_id: str,
    customer_id: str,
    channel: str,
    handoff_id: str,
    handoff_reason: str | None,
) -> dict[str, Any]:
    """Schedules the check 30 business minutes after a handoff (dealer time;
    an SMS due outside 8:00-20:00 waits for 8:00). Replaces any older pending
    check for the lead."""
    now = clock.now()
    profile = await dealer_profile(db.dealer_id)
    after = add_business_minutes(now, HANDOFF_TIMEOUT_BUSINESS_MINUTES, profile.hours, profile.tz)
    due_at = proactive_send_time(after, channel, profile.tz)
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    await followups.update_many(
        {"lead_id": lead_id, "status": "pending", "kind": KIND_HANDOFF_CHECK},
        {"$set": {"status": "superseded", "reason": "a newer handoff", "closed_at": now}})
    doc = {
        "kind": KIND_HANDOFF_CHECK, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": handoff_id,
        "handoff_id": handoff_id, "handoff_reason": handoff_reason, "from_channel": channel, "to_channel": channel,
        "text": None, "subject": None, "status": "pending", "due_at": due_at, "created_at": now, "claim_count": 0,
        "reason": "SMS held to the 8:00-20:00 contact window" if due_at > after else None,
    }
    inserted = await followups.insert_one(doc)
    return {"created": True, "followup_id": str(inserted.inserted_id), "due_at": due_at.isoformat(),
            "business_minutes": HANDOFF_TIMEOUT_BUSINESS_MINUTES, "timezone": profile.timezone,
            "hours_from_record": profile.hours_from_record}


# --- Fire ---------------------------------------------------------------------

async def reset_stuck_claims() -> int:
    """Claims a dead worker left behind go back to pending (cross-dealer by
    design, architecture §10)."""
    result = await get_db()[SCHEDULED_FOLLOWUPS_COLLECTION].update_many(
        {"status": "claimed", "claimed_at": {"$lt": clock.now() - STUCK_CLAIM_AFTER}},
        {"$set": {"status": "pending", "reason": "claim reset: the worker holding it stopped"}},
    )
    if result.modified_count:
        logger.warning("reset %s stuck follow-up claim(s)", result.modified_count)
    return result.modified_count


async def claim_next(claimed_by: str) -> dict | None:
    """Atomically takes the oldest due follow-up. The one query that reads
    every dealer's follow-ups; each claim is scoped to its own dealer after."""
    now = clock.now()
    return await get_db()[SCHEDULED_FOLLOWUPS_COLLECTION].find_one_and_update(
        {"status": "pending", "due_at": {"$lte": now}},
        {"$set": {"status": "claimed", "claimed_at": now, "claimed_by": claimed_by}, "$inc": {"claim_count": 1}},
        sort=[("due_at", 1)],
        return_document=ReturnDocument.AFTER,
    )


async def fire_due(deps: Any, *, lock: LeadLock = _no_lock, claimed_by: str | None = None,
                   limit: int = FIRE_BATCH_LIMIT, concurrency: int = FIRE_CONCURRENCY) -> dict[str, Any]:
    """One cron run: reset stuck claims, then fire every due follow-up,
    `concurrency` at a time. `deps` is the worker's TurnDeps (sender, trace
    sink, settings).

    A follow-up is claimed only once a slot is free, so a claim never sits
    idle here while another worker could have taken it. A campaign's replies
    all fall due within minutes of each other 24h later; firing them one by
    one took over 20s per 200 in the Stage 12 burst leftovers."""
    claimed_by = claimed_by or worker_id()
    summary: dict[str, Any] = {"reset": await reset_stuck_claims(), "fired": 0, "results": {}}
    slots = asyncio.Semaphore(max(1, concurrency))

    async def fire(doc: dict) -> None:
        try:
            status = await fire_one(doc, deps, lock=lock)
        except Exception:
            # Leave it claimed: the stuck-claim reset retries it in 5 minutes,
            # and the sender's idempotency key stops a double send.
            logger.exception("follow-up %s failed to fire", doc["_id"])
            status = "error"
        finally:
            slots.release()
        summary["fired"] += 1
        summary["results"][status] = summary["results"].get(status, 0) + 1

    tasks = []
    for _ in range(limit):
        await slots.acquire()
        doc = await claim_next(claimed_by)
        if doc is None:
            slots.release()
            break
        tasks.append(asyncio.create_task(fire(doc)))
    await asyncio.gather(*tasks)
    return summary


async def _close(db: DealerScopedDatabase, doc: dict, status: str, **fields: Any) -> bool:
    """Final status, only if this claim is still ours (a stuck-claim reset may
    have handed it to another worker)."""
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
        {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
        {"$set": {"status": status, "closed_at": clock.now(), **fields}},
    )
    return result.modified_count == 1


async def _why_not_send(db: DealerScopedDatabase, doc: dict) -> list[tuple[str, bool, str]]:
    """The re-checks right before sending, as (check, passed, detail)."""
    replied = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"lead_id": doc["lead_id"], "direction": "inbound", "created_at": {"$gt": doc["created_at"]}}
    ).to_list(1)
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": doc["lead_id"]}) or {}
    status = state.get("status", "active")
    mode = await dealer_ai_mode(db.dealer_id)
    return [
        ("no_reply", not replied,
         "the customer replied since, so no switch is needed" if replied else "no reply from the customer"),
        ("lead_active", status not in SILENT_STATUSES,
         f"lead is {status}" + (f" ({state.get('status_reason')})" if state.get("status_reason") else "")),
        ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
    ]


async def _fresh_followup_text(dealer_id: str, doc: dict[str, Any]) -> tuple[str, str | None, dict[str, Any] | None]:
    """MASTER_PLAN_3 Phase 5 item 2: a follow-up that named a vehicle stored
    the stock-free version as its default (`text`/`subject`) and the nicer
    vehicle version separately (`vehicle_text`/`vehicle_subject`,
    `mentioned_vins`). Re-checked fresh here, at fire time, not at the time it
    was planned 24h ago: if none sold, the vehicle version is sent after all."""
    vins = doc.get("mentioned_vins")
    if not vins:
        return doc["text"], doc.get("subject"), None
    source = get_inventory_source(get_settings())
    sold = await find_sold(dealer_id, vins, source)
    if sold:
        return doc["text"], doc.get("subject"), {"checked": vins, "sold": sold}
    return doc["vehicle_text"] or doc["text"], doc.get("vehicle_subject") or doc.get("subject"), {"checked": vins, "sold": []}


async def fire_one(doc: dict, deps: Any, *, lock: LeadLock = _no_lock) -> str:
    dealer_id, lead_id = doc["dealer_id"], doc["lead_id"]
    db = dealer_scoped_db(dealer_id)
    fire_locked = _fire_handoff_check_locked if doc.get("kind") == KIND_HANDOFF_CHECK else _fire_locked
    try:
        async with lock(dealer_id, lead_id):
            return await fire_locked(db, doc, deps)
    except Busy:
        # A turn is running for this lead right now; it may well be answering
        # a reply that cancels this. Try again shortly.
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
            {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
            {"$set": {"status": "pending", "due_at": clock.now() + BUSY_RETRY_AFTER,
                      "reason": "lead busy with a turn; retrying shortly"}},
        )
        return "busy"


async def _fire_locked(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        trigger="followup", channel=doc["to_channel"], store_prompts=deps.store_prompts,
    )
    followup_id = str(doc["_id"])
    await tracer.start({"followup_id": followup_id, "from_channel": doc["from_channel"],
                       "to_channel": doc["to_channel"], "text": doc["text"]})

    async with tracer.node("followup", {"followup_id": followup_id, "due_at": doc["due_at"],
                                        "from_channel": doc["from_channel"], "to_channel": doc["to_channel"],
                                        "claim_count": doc.get("claim_count")}) as span:
        checks = await _why_not_send(db, doc)
        failed = [c for c in checks if not c[1]]
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "decision": "cancel" if failed else "send"}
        span.reasoning = [f"{'✓' if ok else '✗'} {d}" for _, ok, d in checks]
        span.edge_label = "cancelled" if failed else f"→ {doc['to_channel']}"

    if failed:
        reason = failed[0][2]
        await _close(db, doc, "cancelled", reason=reason)
        await tracer.skipped("send", f"Follow-up cancelled: {reason}.")
        await _log(db, tracer, "followup_cancelled", {"followup_id": followup_id, "reason": reason})
        return "cancelled"
    if deferred := await _defer_outside_contact_window(db, doc, tracer):
        return deferred

    text, subject, freshness = await _fresh_followup_text(db.dealer_id, doc)

    request = SendRequest(
        dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        turn_id=doc["source_turn_id"], channel=doc["to_channel"], text=text, subject=subject,
        is_fallback=True,
    )
    async with tracer.node("send", {"channel": request.channel, "idempotency_key": request.idempotency_key,
                                    "text": request.text, "subject": request.subject}) as span:
        sent = await deps.sender.send(request)
        span.output = {**sent.as_dict(), "freshness_recheck": freshness}
        span.reasoning = list(sent.reasoning)
        if freshness:
            span.reasoning.insert(0, (f"Re-checked {', '.join(freshness['checked'])} before sending: still there, "
                                      "so the version naming it was sent." if not freshness["sold"] else
                                      f"Re-checked before sending: {', '.join(freshness['sold'])} sold since this "
                                      "was drafted, so the stock-free version was sent instead."))
        span.metrics = {"attempts": sent.attempts}
        span.edge_label = sent.status
    await tracer.skipped("schedule", "A switched message never schedules another one.")

    # "duplicate": an earlier attempt already got this far and sent it.
    status = "sent" if sent.status in ("sent", "duplicate") else sent.status
    await _close(db, doc, status, reason=sent.reason, sent_message_id=sent.message_id, fired_at=clock.now())
    fields: dict[str, Any] = {"last_send_status": sent.status, "last_followup_at": clock.now()}
    if sent.status == "sent":
        fields["last_outbound_at"] = clock.now()
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": doc["lead_id"]}, {"$set": fields})
    await _log(db, tracer, "followup_sent" if status == "sent" else f"followup_{status}",
               {"followup_id": followup_id, "send_status": sent.status, "reply": text,
                "channel": doc["to_channel"]})
    return status


async def _log(db: DealerScopedDatabase, tracer: TurnTracer, outcome: str, summary: dict[str, Any]) -> None:
    log = await tracer.finish(outcome, summary)
    await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)


async def _defer_outside_contact_window(db: DealerScopedDatabase, doc: dict, tracer: TurnTracer) -> str | None:
    """A proactive SMS whose time came outside 8:00-20:00 dealer time (a busy
    retry, a stuck claim, a clock move) goes back to pending until 8:00."""
    if doc["to_channel"] != "sms":
        return None
    profile = await dealer_profile(db.dealer_id)
    now = clock.now()
    if is_proactive_sms_allowed(now, profile.tz):
        return None
    due_at = proactive_send_time(now, "sms", profile.tz)
    reason = f"outside the 8:00-20:00 SMS contact window ({profile.timezone}); held until 8:00"
    await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
        {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
        {"$set": {"status": "pending", "due_at": due_at, "reason": reason}})
    await tracer.skipped("send", f"Not sent: {reason}.")
    kind = doc.get("kind") or KIND_CHANNEL_SWITCH
    await _log(db, tracer, "handoff_check_deferred" if kind == KIND_HANDOFF_CHECK else "followup_deferred",
               {"followup_id": str(doc["_id"]), "reason": reason, "due_at": due_at.isoformat()})
    return "deferred"


async def _fire_handoff_check_locked(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """30 business minutes after a handoff: if staff still haven't taken the
    lead over, tell the customer once more that the team has their messages,
    and record a staff alert on the lead."""
    check_id = str(doc["_id"])
    # One trace per firing (a deferred check fires again later); the send's
    # id below stays the same across firings, so it can never go out twice.
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        trigger="handoff_check", channel=doc["to_channel"], store_prompts=deps.store_prompts,
        turn_id=f"handoff-check-{check_id}-fire{int(doc.get('claim_count') or 1)}",
    )
    await tracer.start({"followup_id": check_id, "handoff_reason": doc.get("handoff_reason"),
                        "channel": doc["to_channel"]})

    async with tracer.node("handoff_check", {"followup_id": check_id, "due_at": doc["due_at"],
                                             "handoff_id": doc.get("handoff_id"),
                                             "handoff_reason": doc.get("handoff_reason")}) as span:
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": doc["lead_id"]}) or {}
        status = state.get("status", "active")
        same_handoff = status == "handoff" and state.get("handoff_id") == doc.get("handoff_id")
        mode = await dealer_ai_mode(db.dealer_id)
        checks = [
            ("still_with_staff", same_handoff,
             "staff haven't taken the lead over yet" if same_handoff
             else f"lead is {status}" + (f" ({state.get('status_reason')})" if state.get("status_reason") else "")),
            ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
        ]
        failed = [c for c in checks if not c[1]]
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "decision": "cancel" if failed else "send"}
        span.reasoning = [f"{'✓' if ok else '✗'} {d}" for _, ok, d in checks]
        span.edge_label = "cancelled" if failed else f"→ {doc['to_channel']}"

    if failed:
        reason = failed[0][2]
        await _close(db, doc, "cancelled", reason=reason)
        await tracer.skipped("send", f"Handoff check cancelled: {reason}.")
        await _log(db, tracer, "handoff_check_cancelled", {"followup_id": check_id, "reason": reason})
        return "cancelled"
    if deferred := await _defer_outside_contact_window(db, doc, tracer):
        return deferred

    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(doc["customer_id"])})
    draft = render_holding_reply("still_waiting", (customer or {}).get("name"))
    channel = doc["to_channel"]
    request = SendRequest(
        dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        turn_id=f"handoff-check-{check_id}", channel=channel,
        text=draft["sms_text"] if channel == "sms" else draft["email_body"],
        subject=None if channel == "sms" else draft["email_subject"],
    )
    async with tracer.node("send", {"channel": channel, "idempotency_key": request.idempotency_key,
                                    "text": request.text, "subject": request.subject}) as span:
        sent = await deps.sender.send(request)
        span.output = sent.as_dict()
        span.reasoning = sent.reasoning
        span.metrics = {"attempts": sent.attempts}
        span.edge_label = sent.status
    await tracer.skipped("schedule", "A handoff check happens once per handoff.")

    now = clock.now()
    delivered = sent.status in ("sent", "duplicate")
    alert = {"at": now, "reason": f"No staff response {HANDOFF_TIMEOUT_BUSINESS_MINUTES} business minutes after "
                                  f"the handoff", "handoff_reason": doc.get("handoff_reason"),
             "customer_notified": delivered}
    fields: dict[str, Any] = {"staff_alert": alert, "last_send_status": sent.status}
    if delivered:
        fields.update(last_handoff_notice_at=now, last_outbound_at=now)
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": doc["lead_id"]}, {"$set": fields})
    status = "sent" if delivered else sent.status
    await _close(db, doc, status, reason=sent.reason, sent_message_id=sent.message_id, fired_at=now)
    await _log(db, tracer, f"handoff_check_{status}",
               {"followup_id": check_id, "send_status": sent.status, "reply": request.text, "channel": channel,
                "staff_alert": alert["reason"]})
    return status


# --- Provider said the message failed -------------------------------------------

async def make_due_now(db: DealerScopedDatabase, *, lead_id: str, source_turn_id: str, from_channel: str,
                       reason: str) -> bool:
    """The original message failed to deliver: its follow-up fires now
    instead of in 24 hours (architecture §6 "Failed SMS")."""
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
        {"lead_id": lead_id, "source_turn_id": source_turn_id, "from_channel": from_channel, "status": "pending",
         **CHANNEL_SWITCHES},
        {"$set": {"due_at": clock.now(), "reason": reason}},
    )
    return result.modified_count == 1
