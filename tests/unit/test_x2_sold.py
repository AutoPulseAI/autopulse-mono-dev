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


# --- Item 12: staff outcomes always apply -----------------------------------------------------------------------

@pytest.mark.parametrize(("current", "kind", "expected"), [
    ("opted_out", "sold_delivered", "sold_delivered"),
    ("opted_out", "sold_pending", "sold_pending"),
    ("opted_out", "staff_closed_lost", "closed_lost"),
    ("closed_lost", "sold_delivered", "sold_delivered"),
    ("closed_lost", "sold_pending", "sold_pending"),
    ("closed_no_longer_owns", "sold_delivered", None),  # still terminal
])
def test_a_staff_outcome_takes_effect_on_an_opted_out_or_closed_lead(current, kind, expected):
    from upsell_agent.agent import lifecycle
    moved = lifecycle.transition(lifecycle.Stage(current), lifecycle.Event(kind, source="staff_status"))
    assert (moved.stage.value if moved.stage else None) == expected


def test_opting_back_in_never_restarts_sold_pending_for_a_delivered_car():
    from upsell_agent.agent import lifecycle
    back = lifecycle.transition(lifecycle.Stage.OPTED_OUT, lifecycle.Event(
        "opted_in", detail={"previous": "sold_pending", "delivered": True}))
    assert back.stage == lifecycle.Stage.SOLD_DELIVERED


@flow
async def test_sold_delivered_set_on_an_opted_out_lead_starts_ownership_and_keeps_the_opt_out(mongo):
    from upsell_agent.agent import lifecycle
    from upsell_agent.channels import consent
    from upsell_agent.integrations.mongodb import AI_VEHICLE_OWNERSHIP_COLLECTION, dealer_scoped_db
    created = await _new_lead()
    await _staff(created, "Sold Pending")
    db = dealer_scoped_db(DEALER)
    for channel in ("sms", "email"):
        await consent.set_channel_consent(db, created["customer_id"], channel, False, source="customer_stop",
                                          lead_id=created["lead_id"])
    await lifecycle.apply(db, created["lead_id"], [lifecycle.Event("opted_out", source="customer_stop")])
    assert (await _state(mongo, created))["stage"] == "opted_out"
    await _staff(created, "Sold Delivered")
    state = await _state(mongo, created)
    assert state["stage"] == "sold_delivered" and state["sold_delivered_at"]
    assert await mongo[AI_VEHICLE_OWNERSHIP_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 1
    assert await consent.is_opted_out(db, created["customer_id"], "sms")  # consent untouched
    before = len(await _outbox(mongo, created))
    await _fire(mongo, created, "post_delivery_checkin")
    assert len(await _outbox(mongo, created)) == before  # and nothing reaches an opted-out customer


# --- Item 13: the CRM and the AI agree: a delivered sale isn't closed as lost ----------------------------------

@flow
async def test_closed_lost_on_a_delivered_lead_is_refused_and_pauses_nothing(mongo):
    created = await _new_lead()
    await _staff(created, "Sold Delivered")
    result = await _staff(created, "Closed - Lost")
    assert result["status"] == "refused"
    state = await _state(mongo, created)
    assert state["stage"] == "sold_delivered" and state["status"] == "active"
    assert await _pending(mongo, created, "post_delivery_checkin")  # the ownership lifecycle carries on


# --- Item 14: reading the customer's replies ---------------------------------------------------------------------

@pytest.mark.parametrize(("text", "answer"), [
    ("Yes, Tuesday later in the afternoon works", "yes"),
    ("Yes please", "yes"),
    ("Sure, Saturday morning works for me", "yes"),
    ("That works", "yes"),
    ("ok but I have a question about the screen", "other"),
    ("I have a quick question first", "other"),
    ("Maybe later", "later"),
    ("Not right now, thanks", "later"),
    ("No thanks", "later"),
    ("Later", "later"),
    ("I'll let you know", "later"),
    ("What does the first service include?", "other"),
])
def test_the_answer_to_a_service_offer(text, answer):
    from upsell_agent.agent import sold_delivered
    assert sold_delivered.classify_service_answer(text) == answer


@pytest.mark.parametrize(("text", "route"), [
    ("When can I pick it up?", "human"),
    ("when can i pick her up", "human"),
    ("Can I come get it tomorrow?", "human"),
    ("When is it ready for pickup?", "human"),
    ("I have a question about the color", "ai"),
    ("Yes, I have", "documents_confirmed"),
    ("I did, sent everything last week", "documents_confirmed"),
    ("I've sent my insurance card", "info"),
    ("Thanks!", "ai"),
])
def test_the_sold_pending_router_reads_delivery_questions_and_real_answers(text, route):
    from upsell_agent.agent import sold_pending
    assert sold_pending.classify_reply(text, documents_asked=True)[0] == route
