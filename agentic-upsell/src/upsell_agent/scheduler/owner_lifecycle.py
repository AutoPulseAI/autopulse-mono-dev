"""The owner life cycle for every DealerVault sale, wired into the scheduler (client, 8 Oct 2026 meeting; the
rules and wording are agent/owner_touches.py).

**Planning** (`sweep`, daily from the worker): every delivered deal in the platform's `deals` (DealerVault's
sales file) with a customer gets one row in `ai_owner_lifecycle` and, at most, one pending `owner_touch` in
`scheduled_followups`: its next touch. A customer's birthday is one more pending `owner_touch` per customer.

**Which lead it goes out on.** Every message the AI sends lives in a CRM lead's conversation, so an owner touch
rides on the customer's most recent lead. A DealerVault customer with no lead in the CRM is counted (`no_lead`)
and skipped: the CRM would have to create an owner lead for them first (not done here; client to decide).

**What a CRM-sold car already has.** A car sold on a CRM lead (Sold - Delivered) gets its anniversary and
birthday from scheduler/sold_lifecycles.py; here it gets only the touches that lifecycle doesn't send.

**Firing** (`fire`, from followups.fire_one under the lead lock) re-checks right before sending: the dealer is
live, the customer still owns the car, staff aren't talking to them, the lead isn't in an active sales
conversation (then it waits a week - one controlling workflow), and the send check (consent, quiet hours).
Text and email together, like every lifecycle message.
"""

import logging
from datetime import timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import lifecycle, owner_touches, ownership, sold_delivered
from upsell_agent.compliance import text_consent
from upsell_agent.integrations.dealer_mode import dealer_ai_mode
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_CUSTOMER_STATUS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_OWNER_LIFECYCLE_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.observability.trace import TurnTracer

logger = logging.getLogger(__name__)

KIND = "owner_touch"
ACTIVE_SALES = lifecycle.WORKING | {lifecycle.Stage.APPOINTMENT_SET, lifecycle.Stage.NO_SHOW,
                                    lifecycle.Stage.SOLD_PENDING}
SALES_DEFER = timedelta(days=7)
# A repair order's follow-up is keyed like a deal's, with this prefix (one row, one touch per RO).
RO_PREFIX = "ro:"
# Only repair orders closed this recently are followed up (an old RO's recommendation is stale).
RO_LOOKBACK = timedelta(days=60)
STAFF_DEFER = timedelta(days=1)


async def anchor_lead(db: DealerScopedDatabase, customer_id: str) -> dict | None:
    """The customer's most recent CRM lead."""
    rows = await db.collection(PLATFORM_LEADS_COLLECTION).find(
        {"customer_id": {"$in": [as_object_id(customer_id), customer_id]}}).to_list(500)
    if not rows:
        return None
    return max(rows, key=lambda r: str(r["_id"]))  # ObjectIds sort by creation time


async def lead_for_owner(db: DealerScopedDatabase, customer_id: str, deal_number: str | None = None) -> dict | None:
    """The customer's latest CRM lead; with none, the CRM creates their owner lead (client, 9 Oct 2026; aidmvcs-be-dev
    app/lib/ai/aiOwnerLead.js: "Sold Delivered", source DealerVault). The AI marks it as an owner at once
    (stage Sold - Delivered), so reconciliation never takes it for a new sales lead and no sales cadence starts."""
    lead = await anchor_lead(db, customer_id)
    if lead is not None:
        return lead
    from upsell_agent.config import get_settings
    from upsell_agent.integrations.platform_client import get_platform_client

    lead_id = await get_platform_client(get_settings()).ensure_owner_lead(db.dealer_id, customer_id, deal_number)
    if not lead_id:
        return None
    now = clock.now()
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$setOnInsert": {"lead_id": lead_id, "customer_id": customer_id, "stage": lifecycle.Stage.SOLD_DELIVERED.value,
                          "status": "active", "owner_lead": True, "stage_source": "owner_lifecycle",
                          "created_at": now, "stage_at": now}}, upsert=True)
    return await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)}) or {"_id": lead_id}


async def _crm_sold(db: DealerScopedDatabase, customer_id: str, vin: str | None) -> bool:
    if not vin:
        return False
    return any(r.get("vehicle_source") == ownership.SOURCE_DEALER_SALE
               for r in await ownership.find_by_vin(db, vin, customer_id))


async def _no_longer_owned(db: DealerScopedDatabase, customer_id: str, vin: str | None) -> bool:
    if not vin:
        return False
    return any(r.get("ownership_status") == ownership.VEHICLE_NO_LONGER_OWNED
               for r in await ownership.find_by_vin(db, vin, customer_id))


async def _plan(db: DealerScopedDatabase, *, lead_id: str, customer_id: str, touch: str, key: str, due,
                deal_number: str | None, extra: dict | None = None) -> dict[str, Any]:
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    scope = {"kind": KIND, "status": "pending", "customer_id": customer_id,
             **({"deal_number": deal_number} if deal_number else {"touch": owner_touches.TOUCH_BIRTHDAY})}
    existing = await followups.find_one(scope)
    if existing and existing.get("dedupe_key") == key and existing.get("lead_id") == lead_id:
        return {"created": False, "reason": "already planned", "touch": touch}
    now = clock.now()
    await followups.update_many(scope, {"$set": {"status": "superseded", "reason": "a newer owner touch",
                                                 "closed_at": now}})
    doc = {"kind": KIND, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": f"{KIND}-plan",
           "from_channel": "sms", "to_channel": "sms", "text": None, "subject": None, "status": "pending",
           "due_at": max(due, now), "created_at": now, "claim_count": 0, "touch": touch, "dedupe_key": key,
           "deal_number": deal_number, "reason": None, **(extra or {})}
    inserted = await followups.insert_one(doc)
    return {"created": True, "touch": touch, "followup_id": str(inserted.inserted_id), "due_at": doc["due_at"]}


async def plan_deal(db: DealerScopedDatabase, row: dict[str, Any]) -> dict[str, Any]:
    """The next touch for one DealerVault deal."""
    customer_id = str(row.get("customer_id") or "")
    if not customer_id or not owner_touches.is_delivered(row):
        return {"planned": False, "reason": "not a delivered deal with a customer"}
    deal = owner_touches.read_deal(row)
    rows = db.collection(AI_OWNER_LIFECYCLE_COLLECTION)
    state = await rows.find_one({"deal_number": deal.deal_number}) or {}
    if state.get("stopped"):
        return {"planned": False, "reason": state.get("stopped")}
    if await _no_longer_owned(db, customer_id, deal.vin):
        await rows.update_one({"deal_number": deal.deal_number}, {"$set": {"stopped": "no longer owns the car"}},
                              upsert=True)
        return {"planned": False, "reason": "no longer owns the car"}
    lead = await lead_for_owner(db, customer_id, deal.deal_number)
    now = clock.now()
    await rows.update_one({"deal_number": deal.deal_number}, {
        "$set": {"customer_id": customer_id, "vin": deal.vin, "deal_type": deal.deal_type,
                 "delivery_date": deal.delivery_date.isoformat() if deal.delivery_date else None,
                 "contract_end": deal.contract_end.isoformat() if deal.contract_end else None,
                 "lead_id": str(lead["_id"]) if lead else None, "checked_at": now},
        "$setOnInsert": {"deal_number": deal.deal_number, "sent": [], "created_at": now}}, upsert=True)
    if lead is None:
        return {"planned": False, "reason": "no_lead"}
    skip = frozenset({owner_touches.TOUCH_ANNIVERSARY}) if await _crm_sold(db, customer_id, deal.vin) else frozenset()
    profile = await dealer_profile(db.dealer_id)
    found = owner_touches.next_vehicle_touch(deal, sent=set(state.get("sent") or []), now=now, tz=profile.tz,
                                             skip=skip)
    if found is None:
        return {"planned": False, "reason": "every touch for this deal is sent or past"}
    touch, key, due = found
    made = await _plan(db, lead_id=str(lead["_id"]), customer_id=customer_id, touch=touch, key=key, due=due,
                       deal_number=deal.deal_number)
    return {"planned": made["created"], **made}


async def plan_repair_order(db: DealerScopedDatabase, ro: dict[str, Any]) -> dict[str, Any]:
    """Service not sold (client, 8 Oct 2026): a closed repair order with the technicians' recommendations gets one
    follow-up DECLINED_FOLLOWUP_DAYS later, quoting them word for word."""
    customer_id = str(ro.get("customer_id") or "")
    items = owner_touches.recommendations(ro)
    if not customer_id or not items:
        return {"planned": False, "reason": "no customer or no recommendations"}
    key = f"{RO_PREFIX}{ro.get('ro_number') or ro.get('RO Number')}"
    rows = db.collection(AI_OWNER_LIFECYCLE_COLLECTION)
    state = await rows.find_one({"deal_number": key}) or {}
    if state.get("sent") or state.get("stopped"):
        return {"planned": False, "reason": "already followed up"}
    profile = await dealer_profile(db.dealer_id)
    due = owner_touches.declined_due(ro, profile.tz)
    now = clock.now()
    if due is None or due + owner_touches.LATE_GRACE < now:
        return {"planned": False, "reason": "no close date, or too long ago"}
    lead = await lead_for_owner(db, customer_id, key)
    await rows.update_one({"deal_number": key}, {
        "$set": {"customer_id": customer_id, "vin": ro.get("vin"), "kind": "repair_order", "recommendations": items,
                 "close_date": ro.get("Close Date"), "lead_id": str(lead["_id"]) if lead else None,
                 "checked_at": now},
        "$setOnInsert": {"deal_number": key, "sent": [], "created_at": now}}, upsert=True)
    if lead is None:
        return {"planned": False, "reason": "no_lead"}
    made = await _plan(db, lead_id=str(lead["_id"]), customer_id=customer_id, touch=owner_touches.TOUCH_DECLINED,
                       key=owner_touches.TOUCH_DECLINED, due=due, deal_number=key, extra={"items": items})
    return {"planned": made["created"], **made}


async def _came_back(db: DealerScopedDatabase, life: dict | None) -> bool:
    """A later repair order for the same car: they've been back since, so the old recommendation isn't chased."""
    if not life or not life.get("vin") or not life.get("close_date"):
        return False
    closed = owner_touches._date(life["close_date"])
    for ro in await db.collection(PLATFORM_REPAIR_ORDERS_COLLECTION).find({"vin": life["vin"]}).to_list(200):
        opened = owner_touches._date(ro.get("Open Date")) or owner_touches._date(ro.get("Close Date"))
        if opened and closed and opened > closed:
            return True
    return False


async def plan_birthday(db: DealerScopedDatabase, customer_id: str) -> dict[str, Any]:
    """The customer's next birthday, once per customer, unless the SOLD - DELIVERED lifecycle already has it."""
    from upsell_agent.scheduler import sold_lifecycles

    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    if await followups.find_one({"customer_id": customer_id, "kind": sold_lifecycles.KIND_BIRTHDAY,
                                 "status": "pending"}):
        return {"planned": False, "reason": "the Sold - Delivered lifecycle sends it"}
    customer, records = await sold_lifecycles._birthday_records(db, customer_id)
    verified = sold_delivered.verified_birthday(customer, records)
    if not verified:
        return {"planned": False, "reason": "no verified birth month/day (never inferred)"}
    lead = await anchor_lead(db, customer_id)
    if lead is None:
        return {"planned": False, "reason": "no_lead"}
    profile = await dealer_profile(db.dealer_id)
    due = sold_delivered.next_birthday(verified["month"], verified["day"], now=clock.now(), tz=profile.tz)
    row = await db.collection(AI_CUSTOMER_STATUS_COLLECTION).find_one({"customer_id": customer_id}) or {}
    if (row.get("birthday") or {}).get("last_sent_year") == due.year:
        due = sold_delivered.at_touch_hour(sold_delivered._on(due.year + 1, verified["month"], verified["day"]),
                                           profile.tz)
    made = await _plan(db, lead_id=str(lead["_id"]), customer_id=customer_id, touch=owner_touches.TOUCH_BIRTHDAY,
                       key=f"{owner_touches.TOUCH_BIRTHDAY}:{due.year}", due=due, deal_number=None,
                       extra={"year": due.year})
    return {"planned": made["created"], **made}


async def sweep(*, limit: int = 20000) -> dict[str, Any]:
    """Daily (worker cron). Cross-dealer by design, like the birthday sweep; each deal in its own dealer's scope.
    Only dealers whose AI is live are planned for."""
    summary: dict[str, Any] = {"deals": 0, "planned": 0, "no_lead": 0, "birthdays": 0, "declined_services": 0,
                               "dealers_off": 0}
    modes: dict[str, str] = {}
    customers: set[tuple[str, str]] = set()
    async for row in get_db()[PLATFORM_DEALS_COLLECTION].find(
            {"customer_id": {"$ne": None}, "Delivery Date": {"$nin": [None, ""]}}).limit(limit):
        dealer_id = str(row.get("dealer_id") or "")
        if not dealer_id:
            continue
        if dealer_id not in modes:
            modes[dealer_id] = await dealer_ai_mode(dealer_id)
        if modes[dealer_id] != "live":
            summary["dealers_off"] += 1
            continue
        db = dealer_scoped_db(dealer_id)
        summary["deals"] += 1
        try:
            out = await plan_deal(db, row)
        except Exception:
            logger.exception("owner touch planning failed for deal %s", row.get("deal_number"))
            continue
        summary["planned"] += int(bool(out.get("planned")))
        summary["no_lead"] += int(out.get("reason") == "no_lead")
        customers.add((dealer_id, str(row["customer_id"])))
    since = clock.now() - RO_LOOKBACK
    async for ro in get_db()[PLATFORM_REPAIR_ORDERS_COLLECTION].find(
            {"customer_id": {"$ne": None}, "$or": [{"Recommendations": {"$nin": [None, ""]}},
                                                   {"service_operations.recommendations": {"$exists": True}}]}
    ).limit(limit):
        dealer_id = str(ro.get("dealer_id") or "")
        if not dealer_id:
            continue
        if dealer_id not in modes:
            modes[dealer_id] = await dealer_ai_mode(dealer_id)
        closed = owner_touches._date(ro.get("Close Date"))
        if modes[dealer_id] != "live" or closed is None or owner_touches.as_utc(closed) < since:
            continue
        try:
            out = await plan_repair_order(dealer_scoped_db(dealer_id), ro)
        except Exception:
            logger.exception("declined-service planning failed for RO %s", ro.get("ro_number"))
            continue
        summary["declined_services"] = summary.get("declined_services", 0) + int(bool(out.get("planned")))
        summary["no_lead"] += int(out.get("reason") == "no_lead")
    for dealer_id, customer_id in customers:
        try:
            out = await plan_birthday(dealer_scoped_db(dealer_id), customer_id)
            summary["birthdays"] += int(bool(out.get("planned")))
        except Exception:
            logger.exception("birthday planning failed for customer %s", customer_id)
    return summary


async def fire(db: DealerScopedDatabase, doc: dict, deps: Any) -> str:
    from upsell_agent.scheduler.followups import _close, _log, _permitted_channel
    from upsell_agent.scheduler.sold_lifecycles import (
        SILENT,
        STAFF_RECENT,
        _aware,
        _birthday_records,
        _customer,
        _lead,
        _name,
        _requeue,
        _send_both,
        _state,
    )

    touch, doc_id, now = doc.get("touch"), str(doc["_id"]), clock.now()
    tracer = TurnTracer(sink=deps.sink, dealer_id=db.dealer_id, lead_id=doc["lead_id"],
                        customer_id=doc["customer_id"], trigger=f"{KIND}:{touch}", channel=doc["to_channel"],
                        store_prompts=deps.store_prompts,
                        turn_id=f"{KIND}-check-{doc_id}-fire{int(doc.get('claim_count') or 1)}")
    await tracer.start({"followup_id": doc_id, "touch": touch, "deal_number": doc.get("deal_number")})
    lead = await _lead(db, doc["lead_id"])
    customer = await _customer(db, doc["customer_id"])
    state = await _state(db, doc["lead_id"])
    life = await db.collection(AI_OWNER_LIFECYCLE_COLLECTION).find_one(
        {"deal_number": doc["deal_number"]}) if doc.get("deal_number") else None
    stage = lifecycle.stage_of(state.get("stage"))

    is_ro = str(doc.get("deal_number") or "").startswith(RO_PREFIX)

    async def replan() -> None:
        if is_ro:
            return  # one follow-up per repair order
        if doc.get("deal_number"):
            row = await db.collection(PLATFORM_DEALS_COLLECTION).find_one({"deal_number": doc["deal_number"]})
            if row:
                await plan_deal(db, row)
        else:
            await plan_birthday(db, doc["customer_id"])

    async with tracer.node(KIND, {"followup_id": doc_id, "touch": touch}) as span:
        mode = await dealer_ai_mode(db.dealer_id)
        checks = [("dealer_live", mode == "live", f"dealer AI mode is {mode}"),
                  ("not_opted_out", stage != lifecycle.Stage.OPTED_OUT, "the customer opted out"
                   if stage == lifecycle.Stage.OPTED_OUT else "no opt-out on the lead"),
                  ("owned", not (life or {}).get("stopped") and not await _no_longer_owned(
                      db, doc["customer_id"], (life or {}).get("vin")),
                   "the customer still owns the car")]
        if is_ro:
            back = await _came_back(db, life)
            checks.append(("not_back_since", not back, "they've had a service visit since" if back
                           else "no service visit since"))
        if touch == owner_touches.TOUCH_BIRTHDAY:
            c, records = await _birthday_records(db, doc["customer_id"])
            ok = sold_delivered.verified_birthday(c, records) is not None
            checks.append(("birthday_verified", ok, "verified birth month/day" if ok else "no longer verified"))
        failed = [c for c in checks if not c[1]]
        staff_at = _aware(state.get("status_at") or state.get("paused_at"))
        staff_busy = state.get("status") in SILENT and staff_at is not None and now - staff_at < STAFF_RECENT
        selling = stage in ACTIVE_SALES and touch != owner_touches.TOUCH_BIRTHDAY
        check = None
        if not failed and not staff_busy and not selling:
            ch, check = await _permitted_channel(dealer_id=db.dealer_id, customer_id=doc["customer_id"],
                                                 lead_id=doc["lead_id"], channel=doc["to_channel"], at=None,
                                                 lead=lead, customer=customer, purpose="marketing")
            doc = {**doc, "to_channel": ch}
            checks.append(("send_check", check.outcome == "ALLOW", f"{ch}: {check.summary()}"))
        decision = ("cancel" if failed else "staff talking" if staff_busy else "in a sales conversation"
                    if selling else "send" if check.outcome == "ALLOW" else check.outcome.lower())
        span.output = {"checks": [{"check": c, "passed": ok, "detail": d} for c, ok, d in checks],
                       "decision": decision}
        span.edge_label = decision

    if failed:
        await _close(db, doc, "cancelled", reason=failed[0][2])
        await _log(db, tracer, f"{KIND}_cancelled", {"followup_id": doc_id, "reason": failed[0][2]})
        return "cancelled"
    if staff_busy or selling:
        reason = ("staff are talking to the customer" if staff_busy else
                  f"the lead is in an active sales conversation ({lifecycle.label(stage.value)})")
        await _requeue(db, doc, now + (STAFF_DEFER if staff_busy else SALES_DEFER), f"{reason}: tried again later")
        await _log(db, tracer, f"{KIND}_deferred", {"followup_id": doc_id, "reason": reason})
        return "deferred"
    if check.outcome == "HOLD" and check.until:
        await _requeue(db, doc, check.until, f"held by the send check: {check.reason}")
        await _log(db, tracer, f"{KIND}_deferred", {"followup_id": doc_id, "reason": check.reason})
        return "deferred"

    async def mark_sent() -> None:
        if doc.get("deal_number"):
            await db.collection(AI_OWNER_LIFECYCLE_COLLECTION).update_one(
                {"deal_number": doc["deal_number"]}, {"$addToSet": {"sent": doc["dedupe_key"]},
                                                      "$set": {f"last_{touch}_at": now}})
        else:
            await db.collection(AI_CUSTOMER_STATUS_COLLECTION).update_one(
                {"customer_id": doc["customer_id"]},
                {"$set": {"birthday.last_sent_year": doc.get("year"), "birthday.last_sent_at": now},
                 "$setOnInsert": {"customer_id": doc["customer_id"], "created_at": now}}, upsert=True)

    if check.outcome != "ALLOW":
        await _close(db, doc, "suppressed", reason=f"{check.outcome}: {check.reason}")
        await mark_sent()  # not sent, but its moment is gone: the next touch is planned
        await replan()
        await _log(db, tracer, f"{KIND}_suppressed", {"followup_id": doc_id, "reason": check.reason})
        return "suppressed"

    profile = await dealer_profile(db.dealer_id)
    row = await db.collection(PLATFORM_DEALS_COLLECTION).find_one(
        {"deal_number": doc["deal_number"]}) if doc.get("deal_number") and not is_ro else None
    vehicle = owner_touches.read_deal(row).vehicle() if row else None
    if is_ro:
        ro = await db.collection(PLATFORM_REPAIR_ORDERS_COLLECTION).find_one(
            {"ro_number": doc["deal_number"][len(RO_PREFIX):]}) or {}
        vehicle = {"year": ro.get("Year"), "make": ro.get("Make"), "model": ro.get("Model"), "vin": ro.get("vin")}
    key = str(doc.get("dedupe_key") or "")
    text = owner_touches.render(touch, first_name=_name(customer, lead), dealership=profile.name, vehicle=vehicle,
                                tip_number=int(key.split(":")[1]) if touch == owner_touches.TOUCH_TIP else 0,
                                year=int(key.split(":")[1]) if touch == owner_touches.TOUCH_ANNIVERSARY else 1,
                                items=doc.get("items"))
    invited = False
    if doc["to_channel"] == "email" and not await text_consent.has_text_consent(db, doc["customer_id"]):
        # Client, 9 Oct 2026: no text consent, so this goes by email - and the email asks for it (never a text).
        from upsell_agent.channels.dealer_identity import dealer_identity
        if line := text_consent.invite_line((await dealer_identity(db.dealer_id)).sms_from):
            text = {**text, "email_body": f"{text['email_body']}\n\n{line}"}
            invited = True
    outcomes = await _send_both(db, deps, tracer, doc, text, "marketing")
    if invited and any(o.channel == "email" and o.status in ("sent", "duplicate") for o in outcomes):
        from upsell_agent.scheduler.sold_lifecycles import _set
        await _set(db, doc["lead_id"], {"text_consent_invited_at": now})
    from upsell_agent.learning import touches
    await touches.record_touch(db, touch_id=f"{KIND}-{doc_id}", lead_id=doc["lead_id"],
                               customer_id=doc["customer_id"], kind=KIND, outcomes=outcomes, theme=touch)
    delivered = any(o.status in ("sent", "duplicate") for o in outcomes)
    if not delivered and any(o.status == "held" for o in outcomes):
        await _requeue(db, doc, now + timedelta(seconds=30), "held by the send check at send time; checking again")
        return "deferred"
    if delivered and is_ro:
        # A "yes" is a service request with notes for the service team, like any service offer (never a booking).
        from upsell_agent.scheduler.sold_lifecycles import _set
        await _set(db, doc["lead_id"], {"service_offer": {
            "kind": owner_touches.TOUCH_DECLINED, "asked_at": now, "status": "offered",
            "facts": {"recommendations": doc.get("items"), "source": "repair order recommendations"}}})
    status = "sent" if delivered else (outcomes[0].status if outcomes else "failed")
    await _close(db, doc, status, reason=None, fired_at=now)
    await mark_sent()
    await replan()
    await _log(db, tracer, f"{KIND}_{status}", {"followup_id": doc_id, "touch": touch,
                                                "sent": [{"channel": o.channel, "status": o.status}
                                                         for o in outcomes]})
    return status


async def view(db: DealerScopedDatabase, customer_id: str) -> list[dict[str, Any]]:
    """The customer's owner-lifecycle rows, for the customer profile."""
    out = []
    for row in await db.collection(AI_OWNER_LIFECYCLE_COLLECTION).find({"customer_id": customer_id}).to_list(50):
        nxt = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find_one(
            {"kind": KIND, "status": "pending", "deal_number": row.get("deal_number")})
        out.append({"deal_number": row.get("deal_number"), "vin": row.get("vin"), "deal_type": row.get("deal_type"),
                    "delivery_date": row.get("delivery_date"), "contract_end": row.get("contract_end"),
                    "sent": row.get("sent") or [], "stopped": row.get("stopped"),
                    "next": {"touch": nxt.get("touch"), "due_at": nxt["due_at"].isoformat()} if nxt else None})
    return out


__all__ = ["KIND", "fire", "plan_birthday", "plan_deal", "sweep", "view"]
