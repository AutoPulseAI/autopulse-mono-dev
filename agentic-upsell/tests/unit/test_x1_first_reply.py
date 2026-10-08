"""PLAN_4 stream X1 item 1: the first AI message on a new lead is a `lead_response` (TCPA PDF §4), not a reply.
It goes through every suppression rule, the review, the customer's state window and the cap; a consumer's own
inquiry needs no marketing consent, an imported / DealerVault / CSV record is outbound marketing. The audit's
probes P1 (STOP under an older customer record) and P2 (no-consent DealerVault lead texted at 23:30) are here."""

import pytest
from bson import ObjectId

from tests.unit.conftest import set_clock
from tests.unit.test_compliance import DEALER, _deps, _inbound, _lead, ny
from upsell_agent.channels import consent
from upsell_agent.compliance.engine import can_contact
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_COMPLIANCE_LOG_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.scheduler import followups


@pytest.fixture
async def dealers(mongo):
    await simulate.ensure_platform_dealers()


def _created(created, channel="sms"):
    return LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                            customer_id=created["customer_id"], channel=channel)


async def _outbox(mongo, created):
    return await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)


async def _phone(mongo, created):
    customer = await mongo[PLATFORM_CUSTOMERS_COLLECTION].find_one({"_id": ObjectId(created["customer_id"])})
    return customer["phones"][0]["value"]


async def _no_email(mongo, created):
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])}, {"$set": {"email": ""}})
    await mongo[PLATFORM_CUSTOMERS_COLLECTION].update_one({"_id": ObjectId(created["customer_id"])},
                                                          {"$set": {"emails": []}})


async def test_p1_a_phone_that_texted_stop_under_an_older_record_gets_no_first_text(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    await _no_email(mongo, created)
    db = dealer_scoped_db(DEALER)
    await consent.set_channel_consent(db, "older-customer-record", "sms", False, "customer_stop",
                                      address=await _phone(mongo, created))
    result = await handlers.handle_lead_created(_created(created), _deps())
    assert result["status"] == "not_sent" and result["rule"] == "opted_out"
    assert await _outbox(mongo, created) == []
    # Never silent: a turn says why, and the decision is in the compliance log.
    assert await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"], "outcome": "not_sent"})
    logged = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert logged["purpose"] == "lead_response" and logged["decision"] == "BLOCK"


async def test_p2_a_dealervault_style_lead_without_consent_is_not_texted_at_23_30(mongo, dealers):
    set_clock(ny(22, 23, 30))
    created = await _lead(mongo, source="", dealervault=True)
    await _no_email(mongo, created)
    result = await handlers.handle_lead_created(_created(created), _deps())
    assert result["status"] == "not_sent" and result["rule"] == "no_consent"
    assert await _outbox(mongo, created) == []
    # Not at noon either: an imported record's first message is outbound marketing.
    set_clock(ny(23, 12))
    check = await can_contact(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                              channel="sms", purpose="lead_response", is_reply=False, record=False)
    assert check.outcome == "BLOCK" and check.rule == "no_consent"


async def test_a_csv_import_lead_is_outbound_marketing_not_a_consumer_inquiry(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="csv_import")
    await _no_email(mongo, created)
    result = await handlers.handle_lead_created(_created(created), _deps())
    assert result["status"] == "not_sent" and result["rule"] == "no_consent"
    assert await _outbox(mongo, created) == []


async def test_a_consumer_inquiry_needs_no_marketing_consent(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    result = await handlers.handle_lead_created(_created(created), _deps())
    assert result["send_status"] == "sent"
    logged = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"lead_id": created["lead_id"], "decision": "ALLOW"})
    assert logged["purpose"] == "lead_response" and logged["is_reply"] is False


async def test_an_inquiry_at_23_30_is_held_to_8_and_then_gets_the_after_hours_choice(mongo, dealers):
    set_clock(ny(22, 23, 30))
    created = await _lead(mongo, source="website")
    result = await handlers.handle_lead_created(_created(created), _deps())
    assert result["status"] == "held" and await _outbox(mongo, created) == []
    [held] = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": handlers.KIND_FIRST_REPLY}).to_list(None)
    assert abs((held["due_at"].replace(tzinfo=ny(23, 8).tzinfo) - ny(23, 8)).total_seconds()) < 5
    set_clock(ny(23, 8, 1))
    await followups.fire_due(_deps())
    [sent] = await _outbox(mongo, created)
    assert sent["channel"] == "sms"
    turn = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"], "trigger": "lead_created",
                                                         "outcome": {"$ne": "not_sent"}})
    decide = next(n for n in turn["nodes"] if n["node"] == "decide")
    # The dealer opens at 9:00: the customer is offered now or when it opens (MASTER_PLAN_3 B1), kept working.
    assert (decide["output"].get("after_hours") or {}).get("mode") == "offer"
    held = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"_id": held["_id"]})
    assert held["status"] == "sent"


async def test_an_inquiry_after_closing_but_inside_the_window_is_answered_now_with_the_choice(mongo, dealers):
    set_clock(ny(22, 19, 30))  # the dev dealer closes at 19:00; NY allows texts until 21:00
    created = await _lead(mongo, source="website")
    result = await handlers.handle_lead_created(_created(created), _deps())
    assert result["send_status"] == "sent" and len(await _outbox(mongo, created)) == 1


async def test_the_customer_writing_before_8_cancels_the_held_first_reply(mongo, dealers):
    set_clock(ny(22, 23, 30))
    created = await _lead(mongo, source="website")
    await handlers.handle_lead_created(_created(created), _deps())
    set_clock(ny(22, 23, 40))
    await handlers.handle_inbound_message(_inbound(created, "Is the CR-V still there?"), _deps())
    replies = await _outbox(mongo, created)
    assert len(replies) == 1  # the reply to their own message, at any hour (decision 56)
    held = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "kind": handlers.KIND_FIRST_REPLY})
    assert held["status"] == "cancelled"
    set_clock(ny(23, 8, 1))
    await followups.fire_due(_deps())
    first_replies = [m for m in await _outbox(mongo, created) if m.get("turn_id", "").startswith("lead-created")]
    assert first_replies == []


async def test_an_open_review_stops_the_first_message(mongo, dealers):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    db = dealer_scoped_db(DEALER)
    await consent.record_consent(db, customer_id=created["customer_id"], channel="all", consent_type="review",
                                 status="open", source="test", evidence={"message": "why so many texts"})
    await _no_email(mongo, created)
    result = await handlers.handle_lead_created(_created(created), _deps())
    assert result["status"] == "not_sent" and result["send_check"] == "REVIEW"
    assert await _outbox(mongo, created) == []


async def test_a_customer_who_texts_us_at_3_am_is_answered_at_once_with_the_after_hours_choice(mongo, dealers):
    # Client, 8 Oct 2026: a customer texting at any hour gets a reply within seconds asking whether to carry on now
    # or when the dealership opens; their own text makes our first message a reply (web forms still wait: above).
    set_clock(ny(23, 3))
    created = await _lead(mongo, source="sms")
    result = await handlers.handle_lead_created(_created(created), _deps())
    assert result.get("status") != "held" and result["send_status"] == "sent", result
    [sent] = await _outbox(mongo, created)
    assert "open" in sent["text"].lower()  # the "now, or when we open?" choice
    logged = await mongo[AI_COMPLIANCE_LOG_COLLECTION].find_one({"lead_id": created["lead_id"], "decision": "ALLOW"})
    assert logged["purpose"] == "lead_response" and logged["rule"] == "reply"  # allowed as a reply, any hour
