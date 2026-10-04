"""MASTER_PLAN_3 Phase 1: the inventory read layer (tools/inventory_tool.py)
- the query sent to /api/car, the typed view, dealer scoping and the cache -
then wired through real turns into the context pack."""

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from upsell_agent import clock
from upsell_agent.agent.context_pack import HELD_FROM_MODELS
from upsell_agent.agent.nodes.compose import compose_payload
from upsell_agent.agent.nodes.extract import extract_payload
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import AI_TURN_LOG_COLLECTION, PLATFORM_VEHICLES_COLLECTION
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.tools import inventory_tool
from upsell_agent.tools.inventory_tool import (
    MAX_LOADED,
    InventoryCriteria,
    InventoryRecord,
    LiveInventorySource,
    StubInventorySource,
    criteria_from_profile,
    get_inventory_source,
    get_vehicle,
    safe_param,
    search_inventory,
    to_listing,
    to_record,
)

DEALER = simulate.DEV_DEALERS[0]["_id"]
OTHER = simulate.DEV_DEALERS[1]["_id"]


def _vehicle(vin, *, dealer=DEALER, year=2022, make="Honda", model="CR-V", trim="EX", body="SUV",
             condition="used", color="Silver", miles=24000, added_minutes_ago=10, **extra):
    """A `vehicles` row shaped like the vAuto import; `added_minutes_ago` sets
    `createdAt`, which /api/car sorts by (newest first)."""
    return {"dealerId": dealer, "vin": vin, "stocknumber": f"S{vin[-4:]}", "year": year, "make": make,
            "model": model, "trim": trim, "body": body, "condition": condition, "exteriorcolor": color,
            "mileage": miles, "internetreduced": 27995, "instoreprice": 29995,
            "inventoryUrl": f"https://dealer.example/v/{vin}", "imagesSecure": [f"https://img.example/{vin}.jpg"],
            "createdAt": clock.now() - timedelta(minutes=added_minutes_ago), **extra}


async def _stock(mongo, *docs):
    await mongo[PLATFORM_VEHICLES_COLLECTION].insert_many([dict(d) for d in docs])


STUB = StubInventorySource()


# --- The query sent to /api/car ---------------------------------------------------

def test_params_are_always_dealer_scoped():
    assert InventoryCriteria(model="RAV4").to_params(DEALER) == {"dealer_id": DEALER, "model": "RAV4"}


def test_exact_year_goes_as_a_year_range_never_year():
    params = InventoryCriteria(model="RAV4", year_min=2021, year_max=2021).to_params(DEALER)
    assert params["year_range"] == "2021-2021"
    assert "year" not in params


@pytest.mark.parametrize("year_min, year_max, expected", [
    (2020, 2022, "2020-2022"),  # Phase 2's "year ±1" loosening
    (2021, None, "2021-2021"),
    (None, 2021, "2021-2021"),
])
def test_year_range_forms(year_min, year_max, expected):
    params = InventoryCriteria(model="RAV4", year_min=year_min, year_max=year_max).to_params(DEALER)
    assert params["year_range"] == expected and "year" not in params


def test_all_fields_map_to_the_routes_parameter_names():
    params = InventoryCriteria(make="Toyota", model="RAV4", condition="used", body_type="SUV").to_params(DEALER)
    assert params == {"dealer_id": DEALER, "make": "Toyota", "model": "RAV4", "car_type": "used",
                      "body_type": "SUV"}


@pytest.mark.parametrize("raw, sent", [
    ("CR-V", "CR-V"),
    ("Model 3", "Model 3"),
    ("C+R", "C\\+R"),
    (".*", "\\.\\*"),
    ("RAV4, Camry", "RAV4 Camry"),  # a comma would widen the search to two models
    ("(x)|[y]", "\\(x\\)\\|\\[y\\]"),
    ("  RAV4  ", "RAV4"),
])
def test_customer_wording_cannot_become_a_regex(raw, sent):
    assert safe_param(raw) == sent


# --- Criteria from the profile ----------------------------------------------------

def _profile(**values):
    return {"slots": [{"path": p, "value": v, "state": "filled"} for p, v in values.items()]}


@pytest.mark.parametrize("wanted, condition, expected", [
    ("Honda CR-V", "used", {"make": "Honda", "model": "CR-V", "condition": "used"}),
    ("2021 Toyota RAV4", None, {"make": "Toyota", "model": "RAV4", "year_min": 2021, "year_max": 2021}),
    ("RAV4", "new", {"model": "RAV4", "condition": "new"}),
    ("Jeep Grand Cherokee", "either", {"make": "Jeep", "model": "Grand Cherokee"}),
    ("chevy Silverado", None, {"make": "Chevrolet", "model": "Silverado"}),
    ("SUV", "used", {"body_type": "SUV", "condition": "used"}),
    ("Toyota", None, {"make": "Toyota"}),
])
def test_criteria_from_the_profile(wanted, condition, expected):
    values = {"interest.model": wanted}
    if condition:
        values["interest.new_or_used"] = condition
    assert criteria_from_profile(_profile(**values)).model_dump(exclude_none=True) == expected


def test_no_vehicle_in_the_profile_means_nothing_to_search():
    assert criteria_from_profile(_profile(**{"interest.new_or_used": "used"})).is_empty()
    assert criteria_from_profile({"slots": []}).is_empty()


def test_values_still_to_confirm_are_not_searched():
    profile = {"slots": [{"path": "interest.model", "value": "RAV4", "state": "needs_confirming"}]}
    assert criteria_from_profile(profile).is_empty()


# --- The typed view -----------------------------------------------------------------

def test_typed_view_has_every_field_and_no_price():
    record = to_record(to_listing(_vehicle("VIN00000000000001")))
    assert record.model_dump() == {
        "source_id": "VIN00000000000001", "vin": "VIN00000000000001", "year": 2022, "make": "Honda",
        "model": "CR-V", "trim": "EX", "body_type": "SUV", "condition": "used", "exterior_color": "Silver",
        "miles": 24000, "page_url": "https://dealer.example/v/VIN00000000000001"}
    assert not any("price" in k or "msrp" in k for k in InventoryRecord.model_fields)
    assert "stock_number" not in InventoryRecord.model_fields


def test_typed_view_blanks_are_none():
    doc = {"vin": "VIN00000000000002", "year": 2024, "make": "Kia", "model": "Soul", "dealerId": DEALER}
    record = to_record(to_listing(doc))
    assert (record.trim, record.exterior_color, record.miles, record.page_url) == (None, None, None, None)
    assert record.condition == "used"  # the route's own default


# --- The stub source: a port of route.js ------------------------------------------

async def test_stub_filters_like_the_route(mongo):
    await _stock(mongo,
                 _vehicle("VIN00000000000011", model="CR-V"),
                 _vehicle("VIN00000000000012", model="cr-v", condition="new"),
                 _vehicle("VIN00000000000013", make="Toyota", model="RAV4"),
                 _vehicle("VIN00000000000014", model="CR-V", year=2019))
    body = await STUB.search(InventoryCriteria(make="honda", model="CR-V").to_params(DEALER), 20)
    assert body["num_found"] == 3
    body = await STUB.search(InventoryCriteria(model="CR-V", condition="used").to_params(DEALER), 20)
    assert {x["vin"] for x in body["listings"]} == {"VIN00000000000011", "VIN00000000000014"}
    body = await STUB.search(InventoryCriteria(model="CR-V", year_min=2022).to_params(DEALER), 20)
    assert {x["vin"] for x in body["listings"]} == {"VIN00000000000011", "VIN00000000000012"}


async def test_stub_regex_input_is_matched_literally(mongo):
    await _stock(mongo, _vehicle("VIN00000000000021", model="CR-V"))
    body = await STUB.search(InventoryCriteria(model=".*").to_params(DEALER), 20)
    assert body["num_found"] == 0


# --- Searching ------------------------------------------------------------------------

async def test_search_returns_records_newest_first(mongo):
    await _stock(mongo,
                 _vehicle("VIN00000000000031", added_minutes_ago=60),
                 _vehicle("VIN00000000000032", added_minutes_ago=5))
    result = await search_inventory(DEALER, InventoryCriteria(model="CR-V"), STUB)
    assert [r.vin for r in result.records] == ["VIN00000000000032", "VIN00000000000031"]
    assert result.matched == 2 and result.fetched == 2 and result.excluded == []
    assert result.params == {"dealer_id": DEALER, "model": "CR-V"}
    assert result.query == {"model": "CR-V"}
    assert datetime.fromisoformat(result.checked_at) <= clock.now()


async def test_old_records_are_still_loaded(mongo):
    # No age limit (Phase 0 item 6 removed): a record added months ago is still stock.
    await _stock(mongo, _vehicle("VIN00000000000041", added_minutes_ago=60 * 24 * 120))
    result = await search_inventory(DEALER, InventoryCriteria(model="CR-V"), STUB)
    assert [r.vin for r in result.records] == ["VIN00000000000041"]
    assert result.excluded == []


async def test_only_max_loaded_records_are_given_to_the_ai(mongo):
    await _stock(mongo, *[_vehicle(f"VIN0000000000007{i}", added_minutes_ago=i + 1) for i in range(6)])
    result = await search_inventory(DEALER, InventoryCriteria(model="CR-V"), STUB)
    assert len(result.records) == 6
    assert [r.vin for r in result.loaded()] == [f"VIN0000000000007{i}" for i in range(MAX_LOADED)]


async def test_every_record_carries_its_vin_as_source_id(mongo):
    await _stock(mongo, _vehicle("VIN00000000000081"), _vehicle("VIN00000000000082"))
    result = await search_inventory(DEALER, InventoryCriteria(model="CR-V"), STUB)
    assert all(r.source_id == r.vin for r in result.records)


# --- Dealer scoping ---------------------------------------------------------------------

async def test_no_cross_dealer_read(mongo):
    await _stock(mongo, _vehicle("VIN00000000000091", dealer=DEALER),
                 _vehicle("VIN00000000000092", dealer=OTHER))
    mine = await search_inventory(DEALER, InventoryCriteria(model="CR-V"), STUB)
    theirs = await search_inventory(OTHER, InventoryCriteria(model="CR-V"), STUB)
    assert [r.vin for r in mine.records] == ["VIN00000000000091"]
    assert [r.vin for r in theirs.records] == ["VIN00000000000092"]


async def test_same_vin_at_two_dealers_uses_each_dealers_own_record(mongo):
    await _stock(mongo, _vehicle("VIN00000000000093", dealer=DEALER, color="White"),
                 _vehicle("VIN00000000000093", dealer=OTHER, color="Black"))
    mine = await search_inventory(DEALER, InventoryCriteria(model="CR-V"), STUB)
    theirs = await search_inventory(OTHER, InventoryCriteria(model="CR-V"), STUB)
    assert [r.exterior_color for r in mine.records] == ["White"]
    assert [r.exterior_color for r in theirs.records] == ["Black"]


class FakeRoute:
    """The live /api/car, answering from a list of listings."""

    def __init__(self, listings, num_found=None):
        self.listings = listings
        self.num_found = len(listings) if num_found is None else num_found
        self.requests: list[httpx.Request] = []

    def source(self) -> LiveInventorySource:
        def handle(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return httpx.Response(200, json={"num_found": self.num_found, "listings": self.listings,
                                             "pagination": {}})
        settings = make_settings("DEV").model_copy(update={"autopulse_api_base_url": "http://platform.test/"})
        return LiveInventorySource(settings, transport=httpx.MockTransport(handle))

    def params(self, index=-1) -> dict[str, list[str]]:
        return parse_qs(urlparse(str(self.requests[index].url)).query)


async def test_live_source_calls_api_car_with_dealer_and_year_range():
    route = FakeRoute([])
    await search_inventory(DEALER, InventoryCriteria(make="Toyota", model="RAV4", year_min=2021, year_max=2021),
                           route.source())
    request = route.requests[0]
    assert request.url.path == "/api/car"
    params = route.params()
    assert params["dealer_id"] == [DEALER]
    assert params["year_range"] == ["2021-2021"]
    assert "year" not in params and "facets" not in params
    assert params["limit"] == ["20"] and params["page"] == ["1"]


async def test_live_rows_from_another_dealer_are_dropped():
    # /api/car doesn't enforce the dealer; a row for someone else never gets through.
    listings = [to_listing(_vehicle("VIN00000000000101")), to_listing(_vehicle("VIN00000000000102", dealer=OTHER))]
    result = await search_inventory(DEALER, InventoryCriteria(model="CR-V"), FakeRoute(listings).source())
    assert [r.vin for r in result.records] == ["VIN00000000000101"]
    assert result.excluded == [{"vin": "VIN00000000000102", "reason": "another dealer's vehicle"}]


async def test_live_rows_without_a_vin_are_dropped():
    listings = [{**to_listing(_vehicle("VIN00000000000111")), "vin": ""}]
    result = await search_inventory(DEALER, InventoryCriteria(model="CR-V"), FakeRoute(listings).source())
    assert result.records == [] and result.excluded == [{"vin": "", "reason": "no VIN"}]


async def test_live_platform_error_raises():
    def handle(request):
        return httpx.Response(500, json={"error": "boom", "listings": []})
    source = LiveInventorySource(make_settings("DEV"), transport=httpx.MockTransport(handle))
    with pytest.raises(httpx.HTTPStatusError):
        await search_inventory(DEALER, InventoryCriteria(model="CR-V"), source)


async def test_a_dealer_is_required():
    with pytest.raises(ValueError):
        await search_inventory("", InventoryCriteria(model="CR-V"), STUB)
    with pytest.raises(ValueError):
        await get_vehicle("", "VIN1", STUB)


def test_platform_client_setting_picks_the_source():
    assert isinstance(get_inventory_source(make_settings("DEV")), StubInventorySource)
    live = make_settings("DEV").model_copy(update={"platform_client": "live"})
    assert isinstance(get_inventory_source(live), LiveInventorySource)


# --- The cache ------------------------------------------------------------------------

async def test_same_search_within_a_minute_is_served_from_the_cache():
    route = FakeRoute([to_listing(_vehicle("VIN00000000000121"))])
    source = route.source()
    first = await search_inventory(DEALER, InventoryCriteria(model="CR-V"), source)
    results = [await search_inventory(DEALER, InventoryCriteria(model="CR-V"), source) for _ in range(50)]
    assert len(route.requests) == 1
    assert not first.cached and all(r.cached for r in results)
    assert all([x.vin for x in r.records] == ["VIN00000000000121"] for r in results)


async def test_cache_is_per_dealer_and_per_query():
    route = FakeRoute([])
    source = route.source()
    await search_inventory(DEALER, InventoryCriteria(model="CR-V"), source)
    await search_inventory(DEALER, InventoryCriteria(model="RAV4"), source)
    await search_inventory(OTHER, InventoryCriteria(model="CR-V"), source)
    await search_inventory(DEALER, InventoryCriteria(model="CR-V", condition="used"), source)
    assert len(route.requests) == 4


async def test_cache_expires(monkeypatch):
    route = FakeRoute([])
    source = route.source()
    now = [1000.0]
    monkeypatch.setattr(inventory_tool.monotonic_time, "monotonic", lambda: now[0])
    await search_inventory(DEALER, InventoryCriteria(model="CR-V"), source)
    now[0] += inventory_tool.CACHE_TTL_S - 1
    await search_inventory(DEALER, InventoryCriteria(model="CR-V"), source)
    assert len(route.requests) == 1
    now[0] += 2
    await search_inventory(DEALER, InventoryCriteria(model="CR-V"), source)
    assert len(route.requests) == 2


async def test_a_failed_search_is_not_cached():
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(500) if len(calls) == 1 else httpx.Response(200, json={"num_found": 0, "listings": []})
    source = LiveInventorySource(make_settings("DEV"), transport=httpx.MockTransport(handle))
    with pytest.raises(httpx.HTTPStatusError):
        await search_inventory(DEALER, InventoryCriteria(model="CR-V"), source)
    await search_inventory(DEALER, InventoryCriteria(model="CR-V"), source)
    assert len(calls) == 2


# --- get_vehicle (re-checks) -----------------------------------------------------------

async def test_get_vehicle(mongo):
    await _stock(mongo, _vehicle("VIN00000000000131"), _vehicle("VIN00000000000132", dealer=OTHER))
    found = await get_vehicle(DEALER, "VIN00000000000131", STUB)
    assert found and found.vin == "VIN00000000000131"
    assert await get_vehicle(DEALER, "VIN00000000000132", STUB) is None  # another dealer's
    assert await get_vehicle(DEALER, "NOSUCHVIN", STUB) is None


async def test_get_vehicle_is_never_cached():
    route = FakeRoute([to_listing(_vehicle("VIN00000000000141"))])
    source = route.source()
    await get_vehicle(DEALER, "VIN00000000000141", source)
    await get_vehicle(DEALER, "VIN00000000000141", source)
    assert len(route.requests) == 2
    assert route.params()["vin"] == ["VIN00000000000141"] and route.params()["dealer_id"] == [DEALER]


# --- Wired through real turns -------------------------------------------------------------

def _deps(**settings) -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV").model_copy(update=settings), sink=MemoryTraceSink(),
                    store_prompts=True, sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _new_lead(comments):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Ivy Inventory",
                                         comments=comments)
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _reply(created, text):
    event_id = str(ObjectId())
    await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=event_id, dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id=event_id, text=text, received_at=datetime.now(UTC)), _deps())


async def _turn_nodes(mongo, created, index=-1):
    turns = await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]}).sort("created_at", 1).to_list(None)
    return turns[index]["nodes"]


async def _load(mongo, created, index=-1):
    return next(n for n in await _turn_nodes(mongo, created, index)
                if n["node"] == "load_context" and n.get("status") == "done")


async def _search(mongo, created, index=-1):
    """The Search stock step (Phase 2 moved the search out of Load context)."""
    return next(n for n in await _turn_nodes(mongo, created, index)
                if n["node"] == "search_stock" and n.get("status") == "done")


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")  # PLAN_4 stream X1: a first reply waits for the customer's window
async def test_turn_loads_matching_stock_into_the_pack(mongo):
    await _stock(mongo,
                 _vehicle("VIN00000000000151", added_minutes_ago=20),
                 _vehicle("VIN00000000000152", added_minutes_ago=10),
                 _vehicle("VIN00000000000153", condition="new"),
                 _vehicle("VIN00000000000155", make="Toyota", model="RAV4"))
    created = await _new_lead("Looking at a used Honda CR-V")

    # Phase 2: the first turn already searches (Search stock runs after Extract).
    search = await _search(mongo, created)
    inventory = search["output"]
    assert inventory["searched"] and inventory["query"] == {"make": "Honda", "model": "CR-V", "condition": "used"}
    assert inventory["params"]["dealer_id"] == DEALER and "year" not in inventory["params"]
    assert [r["vin"] for r in inventory["records"]] == ["VIN00000000000152", "VIN00000000000151"]
    assert inventory["matched"] == 2 and inventory["excluded"] == [] and inventory["loosened"] == []
    assert any(line.startswith("Actually searched: ") and "VIN00000000000152" in line for line in search["reasoning"])
    assert "inventory" not in (await _load(mongo, created))["output"]  # one search per turn, not two


async def test_stock_is_in_the_pack_but_held_back_from_the_models(mongo):
    await _stock(mongo, _vehicle("VIN00000000000161"))
    created = await _new_lead("Looking at a used Honda CR-V")
    await _reply(created, "Next month probably")
    load = await _load(mongo, created)
    shown = load["output"]["prompt"]["context_pack"]  # what the models are shown
    assert not set(shown) & HELD_FROM_MODELS

    full_pack = {**shown, "inventory": [{"vin": "VIN00000000000161"}], "inventory_query": {"model": "CR-V"},
                 "inventory_checked_at": "now", "budget": {}}
    state = AgentState(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                       trigger="inbound_message", channel="sms", context_pack=full_pack,
                       customer_text="Next month probably", decision={"action": "ask"})
    for context in (extract_payload(state)["context"], compose_payload(state)["context"]):
        assert not set(context) & HELD_FROM_MODELS


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")  # PLAN_4 stream X1: a first reply waits for the customer's window
async def test_platform_down_means_a_reply_without_stock(mongo, monkeypatch):
    async def down(self, params, limit):
        raise httpx.ConnectError("platform unreachable")
    monkeypatch.setattr(StubInventorySource, "search", down)
    created = await _new_lead("Looking at a used Honda CR-V")
    await _reply(created, "Next month probably")
    search = await _search(mongo, created)
    assert search["output"]["error"] and search["output"]["records"] == []
    assert any("search failed" in line.lower() for line in search["reasoning"])
    assert any(n["node"] == "send" and n.get("status") == "done" for n in await _turn_nodes(mongo, created))


async def test_no_vehicle_named_means_no_search(mongo, monkeypatch):
    calls = []

    async def spy(self, params, limit):
        calls.append(params)
        return {"num_found": 0, "listings": []}
    monkeypatch.setattr(StubInventorySource, "search", spy)
    created = await _new_lead("Hi, what are your hours?")
    await _reply(created, "ok thanks")
    assert calls == []
    search = await _search(mongo, created)
    assert search["output"]["searched"] is False and search["output"]["records"] == []
    assert search["reasoning"][0].startswith("Not searched")
