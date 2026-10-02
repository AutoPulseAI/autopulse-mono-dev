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
"""

from datetime import timedelta
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    DealerScopedDatabase,
)

# From a successful send to the call task opening, if there was no contact (client: 60 minutes).
CONNECTION_WINDOW = timedelta(minutes=60)
OPEN, COMPLETED, DISMISSED, CANCELLED = "open", "completed", "dismissed", "cancelled"
OUTCOMES = {"connected", "no_answer", "voicemail", "wrong_number", "other"}


async def open_task(db: DealerScopedDatabase, *, lead_id: str, customer_id: str, phone: str, customer_name: str | None,
                    reason: str, source_turn_id: str | None, followup_id: str, created_at: Any) -> dict[str, Any]:
    """Opens the task for staff and tells them on the lead. One open task per lead."""
    tasks = db.collection(AI_CALL_TASKS_COLLECTION)
    existing = await tasks.find_one({"lead_id": lead_id, "status": OPEN})
    if existing:
        return existing
    now = clock.now()
    doc = {"lead_id": lead_id, "customer_id": customer_id, "phone": phone, "customer_name": customer_name,
           "status": OPEN, "reason": reason, "source_turn_id": source_turn_id, "followup_id": followup_id,
           "timer_started_at": created_at, "opened_at": now, "created_at": now}
    inserted = await tasks.insert_one(doc)
    doc["_id"] = inserted.inserted_id
    who = customer_name or "the customer"
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {
        "call_task": {"id": str(doc["_id"]), "status": OPEN, "phone": phone, "opened_at": now},
        "staff_notice": {"at": now, "kind": "call_task",
                         "text": f"Please call {who} at {phone}: our text and email went out over an hour ago "
                                 "with no reply."}}})
    return doc


async def cancel_open(db: DealerScopedDatabase, lead_id: str, reason: str) -> int:
    """The customer or staff made contact (or the lead moved on) while a task was open."""
    result = await db.collection(AI_CALL_TASKS_COLLECTION).update_many(
        {"lead_id": lead_id, "status": OPEN},
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
    if task is None or task["status"] != OPEN:
        return task
    await tasks.update_one({"_id": task["_id"], "status": OPEN}, {"$set": {
        "status": status, "outcome": outcome, "note": note, "closed_by": by, "closed_at": clock.now()}})
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": task["lead_id"], "staff_notice.kind": "call_task"}, {"$unset": {"staff_notice": ""}})
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": task["lead_id"]}, {"$unset": {"call_task": ""}})
    return await tasks.find_one({"_id": task["_id"]})
