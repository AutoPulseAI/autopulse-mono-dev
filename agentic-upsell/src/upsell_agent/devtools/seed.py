"""Loads the local MongoDB with test data for the Debug UI, the scenarios and
the platform (MASTER_PLAN_1 Stages 1 and 6).

Run with:  python -m upsell_agent.devtools.seed      (or: make ai-seed)

Everything lands in the platform's OWN collections, shaped exactly like its
Mongoose models, so both the AI service and the real platform read it:

- 2 dealers as platform `User`s with SMS numbers and mailboxes
  (Sunrise Motors = AI mode `live`, Lakeside Auto = `shadow`)
- 11 customers with DMS history: inventory vehicles, deals, repair orders,
  service appointments and trade-ins, using DealerTrack's column names
- 12 leads covering every lead type, including a returning customer
- one sent campaign with CampaignLead records
- dealer stock for each dealer, shaped like the vAuto feed
  (devtools/dev_inventory.py, MASTER_PLAN_3 Phase 1)

Refuses to run unless ENVIRONMENT=DEV and MONGODB_URI points at a local
database. Re-running first deletes everything it created before (and all AI
data and conversation records for the two dev dealers), so it always starts
from the same state.
"""

import asyncio
import sys
from datetime import timedelta
from urllib.parse import urlparse

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.config import get_settings
from upsell_agent.devtools.dev_inventory import seed_stock
from upsell_agent.devtools.simulate import (
    DEV_DEALERS,
    PLATFORM_EMAIL_ACCOUNTS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    create_customer,
    create_lead,
    ensure_dev_dealers,
    ensure_platform_dealers,
)
from upsell_agent.integrations.mongodb import (
    AI_CONSENT_COLLECTION,
    AI_EVENTS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    PLATFORM_SERVICE_APPOINTMENTS_COLLECTION,
    PLATFORM_TRADE_INS_COLLECTION,
    PLATFORM_VEHICLES_COLLECTION,
    QUALIFICATION_FACTS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    close_mongo,
    ensure_indexes,
    get_db,
    init_mongo,
)
from upsell_agent.integrations.platform_client import DEV_PLATFORM_MESSAGES_COLLECTION

LOCAL_HOSTS = {"localhost", "127.0.0.1", "mongodb", "autopulse-mongo"}
SEEDED_PLATFORM_COLLECTIONS = [
    PLATFORM_CUSTOMERS_COLLECTION, PLATFORM_LEADS_COLLECTION, PLATFORM_VEHICLES_COLLECTION,
    PLATFORM_DEALS_COLLECTION, PLATFORM_REPAIR_ORDERS_COLLECTION, PLATFORM_SERVICE_APPOINTMENTS_COLLECTION,
    PLATFORM_TRADE_INS_COLLECTION, PLATFORM_USERS_COLLECTION, PLATFORM_EMAIL_ACCOUNTS_COLLECTION,
    "campaigns", "campaignleads",
]
# Cleared for the dev dealers by dealer id: AI data, and the platform's
# conversation records (created by the AI service and the platform workers).
DEALER_SCOPED_COLLECTIONS = [
    AI_LEAD_STATE_COLLECTION, AI_MESSAGES_COLLECTION, AI_TURN_LOG_COLLECTION, AI_EVENTS_COLLECTION,
    AI_CONSENT_COLLECTION, SCHEDULED_FOLLOWUPS_COLLECTION, QUALIFICATION_FACTS_COLLECTION, DEV_OUTBOX_COLLECTION,
    DEV_PLATFORM_MESSAGES_COLLECTION, "emails",
]

DEALER_A, DEALER_B = DEV_DEALERS[0]["_id"], DEV_DEALERS[1]["_id"]


def _vin(tag: str) -> str:
    """Stable 17-character dev VIN."""
    return ("DEV" + "".join(c for c in tag.upper() if c.isalnum()) + "0" * 17)[:17]


def owned(tag, year, make, model, trim, *, bought_years_ago, price, salesperson="J. Ortiz",
          services: tuple = ()) -> dict:
    """A vehicle the customer bought here, with its deal and service visits."""
    vin = _vin(tag)
    return {
        "vehicles": [{"vin": vin, "year": year, "make": make, "model": model, "trim": trim}],
        "deals": [{"vin": vin, "years_ago": bought_years_ago, "price": price, "salesperson": salesperson}],
        "repair_orders": [{"vin": vin, "years_ago": ago, "total": total} for ago, total in services],
    }


def serviced(tag, year, make, model, trim, *, visits: tuple, booked: tuple = ()) -> dict:
    """A vehicle bought elsewhere and only serviced here (no deal)."""
    vin = _vin(tag)
    return {
        "vehicles": [{"vin": vin, "year": year, "make": make, "model": model, "trim": trim}],
        "repair_orders": [{"vin": vin, "years_ago": ago, "total": total} for ago, total in visits],
        "appointments": [{"vin": vin, "years_ago": ago, "time": time} for ago, time in booked],
    }


def trade(tag, year, make, model, *, miles, condition) -> dict:
    return {"trade_ins": [{"vin": _vin(tag), "year": year, "make": make, "model": model,
                           "miles": miles, "condition": condition}]}


def merge(*parts: dict) -> dict:
    merged: dict[str, list] = {}
    for part in parts:
        for key, rows in part.items():
            merged.setdefault(key, []).extend(rows)
    return merged


# (dealer, name, lead_type, channel, lead comments, DMS history)
CUSTOMERS = [
    (DEALER_A, "Maria Lopez", "sales", "sms",
     "Hi, interested in a new RAV4 hybrid. What do you have?",
     owned("maria-crv", 2017, "Honda", "CR-V", "EX", bought_years_ago=7, price=21500,
           services=((3, 420), (1.2, 180)))),
    (DEALER_A, "James Carter", "trade_in", "email",
     "Looking to trade in my 2019 Ford F-150, about 60k miles.",
     merge(serviced("james-f150", 2019, "Ford", "F-150", "XLT", visits=((0.4, 65),)),
           trade("james-f150", 2019, "Ford", "F-150", miles=60000, condition="good"))),
    (DEALER_A, "Aisha Khan", "service", "sms",
     "Need my 30k service booked this week.",
     merge(owned("aisha-camry", 2021, "Toyota", "Camry", "SE", bought_years_ago=3, price=27900,
                 services=((1.5, 180),)),
           {"appointments": [{"vin": _vin("aisha-camry"), "years_ago": -0.02, "time": "8:30 AM"}]})),
    (DEALER_A, "Tom Nguyen", "sales", "email",
     "Do you have any used trucks under $35k?", {}),
    (DEALER_A, "Priya Sharma", "general", "sms",
     "Saw your ad, can someone call me?",
     serviced("priya-altima", 2015, "Nissan", "Altima", "S", visits=((2, 95),))),
    (DEALER_A, "Diego Alvarez", "trade_in", "sms",
     "What would you give me for my Jeep?",
     merge(owned("diego-wrangler", 2018, "Jeep", "Wrangler", "Sport", bought_years_ago=6, price=31000),
           trade("diego-wrangler", 2018, "Jeep", "Wrangler", miles=71000, condition="fair"))),
    (DEALER_B, "Emily Chen", "sales", "sms",
     "Interested in the Model Y. Is it still available?",
     owned("emily-cx5", 2016, "Mazda", "CX-5", "Touring", bought_years_ago=8, price=19800, services=((2.5, 240),))),
    (DEALER_B, "Robert King", "service", "email",
     "Check engine light is on, can I bring it in?",
     owned("robert-outback", 2020, "Subaru", "Outback", "Premium", bought_years_ago=4, price=29500,
           services=((0.8, 320),))),
    (DEALER_B, "Sofia Rossi", "trade_in", "email",
     "Thinking about trading my Audi A4 for something bigger.",
     owned("sofia-a4", 2019, "Audi", "A4", "Premium", bought_years_ago=5, price=36500)),
    (DEALER_B, "Kevin Brooks", "general", "sms",
     "hello?", {}),
]

CAMPAIGN_MESSAGE = "Spring Service Event: 20% off all maintenance this month. Reply to book a time!"


def _check_safe_to_seed() -> None:
    settings = get_settings()
    if not settings.is_dev:
        sys.exit("Refusing to seed: ENVIRONMENT must be DEV.")
    host = urlparse(settings.mongodb_uri).hostname or ""
    if host not in LOCAL_HOSTS:
        sys.exit(f"Refusing to seed: MONGODB_URI host {host!r} is not a local database.")


async def reset() -> None:
    db = get_db()
    for name in SEEDED_PLATFORM_COLLECTIONS:
        await db[name].delete_many({"dev_seed": True})
    dealer_ids = [d["_id"] for d in DEV_DEALERS]
    for name in DEALER_SCOPED_COLLECTIONS:
        await db[name].delete_many({"dealer_id": {"$in": dealer_ids}})
    # Leads the platform itself created for the dev dealers (e.g. from a test SMS).
    await db[PLATFORM_LEADS_COLLECTION].delete_many({"dealer_id": {"$in": dealer_ids}})
    await db[PLATFORM_CUSTOMERS_COLLECTION].delete_many({"dealer_id": {"$in": dealer_ids}})
    await db["dev_customer360"].drop()  # Stage 1-5 leftover, no longer used


async def seed() -> dict[str, int]:
    await reset()
    await ensure_dev_dealers()
    await ensure_platform_dealers()
    leads = 0
    campaign_targets: list[tuple[str, str, str]] = []
    for dealer_id, name, lead_type, channel, comments, history in CUSTOMERS:
        created = await create_lead(dealer_id, lead_type=lead_type, channel=channel, name=name,
                                    comments=comments, history=history)
        leads += 1
        if dealer_id == DEALER_A and len(campaign_targets) < 3:
            campaign_targets.append((created["lead_id"], created["customer_id"], name))

    # A returning customer with a second lead, to show history across leads.
    returning = await create_customer(DEALER_B, "Hannah Weber",
                                      owned("hannah-civic", 2014, "Honda", "Civic", "LX", bought_years_ago=10,
                                            price=16200, services=((4, 150), (1, 610))))
    for lead_type, comments in [("service", "Oil change please."), ("sales", "Time for something newer, maybe a CR-V?")]:
        await create_lead(DEALER_B, lead_type=lead_type, channel="sms", name="Hannah Weber",
                          comments=comments, customer_id=returning)
        leads += 1

    campaign_id = ObjectId()
    await get_db()["campaigns"].insert_one({
        "_id": campaign_id, "name": "Spring Service Event (dev)", "description": "Seeded campaign",
        "message_type": "sms", "dealer_id": ObjectId(DEALER_A), "status": "completed",
        "message_content": {"subject": "", "body": CAMPAIGN_MESSAGE},
        "actual_scheduled_date": clock.now() - timedelta(days=2), "dev_seed": True,
    })
    for lead_id, _customer_id, name in campaign_targets:
        await get_db()["campaignleads"].insert_one({
            "campaign_id": str(campaign_id), "name": name, "lead_id": ObjectId(lead_id), "dealer_id": DEALER_A,
            "status": "sent", "sent_at": clock.now() - timedelta(days=2), "dev_seed": True,
        })

    stock = await seed_stock()
    return {"dealers": len(DEV_DEALERS), "customers": len(CUSTOMERS) + 1, "leads": leads,
            "campaigns": 1, "campaign_leads": len(campaign_targets), "stock_vehicles": stock}


async def main() -> None:
    _check_safe_to_seed()
    await init_mongo(get_settings())
    await ensure_indexes()
    try:
        counts = await seed()
    finally:
        await close_mongo()
    print("Seeded:", ", ".join(f"{v} {k}" for k, v in counts.items()))


if __name__ == "__main__":
    asyncio.run(main())
