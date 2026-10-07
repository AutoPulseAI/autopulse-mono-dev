"""Accept one event: drop duplicates, then queue the job (architecture §2).

Used by the /v1/events routes and by the Debug UI simulator, so a simulated
lead goes through exactly the same path as a real one.
"""

from dataclasses import dataclass
from typing import Literal

from pymongo.errors import DuplicateKeyError

from upsell_agent import clock
from upsell_agent.events.models import EVENT_TYPES, BaseEvent
from upsell_agent.integrations.mongodb import AI_EVENTS_COLLECTION, dealer_scoped_db
from upsell_agent.worker.queue import Enqueue


@dataclass(frozen=True)
class IntakeResult:
    # "skipped": the dealer's AI is off, so no event (devtools/simulate.py only).
    status: Literal["queued", "duplicate", "skipped"]
    job_key: str | None = None


def job_key_for(event_type: str, event_id: str) -> str:
    return f"{event_type}:{event_id}"


async def accept_event(event_type: str, event: BaseEvent, enqueue: Enqueue) -> IntakeResult:
    function, _model = EVENT_TYPES[event_type]
    events = dealer_scoped_db(event.dealer_id).collection(AI_EVENTS_COLLECTION)

    try:
        # _id is the event ID, so the unique _id index is the dedupe check.
        # Auto-deleted after 7 days (TTL index on received_at).
        await events.insert_one(
            {"_id": job_key_for(event_type, event.event_id), "type": event_type, "received_at": clock.now()}
        )
    except DuplicateKeyError:
        return IntakeResult(status="duplicate")

    key = job_key_for(event_type, event.event_id)
    try:
        # received_at: start of the event-to-send latency (target < 2s for a
        # new lead's first reply, architecture §4).
        await enqueue(function, key=key, event=event.model_dump(mode="json"), received_at=clock.now().isoformat())
    except Exception:
        # Queue down: forget the event so the platform's retry isn't treated
        # as a duplicate and silently dropped.
        await events.delete_one({"_id": key})
        raise
    return IntakeResult(status="queued", job_key=key)
