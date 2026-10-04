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
from upsell_agent.agent import appointment, cadence, call_tasks, lifecycle
from upsell_agent.agent.templates import (
    SOLD_VEHICLE_FALLBACK_SUBJECT,
    SOLD_VEHICLE_FALLBACK_TEXT,
    render_holding_reply,
)
from upsell_agent.agent.vehicle_media import lead_vehicle_vin, pick_vehicle_photo
from upsell_agent.channels import consent
from upsell_agent.channels.consent import usable_recipient
from upsell_agent.channels.sender import SendOutcome, SendRequest
from upsell_agent.compliance.call_check import can_call
from upsell_agent.compliance.engine import can_contact
from upsell_agent.config import get_settings
from upsell_agent.integrations.dealer_mode import dealer_ai_mode
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.learning import optimizer, touches
from upsell_agent.observability.trace import TurnTracer
from upsell_agent.scheduler.contact_window import (
    add_business_minutes,
)
from upsell_agent.tools.inventory_tool import find_sold, get_inventory_source
from upsell_agent.worker.locks import Busy

logger = logging.getLogger(__name__)

FOLLOWUP_DELAY = timedelta(hours=24)
STUCK_CLAIM_AFTER = timedelta(minutes=5)
# A follow-up whose lead is busy (a turn is running) is retried this much later: the worker queues its own
# fire_due_followups run for then (worker/jobs.py), so it never waits for the next minute's cron (stream S).
BUSY_RETRY_AFTER = timedelta(seconds=5)
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
# MASTER_PLAN_3 C4 (Omnichannel PDF §3-§4): the Short-Term / extended cadence touch. One touch at a
# time per lead; it goes out on text AND email together (agent/cadence.py), replacing Plan 1's
# one-channel 24h switch for any lead whose cadence is running (decision 147).
KIND_CADENCE_TOUCH = "cadence_touch"
TRIGGER_CADENCE_TOUCH = KIND_CADENCE_TOUCH
TRIGGER_NEXT_ACTION = KIND_NEXT_ACTION
NEXT_ACTION_REPLY_WINDOW = timedelta(hours=24)
# MASTER_PLAN_3 C5 (Omnichannel PDF §7-§9): the appointment's own messages (agent/appointment.py), one scheduled
# record per step. `step` says which.
APPOINTMENT_STEPS = (appointment.STEP_DETAILS, appointment.STEP_CONFIRM, appointment.STEP_COUNTDOWN, appointment.STEP_NO_SHOW_CHECK,
                     appointment.STEP_NO_SHOW_FOLLOWUP, appointment.STEP_NO_SHOW_CLOSE)
APPOINTMENT_KINDS = tuple(appointment.KIND_PREFIX + s for s in APPOINTMENT_STEPS)
TRIGGER_APPOINTMENT = "appointment_step"
# MASTER_PLAN_3 C2 (Omnichannel PDF §2): the staff call task behind the 60-minute connection timer
# (agent/call_tasks.py). It opens for staff only if nobody has made contact by then.
KIND_CALL_TASK = "call_task"
# MASTER_PLAN_4 (stream A3, scheduler/sold_lifecycles.py): the SOLD PENDING touch and the ownership lifecycle's
# messages. Kept in step with sold_lifecycles.LIFECYCLE_KINDS (a unit test checks it).
SOLD_LIFECYCLE_KINDS = ("sold_pending_touch", "post_delivery_checkin", "ownership_anniversary", "birthday",
                        "service_outreach")
# PLAN_4 stream T: the Days 1-7 morning / afternoon call tasks (scheduler/daily_call_tasks.py KIND).
KIND_DAILY_CALL_TASK = "daily_call_task"
# Matches channel switches, including records from before `kind` existed.
CHANNEL_SWITCHES = {"kind": {"$nin": [KIND_HANDOFF_CHECK, KIND_RESUME, KIND_VISIT_FOLLOWUP, KIND_NEXT_ACTION,
                                      KIND_NEXT_ACTION_CHECK, KIND_CADENCE_TOUCH, KIND_CALL_TASK,
                                      KIND_DAILY_CALL_TASK, *APPOINTMENT_KINDS, *SOLD_LIFECYCLE_KINDS]}}
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
    standby: bool = False,
) -> dict[str, Any]:
    """`standby`: MASTER_PLAN_3 C4 (decision 154). With the cadence running, the 24h switch is no longer
    the follow-up (the cadence is), but a message that fails to deliver still falls back to the other
    channel at once. So the other-channel version is stored dormant (status `standby`, never claimed by
    the scheduler) and only `make_due_now` wakes it, when the provider reports the failure.

    Saves the follow-up for a message a turn just sent. Returns what
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

    to = await usable_recipient(db, lead, customer, other)
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
        {"lead_id": lead_id, "status": {"$in": ["pending", "standby"]}, **CHANNEL_SWITCHES},
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
        "status": "standby" if standby else "pending", "due_at": due_at, "created_at": now, "claim_count": 0,
        "reason": reason or ("standby: sent only if this message fails to deliver" if standby else None),
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


async def _permitted_channel(*, dealer_id: str, customer_id: str, lead_id: str, channel: str, at: datetime | None,
                             lead: dict | None = None, customer: dict | None = None, purpose: str = "marketing"):
    """The send check for a cadence touch, which goes out on text AND email together (MASTER_PLAN_3 C4,
    Omnichannel PDF p.10). Returns (the channel to lead with, the check that decides when).

    - A channel that is BLOCKed or under REVIEW (opted out, unsubscribed, no consent) is left out and the
      other carries on alone: "continue every remaining permitted channel".
    - A channel that is only HELD (the dealer is shut, the customer's window is closed) isn't dropped: the
      whole touch waits until every channel left can go, so the text and the email arrive together instead
      of the email alone now and the text lost.
    - With both blocked, the preferred channel's BLOCK / REVIEW comes back and nothing is sent.
    Each channel is checked again when it is actually sent."""
    other = other_channel(channel)
    checks: list[tuple[str, Any]] = []
    for ch in (channel, other):
        check = await can_contact(dealer_id=dealer_id, customer_id=customer_id, lead_id=lead_id, channel=ch,
                                  purpose=purpose, is_reply=False, at=at, lead=lead, customer=customer,
                                  record=False)
        checks.append((ch, check))
    usable = [(ch, c) for ch, c in checks if c.outcome in ("ALLOW", "HOLD")]
    if not usable:
        return checks[0]
    holds = [(ch, c) for ch, c in usable if c.outcome == "HOLD" and c.until]
    if holds:
        return usable[0][0], max((c for _, c in holds), key=lambda c: c.until)
    return usable[0]


async def plan_cadence_touch(
    db: DealerScopedDatabase,
    *,
    lead_id: str,
    customer_id: str,
    channel: str,
    turn_id: str,
    lead: dict | None = None,
    customer: dict | None = None,
    lead_state: dict | None = None,
    first_contact_done: bool | None = None,
) -> dict[str, Any]:
    """The next Short-Term / extended cadence touch (MASTER_PLAN_3 C4,
    agent/cadence.py). One pending touch per lead: an older one is superseded,
    so a customer reply (which plans a fresh one) never leaves a stale touch
    queued. The due time goes through the send check like every message the
    system starts; a BLOCK or REVIEW means no touch is scheduled at all."""
    now = clock.now()
    profile = await dealer_profile(db.dealer_id)
    state = lead_state if lead_state is not None else await db.collection(AI_LEAD_STATE_COLLECTION).find_one(
        {"lead_id": lead_id})
    cadence_state = cadence.CadenceState.load(state)
    if cadence_state.started_at is None:
        return {"created": False, "reason": "No cadence touch: this lead's cadence hasn't started."}
    _, stage_ok, stage_detail = lifecycle.stage_check(state, KIND_CADENCE_TOUCH)
    if not stage_ok:
        return {"created": False, "reason": f"No cadence touch: {stage_detail}."}
    # PLAN_4 stream T: the Days 1-7 human call tasks start (and restart) with the cadence. Idempotent.
    from upsell_agent.scheduler import daily_call_tasks
    await daily_call_tasks.plan(db, lead_id=lead_id, customer_id=customer_id, lead_state=state)
    planned = cadence.plan_touch(
        cadence_state, now=now, tz=profile.tz,
        # The caller knows whether the message it just sent went out; the lead's own record is only
        # updated after this runs (agent/turn.py).
        first_contact_done=(bool((state or {}).get("last_outbound_at")) if first_contact_done is None
                            else first_contact_done))
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    await followups.update_many(
        {"lead_id": lead_id, "status": "pending", "kind": KIND_CADENCE_TOUCH},
        {"$set": {"status": "superseded", "reason": "a newer cadence touch", "closed_at": now}})
    if not planned.scheduled:
        return {"created": False, "reason": f"No cadence touch: {planned.why}", "plan": planned.as_dict()}
    # PLAN_4 stream L: the learned angle (Days 8-90), wording variant and send time (learning/optimizer.py).
    planned, touch = await optimizer.plan(db, planned, lead_id=lead_id, state=cadence_state, lead=lead,
                                          lead_state=state, tz=profile.tz, now=now)
    channel, check = await _permitted_channel(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id,
                                              channel=channel, at=planned.due_at, lead=lead, customer=customer)
    if check.outcome in ("BLOCK", "REVIEW"):
        return {"created": False, "send_check": check.as_dict(), "plan": planned.as_dict(),
                "reason": f"No cadence touch: neither channel is allowed ({check.outcome}: {check.reason})."}
    due_at = check.until if check.outcome == "HOLD" and check.until else planned.due_at
    doc = {
        "kind": KIND_CADENCE_TOUCH, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id,
        "from_channel": channel, "to_channel": channel, "text": None, "subject": None, "status": "pending",
        "due_at": due_at, "created_at": now, "claim_count": 0, "touch": touch,
        "reason": f"held by the send check: {check.reason}" if due_at > planned.due_at else None,
    }
    inserted = await followups.insert_one(doc)
    local = due_at.astimezone(profile.tz).strftime("%a %b %d %H:%M %Z")
    return {"created": True, "followup_id": str(inserted.inserted_id), "due_at": due_at.isoformat(),
            "timezone": profile.timezone, "plan": touch,
            "reason": f"{planned.why} Due {local}."}


async def plan_appointment_timers(
    db: DealerScopedDatabase,
    *,
    lead_id: str,
    customer_id: str,
    lead: dict | None = None,
    customer: dict | None = None,
    channel: str = "sms",
    turn_id: str,
    appointment_hint: dict | None = None,
) -> dict[str, Any]:
    """The appointment's messages (MASTER_PLAN_3 C5): the daily countdown, the day-before confirmation and the
    +1h no-show check, timed from the appointment itself. Called whenever an appointment is set or moved: the
    older steps are superseded, so an old confirmation or no-show timer can never fire for a time that no longer
    stands ("Rescheduled/old appointment cannot create a false No Show", §8, §16). Each step goes through the
    send check for its due time (transactional: a confirmation is operational, not marketing, §4)."""
    from upsell_agent.tools import booking_tool

    now = clock.now()
    profile = await dealer_profile(db.dealer_id)
    # Always re-read: the lead the turn loaded predates the booking it just made.
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)}) or lead
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}
    booking = await booking_tool.find_active_booking(db.dealer_id, lead)
    appt_at = appointment.appointment_at(tz=profile.tz, booking=booking, lead=lead,
                                         recorded=appointment_hint or state.get("appointment"))
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    await followups.update_many(
        {"lead_id": lead_id, "status": "pending", "kind": {"$in": list(APPOINTMENT_KINDS)}},
        {"$set": {"status": "superseded", "reason": "the appointment changed", "closed_at": now}})
    if appt_at is None:
        return {"created": 0, "reason": "No appointment time on record: nothing to schedule."}
    steps = appointment.plan_steps(appt_at, now=now, tz=profile.tz)
    # Stream X2: an appointment already confirmed (the customer's Y, or staff in the CRM) for this same time keeps
    # its confirmation and gets no day-before Y / N; a move to a new time asks again.
    recorded = state.get("appointment") or {}
    confirmed = bool(recorded.get("confirmed")) and recorded.get("at") == appt_at.isoformat()
    if confirmed:
        steps = [s for s in steps if s.step != appointment.STEP_CONFIRM]
    # MASTER_PLAN_4 (stream R): the 15-minute details message, once per appointment time - a re-plan for the same
    # time (staff saving the status again) doesn't send it twice; a move sends it for the new time.
    details_sent_for = state.get("appointment_details_sent_for")  # outside `appointment`, which a new set replaces
    details = appointment.details_step(appt_at, now=now) if details_sent_for != appt_at.isoformat() else None
    if details:
        steps = sorted([details, *steps], key=lambda s: s.due_at)
    booking_id = str(booking["_id"]) if booking else (state.get("appointment") or {}).get("booking_id")
    created, skipped = [], []
    for step in steps:
        ch, check = await _permitted_channel(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id,
                                             channel=channel, at=step.due_at, lead=lead, customer=customer,
                                             purpose="transactional")
        if check.outcome in ("BLOCK", "REVIEW"):
            skipped.append({**step.as_dict(), "why": f"neither channel is allowed ({check.outcome}: {check.reason})"})
            continue
        due_at = check.until if check.outcome == "HOLD" and check.until else step.due_at
        doc = {
            "kind": step.kind, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id,
            "from_channel": ch, "to_channel": ch, "text": None, "subject": None, "status": "pending",
            "due_at": due_at, "created_at": now, "claim_count": 0, "step": step.step,
            "appointment_at": appt_at.isoformat(), "booking_id": booking_id,
            "reason": f"held by the send check: {check.reason}" if due_at > step.due_at else None,
        }
        inserted = await followups.insert_one(doc)
        created.append({**step.as_dict(), "due_at": due_at.isoformat(), "followup_id": str(inserted.inserted_id)})
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$set": {"appointment.at": appt_at.isoformat(), "appointment.booking_id": booking_id,
                  "appointment.planned_at": now,
                  **({} if confirmed else {"appointment.confirmed": False, "appointment.confirmation": None})}})
    return {"created": len(created), "steps": created, "skipped": skipped, "appointment_at": appt_at.isoformat(),
            "reason": f"{len(created)} appointment step(s) planned for {appt_at:%a %b %d %H:%M}."}


async def plan_call_task(db: DealerScopedDatabase, *, lead_id: str, customer_id: str, turn_id: str,
                         lead: dict | None, customer: dict | None, lead_state: dict | None,
                         sent_channels: list[str]) -> dict[str, Any]:
    """MASTER_PLAN_3 C2: a touch just went out on `sent_channels`; start the 60-minute connection timer
    behind which the staff call task waits. A newer touch replaces an older waiting timer; a task already
    open for staff is not doubled."""
    stage = (lead_state or {}).get("stage")
    if not lifecycle.kind_allowed(KIND_CALL_TASK, stage):
        return {"created": False, "reason": f"no call task at stage {stage}"}
    if await db.collection(AI_CALL_TASKS_COLLECTION).find_one({"lead_id": lead_id, "status": call_tasks.OPEN}):
        return {"created": False, "reason": "a call task is already open for staff"}
    if await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find_one(
            {"lead_id": lead_id, "kind": KIND_CALL_TASK, "status": "pending", "requested": True}):
        return {"created": False, "reason": "the customer's own call request is already waiting for calling hours"}
    phone = await usable_recipient(db, lead, customer, "sms")
    if not phone:
        return {"created": False, "reason": "no valid phone to call"}
    now = clock.now()
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    superseded = await followups.update_many(
        {"lead_id": lead_id, "kind": KIND_CALL_TASK, "status": {"$in": ["pending", "standby"]}},
        {"$set": {"status": "superseded", "reason": "a newer touch went out", "closed_at": now}})
    due = now + call_tasks.CONNECTION_WINDOW
    inserted = await followups.insert_one({
        "kind": KIND_CALL_TASK, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id,
        "from_channel": sent_channels[0] if sent_channels else "sms", "to_channel": "voice", "to": phone,
        "sent_channels": sent_channels, "status": "pending", "due_at": due, "created_at": now, "claim_count": 0,
        "reason": f"60-minute connection timer: call {phone} if no contact"})
    return {"created": True, "followup_id": str(inserted.inserted_id), "due_at": due.isoformat(), "phone": phone,
            "superseded": superseded.modified_count}


async def cancel_call_task(db: DealerScopedDatabase, lead_id: str, *, reason: str, include_open: bool = False,
                           keep_requested: bool = False) -> int:
    """Contact happened: the waiting timer is cancelled (and, with `include_open`, a task already shown to staff).
    `keep_requested` (PLAN_4 stream H): a call the customer asked for is kept - waiting or open."""
    keep = {"requested": {"$ne": True}} if keep_requested else {}
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "kind": KIND_CALL_TASK, "status": {"$in": ["pending", "standby"]}, **keep},
        {"$set": {"status": "cancelled", "reason": reason, "closed_at": clock.now()}})
    count = result.modified_count
    if include_open:
        count += await call_tasks.cancel_open(db, lead_id, reason, keep_requested=keep_requested)
    # PLAN_4 stream T: this half-day's waiting Days 1-7 call task goes too (later half-days stay planned).
    from upsell_agent.scheduler import daily_call_tasks
    await daily_call_tasks.cancel_current(db, lead_id, reason=reason)
    return count


async def cancel_cadence_touch(db: DealerScopedDatabase, lead_id: str, *, reason: str) -> int:
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "status": "pending", "kind": KIND_CADENCE_TOUCH},
        {"$set": {"status": "cancelled", "reason": reason, "closed_at": clock.now()}})
    return result.modified_count


async def cancel_visit_followup(db: DealerScopedDatabase, lead_id: str, *, reason: str) -> int:
    """A booking was made, or the lead is no longer active: the dated visit follow-up isn't needed."""
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "status": "pending", "kind": KIND_VISIT_FOLLOWUP},
        {"$set": {"status": "cancelled", "reason": reason, "closed_at": clock.now()}})
    return result.modified_count


async def replan_workflow(db: DealerScopedDatabase, lead_id: str, *, reason: str) -> dict[str, Any]:
    """PLAN_4 stream X2 (audit 1 blocker): the AI has the lead again (staff resumed it after a pause, which cancelled
    the lead's pending work). Re-plans what the lead's CURRENT stage runs, without touching the stage or the Day 91
    clock (no lifecycle.apply):

    - Short-Term / extended: the cadence continues from where it was (`cadence` state kept: touch number, themes,
      last touch - so no second touch on a day that already had one, agent/cadence.py). A pending name nudge is
      skipped: a person has been talking to the customer. The Days 1-7 call tasks restart with it.
    - Specific Follow-Up: the customer's dated next step, re-planned from `next_action` (due now if its date passed).
    - Appointment Set: the appointment's steps from now (a confirmed appointment keeps its confirmation).
    - Appointment No Show: the next no-show step (the +24h message if it never went, else the close).
    - Sold Pending / Sold - Delivered: their touches survive a pause; re-planned only if none is pending.
    Idempotent: each planner supersedes its own older pending record."""
    from upsell_agent.scheduler import sold_lifecycles

    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}
    stage = lifecycle.stage_of(state.get("stage"))
    customer_id = str(state.get("customer_id") or "") or None
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
    customer_id = customer_id or (str(lead["customer_id"]) if (lead or {}).get("customer_id") else None)
    out: dict[str, Any] = {"stage": stage.value if stage else None}
    if stage is None or not customer_id:
        return {**out, "replanned": False, "reason": "no stage or no customer on the lead"}
    channel = ((lead or {}).get("data") or {}).get("channel") or "sms"
    channel = "email" if channel == "email" else "sms"
    turn_id = f"replan-{lead_id}-{int(clock.now().timestamp())}"
    pending = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    S = lifecycle.Stage
    if stage in lifecycle.SHORT_TERM:
        cad = cadence.CadenceState.load(state)
        if cad.started_at is not None and cad.touch_number <= 2 and state.get("last_outbound_at"):
            # The name nudge is for a customer nobody has spoken to; staff just have.
            cad = cadence.after_reply(cad)
            await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id},
                                                                     {"$set": {"cadence": cad.as_dict()}})
            state = {**state, "cadence": cad.as_dict()}
        out["cadence_touch"] = await plan_cadence_touch(
            db, lead_id=lead_id, customer_id=customer_id, channel=channel, turn_id=turn_id, lead=lead,
            lead_state=state, first_contact_done=bool(state.get("last_outbound_at")))
    elif stage == S.SPECIFIC_FOLLOWUP and (state.get("next_action") or {}).get("date"):
        if not await pending.find_one({"lead_id": lead_id, "status": "pending",
                                       "kind": {"$in": [KIND_NEXT_ACTION, KIND_NEXT_ACTION_CHECK]}}):
            na = {k: v for k, v in state["next_action"].items() if k != "entered_at"}
            out["next_action"] = await plan_next_action(
                db, lead_id=lead_id, customer_id=customer_id, channel=na.get("channel") or channel,
                turn_id=turn_id, next_action=na, lead=lead)
    elif stage == S.APPOINTMENT_SET:
        out["appointment_timers"] = await plan_appointment_timers(
            db, lead_id=lead_id, customer_id=customer_id, lead=lead, channel=channel, turn_id=turn_id)
    elif stage == S.NO_SHOW:
        if not await pending.find_one({"lead_id": lead_id, "status": "pending",
                                       "kind": {"$in": list(APPOINTMENT_KINDS)}}):
            followup_sent = await pending.find_one({"lead_id": lead_id, "status": "sent",
                                                    "kind": appointment.KIND_PREFIX + appointment.STEP_NO_SHOW_FOLLOWUP})
            appt = state.get("appointment") or {}
            base = {"lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id, "to_channel": channel,
                    "appointment_at": appt.get("at"), "booking_id": appt.get("booking_id")}
            step = appointment.STEP_NO_SHOW_CLOSE if followup_sent else appointment.STEP_NO_SHOW_FOLLOWUP
            await _plan_no_show_step(db, base, step,
                                     appointment.NO_SHOW_CLOSE_AFTER if followup_sent else timedelta(0))
            out["no_show_step"] = step
    elif stage in (S.SOLD_PENDING, S.SOLD_DELIVERED):
        if not await pending.find_one({"lead_id": lead_id, "status": "pending",
                                       "kind": {"$in": list(SOLD_LIFECYCLE_KINDS)}}):
            if stage == S.SOLD_PENDING:
                out["sold_pending_touch"] = await sold_lifecycles.plan_sold_pending_touch(
                    db, lead_id=lead_id, customer_id=customer_id, lead=lead)
            else:
                out["ownership"] = await sold_lifecycles.start_ownership(db, lead_id=lead_id, customer_id=customer_id,
                                                                         lead=lead)
    return {**out, "replanned": True, "reason": reason}


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
    # PLAN_4 stream T: call tasks past their window / the agent's day are marked missed first, so a new
    # half-day's task never meets a stale open one.
    if missed := await call_tasks.mark_missed():
        summary["missed_call_tasks"] = missed
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
    fire_locked = {**{kind: _fire_appointment_locked for kind in APPOINTMENT_KINDS},
                   KIND_HANDOFF_CHECK: _fire_handoff_check_locked,
                   KIND_RESUME: _fire_resume_locked,
                   KIND_VISIT_FOLLOWUP: _fire_visit_followup_locked,
                   KIND_NEXT_ACTION: _fire_next_action_locked,
                   KIND_NEXT_ACTION_CHECK: _fire_next_action_check_locked,
                   KIND_CADENCE_TOUCH: _fire_cadence_touch_locked,
                   KIND_CALL_TASK: _fire_call_task_locked}.get(doc.get("kind"), _fire_locked)
    if doc.get("kind") == KIND_DAILY_CALL_TASK:
        from upsell_agent.scheduler import daily_call_tasks  # PLAN_4 stream T
        fire_locked = daily_call_tasks.fire
    if doc.get("kind") in SOLD_LIFECYCLE_KINDS:
        # MASTER_PLAN_4 (stream A3): SOLD PENDING and the ownership lifecycle fire from their own module.
        from upsell_agent.scheduler import sold_lifecycles
        fire_locked = sold_lifecycles.fire
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
        # The customer asked for a call on this date: the team gets a notice now, on top of the 60-minute
        # call-task timer the check-back's text + email started (agent/turn.py CALL_TASK_TRIGGERS). A customer
        # who has since said "don't call me" gets no call request: staff see "do not call" (decision 144).
        no_calls = await consent.is_opted_out(db, doc["customer_id"], "voice")
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": doc["lead_id"]}, {"$set": {
            "staff_notice": {"at": clock.now(), "kind": "do_not_call" if no_calls else "call_requested",
                             "text": (f"The customer asked to be called {planned.get('words')!r}, but has since "
                                      "opted out of calls: do not call." if no_calls else
                                      f"The customer asked to be called {planned.get('words')!r} - that's today. "
                                      f"{planned.get('context_notes') or ''}".strip())}}})
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
            if moved and moved.get("cadence_started"):
                # Back into Short-Term follow-up (Omnichannel PDF §6): a fresh cadence starts, first touch planned.
                customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one(
                    {"_id": as_object_id(doc["customer_id"])})
                lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(doc["lead_id"])})
                moved["cadence_touch"] = await plan_cadence_touch(
                    db, lead_id=doc["lead_id"], customer_id=doc["customer_id"], channel=doc["to_channel"],
                    turn_id=f"next-action-check-{check_id}", lead=lead, customer=customer, first_contact_done=True)
            span.output = {"decision": "no reply", "lifecycle": moved}
            span.reasoning = ["✗ No reply within 24 hours of the next step: " + (
                f"the lead moves to {lifecycle.label(moved.get('stage'))}." if moved and moved.get("changed")
                else f"no change ({(moved or {}).get('reason')}).")]
            span.edge_label = "no contact made" if moved and moved.get("changed") else "no change"
    await _close(db, doc, "done", reason="customer replied" if replied else "no reply in 24 hours",
                 fired_at=clock.now())
    await _log(db, tracer, "next_action_check_done", {"followup_id": check_id, "replied": bool(replied)})
    return "done"


async def _send_step_messages(db: DealerScopedDatabase, deps: Any, tracer: TurnTracer, doc: dict,
                              text: dict[str, str], photo_vin: str | None = None,
                              photo_start: int = 0) -> list[SendOutcome]:
    """One appointment step on text AND email (Omnichannel PDF p.10). Each channel is its own send with its own
    check, so one opted out never stops the other. The idempotency key carries the step's record id and the
    channel, so a re-run can't send either twice. `photo_vin` (MASTER_PLAN_4 F3): the vehicle whose own photo
    goes with it - the countdown and no-show step 1 call for one; `photo_start` picks which of its photos."""
    outcomes: list[SendOutcome] = []
    first = doc["to_channel"]
    for ch in (first, other_channel(first)):
        body = text["sms_text"] if ch == "sms" else text["email_body"]
        photo = (await pick_vehicle_photo(db.dealer_id, photo_vin, channel=ch, settings=get_settings(),
                                          start=photo_start) if photo_vin else None)
        request = SendRequest(
            dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
            turn_id=f"appointment-{doc['step']}-{doc['_id']}", channel=ch, text=body,
            subject=None if ch == "sms" else text["email_subject"], purpose="transactional", is_reply=False,
            media_urls=photo.urls if photo else [])
        async with tracer.node(f"send_{ch}", {"channel": ch, "idempotency_key": request.idempotency_key,
                                              "text": request.text, "subject": request.subject,
                                              "media_urls": request.media_urls}) as span:
            outcome = await deps.sender.send(request)
            span.output = {**outcome.as_dict(), **({"photo": photo.as_dict()} if photo else {})}
            span.reasoning = [*(photo.reasons if photo else []), *outcome.reasoning]
            span.edge_label = f"{ch}: {outcome.status}"
        outcomes.append(outcome)
    # PLAN_4 stream L: the appointment step is a touch (learning/touches.py).
    await touches.record_touch(db, touch_id=f"appointment-{doc['step']}-{doc['_id']}", lead_id=doc["lead_id"],
                               customer_id=doc["customer_id"], kind="appointment", outcomes=outcomes,
                               theme=doc["step"], theme_label=f"Appointment: {doc['step'].replace('_', ' ')}")
    return outcomes


def stage_of_state(state: dict | None) -> lifecycle.Stage | None:
    return lifecycle.stage_of((state or {}).get("stage"))


async def appointment_cancelled_on_platform(db: DealerScopedDatabase, *, lead_id: str, customer_id: str,
                                            lead: dict | None, customer: dict | None, channel: str | None,
                                            turn_id: str, source: str = "appointment_timer") -> dict[str, Any] | None:
    """Staff cancelled the booking on the CRM's booking screen (stream F): the appointment's other steps are
    stale, and the lead goes where a cancellation without a new time goes (Omnichannel PDF §15: "route to
    Contact Made - No Next Action"), back into the Short-Term cadence. Called when a step falls due (stream F)
    and at once when the CRM sends `booking-changed` (stream S)."""
    now = clock.now()
    await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "status": "pending", "kind": {"$in": list(APPOINTMENT_KINDS)}},
        {"$set": {"status": "cancelled", "reason": "the booking was cancelled on the platform", "closed_at": now}})
    moved = await lifecycle.apply(db, lead_id, [lifecycle.Event(
        "appointment_cancelled", source=source, reason="The booking was cancelled on the platform")],
        lead=lead, customer_id=customer_id)
    if moved and moved.get("cadence_started"):
        moved["cadence_touch"] = await plan_cadence_touch(
            db, lead_id=lead_id, customer_id=customer_id, channel=channel or "sms", turn_id=turn_id,
            lead=lead, customer=customer, first_contact_done=True)
    return moved


async def _fire_appointment_locked(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """One appointment step is due (MASTER_PLAN_3 C5; agent/appointment.py). Re-reads everything first (§2, §11:
    "never execute a task simply because it was previously placed in a queue"): the lead's stage, that the
    appointment is still the same one, that the dealer is live and that the send check allows it. Then sends the
    client's own text on both channels, and for the no-show steps moves the stage and plans what comes next."""
    from upsell_agent.tools import booking_tool

    step, step_id = doc["step"], str(doc["_id"])
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        trigger=TRIGGER_APPOINTMENT, channel=doc["to_channel"], store_prompts=deps.store_prompts,
        turn_id=f"appointment-check-{step_id}-fire{int(doc.get('claim_count') or 1)}")
    await tracer.start({"followup_id": step_id, "step": step, "appointment_at": doc.get("appointment_at")})
    profile = await dealer_profile(db.dealer_id)
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(doc["lead_id"])})
    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(doc["customer_id"])})
    async with tracer.node("appointment_step", {"followup_id": step_id, "step": step, "due_at": doc["due_at"],
                                                "appointment_at": doc.get("appointment_at")}) as span:
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": doc["lead_id"]}) or {}
        status = state.get("status", "active")
        mode = await dealer_ai_mode(db.dealer_id)
        booking = await booking_tool.find_active_booking(db.dealer_id, lead)
        # Stream F: a booking cancelled on the CRM's booking screen leaves the lead's booking fields behind;
        # they are not an appointment any more.
        cancelled = booking is None and await booking_tool.booking_cancelled(db.dealer_id, lead)
        current = None if cancelled else appointment.appointment_at(tz=profile.tz, booking=booking, lead=lead,
                                                                    recorded=state.get("appointment"))
        same = current is not None and current.isoformat() == doc.get("appointment_at")
        needs_booking_check = step in (appointment.STEP_DETAILS, appointment.STEP_CONFIRM, appointment.STEP_COUNTDOWN,
                                       appointment.STEP_NO_SHOW_CHECK)
        checks = [
            ("lead_active", status not in SILENT_STATUSES,
             f"lead is {status}" + (f" ({state.get('status_reason')})" if state.get("status_reason") else "")),
            lifecycle.stage_check(state, doc["kind"]),
            ("same_appointment", same or not needs_booking_check,
             "the appointment is still at the time this step was planned for" if same or not needs_booking_check
             else "the appointment was moved or cancelled since"),
            ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
        ]
        if step == appointment.STEP_DETAILS:  # MASTER_PLAN_4 (stream R)
            useful = appointment.details_still_useful(current, now=clock.now())
            checks.append(("details_useful", useful, "the appointment is still far enough away for its details"
                           if useful else "too close to the appointment for the details message to help"))
        failed = [c for c in checks if not c[1]]
        check = None
        if not failed:
            ch, check = await _permitted_channel(
                dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=doc["lead_id"],
                channel=doc["to_channel"], at=None, lead=lead, customer=customer, purpose="transactional")
            doc = {**doc, "to_channel": ch}
            checks.append(("send_check", check.outcome == "ALLOW", f"{ch}: {check.summary()}"))
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "send_check": check.as_dict() if check else None,
                       "decision": "cancel" if failed else "send" if check.outcome == "ALLOW" else check.outcome.lower()}
        span.reasoning = [f"{'OK' if ok else 'no'}: {d}" for _, ok, d in checks]
        span.edge_label = "cancelled" if failed else step

    if failed:
        reason = failed[0][2]
        await _close(db, doc, "cancelled", reason=reason)
        await _log(db, tracer, f"appointment_{step}_cancelled", {"followup_id": step_id, "reason": reason})
        if cancelled and stage_of_state(state) in (lifecycle.Stage.APPOINTMENT_SET, lifecycle.Stage.NO_SHOW):
            await appointment_cancelled_on_platform(
                db, lead_id=doc["lead_id"], customer_id=doc["customer_id"], lead=lead, customer=customer,
                channel=doc.get("to_channel"), turn_id=f"appointment-cancelled-{doc['_id']}")
        return "cancelled"
    # The close step sends nothing, so the send check's verdict doesn't apply to it.
    if step != appointment.STEP_NO_SHOW_CLOSE:
        if check.outcome == "HOLD" and check.until:
            await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
                {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
                {"$set": {"status": "pending", "due_at": check.until,
                          "reason": f"held by the send check: {check.reason}"}})
            await _log(db, tracer, f"appointment_{step}_deferred", {"followup_id": step_id, "reason": check.reason,
                                                                    "due_at": check.until.isoformat()})
            return "deferred"
        if check.outcome != "ALLOW":
            await _close(db, doc, "suppressed", reason=f"{check.outcome}: {check.reason}")
            await _log(db, tracer, f"appointment_{step}_suppressed", {"followup_id": step_id, "reason": check.reason})
            return "suppressed"

    appt_at = appointment.aware(datetime.fromisoformat(doc["appointment_at"]), profile.tz)
    lead_state_fields: dict[str, Any] = {}
    outcomes: list[SendOutcome] = []
    moved = None
    if step == appointment.STEP_NO_SHOW_CHECK:
        # Appointment + 1 hour and no Sales Visit: the lead is a No Show (§9). The stage change comes first, so
        # a reply to the message below is routed as a reply to a no-show.
        moved = await lifecycle.apply(db, doc["lead_id"], [lifecycle.Event(
            "appointment_missed", source="appointment_timer", reason="Appointment time + 1 hour with no Sales Visit")],
            lead=lead, customer_id=doc["customer_id"])
    if step == appointment.STEP_NO_SHOW_CLOSE:
        moved = await lifecycle.apply(db, doc["lead_id"], [lifecycle.Event(
            "no_show_unanswered", source="appointment_timer",
            reason="No reply to the no-show messages: back to Short-Term follow-up")],
            lead=lead, customer_id=doc["customer_id"])
        if moved and moved.get("cadence_started"):
            moved["cadence_touch"] = await plan_cadence_touch(
                db, lead_id=doc["lead_id"], customer_id=doc["customer_id"], channel=doc["to_channel"],
                turn_id=f"appointment-{step}-{step_id}", lead=lead, customer=customer, first_contact_done=True)
    else:
        text = appointment.render_message(
            step, customer_name=(customer or {}).get("name") or (lead or {}).get("name"), dealership=profile.name,
            agent_name=profile.agent_name, appt=appt_at,
            model=await _interest_model(db, doc["customer_id"], doc["lead_id"]),
            address=profile.address, agent_phone=profile.agent_phone)
        # MASTER_PLAN_4 F3: the countdown and no-show step 1 show the vehicle this lead is about - its own
        # photo, a different one each countdown day where it has several (days left picks it). No vehicle on
        # record, or no usable photo: the client's text-only fallback, as before (§15).
        photo_vin = photo_start = None
        if step in (appointment.STEP_COUNTDOWN, appointment.STEP_NO_SHOW_CHECK):
            photo_vin = lead_vehicle_vin(lead, state)
            due = appointment.aware(doc["due_at"], profile.tz) if isinstance(doc.get("due_at"), datetime) else None
            photo_start = (appt_at.date() - due.date()).days if (due and appt_at
                                                                 and step == appointment.STEP_COUNTDOWN) else 0
        outcomes = await _send_step_messages(db, deps, tracer, doc, text, photo_vin=photo_vin,
                                             photo_start=photo_start or 0)
        if any(o.status == "held" for o in outcomes) and not any(o.status in ("sent", "duplicate") for o in outcomes):
            # The check changed between the look above and the send (a clock move, the cap).
            await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
                {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
                {"$set": {"status": "pending", "due_at": clock.now() + BUSY_RETRY_AFTER,
                          "reason": "held by the send check at send time; checking again"}})
            return "deferred"
        delivered = any(o.status in ("sent", "duplicate") for o in outcomes)
        if delivered:
            lead_state_fields["last_outbound_at"] = clock.now()
        if step == appointment.STEP_DETAILS and delivered:  # MASTER_PLAN_4 (stream R): not again for this time
            lead_state_fields["appointment_details_sent_for"] = doc.get("appointment_at")
        if step == appointment.STEP_CONFIRM and delivered:
            lead_state_fields["appointment.confirmation"] = {"status": "asked", "sent_at": clock.now(),
                                                             "asked_again": False}
        if step == appointment.STEP_NO_SHOW_CHECK and delivered:
            await _plan_no_show_step(db, doc, appointment.STEP_NO_SHOW_FOLLOWUP, appointment.NO_SHOW_FOLLOWUP_AFTER)
        if step == appointment.STEP_NO_SHOW_FOLLOWUP and delivered:
            await _plan_no_show_step(db, doc, appointment.STEP_NO_SHOW_CLOSE, appointment.NO_SHOW_CLOSE_AFTER)
    if lead_state_fields:
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": doc["lead_id"]},
                                                                 {"$set": lead_state_fields})
    sent_any = any(o.status in ("sent", "duplicate") for o in outcomes)
    status_out = "sent" if (sent_any or step == appointment.STEP_NO_SHOW_CLOSE) else (
        outcomes[0].status if outcomes else "failed")
    await _close(db, doc, status_out, reason=None, fired_at=clock.now())
    await _log(db, tracer, f"appointment_{step}_{status_out}", {
        "followup_id": step_id, "step": step, "sent": [{"channel": o.channel, "status": o.status} for o in outcomes],
        "lifecycle": moved})
    return status_out


async def _interest_model(db: DealerScopedDatabase, customer_id: str, lead_id: str) -> str | None:
    """The vehicle the customer said they want ("your RAV4 purchase", §9), or None."""
    from upsell_agent.slots.store import current_facts

    for fact in await current_facts(db, customer_id, lead_id):
        if fact.get("path") == "interest.model" and fact.get("value"):
            return str(fact["value"])
    return None


async def staff_no_show(db: DealerScopedDatabase, lead_id: str) -> dict[str, Any]:
    """Staff set "No Show" (MASTER_PLAN_3 C5): the platform leaves the no-show message to the AI for an AI
    dealer, so the pending +1h no-show check fires now instead (its own checks still run: stage, dealer, send
    check). Already sent, or no appointment on record: nothing more to send."""
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
        {"lead_id": lead_id, "kind": appointment.KIND_PREFIX + appointment.STEP_NO_SHOW_CHECK, "status": "pending"},
        {"$set": {"due_at": clock.now(), "reason": 'staff set "No Show": the no-show message goes now'}})
    if result.modified_count:
        return {"no_show_check": "due_now"}
    return {"no_show_check": "none pending (already sent, or no appointment on record)"}


async def _plan_no_show_step(db: DealerScopedDatabase, doc: dict, step: str, after: timedelta) -> None:
    """The next no-show step, `after` the one that just went out. It belongs to the No Show stage, so a reply
    (which moves the stage) or a visit cancels it."""
    now = clock.now()
    await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).insert_one({
        "kind": appointment.KIND_PREFIX + step, "lead_id": doc["lead_id"], "customer_id": doc["customer_id"],
        "source_turn_id": doc["source_turn_id"], "from_channel": doc["to_channel"], "to_channel": doc["to_channel"],
        "text": None, "subject": None, "status": "pending", "due_at": now + after, "created_at": now,
        "claim_count": 0, "step": step, "appointment_at": doc.get("appointment_at"),
        "booking_id": doc.get("booking_id"), "reason": None})


async def _fire_cadence_touch_locked(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """A Short-Term / extended cadence touch is due (MASTER_PLAN_3 C4). Checks
    the lead is still being worked, then runs a whole AI turn that writes the
    touch for its theme and sends it on text AND email together (agent/turn.py).
    The turn itself advances the cadence and schedules the next touch."""
    from upsell_agent.agent.turn import run_turn

    touch_id = str(doc["_id"])
    touch = doc.get("touch") or {}
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        trigger="cadence_check", channel=doc["to_channel"], store_prompts=deps.store_prompts,
        turn_id=f"cadence-check-{touch_id}-fire{int(doc.get('claim_count') or 1)}",
    )
    await tracer.start({"followup_id": touch_id, "touch": touch, "channel": doc["to_channel"]})
    async with tracer.node("cadence_touch", {"followup_id": touch_id, "due_at": doc["due_at"],
                                             "touch": touch}) as span:
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": doc["lead_id"]}) or {}
        status = state.get("status", "active")
        mode = await dealer_ai_mode(db.dealer_id)
        checks = [
            ("lead_active", status not in SILENT_STATUSES,
             f"lead is {status}" + (f" ({state.get('status_reason')})" if state.get("status_reason") else "")),
            lifecycle.stage_check(state, KIND_CADENCE_TOUCH),
            ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
        ]
        failed = [c for c in checks if not c[1]]
        check = None
        if not failed:
            # The preferred channel, or the other when only that one is allowed (decision 155).
            channel_now, check = await _permitted_channel(
                dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=doc["lead_id"],
                channel=doc["to_channel"], at=None)
            doc = {**doc, "to_channel": channel_now}
            checks.append(("send_check", check.outcome == "ALLOW", f"{channel_now}: {check.summary()}"))
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "touch": touch, "send_check": check.as_dict() if check else None,
                       "decision": "cancel" if failed else "run the turn" if check.outcome == "ALLOW"
                       else check.outcome.lower()}
        span.reasoning = [f"{'OK' if ok else 'no'}: {d}" for _, ok, d in checks]
        span.edge_label = "cancelled" if failed else f"touch {touch.get('touch_number')}"

    if failed:
        reason = failed[0][2]
        await _close(db, doc, "cancelled", reason=reason)
        await _log(db, tracer, "cadence_touch_cancelled", {"followup_id": touch_id, "reason": reason})
        return "cancelled"
    if check.outcome == "HOLD" and check.until:
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
            {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
            {"$set": {"status": "pending", "due_at": check.until,
                      "reason": f"held by the send check: {check.reason}"}})
        await _log(db, tracer, "cadence_touch_deferred", {"followup_id": touch_id, "reason": check.reason,
                                                          "due_at": check.until.isoformat()})
        return "deferred"
    if check.outcome != "ALLOW":
        await _close(db, doc, "suppressed", reason=f"{check.outcome}: {check.reason}")
        await _log(db, tracer, "cadence_touch_suppressed", {"followup_id": touch_id, "reason": check.reason})
        return "suppressed"

    # PLAN_4 stream L: a price-drop touch re-checks the drop on a fresh read; lapsed, it loses the price.
    touch = await optimizer.recheck_price_drop(db, touch, deps.config)
    # The turn reads the theme from here (agent/nodes/decide.py) and clears it when it's done.
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": doc["lead_id"]}, {"$set": {"pending_touch": touch}})
    await _log(db, tracer, "cadence_touch_started", {"followup_id": touch_id, "touch": touch})
    log = await run_turn(
        dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=doc["lead_id"],
        trigger=TRIGGER_CADENCE_TOUCH, channel=doc["to_channel"], inbound_text="", shadow=False, deps=deps,
        turn_id=f"cadence-{touch_id}", is_reply=False,
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
    return status


async def _fire_call_task_locked(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """The 60-minute connection timer ran out (MASTER_PLAN_3 C2). Re-read the lead, then either cancel (contact
    happened, staff have it, the stage moved on), defer to the next allowed calling time, or open the call task
    for staff."""
    task_id = str(doc["_id"])
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
        trigger="call_task_check", channel="voice", store_prompts=deps.store_prompts,
        turn_id=f"call-task-{task_id}-fire{int(doc.get('claim_count') or 1)}")
    await tracer.start({"followup_id": task_id, "phone": doc.get("to"), "sent_channels": doc.get("sent_channels")})
    async with tracer.node("call_task", {"followup_id": task_id, "due_at": doc["due_at"]}) as span:
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": doc["lead_id"]}) or {}
        status = state.get("status", "active")
        mode = await dealer_ai_mode(db.dealer_id)
        inbound = await db.collection(AI_MESSAGES_COLLECTION).find(
            {"lead_id": doc["lead_id"], "direction": "inbound", "created_at": {"$gt": doc["created_at"]}}).to_list(None)
        contact = [m for m in inbound if lifecycle.is_meaningful_reply(m.get("text"))[0]]
        checks = [
            ("no_contact", not contact, "the customer replied: no call needed" if contact
             else "no meaningful reply in the 60 minutes"),
            ("lead_active", status not in SILENT_STATUSES,
             f"lead is {status}" + (f" ({state.get('status_reason')})" if state.get("status_reason") else "")),
            lifecycle.stage_check(state, KIND_CALL_TASK),
            ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
        ]
        if doc.get("requested"):
            # PLAN_4 stream H: the customer asked for this call. It waited only for calling hours: their later
            # messages, the handoff to staff and the AI's mode don't cancel it. The stage and call rules still do.
            checks = [lifecycle.stage_check(state, KIND_CALL_TASK)]
        else:
            # PLAN_4 stream T: with the Days 1-7 call tasks on, at most 2 call tasks per lead per workday in all.
            from upsell_agent.scheduler import daily_call_tasks
            checks.append(await daily_call_tasks.workday_cap_check(db, doc["lead_id"]))
        failed = [c for c in checks if not c[1]]
        decision = None
        if not failed:
            decision = await can_call(dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=doc["lead_id"],
                                      request_id=f"call-task-{task_id}")
            checks.append(("call_check", decision.outcome == "ALLOW", decision.summary()))
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "call_check": decision.as_dict() if decision else None,
                       "decision": "cancel" if failed else decision.outcome.lower()}
        span.reasoning = [f"{'OK' if ok else 'no'}: {d}" for _, ok, d in checks]
        span.edge_label = "cancelled" if failed else decision.outcome.lower()

    if failed:
        reason = failed[0][2]
        await _close(db, doc, "cancelled", reason=reason)
        await _log(db, tracer, "call_task_cancelled", {"followup_id": task_id, "reason": reason})
        return "cancelled"
    if decision.outcome == "HOLD" and decision.until:
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
            {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
            {"$set": {"status": "pending", "due_at": decision.until,
                      "reason": f"held until the next calling time: {decision.reason}"}})
        await _log(db, tracer, "call_task_deferred", {"followup_id": task_id, "reason": decision.reason,
                                                      "due_at": decision.until.isoformat()})
        return "deferred"
    if decision.outcome != "ALLOW":
        await _close(db, doc, "suppressed", reason=f"{decision.outcome}: {decision.reason}")
        await _log(db, tracer, "call_task_suppressed", {"followup_id": task_id, "reason": decision.reason})
        return "suppressed"
    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(doc["customer_id"])})
    requested = bool(doc.get("requested"))
    who = (customer or {}).get("name") or "the customer"
    task = await call_tasks.open_task(
        db, lead_id=doc["lead_id"], customer_id=doc["customer_id"], phone=doc["to"],
        customer_name=(customer or {}).get("name"),
        reason=doc.get("task_reason") or "no contact within 60 minutes of the touch",
        source_turn_id=doc.get("source_turn_id"), followup_id=task_id, created_at=doc["created_at"],
        requested=requested,
        notice=(f"Please call {who} at {doc['to']}: they asked to speak with a person by phone, and it's calling "
                "hours now." if requested else None))
    await _close(db, doc, "activated", reason="call task opened for staff", task_id=str(task["_id"]),
                 fired_at=clock.now())
    await _log(db, tracer, "call_task_opened", {"followup_id": task_id, "task_id": str(task["_id"]),
                                                "phone": doc["to"]})
    return "activated"


# --- Provider said the message failed -------------------------------------------

async def make_due_now(db: DealerScopedDatabase, *, lead_id: str, source_turn_id: str, from_channel: str,
                       reason: str) -> bool:
    """The original message failed to deliver: its follow-up fires now
    instead of in 24 hours (architecture §6 "Failed SMS")."""
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
        {"lead_id": lead_id, "source_turn_id": source_turn_id, "from_channel": from_channel,
         "status": {"$in": ["pending", "standby"]}, **CHANNEL_SWITCHES},
        {"$set": {"due_at": clock.now(), "reason": reason, "status": "pending"}},
    )
    return result.modified_count == 1
