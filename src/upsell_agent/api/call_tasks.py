"""Staff call tasks for the platform (MASTER_PLAN_3 C2; agent/call_tasks.py).

  GET  /v1/call-tasks?dealer_id=...&status=open    the tasks staff should call (newest first)
  POST /v1/call-tasks/{id}/complete                staff called: {dealer_id, outcome, note?, by?, lead_outcome?,
                                                   follow_up?, opt_out_scope?} - the lead outcome reaches the AI
                                                   (agent/call_outcomes.py, PLAN_4 stream H)
  POST /v1/call-tasks/{id}/dismiss                 staff will not call: {dealer_id, note?, by?}

Shared-secret auth like the other /v1 routes. The platform's own screen for these (a task list with
click-to-call) is a platform change this service does not make; until then the same data shows in the
Debug UI and as the lead's staff notice.
"""

from datetime import UTC, datetime
from typing import Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from upsell_agent.agent import call_outcomes, call_tasks
from upsell_agent.api.auth import require_internal_auth
from upsell_agent.compliance.call_check import call_window, can_call
from upsell_agent.integrations.mongodb import AI_CALL_TASKS_COLLECTION, dealer_scoped_db

router = APIRouter(prefix="/v1/call-tasks", tags=["call-tasks"], dependencies=[Depends(require_internal_auth)])


def _iso(value: Any) -> Any:
    if not isinstance(value, datetime):
        return value
    return (value if value.tzinfo else value.replace(tzinfo=UTC)).isoformat()


def view(task: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in task.items() if k != "_id"}
    out["id"] = str(task["_id"])
    return {k: _iso(v) for k, v in out.items()}


class Resolution(BaseModel):
    dealer_id: str
    outcome: Literal["connected", "no_answer", "voicemail", "wrong_number", "other"] | None = None
    note: str | None = None
    by: str | None = None
    # PLAN_4 stream H: what the call means for the lead (agent/call_outcomes.py).
    lead_outcome: call_outcomes.LeadOutcome | None = None
    follow_up: call_outcomes.FollowUp | None = None
    opt_out_scope: Literal["all", "voice"] = "all"


@router.get("")
async def list_tasks(dealer_id: str = Query(...), status: str | None = Query("open"),
                     lead_id: str | None = None) -> list[dict[str, Any]]:
    flt: dict[str, Any] = {**({"status": status} if status else {}), **({"lead_id": lead_id} if lead_id else {})}
    rows = await dealer_scoped_db(dealer_id).collection(AI_CALL_TASKS_COLLECTION).find(flt).sort(
        "opened_at", -1).to_list(200)
    out = []
    for row in rows:
        if row.get("status") == call_tasks.OPEN:
            # PLAN_4 stream X1 item 7: re-checked now, as staff are about to dial (not only when it opened).
            row = {**row, "call_window": await call_window(dealer_id=dealer_id, customer_id=row.get("customer_id"),
                                                           lead_id=row["lead_id"])}
        out.append(view(row))
    return out


@router.get("/{task_id}/check")
async def check_before_dialling(task_id: str, dealer_id: str = Query(...)) -> dict[str, Any]:
    """PLAN_4 stream X1 item 7: the call check at the moment of dialling (logged), with "do not call before /
    after". The platform's click-to-call asks this first."""
    if not ObjectId.is_valid(task_id):
        raise HTTPException(status_code=404, detail="no call task with that id")
    db = dealer_scoped_db(dealer_id)
    task = await db.collection(AI_CALL_TASKS_COLLECTION).find_one({"_id": ObjectId(task_id)})
    if task is None:
        raise HTTPException(status_code=404, detail="no call task with that id")
    decision = await can_call(dealer_id=dealer_id, customer_id=task.get("customer_id"), lead_id=task["lead_id"],
                              request_id=f"dial:{task_id}")
    window = await call_window(dealer_id=dealer_id, customer_id=task.get("customer_id"), lead_id=task["lead_id"])
    return {k: _iso(v) for k, v in {**window, "log_id": decision.log_id}.items()}


async def _resolve(task_id: str, body: Resolution, status: str) -> dict[str, Any]:
    db = dealer_scoped_db(body.dealer_id)
    task = await call_tasks.resolve(db, task_id, status=status, outcome=body.outcome, note=body.note, by=body.by)
    if task is None:
        raise HTTPException(status_code=404, detail="no call task with that id")
    out = view(task)
    if status == call_tasks.COMPLETED and body.lead_outcome and not task.get("lead_outcome"):
        applied = await call_outcomes.apply(db, task, body.lead_outcome, follow_up=body.follow_up,
                                            opt_out_scope=body.opt_out_scope, by=body.by)
        await db.collection(AI_CALL_TASKS_COLLECTION).update_one(
            {"_id": task["_id"]}, {"$set": {"lead_outcome": body.lead_outcome}})
        out["lead_outcome"] = body.lead_outcome
        out["applied"] = _plain(applied)
    return out


def _plain(value: Any) -> Any:
    """JSON-safe copy of what call_outcomes.apply returned (datetimes as ISO, ObjectIds as str)."""
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, datetime):
        return _iso(value)
    return value if isinstance(value, (str, int, float, bool, type(None))) else str(value)


@router.post("/{task_id}/complete")
async def complete(task_id: str, body: Resolution) -> dict[str, Any]:
    return await _resolve(task_id, body, call_tasks.COMPLETED)


@router.post("/{task_id}/dismiss")
async def dismiss(task_id: str, body: Resolution) -> dict[str, Any]:
    return await _resolve(task_id, body, call_tasks.DISMISSED)
