"""conversation_7 (10 Oct 2026): "rdx acura", "do u have sonata in stock?" and "what vehicles do u have" all came
back "we don't have any" from a dealer with both models on the lot. The vehicle the customer means is resolved
against the dealer's own makes and models (tools/vehicle_catalog.py), the search follows what this message asks
(agent/nodes/search_stock.py), and the reply may only say "we don't have X" about what was searched
(guardrails/stock_claims.py)."""

import pytest

from tests.unit.test_inventory_tool import (
    DEALER,
    OTHER,
    _new_lead,
    _reply,
    _search,
    _stock,
    _vehicle,
)
from upsell_agent.agent.nodes.search_stock import turn_criteria
from upsell_agent.agent.state import AgentState
from upsell_agent.guardrails.stock_claims import unsupported_stock_claims
from upsell_agent.tools.vehicle_catalog import Catalog, dealer_catalog, resolve_vehicle

CATALOG = Catalog.from_rows([
    {"make": "Acura", "model": "RDX", "body": "SUV"}, {"make": "Acura", "model": "MDX", "body": "SUV"},
    {"make": "Hyundai", "model": "Sonata", "body": "Sedan"}, {"make": "Toyota", "model": "RAV4"},
    {"make": "Honda", "model": "CR-V"}, {"make": "Jeep", "model": "Grand Cherokee"}])


@pytest.mark.parametrize(("said", "phrase", "make", "model"), [
    ("rdx acura", True, "Acura", "RDX"),                      # word order
    ("I want to buy rdx acura", False, "Acura", "RDX"),       # inside a message
    ("RDX", True, "Acura", "RDX"),                            # the model gives the make
    ("Do u have sonata in stock?", False, "Hyundai", "Sonata"),
    ("any sonatas?", False, "Hyundai", "Sonata"),             # plural
    ("sonta", True, "Hyundai", "Sonata"),                     # misspelling
    ("rav 4", True, "Toyota", "RAV4"),                        # spacing
    ("crv", True, "Honda", "CR-V"),                           # dashes
    ("grand cherokee", True, "Jeep", "Grand Cherokee"),       # two words
])
def test_the_vehicle_is_found_however_its_written(said, phrase, make, model):
    found = resolve_vehicle(said, CATALOG, phrase=phrase)
    assert (found.make, found.model) == (make, model)


def test_a_year_and_trim_come_along():
    found = resolve_vehicle("2023 acura rdx sh-awd", CATALOG)
    assert (found.year, found.make, found.model, found.trim) == (2023, "Acura", "RDX", "Sh-awd")


def test_a_whole_message_never_corrects_an_ordinary_word_into_a_model():
    assert not resolve_vehicle("what vehicles do u have in inventory", CATALOG, phrase=False).found
    assert not resolve_vehicle("Do u have one in inventory?", CATALOG, phrase=False).found


def test_a_vehicle_the_dealer_doesnt_carry_is_searched_as_said():
    found = resolve_vehicle("Corolla", CATALOG)
    assert found.model == "Corolla" and found.make is None and "not in this dealer's stock" in found.how


def test_a_body_type_said_in_place_of_a_model():
    assert resolve_vehicle("do you have any suvs", CATALOG, phrase=False).body_type == "SUV"


async def test_the_catalog_is_the_dealers_own_stock_only(mongo):
    await _stock(mongo, _vehicle("VIN00000000000901", make="Acura", model="RDX"),
                 _vehicle("VIN00000000000902", dealer=OTHER, make="Hyundai", model="Sonata"))
    catalog = await dealer_catalog(DEALER)
    assert "rdx" in catalog.models and "sonata" not in catalog.models


async def test_the_profiles_rdx_acura_is_searched_as_acura_rdx(mongo):
    """The profile saved the customer's words as said ("rdx acura"): searched as make Acura, model RDX."""
    await _stock(mongo, *_dealer_stock())
    state = AgentState(dealer_id=DEALER, customer_id="c", trigger="inbound_message", customer_text="ok",
                       profile={"slots": [{"path": "interest.model", "value": "rdx acura", "state": "filled"},
                                          {"path": "interest.new_or_used", "value": "new", "state": "filled"}]})
    criteria, trigger, notes = await turn_criteria(state, stock_question=False)
    assert (criteria.make, criteria.model, criteria.condition) == ("Acura", "RDX", "new")
    assert trigger is None and "Acura RDX" in notes[0]


# --- The guard: "we don't have X" only about what was searched -----------------------------------------------------

def _claim(text, searched, inventory=()):
    return unsupported_stock_claims({"sms_text": text}, inventory=list(inventory), vehicle_words=set(CATALOG.models),
                                    stock_search={"searched_for": searched} if searched else None)


def test_a_claim_about_a_vehicle_that_wasnt_searched_is_rejected():
    """Live: searched "rdx acura", said "We don't have any Hyundai Sonata listed"."""
    assert _claim("We don't have any Hyundai Sonata listed in our inventory right now.", "Acura RDX")
    assert _claim("We don't have the Sonata in stock right now.", "Hyundai Sonata") == []


def test_no_vehicles_at_all_only_when_the_whole_stock_was_searched():
    assert _claim("We don't have any vehicles listed in our inventory right now.", "Acura RDX")
    assert _claim("We don't have any vehicles listed right now.", "any vehicle") == []


def test_no_search_this_turn_means_no_claim():
    assert _claim("We don't have the RDX in stock right now.", None)


def test_other_i_dont_have_sentences_are_not_stock_claims():
    assert _claim("I don't have an online page for that one handy right now.", None) == []


# --- Through real turns: the conversation from the client's chat ---------------------------------------------------

def _dealer_stock():
    return (_vehicle("VIN00000000000911", make="Acura", model="RDX", year=2023),
            _vehicle("VIN00000000000912", make="Hyundai", model="Sonata", body="Sedan", added_minutes_ago=5),
            _vehicle("VIN00000000000913", make="Honda", model="Civic", body="Sedan", added_minutes_ago=1))


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")
async def test_rdx_acura_is_searched_as_acura_rdx(mongo):
    await _stock(mongo, *_dealer_stock())
    created = await _new_lead("Hi")
    await _reply(created, "Do u have rdx acura in inventory?")
    out = (await _search(mongo, created))["output"]
    assert out["matched"] >= 1 and [r["vin"] for r in out["records"]][:1] == ["VIN00000000000911"]
    assert out["params"]["model"] == "RDX"


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")
async def test_asking_about_a_sonata_searches_the_sonata_not_the_profiles_rdx(mongo):
    await _stock(mongo, *_dealer_stock())
    created = await _new_lead("I want to buy rdx acura")
    await _reply(created, "Do u have sonata in stock?")
    search = await _search(mongo, created)
    assert search["output"]["params"]["model"] == "Sonata"
    assert [r["vin"] for r in search["output"]["records"]] == ["VIN00000000000912"]
    assert any("Sonata" in line for line in search["reasoning"])


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")
async def test_what_vehicles_do_you_have_searches_the_stock_in_general(mongo):
    await _stock(mongo, *_dealer_stock())
    created = await _new_lead("I want to buy rdx acura")
    await _reply(created, "What vechicles do u have in inventory")
    out = (await _search(mongo, created))["output"]
    assert out["trigger"] == "the customer asked what we have"
    assert "model" not in out["params"] and len(out["records"]) == 3
