"""PLAN_4 stream X2: the after-sale defects of audit 3 (SOLD PENDING / SOLD DELIVERED PDFs). Each test here failed
before its fix."""

from datetime import timedelta

import fakeredis.aioredis
import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_sold_lifecycles import (  # noqa: F401  (live_dealer is a fixture)
    DEALER,
    _aware,
    _deps,
    _fire,
    _new_lead,
    _outbox,
    _pending,
    _staff,
    _state,
    live_dealer,
)
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
)
from upsell_agent.scheduler import followups

flow = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")


# --- Item 10: a staff status change never lands in the middle of a SOLD PENDING touch ----------------------------

@flow
async def test_sold_delivered_set_while_a_sold_pending_touch_is_firing_wins(mongo, monkeypatch):
    created = await _new_lead()
    await _staff(created, "Sold Pending")
    real = followups._permitted_channel

    async def staff_deliver_meanwhile(**kw):
        # Staff set Sold Delivered between the touch's first look at the lead and its send (the audit's race).
        monkeypatch.setattr(followups, "_permitted_channel", real)
        await _staff(created, "Sold Delivered")
        return await real(**kw)

    monkeypatch.setattr(followups, "_permitted_channel", staff_deliver_meanwhile)
    before = len(await _outbox(mongo, created))
    doc = await _fire(mongo, created, "sold_pending_touch")
    assert doc["status"] == "cancelled"
    assert len(await _outbox(mongo, created)) == before  # no SOLD PENDING message after delivery
    state = await _state(mongo, created)
    assert state["stage"] == "sold_delivered"
    assert state["sold_pending"]["outcome"] == "SOLD_DELIVERED" and state["sold_pending"]["ended_at"]
    assert await _pending(mongo, created, "sold_pending_touch") == []
    assert await _pending(mongo, created, "call_task") == []


@flow
async def test_a_sold_pending_call_timer_never_opens_after_delivery(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Pending")
    await _fire(mongo, created, "sold_pending_touch")
    [timer] = await _pending(mongo, created, "call_task")
    # The stage change reached the lead but not this timer (a race): its own re-check stops it.
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].update_one({"_id": timer["_id"]}, {"$set": {"status": "pending"}})
    from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]},
                                                     {"$set": {"stage": "sold_delivered"}})
    set_clock(_aware(timer["due_at"]) + timedelta(minutes=1))
    await followups.fire_due(_deps())
    assert await mongo[AI_CALL_TASKS_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 0


async def test_staff_status_changes_run_under_the_lead_lock(mongo):
    from types import SimpleNamespace

    from upsell_agent.agent.turn import TurnDeps
    from upsell_agent.worker import jobs
    from upsell_agent.worker.locks import lead_lock

    queue = SimpleNamespace(enqueued=[])

    async def enqueue(function, **kwargs):
        queue.enqueued.append(function)

    ctx = {"redis": fakeredis.aioredis.FakeRedis(), "deps": TurnDeps(),
           "worker": SimpleNamespace(queue=SimpleNamespace(enqueue=enqueue)), "job": SimpleNamespace(key="k")}
    event = {"event_id": "e1", "dealer_id": DEALER, "lead_id": "lead-1", "reason": 'Staff moved the lead to "DND"'}
    async with lead_lock(ctx["redis"], DEALER, "lead-1", ttl_s=30):
        paused = await jobs.handle_lead_paused(ctx, event=event)
        resumed = await jobs.handle_lead_resumed(ctx, event={"event_id": "e2", "dealer_id": DEALER,
                                                             "lead_id": "lead-1"})
    assert paused["status"] == "requeued" and resumed["status"] == "requeued"
    assert queue.enqueued == ["handle_lead_paused", "handle_lead_resumed"]
