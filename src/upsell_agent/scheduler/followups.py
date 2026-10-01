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

**Three kinds** share this collection and its claim / fire machinery (`kind`):

- `channel_switch` (the default; older records have no `kind`): above.
- `handoff_check` (MASTER_PLAN_2 Phase 2, architecture §15 decision 12): 30
  business minutes after a lead is handed to a person. If staff still
  haven't taken it over, the customer gets one "still on it" holding reply and
  a staff alert is recorded on the lead. Once per handoff. A customer message
  doesn't cancel it; staff pausing or resuming the lead does.
- `resume_at_opening` (MASTER_PLAN_3 B1, agent/after_hours.py): the customer
  of an after-hours lead chose to have the team pick it up when the
  dealership opens. Due at the next opening (or later, when the send check
  holds it). Firing runs a whole AI turn (agent/turn.py, trigger
  `resume_at_opening`): the "the team is in now" message moves the
  conversation on, and the team gets a notice. Cancelled by staff taking
  over, and by the after-hours plan when the customer carries on first; a
  customer message alone doesn't cancel it (the plan decides).

**The send check** (MASTER_PLAN_3 C1, compliance/engine.py): both are
messages the system starts. The channel switch is marketing (consent, the
3-per-24h cap), the handoff check transactional. An SMS goes out only inside
the dealer's opening hours and the customer's own window (decisions 23-25).
The due time is planned with the check, and a follow-up whose time comes
outside it (a busy retry, a stuck claim, a clock move) goes back to pending
until the time the check gives. A REVIEW or BLOCK suppresses it.
"""

import asyncio
import contextlib
import logging
import os
import socket
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from datetime import date, datetime, time, timedelta
from typing import Any

from pymongo import ReturnDocument

from upsell_agent import clock
from upsell_agent.agent import lifecycle
from upsell_agent.agent.templates import (
    SOLD_VEHICLE_FALLBACK_SUBJECT,
    SOLD_VEHICLE_FALLBACK_TEXT,
    render_holding_reply,
)
from upsell_agent.channels.consent import resolve_recipient
from upsell_agent.channels.sender import SendOutcome, SendRequest
from upsell_agent.compliance.engine import can_contact
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
KIND_RESUME = "resume_at_opening"
# MASTER_PLAN_3 B4 item 4: the dated fresh visit offer after a 3rd decline.
KIND_VISIT_FOLLOWUP = "visit_followup"
TRIGGER_VISIT_FOLLOWUP = KIND_VISIT_FOLLOWUP
# MASTER_PLAN_3 C3 (Omnichannel PDF §6): the dated next step the customer asked for ("call me
# Friday"), and the check 24 hours after it went out: no reply moves the lead to No Contact Made.
KIND_NEXT_ACTION = "next_action"
KIND_NEXT_ACTION_CHECK = "next_action_check"
TRIGGER_NEXT_ACTION = KIND_NEXT_ACTION
NEXT_ACTION_REPLY_WINDOW = timedelta(hours=24)
# Matches channel switches, including records from before `kind` existed.
CHANNEL_SWITCHES = {"kind": {"$nin": [KIND_HANDOFF_CHECK, KIND_RESUME, KIND_VISIT_FOLLOWUP, KIND_NEXT_ACTION,
                                      KIND_NEXT_ACTION_CHECK]}}
HANDOFF_TIMEOUT_BUSINESS_MINUTES = 30
# The visit_followup fires at this dealer-local hour on its due date (B4 item 4's date, or +3 days).
VISIT_FOLLOWUP_HOUR = 10

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
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}, projection={"stage": 1})
    _, stage_ok, stage_detail = lifecycle.stage_check(state, KIND_CHANNEL_SWITCH)
    if not stage_ok:
        return {"created": False, "reason": stage_detail}

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

    now = clock.now()
    # A permanent send failure doesn't wait a day: try the other channel now
    # (architecture §6 "Failed SMS" - same rule at send time).
    wanted = now if sent.status == "failed" else now + FOLLOWUP_DELAY
    check = await can_contact(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id, channel=other,
                              purpose="marketing", is_reply=False, at=wanted, to=to, lead=lead, customer=customer,
                              record=False)
    if check.outcome in ("BLOCK", "REVIEW"):
        return {"created": False, "reason": f"{other}: {check.outcome} - {check.reason}", "send_check": check.as_dict()}
    profile = await dealer_profile(db.dealer_id)
    due_at = check.until if check.outcome == "HOLD" and check.until else wanted
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    superseded = await followups.update_many(
        {"lead_id": lead_id, "status": "pending", **CHANNEL_SWITCHES},
        {"$set": {"status": "superseded", "reason": "a newer message was sent", "closed_at": now}},
    )
    held = due_at > wanted
    reason = f"{channel} send failed: switching now" if sent.status == "failed" else None
    if held:
        reason = (reason + "; " if reason else "") + f"held by the send check: {check.reason}"
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
            "held_reason": check.reason if held else None, "timezone": profile.timezone}


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
    check = await can_contact(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id, channel=channel,
                              purpose="transactional", is_reply=False, at=after, record=False)
    due_at = check.until if check.outcome == "HOLD" and check.until else after
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    await followups.update_many(
        {"lead_id": lead_id, "status": "pending", "kind": KIND_HANDOFF_CHECK},
        {"$set": {"status": "superseded", "reason": "a newer handoff", "closed_at": now}})
    doc = {
        "kind": KIND_HANDOFF_CHECK, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": handoff_id,
        "handoff_id": handoff_id, "handoff_reason": handoff_reason, "from_channel": channel, "to_channel": channel,
        "text": None, "subject": None, "status": "pending", "due_at": due_at, "created_at": now, "claim_count": 0,
        "reason": f"held by the send check: {check.reason}" if due_at > after else None,
    }
    inserted = await followups.insert_one(doc)
    return {"created": True, "followup_id": str(inserted.inserted_id), "due_at": due_at.isoformat(),
            "business_minutes": HANDOFF_TIMEOUT_BUSINESS_MINUTES, "timezone": profile.timezone,
            "hours_from_record": profile.hours_from_record}


async def plan_resume(
    db: DealerScopedDatabase,
    *,
    lead_id: str,
    customer_id: str,
    channel: str,
    turn_id: str,
    lead: dict | None = None,
    customer: dict | None = None,
) -> dict[str, Any]:
    """The after-hours morning message (MASTER_PLAN_3 B1): due at the
    dealership's next opening, on the channel the customer used, and within
    the send check's rules (a message we start: the customer's own window too).
    Replaces any older pending one for the lead."""
    now = clock.now()
    profile = await dealer_profile(db.dealer_id)
    opens = profile.next_opening(now)
    if opens is None:
        return {"created": False, "reason": "No morning message: the dealer has no opening hours."}
    check = await can_contact(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id, channel=channel,
                              purpose="marketing", is_reply=False, at=opens, lead=lead, customer=customer,
                              record=False)
    if check.outcome in ("BLOCK", "REVIEW"):
        return {"created": False, "send_check": check.as_dict(),
                "reason": f"No morning message: the send check says {check.outcome} ({check.reason})."}
    due_at = check.until if check.outcome == "HOLD" and check.until else opens
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    await followups.update_many(
        {"lead_id": lead_id, "status": "pending", "kind": KIND_RESUME},
        {"$set": {"status": "superseded", "reason": "a newer morning message", "closed_at": now}})
    doc = {
        "kind": KIND_RESUME, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id,
        "from_channel": channel, "to_channel": channel, "text": None, "subject": None, "status": "pending",
        "due_at": due_at, "created_at": now, "claim_count": 0,
        "reason": f"held by the send check: {check.reason}" if due_at > opens else None,
    }
    inserted = await followups.insert_one(doc)
    local = due_at.astimezone(profile.tz).strftime("%a %H:%M %Z")
    return {"created": True, "followup_id": str(inserted.inserted_id), "due_at": due_at.isoformat(),
            "opens_at": opens.isoformat(), "timezone": profile.timezone,
            "reason": f"Morning message due {local}" + (
                f" (the dealership opens at {opens.astimezone(profile.tz):%H:%M}; held by the send check: "
                f"{check.reason})" if due_at > opens else ", when the dealership opens") + "."}


async def cancel_resume(db: DealerScopedDatabase, lead_id: str, *, reason: str) -> int:
    """The customer carried on before the dealership opened: no morning message."""
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "status": "pending", "kind": KIND_RESUME},
        {"$set": {"status": "cancelled", "reason": reason, "closed_at": clock.now()}})
    return result.modified_count


async def plan_visit_followup(
    db: DealerScopedDatabase,
    *,
    lead_id: str,
    customer_id: str,
    channel: str,
    turn_id: str,
    due_date: str,
    lead: dict | None = None,
    customer: dict | None = None,
) -> dict[str, Any]:
    """The dated fresh visit offer after a 3rd decline (MASTER_PLAN_3 B4 item
    4): due at VISIT_FOLLOWUP_HOUR dealer-local on `due_date` (the customer's
    own date, or +3 days, agent/visit_offer.py), within the send check's
    rules (marketing: dealer open and the customer's own window). Replaces
    any older pending one for the lead."""
    now = clock.now()
    profile = await dealer_profile(db.dealer_id)
    wanted = datetime.combine(date.fromisoformat(due_date), time(VISIT_FOLLOWUP_HOUR), tzinfo=profile.tz)
    wanted = max(wanted, now)
    check = await can_contact(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id, channel=channel,
                              purpose="marketing", is_reply=False, at=wanted, lead=lead, customer=customer,
                              record=False)
    if check.outcome in ("BLOCK", "REVIEW"):
        return {"created": False, "send_check": check.as_dict(),
                "reason": f"No visit follow-up: the send check says {check.outcome} ({check.reason})."}
    due_at = check.until if check.outcome == "HOLD" and check.until else wanted
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    await followups.update_many(
        {"lead_id": lead_id, "status": "pending", "kind": KIND_VISIT_FOLLOWUP},
        {"$set": {"status": "superseded", "reason": "a newer visit follow-up", "closed_at": now}})
    doc = {
        "kind": KIND_VISIT_FOLLOWUP, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id,
        "from_channel": channel, "to_channel": channel, "text": None, "subject": None, "status": "pending",
        "due_at": due_at, "created_at": now, "claim_count": 0,
        "reason": f"held by the send check: {check.reason}" if due_at > wanted else None,
    }
    inserted = await followups.insert_one(doc)
    local = due_at.astimezone(profile.tz).strftime("%a %H:%M %Z")
    return {"created": True, "followup_id": str(inserted.inserted_id), "due_at": due_at.isoformat(),
            "timezone": profile.timezone, "reason": f"Visit follow-up due {local}."}


async def plan_next_action(
    db: DealerScopedDatabase,
    *,
    lead_id: str,
    customer_id: str,
    channel: str,
    turn_id: str,
    next_action: dict[str, Any],
    lead: dict | None = None,
    customer: dict | None = None,
) -> dict[str, Any]:
    """The dated next step (MASTER_PLAN_3 C3, Omnichannel PDF §6): due on the
    customer's date at their time (else the dealer default), dealer-local,
    within the send check's rules (marketing: dealer open and the customer's
    own window). Replaces the lead's older pending next step and its check."""
    now = clock.now()
    profile = await dealer_profile(db.dealer_id)
    hour, minute = (int(x) for x in str(next_action.get("time") or "10:00").split(":")[:2])
    wanted = max(datetime.combine(date.fromisoformat(next_action["date"]), time(hour, minute), tzinfo=profile.tz),
                 now)
    check = await can_contact(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id, channel=channel,
                              purpose="marketing", is_reply=False, at=wanted, lead=lead, customer=customer,
                              record=False)
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    await followups.update_many(
        {"lead_id": lead_id, "status": "pending", "kind": {"$in": [KIND_NEXT_ACTION, KIND_NEXT_ACTION_CHECK]}},
        {"$set": {"status": "superseded", "reason": "a newer next step", "closed_at": now}})
    if check.outcome in ("BLOCK", "REVIEW"):
        return {"created": False, "send_check": check.as_dict(),
                "reason": f"No next step scheduled: the send check says {check.outcome} ({check.reason})."}
    due_at = check.until if check.outcome == "HOLD" and check.until else wanted
    doc = {
        "kind": KIND_NEXT_ACTION, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id,
        "from_channel": channel, "to_channel": channel, "text": None, "subject": None, "status": "pending",
        "due_at": due_at, "created_at": now, "claim_count": 0, "next_action": next_action,
        "reason": f"held by the send check: {check.reason}" if due_at > wanted else None,
    }
    inserted = await followups.insert_one(doc)
    local = due_at.astimezone(profile.tz).strftime("%a %b %d %H:%M %Z")
    return {"created": True, "followup_id": str(inserted.inserted_id), "due_at": due_at.isoformat(),
            "timezone": profile.timezone, "reason": f"Next step due {local}."}


async def cancel_visit_followup(db: DealerScopedDatabase, lead_id: str, *, reason: str) -> int:
    """A booking was made, or the lead is no longer active: the dated visit follow-up isn't needed."""
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "status": "pending", "kind": KIND_VISIT_FOLLOWUP},
        {"$set": {"status": "cancelled", "reason": reason, "closed_at": clock.now()}})
    return result.modified_count


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
        lifecycle.stage_check(state, doc.get("kind") or KIND_CHANNEL_SWITCH),
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
    fire_locked = {KIND_HANDOFF_CHECK: _fire_handoff_check_locked,
                   KIND_RESUME: _fire_resume_locked,
                   KIND_VISIT_FOLLOWUP: _fire_visit_followup_locked,
                   KIND_NEXT_ACTION: _fire_next_action_locked,
                   KIND_NEXT_ACTION_CHECK: _fire_next_action_check_locked}.get(doc.get("kind"), _fire_locked)
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

    text, subject, freshness = await _fresh_followup_text(db.dealer_id, doc)

    request = SendRequest(
        dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        turn_id=doc["source_turn_id"], channel=doc["to_channel"], text=text, subject=subject,
        is_fallback=True, purpose="marketing", is_reply=False,
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
    if sent.status == "held":
        return await _defer(db, doc, tracer, sent)
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


async def _defer(db: DealerScopedDatabase, doc: dict, tracer: TurnTracer, sent: SendOutcome) -> str:
    """The send check said HOLD (outside the customer's window or the
    dealer's hours, or the 3-per-24h cap): back to pending until the time it
    gave. The sender left its row `held`, so the retry resumes that row."""
    due_at = datetime.fromisoformat(sent.hold_until) if sent.hold_until else clock.now() + BUSY_RETRY_AFTER
    reason = f"held by the send check: {sent.reason}"
    await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
        {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
        {"$set": {"status": "pending", "due_at": due_at, "reason": reason}})
    await tracer.skipped("schedule", f"Not sent yet: {reason}.")
    kind = doc.get("kind") or KIND_CHANNEL_SWITCH
    await _log(db, tracer, {KIND_HANDOFF_CHECK: "handoff_check_deferred",
                            KIND_RESUME: "resume_deferred"}.get(kind, "followup_deferred"),
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
            lifecycle.stage_check(state, KIND_HANDOFF_CHECK),
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

    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(doc["customer_id"])})
    draft = render_holding_reply("still_waiting", (customer or {}).get("name"))
    channel = doc["to_channel"]
    request = SendRequest(
        dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        turn_id=f"handoff-check-{check_id}", channel=channel,
        text=draft["sms_text"] if channel == "sms" else draft["email_body"],
        subject=None if channel == "sms" else draft["email_subject"], purpose="transactional", is_reply=False,
    )
    async with tracer.node("send", {"channel": channel, "idempotency_key": request.idempotency_key,
                                    "text": request.text, "subject": request.subject}) as span:
        sent = await deps.sender.send(request)
        span.output = sent.as_dict()
        span.reasoning = sent.reasoning
        span.metrics = {"attempts": sent.attempts}
        span.edge_label = sent.status
    if sent.status == "held":
        return await _defer(db, doc, tracer, sent)
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


async def _fire_resume_locked(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """The dealership has opened (MASTER_PLAN_3 B1): if the lead is still
    waiting for the team and the send check allows it now, run the morning
    message's AI turn. Held → back to pending until the check's time."""
    from upsell_agent.agent.after_hours import TRIGGER_RESUME
    from upsell_agent.agent.turn import run_turn

    resume_id = str(doc["_id"])
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        trigger="resume_check", channel=doc["to_channel"], store_prompts=deps.store_prompts,
        turn_id=f"resume-check-{resume_id}-fire{int(doc.get('claim_count') or 1)}",
    )
    await tracer.start({"followup_id": resume_id, "channel": doc["to_channel"]})
    async with tracer.node("resume", {"followup_id": resume_id, "due_at": doc["due_at"],
                                      "channel": doc["to_channel"]}) as span:
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": doc["lead_id"]}) or {}
        status = state.get("status", "active")
        choice = ((state.get("conversation") or {}).get("after_hours") or {}).get("choice")
        mode = await dealer_ai_mode(db.dealer_id)
        checks = [
            ("still_waiting", choice == "later",
             "the customer is still waiting for the team" if choice == "later"
             else f"the after-hours choice is now {choice!r}"),
            ("lead_active", status not in SILENT_STATUSES,
             f"lead is {status}" + (f" ({state.get('status_reason')})" if state.get("status_reason") else "")),
            lifecycle.stage_check(state, KIND_RESUME),
            ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
        ]
        failed = [c for c in checks if not c[1]]
        check = None
        if not failed:
            check = await can_contact(dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=doc["lead_id"],
                                      channel=doc["to_channel"], purpose="marketing", is_reply=False, record=False)
            checks.append(("send_check", check.outcome == "ALLOW", check.summary()))
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "send_check": check.as_dict() if check else None,
                       "decision": "cancel" if failed else "run the turn" if check.outcome == "ALLOW"
                       else check.outcome.lower()}
        span.reasoning = [f"{'✓' if ok else '✗'} {d}" for _, ok, d in checks]
        span.edge_label = span.output["decision"]

    if failed:
        reason = failed[0][2]
        await _close(db, doc, "cancelled", reason=reason)
        await _log(db, tracer, "resume_cancelled", {"followup_id": resume_id, "reason": reason})
        return "cancelled"
    if check.outcome == "HOLD" and check.until:
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
            {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
            {"$set": {"status": "pending", "due_at": check.until, "reason": f"held by the send check: {check.reason}"}})
        await _log(db, tracer, "resume_deferred", {"followup_id": resume_id, "reason": check.reason,
                                                   "due_at": check.until.isoformat()})
        return "deferred"
    if check.outcome != "ALLOW":
        await _close(db, doc, "suppressed", reason=f"{check.outcome}: {check.reason}")
        await _log(db, tracer, "resume_suppressed", {"followup_id": resume_id, "reason": check.reason})
        return "suppressed"
    await _log(db, tracer, "resume_started", {"followup_id": resume_id})

    log = await run_turn(
        dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=doc["lead_id"], trigger=TRIGGER_RESUME,
        channel=doc["to_channel"], inbound_text="", shadow=False, deps=deps, turn_id=f"resume-{resume_id}",
        is_reply=False,
    )
    sent = log["summary"].get("send_status")
    if sent == "held":
        # The check changed between the look above and the send (a clock move, the cap).
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
            {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
            {"$set": {"status": "pending", "due_at": clock.now() + BUSY_RETRY_AFTER,
                      "reason": "held by the send check at send time; checking again"}})
        return "deferred"
    status = "sent" if sent in ("sent", "duplicate") else (sent or "failed")
    await _close(db, doc, status, reason=log["outcome"], fired_at=clock.now(), turn_id=log["turn_id"])
    return status


async def _fire_visit_followup_locked(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """The dated fresh visit offer (MASTER_PLAN_3 B4 item 4): if the lead is
    still active and has no booking yet, the visit-offer record is reset to
    a fresh attempt 1 and a whole AI turn runs, so it makes one new offer,
    within the send check's rules."""
    from upsell_agent.agent.turn import run_turn
    from upsell_agent.integrations.mongodb import PLATFORM_LEADS_COLLECTION, as_object_id
    from upsell_agent.tools.booking_tool import find_active_booking

    followup_id = str(doc["_id"])
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        trigger="visit_followup_check", channel=doc["to_channel"], store_prompts=deps.store_prompts,
        turn_id=f"visit-followup-check-{followup_id}-fire{int(doc.get('claim_count') or 1)}",
    )
    await tracer.start({"followup_id": followup_id, "channel": doc["to_channel"]})
    async with tracer.node("visit_followup", {"followup_id": followup_id, "due_at": doc["due_at"]}) as span:
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": doc["lead_id"]}) or {}
        status = state.get("status", "active")
        lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(doc["lead_id"])})
        active_booking = await find_active_booking(db.dealer_id, lead)
        mode = await dealer_ai_mode(db.dealer_id)
        checks = [
            ("lead_active", status not in SILENT_STATUSES, f"lead is {status}"),
            ("no_booking_yet", active_booking is None, "already booked" if active_booking else "no booking yet"),
            lifecycle.stage_check(state, KIND_VISIT_FOLLOWUP),
            ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
        ]
        failed = [c for c in checks if not c[1]]
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "decision": "cancel" if failed else "run the turn"}
        span.reasoning = [f"{'✓' if ok else '✗'} {d}" for _, ok, d in checks]
        span.edge_label = "cancelled" if failed else "run the turn"

    if failed:
        reason = failed[0][2]
        await _close(db, doc, "cancelled", reason=reason)
        await _log(db, tracer, "visit_followup_cancelled", {"followup_id": followup_id, "reason": reason})
        return "cancelled"

    # A fresh attempt 1 (agent/visit_offer.py): the customer asked to be offered again later.
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": doc["lead_id"]}, {"$unset": {"conversation.visit": ""}})
    await _log(db, tracer, "visit_followup_started", {"followup_id": followup_id})
    log = await run_turn(
        dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=doc["lead_id"],
        trigger=TRIGGER_VISIT_FOLLOWUP, channel=doc["to_channel"], inbound_text="", shadow=False, deps=deps,
        turn_id=f"visit-followup-{followup_id}", is_reply=False,
    )
    sent = log["summary"].get("send_status")
    if sent == "held":
        # The check changed between the look above and the send (a clock move, the cap).
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
            {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
            {"$set": {"status": "pending", "due_at": clock.now() + BUSY_RETRY_AFTER,
                      "reason": "held by the send check at send time; checking again"}})
        return "deferred"
    status = "sent" if sent in ("sent", "duplicate") else (sent or "failed")
    await _close(db, doc, status, reason=log["outcome"], fired_at=clock.now(), turn_id=log["turn_id"])
    return status


async def _fire_next_action_locked(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """The customer's dated next step is due (MASTER_PLAN_3 C3, Omnichannel PDF
    §6): if the lead is still waiting on it, run a whole AI turn that checks
    back as they asked (the appointment stays the goal: a fresh visit offer is
    allowed again), then plan the 24-hour check. A step kept past Day 91 (the
    long-horizon rule) still runs on the closed lead."""
    from upsell_agent.agent.turn import run_turn

    action_id = str(doc["_id"])
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        trigger="next_action_check_in", channel=doc["to_channel"], store_prompts=deps.store_prompts,
        turn_id=f"next-action-fire-{action_id}-fire{int(doc.get('claim_count') or 1)}",
    )
    await tracer.start({"followup_id": action_id, "channel": doc["to_channel"], "next_action": doc.get("next_action")})
    async with tracer.node("next_action", {"followup_id": action_id, "due_at": doc["due_at"],
                                           "next_action": doc.get("next_action")}) as span:
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": doc["lead_id"]}) or {}
        status = state.get("status", "active")
        planned = (state.get("next_action") or {}).get("date")
        mode = await dealer_ai_mode(db.dealer_id)
        long_horizon = bool(doc.get("long_horizon"))
        checks = [
            ("lead_active", status not in SILENT_STATUSES, f"lead is {status}"),
            lifecycle.stage_check(state, KIND_NEXT_ACTION, long_horizon=long_horizon),
            ("still_this_step", long_horizon or planned == (doc.get("next_action") or {}).get("date"),
             "the lead is still waiting on this next step" if long_horizon or planned == (doc.get("next_action")
                                                                                          or {}).get("date")
             else f"the next step changed since (now {planned})"),
            ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
        ]
        failed = [c for c in checks if not c[1]]
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "decision": "cancel" if failed else "run the turn"}
        span.reasoning = [f"{'✓' if ok else '✗'} {d}" for _, ok, d in checks]
        span.edge_label = "cancelled" if failed else "run the turn"

    if failed:
        reason = failed[0][2]
        await _close(db, doc, "cancelled", reason=reason)
        await _log(db, tracer, "next_action_cancelled", {"followup_id": action_id, "reason": reason})
        return "cancelled"

    # A fresh visit offer is allowed again: the customer asked us to come back to them now.
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": doc["lead_id"]}, {"$unset": {"conversation.visit": ""}})
    await _log(db, tracer, "next_action_started", {"followup_id": action_id})
    log = await run_turn(
        dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=doc["lead_id"],
        trigger=TRIGGER_NEXT_ACTION, channel=doc["to_channel"], inbound_text="", shadow=False, deps=deps,
        turn_id=f"next-action-{action_id}", is_reply=False,
    )
    sent = log["summary"].get("send_status")
    if sent == "held":
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
            {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
            {"$set": {"status": "pending", "due_at": clock.now() + BUSY_RETRY_AFTER,
                      "reason": "held by the send check at send time; checking again"}})
        return "deferred"
    status = "sent" if sent in ("sent", "duplicate") else (sent or "failed")
    await _close(db, doc, status, reason=log["outcome"], fired_at=clock.now(), turn_id=log["turn_id"])
    planned = doc.get("next_action") or {}
    if planned.get("call_requested"):
        # The customer asked for a call on this date. Staff call tasks (C2) are skipped for now, so the
        # team gets a notice instead; the AI's text/email above covers the rest of the touch.
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": doc["lead_id"]}, {"$set": {
            "staff_notice": {"at": clock.now(), "kind": "call_requested",
                             "text": f"The customer asked to be called {planned.get('words')!r} - that's today. "
                                     f"{planned.get('context_notes') or ''}".strip()}}})
    if status == "sent":
        now = clock.now()
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).insert_one({
            "kind": KIND_NEXT_ACTION_CHECK, "lead_id": doc["lead_id"], "customer_id": doc["customer_id"],
            "source_turn_id": log["turn_id"], "from_channel": doc["to_channel"], "to_channel": doc["to_channel"],
            "text": None, "subject": None, "status": "pending", "due_at": now + NEXT_ACTION_REPLY_WINDOW,
            "created_at": now, "claim_count": 0, "next_action": doc.get("next_action"),
            "long_horizon": doc.get("long_horizon", False), "reason": None})
    return status


async def _fire_next_action_check_locked(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """24 hours after the next step went out (Omnichannel PDF §6): no reply
    from the customer since → No Contact Made (back into Short-Term
    follow-up). Sends nothing itself."""
    check_id = str(doc["_id"])
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        trigger="next_action_reply_check", channel=doc["to_channel"], store_prompts=deps.store_prompts,
        turn_id=f"next-action-check-{check_id}-fire{int(doc.get('claim_count') or 1)}",
    )
    await tracer.start({"followup_id": check_id})
    async with tracer.node("next_action_check", {"followup_id": check_id, "due_at": doc["due_at"]}) as span:
        replied = await db.collection(AI_MESSAGES_COLLECTION).find(
            {"lead_id": doc["lead_id"], "direction": "inbound", "created_at": {"$gt": doc["created_at"]}}
        ).to_list(1)
        if replied:
            span.output = {"decision": "nothing to do", "replied": True}
            span.reasoning = ["✓ The customer replied after the next step: the reply already moved the lead on."]
            span.edge_label = "replied"
        else:
            moved = await lifecycle.apply(db, doc["lead_id"], [lifecycle.Event(
                "specific_followup_unanswered", source="next_action_check",
                reason="No reply within 24 hours of the scheduled follow-up")])
            span.output = {"decision": "no reply", "lifecycle": moved}
            span.reasoning = ["✗ No reply within 24 hours of the next step: " + (
                f"the lead moves to {lifecycle.label(moved.get('stage'))}." if moved and moved.get("changed")
                else f"no change ({(moved or {}).get('reason')}).")]
            span.edge_label = "no contact made" if moved and moved.get("changed") else "no change"
    await _close(db, doc, "done", reason="customer replied" if replied else "no reply in 24 hours",
                 fired_at=clock.now())
    await _log(db, tracer, "next_action_check_done", {"followup_id": check_id, "replied": bool(replied)})
    return "done"


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
