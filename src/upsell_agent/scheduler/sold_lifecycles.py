"""SOLD PENDING and SOLD - DELIVERED, wired into the scheduler (MASTER_PLAN_4
D1, D2, D4, D7, D8; stream A3).

**D1 - one lifecycle at a time.** `on_stage_change` runs inside
lifecycle.apply whenever a lead's stage changes:

    -> Sold Pending      the lead workflow's call tasks stop; SOLD PENDING starts (first touch planned)
    -> Sold Delivered    "all SOLD PENDING activity stops immediately" (SOLD-DELIVERED PDF §2); the
                         vehicle's ownership record, the Day-3 check-in, anniversary year 1 and the
                         birthday (when verified) are planned
    -> Closed Lost       SOLD PENDING ends (SOLD PENDING PDF §9); call tasks stop
    -> anything          the customer's ACTIVE / INACTIVE status is recalculated (D8)

Pending work of the old stage is cancelled by lifecycle.cancel_stale_work
(KIND_STAGES), and each kind below is re-checked against the stage when it fires.

**Scheduled kinds** (all in `scheduled_followups`, fired by followups.fire_one):

    sold_pending_touch      weekly x4, then every 2 weeks, forever (agent/sold_pending.py); text + email
                            (transactional: a purchase in progress) + the 60-minute call task
    post_delivery_checkin   Day 3 (agent/sold_delivered.py); text + email, no call task
    ownership_anniversary   years 1-10 per vehicle; YES / NO answered in `route_inbound`
    birthday                yearly, customer-level, only with a verified month/day; no call task (§12)
    service_outreach        stream A4's maintenance / recall messages (agent/ownership.py)

Every one re-checks the stage, the dealer's mode, the ownership record and the
send check right before it goes (SOLD PENDING PDF §12, SOLD-DELIVERED PDF §15:
"Every queued action re-checks ... immediately before execution").

**A pause by staff** (a hand reply) doesn't cancel these: only an outcome stops
SOLD PENDING (§2), and an ownership lifecycle lasts years. While staff have
been talking to the customer in the last STAFF_RECENT, a SOLD PENDING touch is
skipped (the cadence moves on to the next) and an ownership message waits a day.

**The response router** (`route_inbound`, called from events/handlers.py):
SOLD PENDING §9 (escalate, record information, documents confirmed), the
anniversary YES / NO and the replacement-vehicle questions (§8), and the answer
to a service offer (a request with notes, never a booking). Anything else falls
through to the AI turn under `sold_pending.reply_hold`.
"""

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import lifecycle, ownership, sold_delivered, sold_pending
from upsell_agent.agent.templates import first_name as _first_name
from upsell_agent.channels.sender import SendOutcome, SendRequest
from upsell_agent.integrations.dealer_mode import dealer_ai_mode
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_CUSTOMER_STATUS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_VEHICLE_OWNERSHIP_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    PLATFORM_SERVICE_APPOINTMENTS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.observability.trace import TurnTracer

logger = logging.getLogger(__name__)

KIND_SOLD_PENDING_TOUCH = "sold_pending_touch"
KIND_POST_DELIVERY_CHECKIN = "post_delivery_checkin"
KIND_ANNIVERSARY = "ownership_anniversary"
KIND_BIRTHDAY = "birthday"
KIND_SERVICE_OUTREACH = "service_outreach"
LIFECYCLE_KINDS = (KIND_SOLD_PENDING_TOUCH, KIND_POST_DELIVERY_CHECKIN, KIND_ANNIVERSARY, KIND_BIRTHDAY,
                   KIND_SERVICE_OUTREACH)
# What each sends as, for the send check: a purchase still being completed is operational; post-sale messages
# are relationship / service marketing and need consent like any other.
PURPOSE = {KIND_SOLD_PENDING_TOUCH: "transactional", KIND_POST_DELIVERY_CHECKIN: "marketing",
           KIND_ANNIVERSARY: "marketing", KIND_BIRTHDAY: "marketing", KIND_SERVICE_OUTREACH: "marketing"}
# Staff talking to the customer this recently: lifecycle messages step aside (module docstring).
STAFF_RECENT = timedelta(days=2)
OWNERSHIP_RETRY = timedelta(days=1)
# An anniversary more than this late (the lifecycle was off: an opt-out, an outage) is skipped, not sent late.
ANNIVERSARY_GRACE = timedelta(days=30)
# The same maintenance / recall message (its dedupe key) isn't sent twice within this (§6 "avoid repetitive
# outreach").
SERVICE_REPEAT_AFTER = timedelta(days=30)
SILENT = {"handoff", "paused"}
# What the router answered with, for the turn log (events/handlers.py).
ROUTER_ACTIONS = ("sold_pending_escalated", "sold_pending_info_received", "ownership_confirmed",
                  "ownership_ended", "current_vehicle_captured", "service_requested", "service_later",
                  "ownership_escalated")


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _iso(value: Any) -> Any:
    found = _aware(value)
    return found.isoformat() if found else value


async def _lead(db: DealerScopedDatabase, lead_id: str) -> dict | None:
    return await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})


async def _customer(db: DealerScopedDatabase, customer_id: str | None) -> dict | None:
    if not customer_id:
        return None
    return await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(customer_id)})


async def _state(db: DealerScopedDatabase, lead_id: str) -> dict:
    return await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}


async def _set(db: DealerScopedDatabase, lead_id: str, fields: dict[str, Any], unset: list[str] | None = None) -> None:
    update: dict[str, Any] = {"$set": fields} if fields else {}
    if unset:
        update["$unset"] = {k: "" for k in unset}
    if not update:
        return
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, update)


def _name(customer: dict | None, lead: dict | None) -> str | None:
    full = (customer or {}).get("name") or (lead or {}).get("name")
    return _first_name(full) if full else None


async def sold_vehicle(db: DealerScopedDatabase, lead: dict | None, customer_id: str | None,
                       lead_id: str) -> dict[str, Any]:
    """What was sold on this opportunity, from what we actually have: the lead's own vehicle fields, else the
    model the customer told us they wanted. Never guessed: a part we don't have stays None."""
    from upsell_agent.slots.store import current_facts

    data = (lead or {}).get("data") or {}
    vehicle = data.get("vehicle") if isinstance(data.get("vehicle"), dict) else {}
    out = {k: vehicle.get(k) or data.get(k) or (lead or {}).get(k) for k in ("vin", "year", "make", "model")}
    if not out["model"] and customer_id:
        for fact in await current_facts(db, customer_id, lead_id):
            if fact.get("path") == "interest.model" and fact.get("value"):
                out["model"] = str(fact["value"])
    return out


# --- D1: the manager outcome starts exactly one lifecycle ------------------------------------------------------------

async def on_stage_change(db: DealerScopedDatabase, lead_id: str, current: Any, new: Any, event: Any, *,
                          lead: dict | None, customer_id: str | None) -> dict[str, Any]:
    """Called by lifecycle.apply after a stage change (see the module docstring). Returns what it did, under keys
    that don't clash with apply's own."""
    from upsell_agent.scheduler.followups import cancel_call_task

    S = lifecycle.Stage
    lead = lead if lead is not None else await _lead(db, lead_id)
    customer_id = customer_id or (str(lead["customer_id"]) if (lead or {}).get("customer_id") else None)
    now = clock.now()
    state = await _state(db, lead_id)
    out: dict[str, Any] = {}
    fields: dict[str, Any] = {"opportunity_status": ownership.opportunity_status(new.value, state.get("previous_stage")),
                              "status_changed_at": now}
    staff_outcome = getattr(event, "kind", None) in ("sold_pending", "sold_delivered")
    sp = sold_pending.SoldPendingState.load(state)
    if new in (S.SOLD_PENDING, S.SOLD_DELIVERED, S.CLOSED_LOST):
        # Whatever ran before (the lead workflow's 60-minute timers, or SOLD PENDING's) is stale now.
        out["call_tasks_cancelled"] = await cancel_call_task(
            db, lead_id, reason=f"stage changed to {lifecycle.STAGE_LABELS[new]}", include_open=True)
    if staff_outcome:
        # Staff picked the outcome: the AI runs this workflow, whatever paused the lead before the visit.
        fields.update(status="active", status_reason=None, status_at=now)
    if new == S.SOLD_PENDING:
        if sp.started_at is None or sp.ended_at is not None:
            sp = sold_pending.SoldPendingState(started_at=now)
            out["lifecycle_started"] = "SOLD_PENDING_STARTED"
        fields["sold_pending"] = sp.as_dict()
        await _set(db, lead_id, fields)
        if customer_id:
            out["sold_pending_touch"] = await plan_sold_pending_touch(db, lead_id=lead_id, customer_id=customer_id,
                                                                      lead=lead)
    elif new == S.SOLD_DELIVERED:
        if sp.started_at is not None and sp.ended_at is None:
            fields["sold_pending"] = {**sp.as_dict(), "ended_at": now, "outcome": ownership.SOLD_DELIVERED}
        if staff_outcome and not state.get("sold_delivered_at"):
            profile = await dealer_profile(db.dealer_id)
            fields.update(sold_delivered_at=now, delivery_date=now.astimezone(profile.tz).date().isoformat())
            out["lifecycle_started"] = "SOLD_DELIVERED"
        await _set(db, lead_id, fields)
        if customer_id:
            out["ownership"] = await start_ownership(db, lead_id=lead_id, customer_id=customer_id, lead=lead)
    else:
        if new == S.CLOSED_LOST and sp.started_at is not None and sp.ended_at is None:
            fields["sold_pending"] = {**sp.as_dict(), "ended_at": now, "outcome": ownership.CLOSED_LOST}
        if new == S.CLOSED_NO_LONGER_OWNS:
            fields["no_longer_owns_at"] = now
        await _set(db, lead_id, fields)
    out["customer_status"] = await ownership.recalculate_customer_status(
        db, customer_id, reason=f"lead {lead_id} moved to {lifecycle.STAGE_LABELS[new]}")
    return out


async def start_ownership(db: DealerScopedDatabase, *, lead_id: str, customer_id: str,
                          lead: dict | None) -> dict[str, Any]:
    """The ownership lifecycle for the vehicle sold on this lead (§2-§3): its record, then every message that is
    still ahead of it. Idempotent: setting Sold Delivered again, or coming back after an opt-out, re-plans only
    what hasn't happened."""
    state = await _state(db, lead_id)
    delivered_at = _aware(state.get("sold_delivered_at")) or clock.now()
    delivery_day = date.fromisoformat(state["delivery_date"]) if state.get("delivery_date") else delivered_at.date()
    record = await ownership.record_delivery(db, lead_id=lead_id, customer_id=customer_id,
                                             vehicle=await sold_vehicle(db, lead, customer_id, lead_id),
                                             delivered_at=delivered_at, delivery_date=delivery_day)
    out: dict[str, Any] = {"ownership_id": str(record["_id"])}
    if record.get("ownership_status") != ownership.VEHICLE_ACTIVE:
        return {**out, "planned": False, "reason": "the customer no longer owns this vehicle"}
    if not state.get("checkin_sent_at"):
        out["checkin"] = await _plan(db, KIND_POST_DELIVERY_CHECKIN, lead_id=lead_id, customer_id=customer_id,
                                     due_at=sold_delivered.checkin_due(delivered_at, (await dealer_profile(
                                         db.dealer_id)).tz), ownership_id=str(record["_id"]), skip_if_past=False)
    out["anniversary"] = await plan_anniversary(db, record)
    out["birthday"] = await plan_birthday(db, customer_id=customer_id)
    return out


# --- Planning -------------------------------------------------------------------------------------------------------

async def _plan(db: DealerScopedDatabase, kind: str, *, lead_id: str, customer_id: str, due_at: datetime,
                channel: str = "sms", ownership_id: str | None = None, skip_if_past: bool = False,
                **extra: Any) -> dict[str, Any]:
    """One pending record of `kind` per lead (per vehicle for vehicle-level kinds): a newer plan supersedes it."""
    now = clock.now()
    if skip_if_past and due_at < now:
        return {"created": False, "reason": f"{kind} was due {due_at.isoformat()}: too late to send"}
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    flt: dict[str, Any] = {"lead_id": lead_id, "kind": kind, "status": "pending"}
    if ownership_id:
        flt["ownership_id"] = ownership_id
    if extra.get("dedupe_key"):
        flt["dedupe_key"] = extra["dedupe_key"]
    await followups.update_many(flt, {"$set": {"status": "superseded", "reason": f"a newer {kind}", "closed_at": now}})
    doc = {"kind": kind, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": f"{kind}-plan",
           "from_channel": channel, "to_channel": channel, "text": None, "subject": None, "status": "pending",
           "due_at": max(due_at, now), "created_at": now, "claim_count": 0, "ownership_id": ownership_id,
           "reason": None, **extra}
    inserted = await followups.insert_one(doc)
    return {"created": True, "followup_id": str(inserted.inserted_id), "due_at": doc["due_at"].isoformat()}


async def plan_sold_pending_touch(db: DealerScopedDatabase, *, lead_id: str, customer_id: str,
                                  lead: dict | None = None) -> dict[str, Any]:
    """The next SOLD PENDING touch (§4, §6). Always planned while the lead is SOLD PENDING, even when a channel is
    opted out today: the fire-time send check decides, and the cadence carries on (§10: "other permitted
    channels continue where allowed")."""
    state = await _state(db, lead_id)
    if state.get("stage") != lifecycle.Stage.SOLD_PENDING.value:
        return {"created": False, "reason": "the lead isn't Sold Pending"}
    sp = sold_pending.SoldPendingState.load(state)
    profile = await dealer_profile(db.dealer_id)
    planned = sold_pending.plan_touch(sp, now=clock.now(), tz=profile.tz)
    channel = (((lead or {}).get("data") or {}).get("channel")) or "sms"
    made = await _plan(db, KIND_SOLD_PENDING_TOUCH, lead_id=lead_id, customer_id=customer_id,
                       due_at=planned.due_at, channel="email" if channel == "email" else "sms",
                       touch=planned.as_dict())
    await _set(db, lead_id, {"sold_pending.next_followup_at": planned.due_at,
                             "sold_pending.week_number": planned.week, "sold_pending.phase": planned.phase})
    return {**made, "touch": planned.as_dict()}


async def plan_anniversary(db: DealerScopedDatabase, record: dict[str, Any]) -> dict[str, Any]:
    """The next ownership anniversary for this vehicle, years 1-10 (§8). Only a dealer-delivered vehicle has an
    original delivery date to count from."""
    if not record.get("lead_id") or not record.get("delivery_date"):
        return {"created": False, "reason": "no original delivery date"}
    if record.get("ownership_status") != ownership.VEHICLE_ACTIVE:
        return {"created": False, "reason": "the customer no longer owns this vehicle"}
    profile = await dealer_profile(db.dealer_id)
    delivered = date.fromisoformat(record["delivery_date"])
    sent = set(record.get("anniversaries_sent") or [])
    now = clock.now()
    for year in range(1, sold_delivered.ANNIVERSARY_YEARS + 1):
        due = sold_delivered.anniversary_due(delivered, year, profile.tz)
        if year in sent or due + ANNIVERSARY_GRACE < now:
            continue
        return {**await _plan(db, KIND_ANNIVERSARY, lead_id=record["lead_id"], customer_id=record["customer_id"],
                              due_at=due, ownership_id=str(record["_id"]), year=year), "year": year}
    return {"created": False, "reason": f"all {sold_delivered.ANNIVERSARY_YEARS} anniversaries are past"}


async def _birthday_records(db: DealerScopedDatabase, customer_id: str) -> tuple[dict | None, list[dict]]:
    """The platform customer and its DealerVault deals / repair orders / service appointments (`Birth Date`)."""
    customer = await _customer(db, customer_id)
    values = [customer_id, as_object_id(customer_id)]
    records: list[dict] = []
    for name, label in ((PLATFORM_DEALS_COLLECTION, "deal"), (PLATFORM_REPAIR_ORDERS_COLLECTION, "repair_order"),
                        (PLATFORM_SERVICE_APPOINTMENTS_COLLECTION, "service_appointment")):
        for row in await db.collection(name).find({"customer_id": {"$in": values}}).to_list(200):
            records.append({**row, "_source": label})
    return customer, records


async def plan_birthday(db: DealerScopedDatabase, *, customer_id: str) -> dict[str, Any]:
    """The customer's next birthday message (§7): only with a verified month/day, only for a customer in an
    ownership lifecycle, one per customer per year whichever of their leads it goes out on."""
    customer, records = await _birthday_records(db, customer_id)
    verified = sold_delivered.verified_birthday(customer, records)
    statuses = db.collection(AI_CUSTOMER_STATUS_COLLECTION)
    await statuses.update_one({"customer_id": customer_id},
                              {"$set": {"birthday.month": verified["month"], "birthday.day": verified["day"],
                                        "birthday.sources": verified["sources"], "birthday.checked_at": clock.now()}
                               if verified else {"birthday.month": None, "birthday.day": None,
                                                 "birthday.checked_at": clock.now()},
                               "$setOnInsert": {"customer_id": customer_id, "created_at": clock.now()}}, upsert=True)
    if not verified:
        return {"created": False, "reason": "no verified birth month/day on record (never inferred)"}
    leads = [r for r in await ownership.owned_vehicles(db, customer_id) if r.get("lead_id")]
    anchor = None
    for record in leads:
        state = await _state(db, record["lead_id"])
        if state.get("stage") == lifecycle.Stage.SOLD_DELIVERED.value:
            anchor = record["lead_id"]
            break
    if anchor is None:
        return {"created": False, "reason": "no Sold - Delivered opportunity to send it on"}
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    if await followups.find_one({"customer_id": customer_id, "kind": KIND_BIRTHDAY, "status": "pending"}):
        return {"created": False, "reason": "already planned"}
    profile = await dealer_profile(db.dealer_id)
    due = sold_delivered.next_birthday(verified["month"], verified["day"], now=clock.now(), tz=profile.tz)
    row = await statuses.find_one({"customer_id": customer_id}) or {}
    if ((row.get("birthday") or {}).get("last_sent_year")) == due.year:
        due = sold_delivered.at_touch_hour(sold_delivered._on(due.year + 1, verified["month"], verified["day"]),
                                           profile.tz)
    return await _plan(db, KIND_BIRTHDAY, lead_id=anchor, customer_id=customer_id, due_at=due, year=due.year)


async def plan_service_outreach(db: DealerScopedDatabase, *, vehicle: Any, kind: str, facts: dict[str, Any],
                                due_at: datetime | None = None, call_task: bool = True) -> dict[str, Any]:
    """agent/ownership.queue_service_outreach (stream A4's entry point)."""
    if kind not in ("maintenance", "recall"):
        return {"created": False, "reason": f"unknown outreach kind {kind!r}"}
    record = None
    if isinstance(vehicle, dict) and vehicle.get("_id"):
        record = vehicle
    elif isinstance(vehicle, dict):
        rows = await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).find(
            {k: str(v) if k == "customer_id" else v for k, v in vehicle.items() if k in ("customer_id", "vin")}
        ).to_list(None)
        record = next((r for r in rows if r.get("ownership_status") == ownership.VEHICLE_ACTIVE), None)
    else:
        record = await ownership.find_record(db, vehicle)
    if record is None or not await ownership.vehicle_is_owned(db, ownership_id=record["_id"]):
        return {"created": False, "reason": "not a vehicle the customer currently owns on a Sold - Delivered "
                                            "opportunity"}
    if sold_delivered.render_service_outreach(kind, facts, first_name=None, dealership=None, vehicle=record) is None:
        return {"created": False, "reason": "the facts are too thin to say anything true (§5, §6)"}
    dedupe = str(facts.get("dedupe_key") or facts.get("recall_id") or facts.get("service") or kind)
    recent = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find_one(
        {"ownership_id": str(record["_id"]), "kind": KIND_SERVICE_OUTREACH, "dedupe_key": dedupe,
         "status": "sent", "closed_at": {"$gte": clock.now() - SERVICE_REPEAT_AFTER}})
    if recent:
        return {"created": False, "reason": f"the same {kind} message went out in the last "
                                            f"{SERVICE_REPEAT_AFTER.days} days"}
    return await _plan(db, KIND_SERVICE_OUTREACH, lead_id=record["lead_id"], customer_id=record["customer_id"],
                       due_at=due_at or clock.now(), ownership_id=str(record["_id"]), outreach_kind=kind,
                       facts=facts, dedupe_key=dedupe, call_task=call_task)


async def sweep_birthdays(*, limit: int = 2000) -> dict[str, Any]:
    """Daily (worker cron): DealerVault often imports the deal - and its `Birth Date` - after the delivery, so a
    customer in an ownership lifecycle without a planned birthday is checked again. Cross-dealer by design, like
    the Day 91 sweep; each customer is handled in its own dealer's scope."""
    rows = await get_db()[AI_VEHICLE_OWNERSHIP_COLLECTION].find(
        {"ownership_status": ownership.VEHICLE_ACTIVE, "lead_id": {"$ne": None}}).to_list(limit)
    seen: set[tuple[str, str]] = set()
    summary = {"checked": 0, "planned": 0}
    for row in rows:
        key = (row.get("dealer_id"), row.get("customer_id"))
        if not all(key) or key in seen:
            continue
        seen.add(key)
        summary["checked"] += 1
        if (await plan_birthday(dealer_scoped_db(key[0]), customer_id=key[1])).get("created"):
            summary["planned"] += 1
    return summary


# --- Firing ---------------------------------------------------------------------------------------------------------

async def _send_both(db: DealerScopedDatabase, deps: Any, tracer: TurnTracer, doc: dict, text: dict[str, str],
                     purpose: str) -> list[SendOutcome]:
    """Text AND email, each its own send with its own check: one opted out never stops the other (SOLD PENDING PDF
    §10, §12). The idempotency key carries the record id and channel, so a re-run can't send either twice."""
    from upsell_agent.scheduler.followups import other_channel

    outcomes: list[SendOutcome] = []
    first = doc["to_channel"]
    for ch in (first, other_channel(first)):
        request = SendRequest(
            dealer_id=db.dealer_id, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
            turn_id=f"{doc['kind']}-{doc['_id']}", channel=ch,
            text=text["sms_text"] if ch == "sms" else text["email_body"],
            subject=None if ch == "sms" else text["email_subject"], purpose=purpose, is_reply=False)
        async with tracer.node(f"send_{ch}", {"channel": ch, "idempotency_key": request.idempotency_key,
                                              "text": request.text, "subject": request.subject}) as span:
            outcome = await deps.sender.send(request)
            span.output = outcome.as_dict()
            span.reasoning = list(outcome.reasoning)
            span.edge_label = f"{ch}: {outcome.status}"
        outcomes.append(outcome)
    return outcomes


async def _requeue(db: DealerScopedDatabase, doc: dict, due: datetime, reason: str) -> None:
    await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
        {"_id": doc["_id"], "status": "claimed", "claimed_by": doc["claimed_by"]},
        {"$set": {"status": "pending", "due_at": due, "reason": reason}})


async def _vehicle_check(db: DealerScopedDatabase, doc: dict) -> tuple[str, bool, str]:
    if not doc.get("ownership_id"):
        return "vehicle_owned", True, "customer-level message"
    owned = await ownership.vehicle_is_owned(db, ownership_id=doc["ownership_id"])
    return "vehicle_owned", owned, "the customer still owns the vehicle" if owned else \
        "the customer no longer owns this vehicle"


async def _has_service_appointment(db: DealerScopedDatabase, customer_id: str, vin: str | None) -> bool:
    """An upcoming service appointment on the platform (DealerVault) for this customer / vehicle (§4: "Existing
    appointment suppresses redundant scheduling outreach")."""
    from upsell_agent.integrations.customer360 import get_appointment_date

    flt: dict[str, Any] = {"customer_id": {"$in": [customer_id, as_object_id(customer_id)]}}
    today = clock.now().replace(hour=0, minute=0, second=0, microsecond=0)
    for row in await db.collection(PLATFORM_SERVICE_APPOINTMENTS_COLLECTION).find(flt).to_list(200):
        if vin and row.get("vin") and row["vin"] != vin:
            continue
        when = get_appointment_date(row)
        if when is not None and when >= today:
            return True
    return False


async def fire(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    """followups.fire_one's handler for every kind in LIFECYCLE_KINDS (under the lead lock)."""
    from upsell_agent.scheduler.followups import _close, _log, _permitted_channel, plan_call_task

    kind, doc_id = doc["kind"], str(doc["_id"])
    tracer = TurnTracer(sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"],
                        customer_id=doc["customer_id"], trigger=kind, channel=doc["to_channel"],
                        store_prompts=deps.store_prompts,
                        turn_id=f"{kind}-check-{doc_id}-fire{int(doc.get('claim_count') or 1)}")
    await tracer.start({"followup_id": doc_id, "kind": kind, "touch": doc.get("touch"), "year": doc.get("year")})
    now = clock.now()
    lead = await _lead(db, doc["lead_id"])
    customer = await _customer(db, doc["customer_id"])
    profile = await dealer_profile(db.dealer_id)
    state = await _state(db, doc["lead_id"])
    record = await ownership.find_record(db, doc.get("ownership_id")) if doc.get("ownership_id") else None
    async with tracer.node(kind, {"followup_id": doc_id, "due_at": doc["due_at"]}) as span:
        mode = await dealer_ai_mode(db.dealer_id)
        checks = [lifecycle.stage_check(state, kind), ("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
                  await _vehicle_check(db, doc)]
        if kind == KIND_BIRTHDAY:
            row = await db.collection(AI_CUSTOMER_STATUS_COLLECTION).find_one({"customer_id": doc["customer_id"]})
            inactive = (row or {}).get("customer_status") == ownership.CUSTOMER_INACTIVE
            c, records = await _birthday_records(db, doc["customer_id"])
            verified = sold_delivered.verified_birthday(c, records)
            checks += [("customer_active", not inactive, "customer is INACTIVE" if inactive else "customer active"),
                       ("birthday_verified", verified is not None,
                        "verified birth month/day" if verified else "the birth month/day is no longer verified")]
        failed = [c for c in checks if not c[1]]
        staff_at = _aware(state.get("status_at") or state.get("paused_at"))
        staff_busy = state.get("status") in SILENT and staff_at is not None and now - staff_at < STAFF_RECENT
        check = None
        if not failed and not staff_busy:
            ch, check = await _permitted_channel(dealer_id=db.dealer_id, customer_id=doc["customer_id"],
                                                 lead_id=doc["lead_id"], channel=doc["to_channel"], at=None,
                                                 lead=lead, customer=customer, purpose=PURPOSE[kind])
            doc = {**doc, "to_channel": ch}
            checks.append(("send_check", check.outcome == "ALLOW", f"{ch}: {check.summary()}"))
        decision = ("cancel" if failed else "staff talking" if staff_busy else
                    "send" if check.outcome == "ALLOW" else check.outcome.lower())
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "decision": decision}
        span.reasoning = [f"{'OK' if ok else 'no'}: {d}" for _, ok, d in checks]
        span.edge_label = decision

    async def advance(sent: bool, asked_documents: bool = False) -> None:
        """SOLD PENDING moves on to its next touch whatever happened to this one (§9: "No response: continue")."""
        if kind != KIND_SOLD_PENDING_TOUCH or state.get("stage") != lifecycle.Stage.SOLD_PENDING.value:
            return
        sp = sold_pending.SoldPendingState.load(state)
        number = int((doc.get("touch") or {}).get("touch_number") or sp.touch_number)
        sp = sold_pending.after_touch(sp, number, at=now, asked_documents=asked_documents, sent=sent)
        await _set(db, doc["lead_id"], {"sold_pending": {**(state.get("sold_pending") or {}), **sp.as_dict()}})
        await plan_sold_pending_touch(db, lead_id=doc["lead_id"], customer_id=doc["customer_id"], lead=lead)

    async def next_yearly() -> None:
        if kind == KIND_ANNIVERSARY and record is not None:
            await plan_anniversary(db, await ownership.find_record(db, record["_id"]) or record)
        if kind == KIND_BIRTHDAY:
            await plan_birthday(db, customer_id=doc["customer_id"])

    if failed:
        reason = failed[0][2]
        await _close(db, doc, "cancelled", reason=reason)
        await _log(db, tracer, f"{kind}_cancelled", {"followup_id": doc_id, "reason": reason})
        return "cancelled"
    if staff_busy:
        if kind == KIND_SOLD_PENDING_TOUCH:
            await _close(db, doc, "skipped", reason="staff are talking to the customer: this touch is skipped")
            await advance(sent=False)
            await _log(db, tracer, f"{kind}_skipped", {"followup_id": doc_id})
            return "skipped"
        await _requeue(db, doc, now + OWNERSHIP_RETRY, "staff are talking to the customer: tried again tomorrow")
        await _log(db, tracer, f"{kind}_deferred", {"followup_id": doc_id})
        return "deferred"
    if check.outcome == "HOLD" and check.until:
        await _requeue(db, doc, check.until, f"held by the send check: {check.reason}")
        await _log(db, tracer, f"{kind}_deferred", {"followup_id": doc_id, "reason": check.reason})
        return "deferred"
    if check.outcome != "ALLOW":
        await _close(db, doc, "suppressed", reason=f"{check.outcome}: {check.reason}")
        await advance(sent=False)
        if kind == KIND_ANNIVERSARY:
            await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).update_one(
                {"_id": record["_id"]}, {"$addToSet": {"anniversaries_sent": doc.get("year")}})
        await next_yearly()
        await _log(db, tracer, f"{kind}_suppressed", {"followup_id": doc_id, "reason": check.reason})
        return "suppressed"

    name = _name(customer, lead)
    vehicle = record or await sold_vehicle(db, lead, doc["customer_id"], doc["lead_id"])
    lead_fields: dict[str, Any] = {}
    asked_documents = False
    if kind == KIND_SOLD_PENDING_TOUCH:
        sp = sold_pending.SoldPendingState.load(state)
        number = int((doc.get("touch") or {}).get("touch_number") or sp.touch_number)
        asked_documents = sold_pending.asks_documents(number, sp)
        text = sold_pending.render_touch(number, first_name=name, dealership=profile.name,
                                         vehicle=sold_delivered.vehicle_label(vehicle), documents=asked_documents)
    elif kind == KIND_POST_DELIVERY_CHECKIN:
        booked = await _has_service_appointment(db, doc["customer_id"], (record or {}).get("vin"))
        text = sold_delivered.render_checkin(first_name=name, dealership=profile.name, vehicle=vehicle,
                                             first_service=((record or {}).get("maintenance") or {}).get(
                                                 "first_service"), offer_service=not booked)
        if not booked:
            lead_fields["service_offer"] = {"kind": "first_service", "ownership_id": doc.get("ownership_id"),
                                            "asked_at": now, "status": "offered"}
        lead_fields["checkin_sent_at"] = now
    elif kind == KIND_ANNIVERSARY:
        text = sold_delivered.render_anniversary(first_name=name, dealership=profile.name, vehicle=vehicle,
                                                 year=int(doc.get("year") or 1))
        lead_fields["ownership_prompt"] = {"kind": "anniversary", "ownership_id": doc.get("ownership_id"),
                                           "year": doc.get("year"), "asked_at": now}
    elif kind == KIND_BIRTHDAY:
        text = sold_delivered.render_birthday(first_name=name, dealership=profile.name)
    else:
        if await _has_service_appointment(db, doc["customer_id"], (record or {}).get("vin")):
            await _close(db, doc, "suppressed", reason="a service appointment is already booked")
            await _log(db, tracer, f"{kind}_suppressed", {"followup_id": doc_id, "reason": "appointment exists"})
            return "suppressed"
        text = sold_delivered.render_service_outreach(doc.get("outreach_kind") or "maintenance", doc.get("facts") or {},
                                                      first_name=name, dealership=profile.name, vehicle=vehicle)
        lead_fields["service_offer"] = {"kind": doc.get("outreach_kind"), "ownership_id": doc.get("ownership_id"),
                                        "asked_at": now, "status": "offered", "facts": doc.get("facts")}
    outcomes = await _send_both(db, deps, tracer, doc, text, PURPOSE[kind])
    delivered = any(o.status in ("sent", "duplicate") for o in outcomes)
    if not delivered and any(o.status == "held" for o in outcomes):
        await _requeue(db, doc, now + timedelta(seconds=30), "held by the send check at send time; checking again")
        return "deferred"
    if delivered:
        lead_fields["last_outbound_at"] = now
        await _set(db, doc["lead_id"], lead_fields)
        if kind == KIND_ANNIVERSARY:
            await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).update_one(
                {"_id": record["_id"]}, {"$addToSet": {"anniversaries_sent": doc.get("year")},
                                         "$set": {"last_anniversary_at": now}})
        if kind == KIND_BIRTHDAY:
            await db.collection(AI_CUSTOMER_STATUS_COLLECTION).update_one(
                {"customer_id": doc["customer_id"]}, {"$set": {"birthday.last_sent_year": doc.get("year"),
                                                               "birthday.last_sent_at": now}})
    status = "sent" if delivered else (outcomes[0].status if outcomes else "failed")
    await _close(db, doc, status, reason=None, fired_at=now)
    call_task = None
    if delivered and (kind == KIND_SOLD_PENDING_TOUCH or (kind == KIND_SERVICE_OUTREACH and doc.get("call_task"))):
        # §3, §8: the 60-minute connection timer behind the human call task (agent/call_tasks.py, reused).
        call_task = await plan_call_task(db, lead_id=doc["lead_id"], customer_id=doc["customer_id"],
                                         turn_id=f"{kind}-{doc_id}", lead=lead, customer=customer,
                                         lead_state=await _state(db, doc["lead_id"]),
                                         sent_channels=[o.channel for o in outcomes if o.status == "sent"])
    await advance(sent=delivered, asked_documents=asked_documents)
    await next_yearly()
    await _log(db, tracer, f"{kind}_{status}", {"followup_id": doc_id, "call_task": call_task,
                                                "sent": [{"channel": o.channel, "status": o.status}
                                                         for o in outcomes]})
    return status


# --- The response router ---------------------------------------------------------------------------------------------

def _reply(action: str, reason: str, text: str, subject: str = "Your vehicle") -> dict[str, Any]:
    return {"action": action, "reason": reason, "reply": {"text": text, "subject": subject}}


async def _notice(db: DealerScopedDatabase, lead_id: str, kind: str, text: str, **extra: Any) -> None:
    await _set(db, lead_id, {"staff_notice": {"at": clock.now(), "kind": kind, "text": text, **extra}})


async def route_inbound(db: DealerScopedDatabase, *, lead_id: str, customer_id: str, state: dict, text: str,
                        lead: dict | None = None) -> dict[str, Any] | None:
    """A customer reply on a Sold Pending / Sold - Delivered lead. Returns {action, reason, reply} when it was
    answered here (events/handlers.py sends the reply), else None: the AI turn answers, under
    sold_pending.reply_hold. Only staff change the status; nothing here closes anything except the customer's own
    "NO" to the anniversary question (§8)."""
    stage = state.get("stage")
    now = clock.now()
    meaningful, _ = lifecycle.is_meaningful_reply(text)
    customer = await _customer(db, customer_id)
    name = _name(customer, lead)
    if stage == lifecycle.Stage.SOLD_PENDING.value:
        sp = sold_pending.SoldPendingState.load(state)
        if meaningful:
            await _set(db, lead_id, {"sold_pending.last_meaningful_contact_at": now, "last_meaningful_contact_at": now})
        route, why = sold_pending.classify_reply(text, documents_asked=sp.documents_asked_at is not None)
        if route == "human":
            escalation = {"type": "human_question", "owner": "assigned_salesperson", "status": "open", "at": now,
                          "question": text[:500]}
            await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
                {"lead_id": lead_id}, {"$push": {"sold_pending.escalations": {"$each": [escalation], "$slice": -20}}})
            await _notice(db, lead_id, "sold_pending_escalation",
                          f"Sold Pending customer has a question for a person: {text[:300]!r}. Please answer them "
                          "directly - the AI has told them you will.")
            return _reply("sold_pending_escalated", f"SOLD PENDING §9: {why}; escalated with context.",
                          sold_pending.escalation_reply(name), "Your purchase")
        if route == "info":
            await _set(db, lead_id, {"sold_pending.info_received_at": now})
            await _notice(db, lead_id, "sold_pending_info",
                          f"Sold Pending customer provided information: {text[:300]!r}. Please check it.")
            return _reply("sold_pending_info_received", f"SOLD PENDING §9: {why}; routed to the dealership.",
                          sold_pending.info_received_reply(name), "Your purchase")
        if route == "documents_confirmed":
            await _set(db, lead_id, {"sold_pending.documents_confirmed": True})
        return None
    if stage not in (lifecycle.Stage.SOLD_DELIVERED.value, lifecycle.Stage.CLOSED_NO_LONGER_OWNS.value):
        return None
    capture = state.get("vehicle_capture") or {}
    if capture.get("step"):
        return await _capture_step(db, lead_id=lead_id, customer_id=customer_id, capture=capture, text=text, name=name)
    prompt = state.get("ownership_prompt") or {}
    if prompt.get("kind") == "anniversary" and stage == lifecycle.Stage.SOLD_DELIVERED.value:
        answer = sold_delivered.classify_ownership_answer(text)
        record = await ownership.find_record(db, prompt.get("ownership_id"))
        if answer == "yes" and record:
            await ownership.confirm_ownership(db, record, source="anniversary_reply")
            await _set(db, lead_id, {}, unset=["ownership_prompt"])
            model = sold_delivered.model_label(record) or "vehicle"
            return _reply("ownership_confirmed", "§8 YES: ownership confirmed; nothing else changes.",
                          f"That's great to hear{', ' + name if name else ''}! Enjoy your {model}, and let us know "
                          "if there's ever anything we can help with.")
        if answer == "no" and record:
            cancelled = await ownership.mark_no_longer_owned(db, record, source="anniversary_reply",
                                                             reason=f"customer replied {text[:80]!r}")
            await lifecycle.apply(db, lead_id, [lifecycle.Event(
                "no_longer_owns", source="anniversary_reply", reason="The customer said they no longer own it",
                detail={"closed_reason": "customer_no_longer_owns"})], lead=lead, customer_id=customer_id)
            await _set(db, lead_id, {"vehicle_capture": {"step": "current_vehicle", "started_at": now,
                                                         "from_ownership_id": str(record["_id"])}},
                       unset=["ownership_prompt", "service_offer"])
            return _reply("ownership_ended", f"§8 NO: vehicle NO_LONGER_OWNED, opportunity Closed - No Longer Owns, "
                                             f"{cancelled} pending reminder(s) for it stopped.",
                          "Thanks for letting me know! What are you driving now?")
        # Anything else is no answer: nothing changes (§8 "NO RESPONSE"); the AI answers what they did say.
    offer = state.get("service_offer") or {}
    if offer.get("status") == "offered":
        answer = sold_delivered.classify_service_answer(text)
        if answer == "yes":
            await _set(db, lead_id, {"service_offer.status": "requested", "service_offer.answered_at": now,
                                     "service_offer.notes": text[:500]})
            await _notice(db, lead_id, "service_request",
                          f"Service request ({offer.get('kind') or 'service'}) - please contact the customer to "
                          f"confirm a time. Their words: {text[:300]!r}. Not booked: the AI takes notes only.",
                          ownership_id=offer.get("ownership_id"), notes=text[:500])
            return _reply("service_requested", "Service YES: a request with notes for the service team, never a "
                                               "booking (client, scope Q16).",
                          "Great, I've passed your request and your notes to our service team. They'll reach out to "
                          "confirm a day and time with you.", "Your service request")
        if answer == "later":
            await _set(db, lead_id, {"service_offer.status": "declined", "service_offer.answered_at": now})
            return _reply("service_later", "§4 LATER: no pressure; the maintenance reminders stay active.",
                          "No problem at all! Whenever you're ready, just let us know.")
    return None


async def _capture_step(db: DealerScopedDatabase, *, lead_id: str, customer_id: str, capture: dict, text: str,
                        name: str | None) -> dict[str, Any] | None:
    """§8 after a NO: what they drive now, about how long they've had it, where they have it serviced, stored as
    a CUSTOMER_REPORTED vehicle answer by answer. Never a trade pitch (§13). A question instead of an answer is
    left to the AI; the step waits."""
    if "?" in text:
        return None
    step, now = capture["step"], clock.now()
    reported = capture.get("ownership_id")
    if step == "current_vehicle":
        parsed = sold_delivered.parse_current_vehicle(text)
        if parsed == {}:
            await _set(db, lead_id, {}, unset=["vehicle_capture"])
            return _reply("current_vehicle_captured", "§8: the customer doesn't drive a vehicle now; nothing stored.",
                          "Thanks for letting me know! If we can ever help, just reach out.")
        fields = {**(parsed or {}), "reported_text": text[:200]}
        record = await ownership.upsert_reported_vehicle(db, customer_id=customer_id, lead_id=lead_id,
                                                         ownership_id=None, fields=fields)
        model = (parsed or {}).get("model") or "vehicle"
        await _set(db, lead_id, {"vehicle_capture.step": "duration", "vehicle_capture.ownership_id": str(record["_id"]),
                                 "vehicle_capture.model": model})
        return _reply("current_vehicle_captured", "§8: current vehicle stored as CUSTOMER_REPORTED.",
                      f"Nice! About how long have you had your {model}?")
    if step == "duration":
        await ownership.upsert_reported_vehicle(db, customer_id=customer_id, lead_id=lead_id, ownership_id=reported,
                                                fields=sold_delivered.parse_ownership_duration(text, now=now))
        await _set(db, lead_id, {"vehicle_capture.step": "service_location"})
        model = capture.get("model") or "vehicle"
        return _reply("current_vehicle_captured", "§8: approximate ownership duration stored.",
                      f"Got it. And where do you normally have your {model} serviced?")
    await ownership.upsert_reported_vehicle(db, customer_id=customer_id, lead_id=lead_id, ownership_id=reported,
                                            fields={"normal_service_location": text.strip()[:200]})
    await _set(db, lead_id, {"vehicle_capture.step": None, "vehicle_capture.done_at": now})
    return _reply("current_vehicle_captured", "§8: normal service location stored; capture complete.",
                  f"Thanks{', ' + name if name else ''}! I've made a note of that.")


# --- Lead profile view -------------------------------------------------------------------------------------------

async def lead_view(db: DealerScopedDatabase, lead_id: str, state: dict) -> dict[str, Any]:
    """The new state for GET /v1/leads/{id}/profile (api/leads.py): `opportunity`, `sold_pending`, `ownership`."""
    status = ownership.opportunity_status(state.get("stage"), state.get("previous_stage"))
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    pending = {d["kind"]: d for d in await followups.find(
        {"lead_id": lead_id, "status": "pending", "kind": {"$in": list(LIFECYCLE_KINDS)}}).to_list(None)}
    sp = state.get("sold_pending")
    records = await db.collection(AI_VEHICLE_OWNERSHIP_COLLECTION).find(
        {"$or": [{"lead_id": lead_id}, {"reported_on_lead_id": lead_id}]}).to_list(None)
    customer_id = state.get("customer_id")
    row = await db.collection(AI_CUSTOMER_STATUS_COLLECTION).find_one(
        {"customer_id": str(customer_id)}) if customer_id else None

    def due(kind: str) -> dict | None:
        d = pending.get(kind)
        return {"due_at": _iso(d.get("due_at")), **({"year": d["year"]} if d.get("year") else {}),
                **({"touch": d["touch"]} if d.get("touch") else {})} if d else None

    return {
        "opportunity": {"status": status, "closed": ownership.is_closed(status),
                        "status_changed_at": _iso(state.get("status_changed_at")),
                        "closed_at": _iso(state.get("closed_at")), "closed_reason": state.get("closed_reason"),
                        "sold_delivered_at": _iso(state.get("sold_delivered_at")),
                        "delivery_date": state.get("delivery_date"),
                        "no_longer_owns_at": _iso(state.get("no_longer_owns_at"))},
        "sold_pending": ({k: (_iso(v) if not isinstance(v, list) else
                              [{**e, "at": _iso(e.get("at"))} for e in v]) for k, v in sp.items()}
                         | {"next_touch": due(KIND_SOLD_PENDING_TOUCH)} if sp else None),
        "ownership": {
            "vehicles": [ownership.record_view(r) for r in records],
            "pending": {"post_delivery_checkin": due(KIND_POST_DELIVERY_CHECKIN),
                        "ownership_anniversary": due(KIND_ANNIVERSARY), "birthday": due(KIND_BIRTHDAY),
                        "service_outreach": due(KIND_SERVICE_OUTREACH)},
            "ownership_prompt": {k: _iso(v) for k, v in (state.get("ownership_prompt") or {}).items()} or None,
            "service_offer": {k: _iso(v) for k, v in (state.get("service_offer") or {}).items()} or None,
            "vehicle_capture": {k: _iso(v) for k, v in (state.get("vehicle_capture") or {}).items()} or None,
            "customer_status": ownership.status_view(row),
        },
    }
