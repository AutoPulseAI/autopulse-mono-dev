"""The 2 Nov 2026 meeting (Betsy, Bibi, the user) and the user's list of 3 Nov 2026."""

from datetime import UTC, datetime, timedelta

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent import appointment, lifecycle, loop_check
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.agent.yes_words import is_yes
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent, LeadPausedEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink

DEALER = simulate.DEV_DEALERS[0]["_id"]
pytestmark = pytest.mark.usefixtures("ny_customer")
TUESDAY_NOON = datetime(2026, 9, 22, 16, 0, tzinfo=UTC)  # 12:00 in New York


def _m(direction, text):
    return {"direction": direction, "text": text, "channel": "sms"}


# --- The AI going round in circles (pure) ----------------------------------------------------------------------------

def test_kenneth_ball_which_suv_twice_is_a_loop():
    memory = [_m("outbound", "I'm checking in about your trade-in. What year, make and model is it?"),
              _m("inbound", "Can u send me the website of the SUV"),
              _m("outbound", "I can help with that. Which SUV would you like the link for?"),
              _m("inbound", "Yes"),
              _m("outbound", "Sure, coming in can help. Which works best for you: today at 2:00 PM, today at 3:00 PM?"),
              _m("inbound", "So I can see the SUV Cadillac all around"),
              _m("outbound", "I understand. Which SUV model would you like the link for?")]
    assert "same question twice" in loop_check.loop_reason("Yes", memory)


def test_april_carman_asking_about_the_price_three_times_is_a_loop():
    memory = [_m("inbound", "My offer is $27,000 walk away"),
              _m("outbound", "Thanks April, that's something we can go over together when you come in."),
              _m("inbound", "27 with all taxes included"),
              _m("outbound", "I understand. I can't confirm the all-in total here.")]
    assert "three times" in loop_check.loop_reason("What is your total offer?", memory)


@pytest.mark.parametrize("text", ["I already told you, 27 all in", "you're not listening", "???", "how many times"])
def test_the_customer_saying_we_go_in_circles_is_a_loop(text):
    assert loop_check.loop_reason(text, [_m("outbound", "What's your budget?")])


def test_narrowing_down_a_visit_is_not_a_loop():
    memory = [_m("outbound", "Would today at 2:00 PM or today at 4:00 PM work? Which one works?"),
              _m("inbound", "Tomorrow maybe"),
              _m("outbound", "Tomorrow I have 11:00 AM or 3:00 PM. Which one works?")]
    assert loop_check.loop_reason("morning is better", memory) is None
    assert loop_check.loop_reason("Hi, is the RAV4 still there?", []) is None


def test_a_new_question_after_an_escalation_is_a_different_topic():
    about = "Customer asked for something the AI can't supply: custom photos or a video / Can you send a video?"
    assert loop_check.same_topic("Can I see more pictures of it?", about)
    assert loop_check.same_topic("ok", about)
    assert not loop_check.same_topic("Are you open Sunday?", about)
    assert loop_check.same_topic("can you do 26k out the door?", "AI stuck in a loop: price / 27 all in")


# --- Yes in any language, and a reply in any language counts (pure) -------------------------------------------------

@pytest.mark.parametrize("text", ["是的", "好的", "对", "可以", "Sí", "si claro", "yup", "ya", "bet", "ok bet", "👍",
                                  "Yes!", "haan ji", "はい", "네", "sure thing", "yess"])
def test_a_yes_in_any_language(text):
    assert is_yes(text)
    assert appointment.classify_answer(text) == "yes"


@pytest.mark.parametrize("text", ["no", "not today", "是什么", "yes but can you do Friday instead?", "R"])
def test_not_a_plain_yes(text):
    assert not is_yes(text)


@pytest.mark.parametrize("text", ["是的", "车的资料发给我看下", "Sí", "位置发下"])
def test_a_reply_in_any_language_is_a_reply(text):
    assert lifecycle.is_meaningful_reply(text)[0]


# --- On the lead (flow) -----------------------------------------------------------------------------------------------

@pytest.fixture
async def live_dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one(
        {"_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True}})


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(name="Mira Meeting"):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name=name,
                                         comments="Hi, I want a new Toyota RAV4")
    await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, text):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel="sms", text=text,
                                received_at=clock.now())
    return await handlers.handle_inbound_message(event, _deps())


async def _state(mongo, created):
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}


async def _sent(mongo, created):
    return await mongo[DEV_OUTBOX_COLLECTION].count_documents({"lead_id": created["lead_id"]})


async def _pending(mongo, created):
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "status": {"$in": ["pending", "standby"]},
         # Staff-only: the call task timers and the 30-minute "nobody answered the handoff" alert send the customer
         # nothing.
         "kind": {"$nin": ["daily_call_task", "call_task", "handoff_check"]}})


async def test_a_video_request_stops_the_ai_and_its_follow_ups(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Vida Video")
    await _say(created, "Can you send me a video of the interior?")
    state = await _state(mongo, created)
    # Betsy, 2 Nov 2026: "once it's manager review it's manager review" - the AI stops, no cadence.
    assert state["crm_status_sync"]["crm_status"] == "Managerial Review"
    assert state["status"] == "handoff" and state["with_person"] and not state["with_person"]["asked_for_person"]
    assert await _pending(mongo, created) == 0

    # The same thing again: nothing sent, staff told.
    sent = await _sent(mongo, created)
    assert (await _say(created, "Can you send more pictures then?"))["status"] == "saved_only"
    assert await _sent(mongo, created) == sent
    # A new, different question is answered - and the lead stays with the manager, no follow-ups.
    result = await _say(created, "Are you open on Sunday?")
    assert result["status"] == "done" and await _sent(mongo, created) == sent + 1
    state = await _state(mongo, created)
    assert state["status"] == "handoff" and state["status_reason"].startswith("Customer asked for something")
    assert await _pending(mongo, created) == 0
    # Asking to book while it's with the manager: staff book it, the AI doesn't.
    assert (await _say(created, "Can I come in Saturday at 11?"))["status"] == "saved_only"
    assert (await _state(mongo, created))["staff_notice"]["kind"] == "after_handoff_booking"

    # Staff changing the status hands it back (Betsy).
    await handlers.handle_lead_paused(LeadPausedEvent(
        event_id=f"p-{ObjectId()}", dealer_id=DEALER, lead_id=created["lead_id"],
        reason='Staff moved the lead to "Contacted - No Next Action"'), _deps())
    state = await _state(mongo, created)
    assert state["status"] == "active" and not state.get("with_person")


async def test_a_vehicle_to_check_before_booking_does_not_stop_the_ai(mongo, live_dealer):
    # Kenneth Ball, 2 Nov 2026: "confirm SUV is available before scheduling" is a staff check, not a hold.
    from upsell_agent.agent import crm_status
    set_clock(TUESDAY_NOON)
    created = await _lead("Vic Vehicle")
    db = dealer_scoped_db(DEALER)
    # Never written back: never Dealer Action Required (Betsy: an escalation is a result of contact made).
    result = await crm_status.sync_status(db, created["lead_id"], "Managerial Review", event_kind="cannot_supply",
                                          hold=True, reason="Customer asked for something the AI can't supply: x")
    assert result["status"] == "skipped" and (await _state(mongo, created))["status"] == "active"
    await mongo["ai_messages"].insert_one({"lead_id": created["lead_id"], "dealer_id": DEALER, "direction": "inbound",
                                           "text": "Is the SUV still there?"})
    await crm_status.sync_status(db, created["lead_id"], "Managerial Review", event_kind="cannot_supply",
                                 reason="Customer asked for something the AI can't supply: confirm SUV is available")
    assert (await _state(mongo, created))["status"] == "active"
    await crm_status.sync_status(db, created["lead_id"], "Managerial Review", event_kind="cannot_supply", hold=True,
                                 reason="Customer asked for something the AI can't supply: custom photos or a video")
    assert (await _state(mongo, created))["status"] == "handoff"


async def test_a_loop_goes_to_a_manager(mongo, live_dealer):
    set_clock(TUESDAY_NOON)
    created = await _lead("Lou Loop")
    await _say(created, "Is the RAV4 still available?")
    await _say(created, "So it's available right now?")
    await _say(created, "Is it still on the lot or sold?")
    state = await _state(mongo, created)
    assert state["status"] == "handoff" and state["status_reason"].startswith("AI stuck in a loop")
    assert state["crm_status_sync"]["crm_status"] == "Managerial Review"
    assert await _pending(mongo, created) == 0


async def test_what_day_works_becomes_two_real_times(mongo):
    from upsell_agent.agent.open_time_question import offer_real_times
    from upsell_agent.integrations.dealer_profile import dealer_profile
    set_clock(TUESDAY_NOON)
    draft = {"sms_text": "Your payment depends on your down payment and term, and we can work through the details "
                         "together when you come in. What day works best for you?",
             "email_body": "Hi,\n\nWe can go over it together. When would you like to come in?\n\nThank you"}
    done = await offer_real_times(draft, dealer_id=DEALER, lead_id=str(ObjectId()), decision={},
                                  dealer=await dealer_profile(DEALER))
    assert done and "What day works" not in draft["sms_text"] and " or " in draft["sms_text"]
    assert draft["sms_text"].endswith("work for you?") and "PM" in draft["sms_text"] or "AM" in draft["sms_text"]
    assert "When would you like" not in draft["email_body"] and len(draft["offered_times"]) == 2
    # Times already offered: left alone. Another language: left alone.
    kept = {"sms_text": "Would today at 2:00 PM work? What time works best?"}
    assert await offer_real_times(kept, dealer_id=DEALER, lead_id=None, decision={},
                                  dealer=await dealer_profile(DEALER)) is None
    assert await offer_real_times(dict(draft), dealer_id=DEALER, lead_id=None, decision={"reply_language": "Spanish"},
                                  dealer=await dealer_profile(DEALER)) is None


async def test_times_follow_what_the_customer_said(mongo):
    """AMMAR Saleh, 3 Nov 2026: offered today at 1, 2 or 3 PM, he wrote "I forgot today, election day". The AI read it
    as turning the times down and asked for a better day; this step put today at 1:00 PM and 2:00 PM back in. The
    user: "give him the time for next day or any other day of his preference - that's common sense"."""
    from upsell_agent.agent.open_time_question import offer_real_times
    from upsell_agent.integrations.dealer_profile import dealer_profile
    set_clock(TUESDAY_NOON)
    today = clock.now().date()
    offered = [{"date": today.isoformat(), "display": "today at 1:00 PM"},
               {"date": today.isoformat(), "display": "today at 2:00 PM"}]
    decision = {"visit_plan": {"record": {"offered_times": offered}}}
    draft = {"sms_text": "No worries, Ammar. What day works better for you?"}
    said = {"declines_visit": True, "visit_objection": "time_convenience", "visit_later_when": None}
    assert await offer_real_times(draft, dealer_id=DEALER, lead_id=None, decision=decision,
                                  dealer=await dealer_profile(DEALER), extraction=said)
    days = {t["date"] for t in draft["offered_times"]}
    assert today.isoformat() not in days and "today" not in draft["sms_text"], draft["sms_text"]
    # A day they'd come instead: that day.
    friday = (today + timedelta(days=(4 - today.weekday()) % 7)).isoformat()
    draft = {"sms_text": "No problem. What day works for you?"}
    assert await offer_real_times(draft, dealer_id=DEALER, lead_id=None, decision=decision,
                                  dealer=await dealer_profile(DEALER),
                                  extraction={**said, "visit_later_when": "Friday"})
    assert {t["date"] for t in draft["offered_times"]} == {friday}, draft["sms_text"]


RAW = ("X-Received: by 2002:a05:620a:2609:b0:93f:cbd:8e20 with SMTP id af79cd13be357-944217ee2camr1689224285a.73\n"
       "ARC-Seal: i=1; a=rsa-sha256; t=1793647142; cv=none; d=google.com\n"
       "From: Dominick <dom@example.com>\nTo: sales@victory.test\nSubject: Re: 2024 RAM Laramie\n"
       "MIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\n\n"
       "Can I see it Saturday?\n\nOn Mon, Nov 2, 2026 at 2:18 PM Nicole <ai@victory.test> wrote:\n"
       "> It's listed at $31,799, not including tax\n")


def test_a_raw_email_source_is_read_as_what_the_customer_wrote():
    # Dominick Telesco, 2 Nov 2026: the headers were read as his message (a fake price offer and a fake new number).
    event = InboundMessageEvent(event_id="e", dealer_id=DEALER, customer_id="c", lead_id="l", message_id="m",
                                channel="email", text=RAW, received_at=clock.now())
    assert event.text == "Can I see it Saturday?"
    empty = RAW.split("\n\n")[0] + "\n\n"
    assert InboundMessageEvent(event_id="e", dealer_id=DEALER, customer_id="c", lead_id="l", message_id="m",
                               channel="email", text=empty, received_at=clock.now()).text.strip() == ""
    assert InboundMessageEvent(event_id="e", dealer_id=DEALER, customer_id="c", lead_id="l", message_id="m",
                               channel="sms", text="From: me. To: you", received_at=clock.now()).text == \
        "From: me. To: you"


def test_booked_the_day_before_the_confirmation_waits_for_the_morning():
    # Junling Fan, 2 Nov 2026: booked 3:19 PM for 10 AM tomorrow, "reply C to confirm" went out at 4:05 PM.
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("America/New_York")
    now = datetime(2026, 11, 2, 15, 19, tzinfo=tz)
    steps = appointment.plan_steps(datetime(2026, 11, 3, 10, 0, tzinfo=tz), now=now, tz=tz)
    [confirm] = [s for s in steps if s.step == appointment.STEP_CONFIRM]
    assert confirm.due_at == datetime(2026, 11, 3, 9, 0, tzinfo=tz)
    # Booked the morning before, still in time: the day before, as before.
    early = appointment.plan_steps(datetime(2026, 11, 3, 10, 0, tzinfo=tz), now=now.replace(hour=8), tz=tz)
    assert [s.due_at.date() for s in early if s.step == appointment.STEP_CONFIRM] == [now.date()]


def test_the_reply_check_catches_asking_the_same_question_again():
    memory = [_m("outbound", "I can help with that. Which SUV would you like the link for?"), _m("inbound", "Yes")]
    assert loop_check.repeated_question("Got it! Which SUV model would you like the link for?", memory)
    assert loop_check.repeated_question("Here's our Escalade: https://x.test/esc. Want to see it today?", memory) is None
    offer = [_m("outbound", "Would today at 2:00 PM or 3:00 PM work?")]
    assert loop_check.repeated_question("Would today at 4:00 PM or 5:00 PM work?", offer) is None


async def test_call_tasks_done_is_only_calls_made_and_each_day_is_counted(mongo):
    # Betsy, 2 Nov 2026 meeting: "done is supposed to be when it's complete, not when it's missed or dismissed".
    from upsell_agent.api import staff_view
    from upsell_agent.integrations.mongodb import AI_CALL_TASKS_COLLECTION
    set_clock(TUESDAY_NOON)
    day = datetime(2026, 9, 22, 15, 0, tzinfo=UTC)
    rows = [("completed", day), ("missed", day), ("cancelled", day), ("dismissed", day), ("open", day),
            ("missed", datetime(2026, 9, 21, 15, 0, tzinfo=UTC))]
    for status, at in rows:
        await mongo[AI_CALL_TASKS_COLLECTION].insert_one({"dealer_id": DEALER, "lead_id": str(ObjectId()),
                                                          "status": status, "opened_at": at, "closed_at": at})
    assert [r["status"] for r in await staff_view.list_call_tasks(DEALER, "done")] == ["completed"]
    assert len(await staff_view.list_call_tasks(DEALER, "missed")) == 2
    assert {r["status"] for r in await staff_view.list_call_tasks(DEALER, "cancelled")} == {"cancelled", "dismissed"}
    assert len(await staff_view.list_call_tasks(DEALER, "missed", date_from="2026-09-22", date_to="2026-09-22",
                                                tz_offset_minutes=-240)) == 1
    [today, yesterday] = await staff_view.call_tasks_by_day(DEALER, 14, -240)
    assert today == {"day": "2026-09-22", "opened": 5, "called": 1, "missed": 1, "open": 1}
    assert yesterday["day"] == "2026-09-21" and yesterday["missed"] == 1


def test_times_on_one_day_name_the_day_once():
    # The user, 3 Nov 2026: "this doesn't look like a normal human being's message".
    from upsell_agent.agent.nodes.compose import one_day_name
    draft = {"sms_text": "No problem, Ammar! I've got tomorrow (Wednesday) at 10:00 AM, tomorrow (Wednesday) at 2:00 PM, "
                         "or tomorrow (Wednesday) at 7:00 PM. Which one works?",
             "email_body": "Would today at 1:00 PM or today at 3:00 PM work? Or Saturday at 10:00 AM."}
    one_day_name(draft)
    assert draft["sms_text"] == ("No problem, Ammar! I've got tomorrow (Wednesday) at 10:00 AM, 2:00 PM, or 7:00 PM. "
                                 "Which one works?")
    assert draft["email_body"] == "Would today at 1:00 PM or 3:00 PM work? Or Saturday at 10:00 AM."
    # Different days keep their names.
    mixed = {"sms_text": "Would Saturday at 10:00 AM or Sunday at 11:00 AM work for you?"}
    one_day_name(mixed)
    assert mixed["sms_text"] == "Would Saturday at 10:00 AM or Sunday at 11:00 AM work for you?"


def test_no_one_is_promised_to_reach_out_to_a_customer_who_bought_elsewhere():
    # Marcizio Araujo, 3 Nov 2026: "I brought my car already Thanks".
    from upsell_agent.agent.nodes.compose import no_promise_after_not_interested
    said = "Thanks for letting me know, and congratulations on your purchase! Our sales manager will reach out shortly."
    draft = {"sms_text": said, "email_body": "Hi,\n\nCongratulations on your new car! Someone from our team will be in "
                                             "touch soon.\n\nThank you"}
    no_promise_after_not_interested(draft, {"not_interested": {"mode": "handoff", "reason": "bought elsewhere"}})
    assert draft["sms_text"] == "Thanks for letting me know, and congratulations on your purchase!"
    assert "touch" not in draft["email_body"] and "Congratulations on your new car!" in draft["email_body"]
    # Any other handoff (they asked for a person) keeps it.
    kept = {"sms_text": said}
    no_promise_after_not_interested(kept, {"not_interested": None, "action": "handoff"})
    assert kept["sms_text"] == said
