"""Customer 360 built from the platform's collections (MASTER_PLAN_1 Stage 6):
the Python port of aidmvcs-be-dev's 360 route + assemble.js, and the
stub-vs-live comparison that proves they agree."""

from datetime import UTC, datetime

import pytest

from upsell_agent.devtools import simulate
from upsell_agent.devtools.compare_360 import compare
from upsell_agent.integrations.customer360 import (
    build_customer_360,
    dedupe_service_timeline,
    derive_vehicle_owners,
    get_appointment_date,
    get_deal_price,
    get_deal_salesperson,
    get_origin_badge,
    get_repair_order_date,
    parse_loose_date,
)
from upsell_agent.integrations.platform_client import StubPlatformClient

DEALER = simulate.DEV_DEALERS[0]["_id"]
OTHER = simulate.DEV_DEALERS[1]["_id"]
VIN = "DEVTESTVIN0000001"

HISTORY = {
    "vehicles": [{"vin": VIN, "year": 2019, "make": "Honda", "model": "Civic", "trim": "EX"}],
    "deals": [{"vin": VIN, "years_ago": 5, "price": 21500, "salesperson": "J. Ortiz"}],
    "repair_orders": [{"vin": VIN, "years_ago": 1, "total": 420, "ro_number": "RO1"}],
    "appointments": [{"vin": VIN, "years_ago": 1, "time": "8:30 AM", "ro_number": "RO1"},
                     {"vin": VIN, "years_ago": -0.05, "time": "10:00 AM"}],
    "trade_ins": [{"vin": VIN, "year": 2019, "make": "Honda", "model": "Civic", "miles": 60000, "condition": "good"}],
}


# --- assemble.js helpers (same cases as aidmvcs-be-dev/test-customer-360.js) --

def test_parse_loose_date():
    assert parse_loose_date("9/8/2026") == datetime(2026, 9, 8, tzinfo=UTC)
    assert parse_loose_date("2/30/2026") == datetime(2026, 3, 2, tzinfo=UTC)  # JS Date rolls over
    assert parse_loose_date(None) is None
    assert parse_loose_date("") is None
    assert parse_loose_date("not a date") is None


def test_deal_fields():
    assert get_deal_price({"Sales Price": "24,500.00"}) == 24500
    assert get_deal_price({"Sales Price": None}) is None
    deal = {"Salesman 1 Name": "Alex Rivera", "Salesman 2 Name": "Jamie Lee", "Salesman 3 Name": "Alex Rivera"}
    assert get_deal_salesperson(deal) == "Alex Rivera / Jamie Lee"
    assert get_deal_salesperson({}) is None


def test_repair_order_date_falls_back_to_open_date():
    assert get_repair_order_date({"Open Date": "1/5/2026"}) == datetime(2026, 1, 5, tzinfo=UTC)
    assert get_repair_order_date({"Close Date": "1/9/2026", "Open Date": "1/5/2026"}).day == 9


@pytest.mark.parametrize(("time", "hour", "minute"), [("8:30 AM", 8, 30), ("08:30", 8, 30), ("1:15 PM", 13, 15),
                                                       ("12:00 AM", 0, 0), ("garbage", 0, 0)])
def test_appointment_date_combines_date_and_time(time, hour, minute):
    parsed = get_appointment_date({"Appointment Date": "9/8/2026", "Appointment Time": time})
    assert (parsed.hour, parsed.minute) == (hour, minute)


def test_converted_appointments_are_hidden_from_the_timeline():
    ros = [{"ro_number": "RO1"}]
    appointments = [{"ro_number": "RO1"}, {"ro_number": None}, {"ro_number": "RO9"}]
    assert dedupe_service_timeline(ros, appointments) == [{"ro_number": None}, {"ro_number": "RO9"}]


def test_vehicle_owner_is_the_latest_record_dealer_wide():
    owners = derive_vehicle_owners(
        [{"vin": "V1", "customer_id": "old", "Contract Date": "1/1/2020"}],
        [{"vin": "V1", "customer_id": "new", "Close Date": "1/1/2024"}],
        [{"vin": "V2", "customer_id": "only", "Appointment Date": ""}],
    )
    assert owners["V1"]["customer_id"] == "new"
    assert owners["V2"]["customer_id"] == "only"  # an undated record still resolves an owner


@pytest.mark.parametrize(("customer", "leads", "badge"), [
    ({"dealervault_upload": True, "inbound_lead": True}, False, "Inbound & DealerVault"),
    ({"extra": {"dealervault": {"customer_numbers": ["C1"]}}}, False, "DealerVault"),
    ({}, True, "Inbound Lead"),
    ({"manual_entry": True}, False, "Manual"),
    ({}, False, "Unknown"),
])
def test_origin_badge(customer, leads, badge):
    assert get_origin_badge(customer, has_linked_leads=leads) == badge


# --- the whole 360 --------------------------------------------------------------

async def _customer_with_history():
    created = await simulate.create_lead(DEALER, lead_type="trade_in", channel="sms", name="Casey Test",
                                         comments="trading my civic", history=HISTORY)
    return created


async def test_360_has_every_section_the_route_returns(mongo):
    created = await _customer_with_history()
    data = await StubPlatformClient().get_customer_360(DEALER, created["customer_id"])
    assert set(data) == {"customer", "value_snapshot", "overview", "leads", "deals", "repair_orders",
                         "appointments", "all_appointments", "vehicles", "trade_ins"}
    assert data["customer"]["_id"] == created["customer_id"]
    assert data["customer"]["origin_badge"] == "Inbound Lead"
    assert [lead["_id"] for lead in data["leads"]] == [created["lead_id"]]


async def test_360_deals_service_and_appointments(mongo):
    created = await _customer_with_history()
    data = await StubPlatformClient().get_customer_360(DEALER, created["customer_id"])

    [deal] = data["deals"]
    assert deal["Sales Price"] == "21,500.00" and deal["computed_price"] == 21500
    assert deal["computed_salesperson"] == "J. Ortiz"
    assert deal["computed_date"].endswith("Z")

    [ro] = data["repair_orders"]
    assert ro["computed_totals"] == {"total_sale": 420, "customer_total_sale": 420}

    assert len(data["all_appointments"]) == 2
    assert len(data["appointments"]) == 1, "the appointment that became RO1 is hidden"
    assert data["value_snapshot"]["total_deal_price"] == 21500
    assert data["value_snapshot"]["total_repair_order_sale"] == 420


async def test_360_vehicles_and_trade_ins(mongo):
    created = await _customer_with_history()
    data = await StubPlatformClient().get_customer_360(DEALER, created["customer_id"])

    [vehicle] = data["vehicles"]
    assert vehicle["vin"] == VIN and (vehicle["year"], vehicle["make"], vehicle["model"]) == (2019, "Honda", "Civic")
    assert vehicle["is_current_owner"] is True and vehicle["vehicle_id"]

    [trade_in] = data["trade_ins"]
    assert (trade_in["miles"], trade_in["condition"], trade_in["status"]) == (60000, "good", "open")


async def test_360_is_none_for_unknown_or_other_dealers_customers(mongo):
    created = await _customer_with_history()
    client = StubPlatformClient()
    assert await client.get_customer_360(OTHER, created["customer_id"]) is None
    assert await client.get_customer_360(DEALER, "66f0000000000000000000ff") is None
    assert await client.get_customer_360(DEALER, "not-an-id") is None


async def test_other_dealers_records_never_leak_into_a_360(mongo):
    created = await _customer_with_history()
    # Same customer id and VIN, but recorded at another dealer.
    await simulate.insert_history(OTHER, created["customer_id"], HISTORY)
    data = await build_customer_360(DEALER, created["customer_id"])
    assert len(data["deals"]) == 1 and len(data["trade_ins"]) == 1 and len(data["vehicles"]) == 1


async def test_customer_with_no_history(mongo):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="New Person", comments="hi")
    data = await build_customer_360(DEALER, created["customer_id"])
    assert data["deals"] == [] and data["vehicles"] == [] and data["trade_ins"] == []
    assert data["value_snapshot"]["total_deal_price"] == 0


# --- stub vs live comparison -----------------------------------------------------

async def test_compare_accepts_identical_and_flags_differences(mongo):
    created = await _customer_with_history()
    stub = await build_customer_360(DEALER, created["customer_id"])
    assert compare(stub, stub) == []
    assert compare(None, None) == []

    live = {**stub, "trade_ins": []}
    assert any(p.startswith("trade_ins") for p in compare(stub, live))

    live = {k: v for k, v in stub.items() if k != "trade_ins"}
    assert any("top-level keys differ" in p for p in compare(stub, live))

    live = {**stub, "vehicles": [{**stub["vehicles"][0], "model": "Accord"}]}
    assert any("model" in p for p in compare(stub, live))

    assert compare(stub, None)


async def test_compare_tolerates_the_platforms_time_zone_on_computed_dates(mongo):
    created = await _customer_with_history()
    stub = await build_customer_360(DEALER, created["customer_id"])
    deal = dict(stub["deals"][0])
    # The platform parses "M/D/YYYY" in its local zone, e.g. UTC+5.
    shifted = datetime.fromisoformat(deal["computed_date"]).replace(hour=19)
    live = {**stub, "deals": [{**deal, "computed_date": shifted.isoformat()}]}
    assert compare(stub, live) == []
