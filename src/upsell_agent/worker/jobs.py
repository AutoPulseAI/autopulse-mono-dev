"""SAQ job functions. Thin wrappers: parse the payload, take the per-lead lock
and a dealer slot (architecture §12), call the handler.

Each function receives SAQ's `ctx` first. `ctx["deps"]` and `ctx["redis"]`
are built once per worker process in worker/main.py's startup.

A turn that finds its lead locked, or its dealer at the cap, is re-queued
under a new job key instead of blocking a worker slot while it waits: first
`busy_retry_delay_s` later, the wait growing to `busy_retry_max_delay_s`, up
to `busy_retry_max` times (see busy_retry_delay).
"""

import logging
import os
import socket
import time
from collections.abc import Awaitable, Callable
from typing import Any

from upsell_agent.agent import lifecycle, summary
from upsell_agent.config import get_settings
from upsell_agent.events import handlers
from upsell_agent.events.models import (
    InboundMessageEvent,
    LeadCreatedEvent,
    LeadPausedEvent,
    LeadResumedEvent,
)
from upsell_agent.scheduler import followups
from upsell_agent.worker.locks import Busy, dealer_slot, lead_lock
from upsell_agent.worker.queue import JOB_TIMEOUT_S

logger = logging.getLogger(__name__)


async def ping(ctx: dict[str, Any], *, nonce: str) -> dict[str, Any]:
    """Round-trip check used by `make ai-ping` and the Stage 1 scenario."""
    return {"pong": nonce, "worker": f"{socket.gethostname()}:{os.getpid()}"}


def busy_retry_delay(attempt: int) -> float:
    """2s, 2.25s, 2.5s, ... up to 10s: quick while a lead's turn finishes,
    gentle on Redis while a big campaign backlog drains."""
    settings = get_settings()
    return min(settings.busy_retry_max_delay_s, settings.busy_retry_delay_s + 0.25 * attempt)


async def _guarded(
    ctx: dict[str, Any],
    function: str,
    *,
    dealer_id: str,
    lock_id: str,
    event: dict[str, Any],
    received_at: str | None,
    busy_attempt: int,
    run: Callable[[], Awaitable[dict[str, Any]]],
) -> dict[str, Any]:
    settings = get_settings()
    redis = ctx["redis"]
    try:
        async with lead_lock(redis, dealer_id, lock_id, settings.lead_lock_ttl_s), \
                dealer_slot(redis, dealer_id, settings.dealer_max_inflight, settings.lead_lock_ttl_s * 2):
            return await run()
    except Busy as busy:
        if busy_attempt >= settings.busy_retry_max:
            logger.error("%s for %s gave up after %s busy retries: %s", function, lock_id, busy_attempt, busy)
            return {"status": "gave_up", "reason": str(busy)}
        job = ctx.get("job")
        base_key = (job.key if job else f"{function}:{lock_id}").split(":busy")[0]
        await ctx["worker"].queue.enqueue(
            function,
            key=f"{base_key}:busy{busy_attempt + 1}",
            scheduled=int(time.time() + busy_retry_delay(busy_attempt)),
            timeout=JOB_TIMEOUT_S,
            event=event,
            received_at=received_at,
            busy_attempt=busy_attempt + 1,
        )
        return {"status": "requeued", "reason": str(busy), "busy_attempt": busy_attempt + 1}


async def handle_lead_created(ctx: dict[str, Any], *, event: dict[str, Any], received_at: str | None = None,
                              busy_attempt: int = 0) -> dict[str, Any]:
    parsed = LeadCreatedEvent.model_validate(event)
    return await _guarded(
        ctx, "handle_lead_created", dealer_id=parsed.dealer_id, lock_id=parsed.lead_id, event=event,
        received_at=received_at, busy_attempt=busy_attempt,
        run=lambda: handlers.handle_lead_created(parsed, ctx["deps"], received_at),
    )


async def handle_inbound_message(ctx: dict[str, Any], *, event: dict[str, Any], received_at: str | None = None,
                                 busy_attempt: int = 0) -> dict[str, Any]:
    parsed = InboundMessageEvent.model_validate(event)
    # Record the message before waiting on the lead lock, so a turn already
    # running for this lead (or the next one) answers it together with the rest.
    await handlers.record_inbound(parsed)
    return await _guarded(
        ctx, "handle_inbound_message", dealer_id=parsed.dealer_id,
        # Without a lead id the handler finds the customer's latest lead, so
        # lock on the customer: two replies from one customer still serialize.
        lock_id=parsed.lead_id or f"customer:{parsed.customer_id}", event=event,
        received_at=received_at, busy_attempt=busy_attempt,
        run=lambda: handlers.handle_inbound_message(parsed, ctx["deps"], received_at),
    )


async def handle_lead_paused(ctx: dict[str, Any], *, event: dict[str, Any], **_: Any) -> dict[str, Any]:
    return await handlers.handle_lead_paused(LeadPausedEvent.model_validate(event))


async def handle_lead_resumed(ctx: dict[str, Any], *, event: dict[str, Any], **_: Any) -> dict[str, Any]:
    return await handlers.handle_lead_resumed(LeadResumedEvent.model_validate(event))


async def update_summary(ctx: dict[str, Any], *, dealer_id: str, lead_id: str, **_: Any) -> dict[str, Any]:
    """The rolling summary (agent/summary.py), queued by a turn after its send.
    Its own lock, not the lead's: a turn is never kept waiting for a summary,
    and two summary runs for one lead never overlap (the second just skips;
    the next turn queues another if still needed)."""
    settings = get_settings()
    try:
        async with lead_lock(ctx["redis"], dealer_id, f"summary:{lead_id}", settings.lead_lock_ttl_s):
            return await summary.update_summary(dealer_id, lead_id, ctx["deps"])
    except Busy:
        return {"status": "skipped", "reason": "a summary update for this lead is already running"}


async def fire_due_followups(ctx: dict[str, Any], **_: Any) -> dict[str, Any]:
    """The 24h channel switch (scheduler/followups.py). Runs every minute on
    every worker (worker/main.py cron) and on demand when a webhook reports a
    failed message or the dev clock moves. Each follow-up is fired under its
    lead's lock, so it never races a turn for the same lead."""
    settings = get_settings()
    redis = ctx["redis"]
    return await followups.fire_due(
        ctx["deps"], lock=lambda dealer_id, lead_id: lead_lock(redis, dealer_id, lead_id, settings.lead_lock_ttl_s))


async def close_expired_leads(ctx: dict[str, Any], **_: Any) -> dict[str, Any]:
    """MASTER_PLAN_3 C3: the Day 91 sweep (agent/lifecycle.py close_expired).
    Hourly on every worker (worker/main.py cron); each close is one atomic
    update, so two workers running it together close a lead once."""
    return await lifecycle.close_expired()


FUNCTIONS = [ping, handle_lead_created, handle_inbound_message, handle_lead_paused, handle_lead_resumed,
             fire_due_followups, update_summary, close_expired_leads]
