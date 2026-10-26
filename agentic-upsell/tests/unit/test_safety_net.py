"""The safety net (scheduler/safety_net.py) - the user, 26 Oct 2026: about 100 active leads since live sending had no next
step planned. Every active lead in a working stage gets one; older leads and duplicates are left alone."""

from datetime import timedelta

from tests.unit.test_c6 import DEALER, _car, _created, _lead, live_dealer  # noqa: F401
from upsell_agent import clock
from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION, SCHEDULED_FOLLOWUPS_COLLECTION
from upsell_agent.scheduler import safety_net


async def _strand(mongo, created, *, age=timedelta(hours=2)):
    """The lead as live left them: active, nothing planned, settled."""
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].update_many(
        {"lead_id": created["lead_id"], "status": {"$in": ["pending", "standby", "claimed"]}},
        {"$set": {"status": "cancelled", "reason": "test: the gap"}})
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]}, {"$set": {
        "status": "active", "stage": "no_contact_made", "opportunity_created_at": clock.now() - age,
        "status_at": clock.now() - age}})


async def _pending(mongo, created):
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "status": "pending", "kind": {"$ne": "daily_call_task"}})


async def test_an_active_lead_with_nothing_planned_gets_its_next_touch(mongo, live_dealer, monkeypatch):
    monkeypatch.setattr(safety_net, "SAFETY_NET_FROM", clock.now() - timedelta(days=30))
    created = await _lead()
    await _created(created)
    await _strand(mongo, created)
    assert not await _pending(mongo, created)
    out = await safety_net.check_dealer(DEALER)
    assert created["lead_id"] in out["planned"] and await _pending(mongo, created)
    # Run again: it has a step now, nothing more is planned.
    assert created["lead_id"] not in (await safety_net.check_dealer(DEALER))["planned"]


async def test_leads_before_the_start_and_linked_duplicates_are_left_alone(mongo, live_dealer, monkeypatch):
    monkeypatch.setattr(safety_net, "SAFETY_NET_FROM", clock.now() - timedelta(hours=1))
    old = await _lead()
    await _created(old)
    await _strand(mongo, old, age=timedelta(days=3))  # came in before the safety net's start
    first = await _lead(name="Dup Test")
    await _car(mongo, first, "Acura", "MDX")
    await _created(first)
    dup = await _lead(name="Dup Test", customer_id=first["customer_id"])
    await _car(mongo, dup, "Acura", "MDX")
    await _created(dup)
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": dup["lead_id"]}, {"$set": {
        "status": "active", "stage": "no_contact_made", "opportunity_created_at": clock.now() - timedelta(minutes=40),
        "status_at": clock.now() - timedelta(minutes=40)}})
    planned = (await safety_net.check_dealer(DEALER))["planned"]
    assert old["lead_id"] not in planned and dup["lead_id"] not in planned
