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
    created = await _lead()
    await _created(created)
    await _strand(mongo, created)
    assert not await _pending(mongo, created)
    out = await safety_net.check_dealer(DEALER)
    assert created["lead_id"] in out["planned"] and await _pending(mongo, created)
    # Run again: it has a step now, nothing more is planned.
    assert created["lead_id"] not in (await safety_net.check_dealer(DEALER))["planned"]


async def test_leads_older_than_90_days_and_linked_duplicates_are_left_alone(mongo, live_dealer, monkeypatch):
    old = await _lead()
    await _created(old)
    await _strand(mongo, old, age=timedelta(days=91))  # past its 90-day opportunity
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


async def test_a_customer_with_an_appointment_on_another_lead_is_left_to_that_workflow(mongo, live_dealer, monkeypatch):
    # Christine Pache, 26 Oct 2026: her no-show workflow ran on her other lead; the safety net planned a sales touch too.
    created = await _lead()
    await _created(created)
    await _strand(mongo, created)
    await mongo[AI_LEAD_STATE_COLLECTION].insert_one({"lead_id": "other-lead", "customer_id": created["customer_id"],
                                                      "dealer_id": DEALER, "stage": "appointment_no_show",
                                                      "status": "active"})
    assert created["lead_id"] not in (await safety_net.check_dealer(DEALER))["planned"]



async def test_an_older_lead_and_a_partly_qualified_one_are_picked_up_a_few_an_hour(mongo, live_dealer, monkeypatch):
    """The user, 29 Oct 2026: 552 leads from 20 Sept to mid-October had nothing since 7-8 Oct (the 26 Oct start date left
    them out), and Larry Harris - partly qualified - had no next touch after his no-show. Every open lead under 90
    days, partly qualified ones too, at most MAX_PER_RUN an hour."""
    sept = await _lead()
    await _created(sept)
    await _strand(mongo, sept, age=timedelta(days=39))
    larry = await _lead(name="Larry Test")
    await _created(larry)
    await _strand(mongo, larry, age=timedelta(days=6))
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": larry["lead_id"]}, {"$set": {"status": "partly_qualified"}})
    monkeypatch.setattr(safety_net, "MAX_PER_RUN", 1)
    first = (await safety_net.check_dealer(DEALER))["planned"]
    assert len(first) == 1
    second = (await safety_net.check_dealer(DEALER))["planned"]
    assert set(first + second) == {sept["lead_id"], larry["lead_id"]}
