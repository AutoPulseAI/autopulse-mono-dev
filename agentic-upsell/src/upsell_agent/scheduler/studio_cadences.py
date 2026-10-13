"""Cadences added in AI Studio, and the timing every cadence touch can be given there (client, 13 Oct 2026: "give
them the option of the timing ... number of days, hours, minutes, years, months, weeks ... how much time they want
in each cadence").

A touch's timing is a wait: `{"amount": 3, "unit": "hours", "after": "previous" | "start", "at": "10:00"}` - any
number of minutes, hours, days, weeks, months or years after the previous touch (or after the cadence started),
optionally sent at a time of day (dealer-local). The send check still moves any send outside the hours the
customer may be contacted, exactly as for every other message.

A cadence the super admin adds runs when its `starts_when` happens:
    {"type": "status", "status": "Contacted - Specific Follow-up"}   staff set the lead to that status
    {"type": "lead_created"}                                           a new lead arrives
    {"type": "customer_says", "phrases": ["lease", ...]}               the customer writes any of these
Each touch is sent on the channels ticked for it (text / email / call task), as written: fixed text word for word,
"AI writes it" by the AI from its instruction. It stops when the customer replies, an appointment is set, they opt
out or the AI is paused (`stops_when` can drop "customer replies").
"""

import logging
import re
from datetime import datetime
from typing import Any

from upsell_agent import ai_studio, clock
from upsell_agent.agent.timing import describe, due
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
)

logger = logging.getLogger(__name__)

KIND_STUDIO_TOUCH = "studio_touch"


# --- Cadences added in the Studio ---------------------------------------------------------------------------------

def added_cadences() -> list[tuple[str, dict[str, Any]]]:
    """(key, content) of every published cadence that isn't one of the built-in ones."""
    built_in = {k for (kind, k) in ai_studio._built_in() if kind == "cadences"}
    return [(key, c) for (kind, key), c in ai_studio._changed.items()
            if kind == "cadences" and key not in built_in and (c.get("steps") or [])]


def _matches(start: dict[str, Any], trigger: dict[str, Any]) -> bool:
    kind = start.get("type")
    if kind != trigger.get("type"):
        return False
    if kind == "status":
        return str(start.get("status") or "").strip().lower() == str(trigger.get("status") or "").strip().lower()
    if kind == "customer_says":
        pattern = ai_studio.words_to_pattern(start.get("phrases") or start.get("words") or [])
        return bool(pattern and re.search(pattern, trigger.get("text") or "", re.IGNORECASE))
    return kind == "lead_created"


async def start(db: DealerScopedDatabase, *, lead_id: str, customer_id: str | None, channel: str,
                trigger: dict[str, Any]) -> list[dict[str, Any]]:
    """Starts every added cadence whose `starts_when` is this trigger (one running instance per lead and cadence).
    Never raises: a broken cadence can't stop the event that triggered it."""
    out = []
    if not customer_id:
        return out
    for key, content in added_cadences():
        try:
            if not _matches(content.get("starts_when") or {}, trigger):
                continue
            followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
            if await followups.find_one({"lead_id": lead_id, "kind": KIND_STUDIO_TOUCH, "studio_cadence": key,
                                         "status": {"$in": ["pending", "claimed"]}}):
                out.append({"cadence": key, "created": False, "reason": "already running for this lead"})
                continue
            now = clock.now()
            await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
                {"lead_id": lead_id}, {"$set": {f"studio_cadences.{key}": {"started_at": now, "step": 0}}})
            out.append(await plan_step(db, lead_id=lead_id, customer_id=customer_id, channel=channel, key=key,
                                       index=0, started_at=now, previous_at=now))
        except Exception:
            logger.exception("AI Studio cadence %s could not start for lead %s", key, lead_id)
    return out


async def plan_step(db: DealerScopedDatabase, *, lead_id: str, customer_id: str, channel: str, key: str,
                    index: int, started_at: datetime, previous_at: datetime) -> dict[str, Any]:
    from upsell_agent.integrations.dealer_profile import dealer_profile
    content = ai_studio.content("cadences", key) or {}
    steps = content.get("steps") or []
    if index >= len(steps):
        return {"cadence": key, "created": False, "reason": "the cadence's last touch has gone out"}
    step = steps[index]
    wait = step.get("wait") or {}
    profile = await dealer_profile(db.dealer_id)
    anchor = started_at if wait.get("after") == "start" else previous_at
    due_at = due(anchor, wait, profile.tz)
    channels = [c for c in step.get("channels") or ["sms", "email"] if c in ("sms", "email", "call_task")]
    primary = channel if channel in channels else next((c for c in channels if c != "call_task"), "sms")
    doc = {"kind": KIND_STUDIO_TOUCH, "lead_id": lead_id, "customer_id": customer_id, "studio_cadence": key,
           "step_index": index, "started_at": started_at, "from_channel": primary, "to_channel": primary,
           "status": "pending", "due_at": due_at, "created_at": clock.now(), "claim_count": 0,
           "touch": {"studio_cadence": key, "step": index, "theme": f"studio:{key}:{step.get('id') or index}",
                     "theme_label": step.get("label") or f"Touch {index + 1}", "channels": channels,
                     "instruction": ai_studio.instruction(step.get("message")), "message": step.get("message"),
                     "touch_number": index + 1, "day": 0}}
    inserted = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).insert_one(doc)
    return {"cadence": key, "created": True, "followup_id": str(inserted.inserted_id), "due_at": due_at.isoformat(),
            "step": index, "timing": describe(wait)}


async def fire(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """A touch of an added cadence is due: checked, sent through a whole AI turn on its channels, the next planned."""
    from upsell_agent.agent.turn import run_turn
    from upsell_agent.integrations.dealer_mode import dealer_ai_mode
    from upsell_agent.scheduler.followups import (
        SILENT_STATUSES,
        TRIGGER_CADENCE_TOUCH,
        _close,
        _permitted_channel,
    )

    key = doc["studio_cadence"]
    content = ai_studio.content("cadences", key)
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": doc["lead_id"]}) or {}
    stops = content.get("stops_when") if content else None
    stops = stops if isinstance(stops, list) else ["customer replies", "appointment set", "opt-out"]
    replied = state.get("last_inbound_at")
    reasons = [
        (content is None, "the cadence was deleted or unpublished in AI Studio"),
        (state.get("status") in SILENT_STATUSES, f"the lead is {state.get('status')}"),
        (await dealer_ai_mode(db.dealer_id) != "live", "the dealer's AI isn't live"),
        ("customer replies" in stops and isinstance(replied, datetime) and replied > doc["started_at"].replace(
            tzinfo=replied.tzinfo), "the customer replied"),
        ("appointment set" in stops and state.get("stage") == "appointment_set", "an appointment is set"),
    ]
    if why := next((w for failed, w in reasons if failed), None):
        await _close(db, doc, "cancelled", reason=why)
        return "cancelled"
    touch = doc.get("touch") or {}
    channels = touch.get("channels") or ["sms", "email"]
    if channels == ["call_task"]:
        await _call_task(db, doc, state)
        await _close(db, doc, "sent", reason="call task created", fired_at=clock.now())
        return await _next(db, doc, "sent")
    channel_now, check = await _permitted_channel(dealer_id=db.dealer_id, customer_id=doc["customer_id"],
                                                  lead_id=doc["lead_id"], channel=doc["to_channel"], at=None)
    if check.outcome == "HOLD" and check.until:
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
            {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
            {"$set": {"status": "pending", "due_at": check.until, "reason": f"held by the send check: {check.reason}"}})
        return "deferred"
    if check.outcome != "ALLOW":
        await _close(db, doc, "suppressed", reason=f"{check.outcome}: {check.reason}")
        return await _next(db, doc, "suppressed")
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": doc["lead_id"]},
                                                             {"$set": {"pending_touch": touch}})
    log = await run_turn(dealer_id=db.dealer_id, customer_id=doc["customer_id"], lead_id=doc["lead_id"],
                         trigger=TRIGGER_CADENCE_TOUCH, channel=channel_now, inbound_text="", shadow=False, deps=deps,
                         turn_id=f"studio-{doc['_id']}", is_reply=False)
    sent = log["summary"].get("send_status")
    status = "sent" if sent in ("sent", "duplicate") else (sent or "failed")
    await _close(db, doc, status, reason=log["outcome"], fired_at=clock.now(), turn_id=log["turn_id"])
    return await _next(db, doc, status)


async def _next(db: DealerScopedDatabase, doc: dict, status: str) -> str:
    await plan_step(db, lead_id=doc["lead_id"], customer_id=doc["customer_id"], channel=doc["to_channel"],
                    key=doc["studio_cadence"], index=int(doc["step_index"]) + 1, started_at=doc["started_at"],
                    previous_at=clock.now())
    return status


async def _call_task(db: DealerScopedDatabase, doc: dict, state: dict) -> None:
    """A touch ticked "call task" only: the staff call task the cadence touches already create."""
    from upsell_agent.scheduler.followups import plan_call_task
    await plan_call_task(db, lead_id=doc["lead_id"], customer_id=doc["customer_id"], turn_id=f"studio-{doc['_id']}",
                         lead=None, customer=None, lead_state=state, sent_channels=[])


async def cancel(db: DealerScopedDatabase, lead_id: str, *, reason: str) -> int:
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"lead_id": lead_id, "kind": KIND_STUDIO_TOUCH, "status": "pending"},
        {"$set": {"status": "cancelled", "reason": reason, "closed_at": clock.now()}})
    return result.modified_count
