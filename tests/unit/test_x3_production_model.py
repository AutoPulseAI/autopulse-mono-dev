"""PLAN_4 stream X3 item 1: the AI path on production's data model, where a `Lead` has no `customer_id`.

The CRM sends a customer key derived from the lead's phone (else email) and stores it on the lead as
`ai_customer_key` (aidmvcs-be-dev app/lib/ai/aiDispatch.js). The AI must find the customer's leads, facts and
consent by that key exactly as by a CRM customer id."""

from datetime import UTC, datetime

import pytest

from upsell_agent.agent import ownership
from upsell_agent.agent.customer_key import (
    derived_customer_key,
    find_customer_leads,
    lead_customer_id,
)
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)

pytestmark = pytest.mark.usefixtures("during_opening_hours")

DEALER = simulate.DEV_DEALERS[0]["_id"]


def test_same_key_as_the_crm():
    # The same vectors as aidmvcs-be-dev/test-ai-x3.js: both sides must derive the same key.
    assert derived_customer_key("64b000000000000000000001", "+1 (555) 123-4567") == "ck_e66ba7182e8ddaafc62c404c"
    assert derived_customer_key("64b000000000000000000001", None, " Jane@X.com ") == "ck_d5f50d486e195b6dad1f728b"
    assert derived_customer_key("64b000000000000000000001", "123", "n/a") is None
    assert lead_customer_id({"customer_id": "abc", "phone": "5551234567"}) == "abc"
    assert lead_customer_id({"dealer_id": "64b000000000000000000001", "phone": "5551234567"}) == \
        derived_customer_key("64b000000000000000000001", "5551234567")


async def _production_lead(mongo, *, store_key=True):
    """A lead as production's CRM writes it: no customer_id (optionally the AI key the CRM stores)."""
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Pat", comments="RAV4?")
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})
    key = derived_customer_key(DEALER, lead.get("phone"), lead.get("email"))
    update: dict = {"$unset": {"customer_id": ""}}
    if store_key:
        update["$set"] = {"ai_customer_key": key}
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": lead["_id"]}, update)
    return created["lead_id"], key


async def test_a_production_lead_is_worked_and_found_by_its_key(mongo):
    lead_id, key = await _production_lead(mongo)
    result = await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=lead_id, dealer_id=DEALER, lead_id=lead_id, customer_id=key, channel="sms"),
        TurnDeps())
    assert result["status"] == "done"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": lead_id})
    assert state["customer_id"] == key

    # A message whose lead the CRM did not resolve still reaches the customer's lead, by the key.
    event = InboundMessageEvent(event_id="m1", dealer_id=DEALER, customer_id=key, lead_id=None, channel="sms",
                                message_id="m1", text="is it still there?", received_at=datetime.now(UTC))
    reply = await handlers.handle_inbound_message(event, TurnDeps())
    assert reply["status"] == "done"
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({"lead_id": lead_id}) == 2

    # Customer status counts the open lead (before: no lead found by customer_id -> no open opportunity).
    status = await ownership.recalculate_customer_status(dealer_scoped_db(DEALER), key, reason="test")
    assert status["open_opportunity_count"] == 1


async def test_leads_are_found_even_when_the_crm_could_not_store_the_key(mongo):
    lead_id, key = await _production_lead(mongo, store_key=False)
    await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=lead_id, dealer_id=DEALER, lead_id=lead_id, customer_id=key, channel="sms"),
        TurnDeps())
    found = await find_customer_leads(dealer_scoped_db(DEALER), key)
    assert [str(lead["_id"]) for lead in found] == [lead_id]
