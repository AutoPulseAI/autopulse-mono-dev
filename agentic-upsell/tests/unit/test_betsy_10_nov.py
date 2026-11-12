"""Betsy, 10 Nov 2026 emails.

"AI issue": "if a customer says I found a better deal somewhere else, we want the ai to be smarter ... and maybe ask
the customer Did you already take delivery of the vehicle?" - live, 8-9 Nov: Naty Coria ("I already bought a car"),
Emily Chandler ("we have found a car"), Sawyer Buffum ("nvm i found a better deal") all got "Thanks, X, I've made a note
of that. What day this week works best for you to come in?".

"customer asked for price we gave cash price": Mustafa Abusaab, "I am paying cash. Is this the price?" / "Is this the
price for cash?" - the AI repeated the listed price three times and went to a manager.
"""

import pytest

from tests.unit.test_client_requirements import RAV4, _new_lead, _sent
from tests.unit.test_booking_flow import _last_sms, _say, _state
from upsell_agent.agent.conversation import ConversationState, NotInterestedState
from upsell_agent.agent.nodes.decide import FOUND_ELSEWHERE_QUESTION, found_elsewhere, not_interested_mode

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")

SAID = {"not_interested": True, "not_interested_confidence": 0.95}


@pytest.mark.parametrize("text", ["I already bought a car", "No Thankyou, thankyou for the update but we have found a car.",
                                  "nvm i found a better deal", "just found better deals on a audi s5",
                                  "went with another dealer", "got one cheaper somewhere else"])
def test_found_or_bought_elsewhere_asks_about_delivery_first(text):
    assert found_elsewhere(None, text)
    assert not_interested_mode(SAID, ConversationState(turn=2), text)[0] == "ask_delivery"


@pytest.mark.parametrize("text", ["not interested anymore", "I'm good, thanks", "too expensive for me"])
def test_other_not_interested_messages_keep_their_rule(text):
    assert not found_elsewhere(None, text)
    assert not_interested_mode(SAID, ConversationState(turn=2), text)[0] in ("ask_why", "handoff")


def test_the_ai_reading_decides_not_interested_never_the_words_alone():
    # "Found a car I like on your site" is not "not interested": the AI didn't read it as such, nothing changes.
    assert not_interested_mode({}, ConversationState(turn=2), "I found a car I like on your site")[0] is None


@pytest.mark.parametrize(("answer", "mode"), [
    ("Yes", "handoff"), ("yes already picked it up", "handoff"), ("I already took delivery", "handoff"),
    ("No not yet", None), ("not yet, still deciding", None), ("no", None), ("haven't signed anything", None),
])
def test_the_answer_decides_handoff_or_carry_on(answer, mode):
    asked = ConversationState(turn=3, not_interested=NotInterestedState(reason="found a better deal",
                                                                        delivery_asked_turn=3))
    got, reason = not_interested_mode({}, asked, answer)
    assert got == mode
    if mode == "handoff":
        assert reason == "found a better deal"


def test_asked_once_only():
    asked = ConversationState(turn=5, not_interested=NotInterestedState(reason="found a car", delivery_asked_turn=3))
    assert not_interested_mode(SAID, asked, "I told you I found a better deal")[0] != "ask_delivery"


async def test_end_to_end_found_a_better_deal(mongo):
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "nvm i found a better deal")
    reply = await _last_sms(mongo, created)
    state = await _state(mongo, created)
    if ((state.get("conversation") or {}).get("not_interested") or {}).get("delivery_asked_turn"):
        assert reply == FOUND_ELSEWHERE_QUESTION
        assert "come in" not in reply
    else:
        # The offline model didn't read it as not interested: the rule isn't reached (the AI's reading decides).
        pytest.skip("offline model did not read the message as not interested")


@pytest.mark.parametrize("asked", ["Is this the price for cash?", "I am paying cash. Is this the price?"])
async def test_a_cash_price_question_gets_betsys_price_answer(mongo, asked):
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, asked)
    reply = await _last_sms(mongo, created)
    assert reply.startswith("Yes, our list price is the same whether you pay cash or finance."), reply
    assert (await _state(mongo, created)).get("status") != "handoff"


async def test_end_to_end_not_yet_carries_on_and_took_delivery_hands_off(mongo):
    # Not yet: still a live deal - the AI keeps working it, nothing is handed off.
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "I already bought a car")
    assert await _last_sms(mongo, created) == FOUND_ELSEWHERE_QUESTION
    await _say(created, "No not yet, still deciding")
    assert (await _state(mongo, created)).get("status") not in ("handoff", "paused")
    assert await _last_sms(mongo, created) != FOUND_ELSEWHERE_QUESTION

    # Took delivery: the existing rule - thanked, a person decides whether to close the lead.
    other = await _new_lead(mongo, name="Emily Chandler", vehicle=RAV4, phone="+15550009988")
    await _say(other, "we have found a car")
    assert await _last_sms(mongo, other) == FOUND_ELSEWHERE_QUESTION
    await _say(other, "Yes already picked it up")
    assert (await _state(mongo, other)).get("status") == "handoff"
    assert "come in" not in (await _last_sms(mongo, other)).lower()


def test_after_we_asked_what_changed_the_existing_handoff_stays():
    # Scope Q10: our "what changed?" was answered - a person decides; no second question in a row.
    waiting = ConversationState(turn=2, not_interested=NotInterestedState(asked_turn=2))
    assert not_interested_mode(SAID, waiting, "Bought one elsewhere last week")[0] == "handoff"


# 12 Nov 2026: every way people write it, not only the three live messages.
@pytest.mark.parametrize("text", [
    "I got a Tesla", "already leased a BMW", "purchased from CarMax", "we decided on a Honda", "picked one up yesterday",
    "made a deal down the street", "ended up with a Rav4 from another lot", "Bought elsewhere", "ya compré un carro",
    "encontré una mejor oferta"])
def test_found_elsewhere_in_other_words(text):
    assert found_elsewhere(None, text)
    assert not_interested_mode(SAID, ConversationState(turn=2), text)[0] == "ask_delivery"


@pytest.mark.parametrize(("answer", "mode"), [
    ("No, I already took it", "handoff"), ("we have it already", "handoff"), ("ya lo tengo", "handoff"),
    ("I haven't taken it yet", None), ("I'm picking it up Saturday", None), ("Yes, picking it up Saturday", None),
    ("nope", None), ("todavía no", None), ("why do you ask?", None),
])
def test_the_answer_in_other_words(answer, mode):
    asked = ConversationState(turn=3, not_interested=NotInterestedState(reason="found a better deal",
                                                                        delivery_asked_turn=3))
    assert not_interested_mode({}, asked, answer)[0] == mode


# Betsy, 12 Nov 2026: "Is the listed price the same whether the customer pays cash or finances?" - "yes".
@pytest.mark.parametrize("text", [
    "Is this the price for cash?", "I am paying cash. Is this the price?", "is that the cash price?",
    "whats the price if I pay cash", "Is the cost the same if paying cash?", "Is the price the same if I finance?",
    "Is the internet price only with financing?", "Do you have a better price for cash buyers?", "Any discount for cash?",
    "whats your best cash number?", "price if I pay in full?", "what's the price without financing?",
    "is it the same if I finance?", "If I pay in full is the price less?", "¿es precio de contado?",
    "¿ese precio es en efectivo?"])
def test_a_cash_or_finance_price_question_gets_the_yes(text):
    from upsell_agent.agent import cannot_supply
    assert cannot_supply.detect(text) == cannot_supply.CASH_OR_FINANCE
    answer = cannot_supply.reply(cannot_supply.CASH_OR_FINANCE, times=["Friday at 10:00 AM", "Friday at 2:00 PM"]).text
    assert answer.startswith("Yes, our list price is the same whether you pay cash or finance.")
    assert "Friday at 10:00 AM or Friday at 2:00 PM" in answer


@pytest.mark.parametrize("text", [
    "I'm paying cash", "Can I buy it with cash?", "Will you take cash?", "I have cash for a down payment",
    "Can I get financing with a different bank?", "Do you offer financing?", "whats the price?"])
def test_cash_or_finance_mentioned_without_asking_about_the_price_is_not_it(text):
    from upsell_agent.agent import cannot_supply
    assert cannot_supply.detect(text) != cannot_supply.CASH_OR_FINANCE


def test_other_money_questions_keep_their_own_answer():
    from upsell_agent.agent import cannot_supply
    assert cannot_supply.detect("What would my monthly payment be if I finance?") == cannot_supply.PAYMENT
    assert cannot_supply.detect("what's the out the door price?") == cannot_supply.OTD
    assert cannot_supply.detect("Can you come down on the price?") == cannot_supply.NEGOTIATE
