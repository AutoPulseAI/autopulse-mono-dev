"""PLAN_4 stream X3 item 10: auto-responders get no reply and are not contact; the lead lock never expires while
its turn runs."""

import asyncio
from datetime import UTC, datetime

import fakeredis.aioredis
import pytest

from upsell_agent.agent.auto_reply import is_auto_reply
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
)
from upsell_agent.worker.locks import Busy, lead_lock, lead_lock_key

pytestmark = pytest.mark.usefixtures("during_opening_hours")

DEALER = simulate.DEV_DEALERS[0]["_id"]


@pytest.mark.parametrize("text", [
    "I am currently out of the office and will respond when I return on Monday.",
    "Automatic reply: Thank you for your message",
    "I'm driving with Do Not Disturb While Driving turned on. I'll see your message when I get where I'm going.",
    "This is an automated message. This mailbox is not monitored.",
])
def test_auto_replies_are_recognised(text):
    assert is_auto_reply(text)


@pytest.mark.parametrize("text", ["I'll be out of town Saturday, can we do Friday?", "ok thanks", "Is it automatic?"])
def test_customer_words_are_not(text):
    assert not is_auto_reply(text)


async def _event(created, text, *, flagged=False, event_id="m1"):
    return InboundMessageEvent(event_id=event_id, dealer_id=DEALER, customer_id=created["customer_id"],
                               lead_id=created["lead_id"], channel="email", message_id=event_id, text=text,
                               received_at=datetime.now(UTC), auto_reply=flagged)


async def test_an_out_of_office_gets_no_reply_and_keeps_the_channel_switch(mongo):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="email", name="Ann", comments="RAV4")
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].insert_one(
        {"dealer_id": DEALER, "lead_id": created["lead_id"], "status": "pending", "kind": "channel_switch",
         "due_at": datetime.now(UTC)})
    result = await handlers.handle_inbound_message(
        await _event(created, "Out of office: I am away until Oct 12 and will reply when I return."), TurnDeps())
    assert result["status"] == "auto_reply"
    assert await mongo["dev_outbox"].count_documents({"lead_id": created["lead_id"]}) == 0
    assert (await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"lead_id": created["lead_id"]}))["status"] == "pending"
    row = await mongo[AI_MESSAGES_COLLECTION].find_one({"lead_id": created["lead_id"], "direction": "inbound"})
    assert row["auto_reply"] is True and row["answered_turn_id"]
    turn = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert turn["outcome"] == "auto_reply"


async def test_crm_flagged_auto_reply_headers_are_honoured(mongo):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="email", name="Ann", comments="RAV4")
    result = await handlers.handle_inbound_message(await _event(created, "Thanks for your email.", flagged=True),
                                                   TurnDeps())
    assert result["status"] == "auto_reply"


async def test_the_lead_lock_is_extended_while_the_turn_runs():
    redis = fakeredis.aioredis.FakeRedis()
    async with lead_lock(redis, "d1", "lead1", ttl_s=0.3):
        await asyncio.sleep(0.75)  # more than twice the TTL
        assert await redis.get(lead_lock_key("d1", "lead1")) is not None
        with pytest.raises(Busy):
            async with lead_lock(redis, "d1", "lead1", ttl_s=0.3):
                pass
    assert await redis.get(lead_lock_key("d1", "lead1")) is None
