"""MASTER_PLAN_3 B4/B5 end to end, through the real turn pipeline (offline
model): a visit offer, a pick that books it, the guard's booking-wording
rule, a booking not pausing the AI, a cancel, and a 3rd decline. Mirrors
tests/unit/test_after_hours.py's integration style."""

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent.turn import TurnDeps, run_turn
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events.handlers import handle_inbound_message
from upsell_agent.events.models import InboundMessageEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_BOOKINGS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    as_object_id,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import followups

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")

DEALER = simulate.DEV_DEALERS[0]["_id"]


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(comments="Looking for a new Toyota RAV4"):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test",
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


async def _offer(mongo, created):
    """Turn 2: budget + timeline known -> a visit is offered with times."""
    await _say(created, "My budget is $35,000 and I'd like to buy this month")
    return await _state(mongo, created)


async def test_picking_an_offered_time_books_it(mongo):
    created = await _lead()
    state = await _offer(mongo, created)
    assert state["conversation"]["visit"]["attempts"] == 1
    await _say(created, "the first one works")
    state = await _state(mongo, created)

    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})
    booking_id = lead["data"]["bookingId"]
    booking = await mongo[PLATFORM_BOOKINGS_COLLECTION].find_one({"_id": as_object_id(booking_id)})
    assert booking["booking_status"] == "pending" and booking["dealer_id"] == DEALER
    assert lead["status"] == "Appointment Booked"

    reply = await _last_sms(mongo, created)
    assert "requested" in reply.lower() and "confirm" in reply.lower()
    assert "booked" not in reply.lower() and "confirmed" not in reply.lower()
    # Not paused: the AI still answers the next message (B5 item 4).
    assert state.get("status") != "handoff"


async def test_a_booking_never_pauses_the_ai(mongo):
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "the first one works")
    result = await _say(created, "what should I bring with me?")
    assert result["status"] == "done"
    state = await _state(mongo, created)
    assert state.get("status") != "handoff"


async def test_cancelling_a_booking(mongo):
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "the first one works")
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})
    booking_id = lead["data"]["bookingId"]

    await _say(created, "actually I can't make it, need to cancel")
    booking = await mongo[PLATFORM_BOOKINGS_COLLECTION].find_one({"_id": as_object_id(booking_id)})
    assert booking["booking_status"] == "cancelled"
    reply = await _last_sms(mongo, created)
    assert "cancel" in reply.lower()
    state = await _state(mongo, created)
    assert state.get("staff_notice", {}).get("kind") == "visit_cancelled"


async def test_a_decline_parks_the_offer_for_three_replies(mongo):
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "not right now")
    state = await _state(mongo, created)
    assert state["conversation"]["visit"]["declined"] is True and state["conversation"]["visit"]["attempts"] == 1
    await _say(created, "what colours does it come in?")  # the next reply doesn't re-offer (B4 item 4)
    state = await _state(mongo, created)
    assert state["conversation"]["visit"]["attempts"] == 1


async def test_third_decline_stops_offering_and_schedules_a_followup(mongo):
    created = await _lead()
    await _offer(mongo, created)
    # Make the record look like attempts 1 and 2 were already declined and attempt 3 is on the table.
    state = await _state(mongo, created)
    visit = {**state["conversation"]["visit"], "attempts": 3,
             "angles_used": ["primary_interest", "objection", "value_proposition"]}
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]},
                                                     {"$set": {"conversation.visit": visit}})
    await _say(created, "not yet, maybe later")
    state = await _state(mongo, created)
    assert state["conversation"]["visit"]["stopped"] is True
    followup = await mongo[followups.SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "kind": followups.KIND_VISIT_FOLLOWUP, "status": "pending"})
    assert followup is not None


async def test_a_time_taken_since_it_was_offered_gets_fresh_times(mongo):
    created = await _lead()
    state = await _offer(mongo, created)
    first = state["conversation"]["visit"]["offered_times"][0]
    # Two other customers book that slot meanwhile (2 per slot, B0.10).
    from datetime import UTC, datetime

    from upsell_agent.integrations.dealer_profile import dealer_profile
    dealer = await dealer_profile(DEALER)
    day = datetime.fromisoformat(first["iso"]).astimezone(dealer.tz)
    midnight = day.replace(hour=0, minute=0).astimezone(UTC)
    for other in ("x1", "x2"):
        await mongo[PLATFORM_BOOKINGS_COLLECTION].insert_one({
            "dealer_id": DEALER, "lead_id": other, "bookingDate": midnight, "bookingTime": first["time"],
            "booking_status": "pending"})
    await _say(created, "the first one works")
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})
    assert not (lead.get("data") or {}).get("bookingId")
    reply = await _last_sms(mongo, created)
    assert "just taken" in reply
    state = await _state(mongo, created)
    assert state["conversation"]["visit"]["attempts"] == 1  # a re-offer, not a new attempt
    assert first not in state["conversation"]["visit"]["offered_times"]


async def test_missing_email_is_asked_for_then_the_booking_is_made(mongo):
    created = await _lead()
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": as_object_id(created["lead_id"])},
                                                      {"$set": {"email": None}})
    from upsell_agent.integrations.mongodb import PLATFORM_CUSTOMERS_COLLECTION
    await mongo[PLATFORM_CUSTOMERS_COLLECTION].update_one({"_id": as_object_id(created["customer_id"])},
                                                          {"$set": {"emails": []}})
    await _offer(mongo, created)
    await _say(created, "the second one")
    reply = await _last_sms(mongo, created)
    assert "email" in reply.lower()
    state = await _state(mongo, created)
    assert state["conversation"]["visit"]["pending_pick"]
    await _say(created, "sure, it's maria@example.test")
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})
    booking = await mongo[PLATFORM_BOOKINGS_COLLECTION].find_one({"_id": as_object_id(lead["data"]["bookingId"])})
    assert booking["email"] == "maria@example.test"
    state = await _state(mongo, created)
    assert not state["conversation"]["visit"].get("pending_pick")


async def _booking(mongo, created):
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})
    booking_id = (lead.get("data") or {}).get("bookingId")
    return await mongo[PLATFORM_BOOKINGS_COLLECTION].find_one({"_id": as_object_id(booking_id)}) if booking_id else None


async def test_a_visit_request_naming_a_time_is_booked_straight_away(mongo):
    # B5 item 8: no "which works?" round trip when they already named a free time.
    created = await _lead()
    await _say(created, "can I come see it tomorrow at 10am?")
    booking = await _booking(mongo, created)
    assert booking is not None and booking["bookingTime"] == "10:00"
    assert "requested" in (await _last_sms(mongo, created)).lower()


async def test_a_visit_request_at_night_is_booked_not_met_with_the_choice(mongo):
    # B5 item 8 at night: Tuesday 23:00 New York, the dealer is closed.
    from datetime import UTC, datetime
    set_clock(datetime(2026, 9, 23, 3, 0, tzinfo=UTC))
    created = await _lead()
    await _say(created, "can I come see it tomorrow at 10am?")
    booking = await _booking(mongo, created)
    assert booking is not None and booking["bookingTime"] == "10:00"
    reply = await _last_sms(mongo, created)
    assert "which would you like" not in reply.lower()


async def test_moving_a_booking(mongo):
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "the first one works")
    before = await _booking(mongo, created)
    await _say(created, "can we make it the day after tomorrow at 11am instead?")
    after = await _booking(mongo, created)
    assert after["_id"] == before["_id"] and after["bookingTime"] == "11:00"
    assert after["booking_status"] == "pending"  # booking_status sent with the PUT, unchanged
    assert "moved" in (await _last_sms(mongo, created)).lower()
    assert (await _state(mongo, created)).get("staff_notice", {}).get("kind") == "visit_moved"


async def test_the_offer_names_concrete_times(mongo):
    created = await _lead()
    state = await _offer(mongo, created)
    reply = await _last_sms(mongo, created)
    for slot in state["conversation"]["visit"]["offered_times"]:
        assert slot["display"] in reply
    assert "Which one works?" in reply


async def test_metrics_count_offers_and_bookings(mongo):
    from upsell_agent.observability.metrics import dealer_metrics, format_report
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "the first one works")
    m = await dealer_metrics(DEALER)
    assert m["visits"]["offered_leads"] == 1 and m["visits"]["booked_leads"] == 1
    assert m["visits"]["booking_rate"] == 1.0
    assert "Visits:" in format_report(m)
