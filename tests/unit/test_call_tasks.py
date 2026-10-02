"""MASTER_PLAN_3 C2: the staff call task behind the 60-minute connection timer
(agent/call_tasks.py, scheduler/followups.py, compliance/call_check.py).
Dealer A is in New York, open Monday-Friday 9:00-19:00; calls are allowed
8:00-21:00 customer time. The clock is moved; nothing waits."""

from datetime import UTC, datetime, timedelta

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent import call_tasks, lifecycle
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.api.call_tasks import list_tasks
from upsell_agent.api.leads import lead_profile
from upsell_agent.channels import consent
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.compliance.call_check import can_call
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent, LeadPausedEvent
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_COMPLIANCE_LOG_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import followups

DEALER = simulate.DEV_DEALERS[0]["_id"]
pytestmark = pytest.mark.usefixtures("ny_customer")
START = datetime(2026, 9, 22, 14, 0, tzinfo=UTC)  # Tuesday 10:00 in New York
HOUR = timedelta(hours=1)


@pytest.fixture(autouse=True)
def daytime_start():
    set_clock(START)


@pytest.fixture
async def live_dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one(
        {"_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True}})


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead():
    return await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Cora Call",
                                      comments="Hi, I want a new Toyota RAV4")


async def _first_reply(created):
    return await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel="sms"), _deps())


async def _timers(mongo, created, status=None):
    flt = {"lead_id": created["lead_id"], "kind": "call_task", **({"status": status} if status else {})}
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(flt).to_list(None)


async def _tasks(mongo, created):
    return await mongo[AI_CALL_TASKS_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)


async def _say(created, text):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel="sms", text=text,
                                received_at=clock.now())
    return await handlers.handle_inbound_message(event, _deps())


async def _fire():
    return (await followups.fire_due(_deps()))["results"]


async def _state(mongo, created):
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})


async def _planned_timer(created, *, stage="new_lead"):
    """A call timer planned by hand (to control the time it falls due)."""
    db = dealer_scoped_db(DEALER)
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": ObjectId(created["lead_id"])})
    return await followups.plan_call_task(db, lead_id=created["lead_id"], customer_id=created["customer_id"],
                                          turn_id="t1", lead=lead, customer=None, lead_state={"stage": stage},
                                          sent_channels=["sms"])


# --- The timer ------------------------------------------------------------------------

async def test_a_touch_that_went_out_starts_a_60_minute_timer(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    [timer] = await _timers(mongo, created, "pending")
    assert timer["to"].startswith("+1") and timer["to_channel"] == "voice"
    assert abs((timer["due_at"].replace(tzinfo=UTC) - clock.now()) - HOUR) < timedelta(seconds=5)
    profile = await lead_profile(DEALER, created["lead_id"])
    assert profile["pending_call_timer"]["due_at"] and profile["call_task"] is None


async def test_no_contact_in_an_hour_opens_the_call_task_for_staff(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    set_clock(START + timedelta(minutes=59))
    assert "activated" not in await _fire()
    assert await _tasks(mongo, created) == []

    set_clock(START + timedelta(minutes=61))
    assert (await _fire())["activated"] == 1
    [task] = await _tasks(mongo, created)
    assert task["status"] == "open" and task["phone"].startswith("+1") and task["customer_name"] == "Cora Call"
    state = await _state(mongo, created)
    assert state["staff_notice"]["kind"] == "call_task" and task["phone"] in state["staff_notice"]["text"]
    assert (await lead_profile(DEALER, created["lead_id"]))["call_task"]["status"] == "open"
    assert [t["id"] for t in await list_tasks(DEALER, "open")] == [str(task["_id"])]
    # The decision is on the compliance log as a human call, not an AI call.
    logged = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"channel": "voice", "purpose": "human_call"})
    assert logged["decision"] == "ALLOW" and logged["source"] == "call_task"


async def test_a_reply_inside_the_hour_cancels_the_call(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    set_clock(START + timedelta(minutes=20))
    await _say(created, "Interested in the RAV4, budget is around thirty thousand")
    assert [t["status"] for t in await _timers(mongo, created)] == ["cancelled"]
    set_clock(START + timedelta(minutes=70))
    assert "activated" not in await _fire()
    assert await _tasks(mongo, created) == []


async def test_an_auto_reply_is_not_contact(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    set_clock(START + timedelta(minutes=20))
    await _say(created, "Automatic reply: I am out of the office until Monday")
    set_clock(START + timedelta(minutes=61))
    assert (await _fire())["activated"] == 1


async def test_a_reply_after_it_opened_closes_the_open_task(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    set_clock(START + timedelta(minutes=61))
    await _fire()
    await _say(created, "Sorry, was driving. Yes, still looking at the RAV4")
    [task] = await _tasks(mongo, created)
    assert task["status"] == "cancelled" and "replied" in task["closed_reason"]
    assert "call_task" not in (await _state(mongo, created))


async def test_staff_taking_over_cancels_the_waiting_and_the_open_call(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    await handlers.handle_lead_paused(LeadPausedEvent(event_id="p1", dealer_id=DEALER, lead_id=created["lead_id"],
                                                      reason="Staff replied"))
    assert [t["status"] for t in await _timers(mongo, created)] == ["cancelled"]

    other = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Opal Open",
                                       comments="Looking at a Civic")
    await _first_reply(other)
    set_clock(START + timedelta(minutes=61))
    await _fire()
    [task] = await _tasks(mongo, other)
    assert task["status"] == "open"
    await handlers.handle_lead_paused(LeadPausedEvent(event_id="p2", dealer_id=DEALER, lead_id=other["lead_id"],
                                                      reason="Staff replied"))
    assert (await _tasks(mongo, other))[0]["status"] == "cancelled"


async def test_a_newer_touch_replaces_the_waiting_timer_and_an_open_task_is_not_doubled(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    again = await _planned_timer(created)
    assert again["created"] and again["superseded"] == 1
    assert sorted(t["status"] for t in await _timers(mongo, created)) == ["pending", "superseded"]
    set_clock(START + timedelta(minutes=61))
    await _fire()
    assert (await _planned_timer(created))["reason"] == "a call task is already open for staff"


# --- Re-checks and the calling rules -----------------------------------------------------

async def test_a_stage_that_no_longer_wants_a_call_cancels_it_before_it_opens(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    # Moved on without the stage change reaching this timer (a race): the pre-activation re-check catches it.
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]},
                                                     {"$set": {"stage": "appointment_set"}})
    set_clock(START + timedelta(minutes=61))
    assert (await _fire())["cancelled"] == 1
    assert await _tasks(mongo, created) == []
    [timer] = await _timers(mongo, created)
    assert "appointment" in timer["reason"].lower()


async def test_a_stage_change_cancels_the_timer_and_an_open_task(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    await lifecycle.apply(dealer_scoped_db(DEALER), created["lead_id"], [lifecycle.Event(
        "appointment_set", reason="Booked", detail={"appointment": {"display": "Thu 10:00"}})])
    assert [t["status"] for t in await _timers(mongo, created)] == ["cancelled"]

    other = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Opal Open",
                                       comments="Looking at a Civic")
    await _first_reply(other)
    set_clock(START + timedelta(minutes=61))
    await _fire()
    assert (await _tasks(mongo, other))[0]["status"] == "open"
    await lifecycle.apply(dealer_scoped_db(DEALER), other["lead_id"], [lifecycle.Event("sales_visit", reason="Visited")])
    assert (await _tasks(mongo, other))[0]["status"] == "cancelled"


async def test_outside_calling_hours_the_task_waits_for_the_next_allowed_time(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].delete_many({"lead_id": created["lead_id"]})
    set_clock(datetime(2026, 9, 22, 22, 30, tzinfo=UTC))  # 18:30 in New York, dealer open until 19:00
    await _planned_timer(created)
    set_clock(datetime(2026, 9, 22, 23, 35, tzinfo=UTC))  # 19:35: the dealer has closed
    assert (await _fire())["deferred"] == 1
    assert await _tasks(mongo, created) == []
    [timer] = await _timers(mongo, created, "pending")
    due = timer["due_at"].replace(tzinfo=UTC)
    assert due == datetime(2026, 9, 23, 13, 0, tzinfo=UTC)  # Wednesday 9:00 in New York
    assert "next calling time" in timer["reason"]
    set_clock(due)
    assert (await _fire())["activated"] == 1


@pytest.mark.parametrize("blocker", ["voice_opt_out", "dnd", "invalid_phone"])
async def test_a_call_that_is_not_allowed_is_never_opened(mongo, live_dealer, blocker):
    created = await _lead()
    await _first_reply(created)
    db = dealer_scoped_db(DEALER)
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(created["lead_id"])})
    if blocker == "voice_opt_out":
        await consent.set_channel_consent(db, created["customer_id"], "voice", False, source="customer_opt_out_phrase",
                                          address=lead["phone"])
    elif blocker == "dnd":
        await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": lead["_id"]}, {"$set": {"fe_lead_status": "DND"}})
    else:
        await consent.mark_invalid(db, channel="sms", address=lead["phone"], reason="wrong number", source="test")
        await mongo["customers"].update_many({}, {"$set": {"phones": []}})
    set_clock(START + timedelta(minutes=61))
    decision = await can_call(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                              record=False)
    assert decision.outcome == "BLOCK"
    results = await _fire()
    assert results.get("suppressed") == 1 and await _tasks(mongo, created) == []


async def test_a_sms_only_opt_out_does_not_stop_the_call(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    await _say(created, "STOP")
    set_clock(START + timedelta(minutes=61))
    # STOP is a text opt-out; the 60-minute call is a person phoning. Stop wins only for "don't call me".
    decision = await can_call(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                              record=False)
    assert decision.outcome == "ALLOW"


async def test_dont_call_me_blocks_the_call(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    await _say(created, "please don't call me")
    decision = await can_call(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                              record=False)
    assert decision.outcome == "BLOCK" and decision.rule == "opted_out"


# --- Staff finishing the task -----------------------------------------------------------

async def test_staff_complete_or_dismiss_an_open_task(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    set_clock(START + timedelta(minutes=61))
    await _fire()
    [task] = await _tasks(mongo, created)
    done = await call_tasks.resolve(dealer_scoped_db(DEALER), str(task["_id"]), status=call_tasks.COMPLETED,
                                    outcome="connected", note="Coming Thursday", by="staff-1")
    assert done["status"] == "completed" and done["outcome"] == "connected" and done["closed_by"] == "staff-1"
    assert "call_task" not in (await _state(mongo, created))
    assert await list_tasks(DEALER, "open") == []
    # Resolving again changes nothing.
    again = await call_tasks.resolve(dealer_scoped_db(DEALER), str(task["_id"]), status=call_tasks.DISMISSED)
    assert again["status"] == "completed"
    assert await call_tasks.resolve(dealer_scoped_db(DEALER), "not-an-id", status=call_tasks.DISMISSED) is None


async def test_one_dealers_tasks_are_not_visible_to_another(mongo, live_dealer):
    created = await _lead()
    await _first_reply(created)
    set_clock(START + timedelta(minutes=61))
    await _fire()
    other_dealer = simulate.DEV_DEALERS[1]["_id"]
    assert await list_tasks(other_dealer, "open") == []
