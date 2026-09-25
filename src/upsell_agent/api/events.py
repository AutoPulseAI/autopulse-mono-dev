"""POST /v1/events/* — how the platform tells this service something happened
(architecture §11). Every route checks the shared secret, drops duplicate
event IDs, queues a job and returns straight away; the worker does the work.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import ValidationError

from upsell_agent.api.auth import require_internal_auth
from upsell_agent.events.intake import accept_event
from upsell_agent.events.models import EVENT_TYPES

router = APIRouter(prefix="/v1/events", tags=["events"], dependencies=[Depends(require_internal_auth)])


@router.post("/{event_type}", status_code=status.HTTP_202_ACCEPTED)
async def post_event(event_type: str, request: Request, response: Response) -> dict:
    if event_type not in EVENT_TYPES:
        raise HTTPException(status_code=404, detail=f"Unknown event type {event_type!r}")
    _function, model = EVENT_TYPES[event_type]
    try:
        event = model.model_validate(await request.json())
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from exc

    try:
        result = await accept_event(event_type, event, request.app.state.enqueue)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Queue unavailable; retry the event") from exc

    if result.status == "duplicate":
        response.status_code = status.HTTP_200_OK
        return {"status": "duplicate"}
    return {"status": "queued", "job_key": result.job_key}
