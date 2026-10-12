"""The buyer's order sequence (client, 12 Oct 2026 - Betsy)."""

from datetime import UTC, datetime

import pytest

from tests.unit.test_booking_flow import _last_sms, _lead, _say, _state
from upsell_agent.agent import buyers_order as bo

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")
NOW = datetime(2026, 10, 12, 15, 0, tzinfo=UTC)
LINK = "https://dealer.example/credit"


def _at(step):
    return {"buyers_order": {"step": step, "at": NOW}}


def test_each_branch_is_her_text():
    assert bo.plan({}, "Can you please send me a buyer's order for this car?", NOW, credit_link=LINK).text == bo.START
    assert bo.plan(_at(bo.DELIVERY), "yes", NOW, credit_link=LINK).text.endswith("Are you trading a vehicle?")
    trade = bo.plan(_at(bo.TRADE), "yes", NOW, credit_link=LINK)
    assert "we must appraise your trade-in first" in trade.text and trade.next_step is None
    assert bo.plan(_at(bo.TRADE), "no", NOW, credit_link=LINK).text == "Are you planning to finance this vehicle?"
    finance = bo.plan(_at(bo.FINANCE), "yes I am", NOW, credit_link=LINK).text
    assert "complete our credit application to ensure you qualify. Here is a link: " + LINK in finance
    assert "lien holder" in bo.plan(_at(bo.FINANCE), "no", NOW, credit_link=LINK).text
    assert bo.plan(_at(bo.LIEN), "yes", NOW, credit_link=LINK).next_step == bo.RATE
    assert LINK in bo.plan(_at(bo.RATE), "yes", NOW, credit_link=LINK).text
    papers = bo.plan(_at(bo.LIEN), "no", NOW, credit_link=LINK)
    assert "driver's license and insurance ID card" in papers.text and papers.next_step == bo.CALL
    call = bo.plan(_at(bo.CALL), "yes", NOW, credit_link=LINK)
    assert call.escalates and call.next_step is None


def test_anything_but_yes_or_no_leaves_the_sequence():
    assert bo.plan(_at(bo.TRADE), "what color is it?", NOW, credit_link=LINK) is None
    assert bo.plan(_at(bo.DELIVERY), "no, next week", NOW, credit_link=LINK) is None
    assert bo.plan({}, "is it available?", NOW, credit_link=LINK) is None


async def test_the_sequence_runs_in_a_conversation(mongo):
    created = await _lead()
    await _say(created, "Can you please send me a buyer's order for this car?")
    assert await _last_sms(mongo, created) == bo.START
    assert (await _state(mongo, created))["buyers_order"]["step"] == bo.DELIVERY
    await _say(created, "yes")
    assert (await _last_sms(mongo, created)).endswith("Are you trading a vehicle?")
    await _say(created, "no")
    assert await _last_sms(mongo, created) == "Are you planning to finance this vehicle?"
