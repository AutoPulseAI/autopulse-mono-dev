"""Go-live checks (MASTER_PLAN_1 Stage 13): no double messages, no lost
replies, numbers within limits - each check shown to pass on a healthy dealer
and to fail on the problem it is there to catch."""

from datetime import timedelta

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from tests.unit.conftest import make_settings
from upsell_agent import clock
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_EVENTS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    PLATFORM_USERS_COLLECTION,
)
from upsell_agent.main import create_app
from upsell_agent.observability.rollout import format_check, rollout_check

DEALER = simulate.DEV_DEALERS[0]["_id"]
LATER = timedelta(minutes=10)


@pytest.fixture
async def dealer(mongo):
    async def set_mode(mode):
        await mongo[PLATFORM_USERS_COLLECTION].update_one(
            {"_id": ObjectId(DEALER)}, {"$set": {"ai_mode": mode, "type": "dealer"}}, upsert=True)
    await set_mode("live")
    return set_mode


async def _lead_with_first_reply():
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test",
                                         comments="I want a new Toyota RAV4")
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), TurnDeps())
    return created


async def _reply(created, text="budget is $30k", message_id=None):
    message_id = message_id or str(ObjectId())
    return await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id=message_id, text=text, received_at=clock.now()), TurnDeps())


async def _check():
    clock.set_offset(clock.offset_s() + LATER.total_seconds())  # past the 5-minute grace
    return await rollout_check(DEALER, days=1)


async def test_a_healthy_live_dealer_passes(mongo, dealer):
    created = await _lead_with_first_reply()
    await _reply(created)
    result = await _check()
    assert result["passed"], format_check(result)
    assert result["ai_mode"] == "live" and result["leads"] == 1


async def test_n8n_or_followupjob_writing_to_a_live_lead_is_a_double_message(mongo, dealer):
    created = await _lead_with_first_reply()
    await mongo["emails"].insert_one({
        "dealer_id": DEALER, "lead_id": ObjectId(created["lead_id"]), "status": "sent", "ai_generated": False,
        "communication_type": "sms", "mail_content": "Hi! Just following up (n8n)",
        "timestamp": clock.now() + timedelta(seconds=5)})
    # A staff member's own message is not a double message.
    await mongo["emails"].insert_one({
        "dealer_id": DEALER, "lead_id": ObjectId(created["lead_id"]), "status": "sent", "ai_generated": False,
        "message_by": ObjectId(), "communication_type": "sms", "mail_content": "Sam here", "timestamp": clock.now()})
    result = await _check()
    assert not result["checks"]["no platform auto-messages on AI leads (n8n / FollowUpJob)"]
    assert [m["text"] for m in result["platform_auto_messages"]] == ["Hi! Just following up (n8n)"]

    await dealer("shadow")  # in shadow, n8n replying is expected
    assert (await rollout_check(DEALER, days=1))["checks"]["no platform auto-messages on AI leads (n8n / FollowUpJob)"]


CHECK = "no customer message without a reply or a reason"


async def test_a_message_with_no_reply_and_no_reason_is_a_lost_reply(mongo, dealer):
    created = await _lead_with_first_reply()
    await handlers.record_inbound(InboundMessageEvent(
        event_id="m-lost", dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id="m-lost", text="hello?", received_at=clock.now()))  # its job never ran
    result = await _check()
    assert not result["checks"][CHECK]
    assert result["unanswered_messages"][0]["text"] == "hello?"

    # Staff owning the lead is no excuse any more: the message must still carry a reason.
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]}, {"$set": {"status": "paused"}})
    result = await rollout_check(DEALER, days=1)
    assert not result["checks"][CHECK] and result["unanswered_messages"][0]["lead_status"] == "paused"


async def test_a_message_on_a_paused_lead_is_accounted_for(mongo, dealer):
    created = await _lead_with_first_reply()
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]}, {"$set": {"status": "paused"}})
    await handlers.handle_inbound_message(InboundMessageEvent(
        event_id="m-held", dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id="m-held", text="anyone?", received_at=clock.now()), TurnDeps())
    assert (await _check())["checks"][CHECK]


async def test_an_accepted_event_whose_job_never_ran_is_caught(mongo, dealer):
    await _lead_with_first_reply()
    stranger = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Never Answered",
                                          comments="hi")
    await mongo[AI_EVENTS_COLLECTION].insert_many([
        {"_id": f"lead-created:{stranger['lead_id']}", "dealer_id": DEALER, "type": "lead-created",
         "received_at": clock.now()},
        {"_id": "inbound-message:m-gone", "dealer_id": DEALER, "type": "inbound-message", "received_at": clock.now()},
    ])
    result = await _check()
    assert not result["checks"]["no events left unhandled"]
    whys = sorted(e["why"] for e in result["events_never_handled"])
    assert whys == ["the customer's message was never recorded", "the new lead never got a first reply"]


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")  # PLAN_4 stream X1: a first reply waits for the customer's window
async def test_two_sends_for_one_turn_are_caught(mongo, dealer):
    created = await _lead_with_first_reply()
    first = await mongo[AI_MESSAGES_COLLECTION].find_one({"lead_id": created["lead_id"], "direction": "outbound"})
    await mongo[AI_MESSAGES_COLLECTION].insert_one({
        "dealer_id": DEALER, "lead_id": created["lead_id"], "turn_id": first["turn_id"], "direction": "outbound",
        "status": "sent", "channel": "sms", "created_at": clock.now()})
    result = await _check()
    assert not result["checks"]["no AI double sends"]
    assert result["ai_double_sends"][0]["sends"] == 2


async def test_numbers_over_the_limits_fail(mongo, dealer):
    for i in range(3):
        created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name=f"L{i}", comments="hi")
        await handlers.handle_lead_created(LeadCreatedEvent(
            event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
            customer_id=created["customer_id"], channel="sms"), TurnDeps())
        await _reply(created, text="hello #fallback")  # guard fails twice -> template
    result = await _check()
    assert not result["checks"]["template fallback under 5%"]
    assert not result["checks"]["guard failures under 10%"]


async def test_grounding_rejections_over_the_limit_fail(mongo, dealer):
    """MASTER_PLAN_3 Phase 7 item 5."""
    from tests.unit.test_inventory_tool import _stock, _vehicle

    await _stock(mongo, _vehicle("VIN00000000000902", make="Toyota", model="RAV4", trim="LE"))
    created = await _lead_with_first_reply()
    await _reply(created, text="#badtrim Do you have a Toyota RAV4?")
    result = await _check()
    assert not result["checks"]["grounding rejections under 2%"]
    assert result["numbers"]["grounding_rejection_rate"] > 0


def test_rollout_check_api_needs_the_shared_secret(mongo):
    app = create_app(make_settings("PROD"), connect=False)
    with TestClient(app) as client:
        assert client.get("/v1/rollout-check", params={"dealer_id": DEALER}).status_code == 401
        response = client.get("/v1/rollout-check", params={"dealer_id": DEALER},
                              headers={"Authorization": "Bearer test-secret"})
        assert response.status_code == 200 and response.json()["ai_mode"] == "off"  # no dealer record
