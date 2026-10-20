"""Client, 20 Oct 2026 (Joel Clymer): Betsy's AI Studio answer "Here is a link to the vehicle where you can locate the
vehicle history report ... {vehicle_link}" went out with no link."""

from upsell_agent import ai_studio
from upsell_agent.agent import cannot_supply as cs
from upsell_agent.agent.vehicle_media import vehicle_page_url

BETSY = ("Here is a link to the vehicle where you can locate the vehicle history report. If everything is to your "
         "liking, what day works best for you to meet with us at the dealership? {vehicle_link}")
MAZDA = {"vin": "3MZBPAAM0RM123456", "year": 2024, "make": "Mazda", "model": "Mazda3", "miles": 18250,
         "page_url": "https://dealer.example/vdp/mazda3"}


def _with(topic, text, monkeypatch):
    monkeypatch.setitem(cs._REPLIES, topic, ai_studio._studio_to_script(text, topic))


def test_her_vehicle_link_is_the_vehicle_page_not_the_calculator(monkeypatch):
    _with("studio_carfax", BETSY, monkeypatch)
    out = cs.reply("studio_carfax", vehicle_url=MAZDA["page_url"]).text
    assert out.endswith("https://dealer.example/vdp/mazda3") and "calculator" not in out


def test_no_page_never_says_here_is_a_link(monkeypatch):
    _with("studio_carfax", BETSY, monkeypatch)
    out = cs.reply("studio_carfax", vehicle_url=None).text
    assert "link" not in out.lower() and out.startswith("If everything is to your liking")


def test_the_payment_answer_keeps_the_calculator():
    assert "{calculator}" in ai_studio._studio_to_script("We'd love to help.{vehicle_link} Our manager...", "payment")


def test_the_page_is_found_from_the_lead_or_the_vehicle_it_names():
    lead = {"data": {"vehicle": {"year": "2024", "make": "Mazda", "model": "Mazda3"}}}
    assert vehicle_page_url(lead, {}, [MAZDA]) == MAZDA["page_url"]
    assert vehicle_page_url({}, {}, [MAZDA], "carfax for 3MZBPAAM0RM123456 please") == MAZDA["page_url"]
    assert vehicle_page_url({}, {}, [MAZDA]) is None


def test_her_answers_can_use_the_cars_data(monkeypatch):
    _with("studio_miles", "It has {mileage} on it. Would you like to see it?", monkeypatch)
    assert cs.reply("studio_miles", vehicle=MAZDA).text == "It has 18,250 miles on it. Would you like to see it?"
    assert cs.reply("studio_miles", vehicle={}).text == "Would you like to see it?"
