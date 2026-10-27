"""Betsy and Bibi, 27 Oct 2026 meeting (BUILD-PLAN-27-OCT.md): no promise of options nothing will send (item 7), and a
booked customer who isn't sure keeps the appointment, marked tentative (item 6)."""

import pytest

from upsell_agent.agent import appointment
from upsell_agent.agent.nodes.guard import unbacked_options_promise


@pytest.mark.parametrize(("text", "flagged"), [
    ("No pressure - if tomorrow ends up tough, I can line up options that fit.", True),
    ("I'll put together a few options for you.", True),
    ("Let me find you some alternatives.", True),
    ("We have the 2022 Highlander XLE and the 2021 Pilot EX-L in stock. Which one would you like to see?", False),
    ("You're all set for tomorrow at 1 PM.", False),
])
def test_a_promise_of_options_later_is_stopped(text, flagged):
    assert bool(unbacked_options_promise({"action": "acknowledge"}, {"sms_text": text})) is flagged


def test_a_handoff_may_say_a_manager_will_find_options():
    assert not unbacked_options_promise({"action": "handoff"}, {"sms_text": "I can find you some options."})


@pytest.mark.parametrize(("text", "maybe"), [
    ("I can't confirm because I might not make it due to the distance and health conditions but I would like to keep "
     "tomorrow in mind", True),
    ("maybe", True), ("I'll try to make it", True), ("not sure if I can", True),
    ("I need to cancel", False), ("I won't make it", False), ("yes", False), ("can I come at 3 instead?", False),
])
def test_maybe_is_not_no(text, maybe):
    assert appointment.is_maybe(text) is maybe


def test_our_own_question_is_never_the_customers():
    # Richard, 27 Oct 2026: "Am interested"; Extract listed our "Tell me, what are you driving now?" as his question.
    from upsell_agent.agent.nodes.decide import not_our_own_questions
    ours = ["Hi Richard, this is Nicole ... It's listed at $15,609. Tell me, what are you driving now?"]
    asked = [{"text": "What are you driving now?", "label": "answerable"},
             {"text": "Is it still available?", "label": "answerable"}]
    assert not_our_own_questions(asked, "Am interested. Is it still available?", ours) == [asked[1]]
    # The customer asking the same thing back is their question.
    assert not_our_own_questions(asked[:1], "what are you driving now? lol", ours) == asked[:1]


def test_a_form_line_or_none_is_no_question():
    from upsell_agent.agent.nodes.decide import not_our_own_questions
    asked = [{"text": "None"}, {"text": "Purchase Timeframe: unsure"}, {"text": "Do you have other bmw x3's?"}]
    assert not_our_own_questions(asked, "", []) == [asked[2]]


async def test_a_photo_whose_host_says_nothing_goes_through_the_crm():
    # The Tesla Model 3 lead, 27 Oct 2026: imageonthefly.autodatadirect.com answers HEAD with no type and no size.
    from upsell_agent.agent.vehicle_media import ImageCheck, pick_vehicle_photo
    from tests.unit.conftest import make_settings
    photo = "https://imageonthefly.autodatadirect.com/images/?width=1200&height=900&IMG=USD10TSC032B01300.jpg"

    class Hosts:
        async def check(self, url):
            if "autodatadirect" in url:
                return ImageCheck(False, "not an image (no content type)")
            return ImageCheck(True, "image/jpeg, 291 KB", 298109)

    settings = make_settings("test")
    records = [{"vin": "5YJ3E1EA0MF921244", "photo_urls": [photo]}]
    pick = await pick_vehicle_photo("68e6f270ac63d8a8eba32096", "5YJ3E1EA0MF921244", channel="email",
                                    settings=settings, records=records, checker=Hosts())
    assert pick.urls == ["https://www.autopulse.ai/api/media/vehicle/68e6f270ac63d8a8eba32096/5YJ3E1EA0MF921244/0.jpg"]


async def test_a_photo_that_is_really_broken_is_still_not_sent():
    from upsell_agent.agent.vehicle_media import ImageCheck, pick_vehicle_photo
    from tests.unit.conftest import make_settings

    class Broken:
        async def check(self, url):
            return ImageCheck(False, "HEAD answered 404")

    pick = await pick_vehicle_photo("d", "5YJ3E1EA0MF921244", channel="email", settings=make_settings("test"),
                                    records=[{"vin": "5YJ3E1EA0MF921244", "photo_urls": ["https://x.example/a.jpg"]}],
                                    checker=Broken())
    assert pick.urls == []


@pytest.mark.parametrize(("text", "short"), [
    ("Yes, the 2021 Model 3 Standard Range Plus in Red Multi-Coat is here with 69,248 miles. Tell me, what are you "
     "driving now?",
     "Yes, the 2021 Model 3 Standard Range Plus in Red Multi-Coat is here. Tell me, what are you driving now?"),
    ("The 2019 BMW 5 Series 530i you asked about is here in Jet Black with 65,039 miles. It's listed at $15,609.",
     "The 2019 BMW 5 Series 530i you asked about is here in Jet Black. It's listed at $15,609."),
    ("It's here in Solar Silver, with 45,669 miles, and it's listed at $31,000.",
     "It's here in Solar Silver, and it's listed at $31,000."),
    ("The Odyssey is here. It has 45,669 miles. Tell me, what are you driving now?",
     "The Odyssey is here. Tell me, what are you driving now?"),
])
def test_the_first_text_leaves_the_miles_out(text, short):
    # Betsy, 27 Oct 2026 meeting: year, make, model and price, not the miles.
    from upsell_agent.agent.turn import without_mileage
    assert without_mileage(text) == short
