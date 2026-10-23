"""Live, 23 Oct 2026: 14 safe-template replies and 3 failed turns, none from OpenAI credit.

- "C 300", "Altima 2.5 SR" were rejected as invented numbers (7 of 14): the car's own model / trim names.
- "the SMS isn't written in Unknown": a language that couldn't be told is no language to write in.
- "11am" got nothing: booking it, the CRM call timed out and the turn failed three times - now the safe reply goes.
"""

import httpx
import pytest

from tests.unit.test_human_contact import TUESDAY_NOON, _last_sms, _lead, _say, live_dealer  # noqa: F401
from tests.unit.conftest import set_clock
from upsell_agent.agent.nodes import guard
from upsell_agent.guardrails import draft_guard

pytestmark = pytest.mark.usefixtures("ny_customer")

C300 = {"vin": "WDDWF8DB1KR000001", "year": 2019, "make": "Mercedes-Benz", "model": "C-Class", "trim": "C 300 4MATIC",
        "miles": 51440, "price": 14695}


def test_a_model_or_trim_name_is_not_an_invented_number():
    draft = {"sms_text": "We also have a silver C 300 with 51,440 miles listed at $14,695. Want to come see it "
                         "Friday at 1:00 PM?", "email_body": "", "email_subject": ""}
    plain = draft_guard.check_draft(draft, customer_texts=["Is the C-Class available?"], known_values=["Friday at 1:00 PM"],
                                    inventory=[C300])
    assert any("never gave us" in v and "300" in v for v in plain["violations"])  # without the names: flagged
    known = ["Friday at 1:00 PM", *[C300[k] for k in ("year", "miles", "price", "make", "model", "trim")]]
    checked = draft_guard.check_draft(draft, customer_texts=["Is the C-Class available?"], known_values=known,
                                      inventory=[C300])
    assert not any("never gave us" in v for v in checked["violations"])


def test_unknown_is_no_reply_language():
    draft = {"sms_text": "Are you still shopping? I have Friday at 4:00 PM.", "email_body": "Hi"}
    assert guard.not_in_reply_language({"reply_language": None}, draft) == []


async def test_a_crm_timeout_mid_turn_still_answers_the_customer(mongo, live_dealer, monkeypatch):
    from upsell_agent.agent import graph
    set_clock(TUESDAY_NOON)
    created = await _lead("Tim Timeout")
    before = await _last_sms(mongo, created)

    async def slow(*args, **kwargs):
        raise httpx.ReadTimeout("")

    monkeypatch.setattr(graph, "decide", slow)
    from upsell_agent.agent import turn
    turn._graph.cache_clear()
    try:
        await _say(created, "11am")
    finally:
        turn._graph.cache_clear()
    after = await _last_sms(mongo, created)
    assert after and after != before
    log = await mongo["ai_turn_log"].find({"lead_id": created["lead_id"]}).sort("_id", -1).to_list(1)
    assert log[0]["outcome"] == "fallback"  # the safe reply, not a failed turn
