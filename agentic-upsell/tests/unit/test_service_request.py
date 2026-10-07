"""MASTER_PLAN_4 F2: service visits are requested, not booked (client,
scope Q16). Through the real turn pipeline (offline model), like
tests/unit/test_booking_flow.py, plus the pure helpers."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from upsell_agent import clock
from upsell_agent.agent import service_request
from upsell_agent.agent.nodes.guard import invalid_booking_wording
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.turn import TurnDeps, run_turn
from upsell_agent.api.leads import lead_profile
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events.handlers import handle_inbound_message
from upsell_agent.events.models import InboundMessageEvent
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_BOOKINGS_COLLECTION,
)
from upsell_agent.integrations.platform_client import (
    DEV_PLATFORM_MESSAGES_COLLECTION,
    StubPlatformClient,
)
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.slots.profile import build_profile
from upsell_agent.tools import booking_tool

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")

DEALER = simulate.DEV_DEALERS[0]["_id"]


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(lead_type="service", comments="My 2019 Honda Civic needs an oil change"):
    created = await simulate.create_lead(DEALER, lead_type=lead_type, channel="sms", name="Sam Service",
                                         comments=comments)
    await run_turn(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                   trigger="lead_created", channel="sms", inbound_text=comments, shadow=False, deps=_deps())
    return created


async def _say(created, text):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel="sms",
                                text=text, received_at=clock.now())
    return await handle_inbound_message(event, _deps())


async def _last_sms(mongo, created):
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).sort("created_at", -1).to_list(1)
    return rows[0]["text"]


async def _state(mongo, created):
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}


@pytest.fixture
def no_booking(monkeypatch):
    """Fails the test if anything tries to book (POST /api/booking)."""
    calls = []

    async def refuse(*args, **kwargs):
        calls.append(kwargs)
        raise AssertionError("a service visit must never be booked (MASTER_PLAN_4 F2)")

    monkeypatch.setattr(booking_tool, "ensure_booking", refuse)
    monkeypatch.setattr(StubPlatformClient, "create_booking", refuse)
    return calls


async def test_a_service_lead_is_asked_for_a_preferred_time_not_offered_slots(mongo, no_booking):
    created = await _lead()
    await _say(created, "Can I bring it in for service?")
    state = await _state(mongo, created)
    visit = state["conversation"]["visit"]
    assert visit["service_ask"] and visit["offered_times"] == [] and visit["attempts"] == 1
    reply = await _last_sms(mongo, created)
    assert "day and time that suit you" in reply and "service team" in reply
    assert " AM" not in reply and " PM" not in reply  # no concrete slots


async def test_the_request_goes_to_the_team_with_notes_and_nothing_is_booked(mongo, no_booking):
    created = await _lead()
    await _say(created, "Can I bring it in for service?")
    await _say(created, "Thursday morning works, I'll wait for it. It has about 42000 miles")
    state = await _state(mongo, created)

    notice = state["staff_notice"]
    assert notice["kind"] == "service_request"
    assert "Thursday" in notice["text"] and "morning" in notice["text"]
    assert "wants to wait for it" in notice["text"] and "Not booked" in notice["text"]
    assert state["service_requests"][0]["part"] == "morning"
    assert state["conversation"]["visit"]["service_request"]["display"].startswith("Thursday")
    # No booking anywhere.
    assert no_booking == [] and await mongo[PLATFORM_BOOKINGS_COLLECTION].count_documents({}) == 0
    # The reply passes it on, never "booked" / "confirmed".
    reply = await _last_sms(mongo, created)
    assert "passed" in reply and "service team" in reply and "confirm the exact time" in reply
    assert "booked" not in reply.lower() and "confirmed" not in reply.lower()
    # A staff-only note on the lead's conversation (stub platform).
    note = await mongo[DEV_PLATFORM_MESSAGES_COLLECTION].find_one({"lead_id": created["lead_id"], "is_note": True})
    assert note and note["kind"] == "service_request" and "Thursday" in note["text"]
    # And in the lead profile API.
    profile = await lead_profile(DEALER, created["lead_id"])
    assert profile["service_requests"][0]["display"].startswith("Thursday")


async def test_a_visit_request_naming_its_own_time_is_passed_straight_away(mongo, no_booking):
    created = await _lead()
    await _say(created, "Can I bring it in tomorrow at 10am?")
    state = await _state(mongo, created)
    assert state["staff_notice"]["kind"] == "service_request"
    assert state["service_requests"][0]["time"] == "10:00"
    assert await mongo[PLATFORM_BOOKINGS_COLLECTION].count_documents({}) == 0


async def test_sales_leads_still_book(mongo):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test",
                                         comments="Looking for a new Toyota RAV4")
    await run_turn(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                   trigger="lead_created", channel="sms", inbound_text="Looking for a new Toyota RAV4",
                   shadow=False, deps=_deps())
    await _say(created, "My budget is $35,000 and I'd like to buy this month")
    await _say(created, "the first one works")
    assert await mongo[PLATFORM_BOOKINGS_COLLECTION].count_documents({}) == 1


# --- The guard's wording rule ---------------------------------------------------------------

@pytest.mark.parametrize("text", [
    "Great - you're booked for Thursday morning!",
    "Your service visit is confirmed for Thursday.",
    "See you then!",
    "I've scheduled you for Thursday at 10.",
])
def test_booked_wording_on_a_service_request_is_rejected(text):
    decision = {"visit": {"kind": "service", "service_request": {"display": "Thursday morning"}}}
    assert invalid_booking_wording(decision, {"sms_text": text, "email_body": ""})


def test_passed_to_the_service_team_is_allowed():
    decision = {"visit": {"kind": "service", "service_request": {"display": "Thursday morning",
                                                                 "passed_this_turn": True}}}
    text = "I've passed Thursday morning to our service team with your notes; they'll confirm the exact time with you."
    assert invalid_booking_wording(decision, {"sms_text": text, "email_body": text}) == []


def test_requested_without_a_request_is_rejected():
    decision = {"visit": {"kind": "service"}}
    assert invalid_booking_wording(decision, {"sms_text": "I've requested Thursday for you.", "email_body": ""})


# --- Pure helpers -----------------------------------------------------------------------------

async def test_preferred_time_words(mongo):
    dealer = await dealer_profile(DEALER)
    now = datetime(2026, 9, 22, 12, tzinfo=ZoneInfo("America/New_York"))  # a Tuesday
    thursday = service_request.preferred_time("Thursday morning works", dealer, now)
    assert thursday["display"] == "Thursday, September 24 in the morning" and thursday["part"] == "morning"
    exact = service_request.preferred_time("tomorrow at 2pm", dealer, now)
    assert exact["date"] == "2026-09-23" and exact["time"] == "14:00" and "2:00 PM" in exact["display"]
    assert service_request.preferred_time("any morning is best", dealer, now)["display"] == "any morning"
    assert service_request.preferred_time("sounds good", dealer, now) is None


def test_notes_carry_vehicle_mileage_need_and_concerns():
    now = datetime(2026, 9, 22, 12, tzinfo=ZoneInfo("America/New_York"))

    def fact(path, value):
        return {"_id": f"f-{path}", "path": path, "value": value, "pending": False, "source": "bot_extracted",
                "valid_from": now, "observed_at": now}

    profile = build_profile(LeadType.SERVICE, [
        fact("vehicle.year", 2019), fact("vehicle.make", "Honda"), fact("vehicle.model", "Civic"),
        fact("vehicle.mileage", 42000), fact("interest.service_needed", "oil change")], now=now)
    notes = service_request.take_notes(profile, ["I'll need a loaner", "Thursday works, I'll wait for it"])
    assert notes["vehicle"] == "2019 Honda Civic" and notes["mileage"] == 42000 and notes["needs"] == "oil change"
    assert notes["concerns"] == ["wants to wait for it", "needs a loaner"]
    text = service_request.notes_text({**notes, "display": "Thursday morning"})
    assert "mileage: 42,000" in text and "needs: oil change" in text
