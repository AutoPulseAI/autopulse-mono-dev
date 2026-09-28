"""MASTER_PLAN_3 Phase 2: shopping criteria.

- criteria from this turn's profile (table-driven), and the /api/car query
- the search-or-not rule
- the loosening order and its record, including trim checked on our side
- colour case-correction against the dealer's own stock values
- "something bigger" (the size tiers)
- Search stock uses this turn's validated profile, from the first turn
- the stock/price question split (both `restricted` here; MASTER_PLAN_3 Phase 3
  flips stock questions to `answerable` - see test_stock_answers.py)
"""

import pytest

from tests.unit.test_inventory_tool import (
    DEALER,
    OTHER,
    _new_lead,
    _reply,
    _search,
    _stock,
    _turn_nodes,
    _vehicle,
)
from upsell_agent.agent.context_pack import HELD_FROM_MODELS
from upsell_agent.agent.nodes.search_stock import BIGGER, search_trigger
from upsell_agent.agent.offline_model import _label
from upsell_agent.agent.offline_model import extract as offline_extract
from upsell_agent.agent.question_topics import is_price_question, is_stock_question
from upsell_agent.slots.schema import SCHEMA
from upsell_agent.slots.validators import validate as validate_value
from upsell_agent.tools.inventory_tool import (
    InventoryCriteria,
    StubInventorySource,
    criteria_from_profile,
    search_inventory,
    split_trim,
)
from upsell_agent.tools.stock_search import (
    SIZE_TIERS,
    find_stock,
    match_colour,
    tier_of,
    trim_matches,
)

STUB = StubInventorySource()


def _profile(**values):
    """A profile.to_api()-shaped dict: interest__model="Toyota RAV4" -> a filled interest.model slot."""
    return {"slots": [{"path": p.replace("__", "."), "value": v, "state": "filled"} for p, v in values.items()]}


# --- Criteria from the profile ----------------------------------------------------------------

@pytest.mark.parametrize("values, expected", [
    ({"interest__model": "Toyota RAV4"}, {"make": "Toyota", "model": "RAV4"}),
    ({"interest__model": "2021 Honda CR-V EX"}, {"make": "Honda", "model": "CR-V", "trim": "EX", "year_min": 2021,
                                                  "year_max": 2021}),
    ({"interest__model": "Toyota RAV4 XLE Hybrid"}, {"make": "Toyota", "model": "RAV4", "trim": "XLE Hybrid"}),
    ({"interest__model": "Tesla Model Y Long Range"}, {"make": "Tesla", "model": "Model Y", "trim": "Long Range"}),
    ({"interest__model": "Jeep Grand Cherokee"}, {"make": "Jeep", "model": "Grand Cherokee"}),
    ({"interest__body_type": "suv", "interest__new_or_used": "used"}, {"body_type": "SUV", "condition": "used"}),
    ({"interest__model": "SUV", "interest__body_type": "truck"}, {"body_type": "SUV"}),  # the vehicle wins
    ({"interest__model": "Toyota RAV4", "interest__color": "white"},
     {"make": "Toyota", "model": "RAV4", "exterior_color": "white"}),
    ({"interest__body_type": "suv", "interest__budget": 30000}, {"body_type": "SUV", "price_max": 30000}),
    ({"interest__new_or_used": "either"}, {}),
    ({"interest__budget": 0}, {}),
])
def test_criteria_from_the_profile(values, expected):
    assert criteria_from_profile(_profile(**values)).model_dump(exclude_none=True) == expected


def test_values_still_to_confirm_dont_narrow_the_search():
    profile = {"slots": [{"path": "interest.model", "value": "Toyota RAV4", "state": "filled"},
                         {"path": "interest.color", "value": "white", "state": "needs_confirming"},
                         {"path": "interest.budget", "value": 30000, "state": "needs_confirming"}]}
    assert criteria_from_profile(profile).model_dump(exclude_none=True) == {"make": "Toyota", "model": "RAV4"}


@pytest.mark.parametrize("model, expected", [
    ("RAV4", ("RAV4", None)), ("RAV4 XLE", ("RAV4", "XLE")), ("Model 3", ("Model 3", None)),
    ("CR-V EX-L", ("CR-V", "EX-L")), ("Sport", ("Sport", None)),
])
def test_split_trim(model, expected):
    assert split_trim(model) == expected


def test_new_criteria_in_the_query():
    params = InventoryCriteria(body_types=["Minivan", "Van", "Truck"], exterior_color="Pearl White", price_max=30000,
                               trim="XLE", condition="used").to_params(DEALER)
    assert params == {"dealer_id": DEALER, "car_type": "used", "body_type": "Minivan,Van,Truck",
                      "exterior_color": "Pearl White", "price_range": "0-30000"}
    assert "trim" not in params  # /api/car has no trim parameter


def test_colour_is_sent_literally_without_regex_escaping_or_commas():
    # route.js matches exterior_color literally (not a regex): escaping would break the match.
    assert InventoryCriteria(exterior_color="Silver, Metallic").to_params(DEALER)["exterior_color"] == "Silver Metallic"


# --- The new slots -------------------------------------------------------------------------------

def test_new_slots_are_extractable_but_never_asked_or_required():
    for path in ("interest.body_type", "interest.color"):
        slot = SCHEMA[path]
        assert slot.extractable and slot.priority is None and slot.volunteered


@pytest.mark.parametrize("raw, expected", [("SUV", "suv"), ("crossover", "suv"), ("pickup", "truck"),
                                           ("Sedans", "sedan"), ("minivan", "minivan")])
def test_body_type_synonyms(raw, expected):
    assert validate_value(SCHEMA["interest.body_type"], raw).value == expected


def test_body_type_rejects_anything_else():
    assert not validate_value(SCHEMA["interest.body_type"], "spaceship").ok


def _allowed():
    return [{"path": s.path} for s in SCHEMA.values() if s.extractable]


@pytest.mark.parametrize("text, expected", [
    ("Do you have a white SUV under 30k?", {"interest.body_type": "suv", "interest.color": "white",
                                             "interest.budget": 30000}),
    ("Looking for a grey Toyota RAV4 XLE", {"interest.color": "grey", "interest.model": "Toyota RAV4 XLE"}),
    ("Any used pickup trucks?", {"interest.body_type": "pickup", "interest.new_or_used": "used"}),
])
def test_offline_extract_reads_shopping_criteria(text, expected):
    values = {v["path"]: v["value"] for v in offline_extract({"customer_text": text, "lead_type": "sales",
                                                              "allowed_slots": _allowed()})["values"]}
    for path, value in expected.items():
        assert values[path] == value


def test_a_trade_ins_colour_is_not_what_they_want():
    values = offline_extract({"customer_text": "I'm trading in my white Honda Civic sedan", "lead_type": "sales",
                              "allowed_slots": _allowed()})["values"]
    assert not {v["path"] for v in values} & {"interest.color", "interest.body_type"}


# --- Search or not --------------------------------------------------------------------------------

@pytest.mark.parametrize("criteria, stock_q, bigger, searches", [
    (InventoryCriteria(), False, False, False),
    (InventoryCriteria(), True, False, True),  # "what do you have in stock?"
    (InventoryCriteria(model="RAV4"), False, False, True),
    (InventoryCriteria(make="Toyota"), False, False, True),
    (InventoryCriteria(body_type="SUV"), False, False, False),  # a body type alone isn't enough
    (InventoryCriteria(body_type="SUV", condition="used"), False, False, True),
    (InventoryCriteria(condition="used", exterior_color="white"), False, False, False),
    (InventoryCriteria(body_type="Sedan"), False, True, True),
    (InventoryCriteria(), False, True, False),  # bigger than what?
])
def test_search_or_not(criteria, stock_q, bigger, searches):
    assert (search_trigger(criteria, stock_q, bigger) is not None) is searches


@pytest.mark.parametrize("text", ["Do you have anything bigger?", "something with more room", "a larger one"])
def test_bigger_wording(text):
    assert BIGGER.search(text)


# --- Colour case-correction -------------------------------------------------------------------------

@pytest.mark.parametrize("wanted, stored, expected", [
    ("white", ["Silver", "White"], "White"),
    ("WHITE", ["white"], "white"),  # whatever this dealer stores, never a guessed convention
    ("grey", ["Gray"], "Gray"),
    ("gray", ["GREY"], "GREY"),
    ("white", ["Pearl White"], None),  # only the colour they said
    ("white", [None, ""], None),
])
def test_match_colour(wanted, stored, expected):
    assert match_colour(wanted, stored) == expected


async def test_the_customers_colour_word_alone_would_match_nothing(mongo):
    """Why case-correction exists: the platform's colour match is case-sensitive."""
    await _stock(mongo, _vehicle("VIN00000000000201", make="Toyota", model="RAV4", color="White"))
    as_said = await search_inventory(DEALER, InventoryCriteria(model="RAV4", exterior_color="white"), STUB)
    assert as_said.records == []
    found = await find_stock(DEALER, InventoryCriteria(model="RAV4", exterior_color="white"), STUB)
    assert [r.vin for r in found.records] == ["VIN00000000000201"]
    assert found.params["exterior_color"] == "White" and found.colour == {"asked": "white", "stored": "White"}
    assert found.loosened == []


async def test_colour_uses_this_dealers_own_spelling(mongo):
    await _stock(mongo, _vehicle("VIN00000000000211", make="Toyota", model="RAV4", color="WHITE"),
                 _vehicle("VIN00000000000212", dealer=OTHER, make="Toyota", model="RAV4", color="White"))
    found = await find_stock(DEALER, InventoryCriteria(model="RAV4", exterior_color="white"), STUB)
    assert found.params["exterior_color"] == "WHITE" and [r.vin for r in found.records] == ["VIN00000000000211"]


# --- Loosening --------------------------------------------------------------------------------------

def _rav4(vin, **kw):
    return _vehicle(vin, make="Toyota", model="RAV4", **kw)


async def test_white_rav4_with_only_silver_loosens_colour(mongo):
    await _stock(mongo, _rav4("VIN00000000000301", color="Silver"))
    found = await find_stock(DEALER, InventoryCriteria(make="Toyota", model="RAV4", exterior_color="white"), STUB)
    assert [s["step"] for s in found.loosened] == ["colour"]
    assert [r.vin for r in found.records] == ["VIN00000000000301"] and found.records[0].exterior_color == "Silver"
    assert [a["step"] for a in found.attempts] == ["exact", "colour"]
    assert found.attempts[0]["found"] == 0 and "exterior_color" not in found.attempts[0]["params"]
    assert found.colour == {"asked": "white", "stored": None}
    assert found.query["exterior_color"] == "white" and "exterior_color" not in found.final_query


async def test_trim_is_checked_on_our_side_then_loosened(mongo):
    await _stock(mongo, _rav4("VIN00000000000311", trim="LE"), _rav4("VIN00000000000312", trim="XLE Hybrid"))
    exact = await find_stock(DEALER, InventoryCriteria(model="RAV4", trim="XLE"), STUB)
    assert [r.vin for r in exact.records] == ["VIN00000000000312"] and exact.loosened == []
    assert all("trim" not in a["params"] for a in exact.attempts)

    loosened = await find_stock(DEALER, InventoryCriteria(model="RAV4", trim="Limited"), STUB)
    assert [s["step"] for s in loosened.loosened] == ["trim"]
    assert {r.vin for r in loosened.records} == {"VIN00000000000311", "VIN00000000000312"}


@pytest.mark.parametrize("wanted, trim, ok", [("XLE", "XLE Hybrid", True), ("xle", "XLE", True),
                                               ("LE", "XLE", False), ("XLE", None, False)])
def test_trim_matches(wanted, trim, ok):
    assert trim_matches(wanted, trim) is ok


async def test_year_widens_by_one_either_side(mongo):
    await _stock(mongo, _rav4("VIN00000000000321", year=2022), _rav4("VIN00000000000322", year=2025))
    found = await find_stock(DEALER, InventoryCriteria(model="RAV4", year_min=2021, year_max=2021), STUB)
    assert [s["step"] for s in found.loosened] == ["year"]
    assert found.params["year_range"] == "2020-2022" and [r.vin for r in found.records] == ["VIN00000000000321"]
    assert "year" not in found.params


async def test_same_body_type_from_another_make(mongo):
    await _stock(mongo, _vehicle("VIN00000000000331", make="Mazda", model="CX-5", body="SUV"),
                 _vehicle("VIN00000000000332", make="Toyota", model="Camry", body="Sedan"),
                 _vehicle("VIN00000000000333", dealer=OTHER, make="Honda", model="CR-V", body="SUV", condition="new"))
    # No CR-V at this dealer at all, so its body type can't be learned here: the step is skipped, not guessed.
    none = await find_stock(DEALER, InventoryCriteria(make="Honda", model="CR-V", condition="new"), STUB)
    assert [s["step"] for s in none.loosened] == ["make", "condition"] and "skipped" in none.loosened[0]["detail"]
    assert none.records == []  # no CR-V of either condition here

    # With the body type known (the customer said SUV), another make's SUV; never another dealer's.
    found = await find_stock(DEALER, InventoryCriteria(make="Honda", model="CR-V", body_type="SUV"), STUB)
    assert [s["step"] for s in found.loosened] == ["make"]
    assert [r.vin for r in found.records] == ["VIN00000000000331"]
    assert found.params == {"dealer_id": DEALER, "body_type": "SUV"}


async def test_body_type_is_learned_from_the_dealers_own_stock(mongo):
    # A used CR-V (SUV) is in stock but no new one: "make" keeps SUV, learned from that record.
    await _stock(mongo, _vehicle("VIN00000000000341", make="Honda", model="CR-V", body="SUV", condition="used"),
                 _vehicle("VIN00000000000342", make="Mazda", model="CX-5", body="SUV", condition="new"))
    found = await find_stock(DEALER, InventoryCriteria(make="Honda", model="CR-V", condition="new"), STUB)
    assert [s["step"] for s in found.loosened] == ["make"]
    assert [r.vin for r in found.records] == ["VIN00000000000342"]


async def test_the_whole_order_colour_trim_year_make(mongo):
    await _stock(mongo, _vehicle("VIN00000000000351", make="Mazda", model="CX-5", body="SUV", year=2021))
    criteria = InventoryCriteria(make="Toyota", model="RAV4", trim="XLE", body_type="SUV", exterior_color="white",
                                 year_min=2021, year_max=2021)
    found = await find_stock(DEALER, criteria, STUB)
    assert [s["step"] for s in found.loosened] == ["colour", "trim", "year", "make"]
    assert [a["step"] for a in found.attempts] == ["exact", "colour", "trim", "year", "make"]
    assert [r.vin for r in found.records] == ["VIN00000000000351"]


async def test_nothing_anywhere_records_every_step_and_loads_nothing(mongo):
    found = await find_stock(DEALER, InventoryCriteria(model="RAV4", body_type="SUV", exterior_color="white"), STUB)
    assert found.records == [] and [s["step"] for s in found.loosened] == ["colour", "make"]


async def test_budget_filters_and_is_never_loosened(mongo):
    await _stock(mongo, _rav4("VIN00000000000361", internetreduced=34000))
    found = await find_stock(DEALER, InventoryCriteria(model="RAV4", price_max=30000), STUB)
    assert found.records == [] and found.params["price_range"] == "0-30000"
    assert all(s["step"] != "budget" for s in found.loosened)
    cheaper = await find_stock(DEALER, InventoryCriteria(model="RAV4", price_max=35000), STUB)
    assert [r.vin for r in cheaper.records] == ["VIN00000000000361"]
    assert not {"price", "internetreduced", "msrp"} & set(cheaper.records[0].model_dump())  # never said


async def test_a_repeat_search_comes_from_the_cache(mongo):
    await _stock(mongo, _rav4("VIN00000000000371", color="Silver"))
    criteria = InventoryCriteria(model="RAV4", exterior_color="white")
    assert not (await find_stock(DEALER, criteria, STUB)).cached
    assert (await find_stock(DEALER, criteria, STUB)).cached


# --- "Something bigger" ---------------------------------------------------------------------------------

def test_size_tiers():
    assert [tier_of(b) for b in ("Coupe", "sedan", "SUV", "Truck", "Spaceship", None)] == [0, 1, 2, 3, None, None]
    assert sum(len(t) for t in SIZE_TIERS) == 9  # the 9 body types inventory_tool.BODY_WORDS knows


async def test_bigger_than_a_sedan_is_an_suv(mongo):
    await _stock(mongo, _vehicle("VIN00000000000401", make="Toyota", model="Camry", body="Sedan"),
                 _vehicle("VIN00000000000402", make="Honda", model="CR-V", body="SUV"))
    found = await find_stock(DEALER, InventoryCriteria(make="Toyota", model="Camry"), STUB, bigger=True)
    assert found.loosened[0]["step"] == "size" and "SUV" in found.loosened[0]["detail"]
    assert [r.vin for r in found.records] == ["VIN00000000000402"]


async def test_bigger_moves_up_again_when_a_tier_is_empty(mongo):
    await _stock(mongo, _vehicle("VIN00000000000411", make="Ford", model="F-150", body="Truck"))
    found = await find_stock(DEALER, InventoryCriteria(body_type="Sedan"), STUB, bigger=True)
    assert [s["step"] for s in found.loosened] == ["size", "size"]
    assert found.params["body_type"] == "Minivan,Van,Truck" and [r.vin for r in found.records] == ["VIN00000000000411"]


async def test_nothing_is_bigger_than_the_largest_tier(mongo):
    await _stock(mongo, _vehicle("VIN00000000000421", make="Ford", model="F-150", body="Truck"))
    found = await find_stock(DEALER, InventoryCriteria(body_type="Truck"), STUB, bigger=True)
    assert "largest" in found.loosened[0]["detail"] and [r.vin for r in found.records] == ["VIN00000000000421"]


# --- Through real turns -------------------------------------------------------------------------------

async def test_the_first_turn_searches_from_the_lead_form(mongo):
    await _stock(mongo, _rav4("VIN00000000000501", color="Silver", condition="used"))
    created = await _new_lead("Do you have a used white Toyota RAV4?")
    search = await _search(mongo, created)
    out = search["output"]
    assert out["searched"] and out["trigger"] == "the customer asked about stock"
    assert out["query"] == {"make": "Toyota", "model": "RAV4", "condition": "used", "exterior_color": "white"}
    assert [s["step"] for s in out["loosened"]] == ["colour"] and out["records"][0]["vin"] == "VIN00000000000501"
    assert any(line.startswith("Loosened colour") for line in search["reasoning"])


async def test_search_uses_this_turns_profile_not_the_one_load_context_saw(mongo):
    await _stock(mongo, _vehicle("VIN00000000000511"), _rav4("VIN00000000000512"))
    created = await _new_lead("Looking at a used Honda CR-V")
    assert (await _search(mongo, created))["output"]["query"]["model"] == "CR-V"

    await _reply(created, "Actually make that a Toyota RAV4")
    out = (await _search(mongo, created))["output"]
    assert out["query"]["model"] == "RAV4" and [r["vin"] for r in out["records"]] == ["VIN00000000000512"]


async def test_a_colour_said_in_this_message_counts_this_turn(mongo):
    await _stock(mongo, _rav4("VIN00000000000521", color="Blue"), _rav4("VIN00000000000522", color="Red"))
    created = await _new_lead("Looking at a used Toyota RAV4")
    await _reply(created, "Ideally in red")
    out = (await _search(mongo, created))["output"]
    assert out["colour"] == {"asked": "red", "stored": "Red"}
    assert [r["vin"] for r in out["records"]] == ["VIN00000000000522"]


async def test_budget_never_reaches_the_models(mongo):
    """As of Phase 3, `inventory` itself (with its VIN) reaches Compose, so it
    can answer from real stock (its output names the loaded vehicle); the raw
    budget number and the search criteria that would carry it
    (`inventory_query`) never do - the Debug UI's own "input" trace for
    compose (agent/graph.py `_node_input`) never carries `context` at all, by
    design, so that's not what proves this either way."""
    await _stock(mongo, _rav4("VIN00000000000531"))
    created = await _new_lead("Do you have a Toyota RAV4 under 40k?")
    out = (await _search(mongo, created))["output"]
    assert out["params"]["price_range"] == "0-40000" and out["records"][0]["vin"] == "VIN00000000000531"
    compose = next(n for n in await _turn_nodes(mongo, created) if n["node"] == "compose")
    assert compose["output"]["sms_vins"] == ["VIN00000000000531"]  # the model could answer from real stock
    assert {"inventory_query", "inventory_checked_at"} <= HELD_FROM_MODELS
    assert "inventory" not in HELD_FROM_MODELS


# --- Stock vs price questions (item 6) --------------------------------------------------------------------

@pytest.mark.parametrize("question, stock, price", [
    ("Do you have a white RAV4?", True, False),
    ("Is it still available?", True, False),
    ("What SUVs do you have?", True, False),
    ("How much is it?", False, True),
    ("Can I get financing?", False, True),
    ("What's my trade worth?", False, True),
    ("Do you have any in stock and what's the price?", True, True),
    ("What are your hours?", False, False),
    # Real texting wording (found live, 29 Sept): "u" for "you", and several
    # words between "what" and "do you have".
    ("what RAV4 models do u have in inventory?", True, False),
    ("do u have any Civics?", True, False),
    ("do yall carry Fords?", True, False),
])
def test_stock_and_price_are_separate_rules(question, stock, price):
    assert is_stock_question(question) is stock
    assert is_price_question(question) is price


@pytest.mark.parametrize("question", ["Do you have a white RAV4?", "Is it still available?"])
def test_stock_questions_are_answerable_from_phase_3(question):
    assert _label(question) == "answerable"


def test_price_questions_stay_restricted():
    assert _label("How much is it?") == "restricted"


# --- Regressions from the Debug UI review (28 Sept) --------------------------------------------------------

async def test_bigger_after_a_named_rav4_never_sends_the_rav4(mongo):
    """"Anything bigger?" after "a new RAV4 Adventure": the search sent is the next size up, without the
    make, model, trim or year they named; only new/used carries over."""
    await _stock(mongo, _rav4("VIN00000000000601", body="SUV", condition="new"),
                 _vehicle("VIN00000000000602", make="Honda", model="Odyssey", body="Minivan", condition="new"))
    created = await _new_lead("Hi, I'm interested in a new Toyota RAV4 Adventure.")
    await _reply(created, "Anything bigger?")
    search = await _search(mongo, created)
    out = search["output"]
    assert out["query"]["model"] == "RAV4"  # what the profile said
    assert out["params"] == {"dealer_id": DEALER, "car_type": "new", "body_type": "Minivan,Van,Truck"}
    assert not {"make", "model", "trim"} & set(out["final_query"])
    assert [r["vin"] for r in out["records"]] == ["VIN00000000000602"]
    assert any("swapped for the next size up" in line for line in search["reasoning"])


async def test_more_matches_than_the_per_reply_limit_says_so(mongo):
    await _stock(mongo, *[_rav4(f"VIN0000000000070{i}", added_minutes_ago=i) for i in range(5)])
    created = await _new_lead("Looking at a used Toyota RAV4")
    search = await _search(mongo, created)
    assert search["output"]["matched"] == 5 and len(search["output"]["records"]) == 3
    assert any("(at most 3 per reply)" in line for line in search["reasoning"])


async def test_nothing_new_in_the_bigger_size_offers_a_used_one(mongo):
    """Decided 28 Sept: the last step drops new/used."""
    await _stock(mongo, _vehicle("VIN00000000000801", make="Ford", model="F-150", body="Truck", condition="used"))
    found = await find_stock(DEALER, InventoryCriteria(make="Toyota", model="RAV4", body_type="SUV",
                                                       condition="new"), STUB, bigger=True)
    assert [s["step"] for s in found.loosened] == ["size", "condition"]
    assert [r.vin for r in found.records] == ["VIN00000000000801"] and "car_type" not in found.params


async def test_condition_is_the_very_last_step(mongo):
    await _stock(mongo, _vehicle("VIN00000000000811", make="Mazda", model="CX-5", body="SUV", condition="new"),
                 _rav4("VIN00000000000812", condition="new", color="White"))
    found = await find_stock(DEALER, InventoryCriteria(make="Toyota", model="RAV4", body_type="SUV",
                                                       condition="used", exterior_color="white"), STUB)
    assert [s["step"] for s in found.loosened] == ["colour", "make", "condition"]
    assert {r.vin for r in found.records} == {"VIN00000000000811", "VIN00000000000812"}
