"""NHTSA safety recall monitoring for owned vehicles (MASTER_PLAN_4 D6, stream A4; SOLD-DELIVERED PDF §6).

    VIN -> NHTSA Recall Check -> Applicable Open Safety Recall -> Customer Outreach -> Service Appointment

The PDF's rules, and how each is kept:
- "Recall workflow is independent of maintenance": its own collection (`ai_vehicle_recalls`), sweep and cadence;
  maintenance outreach waits for it, not the other way round (agent/maintenance.py).
- "Never claim a recall without VIN-specific authoritative support": NHTSA's public API only lists recalls for
  a year/make/model (integrations/nhtsa.py). Such a match is stored as `unverified` and raises a **staff
  notice only**: staff check the VIN (nhtsa.gov/recalls or the manufacturer's system) and confirm it (`open`)
  or mark it `not_applicable`. Only a VIN-confirmed open recall produces customer outreach.
- "Store recall identifier, description, detected date, status, source, and last-checked date": one document
  per dealer + VIN + NHTSA campaign number (`recall_id`, `description`, `detected_at`, `status`, `source`,
  `last_checked_at`, plus the component, consequence and remedy NHTSA gives).
- "Use cadence controls to avoid repetitive outreach": one outreach when the recall is confirmed, then at most
  RECALL_MAX_OUTREACH in all, RECALL_REMINDER_DAYS apart, each its own event key so none is raised twice.
- "Stop recall outreach if authoritative available data confirms completion/closure": `completed` (staff, or a
  dealer repair order for this VIN naming the campaign number) and `not_applicable` stop it for good, as does
  the vehicle no longer being owned (§8).
- "Do not represent NHTSA safety recalls as manufacturer service campaigns": the facts say source "NHTSA" and
  guardrails/service_claims.py rejects "service campaign" wording.

Client, 30 Sep 2026: "with those integrations we don't need to set up cadences because they alert the ai to
send a message/create a task" - an outreach here is a service outreach event (agent/service_events.py).
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import service_events
from upsell_agent.config import get_settings
from upsell_agent.integrations.mongodb import (
    AI_SERVICE_VEHICLES_COLLECTION,
    AI_VEHICLE_RECALLS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    DealerScopedDatabase,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.integrations.nhtsa import (
    SOURCE_RECALLS_BY_VEHICLE,
    SOURCE_VPIC,
    NhtsaClient,
    NhtsaError,
    Recall,
    get_nhtsa_client,
)

logger = logging.getLogger(__name__)

# Statuses.
UNVERIFIED = "unverified"  # NHTSA lists it for the model; not confirmed for this VIN -> staff notice only
OPEN = "open"  # confirmed for this VIN and not yet repaired -> customer outreach
COMPLETED = "completed"  # remedy done
NOT_APPLICABLE = "not_applicable"  # staff checked: this VIN isn't affected
CLOSED = frozenset({COMPLETED, NOT_APPLICABLE})
MATCH_MODEL, MATCH_VIN = "model", "vin"

RECALL_REMINDER_DAYS = 30
RECALL_MAX_OUTREACH = 3
# A failed NHTSA call is retried sooner than the normal re-check.
RETRY_AFTER_ERROR = timedelta(hours=6)


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def outreach_due(recall: dict[str, Any], now: datetime) -> tuple[bool, str]:
    """May the customer be told about this recall now? Pure; the cadence controls of §6."""
    if recall.get("status") != OPEN or recall.get("match_level") != MATCH_VIN:
        return False, "not a VIN-confirmed open recall"
    outreach = recall.get("outreach") or {}
    count = int(outreach.get("count") or 0)
    if count >= RECALL_MAX_OUTREACH:
        return False, f"already raised {count} times (the most allowed)"
    next_at = _aware(outreach.get("next_allowed_at"))
    if next_at and now < next_at:
        return False, f"next reminder not before {next_at.date().isoformat()}"
    return True, "first outreach" if count == 0 else f"reminder {count + 1} of {RECALL_MAX_OUTREACH}"


def recall_facts(vehicle: dict[str, Any], recall: dict[str, Any], *, reminder: bool) -> dict[str, Any]:
    """What an outreach message may state about the recall - nothing else (guardrails/service_claims.py)."""
    return {
        "kind": "recall", "source": "NHTSA", "vin_confirmed": True, "reminder": reminder,
        "recall_id": recall["recall_id"], "component": recall.get("component"),
        "description": recall.get("description"), "remedy": recall.get("remedy"),
        "vehicle": service_events.vehicle_label(vehicle), "year": vehicle.get("year"),
    }


def _ro_text(ro: dict[str, Any]) -> str:
    parts: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)

    walk({k: v for k, v in ro.items() if k != "_id"})
    return " ".join(parts).upper()


async def _close_from_repair_orders(db: DealerScopedDatabase, vin: str, recalls: list[dict], now: datetime) -> int:
    """A dealer repair order for this VIN that names the campaign number is VIN-specific evidence the remedy
    was done (§6 "authoritative available data confirms completion")."""
    pending = [r for r in recalls if r.get("status") not in CLOSED]
    if not pending:
        return 0
    ros = await db.collection(PLATFORM_REPAIR_ORDERS_COLLECTION).find({"vin": vin}).to_list(500)
    closed = 0
    for ro in ros:
        text = _ro_text(ro)
        for recall in pending:
            if recall.get("status") in CLOSED or recall["recall_id"].upper() not in text:
                continue
            await db.collection(AI_VEHICLE_RECALLS_COLLECTION).update_one(
                {"vin": vin, "recall_id": recall["recall_id"]},
                {"$set": {"status": COMPLETED, "closed_at": now, "closed_reason": "repair_order",
                          "closed_source": {"type": "repair_order", "ro_number": ro.get("ro_number")}}})
            recall["status"] = COMPLETED
            closed += 1
    return closed


async def _maybe_outreach(db: DealerScopedDatabase, vehicle: dict[str, Any], recall: dict[str, Any],
                          now: datetime) -> dict[str, Any] | None:
    due, why = outreach_due(recall, now)
    if not due:
        return None
    if not await service_events.is_owned(db.dealer_id, vehicle):
        return None
    count = int((recall.get("outreach") or {}).get("count") or 0) + 1
    label = service_events.vehicle_label(vehicle)
    event = await service_events.record_event(
        db, vehicle, event_type=service_events.RECALL_DETECTED,
        event_key=f"recall:{vehicle['vin']}:{recall['recall_id']}:{count}",
        facts=recall_facts(vehicle, recall, reminder=count > 1),
        summary=(f"Open safety recall {recall['recall_id']} ({recall.get('component') or 'see NHTSA'}) is confirmed "
                 f"for this customer's {label} (VIN {vehicle['vin']}): offer a service visit ({why})."),
        customer_facing=True)
    outreach = {"count": count, "last_at": now, "next_allowed_at": now + timedelta(days=RECALL_REMINDER_DAYS)}
    await db.collection(AI_VEHICLE_RECALLS_COLLECTION).update_one(
        {"vin": vehicle["vin"], "recall_id": recall["recall_id"]}, {"$set": {"outreach": outreach}})
    recall["outreach"] = outreach
    return event


async def _decode(db: DealerScopedDatabase, vehicle: dict[str, Any], client: NhtsaClient,
                  now: datetime) -> dict[str, Any] | str:
    """The vehicle with year/make/model from vPIC (decoded once and kept), or why it can't be looked up."""
    if (vehicle.get("decoded") or {}).get("usable"):
        return vehicle
    decoded = await client.decode_vin(vehicle["vin"])
    fields: dict[str, Any] = {"decoded": {"source": SOURCE_VPIC, "at": now, "usable": decoded.usable,
                                          "error_code": decoded.error_code, "error_text": decoded.error_text,
                                          "trim": decoded.trim}}
    if decoded.usable:
        fields.update(year=decoded.year, make=decoded.make, model=decoded.model)
    await db.collection(AI_SERVICE_VEHICLES_COLLECTION).update_one({"vin": vehicle["vin"]}, {"$set": fields})
    vehicle = {**vehicle, **fields}
    if not decoded.usable:
        await service_events.record_event(
            db, vehicle, event_type=service_events.RECALL_REVIEW, event_key=f"vin_undecodable:{vehicle['vin']}",
            facts={}, customer_facing=False,
            summary=(f"NHTSA couldn't decode VIN {vehicle['vin']} ({decoded.error_text or decoded.error_code}), so "
                     "safety recalls aren't being checked for this vehicle. Please check the VIN on the record."))
        return f"VIN didn't decode: {decoded.error_text or decoded.error_code}"
    return vehicle


async def check_vehicle(dealer_id: str, vehicle: dict[str, Any], *, client: NhtsaClient | None = None,
                        now: datetime | None = None) -> dict[str, Any]:
    """One vehicle's recall check: NHTSA lookup, store/refresh its recalls, close what's done, raise what's due."""
    client = client or get_nhtsa_client()
    now = now or clock.now()
    db = dealer_scoped_db(dealer_id)
    vin = vehicle["vin"]
    vehicles = db.collection(AI_SERVICE_VEHICLES_COLLECTION)
    next_check = now + timedelta(days=get_settings().recall_recheck_days)
    out: dict[str, Any] = {"vin": vin, "new": 0, "closed": 0, "outreach": 0}

    async def finish(result: str, next_at: datetime = next_check, **extra: Any) -> dict[str, Any]:
        await vehicles.update_one({"vin": vin}, {"$set": {
            "recalls_next_check_at": next_at,
            "recall_check": {"at": now, "result": result, **extra}}})
        return {**out, "result": result, **extra}

    if not await service_events.is_owned(dealer_id, vehicle):
        return await finish("not_owned")
    try:
        decoded = await _decode(db, vehicle, client, now)
        if isinstance(decoded, str):
            return await finish("vin_not_decodable", detail=decoded)
        vehicle = decoded
        found = await client.recalls_by_vehicle(vehicle["make"], vehicle["model"], int(vehicle["year"]))
    except NhtsaError as exc:
        logger.warning("recall check for %s failed: %s", vin, exc)
        return await finish("error", now + RETRY_AFTER_ERROR, detail=str(exc))

    recalls = db.collection(AI_VEHICLE_RECALLS_COLLECTION)
    new_ids: list[str] = []
    for item in found:
        result = await recalls.update_one({"vin": vin, "recall_id": item.recall_id}, {
            "$setOnInsert": {"vin": vin, "recall_id": item.recall_id, "detected_at": now, "status": UNVERIFIED,
                             "match_level": MATCH_MODEL, "source": SOURCE_RECALLS_BY_VEHICLE},
            "$set": _recall_fields(item, now),
        }, upsert=True)
        if result.upserted_id is not None:
            new_ids.append(item.recall_id)
    out["new"] = len(new_ids)
    if new_ids:
        await service_events.record_event(
            db, vehicle, event_type=service_events.RECALL_REVIEW,
            event_key=f"recall_review:{vin}:{','.join(sorted(new_ids))}", customer_facing=False,
            facts={"recall_ids": sorted(new_ids), "match_level": MATCH_MODEL, "source": "NHTSA"},
            summary=(f"NHTSA lists {len(new_ids)} safety recall(s) for {service_events.vehicle_label(vehicle)} "
                     f"models ({', '.join(sorted(new_ids))}). NHTSA's public data can't confirm them for this VIN "
                     f"({vin}): check the VIN at nhtsa.gov/recalls or with the manufacturer, then confirm each one "
                     "or mark it not applicable. The customer is not contacted until a recall is confirmed."))

    stored = await recalls.find({"vin": vin}).to_list(500)
    out["closed"] = await _close_from_repair_orders(db, vin, stored, now)
    for recall in stored:
        if await _maybe_outreach(db, vehicle, recall, now):
            out["outreach"] += 1
    return await finish("checked", listed=len(found))


def _recall_fields(item: Recall, now: datetime) -> dict[str, Any]:
    return {"description": item.summary, "component": item.component, "consequence": item.consequence,
            "remedy": item.remedy, "manufacturer": item.manufacturer, "report_received_at": item.report_received,
            "last_checked_at": now, "nhtsa_listed": True}


async def sweep(now: datetime | None = None, *, client: NhtsaClient | None = None) -> dict[str, Any]:
    """The periodic sweep (worker/jobs.py): register newly delivered vehicles, then check the ones whose
    re-check is due, oldest first, at most RECALL_SWEEP_BATCH per run. Cross-dealer by design."""
    settings = get_settings()
    if not settings.nhtsa_recalls_enabled:
        return {"status": "disabled"}
    now = now or clock.now()
    discovered = await service_events.discover_owned_vehicles()
    rows = await get_db()[AI_SERVICE_VEHICLES_COLLECTION].find(
        {"ownership_status": service_events.OWNED, "recalls_next_check_at": {"$lte": now}}
    ).sort("recalls_next_check_at", 1).to_list(settings.recall_sweep_batch)
    summary: dict[str, Any] = {"discovered": discovered, "checked": 0, "new": 0, "outreach": 0, "errors": 0}
    for row in rows:
        try:
            result = await check_vehicle(row["dealer_id"], row, client=client, now=now)
        except Exception:
            logger.exception("recall check crashed for %s", row.get("vin"))
            summary["errors"] += 1
            continue
        summary["checked"] += 1
        summary["new"] += result.get("new", 0)
        summary["outreach"] += result.get("outreach", 0)
        summary["errors"] += result.get("result") == "error"
    return summary


# --- Staff actions (api/service_vehicles.py) ------------------------------------------------------------------

async def confirm(dealer_id: str, vin: str, recall_id: str, *, by: str | None = None,
                  note: str | None = None) -> dict[str, Any] | None:
    """Staff checked the VIN and the recall applies, unrepaired: it becomes VIN-confirmed and the customer
    outreach is raised straight away (if the vehicle is owned and the cadence allows)."""
    db = dealer_scoped_db(dealer_id)
    recalls = db.collection(AI_VEHICLE_RECALLS_COLLECTION)
    recall = await recalls.find_one({"vin": vin, "recall_id": recall_id})
    if recall is None:
        return None
    if recall.get("status") in CLOSED:
        return recall
    now = clock.now()
    fields = {"status": OPEN, "match_level": MATCH_VIN,
              "vin_confirmation": {"by": by, "at": now, "note": note, "source": "staff_vin_check"}}
    await recalls.update_one({"_id": recall["_id"]}, {"$set": fields})
    recall.update(fields)
    vehicle = await db.collection(AI_SERVICE_VEHICLES_COLLECTION).find_one({"vin": vin})
    if vehicle:
        await _maybe_outreach(db, vehicle, recall, now)
    return await recalls.find_one({"_id": recall["_id"]})


async def close(dealer_id: str, vin: str, recall_id: str, *, reason: str, by: str | None = None,
                note: str | None = None) -> dict[str, Any] | None:
    """Staff: the remedy was done (`completed`) or the VIN isn't affected (`not_applicable`). Stops outreach."""
    if reason not in CLOSED:
        raise ValueError(f"reason must be one of {sorted(CLOSED)}")
    recalls = dealer_scoped_db(dealer_id).collection(AI_VEHICLE_RECALLS_COLLECTION)
    recall = await recalls.find_one({"vin": vin, "recall_id": recall_id})
    if recall is None:
        return None
    await recalls.update_one({"_id": recall["_id"]}, {"$set": {
        "status": reason, "closed_at": clock.now(), "closed_reason": reason,
        "closed_source": {"type": "staff", "by": by, "note": note}}})
    return await recalls.find_one({"_id": recall["_id"]})
