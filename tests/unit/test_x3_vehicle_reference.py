"""PLAN_4 stream X3 (added item): the customer refers back to a vehicle already shown - "the silver one", "the
second one you sent", "the Tacoma", "that one", "the 2022" - resolved in code against the shown vehicles, re-read
from stock, and given to Compose as the vehicle the customer means. Ambiguous: ask which."""

import pytest

from tests.unit.test_inventory_tool import DEALER, _stock, _vehicle
from tests.unit.test_vehicle_media import _deps, _last_sms, _lead, _say
from upsell_agent.agent.vehicle_reference import resolve
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_VEHICLES_COLLECTION,
)

pytestmark = pytest.mark.usefixtures("during_opening_hours")

BLUE = {"vin": "V1", "turn": 3, "year": 2022, "make": "Toyota", "model": "RAV4", "trim": "XLE",
        "exterior_color": "Blue", "miles": 31200}
SILVER = {"vin": "V2", "turn": 3, "year": 2021, "make": "Toyota", "model": "RAV4", "trim": "LE",
          "exterior_color": "Silver", "miles": 44800}
TACOMA = {"vin": "V3", "turn": 5, "year": 2020, "make": "Toyota", "model": "Tacoma", "trim": "SR5",
          "exterior_color": "Silver", "miles": 52000}
SHOWN = [BLUE, SILVER]


@pytest.mark.parametrize(("text", "shown", "vin", "ambiguous"), [
    ("the silver one", SHOWN, "V2", []),
    ("what's the mileage on the blue one?", SHOWN, "V1", []),
    ("the second one you sent", SHOWN, "V2", []),
    ("the first one", SHOWN, "V1", []),
    ("I like the 2022", SHOWN, "V1", []),
    ("tell me about the XLE", SHOWN, "V1", []),
    ("the Tacoma", [*SHOWN, TACOMA], "V3", []),
    ("is that one still there?", [*SHOWN, TACOMA], "V3", []),        # the last reply named one vehicle
    ("is that one still there?", SHOWN, None, ["V1", "V2"]),          # it named two: which?
    ("the silver one", [*SHOWN, TACOMA], None, ["V2", "V3"]),         # two silver ones
    ("the silver RAV4", [*SHOWN, TACOMA], "V2", []),                  # colour + model settles it
    ("the one with fewer miles", SHOWN, "V1", []),
    ("the newer one", SHOWN, "V1", []),
    ("the silver one with lower mileage", [*SHOWN, TACOMA], "V2", []),
])
def test_references_resolve(text, shown, vin, ambiguous):
    ref = resolve(text, shown)
    assert ref is not None, text
    assert ref.vin == vin and ref.ambiguous == ambiguous, (text, ref)


@pytest.mark.parametrize("text", [
    "the cheaper one",             # no price in the data: never guessed
    "the red one",                 # nothing shown is red
    "do you have anything in blue?",   # describing what they want, not pointing at one
    "ok thanks",
    "the third one",               # only two were shown
])
def test_no_reference(text):
    assert resolve(text, SHOWN) is None, text


def test_an_ordinal_is_a_visit_time_while_times_are_on_the_table():
    assert resolve("the second one", SHOWN, awaiting_visit_pick=True) is None
    assert resolve("the newer one", [BLUE, {**SILVER, "year": 2022}]).ambiguous == ["V1", "V2"]  # a tie


async def _turn(mongo, created):
    return (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]


async def test_the_silver_one_in_a_conversation(mongo):
    blue, silver = "VIN00000000000911", "VIN00000000000912"
    await _stock(mongo, _vehicle(blue, make="Toyota", model="RAV4", trim="XLE", color="Blue", miles=31200),
                 _vehicle(silver, make="Toyota", model="RAV4", trim="LE", color="Silver", miles=44800, year=2021))
    deps = _deps()
    created = await _lead(deps)
    await _say(created, "Do you have a Toyota RAV4?", deps)
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    shown = state["conversation"]["shown_vehicles"]
    assert {v["vin"] for v in shown} == {blue, silver} and all(v["exterior_color"] for v in shown)

    await _say(created, "I like the silver one", deps)
    stock = next(n for n in (await _turn(mongo, created))["nodes"] if n["node"] == "search_stock")
    assert stock["output"]["referred_vehicle"]["vin"] == silver
    assert stock["output"]["referred_vehicle"]["in_stock"] is True
    sms = await _last_sms(mongo, created)
    assert "Silver" in sms["text"] and sms["media_urls"] == [f"https://img.example/{silver}.jpg"]
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["conversation"]["focus_vin"] == silver

    # "that one" after two were shown in one reply: asks which, naming both.
    await _say(created, "actually is that one still there?", deps)
    sms = await _last_sms(mongo, created)
    assert sms["text"].startswith("Which one did you mean") and "Blue" in sms["text"] and "Silver" in sms["text"]

    # Sold since: said to be gone, never described as available.
    await mongo[PLATFORM_VEHICLES_COLLECTION].delete_one({"vin": silver, "dealerId": DEALER})
    from upsell_agent.tools import inventory_tool
    inventory_tool.clear_cache()
    await _say(created, "ok the silver one then", deps)
    stock = next(n for n in (await _turn(mongo, created))["nodes"] if n["node"] == "search_stock")
    assert stock["output"]["referred_vehicle"] == {**stock["output"]["referred_vehicle"], "vin": silver,
                                                   "in_stock": False}
    assert "sold" in (await _last_sms(mongo, created))["text"]
