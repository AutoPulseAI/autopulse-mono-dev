"""What the AI can't supply, in the client's words (client, 12 Oct 2026 - Betsy)."""

import pytest

from tests.unit.test_booking_flow import DEALER, _last_sms, _lead, _say, _state
from upsell_agent.agent import cannot_supply as cs
from upsell_agent.integrations.mongodb import PLATFORM_LEADS_COLLECTION, as_object_id

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")

TIMES = ["Tuesday at 10:00 AM", "Wednesday at 2:00 PM"]


def test_each_topic_is_recognised():
    assert cs.detect("what's my credit score?") == cs.CREDIT_SCORE
    assert cs.detect("what would my monthly payment be") == cs.PAYMENT
    assert cs.detect("I just want to know my interest rates") == cs.APR
    assert cs.detect("what's the APR?") == cs.APR
    assert cs.detect("what's the out the door price") == cs.OTD
    assert cs.detect("can you send me a video of it?") == cs.CUSTOM_MEDIA
    assert cs.detect("I live out of state") == cs.OUT_OF_STATE
    assert cs.detect("is it still available?") is None
    assert cs.detect("how much is it?") is None  # the listed price - the AI can give that


def test_the_replies_are_her_words_with_two_times():
    apr = cs.reply(cs.APR, times=TIMES)
    assert apr.text.startswith("Our goal is to get you the lowest possible APR, so this requires some work on our end.")
    assert apr.text.endswith("I have Tuesday at 10:00 AM or Wednesday at 2:00 PM available.") and apr.offers_times
    credit = cs.reply(cs.CREDIT_SCORE, times=TIMES).text
    assert "because we have to confirm your identity" in credit and "business manager" in credit
    payment = cs.reply(cs.PAYMENT, times=TIMES, vehicle_url="https://dealer.example/vdp/1").text
    assert "payment calculator can be found here: https://dealer.example/vdp/1" in payment
    assert "calculator" not in cs.reply(cs.PAYMENT, times=TIMES).text  # no page: no calculator line
    otd = cs.reply(cs.OTD, times=TIMES).text
    assert otd.startswith("Our list price is accurate") and "exclusive of tax, documentation, and DMV" in otd
    assert cs.reply(cs.OUT_OF_STATE).text == ("That is no problem at all; we work with customers who are out of "
                                              "state all the time. Do you plan to pick the vehicle up or have it "
                                              "shipped to you?")
    assert "team" not in " ".join(cs.reply(t, times=TIMES).text for t in cs._REPLIES).lower()


def test_without_two_open_times_no_time_is_invented():
    answer = cs.reply(cs.APR, times=["Tuesday at 10:00 AM"])
    assert answer.text.endswith("What day this week works best for you to meet with us?") and not answer.offers_times


def test_a_booked_visit_is_pointed_to_instead_of_new_times():
    answer = cs.reply(cs.APR, booked="Saturday at 11:00 AM")
    assert answer.text.endswith("We'll go over it together at your visit on Saturday at 11:00 AM.")
    assert "What day" not in answer.text


def test_custom_photos_need_the_dealership():
    assert cs.reply(cs.CUSTOM_MEDIA, times=TIMES).as_dict()["escalates"] is True
    assert cs.reply(cs.APR, times=TIMES).as_dict()["escalates"] is False


async def test_a_payment_question_gets_her_answer_and_a_pick_books(mongo):
    created = await _lead()
    await _say(created, "What would my monthly payment be?")
    reply = await _last_sms(mongo, created)
    assert reply.startswith("Our goal is to get you the lowest possible payment")
    assert reply.endswith("available.") and " or " in reply and "team" not in reply.lower()
    state = await _state(mongo, created)
    assert len(state["conversation"]["visit"]["offered_times"]) == 2
    await _say(created, "the first one works")
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})
    assert lead["data"].get("bookingId") and lead["status"] == "Appointment Booked"
    assert DEALER


def test_a_budget_they_state_is_not_a_payment_question():
    """Client, 16 Oct 2026: George said "Around 500 a month" (his budget) and got her "lowest possible payment" script."""
    for said in ("Around 500 a month", "I want to stay under 500 a month", "Payment of 400 a month max",
                 "my credit score is 700"):
        assert cs.detect(said) is None, said
    assert cs.detect("how much per month") == cs.PAYMENT and cs.detect("what credit score do I need") == cs.CREDIT_SCORE
