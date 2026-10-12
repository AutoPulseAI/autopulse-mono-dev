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
    from upsell_agent.agent.templates import CONTINUE_CHECKING
    sent = [CONTINUE_CHECKING.format(name="Jean")]
    draft = {"sms_text": sent[0], "email_body": "x", "asks": {"sms": [], "email": []}}
    again = avoid_repeat(draft, sent, "Jean Smith")
    assert again["sms_text"] != sent[0] and "Jean" in again["sms_text"] and "team" not in again["sms_text"]
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


async def test_the_interior_photo_when_asked_about_the_inside(monkeypatch):
    from upsell_agent.agent import interior_photo as ip
    views = {"https://x/1.jpg": "cargo", "https://x/2.jpg": "front", "https://x/3.jpg": "interior"}
    looked: list[str] = []

    async def fake_label(url, settings):
        looked.append(url)
        return views[url]

    monkeypatch.setattr(ip, "_label", fake_label)
    assert ip.asks_about_interior("what color is the interior?")
    assert ip.asks_about_interior("are the seats leather")
    assert not ip.asks_about_interior("is it still available")
    assert await ip.interior_photo(list(views), None, None) == "https://x/3.jpg"
    assert looked == list(views)


async def test_no_model_no_guess(monkeypatch):
    from upsell_agent.agent import interior_photo as ip

    async def no_label(url, settings):
        return None

    monkeypatch.setattr(ip, "_label", no_label)
    assert await ip.interior_photo(["https://x/1.jpg"], None, None) is None


def test_the_trade_agent_hears_value_of_my_car():
    from upsell_agent.agent.specialists import TRADE, route
    for said in ("Depends for the value of you home to my civic", "what can you give me for my accord",
                 "my civic's value", "can you appraise my truck"):
        assert route(said)[0].id == TRADE, said
    assert route("do you have it in blue")[0].id != TRADE


def test_first_reply_price_photo_and_no_phone_email():
    # Client, 12 Oct 2026 (Betsy: Natasha's and Francisco's leads).
    from types import SimpleNamespace

    from upsell_agent.agent.nodes.compose import place_touch1_extras
    from upsell_agent.agent.nodes.decide import first_reply_extras
    lead = {"year": "2026", "make": "Hyundai", "model": "Tucson", "vin": "5NMJBCDE4TH632221",
            "email": "pandofrancisco@yahoo.com"}
    ctx = SimpleNamespace(lead=lead, customer={}, lead_state={})
    state = SimpleNamespace(customer_name="Francisco Pando",
                            context_pack={"inventory": [{"vin": "5NMJBCDE4TH632221", "price": 24639}]})
    dealer = SimpleNamespace(phone="(347) 658-5466", name="Victory Cars Central")
    extras = first_reply_extras(ctx, state, dealer)
    assert extras["price_line"] == "It's listed at $24,639, not including tax, documentation and DMV fees."
    email = extras["no_phone_email"]
    assert email["subject"] == "2026 Hyundai Tucson Update"
    assert email["body"].startswith("Hello Francisco,\n\nThank you for reaching out to Victory Cars Central regarding "
                                    "the 2026 Tucson. I am excited to assist you with your purchase!")
    assert "What is the best phone number to reach you? We can be reached at (347) 658-5466." in email["body"]
    assert "By the way, what are you driving now?" in email["body"] and "team" not in email["body"].lower()

    intro = "Hi Francisco, this is Nicole, Victory Cars Central's AI Sales Manager."
    draft = {"sms_text": f"{intro} Tell me, what are you driving now?", "email_body": f"{intro}\n\nThank you",
             "email_subject": "Your inquiry"}
    placed = place_touch1_extras(draft, {"intro": intro, **extras})
    assert draft["sms_text"] == (f"{intro} It's listed at $24,639, not including tax, documentation and DMV fees. "
                                 "Tell me, what are you driving now?")
    assert draft["sms_media_vin"] == "5NMJBCDE4TH632221" and draft["sms_vins"] == ["5NMJBCDE4TH632221"]
    assert draft["email_subject"] == "2026 Hyundai Tucson Update" and placed == ["the vehicle's facts and photo",
                                                                                 "no-phone email"]


def test_a_customer_with_a_phone_gets_no_phone_request():
    from types import SimpleNamespace

    from upsell_agent.agent.nodes.decide import first_reply_extras
    ctx = SimpleNamespace(lead={"phone": "+13476585466", "model": "Giulia"}, customer={}, lead_state={})
    extras = first_reply_extras(ctx, SimpleNamespace(customer_name="Artem", context_pack={}),
                                SimpleNamespace(phone=None, name="Victory"))
    assert "no_phone_email" not in extras and "price_line" not in extras


async def test_the_first_photo_is_the_outside_not_the_trunk(monkeypatch):
    from upsell_agent.agent import interior_photo as ip
    views = {"https://x/trunk.jpg": "cargo", "https://x/front.jpg": "front"}

    async def fake_label(url, settings):
        return views[url]

    monkeypatch.setattr(ip, "_label", fake_label)
    assert await ip.photo_showing(list(views), ip.EXTERIOR, None, None) == "https://x/front.jpg"


def test_the_first_reply_answers_mileage_and_history_from_the_record():
    # Client, 12 Oct 2026 (Betsy, Yvette Miller: "Please provide CarFax and mileage of car").
    from types import SimpleNamespace

    from upsell_agent.agent.nodes.decide import first_reply_extras
    lead = {"vin": "YV4L12UK7P2053842", "phone": "+15555550100", "comments": "Please provide CarFax and mileage of car"}
    record = {"vin": "YV4L12UK7P2053842", "miles": 23456, "page_url": "https://dealer.example/vdp/xc40"}
    extras = first_reply_extras(SimpleNamespace(lead=lead, customer={}, lead_state={}),
                                SimpleNamespace(customer_name="Yvette Miller", context_pack={"inventory": [record]}),
                                SimpleNamespace(phone=None, name="Victory"))
    assert extras["lead_answers"].startswith("It has 23,456 miles.")
    assert "https://dealer.example/vdp/xc40" in extras["lead_answers"]


def test_a_dealer_website_form_is_the_customer_reaching_out():
    # Yvette's "Dealer Inspire/Get E-Price" lead opened with "reaching out about" (an outbound line).
    from upsell_agent.compliance.origin import origin_from_records
    assert origin_from_records({"source": "Dealer Inspire/Get E-Price"}, {}, from_campaign=False).origin == "inbound"
    assert origin_from_records({"source": "?", "data": {"created_by": "ai_live_inbound_adf"}}, {},
                               from_campaign=False).origin == "inbound"
