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


def test_cargurus_and_cars_com_labels_are_not_the_customers_words():
    from upsell_agent.agent.portal_text import clean_comments
    assert clean_comments("(New inquiry submitted on a lead form) View Shopper Signals: https://cargur.us/1Ct7vq "
                          "(no login required) | I'm interested in the 2021 Audi A4. Is it still available? | "
                          "Placed deposit: No | Phone Lead from CarGurus") == \
        "I'm interested in the 2021 Audi A4. Is it still available?"


def test_the_first_messages_price_is_said_once():
    """Live, 23 Oct 2026 (Ryanne): the model wrote the price line too; the placed line said it again (586 chars)."""
    from upsell_agent.agent.nodes.compose import place_touch1_extras
    intro = "Hi Ryanne, this is Nicole, Victory Cars Central's AI Sales Manager, following up on your interest in the 2023 Mercedes-Benz C-Class."
    price = "It's listed at $26,149, not including tax, documentation and DMV fees."
    answers = "Here's the vehicle's page with all the details, including its history report where available: [VEHICLE_LINK]"
    draft = {"sms_text": f"{intro} {price} Tell me, what are you driving now?", "email_body": f"{intro} {price} Thanks."}
    place_touch1_extras(draft, {"intro": intro, "price_line": price, "lead_answers": answers, "vin": "W1K"})
    assert draft["sms_text"].count("$26,149") == 1 and draft["sms_text"].count("history report") == 1
    assert draft["sms_text"].startswith(intro) and draft["sms_text"].endswith("Tell me, what are you driving now?")


async def test_a_form_asking_for_a_video_reaches_dealer_action_required(mongo, live_dealer):
    """Live, 23 Oct 2026 (Ryanne): "Is there any way I could get a video of the car?" on the lead form."""
    from tests.unit.test_human_contact import DEALER, _deps
    from upsell_agent.devtools import simulate
    from upsell_agent.events import handlers
    from upsell_agent.events.models import LeadCreatedEvent
    set_clock(TUESDAY_NOON)
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Ryanne Darwich",
                                         comments="Is it still available? Is there any way I could get a video of "
                                                  "the car?")
    await handlers.handle_lead_created(LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER,
                                                        lead_id=created["lead_id"], customer_id=created["customer_id"],
                                                        channel="sms"), _deps())
    state = await mongo["ai_lead_state"].find_one({"lead_id": created["lead_id"]})
    assert state["crm_status_sync"]["crm_status"] == "Managerial Review"


async def test_open_questions_get_a_real_touch_not_the_name_nudge(mongo, live_dealer):
    """Live, 23 Oct 2026 (Ryanne): her form's questions were never answered; the next touch was "Ryanne?"."""
    from tests.unit.test_human_contact import DEALER, _deps
    from upsell_agent.devtools import simulate
    from upsell_agent.events import handlers
    from upsell_agent.events.models import LeadCreatedEvent
    set_clock(TUESDAY_NOON)
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Ryanne Darwich",
                                         comments="Hi")
    await handlers.handle_lead_created(LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER,
                                                        lead_id=created["lead_id"], customer_id=created["customer_id"],
                                                        channel="sms"), _deps())
    await mongo["ai_lead_state"].update_one({"lead_id": created["lead_id"]}, {"$set": {
        "conversation.open_questions": [{"text": "Is there any way I could get a video of the car?", "turn": 0}]}})
    from upsell_agent.scheduler import followups
    from upsell_agent.integrations.mongodb import dealer_scoped_db
    await followups.plan_cadence_touch(dealer_scoped_db(DEALER), lead_id=created["lead_id"],
                                       customer_id=created["customer_id"], channel="sms", turn_id="t-check",
                                       first_contact_done=True)
    touch = await mongo["scheduled_followups"].find_one({"lead_id": created["lead_id"], "kind": "cadence_touch",
                                                         "status": "pending"}, sort=[("_id", -1)])
    assert touch and (touch.get("touch") or {}).get("touch_number") != 2  # never the "Ryanne?" name nudge


def test_everyday_words_are_not_trims():
    """Live, 23 Oct 2026: "in your $400-500 range" rejected as a trim; "RAV4 Limited" still is one."""
    rav4 = {"vin": "VIN0000000000RAV4", "year": 2022, "make": "Toyota", "model": "RAV4", "trim": "XLE",
            "miles": 20000, "price": 25000}
    ok = {"sms_text": "The 2022 Toyota RAV4 XLE fits your $400-500 range. Want to see it Friday at 1:00 PM?",
          "sms_vins": ["VIN0000000000RAV4"], "email_body": "", "email_subject": ""}
    v = draft_guard.check_draft(ok, customer_texts=["400-500"], known_values=["Friday at 1:00 PM", 2022, 20000, 25000],
                                inventory=[rav4])["violations"]
    assert not any("trim" in x for x in v)
    bad = {**ok, "sms_text": "The 2022 Toyota RAV4 Limited fits your budget. Want to see it Friday at 1:00 PM?"}
    v = draft_guard.check_draft(bad, customer_texts=["400-500"], known_values=["Friday at 1:00 PM", 2022, 20000, 25000],
                                inventory=[rav4])["violations"]
    assert any("trim not on the named vehicle(s): limited" in x for x in v)


def test_a_follow_up_offering_two_similar_cars_is_not_rejected():
    # Live, 23 Oct 2026 19:00 / 19:06: the "40" of "Audi A3 40 Premium" (on the car's record) and a 369-character
    # follow-up offering two cars both ended on the safe template.
    a3 = {"year": 2024, "make": "Audi", "model": "A3", "trim": "Premium", "title": "2024 Audi A3 40 Premium",
          "miles": 46225, "price": 18949}
    sms = ("The 2024 Audi A3 40 Premium is here in black with 46,225 miles, listed at $18,949 (not including tax, "
           "documentation and DMV fees). What day works for you to come see it?")
    known = ["Friday at 1:00 PM", 2024, 46225, 18949, "Audi", "A3", "Premium",
             *[v for v in a3.values() if isinstance(v, str)]]
    checked = draft_guard.check_draft({"sms_text": sms, "email_subject": "s", "email_body": "b"}, customer_texts=[],
                                      known_values=known, inventory=[a3])
    assert checked["checks"]["no_invented_numbers"], checked["violations"]
    long_sms = "x " * 180 + "What day works?"
    short = draft_guard.check_draft({"sms_text": long_sms, "email_subject": "s", "email_body": "b"}, customer_texts=[],
                                    known_values=[], inventory=[])
    longer = draft_guard.check_draft({"sms_text": long_sms, "email_subject": "s", "email_body": "b"}, customer_texts=[],
                                     known_values=[], inventory=[], sms_max=draft_guard.TOUCH1_SMS_MAX)
    assert not short["checks"]["sms_length_ok"] and longer["checks"]["sms_length_ok"]
