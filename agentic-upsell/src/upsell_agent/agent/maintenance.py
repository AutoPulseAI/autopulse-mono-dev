"""Maintenance reminders from the OEM schedule (MASTER_PLAN_4 D5, stream A4; SOLD-DELIVERED PDF §5).

    VIN -> Vehicle Database -> Applicable Maintenance Schedule -> Known Mileage and/or Time
        -> Recommended Service Due -> Outreach -> Service Appointment

The schedule comes from Vehicle Databases (integrations/vehicle_databases.py; client, 1 Oct 2026), fetched
once per VIN and kept on the vehicle. The PDF's rules, and how each is kept:
- "Use verified mileage when available": odometer readings from the dealer's own records only - repair orders
  ("Mileage Out", else "RO Mileage", at the RO's date), deals ("Delivery Mileage", else "Mileage", at the
  contract date) - and readings staff enter. A reading counts as current for MILEAGE_CURRENT_DAYS.
- "If reliable current mileage is unavailable, use applicable time-based intervals and never present estimated
  mileage as known actual mileage": nothing here ever estimates a mileage. Without a current reading the basis
  is time since the last service visit (or delivery), MAINTENANCE_TIME_INTERVAL_MONTHS, and the outreach facts
  carry no mileage and no specific service items, since without mileage we can't know which ones are due.
- "Never invent maintenance requirements": the service items are the schedule's own, word for word; no
  schedule (Vehicle Databases off, or no record for the VIN) means no maintenance outreach at all.
- "Completed service, outside service, or updated mileage should update/recalculate the workflow": a new
  repair order, or staff recording a service done elsewhere or a new reading (record_service / record_mileage),
  recalculates at once; each due service is raised once (its own event key), so a recalculation never
  repeats an alert.

Event-driven, not a cadence (client, 30 Sep 2026: "with those integrations we don't need to set up cadences
because they alert the ai to send a message/create a task"): a due service raises one service outreach
event (agent/service_events.py). A recall outreach for the same vehicle in the last
SERVICE_OUTREACH_GAP_DAYS holds it back, so the two never compete for the customer's attention (D6).

Whichever comes first (client, 8 Oct 2026): with a current reading short of the next service, the time since the
last visit still makes it due once it reaches the interval's months (MAINTENANCE_TIME_INTERVAL_MONTHS when the
schedule has none).

A dealer service visit at or past a schedule mileage counts as that service done: repair-order operations
aren't matched against the OEM's item list (decision, stream A4).
"""

import logging
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import service_events
from upsell_agent.config import get_settings
from upsell_agent.integrations.customer360 import get_deal_date, get_repair_order_date
from upsell_agent.integrations.mongodb import (
    AI_SERVICE_VEHICLES_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.integrations.vehicle_databases import (
    SOURCE,
    MaintenanceSchedule,
    VehicleDatabasesClient,
    VehicleDatabasesError,
    get_vehicle_databases_client,
    schedule_from_dict,
)

logger = logging.getLogger(__name__)

# A service counts as due this many miles before its schedule mileage, and a visit this close to (or past) it
# counts as having done it.
DUE_WINDOW_MILES = 1000
# A reading older than this is not "reliable current mileage" (§5).
MILEAGE_CURRENT_DAYS = 120
SCHEDULE_REFRESH = timedelta(days=180)
NO_RECORD_RETRY = timedelta(days=30)
RECHECK = timedelta(days=1)

RO_MILEAGE_FIELDS = ("Mileage Out", "RO Mileage")
DEAL_MILEAGE_FIELDS = ("Delivery Mileage", "Mileage")
BASIS_MILEAGE, BASIS_TIME = "mileage", "time"


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _miles(value: Any) -> int | None:
    try:
        miles = int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return None
    return miles if 0 < miles < 1_000_000 else None


@dataclass(frozen=True)
class Reading:
    """An odometer reading from a record: verified, never estimated."""
    miles: int
    observed_at: datetime
    source: str  # repair_order | deal | staff
    ref: str | None = None


@dataclass(frozen=True)
class ServiceVisit:
    at: datetime
    miles: int | None
    source: str  # repair_order | outside_service | staff
    ref: str | None = None


def readings_and_visits(deals: list[dict], repair_orders: list[dict],
                        vehicle: dict[str, Any]) -> tuple[list[Reading], list[ServiceVisit]]:
    readings: list[Reading] = []
    visits: list[ServiceVisit] = []
    for ro in repair_orders:
        at = get_repair_order_date(ro)
        if not at:
            continue
        miles = next((m for f in RO_MILEAGE_FIELDS if (m := _miles(ro.get(f)))), None)
        if miles:
            readings.append(Reading(miles, at, "repair_order", ro.get("ro_number")))
        visits.append(ServiceVisit(at, miles, "repair_order", ro.get("ro_number")))
    for deal in deals:
        at = get_deal_date(deal)
        miles = next((m for f in DEAL_MILEAGE_FIELDS if (m := _miles(deal.get(f)))), None)
        if at and miles:
            readings.append(Reading(miles, at, "deal", deal.get("deal_number")))
    for report in vehicle.get("mileage_reports") or []:
        at, miles = _aware(report.get("observed_at")), _miles(report.get("miles"))
        if at and miles:
            readings.append(Reading(miles, at, "staff", report.get("by")))
    for report in vehicle.get("service_reports") or []:
        if at := _aware(report.get("at")):
            miles = _miles(report.get("miles"))
            visits.append(ServiceVisit(at, miles, "outside_service" if report.get("outside") else "staff",
                                       report.get("by")))
            if miles:
                readings.append(Reading(miles, at, "staff", report.get("by")))
    return readings, visits


def _months_between(start: datetime, end: datetime) -> int:
    months = (end.year - start.year) * 12 + end.month - start.month
    return months - (1 if end.day < start.day else 0)


def compute_status(schedule: MaintenanceSchedule | None, readings: list[Reading], visits: list[ServiceVisit], *,
                   delivered_at: datetime | None, now: datetime, time_interval_months: int) -> dict[str, Any]:
    """Where the vehicle stands against its schedule. Pure. `due` is set when a service is due now, with the
    `due_key` that makes it one alert, and the `facts` the outreach may state."""
    if schedule is None:
        return {"status": "no_schedule", "basis": None, "due": None,
                "reason": "no OEM schedule for this vehicle: no maintenance outreach (§5 never invent)"}
    latest = max(readings, key=lambda r: (r.observed_at, r.miles), default=None)
    current = latest if latest and (now - latest.observed_at).days <= MILEAGE_CURRENT_DAYS else None
    last_visit = max(visits, key=lambda v: v.at, default=None)
    # The schedule starts from the mileage we sold the vehicle at: services a used vehicle passed before its
    # delivery aren't chased (the first service offer after delivery is D4's Day-3 check-in).
    done_through = max([v.miles for v in visits if v.miles] + [r.miles for r in readings if r.source == "deal"],
                       default=0)
    out: dict[str, Any] = {
        "current_mileage": ({**asdict(current), "observed_at": current.observed_at, "verified": True}
                            if current else None),
        "latest_mileage": {**asdict(latest), "verified": True} if latest else None,
        "last_service": asdict(last_visit) if last_visit else None,
        "serviced_through_miles": done_through or None,
    }
    if current:
        passed = [i for i in schedule.intervals
                  if done_through + DUE_WINDOW_MILES < i.miles <= current.miles + DUE_WINDOW_MILES]
        upcoming = next((i for i in schedule.intervals if i.miles > max(current.miles, done_through) + DUE_WINDOW_MILES),
                        None)
        out["next_service"] = upcoming.as_dict() if upcoming else None
        out["basis"] = BASIS_MILEAGE
        if not passed:
            # Client, 8 Oct 2026: "it's whichever one comes first" - a car driven little still needs its service
            # when the months run out (the interval's own months when the schedule gives them, else the setting).
            anchor = last_visit.at if last_visit else delivered_at
            limit = (upcoming.months if upcoming and upcoming.months else time_interval_months)
            if anchor is not None and upcoming and _months_between(anchor, now) >= limit:
                months = _months_between(anchor, now)
                out.update(status="due", basis=BASIS_TIME,
                           reason=f"{months} month(s) since {anchor.date().isoformat()} reach the {limit}-month "
                                  f"limit before the {upcoming.miles:,}-mile service (whichever comes first)",
                           due={"due_key": f"time:{anchor.date().isoformat()}", "basis": BASIS_TIME,
                                "interval": upcoming.as_dict(),
                                "facts": {"kind": "maintenance", "basis": BASIS_TIME,
                                          "source": "OEM maintenance schedule (Vehicle Databases)",
                                          "service": f"{upcoming.miles:,}-mile service ({', '.join(upcoming.items)})"
                                                     f" - due by time first ({months} months since the last visit)",
                                          "service_items": list(upcoming.items), "interval_miles": upcoming.miles,
                                          "verified_mileage": {"miles": current.miles,
                                                               "observed_at": current.observed_at.date().isoformat(),
                                                               "source": current.source},
                                          "mileage_is_estimate": False, "months_since_last_visit": months,
                                          "last_visit_date": anchor.date().isoformat(),
                                          "last_visit_was": "delivery" if not last_visit else "service visit"}})
                return out
            out.update(status="not_due" if upcoming else "schedule_complete", due=None,
                       reason=(f"next service at {upcoming.miles:,} miles; verified {current.miles:,}" if upcoming
                               else "past the end of the OEM schedule"))
            return out
        due = passed[-1]  # the latest one reached covers the earlier missed ones
        out.update(status="due", reason=f"verified mileage {current.miles:,} reaches the {due.miles:,}-mile service",
                   due={"due_key": f"mileage:{due.miles}", "basis": BASIS_MILEAGE, "interval": due.as_dict(),
                        "facts": {"kind": "maintenance", "basis": BASIS_MILEAGE,
                                  "source": "OEM maintenance schedule (Vehicle Databases)",
                                  "service": f"{due.miles:,}-mile service ({', '.join(due.items)})",
                                  "service_items": list(due.items), "interval_miles": due.miles,
                                  "verified_mileage": {"miles": current.miles,
                                                       "observed_at": current.observed_at.date().isoformat(),
                                                       "source": current.source},
                                  "mileage_is_estimate": False}})
        return out

    # §5: no reliable current mileage -> time-based, never an estimated mileage.
    anchor = last_visit.at if last_visit else delivered_at
    out["basis"] = BASIS_TIME
    out["next_service"] = None
    if anchor is None:
        out.update(status="unknown", due=None, reason="no current mileage, no service visit and no delivery date")
        return out
    months = _months_between(anchor, now)
    if months < time_interval_months:
        out.update(status="not_due", due=None,
                   reason=f"no current mileage; {months} month(s) since {anchor.date().isoformat()} "
                          f"(time-based check at {time_interval_months})")
        return out
    out.update(status="due", reason=f"no current mileage; {months} month(s) since the last visit",
               due={"due_key": f"time:{anchor.date().isoformat()}", "basis": BASIS_TIME, "interval": None,
                    "facts": {"kind": "maintenance", "basis": BASIS_TIME,
                              "source": "time since the last service visit",
                              "service": f"next service visit (it has been {months} months since the last one)",
                              "service_items": [], "interval_miles": None, "verified_mileage": None,
                              "mileage_is_estimate": False, "months_since_last_visit": months,
                              "last_visit_date": anchor.date().isoformat(),
                              "last_visit_was": "delivery" if not last_visit else "service visit"}})
    return out


async def _schedule(db, vehicle: dict[str, Any], client: VehicleDatabasesClient, now: datetime) -> tuple[
        MaintenanceSchedule | None, str | None]:
    """The stored schedule, fetched (or refreshed) when Vehicle Databases is on. (schedule, problem)."""
    stored = vehicle.get("maintenance_schedule") or {}
    fetched_at = _aware(stored.get("fetched_at"))
    schedule = schedule_from_dict(stored.get("schedule"))
    if not client.enabled:
        return schedule, None if schedule else "Vehicle Databases is off (VEHICLE_DATABASES_ENABLED)"
    stale = fetched_at is None or now - fetched_at > (SCHEDULE_REFRESH if schedule else NO_RECORD_RETRY)
    if not stale:
        return schedule, None if schedule else "Vehicle Databases has no schedule for this VIN"
    try:
        fresh = await client.maintenance_schedule(vehicle["vin"])
    except VehicleDatabasesError as exc:
        logger.warning("maintenance schedule for %s failed: %s", vehicle["vin"], exc)
        return schedule, f"Vehicle Databases: {exc}"
    await db.collection(AI_SERVICE_VEHICLES_COLLECTION).update_one({"vin": vehicle["vin"]}, {"$set": {
        "maintenance_schedule": {"source": SOURCE, "fetched_at": now,
                                 "schedule": fresh.as_dict() if fresh else None}}})
    return fresh, None if fresh else "Vehicle Databases has no schedule for this VIN"


async def check_vehicle(dealer_id: str, vehicle: dict[str, Any], *, client: VehicleDatabasesClient | None = None,
                        now: datetime | None = None) -> dict[str, Any]:
    """Recalculates one vehicle's maintenance status and raises the due service, once."""
    client = client or get_vehicle_databases_client()
    now = now or clock.now()
    db = dealer_scoped_db(dealer_id)
    vin = vehicle["vin"]
    vehicles = db.collection(AI_SERVICE_VEHICLES_COLLECTION)

    async def finish(status: dict[str, Any], event: dict | None = None) -> dict[str, Any]:
        stored = {**status, "calculated_at": now}
        await vehicles.update_one({"vin": vin}, {"$set": {"maintenance": stored,
                                                          "maintenance_next_check_at": now + RECHECK}})
        return {**status, "vin": vin, "event": bool(event)}

    if not await service_events.is_owned(dealer_id, vehicle):
        return await finish({"status": "not_owned", "due": None, "reason": "vehicle not currently owned"})
    schedule, problem = await _schedule(db, vehicle, client, now)
    deals = await db.collection(PLATFORM_DEALS_COLLECTION).find({"vin": vin}).to_list(200)
    ros = await db.collection(PLATFORM_REPAIR_ORDERS_COLLECTION).find({"vin": vin}).to_list(500)
    readings, visits = readings_and_visits(deals, ros, vehicle)
    status = compute_status(schedule, readings, visits, delivered_at=_aware(vehicle.get("delivered_at")), now=now,
                            time_interval_months=get_settings().maintenance_time_interval_months)
    if problem:
        status["schedule_problem"] = problem
    due = status.get("due")
    # §4: the Day-3 check-in may name the first recommended service - the due one, else the next one - only
    # from the OEM schedule and a verified mileage (never on the time basis, which knows no service items).
    if status.get("basis") == BASIS_MILEAGE:
        await service_events.publish_first_service(db, vehicle, (due or {}).get("interval") or status.get("next_service"))
    if not due:
        return await finish(status)
    recall_at = await service_events.last_customer_event_at(db, vin, service_events.RECALL_DETECTED)
    if recall_at and now - recall_at < timedelta(days=service_events.SERVICE_OUTREACH_GAP_DAYS):
        status["held_back"] = "a recall outreach for this vehicle went out recently"
        return await finish(status)
    label = service_events.vehicle_label(vehicle)
    what = (", ".join(due["facts"]["service_items"]) + f" at {due['facts']['interval_miles']:,} miles"
            if due["basis"] == BASIS_MILEAGE else
            f"{', '.join(due['facts']['service_items'])} - {due['facts']['months_since_last_visit']} months since "
            f"the last visit came first, before {due['facts']['interval_miles']:,} miles"
            if due["facts"].get("interval_miles") else
            f"{due['facts']['months_since_last_visit']} months since the last visit, no current mileage on record")
    event = await service_events.record_event(
        db, vehicle, event_type=service_events.MAINTENANCE_DUE, event_key=f"maintenance:{vin}:{due['due_key']}",
        facts={**due["facts"], "vehicle": label, "year": vehicle.get("year")}, customer_facing=True,
        summary=f"Scheduled maintenance is due for this customer's {label} ({what}): offer a service visit.")
    return await finish(status, event)


async def sweep(now: datetime | None = None, *, client: VehicleDatabasesClient | None = None,
                limit: int = 200) -> dict[str, Any]:
    """Daily recalculation for owned vehicles (cheap: the schedule is stored; new repair orders arrive through
    DealerVault). Cross-dealer by design."""
    now = now or clock.now()
    discovered = await service_events.discover_owned_vehicles()
    rows = await get_db()[AI_SERVICE_VEHICLES_COLLECTION].find(
        {"ownership_status": service_events.OWNED, "maintenance_next_check_at": {"$lte": now}}
    ).sort("maintenance_next_check_at", 1).to_list(limit)
    summary: dict[str, Any] = {"discovered": discovered, "checked": 0, "due": 0, "events": 0, "errors": 0}
    for row in rows:
        try:
            result = await check_vehicle(row["dealer_id"], row, client=client, now=now)
        except Exception:
            logger.exception("maintenance check crashed for %s", row.get("vin"))
            summary["errors"] += 1
            continue
        summary["checked"] += 1
        summary["due"] += result.get("status") == "due"
        summary["events"] += bool(result.get("event"))
    return summary


# --- Updates that recalculate (api/service_vehicles.py) ------------------------------------------------------

async def record_mileage(dealer_id: str, vin: str, *, miles: int, observed_at: datetime | None = None,
                         by: str | None = None, client: VehicleDatabasesClient | None = None) -> dict | None:
    """Staff entered a current odometer reading: stored as verified, then recalculated (§5)."""
    db = dealer_scoped_db(dealer_id)
    vehicles = db.collection(AI_SERVICE_VEHICLES_COLLECTION)
    report = {"miles": int(miles), "observed_at": observed_at or clock.now(), "by": by, "recorded_at": clock.now()}
    result = await vehicles.update_one({"vin": vin}, {"$push": {"mileage_reports": {"$each": [report],
                                                                                   "$slice": -50}}})
    if not result.matched_count:
        return None
    return await check_vehicle(dealer_id, await vehicles.find_one({"vin": vin}), client=client)


async def record_service(dealer_id: str, vin: str, *, at: datetime | None = None, miles: int | None = None,
                         outside: bool = False, by: str | None = None, note: str | None = None,
                         client: VehicleDatabasesClient | None = None) -> dict | None:
    """A service done here (not yet in DealerVault) or elsewhere ("outside service", §5): recalculated."""
    db = dealer_scoped_db(dealer_id)
    vehicles = db.collection(AI_SERVICE_VEHICLES_COLLECTION)
    report = {"at": at or clock.now(), "miles": miles, "outside": outside, "by": by, "note": note,
              "recorded_at": clock.now()}
    result = await vehicles.update_one({"vin": vin}, {"$push": {"service_reports": {"$each": [report],
                                                                                   "$slice": -50}}})
    if not result.matched_count:
        return None
    return await check_vehicle(dealer_id, await vehicles.find_one({"vin": vin}), client=client)
