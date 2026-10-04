"""The three-level status model and vehicle ownership records (MASTER_PLAN_4
D3, D8; SOLD-DELIVERED PDF §1, §9-§11, §14). Kept by the AI service: the
platform has none of these statuses yet (MASTER_PLAN_4 Conflict 3).

    level         statuses                                          kept on
    opportunity   SOLD_PENDING, SOLD_DELIVERED (active, NOT closed),  ai_lead_state.stage (agent/lifecycle.py)
                  CLOSED_LOST, CLOSED_NO_LONGER_OWNS (the only two
                  closed ones), OPEN (every working stage)
    vehicle       ACTIVE / NO_LONGER_OWNED, one record per vehicle   ai_vehicle_ownership
                  (several per customer), source DEALER_SALE or
                  CUSTOMER_REPORTED
    customer      ACTIVE / INACTIVE                                  ai_customer_status

**Customer rule (§9):** INACTIVE only when BOTH there is no open lead /
opportunity AND no currently owned vehicle. "Unknown ownership is not
confirmed zero ownership": a customer with a vehicle we have no confirmed
answer about (a DealerVault deal, say) keeps their status; missing data alone
never makes anyone INACTIVE. Recalculated on every relevant change (D8):
every lead stage change (lifecycle.apply) and every ownership change here.

**For stream A4** (NHTSA recalls, Vehicle Databases maintenance) - its agreed interface:

    await ownership.vehicle_is_owned(dealer_id, vin, customer_id=None)  -> True | False | None (unknown)
    await ownership.queue_service_outreach(dealer_id, {"type": "RECALL_DETECTED" | "MAINTENANCE_DUE",
                                                       "offer": "service_visit_request", "facts": {...},
                                                       "vin": ..., "customer_id"?: ...})
                                                                         -> {"status": "queued" | "skipped", ...}
    await ownership.owned_vehicles(db, customer_id)                      -> [record]
    await ownership.set_maintenance_facts(db, ownership_id, {"first_service": {"name": ...}})

The message says only what `facts` says (recall: campaign number / component / summary; maintenance: the service
and when it's due), or the caller's own approved wording {sms_text, email_subject?, email_body?}. Nothing is ever
invented around them (§5, §6, §12).
"""

import logging
from datetime import UTC, date, datetime
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.agent.customer_key import find_customer_leads
from upsell_agent.integrations.mongodb import (
    AI_CUSTOMER_STATUS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_VEHICLE_OWNERSHIP_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
)

logger = logging.getLogger(__name__)

# --- Opportunity (§1, §10, §14) -----------------------------------------------------------------------------------

OPEN = "OPEN"
SOLD_PENDING = "SOLD_PENDING"
SOLD_DELIVERED = "SOLD_DELIVERED"
CLOSED_LOST = "CLOSED_LOST"
CLOSED_NO_LONGER_OWNS = "CLOSED_NO_LONGER_OWNS"
# "The ONLY two CLOSED opportunity statuses are: CLOSED LOST and CLOSED - NO LONGER OWNS."
CLOSED_OPPORTUNITY_STATUSES = frozenset({CLOSED_LOST, CLOSED_NO_LONGER_OWNS})
_BY_STAGE = {"sold_pending": SOLD_PENDING, "sold_delivered": SOLD_DELIVERED, "closed_lost": CLOSED_LOST,
             "closed_no_longer_owns": CLOSED_NO_LONGER_OWNS}
# A lead the AI never worked, closed on the platform by staff (their own status words).
_PLATFORM_CLOSED = {"closed lost": CLOSED_LOST, "closed - lost": CLOSED_LOST, "closed-lost": CLOSED_LOST,
                    "closed - no longer owns": CLOSED_NO_LONGER_OWNS}


def opportunity_status(stage: str | None, previous_stage: str | None = None) -> str:
    """The opportunity status of a lead at `stage`. An opted-out lead keeps the status it had (an opt-out stops
    messages, it doesn't sell, deliver or close anything)."""
    if stage == "opted_out" and previous_stage:
        stage = previous_stage
    return _BY_STAGE.get(stage or "", OPEN)


def is_closed(status: str | None) -> bool:
    return status in CLOSED_OPPORTUNITY_STATUSES


# --- Vehicle (§10, §11) --------------------------------------------------------------------------------------------

VEHICLE_ACTIVE = "ACTIVE"
VEHICLE_NO_LONGER_OWNED = "NO_LONGER_OWNED"
SOURCE_DEALER_SALE = "DEALER_SALE"
SOURCE_CUSTOMER_REPORTED = "CUSTOMER_REPORTED"
HISTORY_LIMIT = 50

# --- Customer (§9) ---------------------------------------------------------------------------------------------------

CUSTOMER_ACTIVE = "ACTIVE"
CUSTOMER_INACTIVE = "INACTIVE"


def customer_status_rule(*, open_opportunities: int, owned_vehicles: int, unknown_ownership: bool,
                         previous: str | None) -> tuple[str, str]:
    """(status, why), §9's rule. Pure."""
    if open_opportunities or owned_vehicles:
        have = []
        if open_opportunities:
            have.append(f"{open_opportunities} open lead/opportunity" + ("" if open_opportunities == 1 else "s"))
        if owned_vehicles:
            have.append(f"{owned_vehicles} currently owned vehicle" + ("" if owned_vehicles == 1 else "s"))
        return CUSTOMER_ACTIVE, "ACTIVE: " + " and ".join(have)
    if unknown_ownership:
        # PLAN_4 stream X3 item 8: unknown now always has a deal behind it, so it reads as ACTIVE whatever the
        # status was before (it used to keep a previous INACTIVE).
        return CUSTOMER_ACTIVE, ("no open lead and no confirmed owned vehicle, but a vehicle's ownership "
                                 "is unknown - unknown ownership is not zero ownership (§9)")
    return CUSTOMER_INACTIVE, "INACTIVE: no open lead/opportunity and no currently owned vehicle"


def _cid_values(customer_id: str) -> list[Any]:
    return list({customer_id, as_object_id(customer_id)}) if ObjectId.is_valid(customer_id) else [customer_id]


async def recalculate_customer_status(db: DealerScopedDatabase, customer_id: str | None, *,
                                      reason: str) -> dict[str, Any] | None:
    """D8: recomputes and stores the customer's ACTIVE / INACTIVE status with `customer_status_recalculated_at`
    (§14), recording CUSTOMER_BECAME_ACTIVE / CUSTOMER_BECAME_INACTIVE when it changes."""
    if not customer_id:
        return None
    customer_id = str(customer_id)
    leads = await find_customer_leads(db, customer_id)
    lead_ids = [str(lead["_id"]) for lead in leads]
    states = {s["lead_id"]: s for s in await db.collection(AI_LEAD_STATE_COLLECTION).find(
        {"lead_id": {"$in": lead_ids}}).to_list(None)} if lead_ids else {}
    open_count = 0
    for lead in leads:
        state = states.get(str(lead["_id"])) or {}
        if state.get("duplicate_of"):
            continue  # MASTER_PLAN_3 C6: a linked duplicate is the same opportunity, not a second one
        if state.get("stage"):
            status = opportunity_status(state.get("stage"), state.get("previous_stage"))
        else:
            words = str(lead.get("fe_lead_status") or lead.get("lead_status") or "").strip().lower()
            status = _PLATFORM_CLOSED.get(words, OPEN)
        if not is_closed(status):
            open_count += 1
    records = await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).find({"customer_id": customer_id}).to_list(None)
    owned = sum(1 for r in records if r.get("ownership_status") == VEHICLE_ACTIVE)
    answered_vins = {r.get("vin") for r in records if r.get("vin")}
    deal_vins = {d.get("vin") for d in await db.collection(PLATFORM_DEALS_COLLECTION).find(
        {"customer_id": {"$in": _cid_values(customer_id)}}).to_list(None) if d.get("vin")}
    # Unknown, not zero (§9): no ownership record at all (we have never known what they drive), or a DealerVault
    # deal for a vehicle we have no ownership answer about. Only confirmed answers can add up to zero.
    # PLAN_4 stream X3 item 8 (audit 4 C5): "no ownership record at all" used to count as unknown, so a customer
    # who never bought (only closed leads, nothing owned, no deal) stayed ACTIVE for good. Unknown now needs a
    # reason to think they own something: a deal for a vehicle we have no answer about.
    unknown = bool(deal_vins - answered_vins)
    statuses = db.collection(AI_CUSTOMER_STATUS_COLLECTION)
    previous = await statuses.find_one({"customer_id": customer_id}) or {}
    status, why = customer_status_rule(open_opportunities=open_count, owned_vehicles=owned,
                                       unknown_ownership=unknown, previous=previous.get("customer_status"))
    now = clock.now()
    changed = previous.get("customer_status") != status
    fields = {"customer_status": status, "customer_status_reason": why, "open_opportunity_count": open_count,
              "active_owned_vehicle_count": owned, "unknown_ownership": unknown,
              "customer_status_recalculated_at": now, "recalculated_for": reason}
    update: dict[str, Any] = {"$set": fields, "$setOnInsert": {"customer_id": customer_id, "created_at": now}}
    event = None
    if changed:
        event = "CUSTOMER_BECAME_ACTIVE" if status == CUSTOMER_ACTIVE else "CUSTOMER_BECAME_INACTIVE"
        fields["customer_status_changed_at"] = now
        update["$push"] = {"history": {"$each": [{"at": now, "event": event, "from": previous.get("customer_status"),
                                                  "to": status, "reason": reason, "why": why}],
                                       "$slice": -HISTORY_LIMIT}}
    await statuses.update_one({"customer_id": customer_id}, update, upsert=True)
    return {"customer_status": status, "changed": changed, "event": event or "CUSTOMER_STATUS_RECALCULATED",
            "why": why, "open_opportunity_count": open_count, "active_owned_vehicle_count": owned}


# --- Ownership records ------------------------------------------------------------------------------------------------

def _history(event: str, at: datetime, **detail: Any) -> dict[str, Any]:
    return {"$push": {"history": {"$each": [{"at": at, "event": event, **detail}], "$slice": -HISTORY_LIMIT}}}


async def record_delivery(db: DealerScopedDatabase, *, lead_id: str, customer_id: str, vehicle: dict[str, Any],
                          delivered_at: datetime, delivery_date: date) -> dict[str, Any]:
    """SOLD - DELIVERED (§2): the vehicle sold on this opportunity, owned (ACTIVE) from today. One record per
    opportunity: setting Sold Delivered again doesn't add a second vehicle."""
    records = db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION)
    existing = await records.find_one({"lead_id": lead_id, "vehicle_source": SOURCE_DEALER_SALE})
    if existing:
        return existing
    doc = {"customer_id": str(customer_id), "lead_id": lead_id, "vin": vehicle.get("vin"),
           "year": vehicle.get("year"), "make": vehicle.get("make"), "model": vehicle.get("model"),
           "ownership_status": VEHICLE_ACTIVE, "vehicle_source": SOURCE_DEALER_SALE,
           "delivery_date": delivery_date.isoformat(), "sold_delivered_at": delivered_at,
           "ownership_confirmed_at": None, "no_longer_owns_at": None, "anniversaries_sent": [],
           "created_at": delivered_at, "updated_at": delivered_at,
           "history": [{"at": delivered_at, "event": "SOLD_DELIVERED", "source": "staff_status"}]}
    inserted = await records.insert_one(doc)
    doc["_id"] = inserted.inserted_id
    return doc


async def find_record(db: DealerScopedDatabase, ownership_id: Any) -> dict[str, Any] | None:
    if isinstance(ownership_id, dict):
        return ownership_id
    if not ownership_id or not ObjectId.is_valid(str(ownership_id)):
        return None
    return await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).find_one({"_id": ObjectId(str(ownership_id))})


async def confirm_ownership(db: DealerScopedDatabase, record: dict[str, Any], *, source: str) -> None:
    """§8 YES: the opportunity stays SOLD - DELIVERED, the vehicle ACTIVE; `ownership_confirmed_at` recorded."""
    now = clock.now()
    await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).update_one(
        {"_id": record["_id"]}, {"$set": {"ownership_confirmed_at": now, "updated_at": now},
                                 **_history("OWNERSHIP_CONFIRMED", now, source=source)})


async def mark_no_longer_owned(db: DealerScopedDatabase, record: dict[str, Any], *, source: str,
                               reason: str) -> int:
    """§8 NO: the vehicle is NO_LONGER_OWNED, and every reminder for it stops (maintenance, recall, anniversary,
    the Day-3 offer). The record and its history stay (§1: "Historical ... data must remain preserved").
    Returns how many pending messages were cancelled."""
    now = clock.now()
    await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).update_one(
        {"_id": record["_id"]},
        {"$set": {"ownership_status": VEHICLE_NO_LONGER_OWNED, "no_longer_owns_at": now, "updated_at": now},
         **_history("VEHICLE_NO_LONGER_OWNED", now, source=source, reason=reason)})
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        {"ownership_id": str(record["_id"]), "status": "pending"},
        {"$set": {"status": "cancelled", "reason": "the customer no longer owns this vehicle", "closed_at": now}})
    # Stream A4 (D5/D6): the recall and maintenance monitors stop watching this vehicle. Its queued outreach is
    # already cancelled above and vehicle_is_owned() now answers False.
    from upsell_agent.agent import service_events

    await service_events.stop_vehicle(db.dealer_id, record.get("vin"), reason=reason)
    await recalculate_customer_status(db, record.get("customer_id"), reason="vehicle no longer owned")
    return result.modified_count


async def upsert_reported_vehicle(db: DealerScopedDatabase, *, customer_id: str, lead_id: str | None,
                                  ownership_id: str | None, fields: dict[str, Any]) -> dict[str, Any]:
    """The vehicle the customer says they drive now (§8, §11): ACTIVE, source CUSTOMER_REPORTED, filled in answer
    by answer. A VIN is never taken from the conversation ("VIN only from legitimate approved source")."""
    now = clock.now()
    records = db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION)
    clean = {k: v for k, v in fields.items() if k != "vin"}
    existing = await find_record(db, ownership_id) if ownership_id else None
    if existing:
        await records.update_one({"_id": existing["_id"]},
                                 {"$set": {**clean, "information_received_at": now, "updated_at": now},
                                  **_history("CURRENT_VEHICLE_UPDATED", now, fields=sorted(clean))})
        return await find_record(db, existing["_id"]) or existing
    doc = {"customer_id": str(customer_id), "lead_id": None, "reported_on_lead_id": lead_id, "vin": None,
           "year": None, "make": None, "model": None, **clean,
           "ownership_status": VEHICLE_ACTIVE, "vehicle_source": SOURCE_CUSTOMER_REPORTED,
           "ownership_confirmed_at": now, "information_received_at": now, "no_longer_owns_at": None,
           "created_at": now, "updated_at": now,
           "history": [{"at": now, "event": "CURRENT_VEHICLE_REPORTED", "source": "customer"}]}
    inserted = await records.insert_one(doc)
    doc["_id"] = inserted.inserted_id
    await recalculate_customer_status(db, customer_id, reason="current vehicle reported")
    return doc


async def owned_vehicles(db: DealerScopedDatabase, customer_id: str) -> list[dict[str, Any]]:
    """The customer's currently owned vehicles (ACTIVE records), newest first."""
    rows = await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).find(
        {"customer_id": str(customer_id), "ownership_status": VEHICLE_ACTIVE}).to_list(None)
    return sorted(rows, key=lambda r: _aware(r.get("created_at")) or datetime.min.replace(tzinfo=UTC), reverse=True)


async def record_is_owned(db: DealerScopedDatabase, record: dict[str, Any] | None) -> bool:
    """An ACTIVE ownership record whose opportunity (when it was sold here) is still Sold - Delivered."""
    if record is None or record.get("ownership_status") != VEHICLE_ACTIVE:
        return False
    if record.get("lead_id"):
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": record["lead_id"]}) or {}
        return opportunity_status(state.get("stage"), state.get("previous_stage")) == SOLD_DELIVERED
    return True


async def find_by_vin(db: DealerScopedDatabase, vin: str | None, customer_id: str | None = None) -> list[dict]:
    if not vin:
        return []
    rows: list[dict] = []
    for value in dict.fromkeys((str(vin).strip().upper(), vin)):
        flt: dict[str, Any] = {"vin": value}
        if customer_id:
            flt["customer_id"] = str(customer_id)
        rows = await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).find(flt).to_list(None)
        if rows:
            break
    return rows


async def vehicle_is_owned(dealer_id: str, vin: str, *, customer_id: str | None = None) -> bool | None:
    """**Stream A4's interface.** Does the customer still own this VIN? True: an ACTIVE record on a Sold -
    Delivered opportunity (or customer-reported). False: we know they don't (NO_LONGER_OWNED, or the opportunity
    closed). None: no ownership record for it - unknown, so no outreach (§9: unknown is not confirmed)."""
    db = dealer_scoped_db(dealer_id)
    rows = await find_by_vin(db, vin, customer_id)
    if not rows:
        return None
    for row in rows:
        if await record_is_owned(db, row):
            return True
    return False


async def set_maintenance_facts(db: DealerScopedDatabase, ownership_id: Any, facts: dict[str, Any]) -> bool:
    """For stream A4: the vehicle's maintenance data (Vehicle Databases), e.g. {"first_service": {"name":
    "oil and filter change"}}. The Day-3 check-in names the first service only when this has it (§4)."""
    record = await find_record(db, ownership_id)
    if record is None:
        return False
    now = clock.now()
    await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).update_one(
        {"_id": record["_id"]}, {"$set": {"maintenance": {**(record.get("maintenance") or {}), **facts,
                                                          "updated_at": now}, "updated_at": now}})
    return True


# Stream A4's event types (agent/service_events.py) and what they are here.
EVENT_KINDS = {"RECALL_DETECTED": "recall", "MAINTENANCE_DUE": "maintenance"}


async def queue_service_outreach(dealer_id: str, event: dict[str, Any]) -> dict[str, Any]:
    """**Stream A4's interface.** `event`: {type: "RECALL_DETECTED" | "MAINTENANCE_DUE", offer:
    "service_visit_request", facts: {...}, vin?, customer_id?, ownership_id?, due_at?, call_task?}. Queues text +
    email (+ the 60-minute call task unless `call_task` is False) for an owned vehicle (§5, §6), re-checked at fire
    time (still owned, still Sold - Delivered, no service appointment already booked, not the same message within
    30 days). The message says only what `facts` says; the facts are kept on the lead's service offer, and a reply
    turn about it carries them as `decision["service_facts"]` (A4's guard allows exactly those claims). A YES
    becomes a service request with notes, never a booking (client, scope Q16).
    Returns {"status": "queued", "followup_id", "due_at", ...} or {"status": "skipped", "reason"}."""
    from upsell_agent.scheduler import sold_lifecycles

    kind = EVENT_KINDS.get(str(event.get("type") or ""))
    if kind is None:
        return {"status": "skipped", "reason": f"unknown event type {event.get('type')!r}"}
    facts = dict(event.get("facts") or {})
    db = dealer_scoped_db(dealer_id)
    vehicle: Any = event.get("ownership_id")
    if not vehicle:
        rows = await find_by_vin(db, event.get("vin") or facts.get("vin"), event.get("customer_id"))
        vehicle = next((r for r in rows if r.get("ownership_status") == VEHICLE_ACTIVE), None)
    if not vehicle:
        return {"status": "skipped", "reason": "no current ownership record for this vehicle (unknown or not owned)"}
    due_at = event.get("due_at")
    if isinstance(due_at, str):
        due_at = datetime.fromisoformat(due_at)
    made = await sold_lifecycles.plan_service_outreach(
        db, vehicle=vehicle, kind=kind, facts=facts, due_at=due_at, call_task=bool(event.get("call_task", True)),
        offer=str(event.get("offer") or "service_visit_request"), event_type=str(event["type"]))
    return {"status": "queued" if made.get("created") else "skipped", **made}


# --- Views (API) -------------------------------------------------------------------------------------------------------

def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _iso(value: Any) -> Any:
    found = _aware(value)
    return found.isoformat() if found else value


def record_view(record: dict[str, Any]) -> dict[str, Any]:
    keys = ("customer_id", "lead_id", "reported_on_lead_id", "vin", "year", "make", "model", "ownership_status",
            "vehicle_source", "delivery_date", "sold_delivered_at", "ownership_confirmed_at", "no_longer_owns_at",
            "information_received_at", "approx_acquisition_date", "reported_ownership_duration",
            "normal_service_location", "anniversaries_sent", "maintenance", "created_at", "updated_at")
    out = {"id": str(record["_id"]), **{k: _iso(record.get(k)) for k in keys}}
    out["history"] = [{**h, "at": _iso(h.get("at"))} for h in record.get("history") or []]
    return out


def status_view(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    keys = ("customer_status", "customer_status_reason", "open_opportunity_count", "active_owned_vehicle_count",
            "unknown_ownership", "customer_status_recalculated_at", "customer_status_changed_at")
    return {**{k: _iso(row.get(k)) for k in keys},
            "history": [{**h, "at": _iso(h.get("at"))} for h in row.get("history") or []]}


async def customer_view(dealer_id: str, customer_id: str) -> dict[str, Any]:
    """GET /v1/customers/{customer_id}/ownership (api/customers.py): the customer's status, every vehicle
    ownership record, and every opportunity with its status."""
    db = dealer_scoped_db(dealer_id)
    row = await db.collection(AI_CUSTOMER_STATUS_COLLECTION).find_one({"customer_id": str(customer_id)})
    records = await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).find({"customer_id": str(customer_id)}).to_list(None)
    records.sort(key=lambda r: _aware(r.get("created_at")) or datetime.min.replace(tzinfo=UTC))
    leads = await find_customer_leads(db, str(customer_id))
    lead_ids = [str(lead["_id"]) for lead in leads]
    states = {s["lead_id"]: s for s in await db.collection(AI_LEAD_STATE_COLLECTION).find(
        {"lead_id": {"$in": lead_ids}}).to_list(None)} if lead_ids else {}
    opportunities = []
    for lead in leads:
        state = states.get(str(lead["_id"])) or {}
        status = opportunity_status(state.get("stage"), state.get("previous_stage"))
        opportunities.append({"lead_id": str(lead["_id"]), "stage": state.get("stage"),
                              "opportunity_status": status, "closed": is_closed(status),
                              "closed_at": _iso(state.get("closed_at")), "closed_reason": state.get("closed_reason"),
                              "sold_delivered_at": _iso(state.get("sold_delivered_at")),
                              "delivery_date": state.get("delivery_date"),
                              "no_longer_owns_at": _iso(state.get("no_longer_owns_at")),
                              "duplicate_of": state.get("duplicate_of")})
    birthday = (row or {}).get("birthday")
    return {"customer_id": str(customer_id), "status": status_view(row),
            "vehicles": [record_view(r) for r in records], "opportunities": opportunities,
            "birthday": ({"month": birthday.get("month"), "day": birthday.get("day"),
                          "sources": birthday.get("sources"), "last_sent_year": birthday.get("last_sent_year")}
                         if birthday else None)}
