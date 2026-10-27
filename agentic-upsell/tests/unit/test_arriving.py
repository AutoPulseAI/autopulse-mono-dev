"""A customer on the way: staff are told, and the AI never says "ask for Nicole" (27 Oct 2026, the Dodge Charger lead:
"Yeah, I'm on my way. I will be there in 10 minutes." -> "Ask for Nicole when you arrive"; nobody was told)."""

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_never_silent import _lead, _say, _state, dealers, ny  # noqa: F401
from upsell_agent.agent.turn import _ON_THE_WAY, without_ask_for_assistant
from upsell_agent.agent.crm_notes import AI_CRM_NOTES_COLLECTION


def test_ask_for_the_assistant_is_taken_out():
    text = ("Great—see you in about 10 minutes. I’ll have the 2023 Dodge Charger SXT ready for you. We’re at 3914 "
            "Hempstead Tpke, Levittown, NY 11756. Ask for Nicole when you arrive.")
    out = without_ask_for_assistant(text)
    assert "Nicole" not in out and out.endswith("Let the front desk know you're here for the vehicle.")
    assert "Dodge Charger SXT ready" in out
    assert without_ask_for_assistant("Ask for Monday's times and I'll check.") == "Ask for Monday's times and I'll check."


@pytest.mark.parametrize("text", ["Yeah, I'm on my way. I will be there in 10 minutes.", "omw", "I'm outside",
                                  "leaving now, be there in 20"])
def test_on_the_way(text):
    assert _ON_THE_WAY.search(text)


@pytest.mark.parametrize("text", ["What state are you in?", "I can't come this week", "Is it on the lot?"])
def test_not_on_the_way(text):
    assert not _ON_THE_WAY.search(text)


async def test_staff_are_told_when_the_customer_is_on_the_way(mongo, dealers):  # noqa: F811
    set_clock(ny(22, 11))
    created = await _lead()
    await _say(created, "Yeah, I'm on my way. I will be there in 10 minutes.")
    state = await _state(mongo, created)
    assert state["staff_notice"]["kind"] == "customer_arriving"
    note = await mongo[AI_CRM_NOTES_COLLECTION].find_one({"lead_id": created["lead_id"], "kind": "customer_arriving"})
    assert note and "on the way" in note["text"]
