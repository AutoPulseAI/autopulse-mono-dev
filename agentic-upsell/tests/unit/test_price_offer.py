"""A price the customer offers reaches a manager at once (Robby Torres, 27 Oct 2026: "I can give them 19k out the door",
then "19 and you can confirm here if is ok then I can go there" - nobody at the store saw it)."""

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_never_silent import _lead, _say, _state, dealers, ny  # noqa: F401
from upsell_agent.agent.crm_notes import AI_CRM_NOTES_COLLECTION
from upsell_agent.agent.turn import _PRICE_OFFER


@pytest.mark.parametrize("text", ["And overpriced I can give them 19k out the door", "Would you take $18,500?",
                                  "I'd do 20k cash", "$19,000 out the door and I'm there", "can you do 17.5k"])
def test_an_offer(text):
    assert _PRICE_OFFER.search(text)


@pytest.mark.parametrize("text", ["What is your best lowest price to buy ?", "I have 74,825 miles on mine",
                                  "I can come at 2", "My budget is around $400 a month", "Is it a 2019?"])
def test_not_an_offer(text):
    assert not _PRICE_OFFER.search(text)


async def test_a_manager_is_told_of_the_offer(mongo, dealers):  # noqa: F811
    set_clock(ny(22, 11))
    created = await _lead()
    await _say(created, "And overpriced I can give them 19k out the door")
    assert (await _state(mongo, created))["staff_notice"]["kind"] == "price_offer"
    note = await mongo[AI_CRM_NOTES_COLLECTION].find_one({"lead_id": created["lead_id"], "kind": "price_offer"})
    assert note and "19k out the door" in note["text"]
