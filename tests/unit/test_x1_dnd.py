"""PLAN_4 stream X1 item 6: a dealer's DND on one lead suppresses that customer, phone and email across the
dealer's leads, including a re-import under a new customer id (TCPA PDF §12 "Deleted/reimported records")."""

import pytest
from bson import ObjectId

from tests.unit.conftest import set_clock
from tests.unit.test_compliance import DEALER, _check, _lead, ny
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import (
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
)


@pytest.fixture
async def dealers(mongo):
    await simulate.ensure_platform_dealers()


async def _dnd(mongo, created):
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                      {"$set": {"fe_lead_status": "DND"}})


async def _contact(mongo, created):
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": ObjectId(created["lead_id"])})
    return lead["phone"], lead["email"]


@pytest.mark.parametrize("channel", ["sms", "email"])
async def test_dnd_on_an_older_lead_blocks_the_same_customers_new_lead(mongo, dealers, channel):
    set_clock(ny(22, 12))
    old = await _lead(mongo, source="website")
    await _dnd(mongo, old)
    new = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Cora Check",
                                     comments="Back again", customer_id=old["customer_id"])
    decision = await _check(new, channel=channel, purpose="lead_response")
    assert decision.outcome == "BLOCK" and decision.rule == "do_not_contact"


async def test_dnd_follows_the_phone_and_email_to_a_reimported_customer(mongo, dealers):
    set_clock(ny(22, 12))
    old = await _lead(mongo, source="website")
    await _dnd(mongo, old)
    phone, email = await _contact(mongo, old)
    reimported = await _lead(mongo, source="csv_import")
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(reimported["lead_id"])},
                                                      {"$set": {"phone": phone, "email": email.upper()}})
    await mongo[PLATFORM_CUSTOMERS_COLLECTION].update_one(
        {"_id": ObjectId(reimported["customer_id"])},
        {"$set": {"phones": [{"value": phone[-10:], "is_primary": True}],
                  "emails": [{"value": email, "is_primary": True}]}})
    for channel, purpose in (("sms", "marketing"), ("email", "marketing"), ("sms", "transactional")):
        decision = await _check(reimported, channel=channel, purpose=purpose)
        assert decision.outcome == "BLOCK" and decision.rule == "do_not_contact", (channel, purpose)


async def test_another_customer_is_unaffected(mongo, dealers):
    set_clock(ny(22, 12))
    old = await _lead(mongo, source="website")
    await _dnd(mongo, old)
    other = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Someone Else",
                                       comments="Hi")
    assert (await _check(other, purpose="transactional")).rule != "do_not_contact"
