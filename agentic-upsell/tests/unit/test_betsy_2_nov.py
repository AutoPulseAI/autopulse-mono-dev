"""Betsy's emails of 2 Nov 2026: the leads as they happened."""

from types import SimpleNamespace

import pytest

from upsell_agent.agent import cannot_supply, specialists
from upsell_agent.agent.nodes.decide import CONDITION_QUESTION, REMOTE_PURCHASE, _may_ask_name, _times_worn_out
from upsell_agent.agent.nodes.guard import _PHONE_IN_TEXT


def test_a_swap_is_the_trade_agent_not_credit():
    said = "Is there a way I can get a value in it from here i pretty much want to get approved and swap"
    assert specialists.route(said)[0].id == specialists.TRADE


def test_the_agent_stays_on_the_conversation():
    assert specialists.route("Hello just checking in", previous="trade")[0].id == specialists.TRADE
    assert specialists.route("Is it still available?", previous="trade")[0].id == specialists.SALES
    assert specialists.route("Hello", previous=None)[0].id == specialists.SALES


@pytest.mark.parametrize(("text", "sid"), [
    ("I still owe 12k on my lease return", "trade"), ("my fico is 580", "credit"),
    ("any wiggle room", "price_payment")])
def test_every_agent_has_more_words(text, sid):
    lead_type = None
    assert specialists.route(text, lead_type=lead_type)[0].id == sid


def test_price_negotiation_has_an_answer():
    said = "I'm interested in this car but wanted to see if the price was negotiable"
    assert cannot_supply.detect(said) == cannot_supply.NEGOTIATE
    assert cannot_supply.needs_times(cannot_supply.NEGOTIATE)


@pytest.mark.parametrize("text", ["It would be strictly over the phone purchase", "I'm too far", "I live 4-5 hrs away"])
def test_cant_come_in_goes_to_a_manager(text):
    assert REMOTE_PURCHASE.search(text)


def test_battery_health_is_a_condition_question():
    assert CONDITION_QUESTION.search("Do you know the battery health?")


def test_a_detail_not_given_is_asked_in_the_next_reply_at_most_twice():
    from datetime import UTC, datetime
    now = datetime(2026, 11, 1, 22, 23, tzinfo=UTC)
    assert _may_ask_name({"name_asked": now, "name_asks": 1}, now)
    assert not _may_ask_name({"name_asked": now, "name_asks": 2}, now)


def test_the_same_times_are_not_offered_a_third_time():
    times = [{"display": "tomorrow at 10:00 AM"}, {"display": "tomorrow at 11:00 AM"}]
    plan = SimpleNamespace(fire=True, times=times)
    ask = "Would tomorrow at 10:00 AM, 11:00 AM, or 12:00 PM work?"
    pack = {"working_memory": [{"direction": "outbound", "text": ask}, {"direction": "inbound", "text": "hi"},
                               {"direction": "outbound", "text": ask}]}
    assert _times_worn_out(plan, pack)
    assert not _times_worn_out(plan, {"working_memory": pack["working_memory"][:2]})


def test_a_phone_number_in_a_reply_is_found():
    assert _PHONE_IN_TEXT.findall("You can call (631) 416-6273 to discuss") == ["(631) 416-6273"]
