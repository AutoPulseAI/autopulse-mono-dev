"""The hybrid stock search (tools/stock_match.py) - the user, 26 Oct 2026. Each case is a live one from that day."""

import time

from tests.unit.test_inventory_tool import DEALER, _stock, _vehicle
from tests.unit.test_client_requirements import _new_lead
from upsell_agent.tools import stock_match
from upsell_agent.tools.inventory_tool import InventoryCriteria, InventoryRecord


def _car(vin, year, make, model, trim, price=20000, color="Black"):
    return InventoryRecord(source_id=vin, vin=vin, year=year, make=make, model=model, trim=trim, price=price,
                           exterior_color=color)


STOCK = stock_match.Index.from_records([
    _car("V540", 2023, "BMW", "5 Series", "540i xDrive"),
    _car("V530", 2019, "BMW", "5 Series", "530i"),
    _car("V228", 2023, "BMW", "2 Series", "228i"),
    _car("VSON", 2025, "Hyundai", "Sonata Hybrid", "SEL"),
    _car("VTUC", 2024, "Hyundai", "Tucson", "SEL"),
])


def _best(**criteria):
    return [(round(p, 1), r.vin) for p, r in stock_match.best(STOCK, InventoryCriteria(**criteria), None, k=3)]


def test_a_car_named_differently_from_the_feed_is_found_as_the_car():
    top = _best(make="BMW", model="540", trim="xDrive")  # Joe Dalton / Ehsanul: "540 xDrive"
    assert top[0][1] == "V540" and top[0][0] >= stock_match.STRONG
    assert _best(make="Hyundai", model="Sonata")[0][1] == "VSON"  # "Sonata" = "Sonata Hybrid"


def test_another_number_is_never_the_car():
    assert all(vin != "V228" or p < stock_match.STRONG for p, vin in _best(make="BMW", model="M240"))  # Muhamad
    assert all(vin != "V530" or p < stock_match.STRONG for p, vin in _best(make="BMW", model="540"))


def test_a_misspelling_and_another_model():
    assert _best(make="Hyundai", model="Sonta")[0][1] == "VSON"
    assert "VTUC" not in [v for _, v in _best(make="Hyundai", model="Sonata")]


def test_thousands_of_cars_score_in_milliseconds():
    big = stock_match.Index.from_records([_car(f"V{i}", 2015 + i % 10, ["BMW", "Toyota", "Honda", "Ford"][i % 4],
                                               ["3 Series", "RAV4", "CR-V", "F-150"][i % 4], "Base") for i in range(5000)])
    start = time.perf_counter()
    stock_match.best(big, InventoryCriteria(make="Toyota", model="RAV4", year_min=2020, year_max=2022), "rav4", k=2)
    assert time.perf_counter() - start < 0.5


async def test_the_hybrid_adds_the_car_named_differently_when_on(mongo, monkeypatch):
    # Off (the default) is every other test in this suite: the search's cars only, unchanged.
    await _stock(mongo, _vehicle("VIN0000000005S540", year=2023, make="BMW", model="5 Series", trim="540i xDrive"),
                 _vehicle("VIN0000000000X301", year=2020, make="BMW", model="X3", trim="xDrive30i"))
    stock_match.clear_cache()
    monkeypatch.setattr(stock_match, "ENABLED", True)  # on by default since 27 Oct 2026
    created = await _new_lead(mongo, vehicle={"year": 2023, "make": "BMW", "model": "540"})
    turn = await mongo["ai_turn_log"].find_one({"lead_id": created["lead_id"]})
    search = next(n["output"] for n in turn["nodes"] if n["node"] == "search_stock")
    by_vin = {r["vin"]: r for r in search["records"]}
    assert by_vin["VIN0000000005S540"].get("match") == "exact" or by_vin["VIN0000000005S540"].get("found_by") == "search"


def test_another_year_or_trim_is_never_called_their_car():
    # Real-lead check, 27 Oct 2026: a gone 2020 540i was called "theirs" for the 2023 540i (57 such cases).
    top = stock_match.best(STOCK, InventoryCriteria(make="BMW", model="5 Series", trim="540i xDrive",
                                                    year_min=2020, year_max=2020), None, k=1)
    assert top[0][1].vin == "V540" and stock_match.label(top[0][0]) == "close"
    exact = stock_match.best(STOCK, InventoryCriteria(make="BMW", model="5 Series", trim="540i xDrive",
                                                      year_min=2023, year_max=2023), None, k=1)
    assert stock_match.label(exact[0][0]) == "exact"


def test_joined_names_and_trim_letters():
    idx = stock_match.Index.from_records([_car("VM3", 2024, "Mazda", "Mazda3", "2.5 S Select Sport"),
                                          _car("VCX", 2024, "Mazda", "CX-90", "3.3 Turbo"),
                                          _car("VSS", 2023, "Chevrolet", "Camaro", "SS"),
                                          _car("VLT", 2023, "Chevrolet", "Camaro", "1LT")])
    assert stock_match.best(idx, InventoryCriteria(make="Mazda", model="3"), None, k=1)[0][1].vin == "VM3"
    assert stock_match.best(idx, InventoryCriteria(make="Chevrolet", model="Camaro", trim="2SS"), None, k=1)[0][1].vin == "VSS"
