"""PLAN_4 stream H extra scope: the outcome staff record after a call reaches the AI (agent/call_outcomes.py via
POST /v1/call-tasks/{id}/complete, api/call_tasks.py). Dealer A is in New York; the clock is moved."""

from datetime import UTC, datetime, timedelta

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.api.call_tasks import Resolution, complete
from upsell_agent.channels import consent
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
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


@pytest.fixture(autouse=True)
async def live_dealer(mongo):
    set_clock(START)
    await mongo[PLATFORM_USERS_COLLECTION].insert_one(
        {"_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True}})


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _open_task(mongo):
    """A lead whose 60-minute call task has opened for staff."""
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Olly Outcome",
                                         comments="Hi, I want a new Toyota RAV4")
    await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel="sms"), _deps())
    set_clock(START + timedelta(minutes=61))
    await followups.fire_due(_deps())
    [task] = await mongo[AI_CALL_TASKS_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    return created, str(task["_id"])


async def _state(mongo, created):
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})


async def _done(task_id, **body):
    return await complete(task_id, Resolution(dealer_id=DEALER, outcome=body.pop("outcome", "connected"),
                                              by="Sam Staff", **body))


async def test_a_specific_follow_up_becomes_the_ais_dated_next_step(mongo):
    created, task_id = await _open_task(mongo)
    out = await _done(task_id, lead_outcome="specific_followup", follow_up={
        "date": "2026-09-25", "time": "15:30", "channel": "sms", "owner": "ai", "notes": "Talk numbers on the RAV4"})
    assert out["status"] == "completed" and out["lead_outcome"] == "specific_followup"
    state = await _state(mongo, created)
    assert state["stage"] == "contact_made_specific_followup"
    action = state["next_action"]
    # The same structure the AI builds for "call me Friday" (Omnichannel PDF §6), entered by staff.
    assert (action["date"], action["time"], action["channel"], action["owner"]) == ("2026-09-25", "15:30", "sms", "ai")
    assert action["entered_by"] == "Sam Staff" and action["entered_at"] and "RAV4" in action["context_notes"]
    [step] = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": "next_action", "status": "pending"}).to_list(None)
    assert step["due_at"].replace(tzinfo=UTC) == datetime(2026, 9, 25, 19, 30, tzinfo=UTC)  # 15:30 New York
    # Resubmitting the same outcome doesn't schedule it twice.
    await _done(task_id, lead_outcome="specific_followup", follow_up={"date": "2026-09-25"})
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "kind": "next_action", "status": "pending"}) == 1


async def test_a_phone_follow_up_owned_by_a_person_is_recorded_not_sent(mongo):
    created, task_id = await _open_task(mongo)
    await _done(task_id, lead_outcome="specific_followup",
                follow_up={"date": "2026-09-28", "channel": "voice", "owner": "human"})
    state = await _state(mongo, created)
    assert state["stage"] == "contact_made_specific_followup"
    assert state["next_action"]["owner"] == "human" and state["next_action"]["call_requested"] is True
    assert state["next_action"]["time"] == "10:00"  # the dealer default
    assert not await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "kind": "next_action", "status": "pending"})


async def test_contact_no_next_action_keeps_the_short_term_cadence_going(mongo):
    created, task_id = await _open_task(mongo)
    await _done(task_id, lead_outcome="contact_no_action")
    state = await _state(mongo, created)
    assert state["stage"] == "contact_made_no_next_action"
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "kind": "cadence_touch", "status": "pending"})


async def test_no_contact_leaves_the_lead_in_its_flow(mongo):
    created, task_id = await _open_task(mongo)
    before = (await _state(mongo, created))["stage"]
    out = await _done(task_id, outcome="no_answer", lead_outcome="no_contact")
    assert out["applied"]["applied"] is False and (await _state(mongo, created))["stage"] == before


async def test_wrong_number_marks_the_phone_invalid_with_a_bad_contact_notice(mongo):
    created, task_id = await _open_task(mongo)
    task = await mongo[AI_CALL_TASKS_COLLECTION].find_one({"_id": ObjectId(task_id)})
    await _done(task_id, outcome="wrong_number", lead_outcome="wrong_number")
    assert await consent.is_invalid(dealer_scoped_db(DEALER), "sms", task["phone"])
    state = await _state(mongo, created)
    assert state["staff_notice"]["kind"] == "bad_contact" and "wrong number" in state["staff_notice"]["text"]


async def test_opted_out_on_a_call_writes_the_ais_consent_on_every_channel(mongo):
    created, task_id = await _open_task(mongo)
    await _done(task_id, lead_outcome="opted_out")
    db = dealer_scoped_db(DEALER)
    for channel in ("sms", "email", "voice"):
        assert await consent.is_opted_out(db, created["customer_id"], channel)
    assert (await _state(mongo, created))["stage"] == "opted_out"


async def test_dont_call_only_stops_calls(mongo):
    created, task_id = await _open_task(mongo)
    await _done(task_id, lead_outcome="opted_out", opt_out_scope="voice")
    db = dealer_scoped_db(DEALER)
    assert await consent.is_opted_out(db, created["customer_id"], "voice")
    assert not await consent.is_opted_out(db, created["customer_id"], "sms")
    assert (await _state(mongo, created))["staff_notice"]["kind"] == "do_not_call"


async def test_appointment_is_left_to_the_crm_booking_flow(mongo):
    _, task_id = await _open_task(mongo)
    out = await _done(task_id, lead_outcome="appointment")
    assert out["applied"]["applied"] is False and "booking flow" in out["applied"]["reason"]


async def test_a_handed_off_lead_goes_back_to_the_ai_when_it_owns_the_next_step(mongo):
    created, _ = await _open_task(mongo)
    await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        message_id=f"m-{ObjectId()}", channel="sms", text="Can someone call me?", received_at=clock.now()), _deps())
    assert (await _state(mongo, created))["status"] == "handoff"
    [task] = await mongo[AI_CALL_TASKS_COLLECTION].find({"lead_id": created["lead_id"], "status": "open"}).to_list(None)
    await _done(str(task["_id"]), lead_outcome="contact_no_action")
    assert (await _state(mongo, created))["status"] == "active"
