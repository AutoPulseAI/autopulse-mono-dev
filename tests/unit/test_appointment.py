"""MASTER_PLAN_3 C5: the appointment workflow (agent/appointment.py; Omnichannel PDF §7-§10). The day-before
confirmation and the customer's Y / N, the countdown, the +1h No Show and its follow-ups, the visit that cancels
them all, and the manager outcomes (Sold Pending, Sold Delivered, Unsold)."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent import appointment, lifecycle
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent, LeadPausedEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_BOOKINGS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    as_object_id,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import followups

NY = ZoneInfo("America/New_York")
DEALER = simulate.DEV_DEALERS[0]["_id"]


# --- Pure: the plan, the answer, the words ---------------------------------------------------------------

def _tue(hour=12, minute=0):
    return datetime(2026, 10, 6, hour, minute, tzinfo=NY)  # a Tuesday


def test_a_same_day_appointment_gets_only_the_no_show_check():
    steps = appointment.plan_steps(_tue(16), now=_tue(12), tz=NY)
    assert [s.step for s in steps] == ["no_show_check"] and steps[0].due_at == _tue(17)


def test_tomorrows_appointment_gets_the_confirmation_and_no_countdown():
    steps = appointment.plan_steps(datetime(2026, 10, 7, 14, tzinfo=NY), now=_tue(12), tz=NY)
    assert [s.step for s in steps] == ["confirm", "no_show_check"]
    assert steps[0].due_at == _tue(12, 30)  # 10:00 had passed: soon, not skipped


def test_a_friday_appointment_gets_a_countdown_a_day_before_confirmation_and_the_no_show_check():
    appt = datetime(2026, 10, 9, 10, tzinfo=NY)
    steps = appointment.plan_steps(appt, now=_tue(12), tz=NY)
    assert [(s.step, s.due_at.day) for s in steps] == [("countdown", 7), ("confirm", 8), ("no_show_check", 9)]
    assert steps[-1].due_at == appt + timedelta(hours=1)


def test_the_countdown_runs_every_day_but_the_one_before():
    appt = datetime(2026, 10, 12, 10, tzinfo=NY)  # the next Monday
    days = [s.due_at.day for s in appointment.plan_steps(appt, now=_tue(12), tz=NY) if s.step == "countdown"]
    assert days == [7, 8, 9, 10]  # Wed-Sat; Sunday is the day before: the confirmation


def test_a_confirmation_that_would_land_right_before_the_appointment_is_skipped():
    steps = appointment.plan_steps(datetime(2026, 10, 7, 1, tzinfo=NY), now=_tue(23), tz=NY)
    assert [s.step for s in steps] == ["no_show_check"]  # "any nonsensical day-before confirmation" (§7)


def test_an_appointment_long_past_has_nothing_to_remind_or_chase():
    assert appointment.plan_steps(_tue(8), now=_tue(12), tz=NY) == []


@pytest.mark.parametrize(("text", "answer"), [
    ("Y", "yes"), ("y", "yes"), ("Yes", "yes"), ("yes!", "yes"), ("Yes, thanks", "yes"), ("sounds good", "yes"),
    ("that works", "yes"), ("ok", "yes"), ("I'll be there", "yes"),
    ("N", "no"), ("no", "no"), ("Nope", "no"), ("can't", "no"), ("doesn't work", "no"), ("No, sorry", "no"),
    ("maybe", "ambiguous"), ("hmm not sure", "ambiguous"), ("let me check", "ambiguous"),
    ("What's your address?", "other"), ("Can we move it to Saturday?", "other"),
    ("I might be a bit late, probably around 11", "other"), ("", "other"),
])
def test_the_customers_answer_to_the_confirmation(text, answer):
    assert appointment.classify_answer(text) == answer


def test_the_clients_messages_word_for_word():
    appt = datetime(2026, 10, 9, 10, 30, tzinfo=NY)
    kw = {"customer_name": "Maria Test", "dealership": "ABC Toyota", "agent_name": "Ava", "appt": appt}
    assert appointment.render_message("countdown", **kw)["sms_text"] == "Counting down to our meeting at ABC Toyota!"
    assert appointment.render_message("confirm", **kw)["sms_text"] == (
        "Hello, Maria, this is Ava at ABC Toyota confirming our meeting for Friday, October 9 at 10:30 AM. "
        "Does this time still work? Please reply Y for Yes or N for No.")
    assert appointment.render_message("no_show_check", **kw)["sms_text"] == (
        "Hello, this is Ava with ABC Toyota. I am looking for you in the showroom - are you here and working "
        "with someone?")
    assert appointment.render_message("no_show_followup", model="RAV4", **kw)["sms_text"] == (
        "Hi! This is Ava at ABC Toyota regarding your RAV4 purchase. How did everything go when you came in? "
        "Did you get a chance to stop by?")


def test_a_missing_agent_name_is_left_out_not_invented():
    kw = {"customer_name": "Maria", "dealership": "ABC Toyota", "agent_name": None,
          "appt": datetime(2026, 10, 9, 10, tzinfo=NY)}
    text = appointment.render_message("confirm", **kw)["sms_text"]
    assert text.startswith("Hello, Maria, it's the team at ABC Toyota confirming") and "Ava" not in text


def test_the_appointments_time_comes_from_the_booking_or_the_lead():
    booking = {"bookingDate": datetime(2026, 10, 9, 4, 0, tzinfo=UTC), "bookingTime": "10:30"}  # dealer midnight in UTC
    assert appointment.appointment_at(tz=NY, booking=booking) == datetime(2026, 10, 9, 10, 30, tzinfo=NY)
    lead = {"booking": {"booking_at": datetime(2026, 10, 9, 15, 0, tzinfo=UTC)}}
    assert appointment.appointment_at(tz=NY, lead=lead) == datetime(2026, 10, 9, 11, 0, tzinfo=NY)
    assert appointment.appointment_at(tz=NY) is None


# --- Through the real handlers, turns, scheduler and send check --------------------------------------------

pytestmark_flow = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")


@pytest.fixture
async def live_dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one({
        "_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True},
        "dealer_account_information": {
            "time_zone": "America/New_York", "store_name": "Sunrise Motors", "store_city": "Springfield",
            "store_state": "NJ", "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}})


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(), platform=StubPlatformClient(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _new_lead(comments="Looking for a new Toyota RAV4"):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test",
                                         comments=comments)
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, text, channel="sms"):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel=channel,
                                text=text, received_at=clock.now())
    return await handlers.handle_inbound_message(event, _deps())


async def _state(mongo, created) -> dict:
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}


async def _outbox(mongo, created) -> list[dict]:
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    return sorted(rows, key=lambda r: r["created_at"])


async def _steps(mongo, created, status="pending") -> list[dict]:
    rows = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "status": status, "kind": {"$in": list(followups.APPOINTMENT_KINDS)}}
    ).to_list(None)
    return sorted(rows, key=lambda r: r["due_at"])


async def _booking(mongo, created) -> dict:
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})
    return await mongo[PLATFORM_BOOKINGS_COLLECTION].find_one({"_id": as_object_id(lead["data"]["bookingId"])})


def _next_friday_10() -> str:
    return "Can I come see it Friday at 10 AM?"


async def _booked_friday(mongo):
    """A lead with a pending booking on the coming Friday at 10:00 (the customer named the time themselves)."""
    set_clock(datetime(2026, 10, 5, 12, 0, tzinfo=NY))  # a Monday
    created = await _new_lead()
    await _say(created, "My budget is $35,000 and I'd like to buy this month")  # a visit is offered
    await _say(created, _next_friday_10())
    booking = await _booking(mongo, created)
    assert booking["booking_status"] == "pending" and booking["bookingTime"] == "10:00"
    return created, booking


async def _fire(mongo, created, step: str) -> dict:
    """Moves the clock to the pending step's due time and fires it."""
    [doc] = [d for d in await _steps(mongo, created) if d["step"] == step][:1]
    due = doc["due_at"] if doc["due_at"].tzinfo else doc["due_at"].replace(tzinfo=UTC)
    set_clock(due + timedelta(minutes=1))
    return {"doc": doc, **await followups.fire_due(_deps())}


@pytestmark_flow
async def test_booking_a_visit_plans_the_countdown_the_confirmation_and_the_no_show_check(mongo):
    created, booking = await _booked_friday(mongo)
    steps = await _steps(mongo, created)
    assert [s["step"] for s in steps] == ["countdown", "countdown", "confirm", "no_show_check"]
    state = await _state(mongo, created)
    assert state["stage"] == "appointment_set" and state["appointment"]["booking_id"] == str(booking["_id"])
    assert state["appointment"]["confirmed"] is False


@pytestmark_flow
async def test_the_countdown_goes_out_on_text_and_email_in_the_clients_words(mongo):
    created, _ = await _booked_friday(mongo)
    before = len(await _outbox(mongo, created))
    fired = await _fire(mongo, created, "countdown")
    assert fired["results"] == {"sent": 1}
    new = (await _outbox(mongo, created))[before:]
    assert {m["channel"] for m in new} == {"sms", "email"}
    assert next(m for m in new if m["channel"] == "sms")["text"] == "Counting down to our meeting at Sunrise Motors!"


@pytestmark_flow
async def test_the_day_before_confirmation_asks_for_y_or_n(mongo):
    created, _ = await _booked_friday(mongo)
    fired = await _fire(mongo, created, "confirm")
    assert fired["results"].get("sent", 0) >= 1  # the earlier countdowns are due by then, too
    sms = [m for m in await _outbox(mongo, created) if m["channel"] == "sms"][-1]["text"]
    assert "confirming our meeting for Friday" in sms and "at 10:00 AM" in sms
    assert sms.endswith("Please reply Y for Yes or N for No.")
    assert (await _state(mongo, created))["appointment"]["confirmation"]["status"] == "asked"


@pytestmark_flow
async def test_y_confirms_the_booking_and_the_appointment(mongo):
    created, _ = await _booked_friday(mongo)
    await _fire(mongo, created, "confirm")
    result = await _say(created, "Y")
    assert result["appointment_answer"] == "yes" and result["status"] == "appointment_confirmed"
    assert (await _booking(mongo, created))["booking_status"] == "confirmed"
    state = await _state(mongo, created)
    assert state["appointment"]["confirmed"] is True and state["appointment"]["confirmation"]["status"] == "confirmed"
    assert state["stage"] == "appointment_set"
    assert "See you Friday" in [m for m in await _outbox(mongo, created) if m["channel"] == "sms"][-1]["text"]


@pytestmark_flow
async def test_n_offers_new_times_at_once_and_the_pick_moves_the_booking_and_its_timers(mongo):
    created, booking = await _booked_friday(mongo)
    await _fire(mongo, created, "confirm")
    old_no_show = (await _steps(mongo, created))[-1]
    result = await _say(created, "N")
    assert result["appointment_answer"] == "no" and result["status"] == "appointment_reschedule"
    reply = [m for m in await _outbox(mongo, created) if m["channel"] == "sms"][-1]["text"]
    assert reply.startswith("No problem, Maria. I can do ") and reply.endswith("Which works better?")
    assert (await _booking(mongo, created))["booking_status"] == "pending"  # never marked confirmed
    assert (await _state(mongo, created))["appointment"]["confirmed"] is False

    await _say(created, "the second one works")
    moved = await _booking(mongo, created)
    assert str(moved["_id"]) == str(booking["_id"]) and (moved["bookingDate"], moved["bookingTime"]) != (
        booking["bookingDate"], booking["bookingTime"])
    # The old no-show timer can never create a false No Show (§16): it was replaced with the new time's.
    stale = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"_id": old_no_show["_id"]})
    assert stale["status"] in ("superseded", "cancelled")
    new_steps = await _steps(mongo, created)
    assert new_steps and all(s["appointment_at"] != old_no_show["appointment_at"] for s in new_steps)
    assert (await _state(mongo, created))["appointment"]["confirmation"] is None  # the new time is unconfirmed


@pytestmark_flow
async def test_a_reply_that_is_neither_y_nor_n_is_asked_once_more_and_then_left_alone(mongo):
    created, _ = await _booked_friday(mongo)
    await _fire(mongo, created, "confirm")
    first = await _say(created, "maybe")
    assert first["appointment_answer"] == "ambiguous" and first["status"] == "appointment_clarify"
    assert [m for m in await _outbox(mongo, created) if m["channel"] == "sms"][-1]["text"].startswith(
        "Just to be sure, does that time still work?")
    assert (await _booking(mongo, created))["booking_status"] == "pending"  # not confirmed until clear
    second = await _say(created, "hmm")
    assert "appointment_answer" not in second  # not asked a third time: an ordinary turn answers it


@pytestmark_flow
async def test_a_question_is_a_conversation_not_a_confirmation(mongo):
    created, _ = await _booked_friday(mongo)
    await _fire(mongo, created, "confirm")
    result = await _say(created, "What should I bring with me?")
    assert "appointment_answer" not in result and result["status"] == "done"
    assert (await _state(mongo, created))["appointment"]["confirmation"]["status"] == "asked"  # still waiting


@pytestmark_flow
async def test_a_reply_when_nothing_was_asked_is_never_read_as_a_confirmation(mongo):
    created, _ = await _booked_friday(mongo)
    result = await _say(created, "Y")  # nobody asked for a Y
    assert "appointment_answer" not in result
    assert (await _booking(mongo, created))["booking_status"] == "pending"


@pytestmark_flow
async def test_no_show_one_hour_after_with_no_visit(mongo):
    created, _ = await _booked_friday(mongo)
    await _fire(mongo, created, "no_show_check")
    state = await _state(mongo, created)
    assert state["stage"] == "appointment_no_show"
    new = (await _outbox(mongo, created))[-2:]
    assert {m["channel"] for m in new} == {"sms", "email"}
    assert next(m for m in new if m["channel"] == "sms")["text"].endswith(
        "I am looking for you in the showroom - are you here and working with someone?")
    [follow] = [s for s in await _steps(mongo, created) if s["step"] == "no_show_followup"]
    gap = follow["due_at"].replace(tzinfo=UTC) - clock.now()
    assert timedelta(hours=23) < gap <= timedelta(hours=24, minutes=1)


@pytestmark_flow
async def test_no_show_follow_up_then_back_into_short_term_follow_up(mongo):
    created, _ = await _booked_friday(mongo)
    await _fire(mongo, created, "no_show_check")
    await _fire(mongo, created, "no_show_followup")
    second = [m for m in await _outbox(mongo, created) if m["channel"] == "sms"][-1]["text"]
    assert second.startswith("Hi! This is the team at Sunrise Motors regarding your") and (
        "How did everything go when you came in? Did you get a chance to stop by?" in second)
    await _fire(mongo, created, "no_show_close")
    state = await _state(mongo, created)
    # The client's required rule (§9): Contact Made - No Next Action, not No Contact Made.
    assert state["stage"] == "contact_made_no_next_action"
    assert state["cadence"]["reentered"] is True and state["opportunity_created_at"]
    touches = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "status": "pending", "kind": "cadence_touch"}).to_list(None)
    assert len(touches) == 1 and touches[0]["touch"]["touch_number"] == 3  # no introduction, no name nudge


@pytestmark_flow
async def test_a_reply_to_the_no_show_message_stops_the_no_show_flow(mongo):
    created, _ = await _booked_friday(mongo)
    await _fire(mongo, created, "no_show_check")
    await _say(created, "Sorry, something came up. I'm still interested though")
    assert (await _state(mongo, created))["stage"] == "contact_made_no_next_action"
    assert [s for s in await _steps(mongo, created) if s["step"].startswith("no_show")] == []


@pytestmark_flow
async def test_a_visit_on_the_appointments_day_is_a_showed_and_cancels_every_step(mongo):
    created, _ = await _booked_friday(mongo)
    [no_show] = [s for s in await _steps(mongo, created) if s["step"] == "no_show_check"]
    set_clock(no_show["due_at"].replace(tzinfo=UTC) - timedelta(minutes=30))  # arrives mid-appointment
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="v1", dealer_id=DEALER, lead_id=created["lead_id"], reason='Staff moved the lead to "Visited"'),
        _deps())
    assert result["showed"]["showed"] is True
    state = await _state(mongo, created)
    assert state["stage"] == "sales_visit" and state["appointment"]["showed"] is True
    assert (await _booking(mongo, created))["booking_status"] == "completed"
    assert await _steps(mongo, created) == []  # no false No Show can fire (§16)


@pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")
async def test_a_visit_on_another_day_is_not_a_showed(mongo):
    created, _ = await _booked_friday(mongo)
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="v2", dealer_id=DEALER, lead_id=created["lead_id"], reason='Staff moved the lead to "Visited"'),
        _deps())
    assert result["showed"]["showed"] is False
    assert "showed" not in (await _state(mongo, created))["appointment"]


@pytestmark_flow
async def test_a_staff_booking_gets_the_appointment_messages_too_and_does_not_pause_the_ai(mongo):
    created = await _new_lead()
    await simulate.send_staff_status(DEALER, created["lead_id"], "Appointment Booked", _NoEnqueue(),
                                     booking_at=(clock.now() + timedelta(days=3)).isoformat())
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="b1", dealer_id=DEALER, lead_id=created["lead_id"],
        reason='Staff moved the lead to "Appointment Booked"'), _deps())
    assert result["status"] == "not_paused" and result["appointment_timers"]["created"] >= 2
    assert (await _state(mongo, created))["appointment"]["by"] == "staff"
    assert "no_show_check" in {s["step"] for s in await _steps(mongo, created)}


@pytestmark_flow
async def test_cancelling_the_appointment_cancels_its_messages(mongo):
    created, _ = await _booked_friday(mongo)
    assert await _steps(mongo, created)
    await _say(created, "actually I can't make it, need to cancel")
    assert await _steps(mongo, created) == []
    assert (await _state(mongo, created))["stage"] == "contact_made_no_next_action"


@pytestmark_flow
async def test_the_pre_send_recheck_stops_a_step_whose_appointment_moved(mongo):
    created, booking = await _booked_friday(mongo)
    step = next(s for s in await _steps(mongo, created) if s["step"] == "countdown")
    await mongo[PLATFORM_BOOKINGS_COLLECTION].update_one({"_id": booking["_id"]}, {"$set": {"bookingTime": "15:00"}})
    set_clock(step["due_at"].replace(tzinfo=UTC) + timedelta(minutes=1))
    fired = await followups.fire_due(_deps())
    assert fired["results"].get("cancelled") == 1 and "sent" not in fired["results"]


@pytestmark_flow
async def test_opting_out_of_every_channel_cancels_the_appointment_messages(mongo):
    created, _ = await _booked_friday(mongo)
    await _say(created, "STOP")
    await _say(created, "Unsubscribe", channel="email")
    assert await _steps(mongo, created) == []


# --- The manager outcomes -----------------------------------------------------------------------------------------

@pytestmark_flow
async def test_sold_pending_stops_the_lead_workflow(mongo):
    created = await _new_lead()
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="o1", dealer_id=DEALER, lead_id=created["lead_id"],
        reason='Staff moved the lead to "Sold Pending"'), _deps())
    assert result["status"] == "paused" and result["stage_change"]["stage"] == "sold_pending"
    state = await _state(mongo, created)
    assert state["stage"] == "sold_pending" and state["status"] == "paused"
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "status": "pending"}) == 0


@pytestmark_flow
async def test_sold_delivered_supersedes_sold_pending_and_never_goes_back(mongo):
    created = await _new_lead()
    for i, status in enumerate(("Sold Pending", "Sold Delivered", "Sold Pending")):
        await handlers.handle_lead_paused(LeadPausedEvent(
            event_id=f"o{i}", dealer_id=DEALER, lead_id=created["lead_id"],
            reason=f'Staff moved the lead to "{status}"'), _deps())
    assert (await _state(mongo, created))["stage"] == "sold_delivered"


@pytestmark_flow
async def test_unsold_goes_back_to_follow_up_for_90_days(mongo):
    created = await _new_lead()
    await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="u0", dealer_id=DEALER, lead_id=created["lead_id"], reason='Staff moved the lead to "Visited"'),
        _deps())
    before = await _state(mongo, created)
    assert before["stage"] == "sales_visit" and before["status"] == "paused"
    set_clock(clock.now() + timedelta(days=60))  # a visit late in the lead's life
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="u1", dealer_id=DEALER, lead_id=created["lead_id"], reason='Staff moved the lead to "Unsold"'),
        _deps())
    assert result["status"] == "resumed_unsold"
    state = await _state(mongo, created)
    assert state["stage"] == "contact_made_no_next_action" and state["status"] == "active"  # the AI has it back
    assert state["cadence"]["reentered"] is True
    assert state["day91_anchor"] > before["opportunity_created_at"] + timedelta(days=59)
    assert state["opportunity_created_at"] == before["opportunity_created_at"]  # never reset (§12)
    assert result["cadence_touch"]["created"] is True
    # The 91-day sweep counts from the Unsold date: the lead survives its original Day 91...
    assert (await lifecycle.close_expired(clock.now() + timedelta(days=40)))["closed"] == 0
    # ...and closes 91 days after Unsold.
    assert (await lifecycle.close_expired(clock.now() + timedelta(days=92)))["closed"] == 1
    assert (await _state(mongo, created))["stage"] == "closed_lost"


@pytestmark_flow
async def test_a_visit_and_its_outcome_arrive_as_one_event_and_apply_in_order(mongo):
    created, _ = await _booked_friday(mongo)
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="vo", dealer_id=DEALER, lead_id=created["lead_id"],
        reason='Staff moved the lead to "Visited" (manager outcome: "Sold Pending")'), _deps())
    assert result["status"] == "paused" and result["stage_change"]["stage"] == "sold_pending"
    history = [h["to"] for h in (await _state(mongo, created))["stage_history"]]
    assert history[-2:] == ["sales_visit", "sold_pending"]


@pytestmark_flow
async def test_a_visit_with_unsold_returns_the_lead_to_the_ai(mongo):
    created = await _new_lead()
    result = await handlers.handle_lead_paused(LeadPausedEvent(
        event_id="vu", dealer_id=DEALER, lead_id=created["lead_id"],
        reason='Staff moved the lead to "Visited" (manager outcome: "Unsold")'), _deps())
    assert result["status"] == "resumed_unsold"
    state = await _state(mongo, created)
    assert state["status"] == "active" and state["stage"] == "contact_made_no_next_action"


@pytestmark_flow
async def test_the_profile_shows_the_appointment(mongo):
    from upsell_agent.api.leads import lead_profile

    created, _ = await _booked_friday(mongo)
    profile = await lead_profile(DEALER, created["lead_id"])
    assert profile["lifecycle"]["stage"] == "appointment_set"
    assert profile["lifecycle"]["appointment"]["confirmed"] is False


class _NoEnqueue:
    async def __call__(self, *args, **kwargs):
        return None
