"""The job queue shared by the API (which enqueues) and the worker (which runs).

SAQ on Redis, not arq: arq pins redis-py below 6, which conflicts with
langgraph-checkpoint-redis. SAQ runs on the same Redis logical DB as the rest
of this service (REDIS_URL, db 1), never the platform's BullMQ db.
"""

from typing import Any, Protocol

from saq import Queue

from upsell_agent.config import Settings

# Generous per-job timeout: a turn is capped at 20s by its own deadline
# (architecture §7); this only stops a truly stuck job holding a worker slot. PLAN_4 stream X3 item 10: above the
# worst real turn (model calls plus three 15 s send attempts), so a slow send is not killed mid-call and left
# `unknown`; the lead lock is kept alive by its heartbeat meanwhile (worker/locks.py).
JOB_TIMEOUT_S = 180


class Enqueue(Protocol):
    async def __call__(self, function: str, *, key: str, **kwargs: Any) -> str | None: ...


def make_queue(settings: Settings) -> Queue:
    return Queue.from_url(settings.redis_url, name=settings.queue_name)


def make_enqueue(queue: Queue) -> Enqueue:
    """Returns an enqueue function. `key` doubles as SAQ's job key, so the same
    event can't be queued twice even if two API requests race past the
    ai_events dedupe. Returns the job key, or None if already queued."""

    async def enqueue(function: str, *, key: str, **kwargs: Any) -> str | None:
        job = await queue.enqueue(function, key=key, timeout=JOB_TIMEOUT_S, retries=3, retry_backoff=True, **kwargs)
        return job.key if job else None

    return enqueue
