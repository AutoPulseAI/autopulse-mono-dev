"""Staff call tasks for the platform (MASTER_PLAN_3 C2; agent/call_tasks.py).

  GET  /v1/call-tasks?dealer_id=...&status=open    the tasks staff should call (newest first)
  POST /v1/call-tasks/{id}/complete                staff called: {dealer_id, outcome, note?, by?}
  POST /v1/call-tasks/{id}/dismiss                 staff will not call: {dealer_id, note?, by?}

Shared-secret auth like the other /v1 routes. The platform's own screen for these (a task list with
click-to-call) is a platform change this service does not make; until then the same data shows in the
Debug UI and as the lead's staff notice.
"""

from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from upsell_agent.agent import call_tasks
from upsell_agent.api.auth import require_internal_auth
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


@router.get("")
async def list_tasks(dealer_id: str = Query(...), status: str | None = Query("open"),
                     lead_id: str | None = None) -> list[dict[str, Any]]:
    flt: dict[str, Any] = {**({"status": status} if status else {}), **({"lead_id": lead_id} if lead_id else {})}
    rows = await dealer_scoped_db(dealer_id).collection(AI_CALL_TASKS_COLLECTION).find(flt).sort(
        "opened_at", -1).to_list(200)
    return [view(r) for r in rows]


async def _resolve(task_id: str, body: Resolution, status: str) -> dict[str, Any]:
    task = await call_tasks.resolve(dealer_scoped_db(body.dealer_id), task_id, status=status,
                                    outcome=body.outcome, note=body.note, by=body.by)
    if task is None:
        raise HTTPException(status_code=404, detail="no call task with that id")
    return view(task)


@router.post("/{task_id}/complete")
async def complete(task_id: str, body: Resolution) -> dict[str, Any]:
    return await _resolve(task_id, body, call_tasks.COMPLETED)


@router.post("/{task_id}/dismiss")
async def dismiss(task_id: str, body: Resolution) -> dict[str, Any]:
    return await _resolve(task_id, body, call_tasks.DISMISSED)
