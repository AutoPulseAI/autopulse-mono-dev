"""PLAN_4 stream X3 item 5: the CRM conversation in the AI's memory.

Staff replies, staff notes, CRM / n8n / campaign texts enter the AI's thread for the lead, marked by author; a lead
the AI first sees mid-conversation gets its CRM history and a stage from its own creation date; a returning
customer's new lead gets a summary of the previous lead's conversation."""

from datetime import UTC, datetime, timedelta

import pytest
from bson import ObjectId

from upsell_agent import clock
from upsell_agent.agent.history_sync import author_of, sync_lead_history
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)

pytestmark = pytest.mark.usefixtures("during_opening_hours")

DEALER = simulate.DEV_DEALERS[0]["_id"]


def _email(lead_id, text, at, **extra):
    return {"_id": ObjectId(), "dealer_id": DEALER, "lead_id": as_object_id(lead_id), "mail_content": text,
            "timestamp": at, "date": at, "communication_type": "sms", "sender": "x", **extra}


def test_authors():
    assert author_of({"is_note": True}) == "staff_note"
    assert author_of({"status": "received"}) == "customer"
    assert author_of({"status": "sent", "message_by": ObjectId()}) == "staff"
    assert author_of({"status": "sent", "campaign_id": ObjectId()}) == "campaign"
    assert author_of({"status": "sent"}) == "crm"


async def test_staff_words_enter_the_thread_by_author_and_only_once(mongo):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Ann", comments="RAV4")
    lead_id = created["lead_id"]
    now = clock.now()
    await mongo[AI_LEAD_STATE_COLLECTION].insert_one({"dealer_id": DEALER, "lead_id": lead_id, "created_at": now,
                                                      "history_synced_at": now - timedelta(minutes=5),
                                                      "history_synced_until": now - timedelta(minutes=5)})
    await mongo["emails"].insert_many([
        _email(lead_id, "Hi Ann, it's Sam from the store - I can do $500 off if you come Saturday.", now,
               status="sent", message_by=ObjectId()),
        _email(lead_id, "Promised $500 off, manager approved.", now, is_note=True, communication_type="note"),
        _email(lead_id, "Reminder: your appointment is tomorrow.", now, status="sent"),
        _email(lead_id, "Fall sale this weekend!", now, status="sent", campaign_id=ObjectId()),
        _email(lead_id, "AI reply", now, status="sent", ai_generated=True),
        _email(lead_id, "a customer message", now, status="received"),
    ])
    db = dealer_scoped_db(DEALER)
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": lead_id})
    result = await sync_lead_history(db, lead_id=lead_id, customer_id=created["customer_id"], lead_state=state)
    assert result["imported"] == 4
    rows = {r["author"]: r for r in await mongo[AI_MESSAGES_COLLECTION].find({"lead_id": lead_id}).to_list(None)}
    assert set(rows) == {"staff", "staff_note", "crm", "campaign"}  # no AI copy, no customer message (events do it)
    assert rows["staff"]["direction"] == "outbound" and rows["staff_note"]["direction"] == "note"
    again = await sync_lead_history(db, lead_id=lead_id, customer_id=created["customer_id"],
                                    lead_state=await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": lead_id}))
    assert again["imported"] == 0


async def test_a_lead_first_seen_mid_conversation_gets_its_history_and_a_stage(mongo):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Bo", comments="Tacoma?")
    lead_id = created["lead_id"]
    three_days_ago = clock.now() - timedelta(days=3)
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": as_object_id(lead_id)},
                                                      {"$set": {"createdAt": three_days_ago}})
    await mongo["emails"].insert_many([
        _email(lead_id, "Do you still have the Tacoma?", three_days_ago, status="incoming"),
        _email(lead_id, "Yes we do! Want to come see it Thursday?", three_days_ago + timedelta(minutes=3),
               status="sent"),
        _email(lead_id, "It's Sam - the Tacoma is $1,000 off this week only.", three_days_ago + timedelta(days=1),
               status="sent", message_by=ObjectId()),
    ])
    event = InboundMessageEvent(event_id="m1", dealer_id=DEALER, customer_id=created["customer_id"], lead_id=lead_id,
                                channel="sms", message_id="m1", text="ok what time thursday",
                                received_at=datetime.now(UTC))
    result = await handlers.handle_inbound_message(event, TurnDeps())
    assert result["status"] == "done"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": lead_id})
    assert state["stage"]  # before: no stage, so no cadence and no Day-91 close
    assert abs((state["opportunity_created_at"].replace(tzinfo=UTC) - three_days_ago).total_seconds()) < 5
    authors = [r.get("author") for r in await mongo[AI_MESSAGES_COLLECTION].find({"lead_id": lead_id}).to_list(None)]
    assert {"customer", "crm", "staff"} <= set(authors)
    turn = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": lead_id})
    assert "CRM history: 3 message(s)" in str(turn)  # the turn saw them (load_context's reasoning)


async def test_a_returning_customer_gets_the_previous_leads_summary(mongo):
    first = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Cy", comments="F-150")
    await mongo[AI_LEAD_STATE_COLLECTION].insert_one({"dealer_id": DEALER, "lead_id": first["lead_id"],
                                                      "stage": "closed_lost", "created_at": clock.now(),
                                                      "summary": {"text": "Wanted a 2021 F-150 under $35k; "
                                                                          "went quiet after pricing."}})
    second = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Cy", comments="Back again",
                                        customer_id=first["customer_id"])
    db = dealer_scoped_db(DEALER)
    await sync_lead_history(db, lead_id=second["lead_id"], customer_id=first["customer_id"], lead_state={})
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": second["lead_id"]})
    assert "F-150 under $35k" in state["previous_lead_summary"]
