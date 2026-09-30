"""MASTER_PLAN_3 Phase 5: freshness. A vehicle mentioned this turn is
re-checked right before it's actually sent (item 1), and again if it's about
to be resent hours later on the 24h channel switch (item 2) - both reusing
the stock-free version Compose already writes alongside (decision L), never
another AI call. Neither check ever falls back to the vehicle-naming text if
the safe version is missing; that would defeat the point.

Depends on Phase 0 item 1 (MASTER_PLAN_3.md): today's `/api/car` has no
in-stock filter, so `find_sold` can only notice a vehicle removed from the
feed entirely, not one marked sold but still returned. These tests simulate
"sold" the only way this environment can today: deleting the dev vehicle
record, which is exactly what "removed from the feed" looks like from here.
"""

from tests.unit.conftest import make_settings
from tests.unit.test_inventory_tool import DEALER, _stock, _vehicle
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.templates import SOLD_VEHICLE_FALLBACK_SUBJECT, SOLD_VEHICLE_FALLBACK_TEXT
from upsell_agent.agent.turn import _fresh_send_text
from upsell_agent.channels.sender import SendOutcome
from upsell_agent.integrations.mongodb import (
    PLATFORM_VEHICLES_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink, TurnTracer
from upsell_agent.scheduler.followups import _fresh_followup_text, plan_followup
from upsell_agent.tools.inventory_tool import StubInventorySource, find_sold

STUB = StubInventorySource()


def _rav4(vin, **kw):
    return _vehicle(vin, make="Toyota", model="RAV4", **kw)


def _ctx() -> TurnContext:
    tracer = TurnTracer(sink=MemoryTraceSink(), dealer_id=DEALER, lead_id="lead-1", customer_id="cust-1",
                        trigger="inbound_message", channel="sms", store_prompts=False)
    return TurnContext(db=dealer_scoped_db(DEALER), platform=StubPlatformClient(), settings=make_settings("DEV"),
                       tracer=tracer, lead=None, customer=None, lead_state=None, source_message_id="m-1")


# --- find_sold (tools/inventory_tool.py) --------------------------------------------------------------------

async def test_find_sold_is_empty_when_everything_is_still_there(mongo):
    await _stock(mongo, _rav4("VIN00000000000801"))
    assert await find_sold(DEALER, ["VIN00000000000801"], STUB) == []


async def test_find_sold_catches_a_vehicle_removed_from_the_feed(mongo):
    await _stock(mongo, _rav4("VIN00000000000802"))
    await mongo[PLATFORM_VEHICLES_COLLECTION].delete_one({"vin": "VIN00000000000802"})
    assert await find_sold(DEALER, ["VIN00000000000802"], STUB) == ["VIN00000000000802"]


async def test_find_sold_never_blocks_on_a_lookup_failure(mongo):
    class Broken:
        async def search(self, params, limit):
            raise ConnectionError("platform unreachable")

    assert await find_sold(DEALER, ["VIN00000000000803"], Broken()) == []


# --- _fresh_send_text (agent/turn.py, item 1: right before the send) ----------------------------------------

async def test_fresh_send_text_skips_the_check_when_nothing_was_named():
    draft = {"sms_vins": [], "sms_text": "Thanks!"}
    reply, subject, info = await _fresh_send_text(_ctx(), DEALER, draft, "sms", "Thanks!", None)
    assert (reply, subject, info) == ("Thanks!", None, None)


async def test_fresh_send_text_leaves_the_reply_alone_when_still_in_stock(mongo):
    await _stock(mongo, _rav4("VIN00000000000811"))
    draft = {"sms_vins": ["VIN00000000000811"], "sms_text": "We have a RAV4!",
            "sms_text_no_vehicles": "The team will confirm what's available."}
    reply, _subject, info = await _fresh_send_text(_ctx(), DEALER, draft, "sms", "We have a RAV4!", None)
    assert reply == "We have a RAV4!" and info == {"checked": ["VIN00000000000811"], "sold": []}


async def test_fresh_send_text_swaps_to_the_stock_free_version_when_sold(mongo):
    await _stock(mongo, _rav4("VIN00000000000812"))
    await mongo[PLATFORM_VEHICLES_COLLECTION].delete_one({"vin": "VIN00000000000812"})
    draft = {"sms_vins": ["VIN00000000000812"], "sms_text": "We have a RAV4!",
            "sms_text_no_vehicles": "The team will confirm what's available."}
    reply, _subject, info = await _fresh_send_text(_ctx(), DEALER, draft, "sms", "We have a RAV4!", None)
    assert reply == "The team will confirm what's available."
    assert info == {"checked": ["VIN00000000000812"], "sold": ["VIN00000000000812"]}


async def test_fresh_send_text_never_falls_back_to_the_sold_vehicles_own_text(mongo):
    """If Compose didn't write a stock-free version despite being told to,
    the generic fallback is sent - never the sold vehicle's own text."""
    await _stock(mongo, _rav4("VIN00000000000813"))
    await mongo[PLATFORM_VEHICLES_COLLECTION].delete_one({"vin": "VIN00000000000813"})
    draft = {"sms_vins": ["VIN00000000000813"], "sms_text": "We have a RAV4!"}  # no _no_vehicles field at all
    reply, _subject, _info = await _fresh_send_text(_ctx(), DEALER, draft, "sms", "We have a RAV4!", None)
    assert reply == SOLD_VEHICLE_FALLBACK_TEXT
    assert "RAV4" not in reply


async def test_fresh_send_text_email_uses_its_own_subject(mongo):
    await _stock(mongo, _rav4("VIN00000000000814"))
    await mongo[PLATFORM_VEHICLES_COLLECTION].delete_one({"vin": "VIN00000000000814"})
    draft = {"email_vins": ["VIN00000000000814"], "email_body": "We have a RAV4!",
            "email_body_no_vehicles": "The team will confirm.", "email_subject_no_vehicles": "Your inquiry, updated"}
    reply, subject, _info = await _fresh_send_text(_ctx(), DEALER, draft, "email", "We have a RAV4!", "Your inquiry")
    assert reply == "The team will confirm." and subject == "Your inquiry, updated"


# --- plan_followup (scheduler/followups.py, item 2: stored at plan time) -------------------------------------

def _sent(message_id="msg-1") -> SendOutcome:
    return SendOutcome(status="sent", idempotency_key="k", channel="sms", message_id=message_id, to="+15550000000")


async def _plan(mongo, draft, **overrides):
    lead = {"lead_id": "lead-x", "email": "customer@example.test", "name": "Fern Freshness"}
    customer = {"phone": "+15559990000", "email": "customer@example.test", "sms_opt_in": True}
    kwargs = {"sent": _sent(), "draft": draft, "lead": lead, "customer": customer, "lead_id": "lead-x",
             "customer_id": "cust-x", "turn_id": "turn-x", "channel": "sms", "action": "answer", **overrides}
    return await plan_followup(dealer_scoped_db(DEALER), **kwargs)


async def test_plan_followup_keeps_the_vehicle_version_alongside_the_stock_free_one(mongo):
    draft = {"email_vins": ["VIN00000000000821"], "email_body": "We have a RAV4!", "email_subject": "Your RAV4",
            "email_body_no_vehicles": "The team will confirm.", "email_subject_no_vehicles": "Your inquiry"}
    result = await _plan(mongo, draft)
    assert result["created"]
    doc = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"lead_id": "lead-x"})
    assert doc["text"] == "The team will confirm." and doc["mentioned_vins"] == ["VIN00000000000821"]
    assert doc["vehicle_text"] == "We have a RAV4!" and doc["vehicle_subject"] == "Your RAV4"


async def test_plan_followup_never_stores_the_vehicle_text_as_the_default_when_stock_free_is_missing(mongo):
    draft = {"email_vins": ["VIN00000000000822"], "email_body": "We have a RAV4!", "email_subject": "Your RAV4"}
    await _plan(mongo, draft)
    doc = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"lead_id": "lead-x"})
    assert doc["text"] == SOLD_VEHICLE_FALLBACK_TEXT and doc["subject"] == SOLD_VEHICLE_FALLBACK_SUBJECT
    assert "RAV4" not in doc["text"]


async def test_plan_followup_stores_nothing_extra_when_no_vehicle_was_named(mongo):
    draft = {"email_body": "Thanks!", "email_subject": "Your inquiry"}
    await _plan(mongo, draft)
    doc = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"lead_id": "lead-x"})
    assert "mentioned_vins" not in doc and "vehicle_text" not in doc


# --- _fresh_followup_text (scheduler/followups.py, item 2: re-checked at fire time) ---------------------------

async def test_fresh_followup_text_uses_the_nicer_version_when_still_available(mongo):
    await _stock(mongo, _rav4("VIN00000000000831"))
    doc = {"text": "The team will confirm.", "subject": "Your inquiry", "mentioned_vins": ["VIN00000000000831"],
          "vehicle_text": "We have a RAV4!", "vehicle_subject": "Your RAV4"}
    text, subject, freshness = await _fresh_followup_text(DEALER, doc)
    assert text == "We have a RAV4!" and subject == "Your RAV4" and freshness["sold"] == []


async def test_fresh_followup_text_keeps_the_stock_free_version_when_sold(mongo):
    await _stock(mongo, _rav4("VIN00000000000832"))
    await mongo[PLATFORM_VEHICLES_COLLECTION].delete_one({"vin": "VIN00000000000832"})
    doc = {"text": "The team will confirm.", "subject": "Your inquiry", "mentioned_vins": ["VIN00000000000832"],
          "vehicle_text": "We have a RAV4!", "vehicle_subject": "Your RAV4"}
    text, _subject, freshness = await _fresh_followup_text(DEALER, doc)
    assert text == "The team will confirm." and freshness["sold"] == ["VIN00000000000832"]


async def test_fresh_followup_text_skips_the_check_when_nothing_was_named(mongo):
    doc = {"text": "Thanks!", "subject": "Your inquiry"}
    text, subject, freshness = await _fresh_followup_text(DEALER, doc)
    assert (text, subject, freshness) == ("Thanks!", "Your inquiry", None)
