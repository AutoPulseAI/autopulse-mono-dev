"""Shadow mode and the shadow comparison (MASTER_PLAN_1 Stage 13): turns run
fully but nothing is sent, recorded on the platform or followed up; each AI
draft is shown next to what n8n (or staff) actually sent, and can be
reviewed."""

from datetime import timedelta

import pytest
from bson import ObjectId

from upsell_agent import clock
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.devtools import simulate
from upsell_agent.devtools.shadow import save_review, shadow_pairs
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
)
from upsell_agent.integrations.platform_client import DEV_PLATFORM_MESSAGES_COLLECTION

SHADOW_DEALER = simulate.DEV_DEALERS[2]["_id"]


async def _shadow_lead(comments="Is the Tacoma still available?"):
    created = await simulate.create_lead(SHADOW_DEALER, lead_type="sales", channel="sms", name="Sid Shadow",
                                         comments=comments)
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=SHADOW_DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms", shadow=True), TurnDeps())
    return created


async def _shadow_reply(created, text):
    message_id = str(ObjectId())
    await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=SHADOW_DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id=message_id, text=text, received_at=clock.now(), shadow=True), TurnDeps())


async def _platform_sent(mongo, created, text, *, staff=False, after=timedelta(seconds=2)):
    await mongo["emails"].insert_one({
        "dealer_id": SHADOW_DEALER, "lead_id": ObjectId(created["lead_id"]), "status": "sent",
        "ai_generated": False, "communication_type": "sms", "mail_content": text,
        "timestamp": clock.now() + after, **({"message_by": ObjectId()} if staff else {})})


async def test_shadow_turns_run_fully_but_nothing_leaves(mongo):
    created = await _shadow_lead()
    draft = await mongo[AI_MESSAGES_COLLECTION].find_one({"lead_id": created["lead_id"], "direction": "outbound"})
    assert draft["status"] == "shadow" and draft["text"]
    assert await mongo[DEV_OUTBOX_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 0
    assert await mongo[DEV_PLATFORM_MESSAGES_COLLECTION].count_documents({}) == 0   # not in the dealer's screen
    assert await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 0


async def test_each_draft_is_paired_with_what_the_customer_actually_got(mongo):
    created = await _shadow_lead()
    await _platform_sent(mongo, created, "Thanks for reaching out! Yes it's here, come by.")   # n8n's answer
    clock.set_offset(60)
    await _shadow_reply(created, "Great, what trims do you have?")
    await _platform_sent(mongo, created, "Sam here - I'll call you in 5 min", staff=True)

    result = await shadow_pairs(SHADOW_DEALER, days=1)
    first, second = sorted(result["pairs"], key=lambda p: p["at"])
    assert first["trigger"] == "lead_created" and first["customer"] == ["Is the Tacoma still available?"]
    assert first["actual"] == {"text": "Thanks for reaching out! Yes it's here, come by.", "by": "n8n",
                               "channel": "sms", "at": first["actual"]["at"]}
    assert first["ai"]["text"] and first["ai"]["guard_passed"]
    assert second["customer"] == ["Great, what trims do you have?"]
    assert second["actual"]["by"] == "staff"
    assert result["summary"] == {"drafts": 2, "with_actual_reply": 2, "reviewed": 0,
                                 "verdicts": {"better": 0, "same": 0, "worse": 0, "unsafe": 0}}


async def test_a_draft_with_no_platform_reply_yet_shows_none(mongo):
    await _shadow_lead()
    [pair] = (await shadow_pairs(SHADOW_DEALER, days=1))["pairs"]
    assert pair["actual"] is None


async def test_reviews_are_saved_per_turn_and_counted(mongo):
    created = await _shadow_lead()
    [pair] = (await shadow_pairs(SHADOW_DEALER, days=1))["pairs"]
    await save_review(SHADOW_DEALER, pair["turn_id"], "better", "asks the right question")
    await save_review(SHADOW_DEALER, pair["turn_id"], "same")   # a second look replaces the first
    result = await shadow_pairs(SHADOW_DEALER, days=1)
    assert result["pairs"][0]["review"] == {"verdict": "same", "note": None}
    assert result["summary"]["reviewed"] == 1 and result["summary"]["verdicts"]["same"] == 1
    with pytest.raises(ValueError):
        await save_review(SHADOW_DEALER, pair["turn_id"], "amazing")
    assert created
