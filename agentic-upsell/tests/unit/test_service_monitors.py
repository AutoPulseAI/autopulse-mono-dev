"""MASTER_PLAN_4 D5/D6 (stream A4): NHTSA recall monitoring, Vehicle Databases maintenance reminders, the
service outreach events they raise, and the guard knowledge for recall / maintenance claims.

No network: NHTSA answers come from responses recorded live on 4 Oct 2026 (tests/unit/fixtures/nhtsa/), and
Vehicle Databases from the example in its public docs (its trial must not be started)."""

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

from tests.unit.conftest import set_clock
from tests.unit.test_sold_lifecycles import (  # the real flow's helpers (stream A3)
    DEALER,
    _fire,
    _new_lead,
    _outbox,
    _say,
    _staff,
    live_dealer,  # noqa: F401 - a fixture
)
from upsell_agent import clock
from upsell_agent.agent import maintenance, ownership, recalls, service_events
from upsell_agent.api import service_vehicles
from upsell_agent.guardrails import service_claims
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.integrations import nhtsa, vehicle_databases
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_SERVICE_EVENTS_COLLECTION,
    AI_SERVICE_VEHICLES_COLLECTION,
    AI_VEHICLE_OWNERSHIP_COLLECTION,
    AI_VEHICLE_RECALLS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)

FIXTURES = Path(__file__).parent / "fixtures" / "nhtsa"
VIN = "1HGCV1F30JA012345"

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer", "live_dealer")

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
    """The real flow (stream A3): a lead, its DealerVault deal naming the VIN (delivered at 12 miles), and staff
    setting Sold Delivered - which creates the ownership record and starts the monitors."""

    async def make(**deal_extra):
        created = await _new_lead()
        today = clock.now()
        await mongo[PLATFORM_DEALS_COLLECTION].insert_one({
            "dealer_id": DEALER, "deal_number": "D1", "customer_id": as_object_id(created["customer_id"]), "vin": VIN,
            "Contract Date": f"{today.month}/{today.day}/{today.year}", "Delivery Mileage": "12", **deal_extra})
        await _staff(created, "Sold Delivered")
        return created

    return make


async def _record(mongo, created) -> dict:
    return await mongo[AI_VEHICLE_OWNERSHIP_COLLECTION].find_one({"lead_id": created["lead_id"]})


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
    created = await owned()
    lead_id, now = created["lead_id"], clock.now()
    # Sold Delivered itself started the monitoring, from A3's ownership record (VIN from the DealerVault deal).
    record = await _record(mongo, created)
    assert record["vin"] == VIN and record["vin_source"] == "dealervault_deal"
    watched = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
    assert watched["ownership_id"] == str(record["_id"]) and watched["lead_id"] == lead_id
    client, _ = nhtsa_client()
    summary = await recalls.sweep(client=client)
    assert summary["checked"] == 1 and summary["new"] == 6 and summary["outreach"] == 0

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
    assert abs(vehicle["recalls_next_check_at"].replace(tzinfo=UTC) - (now + timedelta(days=7))) < timedelta(minutes=1)

    # A second sweep inside the re-check interval calls nothing and raises nothing.
    again, seen = nhtsa_client()
    assert (await recalls.sweep(client=again))["checked"] == 0 and seen == []


async def test_confirmed_recall_goes_out_with_cadence_and_stops_when_closed(mongo, owned):
    await owned()
    start = clock.now()
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
    assert event["status"] == "queued" and event["outcome"]["followup_id"]  # A3's lifecycle sends it

    # Re-checks inside 30 days raise nothing; after it, one reminder; never more than 3 in all.
    for days, expected in ((8, 1), (31, 2), (62, 3), (93, 3), (124, 3)):
        set_clock(start + timedelta(days=days))
        vehicle = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
        await recalls.check_vehicle(DEALER, vehicle, client=client, now=start + timedelta(days=days))
        assert await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({"type": "RECALL_DETECTED"}) == expected

    closed = await recalls.close(DEALER, VIN, "20V314000", reason="completed", by="svc")
    assert closed["status"] == "completed"
    due, _why = recalls.outreach_due(closed, start + timedelta(days=400))
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
    result = await recalls.check_vehicle(DEALER, vehicle, client=client, now=clock.now() + timedelta(days=40))
    assert result["closed"] == 1
    row = await mongo[AI_VEHICLE_RECALLS_COLLECTION].find_one({"recall_id": "20V771000"})
    assert row["status"] == "completed" and row["closed_source"]["ro_number"] == "R9"
    assert await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({"type": "RECALL_DETECTED"}) == 1


async def test_no_longer_owned_vehicle_gets_no_recall_outreach(mongo, owned):
    created = await owned()
    client, _ = nhtsa_client()
    await recalls.sweep(client=client)
    await ownership.mark_no_longer_owned(dealer_scoped_db(DEALER), await _record(mongo, created), source="test",
                                         reason="customer no longer owns it")
    watched = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
    assert watched["ownership_status"] == "NO_LONGER_OWNED"
    await recalls.confirm(DEALER, VIN, "20V314000")
    assert await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({"type": "RECALL_DETECTED"}) == 0


async def test_a_vin_with_no_ownership_record_is_never_checked(mongo):
    """One source of truth: a VIN the monitors were handed without A3's ownership record is unknown, not owned."""
    await service_events.register_vehicle(DEALER, VIN)
    client, seen = nhtsa_client()
    await recalls.sweep(client=client)
    vehicle = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
    assert vehicle["recall_check"]["result"] == "not_owned" and seen == []


async def test_undecodable_vin_and_nhtsa_outage_are_recorded(mongo, owned):
    await owned()
    now = clock.now()
    down, _ = nhtsa_client(status=500)
    summary = await recalls.sweep(client=down)
    assert summary["errors"] == 1
    vehicle = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
    assert vehicle["recall_check"]["result"] == "error"
    assert abs(vehicle["recalls_next_check_at"].replace(tzinfo=UTC) - (now + recalls.RETRY_AFTER_ERROR)) < timedelta(minutes=1)

    bad, _ = nhtsa_client(decode_fixture="vpic_decode_bad_check_digit.json")
    result = await recalls.check_vehicle(DEALER, vehicle, client=bad, now=now)
    assert result["result"] == "vin_not_decodable"
    assert await mongo[AI_VEHICLE_RECALLS_COLLECTION].count_documents({}) == 0


# --- The A3 interface ----------------------------------------------------------------------------------------

async def test_end_to_end_lead_to_recall_outreach_to_no_longer_owned(mongo, owned):
    """lead -> Sold Delivered -> ownership record -> recall confirmed by staff -> queue_service_outreach -> the
    fixed-wording message with service_facts -> guard -> NO at the anniversary -> monitoring stops."""
    created = await owned()
    assert service_events.ownership_port().name == "ownership"
    assert await ownership.vehicle_is_owned(DEALER, VIN) is True
    client, _ = nhtsa_client()
    await recalls.sweep(client=client)
    assert await _outbox_recall(mongo, created) == []  # model-level matches never reach the customer

    await recalls.confirm(DEALER, VIN, "20V314000", by="svc-manager")
    doc = await _fire(mongo, created, "service_outreach")
    assert doc["status"] == "sent" and doc["outreach_kind"] == "recall"
    text = (await _outbox(mongo, created))[-1]["text"]
    assert "NHTSA" in text and "20V314000" in text and "FUEL PUMP" in text and "service campaign" not in text.lower()
    facts = (await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}))["service_offer"]["facts"]
    assert facts["recall_id"] == "20V314000" and facts["vin_confirmed"] is True  # -> decision["service_facts"]
    # The guard accepts exactly that message with those facts, and rejects a recall claim they don't support.
    assert service_claims.check_service_claims(text, facts) == []
    draft = {"sms_text": text, "email_subject": "An open safety recall for your vehicle", "email_body": text}
    assert check_draft(draft, customer_texts=[], known_values=[], service_facts=facts)["checks"][
        "service_claims_grounded"]
    other = {**draft, "sms_text": "There is also an open safety recall 23V158000 on your brakes."}
    assert not check_draft(other, customer_texts=[], known_values=[], service_facts=facts)["checks"][
        "service_claims_grounded"]
    assert not check_draft(draft, customer_texts=[], known_values=[])["checks"]["service_claims_grounded"]

    # A year on: "Do you still have your ...?" -> NO. The vehicle is NO_LONGER_OWNED and the monitors stop.
    await _fire(mongo, created, "post_delivery_checkin")
    await _fire(mongo, created, "ownership_anniversary")
    assert (await _say(created, "No, we sold it"))["sold_route"] == "ownership_ended"
    assert await ownership.vehicle_is_owned(DEALER, VIN) is False
    watched = await mongo[AI_SERVICE_VEHICLES_COLLECTION].find_one({"vin": VIN})
    assert watched["ownership_status"] == "NO_LONGER_OWNED" and watched["stopped_at"]
    before = await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({})
    later, seen = nhtsa_client()
    set_clock(clock.now() + timedelta(days=60))
    assert (await recalls.sweep(client=later))["checked"] == 0 and seen == []
    await recalls.confirm(DEALER, VIN, "20V771000")
    vd, vd_calls = vd_client()
    assert (await maintenance.sweep(client=vd))["checked"] == 0 and vd_calls == []
    assert await mongo[AI_SERVICE_EVENTS_COLLECTION].count_documents({}) == before
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "kind": "service_outreach", "status": "pending"}) == 0
    assert await mongo[AI_VEHICLE_RECALLS_COLLECTION].count_documents({"vin": VIN}) == 6  # history kept


async def _outbox_recall(mongo, created) -> list[dict]:
    return [m for m in await _outbox(mongo, created) if "recall" in (m.get("text") or "").lower()]


async def test_day_3_names_the_first_service_only_from_the_oem_schedule(mongo, owned):
    created = await owned()
    vd, _ = vd_client()
    await maintenance.sweep(client=vd)
    record = await _record(mongo, created)
    assert record["maintenance"]["first_service"]["interval_miles"] == 15000
    await _fire(mongo, created, "post_delivery_checkin")
    text = (await _outbox(mongo, created))[-1]["text"]
    assert "first recommended service (Replace Air Cleaner Element, Replace Cabin Air Filter at 15,000 miles)" in text


async def test_day_3_stays_in_words_without_a_schedule(mongo, owned):
    created = await owned()
    off, _ = vd_client(enabled=False)
    await maintenance.sweep(client=off)
    assert "maintenance" not in await _record(mongo, created)
    await _fire(mongo, created, "post_delivery_checkin")
    text = (await _outbox(mongo, created))[-1]["text"]
    assert "your first recommended service now" in text and "miles" not in text


def test_fallback_only_when_the_ownership_module_is_missing(monkeypatch):
    assert service_events.ownership_port().name == "ownership"
    monkeypatch.setitem(sys.modules, "upsell_agent.agent.ownership", None)  # import raises ImportError
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


NOW = datetime(2026, 10, 5, 15, 0, tzinfo=UTC)


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


def test_maintenance_is_due_at_whichever_comes_first_miles_or_months():
    """Client, 8 Oct 2026: "if it's five months but they didn't hit the 5,000 miles yet, they still need to do the
    service because the five months elapsed"."""
    visit = NOW - timedelta(days=200)  # about 6.5 months ago, at 15,100 miles
    visits = [maintenance.ServiceVisit(visit, 15_100, "repair_order")]
    readings = [maintenance.Reading(16_000, NOW - timedelta(days=20), "repair_order")]  # driven little since
    status = maintenance.compute_status(_schedule(), readings, visits, delivered_at=None, now=NOW,
                                        time_interval_months=6)
    assert status["status"] == "due" and status["basis"] == "time"
    facts = status["due"]["facts"]
    assert facts["interval_miles"] == 25000 and facts["months_since_last_visit"] == 6
    assert facts["verified_mileage"]["miles"] == 16_000 and facts["mileage_is_estimate"] is False
    # Inside the months, the same car is not due yet.
    recent = [maintenance.ServiceVisit(NOW - timedelta(days=60), 15_100, "repair_order")]
    assert maintenance.compute_status(_schedule(), readings, recent, delivered_at=None, now=NOW,
                                      time_interval_months=6)["status"] == "not_due"


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
    assert event["status"] == "queued"
    queued = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"kind": "service_outreach", "status": "pending"})
    assert queued["outreach_kind"] == "maintenance" and queued["facts"]["service"].startswith("15,000-mile service")
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


def test_parses_a_real_vehicle_databases_maintenance_response():
    """A real sandbox response (4 Oct 2026, GET /vehicle-maintenance/v4/{vin}, a public sample VIN: 2003 Honda
    Accord), recorded so the parser is checked against the live format without spending API credits."""
    import json
    from pathlib import Path

    from upsell_agent.integrations.vehicle_databases import parse_schedule

    body = json.loads((Path(__file__).parent / "fixtures" / "vehicle_databases"
                       / "maintenance_v4_1HGCM82633A004352.json").read_text())
    schedule = parse_schedule("1HGCM82633A004352", body)
    assert schedule is not None
    data = schedule.as_dict()
    assert (data["year"], data["make"], data["model"]) == (2003, "Honda", "Accord")
    assert len(data["intervals"]) == 48
    assert data["intervals"][0]["miles"] == 3750
    assert data["intervals"][0]["service_items"] == ["Replace Engine Oil", "Replace Engine Oil Filter"]
    assert data["intervals"][-1]["miles"] == 120000


def test_invalid_vins_are_never_sent_to_vehicle_databases():
    from upsell_agent.integrations.vehicle_databases import valid_vin

    assert valid_vin("1HGCM82633A004352")  # 2003 Honda Accord, NHTSA decodes it cleanly
    assert valid_vin("5YJSA1DG9DFP14705")  # 2013 Tesla Model S
    assert not valid_vin("1FTFW1ET5DFC10312")  # wrong check digit (NHTSA error 1)
    assert not valid_vin("DEV77104D87E42D2C")  # dev seed stock
    assert not valid_vin("1HGCM82633A00435")  # 16 characters
    assert not valid_vin("1HGCM8263IA004352")  # contains I
    assert not valid_vin(None)
