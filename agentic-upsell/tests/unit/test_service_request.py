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


# --- "10 am" with no day, plural parts of the day, and promises that must reach staff -------------------------

async def test_a_bare_clock_time_or_plural_part_of_day_is_still_a_request(mongo):
    dealer = await dealer_profile(DEALER)
    now = datetime(2026, 9, 22, 12, tzinfo=ZoneInfo("America/New_York"))
    bare = service_request.preferred_time("10 am", dealer, now)
    assert bare["time"] == "10:00" and bare["date"] is None and bare["day_missing"] and bare["display"] == "10:00 AM"
    assert service_request.preferred_time("2:30pm", dealer, now)["time"] == "14:30"
    assert service_request.preferred_time("Mornings", dealer, now)["display"] == "any morning"
    # Numbers that aren't a clock time are not a request (mileage, "3 tires").
    assert service_request.preferred_time("100000 miles", dealer, now) is None
    assert service_request.preferred_time("I need 4 tires", dealer, now) is None
    # A day still wins: "Thursday 10 am" is a full request.
    full = service_request.preferred_time("Thursday 10 am", dealer, now)
    assert full["date"] == "2026-09-24" and full["time"] == "10:00" and not full["day_missing"]


async def test_the_chat_that_lost_its_alert_now_reaches_the_team(mongo, no_booking):
    # A service lead, asked for a time; the customer answers just "10 am" (no day).
    created = await _lead()
    await _say(created, "Can I bring it in for service?")
    await _say(created, "10 am")
    state = await _state(mongo, created)
    assert state["staff_notice"]["kind"] == "service_request"
    assert "10:00 AM" in state["staff_notice"]["text"] and "ask which day" in state["staff_notice"]["text"]
    assert state["service_requests"][0]["time"] == "10:00"
    assert await mongo[PLATFORM_BOOKINGS_COLLECTION].count_documents({}) == 0
    reply = await _last_sms(mongo, created)
    assert "appointment" not in reply.lower() and "booked" not in reply.lower()


@pytest.mark.parametrize("text", [
    "Got it. I've noted your 10 AM appointment for the tire change.",
    "I've noted the appointment. The team will reach out.",
    "Your appointment is noted.",
])
def test_naming_an_appointment_on_a_service_request_is_rejected(text):
    decision = {"visit": {"kind": "service", "service_request": {"display": "10:00 AM", "passed_this_turn": True}}}
    assert invalid_booking_wording(decision, {"sms_text": text, "email_body": ""})


def test_asking_to_set_up_a_visit_is_not_an_appointment_claim():
    decision = {"visit": {"kind": "service"}}
    text = "Happy to help - what day and time suit you? I'll pass it to our service team."
    assert invalid_booking_wording(decision, {"sms_text": text, "email_body": text}) == []


async def test_a_team_promise_always_leaves_a_notice_unless_one_is_waiting(mongo):
    from upsell_agent.agent.turn import _notify_team_of_promises
    from upsell_agent.integrations.mongodb import dealer_scoped_db

    db = dealer_scoped_db(DEALER)
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    result = {"draft": {"promises": ["The team will reach out with next steps.", ""]}}

    # No notice yet: the promise becomes one.
    await states.insert_one({"lead_id": "lead-promise", "dealer_id": DEALER})
    await _notify_team_of_promises(db, "lead-promise", result)
    notice = (await states.find_one({"lead_id": "lead-promise"}))["staff_notice"]
    assert notice["kind"] == "team_promise" and "reach out" in notice["text"]

    # An unhandled notice is never replaced by it.
    await states.update_one({"lead_id": "lead-promise"},
                            {"$set": {"staff_notice": {"at": clock.now(), "kind": "service_request", "text": "keep me"}}})
    await _notify_team_of_promises(db, "lead-promise", result)
    assert (await states.find_one({"lead_id": "lead-promise"}))["staff_notice"]["text"] == "keep me"

    # A handled one can be.
    current = (await states.find_one({"lead_id": "lead-promise"}))["staff_notice"]
    await states.update_one({"lead_id": "lead-promise"},
                            {"$set": {"handled_notices.notice": {"notice_at": current["at"], "at": clock.now()}}})
    await _notify_team_of_promises(db, "lead-promise", result)
    assert (await states.find_one({"lead_id": "lead-promise"}))["staff_notice"]["kind"] == "team_promise"

    # No promise, no notice.
    await states.insert_one({"lead_id": "lead-none", "dealer_id": DEALER})
    await _notify_team_of_promises(db, "lead-none", {"draft": {"promises": []}})
    assert "staff_notice" not in await states.find_one({"lead_id": "lead-none"})


@pytest.mark.parametrize("text, display, clock", [
    ("ten in morning sounds good for me", "10:00 AM", "10:00"),
    ("ten in the morning", "10:00 AM", "10:00"),
    ("10 in the morning", "10:00 AM", "10:00"),
    ("ten am", "10:00 AM", "10:00"),
    ("10 o'clock", "10:00 AM", "10:00"),
    ("at 10", "10:00 AM", "10:00"),
    ("10:30", "10:30 AM", "10:30"),
    ("ten thirty am", "10:30 AM", "10:30"),
    ("2 in the afternoon", "2:00 PM", "14:00"),
    ("around 3", "3:00 PM", "15:00"),   # a dealership hour: 1-7 means the afternoon
    ("6 pm works", "6:00 PM", "18:00"),
])
async def test_clock_times_said_in_words_or_without_am_pm(mongo, text, display, clock):
    dealer = await dealer_profile(DEALER)
    now = datetime(2026, 9, 22, 12, tzinfo=ZoneInfo("America/New_York"))
    found = service_request.preferred_time(text, dealer, now)
    assert found["display"] == display and found["time"] == clock and found["day_missing"]


async def test_a_clock_time_is_added_to_a_named_day(mongo):
    dealer = await dealer_profile(DEALER)
    now = datetime(2026, 9, 22, 12, tzinfo=ZoneInfo("America/New_York"))  # a Tuesday
    found = service_request.preferred_time("tomorrow at ten", dealer, now)
    assert found["date"] == "2026-09-23" and found["time"] == "10:00" and not found["day_missing"]
    assert found["display"] == "Wednesday, September 23 at 10:00 AM"


@pytest.mark.parametrize("text", [
    "100000 miles", "I need 4 tires", "about 10 miles a day", "around 10k", "my 2019 Civic", "it's a 2.0 engine",
    "I have 3 kids", "sounds good", "about 12 years old", "at 10 miles an hour",
])
async def test_numbers_that_are_not_an_hour_are_not_a_time(mongo, text):
    dealer = await dealer_profile(DEALER)
    now = datetime(2026, 9, 22, 12, tzinfo=ZoneInfo("America/New_York"))
    assert service_request.preferred_time(text, dealer, now) is None


# --- The model's reading: any wording is passed on, understood or not -------------------------------------------

async def test_the_models_visit_when_is_read_by_code_first_then_kept_in_their_words(mongo):
    dealer = await dealer_profile(DEALER)
    now = datetime(2026, 9, 22, 12, tzinfo=ZoneInfo("America/New_York"))  # a Tuesday

    # The message itself defeats the parser, but the model's own words don't: the code reads them.
    cleaned = service_request.from_extraction(
        {"visit_when": "Thursday at 10 am", "visit_when_confidence": 0.9}, dealer, now)
    assert cleaned["date"] == "2026-09-24" and cleaned["time"] == "10:00" and not cleaned.get("unparsed")

    # Wording no parser could read: passed anyway, in their exact words, marked for the team to confirm.
    odd = service_request.from_extraction(
        {"visit_when": "after the kids are at school", "visit_when_confidence": 0.9}, dealer, now)
    assert odd["unparsed"] and odd["display"] == '"after the kids are at school"' and odd["date"] is None
    text = service_request.notes_text({**odd, "vehicle": "2022 Honda Civic"})
    assert "after the kids are at school" in text and "confirm with them" in text

    # Nothing said, or not sure: nothing is invented.
    assert service_request.from_extraction({"visit_when": None}, dealer, now) is None
    assert service_request.from_extraction({"visit_when": "maybe", "visit_when_confidence": 0.3}, dealer, now) is None


@pytest.mark.parametrize("answer", [
    "after the kids are at school",
    "Thursdays are usually good for me",
    "whenever you open tomorrow works",
    "sometime next week, I'll let you know",
    "ten in morning sounds good for me",
    "my shift ends at 4 so after that",
])
async def test_any_answer_to_the_service_ask_reaches_the_team(mongo, no_booking, answer):
    created = await _lead()
    await _say(created, "Can I bring it in for service?")
    await _say(created, answer)
    state = await _state(mongo, created)
    assert state["staff_notice"]["kind"] == "service_request", answer
    assert state["service_requests"], answer
    assert await mongo[PLATFORM_BOOKINGS_COLLECTION].count_documents({}) == 0


async def test_an_unrelated_answer_to_the_service_ask_is_not_a_request(mongo, no_booking):
    created = await _lead()
    await _say(created, "Can I bring it in for service?")
    await _say(created, "it has 100000 miles")
    state = await _state(mongo, created)
    assert not state.get("service_requests")
