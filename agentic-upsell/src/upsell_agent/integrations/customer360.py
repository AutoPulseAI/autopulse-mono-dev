"""Customer 360 assembled straight from the platform's collections.

A faithful Python port of aidmvcs-be-dev's
app/api/customers/[id]/360/route.js + assemble.js (MASTER_PLAN_1 Stage 6).
The stub platform client uses it so that stub and live return the same
fields for the same customer: the only difference is who runs the queries.
`python -m upsell_agent.devtools.compare_360` checks that they agree.

Keep this in step with the route. If the route gains a field, add it here
and the comparison tool will say so until you do.

Deal / RepairOrder / ServiceAppointment are `strict: false` mirrors of
DealerTrack TSV exports, so their fields are literal, space-containing
column names ("Contract Date", "Sales Price", ...) and dates are loose
"M/D/YYYY" strings.
"""

import re
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from bson import ObjectId

from upsell_agent.integrations.mongodb import (
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    PLATFORM_SERVICE_APPOINTMENTS_COLLECTION,
    PLATFORM_TRADE_INS_COLLECTION,
    PLATFORM_VEHICLES_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)

RECORD_LIMIT = 500

DEAL_DATE_FIELD = "Contract Date"
DEAL_PRICE_FIELD = "Sales Price"
SALESMAN_NAME_FIELDS = ["Salesman 1 Name", "Salesman 2 Name", "Salesman 3 Name"]
RO_DATE_FIELDS = ["Close Date", "Open Date"]
RO_TOTAL_FIELDS = {"total_sale": "Total Sale", "customer_total_sale": "Customer Total Sale"}
APPOINTMENT_DATE_FIELD = "Appointment Date"
APPOINTMENT_TIME_FIELD = "Appointment Time"

_MDY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s*$")
_TIME = re.compile(r"^(\d{1,2}):(\d{2})\s*(AM|PM)?$", re.IGNORECASE)

EMPTY_360: dict[str, Any] = {
    "customer": None, "value_snapshot": {}, "overview": [], "leads": [], "deals": [], "repair_orders": [],
    "appointments": [], "all_appointments": [], "vehicles": [], "trade_ins": [],
}


# --- assemble.js helpers -----------------------------------------------------

def parse_loose_date(value: Any) -> datetime | None:
    """JS `new Date("9/8/2026")`: month/day/year at midnight, with the same
    overflow ("2/30/2026" is March 2). Returned as UTC midnight."""
    if not isinstance(value, str) or not value.strip():
        return None
    match = _MDY.match(value)
    if match:
        month, day, year = (int(g) for g in match.groups())
        if year < 100:
            year += 2000 if year < 50 else 1900
        if not 1 <= month <= 12 or not 1 <= day <= 31:
            return None
        base = date(year, month, 1)
        return datetime.combine(base + timedelta(days=day - 1), time(), tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _parse_time_of_day(value: Any) -> tuple[int, int] | None:
    if not isinstance(value, str):
        return None
    match = _TIME.match(value.strip())
    if not match:
        return None
    hours, minutes, meridiem = int(match.group(1)), int(match.group(2)), (match.group(3) or "").upper()
    if meridiem == "PM" and hours < 12:
        hours += 12
    if meridiem == "AM" and hours == 12:
        hours = 0
    if hours > 23 or minutes > 59:
        return None
    return hours, minutes


def _parse_amount(value: Any) -> float | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        amount = float(value.replace(",", ""))
    except ValueError:
        return None
    return int(amount) if amount.is_integer() else amount


def get_deal_date(deal: dict) -> datetime | None:
    return parse_loose_date((deal or {}).get(DEAL_DATE_FIELD))


def get_deal_price(deal: dict) -> float | None:
    return _parse_amount((deal or {}).get(DEAL_PRICE_FIELD))


def get_deal_salesperson(deal: dict) -> str | None:
    names: list[str] = []
    for field in SALESMAN_NAME_FIELDS:
        name = (deal or {}).get(field)
        if name and name not in names:
            names.append(name)
    return " / ".join(names) if names else None


def get_repair_order_date(ro: dict) -> datetime | None:
    for field in RO_DATE_FIELDS:
        parsed = parse_loose_date((ro or {}).get(field))
        if parsed:
            return parsed
    return None


def get_repair_order_totals(ro: dict) -> dict[str, float | None]:
    return {key: _parse_amount((ro or {}).get(field)) for key, field in RO_TOTAL_FIELDS.items()}


def get_appointment_date(appointment: dict) -> datetime | None:
    parsed = parse_loose_date((appointment or {}).get(APPOINTMENT_DATE_FIELD))
    if not parsed:
        return None
    clock_time = _parse_time_of_day((appointment or {}).get(APPOINTMENT_TIME_FIELD))
    if clock_time:
        parsed = parsed.replace(hour=clock_time[0], minute=clock_time[1])
    return parsed


def dedupe_service_timeline(repair_orders: list[dict], appointments: list[dict]) -> list[dict]:
    """An appointment that converted into an RO (same ro_number) is hidden, so
    one visit isn't listed twice."""
    converted = {ro.get("ro_number") for ro in repair_orders if ro.get("ro_number")}
    return [a for a in appointments if not a.get("ro_number") or a.get("ro_number") not in converted]


def derive_vehicle_owners(deals: list[dict], repair_orders: list[dict], appointments: list[dict]) -> dict[str, dict]:
    """Current owner of each VIN = customer on the most recent record for that
    VIN across all three collections, dealer-wide."""
    latest: dict[str, dict] = {}

    def consider(records: list[dict], get_date) -> None:
        for record in records:
            vin, customer_id = record.get("vin"), record.get("customer_id")
            if not vin or not customer_id:
                continue
            at = get_date(record)
            current = latest.get(vin)
            if not current or (at and (not current["at"] or at > current["at"])):
                latest[vin] = {"customer_id": customer_id, "at": at or (current or {}).get("at")}

    consider(deals, get_deal_date)
    consider(repair_orders, get_repair_order_date)
    consider(appointments, get_appointment_date)
    return latest


def build_overview_feed(leads, deals, repair_orders, appointments, assignments) -> list[dict]:
    entries = (
        [{"type": "lead", "at": _as_datetime(lead.get("createdAt")), "record": lead} for lead in leads]
        + [{"type": "deal", "at": get_deal_date(d), "record": d} for d in deals]
        + [{"type": "repair_order", "at": get_repair_order_date(r), "record": r} for r in repair_orders]
        + [{"type": "appointment", "at": get_appointment_date(a), "record": a} for a in appointments]
        + [{"type": "assignment", "at": _as_datetime(e.get("assigned_at")), "record": e} for e in assignments]
    )
    dated = sorted((e for e in entries if e["at"]), key=lambda e: e["at"], reverse=True)
    return dated + [e for e in entries if not e["at"]]


def build_value_snapshot(leads, deals, repair_orders, appointments) -> dict[str, Any]:
    all_dates = [d for d in (
        [_as_datetime(lead.get("createdAt")) for lead in leads]
        + [get_deal_date(d) for d in deals]
        + [get_repair_order_date(r) for r in repair_orders]
        + [get_appointment_date(a) for a in appointments]
    ) if d]
    return {
        "total_deal_price": sum(get_deal_price(d) or 0 for d in deals),
        "total_repair_order_sale": sum(get_repair_order_totals(r)["total_sale"] or 0 for r in repair_orders),
        "total_repair_order_customer_sale": sum(get_repair_order_totals(r)["customer_total_sale"] or 0
                                                for r in repair_orders),
        "last_activity_at": max(all_dates) if all_dates else None,
    }


def get_origin_badge(customer: dict, has_linked_leads: bool) -> str:
    numbers = (((customer or {}).get("extra") or {}).get("dealervault") or {}).get("customer_numbers")
    dealervault = customer.get("dealervault_upload") is True or (
        len(numbers) > 0 if isinstance(numbers, list) else isinstance(numbers, str))
    inbound = customer.get("inbound_lead") is True or has_linked_leads
    if dealervault and inbound:
        return "Inbound & DealerVault"
    if dealervault:
        return "DealerVault"
    if inbound:
        return "Inbound Lead"
    if customer.get("manual_entry") is True:
        return "Manual"
    return "Unknown"


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    return None


# --- the route ---------------------------------------------------------------

async def build_customer_360(dealer_id: str, customer_id: str) -> dict[str, Any] | None:
    """The `data` object of GET /api/customers/<id>/360?dealer_id=..., or None
    when the customer doesn't exist for this dealer (the route's 404)."""
    if not ObjectId.is_valid(customer_id):
        return None
    db = dealer_scoped_db(dealer_id)
    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(customer_id)})
    if not customer:
        return None
    cid = customer["_id"]

    leads = await db.collection(PLATFORM_LEADS_COLLECTION).find({"customer_id": cid}).sort(
        "createdAt", -1).to_list(RECORD_LIMIT)
    deals = await db.collection(PLATFORM_DEALS_COLLECTION).find({"customer_id": cid}).to_list(RECORD_LIMIT)
    repair_orders = await db.collection(PLATFORM_REPAIR_ORDERS_COLLECTION).find({"customer_id": cid}).to_list(RECORD_LIMIT)
    appointments_raw = await db.collection(PLATFORM_SERVICE_APPOINTMENTS_COLLECTION).find(
        {"customer_id": cid}).to_list(RECORD_LIMIT)
    trade_ins = await db.collection(PLATFORM_TRADE_INS_COLLECTION).find({"customer_id": cid}).sort(
        "createdAt", -1).to_list(RECORD_LIMIT)
    appointments = dedupe_service_timeline(repair_orders, appointments_raw)

    vins: list[str] = []
    for record in [*deals, *repair_orders, *appointments_raw]:
        if record.get("vin") and record["vin"] not in vins:
            vins.append(record["vin"])

    vehicle_docs: dict[str, dict] = {}
    owners: dict[str, dict] = {}
    if vins:
        in_vins = {"vin": {"$in": vins}}
        for doc in await db.collection(PLATFORM_VEHICLES_COLLECTION, dealer_field="dealerId").find(in_vins).to_list(None):
            vehicle_docs[doc["vin"]] = doc
        owners = derive_vehicle_owners(
            await db.collection(PLATFORM_DEALS_COLLECTION).find(in_vins).to_list(None),
            await db.collection(PLATFORM_REPAIR_ORDERS_COLLECTION).find(in_vins).to_list(None),
            await db.collection(PLATFORM_SERVICE_APPOINTMENTS_COLLECTION).find(in_vins).to_list(None),
        )

    fallback: dict[str, dict] = {}
    for record in [*deals, *repair_orders, *appointments_raw]:
        if record.get("vin") and (record.get("Year") or record.get("Make") or record.get("Model")):
            fallback[record["vin"]] = record

    vehicles = []
    for vin in vins:
        doc, source = vehicle_docs.get(vin), fallback.get(vin)
        owner = owners.get(vin)
        vehicles.append({
            "vin": vin,
            "year": _first(doc, "year", source, "Year"),
            "make": _first(doc, "make", source, "Make"),
            "model": _first(doc, "model", source, "Model"),
            "vehicle_id": doc["_id"] if doc else None,
            "current_owner_customer_id": owner["customer_id"] if owner else None,
            "is_current_owner": str(owner["customer_id"] if owner else "") == str(cid),
        })

    data = {
        "customer": {**customer, "origin_badge": get_origin_badge(customer, has_linked_leads=bool(leads))},
        "value_snapshot": build_value_snapshot(leads, deals, repair_orders, appointments),
        "overview": build_overview_feed(leads, deals, repair_orders, appointments,
                                        customer.get("assignment_history") or []),
        "leads": leads,
        "deals": [{**d, "computed_date": get_deal_date(d), "computed_price": get_deal_price(d),
                   "computed_salesperson": get_deal_salesperson(d)} for d in deals],
        "repair_orders": [{**r, "computed_date": get_repair_order_date(r),
                           "computed_totals": get_repair_order_totals(r)} for r in repair_orders],
        "appointments": [{**a, "computed_date": get_appointment_date(a)} for a in appointments],
        "all_appointments": [{**a, "computed_date": get_appointment_date(a)} for a in appointments_raw],
        "vehicles": vehicles,
        "trade_ins": trade_ins,
    }
    return to_json(data)


def _first(doc: dict | None, key: str, source: dict | None, source_key: str) -> Any:
    if doc and doc.get(key) is not None:
        return doc[key]
    if source and source.get(source_key) is not None:
        return source[source_key]
    return None


def to_json(value: Any) -> Any:
    """What the route's NextResponse.json() produces: ObjectIds as strings,
    dates as ISO strings."""
    if isinstance(value, dict):
        return {k: to_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_json(v) for v in value]
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        stamp = value if value.tzinfo else value.replace(tzinfo=UTC)
        return stamp.astimezone(UTC).isoformat().replace("+00:00", "Z")
    return value
