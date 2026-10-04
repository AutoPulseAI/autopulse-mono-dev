"""PLAN_4 stream X3 item 4: no silence after a handoff, and a clearer bar for "upset".

Audit 4, trade-2 (real gpt-5-mini run): "Because I'm busy and don't want to waste a trip for a lowball" was handed
off as "Customer is clearly upset (confidence 0.80)"; then "Could I come Saturday at 11?" and "Actually make it
Friday at 4 instead" got no reply at all."""

from datetime import timedelta

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from upsell_agent import clock
from upsell_agent.agent import after_handoff
from upsell_agent.agent.crm_notes import AI_CRM_NOTES_COLLECTION
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events.handlers import handle_inbound_message
from upsell_agent.events.models import InboundMessageEvent
from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION, AI_TURN_LOG_COLLECTION
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.slots.policy import Flags, upset_words

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")

DEALER = simulate.DEV_DEALERS[0]["_id"]


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _handed_off(mongo, reason, soft=None):
    created = await simulate.create_lead(DEALER, lead_type="trade_in", channel="sms", name="Kelly",
                                         comments="Want to sell my 2017 Wrangler")
    fields = {"lead_id": created["lead_id"], "customer_id": created["customer_id"], "status": "handoff",
              "status_reason": reason, "status_at": clock.now(), "last_handoff_notice_at": clock.now(),
              "lead_type": "trade_in", "created_at": clock.now()}
    if soft is not None:
        fields["handoff_soft"] = soft
    await mongo[AI_LEAD_STATE_COLLECTION].insert_one({"dealer_id": DEALER, **fields})
    return created


async def _say(created, text):
    clock.set_offset(clock.offset_s() + timedelta(minutes=15).total_seconds())
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel="sms",
                                text=text, received_at=clock.now())
    return await handle_inbound_message(event, _deps())


def test_upset_needs_clear_words_at_080():
    said = "Because I'm busy and don't want to waste a trip for a lowball"
    assert not upset_words(said)
    from upsell_agent.agent.qualification import LeadType
    from upsell_agent.slots.policy import next_action
    from upsell_agent.slots.profile import build_profile
    profile = build_profile(LeadType.TRADE_IN, [])
    assert next_action(profile, Flags(upset=True, upset_confidence=0.8, upset_words=False))["action"] != "handoff"
    assert next_action(profile, Flags(upset=True, upset_confidence=0.8, upset_words=True))["action"] == "handoff"
    assert next_action(profile, Flags(upset=True, upset_confidence=0.96, upset_words=False))["action"] == "handoff"
    assert upset_words("This is ridiculous, you people lied to me")
    assert upset_words("WHY IS NOBODY ANSWERING ME")


def test_classify_after_handoff():
    now = clock.now()
    assert after_handoff.classify("Could I come Saturday at 11?", now) == "booking"
    assert after_handoff.classify("Actually make it Friday at 4 instead", now) == "booking"
    assert after_handoff.classify("Fine, what would the appraisal involve?", now) == "question"
    assert after_handoff.classify("How long does it take?", now) == "question"
    assert after_handoff.classify("ok thanks", now) is None


async def test_a_soft_handoff_customer_asking_to_book_is_taken_back_and_answered(mongo):
    created = await _handed_off(mongo, "Customer is clearly upset (confidence 0.80)")
    result = await _say(created, "Could I come Saturday at 11?")
    assert result["status"] == "done", result  # an AI turn, not "saved for staff"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] != "handoff"
    assert "took the lead back" in state["staff_notice"]["text"]
    assert await mongo[AI_CRM_NOTES_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 1


async def test_a_hard_handoff_still_gets_a_holding_reply_and_staff_get_the_request(mongo):
    created = await _handed_off(mongo, "Customer asked for a person", soft=False)
    result = await _say(created, "Could I come Saturday at 11?")
    assert result["status"] == "holding_reply", result  # inside the 2-hour window, still answered
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] == "handoff"
    assert "please book it" in state["staff_notice"]["text"] and "Saturday at 11" in state["staff_notice"]["text"]
    assert await mongo[AI_CRM_NOTES_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 1
    # A plain "ok thanks" inside the window stays saved only (no reply loop).
    quiet = await _say(created, "ok thanks")
    assert quiet["status"] == "saved_only"
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 2
