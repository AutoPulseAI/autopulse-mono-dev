"""MASTER_PLAN_4 A1: sales lead buckets (client blueprint §2, scope Workflow 1
step 3): classification by source, the lead's own text as a fallback, the
behaviour override keeping the original bucket, the word track reaching
Compose, the lead profile API, and the DEMO_BUCKET_KEYWORDS hook."""

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from upsell_agent import clock
from upsell_agent.agent import lead_bucket
from upsell_agent.agent.turn import TurnDeps, run_turn
from upsell_agent.api.leads import lead_profile
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events.handlers import handle_inbound_message
from upsell_agent.events.models import InboundMessageEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    QUALIFICATION_FACTS_COLLECTION,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink

DEALER = simulate.DEV_DEALERS[0]["_id"]


# --- Classification -------------------------------------------------------------------------

@pytest.mark.parametrize("source,bucket", [
    ("Capital One", "credit"), ("Chase Auto", "credit"), ("Carzing", "credit"), ("DealerCentric", "credit"),
    ("Credit Application", "credit"), ("eUnifi", "credit"), ("700Credit", "credit"),
    ("KBB", "trade_in"), ("Kelley Blue Book Instant Cash Offer", "trade_in"), ("TrueCar SELL My Car", "trade_in"),
    ("AccuTrade", "trade_in"), ("CarGurus SELL My Car", "trade_in"),
    ("CarGurus", "general"), ("Edmunds", "general"), ("Cars.com", "general"), ("Facebook", "general"),
    ("Instagram", "general"), ("AutoWeb", "general"), ("CarsDirect", "general"), ("TrueCar", "general"),
    ("AutoTrader", "general"),
])
def test_blueprint_sources(source, bucket):
    result = lead_bucket.classify({"source": source, "data": {"lead_type": "sales"}})
    assert result.bucket == bucket and result.method == "source"


def test_unknown_source_falls_back_to_the_leads_own_text_then_general():
    assert lead_bucket.classify({"source": "website", "comments": "Can I get pre-approved?"}).bucket == "credit"
    assert lead_bucket.classify({"source": "sms", "comments": "I want to sell my car"}).method == "lead_text"
    assert lead_bucket.classify({"source": "sms", "comments": "I want to sell my car"}).bucket == "trade_in"
    plain = lead_bucket.classify({"source": "website", "comments": "Is the white RAV4 available?"})
    assert plain.bucket == "general" and plain.method == "default"
    assert lead_bucket.classify(None).bucket == "general"
    # "purchase" isn't the Chase source.
    assert lead_bucket.classify({"source": "purchase-form"}).bucket == "general"


def test_service_leads_have_no_bucket():
    assert lead_bucket.classify({"source": "Service appointment", "data": {"lead_type": "service"}}) is None


def test_behaviour_override_needs_a_clear_change_of_intent():
    assert lead_bucket.override_from_reply("Honestly I just want to sell my car", "credit") == (
        "trade_in", "just want to sell")
    assert lead_bucket.override_from_reply("Can I get approved with bad credit?", "general")[0] == "credit"
    assert lead_bucket.override_from_reply("Is it still available?", "trade_in")[0] == "general"
    # A trade mentioned on a credit lead is normal, not a change of intent; the same bucket isn't a change.
    assert lead_bucket.override_from_reply("I have a 2015 Civic to trade", "credit") is None
    assert lead_bucket.override_from_reply("I just want to sell my car", "trade_in") is None


@pytest.mark.parametrize("text,bucket", [("CREDIT", "credit"), ("trade", "trade_in"), (" General ", "general"),
                                         ("Trade-in", "trade_in"), ("credit please", None), ("", None)])
def test_demo_keywords(text, bucket):
    assert lead_bucket.demo_keyword(text) == bucket


def test_for_compose_carries_the_word_track_and_vehicle_type():
    state = {"bucket": "trade_in", "original_bucket": "credit"}
    out = lead_bucket.for_compose(state, {"interest.new_or_used": "used"})
    assert out["name"] == "trade_in" and out["original"] == "credit"
    assert "appraisal" in out["emphasis"] and "CARFAX" in out["vehicle_type_emphasis"]
    assert lead_bucket.for_compose({}, {}) is None


# --- Through the turn -------------------------------------------------------------------------

def _deps(**settings):
    config = make_settings("DEV")
    for key, value in settings.items():
        setattr(config, key, value)
    return TurnDeps(settings=config, sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(mongo, *, source, comments, lead_type="sales", deps=None):
    created = await simulate.create_lead(DEALER, lead_type=lead_type, channel="sms", name="Bea Bucket",
                                         comments=comments)
    update = {"source": source, "lead_source": source}
    if lead_type is None:
        update["data.lead_type"] = None
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])}, {"$set": update})
    await run_turn(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                   trigger="lead_created", channel="sms", inbound_text=comments, shadow=False, deps=deps or _deps())
    return created


async def _state(mongo, created):
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}) or {}


async def _first_sms(mongo, created):
    row = await mongo[DEV_OUTBOX_COLLECTION].find_one({"lead_id": created["lead_id"]})
    return row["text"]


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")
async def test_a_credit_lead_is_bucketed_and_the_first_reply_uses_its_word_track(mongo):
    created = await _lead(mongo, source="Capital One", comments="Looking for a used Honda CR-V")
    state = await _state(mongo, created)
    assert state["bucket"] == state["original_bucket"] == "credit" and state["bucket_method"] == "source"
    assert "financing options" in await _first_sms(mongo, created)
    log = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"]})
    decide = next(n for n in log["nodes"] if n["node"] == "decide")
    assert decide["output"]["bucket"]["name"] == "credit"
    # The same cadence/workflow as any other lead: the bucket changes only the language.
    assert decide["output"]["action"] in ("ask", "answer", "offer_visit")

    profile = await lead_profile(DEALER, created["lead_id"])
    assert profile["lead"]["bucket"] == "credit" and profile["lead"]["original_bucket"] == "credit"
    assert profile["bucket"]["method"] == "source" and not profile["bucket"]["overridden"]


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")
async def test_a_reply_with_a_different_intent_moves_the_bucket_and_keeps_the_original(mongo):
    created = await _lead(mongo, source="Capital One", comments="Looking for a used Honda CR-V")
    event = InboundMessageEvent(event_id="m-1", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id="m-1", channel="sms",
                                text="Actually I just want to sell my car", received_at=clock.now())
    await handle_inbound_message(event, _deps())
    state = await _state(mongo, created)
    assert state["bucket"] == "trade_in" and state["original_bucket"] == "credit"
    assert [h["bucket"] for h in state["bucket_history"]] == ["credit", "trade_in"]
    profile = await lead_profile(DEALER, created["lead_id"])
    assert profile["bucket"]["overridden"] and profile["bucket"]["method"] == "behaviour_override"


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")
async def test_demo_keyword_picks_the_bucket_and_is_not_answered(mongo):
    created = await _lead(mongo, source="sms", comments="CREDIT", lead_type=None,
                          deps=_deps(demo_bucket_keywords=True))
    state = await _state(mongo, created)
    assert state["bucket"] == "credit" and state["bucket_method"] == "demo_keyword"
    log = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"]})
    extract = next(n for n in log["nodes"] if n["node"] == "extract")
    assert not (extract.get("output") or {}).get("questions")
    # An SMS-started lead isn't asked "buying, trading in or service?" after the tester chose.
    fact = await mongo[QUALIFICATION_FACTS_COLLECTION].find_one({"lead_id": created["lead_id"],
                                                                 "path": "interest.lead_type"})
    assert fact["value"] == "sales" and fact["quote"] == "CREDIT"
    assert "CREDIT" not in await _first_sms(mongo, created)


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")
async def test_demo_keyword_is_off_by_default(mongo):
    assert make_settings("DEV").demo_bucket_keywords is False
    created = await _lead(mongo, source="sms", comments="TRADE", lead_type=None)
    state = await _state(mongo, created)
    assert state["bucket_method"] != "demo_keyword"
