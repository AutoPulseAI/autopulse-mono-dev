"""Staff call tasks (MASTER_PLAN_3 C2; Omnichannel PDF §2, p.10; architecture
§15 decisions 177-183).

The client's omnichannel rule: a scheduled touch is text + email + a human call
task. The call must not nag someone who is already talking to us, so the task
waits behind a **60-minute connection timer**:

    touch sent (text and/or email)  ->  timer starts (scheduled kind `call_task`)
    a meaningful reply in 60 minutes ->  the task is cancelled
    staff took over / the lead moved on (appointment, visit, opt-out, ...) -> cancelled
    60 minutes, no contact           ->  re-checked, then OPENED for staff

Opening re-checks everything (the lead's state, the stage, the dealer's mode, a
reply since, and the call rules in compliance/call_check.py: calling hours,
opening hours as the agents' schedule, voice opt-out, DND, a valid phone) and
**defers** to the next allowed calling time when it is outside them.

An opened task lives in `ai_call_tasks` (status `open`) and shows on the lead as a
staff notice; the platform reads them from `GET /v1/call-tasks` (api/call_tasks.py)
and staff mark them done or dismissed there. One task per lead at a time: a newer
touch replaces a waiting one.

This module is only the store (no scheduler imports, so the lifecycle can use it).

PLAN_4 stream T: the Days 1-7 morning and afternoon call tasks (scheduler/daily_call_tasks.py) open here too
(`source: "daily"`, with their `slot`). Every task opened now carries `due_by` - the end of its half-day window
for a daily task, the end of the agent's day (the dealer's closing time) for the others - and the lead's
`assigned_to`. A task still open at `due_by` is marked `missed` (`mark_missed`, every minute with the scheduler)
with the time and the assigned agent: the client wants missed human tasks recorded for the BDC report (1 Oct).
Staff can still record the outcome of a missed call afterwards; `missed_at` stays on it.
"""

from datetime import UTC, datetime, time, timedelta
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
    get_db,
)

# From a successful send to the call task opening, if there was no contact (client: 60 minutes).
CONNECTION_WINDOW = timedelta(minutes=60)
OPEN, COMPLETED, DISMISSED, CANCELLED = "open", "completed", "dismissed", "cancelled"
MISSED = "missed"  # stream T: not completed by the end of its window / the agent's day
# Stream X2 (Sales Lead Blueprint box 8: "Requests phone call -> call within 5 minutes (business hours)"): a call
# the customer asked for, opened while the dealership is open, is due this soon. Not made by then: the team is
# alerted (staff notice + CRM note) and the task stays open until the end of the agent's day.
REQUESTED_CALL_SLA = timedelta(minutes=5)


async def _requested_due(db: DealerScopedDatabase, now: datetime) -> dict[str, Any]:
    profile = await dealer_profile(db.dealer_id)
    if not profile.is_open(now):
        return {}
    return {"due_by": now + REQUESTED_CALL_SLA, "sla_due_by": now + REQUESTED_CALL_SLA,
            "day_due_by": await end_of_agent_day(db.dealer_id, now)}
OUTCOMES = {"connected", "no_answer", "voicemail", "wrong_number", "other"}


async def open_task(db: DealerScopedDatabase, *, lead_id: str, customer_id: str, phone: str, customer_name: str | None,
                    reason: str, source_turn_id: str | None, followup_id: str | None, created_at: Any,
                    requested: bool = False, notice: str | None = None,
                    extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Opens the task for staff and tells them on the lead. One open task per lead.

    `requested` (PLAN_4 stream H): the customer asked for this call ("Customer asked for a call"), so it opens
    straight away instead of after the 60-minute timer, and a later reply from the customer doesn't cancel it.
    A 60-minute task already open for the lead becomes the requested one."""
    tasks = db.collection(AI_CALL_TASKS_COLLECTION)
    who = customer_name or "the customer"
    text = notice or f"Please call {who} at {phone}: our text and email went out over an hour ago with no reply."
    existing = await tasks.find_one({"lead_id": lead_id, "status": OPEN})
    if existing:
        if requested and not existing.get("requested"):
            await tasks.update_one({"_id": existing["_id"]}, {"$set": {"requested": True, "reason": reason,
                                                                        "phone": phone,
                                                                        **await _requested_due(db, clock.now())}})
            await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {
                "staff_notice": {"at": clock.now(), "kind": "call_task", "text": text, "reason": reason}}})
            existing = {**existing, "requested": True, "reason": reason, "phone": phone}
        return existing
    now = clock.now()
    # Client, 7 Oct 2026: never give a call task to someone on their day off (agent/staff_schedule.py).
    from upsell_agent.agent.staff_schedule import agent_for
    salesperson = await assigned_agent(db, lead_id)
    agent, reassigned_why = await agent_for(db, salesperson, now)
    if reassigned_why:
        text = f"{text} ({reassigned_why}.)"
    doc = {"lead_id": lead_id, "customer_id": customer_id, "phone": phone, "customer_name": customer_name,
           "status": OPEN, "reason": reason, "source_turn_id": source_turn_id, "followup_id": followup_id,
           "timer_started_at": created_at, "opened_at": now, "created_at": now, "requested": requested,
           # stream T: who should call, and when it counts as missed.
           "source": "connection_timer", "assigned_to": agent,
           **({"assigned_salesperson": salesperson, "reassigned_reason": reassigned_why} if reassigned_why else {}),
           "due_by": await end_of_agent_day(db.dealer_id, now),
           **(await _requested_due(db, now) if requested else {}), **(extra or {})}
    # PLAN_4 stream X1 item 7: the calling window staff must keep to, worked out as the task opens; the platform
    # re-reads it live (GET /v1/call-tasks adds it fresh, GET /v1/call-tasks/{id}/check) before anyone dials.
    from upsell_agent.compliance.call_check import call_window
    doc["call_window"] = await call_window(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id, at=now)
    inserted = await tasks.insert_one(doc)
    doc["_id"] = inserted.inserted_id
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {
        "call_task": {"id": str(doc["_id"]), "status": OPEN, "phone": phone, "opened_at": now, "reason": reason},
        "staff_notice": {"at": now, "kind": "call_task", "text": text, "reason": reason}}})
    return doc


async def cancel_open(db: DealerScopedDatabase, lead_id: str, reason: str, *, keep_requested: bool = False,
                      source: str | None = None) -> int:
    """The customer or staff made contact (or the lead moved on) while a task was open. `keep_requested`: a call
    the customer asked for stays open (PLAN_4 stream H) - their next message isn't the call they asked for.
    `source` (stream T): only tasks of that source (e.g. "daily")."""
    result = await db.collection(AI_CALL_TASKS_COLLECTION).update_many(
        {"lead_id": lead_id, "status": OPEN, **({"requested": {"$ne": True}} if keep_requested else {}),
         **({"source": source} if source else {})},
        {"$set": {"status": CANCELLED, "closed_reason": reason, "closed_at": clock.now()}})
    if result.modified_count:
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
            {"lead_id": lead_id, "staff_notice.kind": "call_task"}, {"$unset": {"staff_notice": ""}})
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$unset": {"call_task": ""}})
    return result.modified_count


async def resolve(db: DealerScopedDatabase, task_id: str, *, status: str, outcome: str | None = None,
                  note: str | None = None, by: str | None = None) -> dict[str, Any] | None:
    """Staff marked the task done (`completed`, with how the call went) or `dismissed`."""
    if not ObjectId.is_valid(task_id):
        return None
    tasks = db.collection(AI_CALL_TASKS_COLLECTION)
    task = await tasks.find_one({"_id": ObjectId(task_id)})
    # stream T: a missed task can still get its outcome afterwards (the call happened late); missed_at stays.
    if task is None or task["status"] not in (OPEN, MISSED):
        return task
    await tasks.update_one({"_id": task["_id"], "status": task["status"]}, {"$set": {
        "status": status, "outcome": outcome, "note": note, "closed_by": by, "closed_at": clock.now()}})
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": task["lead_id"], "staff_notice.kind": "call_task"}, {"$unset": {"staff_notice": ""}})
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": task["lead_id"]}, {"$unset": {"call_task": ""}})
    return await tasks.find_one({"_id": task["_id"]})


# --- PLAN_4 stream T: who calls, and missed tasks ---------------------------------------------

async def assigned_agent(db: DealerScopedDatabase, lead_id: str) -> str | None:
    """The lead's `assigned_to` (a CRM User id), or None."""
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)},
                                                                    projection={"assigned_to": 1})
    value = (lead or {}).get("assigned_to")
    return str(value) if value else None


async def end_of_agent_day(dealer_id: str, at: datetime) -> datetime:
    """The dealer's closing time on `at`'s local day (opening hours stand in for the agents' schedule), or local
    midnight when the dealer is closed that day or already shut."""
    profile = await dealer_profile(dealer_id)
    local = at.astimezone(profile.tz)
    hours = profile.hours.get(local.weekday())
    if hours:
        closes = datetime.combine(local.date(), hours[1], tzinfo=profile.tz)
        if closes > local:
            return closes.astimezone(UTC)
    return datetime.combine(local.date() + timedelta(days=1), time(0), tzinfo=profile.tz).astimezone(UTC)


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def mark_missed(now: datetime | None = None, *, limit: int = 1000) -> int:
    """Open tasks past their `due_by` become `missed` (`missed_at`; the assigned agent stays on the task).
    Cross-dealer like the stuck-claim reset; each update is dealer-scoped. Tasks opened before `due_by`
    existed are left alone."""
    now = now or clock.now()
    rows = await get_db()[AI_CALL_TASKS_COLLECTION].find(
        {"status": OPEN, "due_by": {"$lte": now}},
        projection={"dealer_id": 1, "lead_id": 1, "due_by": 1, "sla_due_by": 1, "day_due_by": 1, "escalated_at": 1,
                    "customer_name": 1, "phone": 1}
    ).to_list(limit)
    count = 0
    for row in rows:
        db = dealer_scoped_db(row["dealer_id"])
        day_end = _aware(row.get("day_due_by"))
        if row.get("sla_due_by") and not row.get("escalated_at") and day_end and day_end > now:
            await _escalate_requested(db, row, now)
            continue
        result = await db.collection(AI_CALL_TASKS_COLLECTION).update_one(
            {"_id": row["_id"], "status": OPEN},
            {"$set": {"status": MISSED, "missed_at": now, "closed_at": now,
                      "closed_reason": f"not completed by {_aware(row['due_by']).isoformat()}"}})
        if not result.modified_count:
            continue
        count += 1
        state = db.collection(AI_LEAD_STATE_COLLECTION)
        await state.update_one({"lead_id": row["lead_id"], "staff_notice.kind": "call_task"},
                               {"$unset": {"staff_notice": ""}})
        await state.update_one({"lead_id": row["lead_id"], "call_task.id": str(row["_id"])},
                               {"$unset": {"call_task": ""}})
    return count


async def _escalate_requested(db: DealerScopedDatabase, row: dict[str, Any], now: datetime) -> None:
    """Stream X2: the customer's requested call wasn't made within REQUESTED_CALL_SLA. It stays open (the call is
    still owed) until the end of the agent's day; the team is told now, on the AI panel and in the CRM."""
    result = await db.collection(AI_CALL_TASKS_COLLECTION).update_one(
        {"_id": row["_id"], "status": OPEN, "escalated_at": None},
        {"$set": {"escalated_at": now, "due_by": row["day_due_by"], "sla_missed": True}})
    if not result.modified_count:
        return
    minutes = int(REQUESTED_CALL_SLA.total_seconds() // 60)
    who, phone = row.get("customer_name") or "The customer", row.get("phone")
    text = (f"Escalation: {who} asked for a phone call and nobody has called"
            f"{' ' + phone if phone else ''} within {minutes} minutes. Please call now.")
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": row["lead_id"]}, {"$set": {
        "staff_notice": {"at": now, "kind": "call_escalation", "text": text}}})
    from upsell_agent.agent import crm_notes
    await crm_notes.write(db, lead_id=row["lead_id"], kind="call_escalation", text=text,
                          key=f"call_escalation:{row['_id']}")


async def missed_by_agent(db: DealerScopedDatabase, *, since: datetime | None = None) -> list[dict[str, Any]]:
    """A simple per-agent count of missed call tasks (`missed_at` set, so one completed late still counts).
    The BDC performance report itself is next SOW."""
    flt: dict[str, Any] = {"missed_at": {"$gte": since} if since else {"$ne": None}}
    rows = await db.collection(AI_CALL_TASKS_COLLECTION).find(flt, projection={"assigned_to": 1}).to_list(None)
    counts: dict[str | None, int] = {}
    for row in rows:
        counts[row.get("assigned_to")] = counts.get(row.get("assigned_to"), 0) + 1
    return [{"assigned_to": k, "missed": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])]
