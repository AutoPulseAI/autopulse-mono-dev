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


# --- Monitoring, 23 Oct 2026 -------------------------------------------------------------------------------------

@pytest.mark.parametrize("text,claims", [
    ("Yes—I'm a real person. I'm Nicole with Victory Cars Central.", True),
    ("I'm a real person—Nicole with Victory Cars Central.", True),
    ("I typed “Central” by mistake when my system pulled our dealership name.", True),
    ("I'm not a bot, promise.", True),
    ("I'm Victory Cars Central's AI assistant - happy to help, and a person can take over any time.", False),
    ("Our sales manager is a real person and will text you shortly.", False),
])
def test_the_ai_never_claims_to_be_human(text, claims):
    assert bool(guard.claims_to_be_human({}, {"sms_text": text})) is claims


@pytest.mark.parametrize("raw,want", [
    ("1900 None None", None), ("None", None), ("2019 Honda Accord", "2019 Honda Accord"),
    ("2020 null Camry", "2020 Camry"), ("2024 BMW 430 i", "2024 BMW 430 i"),
])
def test_placeholder_vehicles_are_never_named(raw, want):
    from upsell_agent.agent.cadence import clean_vehicle, touch1_intro
    assert clean_vehicle(raw) == want
    intro = touch1_intro(customer_first_name="Joseph", agent_name="Nicole", dealership="Victory Cars Central",
                         city=None, state_code=None, vehicle=raw, service=False, origin="inbound")
    assert "None" not in intro and "1900" not in intro


def test_manual_or_auto_is_not_a_request_for_a_person():
    from upsell_agent.agent.human_contact import asks_for_person, said_method
    assert not asks_for_person("Manual or Auto") and said_method("Manual or Auto", answering=False) is None
    assert asks_for_person("I want to speak to a rep")


def test_an_html_email_reply_reads_as_its_words():
    from upsell_agent.events.models import InboundMessageEvent
    html_body = ('<html><head><meta http-equiv="Content-Type" content="text/html"><style>p{}</style></head><body>'
                 '<div>11am works&nbsp;for me</div><div>On Thu, Oct 23, 2026 at 10:00 AM Nicole wrote:</div>'
                 '<blockquote>Would Saturday at 11 AM work?</blockquote></body></html>')
    event = InboundMessageEvent(event_id="e1", dealer_id="d1", customer_id="c1", lead_id="l1", channel="email",
                                message_id="m1", text=html_body, received_at="2026-10-23T14:00:00Z")
    assert event.text == "11am works for me"


async def test_the_dealerships_name_is_never_the_customers(mongo, live_dealer):
    from bson import ObjectId
    from upsell_agent.agent import turn as turn_module
    from upsell_agent.integrations import dealer_profile as dp
    from upsell_agent.integrations.mongodb import PLATFORM_USERS_COLLECTION, dealer_scoped_db
    from tests.unit.test_human_contact import DEALER
    await mongo[PLATFORM_USERS_COLLECTION].update_one(
        {"_id": ObjectId(DEALER)}, {"$set": {"name": "Victory Cars Central",
                                             "dealer_account_information.store_name": "Victory Cars Central"}})
    dp._cache.clear()
    db = dealer_scoped_db(DEALER)
    assert await turn_module._customer_name(db, None, None, {"name": "Central"}, {"name": "Victory Cars Central"}) \
        is None  # "Thanks, Central" never again
    assert await turn_module._customer_name(db, None, None, {"name": "Central"}, {"name": "Steve Rogers"}) \
        == "Steve Rogers"
    dp._cache.clear()
