"""MASTER_PLAN_3 B4/B5 end to end, through the real turn pipeline (offline
model): a visit offer, a pick that books it, the guard's booking-wording
rule, a booking not pausing the AI, a cancel, and a 3rd decline. Mirrors
tests/unit/test_after_hours.py's integration style."""

from datetime import datetime as _dt
from zoneinfo import ZoneInfo

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
    # Client, 12 Oct 2026: a pending booking is scheduled - "you're all set".
    assert "all set" in reply.lower() and "team" not in reply.lower()
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
    for other in (f"x{i}" for i in range(10)):  # a full one-hour sales slot (client, 5 Oct 2026)
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
    assert "all set" in (await _last_sms(mongo, created)).lower()


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
    offered = state["conversation"]["visit"]["offered_times"]
    # Each time is in the reply; the day is named once (the user, 3 Nov 2026: "today at 3:00 PM, 4:00 PM, or 5:00 PM").
    assert offered[0]["display"] in reply
    for slot in offered:
        assert slot["display"].split(" at ")[-1] in reply
    assert reply.count(offered[0]["display"].split(" at ")[0] + " at") == 1
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


# --- A day of their own ("not Wednesday, what about Monday?") ------------------------------------------


MONDAY_NOON = _dt(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/New_York"))


def _days(offered):
    return {t["date"] for t in offered}


async def test_a_counter_day_gets_that_days_times_not_a_team_promise(mongo):
    set_clock(MONDAY_NOON)
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "Not Tuesday, what about Thursday?")
    visit = (await _state(mongo, created))["conversation"]["visit"]
    assert _days(visit["offered_times"]) == {"2026-10-08"} and len(visit["offered_times"]) == 3
    assert visit["attempts"] == 1  # the same offer, answered with a day: not another attempt
    reply = await _last_sms(mongo, created)
    assert "Thursday works" in reply and "Thursday at" in reply and "team will confirm" not in reply
    # The visit day isn't saved as the date they need the car by.
    slots = {s["path"]: s for s in (await _state(mongo, created)).get("profile", {}).get("slots", [])}
    assert "interest.needed_by" not in slots or slots["interest.needed_by"].get("value") != "2026-10-06"
    # ...and picking one of them books it.
    await _say(created, "the second one")
    booking = await _booking(mongo, created)
    assert booking and booking["bookingTime"] == visit["offered_times"][1]["time"]


async def test_a_closed_day_offers_the_next_open_day_and_says_so(mongo):
    set_clock(MONDAY_NOON)
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "Can we do Sunday afternoon?")
    visit = (await _state(mongo, created))["conversation"]["visit"]
    assert _days(visit["offered_times"]) == {"2026-10-12"}  # the dev dealer is shut on Sunday
    assert all("12:00" <= t["time"] < "17:00" for t in visit["offered_times"])
    assert "no open times" in await _last_sms(mongo, created)


async def test_moving_a_booking_to_a_day_offers_that_days_times(mongo):
    set_clock(MONDAY_NOON)
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "the first one works")
    before = await _booking(mongo, created)
    await _say(created, "can we move it to Thursday instead?")
    visit = (await _state(mongo, created))["conversation"]["visit"]
    assert _days(visit["offered_times"]) == {"2026-10-08"}
    await _say(created, "the first one")
    after = await _booking(mongo, created)
    assert after["_id"] == before["_id"] and after["bookingTime"] == visit["offered_times"][0]["time"]


# --- PLAN_4 stream X3 item 3: offered times honour the day the customer asked for -------------------------
# credit-1 (real gpt-5-mini run): "can I come in saturday?" -> "morning is better" -> "10 works" was answered
# with "Tuesday at 1:00 PM, 2:00 PM, or 3:00 PM" and never booked.

async def test_morning_then_a_bare_time_books_the_day_they_asked_for(mongo):
    set_clock(MONDAY_NOON)
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "can I come in saturday?")
    await _say(created, "morning is better")
    visit = (await _state(mongo, created))["conversation"]["visit"]
    assert _days(visit["offered_times"]) == {"2026-10-10"}
    assert all(t["time"] < "12:00" for t in visit["offered_times"]), visit["offered_times"]
    await _say(created, "10 works")
    booking = await _booking(mongo, created)
    assert booking and booking["bookingTime"] == "10:00"
    assert str(booking["bookingDate"])[:10] in ("2026-10-10", "2026-10-09")  # dealer-local midnight in UTC


async def test_a_bare_time_is_read_on_the_asked_day_even_if_that_offer_never_went_out(mongo):
    # The Saturday offer was replaced by a template (not recorded), so the table still holds Tuesday's times.
    set_clock(MONDAY_NOON)
    created = await _lead()
    await _offer(mongo, created)
    tuesday = (await _state(mongo, created))["conversation"]["visit"]["offered_times"]
    await _say(created, "can I come in saturday?")
    state = await _state(mongo, created)
    visit = {**state["conversation"]["visit"], "offered_times": tuesday}
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]},
                                                     {"$set": {"conversation.visit": visit}})
    await _say(created, "10 works")
    booking = await _booking(mongo, created)
    assert booking and booking["bookingTime"] == "10:00"
    assert str(booking["bookingDate"])[:10] in ("2026-10-10", "2026-10-09")


async def test_not_today_but_the_end_of_the_week_gets_that_days_times_not_a_manager(mongo):
    """Melissa Ross, 28 Oct 2026 (a Wednesday): "I cannot today. I might be able to at the end of the week" went to a
    manager ("Our sales manager will reach out shortly"). The end of the week's open times are offered at once instead:
    Saturday and Sunday (the user, 3 Nov 2026: "Saturday at 2 PM or Sunday at 3 PM, whatever works for you")."""
    set_clock(_dt(2026, 10, 28, 15, 0, tzinfo=ZoneInfo("America/New_York")))
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "I cannot today. I might be able to at the end of the week")
    state = await _state(mongo, created)
    assert state["status"] != "handoff"
    # The test dealer is closed on Sundays: Saturday only (the calendar decides, never a guess).
    assert _days(state["conversation"]["visit"]["offered_times"]) == {"2026-10-31"}
    assert "manager" not in (await _last_sms(mongo, created)).lower()


@pytest.mark.parametrize("said", ["Not today, I'm busy", "I'm busy today"])
async def test_busy_today_gets_tomorrows_times_with_the_day_named(mongo, said):
    """AMMAR Saleh, 3 Nov 2026 (a Tuesday): "I forgot today, election day" got today's times again. The user: "offer
    them ok what about tomorrow - and name the day, checked from the calendar". Not "when should I check back?"."""
    set_clock(_dt(2026, 11, 3, 10, 22, tzinfo=ZoneInfo("America/New_York")))
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, said)
    visit = (await _state(mongo, created))["conversation"]["visit"]
    assert _days(visit["offered_times"]) == {"2026-11-04"}, visit.get("why")
    sms = await _last_sms(mongo, created)
    assert "tomorrow (Wednesday) at" in sms and "check back" not in sms


async def test_a_day_they_are_off_is_offered_not_a_check_back(mongo):
    """Mauricio Cueva, 3 Nov 2026 (a Tuesday), after three offers (two of them our own follow-ups): "Sorry i'm working
    now but I'm off on Friday" got "No problem, Mauricio. I'll check back with you on Friday, November 6." The user:
    "ask: should I book you on Friday at this time - it's a clear signal"."""
    set_clock(_dt(2026, 11, 3, 10, 45, tzinfo=ZoneInfo("America/New_York")))
    created = await _lead()
    await _offer(mongo, created)
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]}, {"$set": {
        "conversation.visit.attempts": 3, "conversation.visit.declines": 1}})
    await _say(created, "Sorry i'm working now but I'm off on Friday but i see the price went up a little bit")
    state = await _state(mongo, created)
    visit = state["conversation"]["visit"]
    assert _days(visit["offered_times"]) == {"2026-11-06"}, visit.get("why")
    sms = await _last_sms(mongo, created)
    assert "Friday at" in sms and "check back" not in sms, sms


@pytest.mark.parametrize("said", ["4 might be best if I get off earlier I'll let you know",
                                  "If I get off early I'll come straight. It's gonna be 4ish"])
async def test_a_loose_time_they_settle_on_books(mongo, said):
    """Jermaine Palmer, 3 Nov 2026: offered 1, 2 or 3 PM, he wrote "4 might be best", then "Ok" to "should we plan on
    4:00 PM?", "4ish" and "Yes" - never booked, and offered 1, 2 or 3 PM twice more. The time the AI reads him settle on
    books (picked_time; the offline model stands in for it)."""
    set_clock(_dt(2026, 11, 3, 10, 25, tzinfo=ZoneInfo("America/New_York")))
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, said)
    booking = await _booking(mongo, created)
    assert booking and booking["bookingTime"] == "16:00", await _last_sms(mongo, created)


def test_the_end_of_the_week_is_a_time_on_saturday_and_one_on_sunday():
    # The user, 3 Nov 2026: "ask them Saturday at a specific time or Sunday at a time - whatever works for you".
    from upsell_agent.integrations.dealer_profile import profile_from_record
    from upsell_agent.tools import booking_tool
    dealer = profile_from_record("d1", {"timezone": "America/New_York"})
    tuesday = _dt(2026, 11, 3, 10, 22, tzinfo=ZoneInfo("America/New_York"))
    request = booking_tool.preferred_day("I'll be coming at the end of the week", dealer, tuesday)
    assert request.day.isoformat() == "2026-11-07" and request.days == 2
    ny = ZoneInfo("America/New_York")
    open_slots = [_dt(2026, 11, d, h, 0, tzinfo=ny) for d in (6, 7, 8) for h in (11, 14, 16)]
    times, _, _ = booking_tool.times_on_day(open_slots, request, dealer, count=2)
    assert [t.date().isoformat() for t in times] == ["2026-11-07", "2026-11-08"]


def test_a_decline_naming_a_later_day_gives_that_day():
    """The live model marks Melissa's message a decline with visit_later_when "at the end of the week" (agent/nodes/
    decide.py _later_day): Saturday and Sunday are offered; a day further out than a week is left to the dated
    follow-up."""
    from upsell_agent.agent.nodes.decide import _later_day
    from upsell_agent.integrations.dealer_profile import profile_from_record
    dealer = profile_from_record("d1", {"timezone": "America/New_York"})
    wednesday = _dt(2026, 10, 28, 15, 0, tzinfo=ZoneInfo("America/New_York"))
    said = {"declines_visit": True, "visit_later_when": "at the end of the week"}
    later = _later_day(said, dealer, wednesday)
    assert later.day.isoformat() == "2026-10-31" and later.days == 2
    assert _later_day({**said, "visit_later_when": "in a month"}, dealer, wednesday) is None
    assert _later_day({"declines_visit": True}, dealer, wednesday) is None


async def test_not_until_a_date_then_a_time_and_yes_books_it(mongo):
    """Revetion Jones, 28 Oct 2026 (a Wednesday): "I would not be able to see the vehicle until the 31st" -> "Early
    morning, most likely around 10:30" -> "Yes" got "I've noted Saturday, October 31 at 10:30 AM as your preferred
    visit time" and no booking. Saturday's times are offered, and her time on that day books."""
    set_clock(_dt(2026, 10, 28, 15, 0, tzinfo=ZoneInfo("America/New_York")))
    created = await _lead()
    await _offer(mongo, created)
    await _say(created, "I would not be able to see the vehicle until the 31st.")
    visit = (await _state(mongo, created))["conversation"]["visit"]
    assert _days(visit["offered_times"]) == {"2026-10-31"}, visit.get("why")
    await _say(created, "Early morning, most likely around 10:30.")
    booking = await _booking(mongo, created)
    assert booking and booking["bookingTime"] == "10:30", await _last_sms(mongo, created)


def test_noted_as_your_visit_time_without_a_booking_is_blocked():
    """Revetion Jones, 28 Oct 2026: "I've noted Saturday, October 31 at 10:30 AM as your preferred visit time" went out
    with no booking. Saying a day is noted is a confirmation: only for a real booking on that day."""
    from upsell_agent.agent.nodes.guard import invalid_booking_wording
    draft = {"sms_text": "Thanks! I've noted Saturday, October 31 at 10:30 AM as your preferred visit time. We're at 3914 "
                         "Hempstead Tpke."}
    assert invalid_booking_wording({"visit": {}}, draft)
    booked = {"visit": {"status": "confirmed", "display": "Saturday, October 31 at 10:30 AM"}}
    assert not invalid_booking_wording(booked, draft)
    assert not invalid_booking_wording({"visit": {}}, {"sms_text": "Noted! Would Saturday at 10 or 11 work?"})


async def test_a_chinese_time_after_our_offer_is_booked(mongo):
    # Junling Fan, 2 Nov 2026: offered times, she wrote "明天去看上午" ... "10点" ... "是的" and was never booked.
    created = await _lead()
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": as_object_id(created["lead_id"])},
                                                      {"$set": {"user_language": "Chinese"}})
    await _offer(mongo, created)
    await _say(created, "明天上午10点")
    booking = await _booking(mongo, created)
    assert booking is not None and booking["bookingTime"] == "10:00"
