"""Service outreach events from the recall and maintenance monitors (MASTER_PLAN_4 D5/D6, stream A4).

SOLD-DELIVERED PDF §5/§6: "VIN -> NHTSA Recall Check -> ... -> Customer Outreach -> Service Appointment" and
"VIN -> Vehicle Database -> ... -> Recommended Service Due -> Outreach -> Service Appointment". The client
(conversation_6.md, 30 Sep 2026): "with those integrations we don't need to set up cadences because they alert
the ai to send a message/create a task". So agent/recalls.py and agent/maintenance.py don't send anything
themselves: they raise one **service outreach event**, and the ownership lifecycle (stream A3,
agent/ownership.py) turns it into the message or the task, through its own compliance and quiet-hours checks.

What an event offers is a service visit **request** with the customer's notes, never a booking (client, 1 Oct
2026, scope Q16: "service appointments are offered in this sow and notes taken in, but in the next sow
availability will be able to be read"). Its `facts` are everything the message may state about the recall or
the service; guardrails/service_claims.py rejects a draft that claims anything else (§12 "never fabricate ...
maintenance, mileage, recall status").

Ownership has ONE source of truth: stream A3's ownership records (agent/ownership.py, `ai_vehicle_ownership`).
`ai_service_vehicles` here is only the monitors' own state for a VIN (when it was last checked, its decoded
year/make/model, its stored schedule); whether the customer still owns the vehicle is always asked of
`ownership.vehicle_is_owned`, and vehicles get here only from an ownership record (watch_delivered_vehicle,
called by A3's start_ownership, and discover_owned_vehicles as the catch-up). Outreach goes through
`ownership.queue_service_outreach`. The LocalFallback exists only for a build without agent/ownership.py: it
turns every outreach into a staff notice, so nothing reaches a customer without the lifecycle's checks.

Storage (integrations/mongodb.py): `ai_service_vehicles` (the vehicles watched, one per dealer + VIN) and
`ai_service_events` (every event and staff notice, unique per `event_key`, so the same alert is never raised
twice).
"""

import importlib
import inspect
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from pymongo.errors import DuplicateKeyError

from upsell_agent import clock
from upsell_agent.integrations.customer360 import get_deal_date
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_SERVICE_EVENTS_COLLECTION,
    AI_SERVICE_VEHICLES_COLLECTION,
    AI_VEHICLE_OWNERSHIP_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.integrations.nhtsa import normalize_vin

logger = logging.getLogger(__name__)

# §14 suggested event names.
RECALL_DETECTED = "RECALL_DETECTED"
MAINTENANCE_DUE = "MAINTENANCE_DUE"
# Staff-only notices: a model-level recall to check by VIN, a data problem.
RECALL_REVIEW = "RECALL_REVIEW"

# Whether the monitors still watch a VIN (`ai_service_vehicles.ownership_status`): a mirror of A3's ownership
# record, set by watch_delivered_vehicle / stop_vehicle, used only to pick the sweeps' rows. It never answers
# "is this owned" - ownership.vehicle_is_owned does.
OWNED, NO_LONGER_OWNED = "ACTIVE", "NO_LONGER_OWNED"
DEALER_SALE = "DEALER_SALE"
# The offer every event makes (scope Q16).
OFFER = "service_visit_request"
# Maintenance never goes out within this many days of a recall outreach for the same vehicle, so the two
# don't compete for the customer's attention (MASTER_PLAN_4 D6: "its own outreach cadence").
SERVICE_OUTREACH_GAP_DAYS = 7


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


# --- The A3 interface --------------------------------------------------------------------------------------

class OwnershipPort(Protocol):
    async def vehicle_is_owned(self, dealer_id: str, vin: str, *, customer_id: str | None = None) -> bool | None: ...

    async def queue_service_outreach(self, dealer_id: str, event: dict[str, Any]) -> dict[str, Any]: ...


async def _maybe_await(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


class _ModulePort:
    """A3's agent/ownership.py, called through its module-level functions."""

    def __init__(self, module: Any) -> None:
        self._module = module
        self.name = "ownership"

    async def vehicle_is_owned(self, dealer_id: str, vin: str, *, customer_id: str | None = None) -> bool | None:
        return await _maybe_await(self._module.vehicle_is_owned(dealer_id, vin, customer_id=customer_id))

    async def queue_service_outreach(self, dealer_id: str, event: dict[str, Any]) -> dict[str, Any]:
        return await _maybe_await(self._module.queue_service_outreach(dealer_id, event)) or {}


class LocalFallback:
    """Only for a build without agent/ownership.py: a watched vehicle counts as owned until stop_vehicle, and
    every outreach is a staff notice instead of a message."""

    name = "local_fallback"

    async def vehicle_is_owned(self, dealer_id: str, vin: str, *, customer_id: str | None = None) -> bool | None:
        vehicle = await dealer_scoped_db(dealer_id).collection(AI_SERVICE_VEHICLES_COLLECTION).find_one({"vin": vin})
        return None if vehicle is None else vehicle.get("ownership_status") != NO_LONGER_OWNED

    async def queue_service_outreach(self, dealer_id: str, event: dict[str, Any]) -> dict[str, Any]:
        await notify_staff(dealer_scoped_db(dealer_id), event.get("lead_id"), kind="service_outreach",
                           text=event.get("summary") or "Service outreach is due for this customer's vehicle.")
        return {"status": "staff_notice", "reason": "ownership lifecycle (agent/ownership.py) not available"}


_FALLBACK = LocalFallback()


def _ownership_module() -> Any | None:
    try:
        return importlib.import_module("upsell_agent.agent.ownership")
    except ImportError:
        return None


def ownership_port() -> OwnershipPort:
    """A3's ownership lifecycle; the fallback only when that module is genuinely missing."""
    module = _ownership_module()
    return _ModulePort(module) if module is not None else _FALLBACK


async def notify_staff(db: DealerScopedDatabase, lead_id: str | None, *, kind: str, text: str) -> None:
    """The lead's staff notice (the same field the call tasks and handoffs use), when there is a lead."""
    if not lead_id:
        return
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"staff_notice": {"at": clock.now(), "kind": kind, "text": text}}})


# --- Events ------------------------------------------------------------------------------------------------

def vehicle_label(vehicle: dict[str, Any]) -> str:
    return " ".join(str(p) for p in (vehicle.get("year"), vehicle.get("make"), vehicle.get("model")) if p) or "vehicle"


async def record_event(db: DealerScopedDatabase, vehicle: dict[str, Any], *, event_type: str, event_key: str,
                       facts: dict[str, Any], summary: str, customer_facing: bool) -> dict[str, Any] | None:
    """Stores the event once per `event_key`; None when it was already raised. A customer-facing event goes to
    the ownership lifecycle (or the fallback's staff notice); a staff-only one is a staff notice."""
    now = clock.now()
    event: dict[str, Any] = {
        "event_key": event_key, "type": event_type, "vin": vehicle["vin"],
        "customer_id": vehicle.get("customer_id"), "lead_id": vehicle.get("lead_id"),
        "ownership_id": vehicle.get("ownership_id"),
        "vehicle": {k: vehicle.get(k) for k in ("year", "make", "model")},
        "offer": OFFER if customer_facing else None, "customer_facing": customer_facing,
        "facts": facts, "summary": summary, "created_at": now, "status": "new",
    }
    events = db.collection(AI_SERVICE_EVENTS_COLLECTION)
    if await events.find_one({"event_key": event_key}):
        return None
    try:  # the unique index catches two workers racing past the check above
        result = await events.insert_one(event)
    except DuplicateKeyError:
        return None
    event["_id"] = result.inserted_id
    event["dealer_id"] = db.dealer_id
    if customer_facing:
        payload = {k: v for k, v in event.items() if k != "_id"}
        payload["event_id"] = str(result.inserted_id)
        try:
            outcome = await ownership_port().queue_service_outreach(db.dealer_id, payload)
        except Exception as exc:  # the event stays recorded; staff see it either way
            logger.exception("queue_service_outreach failed for %s", event_key)
            outcome = {"status": "error", "reason": repr(exc)}
            await notify_staff(db, vehicle.get("lead_id"), kind="service_outreach", text=summary)
    else:
        await notify_staff(db, vehicle.get("lead_id"), kind=event_type.lower(), text=summary)
        outcome = {"status": "staff_notice"}
    await db.collection(AI_SERVICE_EVENTS_COLLECTION).update_one(
        {"_id": result.inserted_id}, {"$set": {"status": outcome.get("status") or "queued", "outcome": outcome}})
    event.update(status=outcome.get("status") or "queued", outcome=outcome)
    return event


async def last_customer_event_at(db: DealerScopedDatabase, vin: str, event_type: str) -> datetime | None:
    rows = await db.collection(AI_SERVICE_EVENTS_COLLECTION).find(
        {"vin": vin, "type": event_type, "customer_facing": True}).sort("created_at", -1).to_list(1)
    return _aware(rows[0]["created_at"]) if rows else None


# --- The watched vehicles ----------------------------------------------------------------------------------

async def register_vehicle(dealer_id: str, vin: str, *, customer_id: str | None = None, lead_id: str | None = None,
                           delivered_at: datetime | None = None, ownership_id: str | None = None,
                           source: str = "sold_delivered") -> dict | None:
    """Starts (or resumes) watching a delivered vehicle. Idempotent."""
    vin = normalize_vin(vin)
    if not vin:
        return None
    now = clock.now()
    db = dealer_scoped_db(dealer_id)
    vehicles = db.collection(AI_SERVICE_VEHICLES_COLLECTION)
    await vehicles.update_one({"vin": vin}, {
        "$setOnInsert": {"vin": vin, "registered_at": now, "registered_from": source,
                         "recalls_next_check_at": now, "maintenance_next_check_at": now},
        "$set": {"ownership_status": OWNED,
                 **{k: v for k, v in {"customer_id": customer_id, "lead_id": lead_id, "delivered_at": delivered_at,
                                      "ownership_id": ownership_id}.items() if v is not None}},
    }, upsert=True)
    return await vehicles.find_one({"vin": vin})


async def stop_vehicle(dealer_id: str, vin: str | None, *, reason: str) -> bool:
    """§8 NO (called by ownership.mark_no_longer_owned): the monitors stop watching this vehicle. Its recalls,
    schedule and events are kept (§1 "historical ... data must remain preserved")."""
    vin = normalize_vin(vin)
    if not vin:
        return False
    result = await dealer_scoped_db(dealer_id).collection(AI_SERVICE_VEHICLES_COLLECTION).update_one(
        {"vin": vin}, {"$set": {"ownership_status": NO_LONGER_OWNED, "stopped_at": clock.now(),
                                "stopped_reason": reason}})
    return bool(result.matched_count)


async def _vin_from_deal(db: DealerScopedDatabase, record: dict[str, Any]) -> str | None:
    """The sold vehicle's VIN from the customer's DealerVault deal for this opportunity (the latest deal dated
    from the opportunity's start on): "VIN only from legitimate approved source" (§11)."""
    customer_id = record.get("customer_id")
    if not customer_id:
        return None
    deals = await db.collection(PLATFORM_DEALS_COLLECTION).find(
        {"customer_id": {"$in": [as_object_id(str(customer_id)), str(customer_id)]}}).to_list(200)
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": record.get("lead_id")}) or {}
    since = _aware(state.get("opportunity_created_at"))
    since = since - timedelta(days=1) if since else None
    dated = [(get_deal_date(d), d) for d in deals if normalize_vin(d.get("vin"))]
    dated = [(at, d) for at, d in dated if at and (since is None or at >= since)]
    return normalize_vin(max(dated, key=lambda p: p[0])[1].get("vin")) if dated else None


async def watch_delivered_vehicle(db: DealerScopedDatabase, record: dict[str, Any]) -> dict[str, Any]:
    """SOLD - DELIVERED (called by scheduler/sold_lifecycles.start_ownership with A3's ownership record): the
    recall and maintenance monitors start watching the vehicle. A record with no VIN yet (the lead didn't carry
    one) gets it from the DealerVault deal when that arrives; until then there is nothing to look up."""
    if record.get("ownership_status") != OWNED or record.get("vehicle_source") != DEALER_SALE:
        return record
    records = db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION)
    vin = normalize_vin(record.get("vin"))
    if vin is None and not record.get("vin"):
        vin = await _vin_from_deal(db, record)
    if vin is None:
        return record
    now = clock.now()
    fields: dict[str, Any] = {"service_monitoring_at": now}
    if vin != record.get("vin"):
        fields["vin"] = vin
        fields["vin_source"] = "dealervault_deal" if not record.get("vin") else "normalized"
    await records.update_one({"_id": record["_id"]}, {"$set": fields})
    await register_vehicle(db.dealer_id, vin, customer_id=record.get("customer_id"), lead_id=record.get("lead_id"),
                           delivered_at=_aware(record.get("sold_delivered_at")), ownership_id=str(record["_id"]))
    return {**record, **fields}


async def discover_owned_vehicles(*, limit: int = 1000) -> dict[str, int]:
    """The catch-up behind watch_delivered_vehicle: A3's ACTIVE dealer-sale ownership records not yet watched
    (delivered before this was deployed, or whose VIN only arrived later with the DealerVault deal). Cross-dealer
    by design, like the Day 91 sweep (one query; each record is then handled through its own dealer's scope)."""
    rows = await get_db()[AI_VEHICLE_OWNERSHIP_COLLECTION].find(
        {"ownership_status": OWNED, "vehicle_source": DEALER_SALE,
         "service_monitoring_at": {"$exists": False}}).to_list(limit)
    found = {"checked": len(rows), "registered": 0, "no_vin": 0}
    for row in rows:
        if not row.get("dealer_id"):
            continue
        watched = await watch_delivered_vehicle(dealer_scoped_db(row["dealer_id"]), row)
        found["registered" if watched.get("service_monitoring_at") else "no_vin"] += 1
    return found


async def is_owned(dealer_id: str, vehicle: dict[str, Any]) -> bool:
    """§15 "every queued action re-checks ... ownership": asked of A3's ownership records right before each
    check and each event. Unknown (None) is not owned: no outreach."""
    owned = await ownership_port().vehicle_is_owned(dealer_id, vehicle["vin"], customer_id=vehicle.get("customer_id"))
    return owned is True


async def publish_first_service(db: DealerScopedDatabase, vehicle: dict[str, Any],
                                interval: dict[str, Any] | None) -> bool:
    """§4: the Day-3 check-in names the first recommended service only from the OEM schedule. Writes it to A3's
    ownership record (ownership.set_maintenance_facts); with no schedule interval nothing is written and the
    check-in offers service in words only."""
    module = _ownership_module()
    if module is None or not interval or not vehicle.get("ownership_id"):
        return False
    name = f"{', '.join(interval['service_items'])} at {interval['miles']:,} miles"
    return bool(await module.set_maintenance_facts(db, vehicle["ownership_id"], {"first_service": {
        "name": name, "interval_miles": interval["miles"], "service_items": interval["service_items"],
        "source": "OEM maintenance schedule (Vehicle Databases)"}}))
