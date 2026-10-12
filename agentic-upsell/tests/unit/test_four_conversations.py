"""Client, 12 Oct 2026: the four live conversations (Mailyn, Johnson, Jon, Jean)."""

from upsell_agent.agent.nodes.decide import _BOOKS_FROM_OWN_REPLY, _NOT_READY
from upsell_agent.agent.nodes.template_reply import avoid_repeat
from upsell_agent.agent.offline_model import _TRADE
from upsell_agent.slots.prefill import facts_from_lead


def test_the_lead_vehicle_is_what_they_want():
    assert facts_from_lead({"year": "2025", "make": "BMW", "model": "330i"}) == {"interest.model": "2025 BMW 330i"}
    assert facts_from_lead({"data": {"vehicle": {"year": "2023", "make": "Honda", "model": "CR-V"}}}) == {
        "interest.model": "2023 Honda CR-V"}
    assert facts_from_lead({"data": {"comments": "hi"}}) == {}


def test_never_books_from_the_lead_email_or_when_not_ready():
    assert "lead_created" not in _BOOKS_FROM_OWN_REPLY
    assert "visit_followup" not in _BOOKS_FROM_OWN_REPLY
    assert _NOT_READY.search("Saturday at 1 could work but I need the numbers first")
    assert _NOT_READY.search("let me think about it")
    assert not _NOT_READY.search("Saturday at 1 works")


def test_the_safety_net_never_repeats_itself():
    sent = ["Thanks, Jean. Let me check on that with the team, and someone will get back to you shortly."]
    draft = {"sms_text": sent[0], "email_body": "x", "asks": {"sms": [], "email": []}}
    again = avoid_repeat(draft, sent, "Jean Smith")
    assert again["sms_text"] != sent[0] and again["sms_text"].startswith("Thanks, Jean.")
    assert avoid_repeat(draft, [], "Jean")["sms_text"] == sent[0]


def test_the_value_of_my_car_is_a_trade():
    assert _TRADE.search("what is the value of my civic")
    assert _TRADE.search("how much would you give me for my car")
    assert not _TRADE.search("what's my payment")


def test_a_new_lead_email_is_not_contact():
    from upsell_agent.agent.lifecycle import Event, Stage, transition
    for current in (None, Stage.NEW_LEAD, Stage.NO_CONTACT):
        assert transition(current, Event("reengaged")).stage == Stage.NO_CONTACT
    assert transition(Stage.CONTACT_NO_ACTION, Event("reengaged")).stage == Stage.CONTACT_NO_ACTION
