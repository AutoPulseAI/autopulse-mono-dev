"""Worker job wrappers (MASTER_PLAN_1 Stage 4): turns for one lead run one
after the other, a busy lead or dealer re-queues the job instead of blocking,
and a job gives up cleanly after too many busy retries."""

import asyncio
from types import SimpleNamespace

import fakeredis.aioredis
import pytest

from upsell_agent.agent.turn import TurnDeps
from upsell_agent.config import get_settings
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import AI_TURN_LOG_COLLECTION, DEV_OUTBOX_COLLECTION
from upsell_agent.worker import jobs
from upsell_agent.worker.locks import dealer_inflight_key, lead_lock

DEALER = simulate.DEV_DEALERS[0]["_id"]


class RecordingQueue:
    def __init__(self):
        self.enqueued: list[dict] = []

    async def enqueue(self, function, **kwargs):
        self.enqueued.append({"function": function, **kwargs})


@pytest.fixture
def ctx():
    queue = RecordingQueue()
    return {
        "redis": fakeredis.aioredis.FakeRedis(),
        "deps": TurnDeps(),
        "worker": SimpleNamespace(queue=queue),
        "job": SimpleNamespace(key="lead-created:abc"),
        "queue": queue,
    }


async def _lead_event():
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Q", comments="hi")
    event = {"event_id": created["lead_id"], "dealer_id": DEALER, "lead_id": created["lead_id"],
             "customer_id": created["customer_id"], "channel": "sms"}
    return created, event


async def test_runs_the_turn_when_free(mongo, ctx):
    created, event = await _lead_event()
    result = await jobs.handle_lead_created(ctx, event=event, received_at=None)
    assert result["status"] == "done" and result["send_status"] == "sent"
    assert await mongo[DEV_OUTBOX_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 1


async def test_busy_lead_is_requeued_not_run(mongo, ctx):
    created, event = await _lead_event()
    async with lead_lock(ctx["redis"], DEALER, created["lead_id"], ttl_s=30):
        result = await jobs.handle_lead_created(ctx, event=event, received_at="2026-09-24T10:00:00+00:00")
    assert result["status"] == "requeued" and result["busy_attempt"] == 1
    [requeued] = ctx["queue"].enqueued
    assert requeued["function"] == "handle_lead_created"
    assert requeued["key"] == "lead-created:abc:busy1" and requeued["busy_attempt"] == 1
    assert requeued["received_at"] == "2026-09-24T10:00:00+00:00"  # latency still measured from the original event
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({}) == 0


async def test_dealer_at_cap_is_requeued(mongo, ctx):
    _, event = await _lead_event()
    await ctx["redis"].set(dealer_inflight_key(DEALER), get_settings().dealer_max_inflight)
    result = await jobs.handle_lead_created(ctx, event=event)
    assert result["status"] == "requeued"


async def test_gives_up_after_too_many_busy_retries(mongo, ctx):
    created, event = await _lead_event()
    async with lead_lock(ctx["redis"], DEALER, created["lead_id"], ttl_s=30):
        result = await jobs.handle_lead_created(ctx, event=event, busy_attempt=get_settings().busy_retry_max)
    assert result["status"] == "gave_up" and ctx["queue"].enqueued == []


async def test_two_jobs_for_one_lead_run_one_after_the_other(mongo, ctx):
    """Run two replies for the same lead at the same time: exactly one runs,
    the other is re-queued; the requeued one then runs on its own."""
    created, _ = await _lead_event()

    def reply(text: str, event_id: str) -> dict:
        return {"event_id": event_id, "dealer_id": DEALER, "customer_id": created["customer_id"],
                "lead_id": created["lead_id"], "channel": "sms", "message_id": event_id, "text": text,
                "received_at": "2026-09-24T10:00:00+00:00"}

    results = await asyncio.gather(
        jobs.handle_inbound_message(ctx, event=reply("first", "m1")),
        jobs.handle_inbound_message(ctx, event=reply("second", "m2")),
    )
    assert sorted(r["status"] for r in results) == ["done", "requeued"]
    [requeued] = ctx["queue"].enqueued
    rerun = await jobs.handle_inbound_message(ctx, event=requeued["event"], busy_attempt=requeued["busy_attempt"])
    assert rerun["status"] == "done"
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 2
