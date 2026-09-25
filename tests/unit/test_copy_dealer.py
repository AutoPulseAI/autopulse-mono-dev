"""DEV copy of one dealer's data (MASTER_PLAN_1 Stage 13): only that dealer,
only recent leads, no passwords, contacts masked consistently, and the source
is never written to."""

from datetime import timedelta

from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

from upsell_agent import clock
from upsell_agent.devtools import simulate
from upsell_agent.devtools.copy_dealer import Masker, copy_dealer
from upsell_agent.integrations import mongodb
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_EMAIL_ACCOUNTS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
)

DEALER = simulate.DEV_DEALERS[0]["_id"]
OTHER = simulate.DEV_DEALERS[1]["_id"]
DEALER_SMS = "+15550000001"


async def _source_with_data():
    source = AsyncMongoMockClient()["prod_like"]
    previous = mongodb._db
    mongodb.set_db_for_tests(source)
    try:
        await simulate.ensure_platform_dealers()
        await source[PLATFORM_USERS_COLLECTION].update_one({"_id": ObjectId(DEALER)},
                                                           {"$set": {"password": "$2b$real-hash"}})
        recent = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Real",
                                            comments="Is the RAV4 available?",
                                            history={"vehicles": [{"vin": "VIN0000000000001", "year": 2019,
                                                                   "make": "Honda", "model": "Civic"}],
                                                     "deals": [{"vin": "VIN0000000000001", "years_ago": 3,
                                                                "price": 21000, "salesperson": "Pat"}]})
        old = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Old Lead", comments="hi")
        await source[PLATFORM_LEADS_COLLECTION].update_one(
            {"_id": ObjectId(old["lead_id"])}, {"$set": {"createdAt": clock.now() - timedelta(days=30)}})
        other = await simulate.create_lead(OTHER, lead_type="sales", channel="sms", name="Other Dealer",
                                           comments="hi")
        lead = await source[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(recent["lead_id"])})
        await source["emails"].insert_many([
            {"dealer_id": DEALER, "lead_id": lead["_id"], "status": "received", "communication_type": "sms",
             "sender": lead["phone"], "recipient": DEALER_SMS, "mail_content": "Is it blue?",
             "timestamp": clock.now()},
            {"dealer_id": DEALER, "lead_id": lead["_id"], "status": "sent", "communication_type": "sms",
             "sender": DEALER_SMS, "recipient": lead["phone"], "mail_content": "Yes it is (n8n)",
             "timestamp": clock.now()},
        ])
        await source[AI_MESSAGES_COLLECTION].insert_one(
            {"dealer_id": DEALER, "lead_id": recent["lead_id"], "direction": "outbound", "status": "shadow",
             "to": lead["phone"], "text": "draft", "turn_id": "t1", "created_at": clock.now()})
    finally:
        mongodb.set_db_for_tests(previous)
    return source, recent, old, other


async def test_copies_only_this_dealers_recent_data_masked_and_without_passwords(mongo):
    source, recent, old, other = await _source_with_data()
    before = {name: await source[name].count_documents({}) for name in await source.list_collection_names()}
    dest = AsyncMongoMockClient()["dev"]

    counts = await copy_dealer(source, dest, DEALER, days=7)

    assert counts["leads"] == 1 and counts["customers"] == 1 and counts["emails"] == 2
    assert counts["deals"] == 1 and counts["vehicles"] == 1 and counts[AI_MESSAGES_COLLECTION] == 1
    assert await dest[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(old["lead_id"])}) is None
    assert await dest[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(other["lead_id"])}) is None

    dealer = await dest[PLATFORM_USERS_COLLECTION].find_one({"_id": ObjectId(DEALER)})
    assert dealer["password"] == "!dev-copy-no-login" and dealer["ai_mode"] == "live"
    account = await dest[PLATFORM_EMAIL_ACCOUNTS_COLLECTION].find_one({})
    assert account["email_password"] == "!dev-copy"

    source_lead = await source[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(recent["lead_id"])})
    lead = await dest[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(recent["lead_id"])})
    customer = await dest[PLATFORM_CUSTOMERS_COLLECTION].find_one({})
    assert lead["phone"] != source_lead["phone"] and lead["phone"].startswith("+1555")
    assert lead["email"].endswith("@masked.invalid")
    assert customer["phones"][0]["value"] == lead["phone"][2:]          # same customer, same masked number
    assert customer["emails"][0]["value"] == lead["email"]
    received = await dest["emails"].find_one({"status": "received"})
    assert received["sender"] == lead["phone"] and received["recipient"] == DEALER_SMS   # dealer number kept
    assert received["mail_content"] == "Is it blue?"
    ai = await dest[AI_MESSAGES_COLLECTION].find_one({})
    assert ai["to"] == lead["phone"]

    after = {name: await source[name].count_documents({}) for name in await source.list_collection_names()}
    assert after == before  # the source was only read


async def test_copy_can_keep_real_contacts_when_asked(mongo):
    source, recent, _, _ = await _source_with_data()
    dest = AsyncMongoMockClient()["dev"]
    await copy_dealer(source, dest, DEALER, days=7, mask=False)
    source_lead = await source[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(recent["lead_id"])})
    lead = await dest[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(recent["lead_id"])})
    assert lead["phone"] == source_lead["phone"]


def test_masker_is_consistent_and_keeps_formats():
    masker = Masker({"+15550000001", "sales@dealer.test"})
    assert masker.phone("+15557654321") == masker.phone("+15557654321") != "+15557654321"
    assert masker.phone("5557654321") == masker.phone("+15557654321")[2:]
    assert masker.phone("+15550000001") == "+15550000001"
    assert masker.address("Jane Doe <jane@example.test>") == f"Jane Doe <{masker.email('jane@example.test')}>"
    assert masker.address("sales@dealer.test") == "sales@dealer.test"
