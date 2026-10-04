"""PLAN_4 stream X3 item 6 (and 5): the reconciliation sweep finds CRM leads and customer messages the AI never
heard about - idempotent, never a double send, never a first-touch greeting to a lead already in conversation."""

from datetime import timedelta

import pytest
from bson import ObjectId

from upsell_agent import clock
from upsell_agent.devtools import simulate
from upsell_agent.events.intake import accept_event
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    as_object_id,
)
from upsell_agent.scheduler.reconcile import reconcile

pytestmark = pytest.mark.usefixtures("during_opening_hours")

DEALER = simulate.DEV_DEALERS[0]["_id"]


@pytest.fixture
async def live(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].update_one({"_id": ObjectId(DEALER)}, {"$set": {"ai_mode": "live"}},
                                                      upsert=True)


async def _lead(mongo, *, age):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Dee", comments="RAV4?")
    at = clock.now() - age
    new_id = ObjectId.from_datetime(at)
    lead = await mongo[PLATFORM_LEADS_COLLECTION].find_one({"_id": as_object_id(created["lead_id"])})
    await mongo[PLATFORM_LEADS_COLLECTION].delete_one({"_id": lead["_id"]})
    await mongo[PLATFORM_LEADS_COLLECTION].insert_one({**lead, "_id": new_id, "createdAt": at})
    return {**created, "lead_id": str(new_id), "oid": new_id}


def _collect():
    calls: list[tuple[str, object]] = []
    queued: list[str] = []

    async def enqueue(function, *, key, **kwargs):
        queued.append(key)
        return key

    async def submit(event_type, event):
        calls.append((event_type, event))
        return await accept_event(event_type, event, enqueue)

    return calls, queued, submit


async def test_a_lost_new_lead_gets_its_lead_created_once(mongo, live):
    lead = await _lead(mongo, age=timedelta(hours=1))
    calls, queued, submit = _collect()
    await reconcile(submit=submit)
    await reconcile(submit=submit)
    assert [c[0] for c in calls][:1] == ["lead-created"]
    assert queued == [f"lead-created:{lead['lead_id']}"], "the second sweep is a duplicate, never queued again"


async def test_an_open_lead_already_in_conversation_is_adopted_not_greeted(mongo, live):
    lead = await _lead(mongo, age=timedelta(days=10))
    at = clock.now() - timedelta(days=10) + timedelta(minutes=2)
    await mongo["emails"].insert_many([
        {"dealer_id": DEALER, "lead_id": lead["oid"], "status": "incoming", "communication_type": "sms",
         "mail_content": "is the RAV4 still there?", "timestamp": at - timedelta(minutes=1), "sender": "c"},
        {"dealer_id": DEALER, "lead_id": lead["oid"], "status": "sent", "communication_type": "sms",
         "mail_content": "Yes! When can you come by?", "timestamp": at, "sender": "d"}])
    calls, _queued, submit = _collect()
    result = await reconcile(submit=submit)
    assert result[DEALER]["adopted"] == 1 and not calls, "no first reply for a lead already in conversation"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": lead["lead_id"]})
    assert state["stage"] and state["adopted_at"]
    assert await mongo[AI_MESSAGES_COLLECTION].count_documents({"lead_id": lead["lead_id"]}) == 2
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents(
        {"lead_id": lead["lead_id"], "status": "pending"}) >= 1, "its cadence continues from where it stands"
    again = await reconcile(submit=submit)
    assert again[DEALER]["adopted"] == 0


async def test_a_lost_customer_message_is_submitted_unless_staff_answered(mongo, live):
    lead = await _lead(mongo, age=timedelta(days=1))
    await mongo[AI_LEAD_STATE_COLLECTION].insert_one({"dealer_id": DEALER, "lead_id": lead["lead_id"],
                                                      "customer_id": lead["customer_id"], "status": "active",
                                                      "stage": "contacted", "created_at": clock.now() - timedelta(days=1)})
    lost = {"_id": ObjectId(), "dealer_id": DEALER, "lead_id": lead["oid"], "status": "received",
            "communication_type": "sms", "mail_content": "can I come tomorrow?", "sender": "c",
            "timestamp": clock.now() - timedelta(minutes=30)}
    answered = {**lost, "_id": ObjectId(), "mail_content": "another one", "timestamp": clock.now() - timedelta(hours=2)}
    await mongo["emails"].insert_many([lost, answered, {
        "dealer_id": DEALER, "lead_id": lead["oid"], "status": "sent", "communication_type": "sms", "sender": "d",
        "message_by": ObjectId(), "mail_content": "Sam here", "timestamp": clock.now() - timedelta(hours=1)}])
    calls, _queued, submit = _collect()
    await reconcile(submit=submit)
    inbound = [e for t, e in calls if t == "inbound-message"]
    assert [e.message_id for e in inbound] == [str(lost["_id"])]
