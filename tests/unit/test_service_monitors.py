"""MASTER_PLAN_4 D5/D6 (stream A4): NHTSA recall monitoring, Vehicle Databases maintenance reminders, the
service outreach events they raise, and the guard knowledge for recall / maintenance claims.

No network: NHTSA answers come from responses recorded live on 4 Oct 2026 (tests/unit/fixtures/nhtsa/), and
Vehicle Databases from the example in its public docs (its trial must not be started)."""

import json
import sys
import types
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from bson import ObjectId
from fastapi import HTTPException

from tests.unit.conftest import set_clock
from upsell_agent.agent import maintenance, recalls, service_events
from upsell_agent.api import service_vehicles
from upsell_agent.guardrails import service_claims
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.integrations import nhtsa, vehicle_databases
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_SERVICE_EVENTS_COLLECTION,
    AI_SERVICE_VEHICLES_COLLECTION,
    AI_VEHICLE_RECALLS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
)

FIXTURES = Path(__file__).parent / "fixtures" / "nhtsa"
DEALER = "dealer-a4"
VIN = "1HGCV1F30JA012345"
NOW = datetime(2026, 10, 5, 15, 0, tzinfo=UTC)

VD_EXAMPLE = {  # https://vehicledatabases.com/docs/api-documentation/vehicle-maintenance/ (v4 example, trimmed)
    "status": "success",
    "data": {"vin": VIN, "year": 2018, "make": "Honda", "model": "Accord", "trim": "Sport",
             "maintenance": [
                 {"mileage": {"miles": 15000, "km": 24100},
                  "service_items": ["Replace Air Cleaner Element", "Replace Cabin Air Filter"]},
                 {"mileage": {"miles": 25000, "km": 40200}, "service_items": ["Replace Automatic Transaxle (cvt) Fluid"]},
                 {"mileage": {"miles": 30000, "km": 48200},
                  "service_items": ["Replace Air Cleaner Element", "Replace Cabin Air Filter"]},
                 {"mileage": {"miles": 45000, "km": 72400},
                  "service_items": ["Replace Air Cleaner Element", "Replace Cabin Air Filter"]},
             ]}}


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def nhtsa_client(recalls_fixture: str = "recalls_by_vehicle_honda_accord_2018.json",
                 decode_fixture: str = "vpic_decode_1HGCV1F30JA012345.json", status: int = 200):
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if status != 200:
            return httpx.Response(status, json={})
        if "DecodeVinValues" in request.url.path:
            return httpx.Response(200, json=_fixture(decode_fixture))
        return httpx.Response(200, json=_fixture(recalls_fixture))

    client = nhtsa.NhtsaClient(min_interval_s=0, transport=httpx.MockTransport(handler))
    return client, seen


def vd_client(body: dict | None = None, status: int = 200, enabled: bool = True):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json=body if body is not None else VD_EXAMPLE)

    client = vehicle_databases.VehicleDatabasesClient(api_key="test-key", enabled=enabled, min_interval_s=0,
                                                      transport=httpx.MockTransport(handler))
    return client, seen


@pytest.fixture
def owned(mongo):
    """A SOLD - DELIVERED lead whose deal names the VIN (delivered 1 Sep 2026 at 12 miles)."""
    set_clock(NOW)
    lead_id = ObjectId()
    customer_id = ObjectId()

    async def make(**deal_extra):
        await mongo[PLATFORM_LEADS_COLLECTION].insert_one({"_id": lead_id, "dealer_id": DEALER,
                                                          "customer_id": customer_id})
        await mongo[AI_LEAD_STATE_COLLECTION].insert_one({
            "dealer_id": DEALER, "lead_id": str(lead_id), "customer_id": str(customer_id), "stage": "sold_delivered",
            "opportunity_created_at": datetime(2026, 8, 20, tzinfo=UTC),
            "stage_history": [{"to": "sold_delivered", "at": datetime(2026, 9, 1, tzinfo=UTC)}]})
        await mongo[PLATFORM_DEALS_COLLECTION].insert_one({
            "dealer_id": DEALER, "deal_number": "D1", "customer_id": customer_id, "vin": VIN,
            "Contract Date": "9/1/2026", "Delivery Mileage": "12", **deal_extra})
        return str(lead_id)

    return make


# --- NHTSA client --------------------------------------------------------------------------------------------

def test_parses_recorded_nhtsa_responses():
    decoded = nhtsa.parse_decode(VIN, _fixture("vpic_decode_1HGCV1F30JA012345.json"))
    assert decoded.usable and (decoded.year, decoded.make, decoded.model) == (2018, "HONDA", "Accord")
    bad = nhtsa.parse_decode("1HGCV1F30JA000000", _fixture("vpic_decode_bad_check_digit.json"))
    assert not bad.usable and bad.error_code == "1"
    found = nhtsa.parse_recalls(_fixture("recalls_by_vehicle_honda_accord_2018.json"))
    assert [r.recall_id for r in found][:2] == ["20V314000", "20V771000"]
    assert found[0].report_received == datetime(2020, 5, 28, tzinfo=UTC)
    assert nhtsa.parse_recalls(_fixture("recalls_by_vehicle_empty.json")) == []
    assert nhtsa.normalize_vin(" 1hgcv1f30ja012345 ") == VIN
    assert nhtsa.normalize_vin("1HGCV1F30JA01234O") is None  # O is never in a VIN


async def test_nhtsa_client_caches_by_model_and_raises_on_errors():
    client, seen = nhtsa_client()
    assert len(await client.recalls_by_vehicle("HONDA", "Accord", 2018)) == 6
    await client.recalls_by_vehicle("honda", "ACCORD", 2018)
    assert len(seen) == 1
    assert "make=HONDA" in seen[0] and "modelYear=2018" in seen[0]
    failing, _ = nhtsa_client(status=503)
    with pytest.raises(nhtsa.NhtsaError):
        await failing.decode_vin(VIN)


# --- Recalls -------------------------------------------------------------------------------------------------

async def test_model_level_recalls_raise_a_staff_notice_never_customer_outreach(mongo, owned):
    lead_id = await owned()
    client, _ = nhtsa_client()
    summary = await recalls.sweep(client=client)
    assert summary["discovered"]["registered"] == 1 and summary["new"] == 6 and summary["outreach"] == 0

    stored = await mongo[AI_VEHICLE_RECALLS_COLLECTION].find({"vin": VIN}).to_list(None)
    assert len(stored) == 6
    first = next(r for r in stored if r["recall_id"] == "20V314000")
    assert first["status"] == recalls.UNVERIFIED and first["match_level"] == "model"
    assert first["source"] == "nhtsa_recalls_by_vehicle" and first["description"].startswith("Honda")
    assert first["detected_at"] and first["last_checked_at"]

    events = await mongo[AI_SERVICE_EVENTS_COLLECTION].find({}).to_list(None)
    assert [e["type"] for e in events] == ["RECALL_REVIEW"] and events[0]["customer_facing"] is False
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": lead_id})
    assert state["staff_notice"]["kind"] == "recall_review" and "can't confirm" in state["staff_notice"]["text"]
    vehicle = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
    assert (vehicle["year"], vehicle["make"], vehicle["model"]) == (2018, "HONDA", "Accord")
    assert abs(vehicle["recalls_next_check_at"].replace(tzinfo=UTC) - (NOW + timedelta(days=7))) < timedelta(minutes=1)

    # A second sweep inside the re-check interval calls nothing and raises nothing.
    again, seen = nhtsa_client()
    assert (await recalls.sweep(client=again))["checked"] == 0 and seen == []


async def test_confirmed_recall_goes_out_with_cadence_and_stops_when_closed(mongo, owned):
    await owned()
    client, _ = nhtsa_client()
    await recalls.sweep(client=client)

    row = await recalls.confirm(DEALER, VIN, "20V314000", by="svc-manager")
    assert row["status"] == recalls.OPEN and row["match_level"] == "vin" and row["outreach"]["count"] == 1
    events = await mongo[AI_SERVICE_EVENTS_COLLECTION].find({"type": "RECALL_DETECTED"}).to_list(None)
    assert len(events) == 1
    event = events[0]
    assert event["offer"] == "service_visit_request" and event["customer_facing"] is True
    assert event["facts"]["recall_id"] == "20V314000" and event["facts"]["vin_confirmed"] is True
    assert event["facts"]["source"] == "NHTSA"
    assert event["status"] == "staff_notice"  # A3's lifecycle isn't merged: the fallback tells staff

    # Re-checks inside 30 days raise nothing; after it, one reminder; never more than 3 in all.
    for days, expected in ((8, 1), (31, 2), (62, 3), (93, 3), (124, 3)):
        set_clock(NOW + timedelta(days=days))
        vehicle = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
        await recalls.check_vehicle(DEALER, vehicle, client=client, now=NOW + timedelta(days=days))
        assert await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({"type": "RECALL_DETECTED"}) == expected

    closed = await recalls.close(DEALER, VIN, "20V314000", reason="completed", by="svc")
    assert closed["status"] == "completed"
    due, _why = recalls.outreach_due(closed, NOW + timedelta(days=400))
    assert not due


async def test_repair_order_naming_the_campaign_closes_the_recall(mongo, owned):
    await owned()
    client, _ = nhtsa_client()
    await recalls.sweep(client=client)
    await recalls.confirm(DEALER, VIN, "20V771000")
    await mongo[PLATFORM_REPAIR_ORDERS_COLLECTION].insert_one({
        "dealer_id": DEALER, "ro_number": "R9", "vin": VIN, "Close Date": "10/10/2026",
        "service_operations": [{"description": "RECALL 20V771000 BCM SOFTWARE UPDATE"}]})
    vehicle = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
    result = await recalls.check_vehicle(DEALER, vehicle, client=client, now=NOW + timedelta(days=40))
    assert result["closed"] == 1
    row = await mongo[AI_VEHICLE_RECALLS_COLLECTION].find_one({"recall_id": "20V771000"})
    assert row["status"] == "completed" and row["closed_source"]["ro_number"] == "R9"
    assert await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({"type": "RECALL_DETECTED"}) == 1


async def test_no_longer_owned_vehicle_gets_no_recall_outreach(mongo, owned):
    await owned()
    client, _ = nhtsa_client()
    await recalls.sweep(client=client)
    assert await service_events.stop_vehicle(DEALER, VIN, reason="customer no longer owns it")
    await recalls.confirm(DEALER, VIN, "20V314000")
    assert await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({"type": "RECALL_DETECTED"}) == 0


async def test_undecodable_vin_and_nhtsa_outage_are_recorded(mongo):
    set_clock(NOW)
    await service_events.register_vehicle(DEALER, VIN)
    down, _ = nhtsa_client(status=500)
    summary = await recalls.sweep(client=down)
    assert summary["errors"] == 1
    vehicle = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
    assert vehicle["recall_check"]["result"] == "error"
    assert abs(vehicle["recalls_next_check_at"].replace(tzinfo=UTC) - (NOW + recalls.RETRY_AFTER_ERROR)) < timedelta(minutes=1)

    bad, _ = nhtsa_client(decode_fixture="vpic_decode_bad_check_digit.json")
    result = await recalls.check_vehicle(DEALER, vehicle, client=bad, now=NOW)
    assert result["result"] == "vin_not_decodable"
    assert await mongo[AI_VEHICLE_RECALLS_COLLECTION].count_documents({}) == 0


# --- The A3 interface ----------------------------------------------------------------------------------------

async def test_ownership_module_is_used_when_present(mongo, owned, monkeypatch):
    await owned()
    queued: list[dict] = []

    async def queue_service_outreach(dealer_id, event):
        queued.append(event)
        return {"status": "queued", "task_id": "t1"}

    module = types.ModuleType("upsell_agent.agent.ownership")
    module.queue_service_outreach = queue_service_outreach
    module.vehicle_is_owned = lambda dealer_id, vin, customer_id=None: True  # sync works too
    monkeypatch.setitem(sys.modules, "upsell_agent.agent.ownership", module)
    import upsell_agent.agent as agent_pkg
    monkeypatch.setattr(agent_pkg, "ownership", module, raising=False)

    assert service_events.ownership_port().name == "ownership"
    client, _ = nhtsa_client()
    await recalls.sweep(client=client)
    await recalls.confirm(DEALER, VIN, "20V314000")
    assert len(queued) == 1 and queued[0]["type"] == "RECALL_DETECTED" and queued[0]["event_id"]
    stored = await mongo[AI_SERVICE_EVENTS_COLLECTION].find_one({"type": "RECALL_DETECTED"})
    assert stored["status"] == "queued" and stored["outcome"]["task_id"] == "t1"


def test_fallback_without_ownership_module():
    assert service_events.ownership_port().name == "local_fallback"


# --- Vehicle Databases + maintenance ---------------------------------------------------------------------------

async def test_vehicle_databases_client_follows_the_docs():
    client, seen = vd_client()
    schedule = await client.maintenance_schedule(VIN)
    assert seen[0].headers["x-authkey"] == "test-key"
    assert seen[0].url.path == f"/vehicle-maintenance/v4/{VIN}"
    assert [i.miles for i in schedule.intervals] == [15000, 25000, 30000, 45000]
    assert vehicle_databases.schedule_from_dict(schedule.as_dict()) == schedule
    none, _ = vd_client(status=400, body={"status": "error"})
    assert await none.maintenance_schedule(VIN) is None
    limited, _ = vd_client(status=429, body={})
    with pytest.raises(vehicle_databases.VehicleDatabasesError) as err:
        await limited.maintenance_schedule(VIN)
    assert err.value.retryable
    off, calls = vd_client(enabled=False)
    with pytest.raises(vehicle_databases.VehicleDatabasesDisabled):
        await off.maintenance_schedule(VIN)
    assert calls == []


def _schedule():
    return vehicle_databases.parse_schedule(VIN, VD_EXAMPLE)


def test_compute_status_uses_verified_mileage_only():
    deliv = datetime(2026, 1, 1, tzinfo=UTC)
    readings = [maintenance.Reading(14_400, NOW - timedelta(days=10), "repair_order", "R1")]
    status = maintenance.compute_status(_schedule(), readings, [], delivered_at=deliv, now=NOW,
                                        time_interval_months=6)
    assert status["status"] == "due" and status["basis"] == "mileage"
    facts = status["due"]["facts"]
    assert facts["interval_miles"] == 15000 and facts["verified_mileage"]["miles"] == 14_400
    assert facts["service_items"] == ["Replace Air Cleaner Element", "Replace Cabin Air Filter"]
    assert facts["mileage_is_estimate"] is False

    # Serviced at 15,100: the 15k service is done; next is 25k, not due yet.
    visits = [maintenance.ServiceVisit(NOW - timedelta(days=5), 15_100, "repair_order")]
    readings.append(maintenance.Reading(15_100, NOW - timedelta(days=5), "repair_order"))
    status = maintenance.compute_status(_schedule(), readings, visits, delivered_at=deliv, now=NOW,
                                        time_interval_months=6)
    assert status["status"] == "not_due" and status["next_service"]["miles"] == 25000

    # A stale reading is not current mileage: time basis, no mileage and no items in the facts.
    old = [maintenance.Reading(14_400, NOW - timedelta(days=300), "repair_order")]
    visits = [maintenance.ServiceVisit(NOW - timedelta(days=300), 14_400, "repair_order")]
    status = maintenance.compute_status(_schedule(), old, visits, delivered_at=deliv, now=NOW,
                                        time_interval_months=6)
    assert status["basis"] == "time" and status["status"] == "due"
    assert status["due"]["facts"]["verified_mileage"] is None and status["due"]["facts"]["service_items"] == []

    assert maintenance.compute_status(None, readings, [], delivered_at=deliv, now=NOW,
                                      time_interval_months=6)["status"] == "no_schedule"


def test_used_vehicle_isnt_chased_for_services_before_delivery():
    readings = [maintenance.Reading(40_000, NOW - timedelta(days=3), "deal", "D1")]
    status = maintenance.compute_status(_schedule(), readings, [], delivered_at=NOW - timedelta(days=3), now=NOW,
                                        time_interval_months=6)
    assert status["status"] == "not_due" and status["next_service"]["miles"] == 45000


async def test_maintenance_is_off_without_vehicle_databases(mongo, owned):
    await owned()
    off, calls = vd_client(enabled=False)
    summary = await maintenance.sweep(client=off)
    assert summary["checked"] == 1 and summary["events"] == 0 and calls == []
    vehicle = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
    assert vehicle["maintenance"]["status"] == "no_schedule"
    assert "VEHICLE_DATABASES_ENABLED" in vehicle["maintenance"]["schedule_problem"]


async def test_maintenance_due_raises_one_event_and_recalculates(mongo, owned):
    await owned()
    client, calls = vd_client()
    await maintenance.sweep(client=client)
    assert len(calls) == 1  # the schedule is fetched once and kept
    assert await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({}) == 0  # 12 miles: nothing due

    result = await maintenance.record_mileage(DEALER, VIN, miles=14_500, by="advisor", client=client)
    assert result["status"] == "due" and result["event"]
    event = await mongo[AI_SERVICE_EVENTS_COLLECTION].find_one({"type": "MAINTENANCE_DUE"})
    assert event["facts"]["interval_miles"] == 15000 and event["offer"] == "service_visit_request"
    # The same due service never alerts twice.
    again = await maintenance.record_mileage(DEALER, VIN, miles=14_700, client=client)
    assert again["status"] == "due"
    assert await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({"type": "MAINTENANCE_DUE"}) == 1
    # An outside service at 15,000 recalculates: nothing due until 25k.
    done = await maintenance.record_service(DEALER, VIN, miles=15_000, outside=True, client=client)
    assert done["status"] == "not_due" and done["next_service"]["miles"] == 25000
    assert len(calls) == 1

    view = await service_vehicles.service_status(VIN, dealer_id=DEALER)
    assert view["maintenance"]["status"]["status"] == "not_due"
    assert view["maintenance"]["schedule_source"] == "vehicle_databases_maintenance_v4"
    assert view["events"][0]["type"] == "MAINTENANCE_DUE"


async def test_maintenance_waits_after_a_recall_outreach(mongo, owned):
    await owned()
    client, _ = nhtsa_client()
    await recalls.sweep(client=client)
    await recalls.confirm(DEALER, VIN, "20V314000")
    vd, _ = vd_client()
    result = await maintenance.record_mileage(DEALER, VIN, miles=14_500, client=vd)
    assert result["status"] == "due" and result["held_back"] and not result["event"]


async def test_read_endpoints(mongo, owned):
    await owned()
    client, _ = nhtsa_client()
    await recalls.sweep(client=client)
    rows = await service_vehicles.list_recalls(VIN, dealer_id=DEALER)
    assert len(rows) == 6 and rows[0]["customer_outreach_allowed"] is False
    assert {"recall_id", "description", "detected_at", "status", "source", "last_checked_at"} <= set(rows[0])
    confirmed = await service_vehicles.confirm_recall(VIN, "20v314000", service_vehicles.StaffNote(dealer_id=DEALER))
    assert confirmed["customer_outreach_allowed"] is True
    with pytest.raises(HTTPException):
        await service_vehicles.get_maintenance(VIN, dealer_id="other-dealer")


# --- Guard knowledge -----------------------------------------------------------------------------------------

RECALL_FACTS = {"kind": "recall", "vin_confirmed": True, "recall_id": "20V314000", "source": "NHTSA", "year": 2018}
MAINT_FACTS = {"kind": "maintenance", "basis": "mileage", "interval_miles": 30000,
               "service_items": ["Replace Air Cleaner Element", "Replace Cabin Air Filter"],
               "verified_mileage": {"miles": 29500}, "year": 2018}


def test_recall_claims_need_vin_confirmed_facts():
    text = "There's an open safety recall on your 2018 Accord (20V314000). Want to come in?"
    assert service_claims.check_service_claims(text, RECALL_FACTS) == []
    assert service_claims.check_service_claims(text, None)
    assert service_claims.check_service_claims(text, {**RECALL_FACTS, "vin_confirmed": False})
    assert service_claims.check_service_claims("Recall 21V100000 applies to you.", RECALL_FACTS)
    assert service_claims.check_service_claims("This manufacturer service campaign covers it.", RECALL_FACTS)
    assert service_claims.check_service_claims("I recall you mentioned Friday.", None) == []


def test_maintenance_claims_stay_inside_the_schedule():
    ok = "Your Accord is due for its 30,000-mile service: replace the cabin air filter and engine air filter."
    assert service_claims.check_service_claims(ok, MAINT_FACTS) == []
    assert service_claims.check_service_claims(ok, None)  # "due for" with no maintenance facts
    assert service_claims.check_service_claims("You're due for an oil change and tire rotation.", MAINT_FACTS)
    time_facts = {"kind": "maintenance", "basis": "time", "service_items": [], "verified_mileage": None}
    assert service_claims.check_service_claims("Your Accord is probably at about 20,000 miles.", time_facts)
    assert service_claims.check_service_claims("It's been a while since your last visit. Want a service check?",
                                               time_facts) == []


def test_draft_guard_uses_service_facts():
    draft = {"sms_text": "Hi! Your 2018 Accord is due for its 30,000-mile service (cabin air filter). Want to "
                         "come in? Reply with a day that works.",
             "email_subject": "Service", "email_body": "Hi, your 2018 Accord is due for its 30,000-mile service."}
    passed = check_draft(draft, customer_texts=[], known_values=[], service_facts=MAINT_FACTS)
    assert passed["passed"], passed["violations"]
    failed = check_draft(draft, customer_texts=[], known_values=[])
    assert not failed["passed"] and not failed["checks"]["service_claims_grounded"]
