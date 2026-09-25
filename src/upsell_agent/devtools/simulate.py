"""Plays the platform's role in DEV: creates dealers, customers, their DMS
history and leads in the platform's own collections, then sends events
through the same intake path as real platform events.

Only used by the /dev routes, the seed script, the scenario runner and
tests. Everything written here is tagged `dev_seed: True`. Document shapes
follow aidmvcs-be-dev/app/models/*.js exactly (MASTER_PLAN_1 Stage 6), so
the real platform (Customer 360, the workers, the conversation screen) can
read them too.
"""

import hashlib
from datetime import timedelta

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.events.intake import IntakeResult, accept_event
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.dealer_mode import dealer_ai_mode
from upsell_agent.integrations.mongodb import (
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_EMAIL_ACCOUNTS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    PLATFORM_SERVICE_APPOINTMENTS_COLLECTION,
    PLATFORM_TRADE_INS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    PLATFORM_VEHICLES_COLLECTION,
    as_object_id,
    dealer_scoped_db,
    get_db,
)
from upsell_agent.worker.queue import Enqueue

# Kept for existing imports.
CUSTOMERS_COLLECTION = PLATFORM_CUSTOMERS_COLLECTION
DEV_DEALERS_COLLECTION = "dev_dealers"  # DEV only: display names for the Debug UI

# Dealers A and B are `live` (two, so a burst on one can be checked against
# the other, MASTER_PLAN_1 Stage 12) and C is `shadow` (Stage 13). Like the
# real platform, the simulator reads each dealer's mode: shadow events are
# marked shadow, and an `off` dealer's events are not sent at all.
DEV_DEALERS = [
    {"_id": "66f0000000000000000000a1", "name": "Sunrise Motors (dev)", "sms": "+15550000001",
     "email": "sales@sunrise-motors.dev.test", "ai_mode": "live"},
    {"_id": "66f0000000000000000000b2", "name": "Lakeside Auto (dev)", "sms": "+15550000002",
     "email": "sales@lakeside-auto.dev.test", "ai_mode": "live"},
    {"_id": "66f0000000000000000000c3", "name": "Hillside Cars (dev, shadow)", "sms": "+15550000003",
     "email": "sales@hillside-cars.dev.test", "ai_mode": "shadow"},
]


def _fake_phone(slug: str) -> str:
    """A 555 number, as bare 10 digits: the platform stores Customer phones
    that way (customerResolver normalizePhone). Leads keep E.164, like
    leadworker.js / processSms.js store them."""
    digits = int(hashlib.sha256(slug.encode()).hexdigest(), 16) % 10_000_000
    return f"555{digits:07d}"


def _slug(name: str) -> str:
    return "".join(c for c in name.lower() if c.isalnum()) or "customer"


def _mdy(years_ago: float) -> str:
    """DealerVault's loose "M/D/YYYY" date strings."""
    day = clock.now() - timedelta(days=int(365 * years_ago))
    return f"{day.month}/{day.day}/{day.year}"


async def insert_history(dealer_id: str, customer_id: str, history: dict[str, list[dict]]) -> None:
    """Writes a customer's DMS history into the platform's own collections,
    shaped like the DealerTrack imports (strict:false, TSV column names):

        vehicles:      [{vin, year, make, model, trim}]         -> vehicles (inventory, `dealerId`)
        deals:         [{vin, years_ago, price, salesperson}]    -> deals
        repair_orders: [{vin, years_ago, total}]                 -> repairorders
        appointments:  [{vin, years_ago, time, ro_number?}]      -> serviceappointments
        trade_ins:     [{vin, year, make, model, miles, condition}] -> tradeins
    """
    db = dealer_scoped_db(dealer_id)
    cid = as_object_id(customer_id)
    tag = str(cid)[-6:]
    for i, v in enumerate(history.get("vehicles", [])):
        await db.collection(PLATFORM_VEHICLES_COLLECTION, dealer_field="dealerId").insert_one(
            {"vin": v["vin"], "year": v["year"], "make": v["make"], "model": v["model"], "trim": v.get("trim"),
             "stock_number": f"DEV{tag}{i}", "dev_seed": True, "createdAt": clock.now()})
    for i, d in enumerate(history.get("deals", [])):
        await db.collection(PLATFORM_DEALS_COLLECTION).insert_one(
            {"deal_number": f"D{tag}{i}", "vin": d["vin"], "customer_number": f"C{tag}", "customer_id": cid,
             "Contract Date": _mdy(d["years_ago"]), "Sales Price": f"{d['price']:,}.00",
             "Salesman 1 Name": d["salesperson"], "dev_seed": True, "createdAt": clock.now()})
    for i, r in enumerate(history.get("repair_orders", [])):
        await db.collection(PLATFORM_REPAIR_ORDERS_COLLECTION).insert_one(
            {"ro_number": r.get("ro_number", f"R{tag}{i}"), "vin": r["vin"], "customer_number": f"C{tag}",
             "customer_id": cid, "Open Date": _mdy(r["years_ago"]), "Close Date": _mdy(r["years_ago"]),
             "Total Sale": f"{r['total']:,}.00", "Customer Total Sale": f"{r['total']:,}.00",
             "dev_seed": True, "createdAt": clock.now()})
    for i, a in enumerate(history.get("appointments", [])):
        await db.collection(PLATFORM_SERVICE_APPOINTMENTS_COLLECTION).insert_one(
            {"appointment_number": f"A{tag}{i}", "ro_number": a.get("ro_number"), "vin": a["vin"],
             "customer_id": cid, "Appointment Date": _mdy(a["years_ago"]),
             "Appointment Time": a.get("time", "9:00 AM"), "dev_seed": True, "createdAt": clock.now()})
    for t in history.get("trade_ins", []):
        await db.collection(PLATFORM_TRADE_INS_COLLECTION).insert_one(
            {"customer_id": cid, "vin": t["vin"], "year": t["year"], "make": t["make"], "model": t["model"],
             "miles": t.get("miles"), "condition": t.get("condition"), "status": "open", "dev_seed": True,
             "createdAt": clock.now(), "updatedAt": clock.now()})


async def create_customer(dealer_id: str, name: str, history: dict[str, list[dict]] | None = None) -> str:
    db = dealer_scoped_db(dealer_id)
    customer_id = ObjectId()
    slug = _slug(name)
    await db.collection(PLATFORM_CUSTOMERS_COLLECTION).insert_one(
        {
            "_id": customer_id,
            "name": name,
            "emails": [{"value": f"{slug}@example.test", "is_primary": True}],
            "phones": [{"value": _fake_phone(slug), "is_primary": True, "sms_opt_in": True}],
            "preferred_communication_mode": "sms",
            "inbound_lead": True,
            "assignment_history": [],
            "extra": {},
            "dev_seed": True,
            "createdAt": clock.now(),
        }
    )
    if history:
        await insert_history(dealer_id, str(customer_id), history)
    return str(customer_id)


async def create_lead(
    dealer_id: str,
    *,
    lead_type: str,
    channel: str,
    name: str,
    comments: str,
    customer_id: str | None = None,
    history: dict[str, list[dict]] | None = None,
) -> dict[str, str]:
    """Creates the platform-side Lead (and Customer, unless one is given)."""
    db = dealer_scoped_db(dealer_id)
    customer_id = customer_id or await create_customer(dealer_id, name, history)
    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(customer_id)})
    lead_id = ObjectId()
    await db.collection(PLATFORM_LEADS_COLLECTION).insert_one(
        {
            "_id": lead_id,
            "name": name,
            "email": (customer or {}).get("emails", [{}])[0].get("value"),
            "phone": "+1" + (customer or {}).get("phones", [{}])[0].get("value", ""),
            "source": f"dev-{lead_type}-{channel}",
            "customer_id": as_object_id(customer_id),
            "followup_preference": channel,
            "comments": comments,
            "data": {"lead_type": lead_type, "comments": comments, "channel": channel},
            "statusChangedAt": clock.now(),
            "createdAt": clock.now(),
            "dev_seed": True,
        }
    )
    return {"lead_id": str(lead_id), "customer_id": customer_id}


async def _platform_routing(dealer_id: str) -> tuple[bool, bool]:
    """(send the event?, shadow?) exactly as the platform decides it
    (aidmvcs-be-dev/app/lib/ai/aiMode.js aiRouting). A dealer with no platform
    record (unit tests) is treated as live."""
    dealer = await get_db()[PLATFORM_USERS_COLLECTION].find_one({"_id": as_object_id(dealer_id)}, {"_id": 1})
    if dealer is None:
        return True, False
    mode = await dealer_ai_mode(dealer_id)
    return mode != "off", mode == "shadow"


async def send_lead_created(dealer_id: str, lead_id: str, customer_id: str, channel: str,
                            enqueue: Enqueue, event_id: str | None = None) -> IntakeResult:
    send, shadow = await _platform_routing(dealer_id)
    if not send:
        return IntakeResult(status="skipped")
    event = LeadCreatedEvent(event_id=event_id or lead_id, dealer_id=dealer_id, lead_id=lead_id,
                             customer_id=customer_id, channel=channel, shadow=shadow)
    return await accept_event("lead-created", event, enqueue)


async def send_reply(dealer_id: str, lead_id: str, channel: str, text: str, enqueue: Enqueue) -> IntakeResult:
    lead = await dealer_scoped_db(dealer_id).collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
    if lead is None:
        raise LookupError(f"lead {lead_id} not found for dealer {dealer_id}")
    send, shadow = await _platform_routing(dealer_id)
    if not send:
        return IntakeResult(status="skipped")
    message_id = str(ObjectId())
    event = InboundMessageEvent(
        event_id=message_id, dealer_id=dealer_id, customer_id=str(lead["customer_id"]), lead_id=lead_id,
        channel=channel, message_id=message_id, text=text, received_at=clock.now(), shadow=shadow,
    )
    return await accept_event("inbound-message", event, enqueue)


async def ensure_dev_dealers() -> None:
    """Display names for the Debug UI (DEV-only collection)."""
    for dealer in DEV_DEALERS:
        await get_db()[DEV_DEALERS_COLLECTION].update_one(
            {"_id": dealer["_id"]}, {"$set": {"name": dealer["name"]}}, upsert=True)


async def ensure_platform_dealers() -> None:
    """The dev dealers as real platform records: a `User` of type dealer
    (with its SMS number, auto-reply on, a valid subscription and its AI
    mode) and an `EmailAccount`, so the platform's workers, SMS webhook and
    record-message endpoint all recognise them."""
    db = get_db()
    for dealer in DEV_DEALERS:
        oid = ObjectId(dealer["_id"])
        await db[PLATFORM_USERS_COLLECTION].update_one({"_id": oid}, {"$set": {
            "email": f"dealer-{dealer['_id'][-2:]}@autopulse.dev.test", "name": dealer["name"],
            # Not a real password hash: dev dealers are never logged into.
            "password": "!dev-seed-account-no-login", "type": "dealer",
            "dealer_account_information": {"sms_conversion_phone": dealer["sms"], "time_zone": "America/New_York"},
            "setting": {"autoReplyEnabled": True},
            "package_expiry": clock.now() + timedelta(days=365),
            "ai_mode": dealer["ai_mode"], "dev_seed": True,
        }}, upsert=True)
        await db[PLATFORM_EMAIL_ACCOUNTS_COLLECTION].update_one({"dealer_id": oid}, {"$set": {
            "dealer_id": oid, "account_name": f"{dealer['name']} sales", "event_type": "Sales",
            "email_address": dealer["email"], "email_password": "!dev-seed", "active": True, "dev_seed": True,
        }}, upsert=True)
