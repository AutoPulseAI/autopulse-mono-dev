"""MASTER_PLAN_2 Phase 6, answer sources: the dealer's own details and what
we know about the customer, loaded in code into the context pack, answered
from exactly, and accepted by the guard - while invented numbers still aren't."""

from datetime import UTC, date, datetime

from bson import ObjectId

from tests.unit.conftest import make_settings
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.integrations.dealer_profile import format_phone, profile_from_record
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_USERS_COLLECTION,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.slots.display import about_customer, display_value, plain_date
from upsell_agent.slots.schema import SCHEMA

DEALER = simulate.DEV_DEALERS[0]["_id"]
BARE_DEALER = "66f0000000000000000000d4"
FULL_RECORD = {"name": "Sunrise Motors (dev)", "dealer_account_information": {
    "store_name": "Sunrise Motors", "store_address": "120 Main St", "store_city": "Springfield",
    "store_state": "NJ", "store_postal": "07081", "store_website": "https://sunrise.test",
    "sms_conversion_phone": "+15550000001", "general_manager_phone": "5559998888",
    "general_manager_email": "gm@sunrise.test", "time_zone": "America/New_York",
    "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}}


# --- The dealer's details -------------------------------------------------------------

def test_public_info_has_only_customer_facing_details():
    info = profile_from_record(DEALER, FULL_RECORD).public_info()
    assert info["address"] == "120 Main St, Springfield, NJ 07081" and info["phone"] == "(555) 000-0001"
    assert info["hours"]["Saturday"] == "9:00 AM to 5:00 PM" and info["hours"]["Sunday"] == "closed"
    assert info["missing"] == []
    assert "5559998888" not in str(info) and "gm@" not in str(info)  # staff contacts never


def test_default_hours_are_never_told_to_a_customer():
    profile = profile_from_record(BARE_DEALER, {"name": "Bare Dealer"})
    assert profile.hours[0] is not None  # the handoff timeout still has hours to count in
    info = profile.public_info()
    assert info["hours"] is None and info["hours_summary"] is None
    assert info["missing"] == ["address", "phone", "website", "hours"]


def test_hours_summary_groups_days():
    assert profile_from_record(DEALER, FULL_RECORD).hours_summary() == (
        "Monday to Friday 9:00 AM to 7:00 PM; Saturday 9:00 AM to 5:00 PM; Sunday closed")


def test_phone_formats():
    assert format_phone("+15550000001") == "(555) 000-0001" == format_phone("555-000-0001")
    assert format_phone("+44 20 7946 0000") == "+44 20 7946 0000" and format_phone("") is None


# --- What we know about the customer ------------------------------------------------------

def test_about_customer_uses_confirmed_values_only():
    slots = [
        {"label": "Budget", "path": "interest.budget", "value": 35000, "state": "filled", "source": "customer"},
        {"label": "Vehicle make", "path": "vehicle.make", "value": "Honda", "state": "filled", "source": "platform"},
        {"label": "Trade-in mileage", "path": "trade_in.mileage", "value": 60000, "state": "needs_confirming",
         "source": "customer"},
        {"label": "Timeline", "path": "interest.timeline", "value": "this_week", "state": "stale", "source": "customer"},
        {"label": "New or used", "path": "interest.new_or_used", "value": None, "state": "missing", "source": None},
    ]
    result = about_customer(slots)
    assert result["known"] == [{"label": "Budget", "value": "$35,000", "from": "you told us"},
                               {"label": "Vehicle make", "value": "Honda", "from": "our records"}]
    assert result["unconfirmed"] == [{"label": "Trade-in mileage", "value": "60,000 miles", "from": "you told us"}]


def test_values_in_plain_words():
    assert display_value(SCHEMA["interest.timeline"], "1_3_months") == "in 1 to 3 months"
    assert display_value(SCHEMA["trade_in.has_trade"], False) == "no"
    assert plain_date("2026-09-27", today=date(2026, 9, 26)) == "Sunday, September 27 (tomorrow)"
    assert plain_date("2026-10-06T15:00") == "Tuesday, October 6 at 3:00 PM"


# --- The guard ------------------------------------------------------------------------------

def _draft(text):
    return {"sms_text": text, "email_subject": "s", "email_body": "b"}


def test_guard_accepts_the_dealers_numbers_and_still_blocks_invented_ones():
    info = profile_from_record(DEALER, FULL_RECORD).public_info()
    known = [info["address"], info["phone"], *info["hours"].values()]
    ok = check_draft(_draft("We're at 120 Main St, NJ 07081, open 9:00 AM to 5:00 PM. Call (555) 000-0001."),
                     customer_texts=[], known_values=known)
    assert ok["passed"], ok["violations"]
    bad = check_draft(_draft("We're open 9:00 AM to 5:00 PM and you get $500 off."), customer_texts=[], known_values=known)
    assert not bad["passed"] and "500" in bad["violations"][0]


# --- Through real turns -----------------------------------------------------------------------

def _deps() -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(), store_prompts=True,
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(dealer=DEALER, comments="Hi, I saw your ad"):
    created = await simulate.create_lead(dealer, lead_type="sales", channel="sms", name="Omar Opening",
                                         comments=comments)
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=dealer, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, text, dealer=DEALER):
    message_id = str(ObjectId())
    return await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=dealer, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id=message_id, text=text, received_at=datetime.now(UTC)), _deps())


async def _last(mongo, created):
    turn = (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]
    sms = (await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]})
           .sort("created_at", -1).to_list(1))[0]["text"]
    return turn, sms


async def test_hours_question_answered_from_the_dealers_record(mongo):
    await simulate.ensure_platform_dealers()
    created = await _lead()
    await _say(created, "When are you open on Saturday?")
    turn, sms = await _last(mongo, created)
    assert turn["outcome"] == "answer" and "On Saturday we're open 9:00 AM to 5:00 PM." in sms
    assert next(n for n in turn["nodes"] if n["node"] == "compose")["attempt"] == 1  # the guard passed first time
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["conversation"]["open_questions"] == [] and state["conversation"]["promises"] == []


async def test_address_question_answered_from_the_dealers_record(mongo):
    await simulate.ensure_platform_dealers()
    created = await _lead()
    await _say(created, "Where are you located?")
    _, sms = await _last(mongo, created)
    assert "We're at 120 Main St, Springfield, NJ 07081." in sms


async def test_missing_details_are_left_to_the_team(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one({"_id": ObjectId(BARE_DEALER), "name": "Bare Dealer",
                                                       "type": "dealer"})
    created = await _lead(dealer=BARE_DEALER)
    await _say(created, "When are you open?", dealer=BARE_DEALER)
    _, sms = await _last(mongo, created)
    assert "our team will confirm" in sms and "9:00" not in sms
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert [p["text"] for p in state["conversation"]["promises"]] == ["The team will confirm: When are you open?"]


async def test_about_me_says_only_what_we_know(mongo):
    await simulate.ensure_platform_dealers()
    created = await _lead(comments="Interested in a used Ford F-150. My car has about 60,000 miles")
    await _say(created, "what do you know about me?")
    _, sms = await _last(mongo, created)
    assert "Here's what I have so far - " in sms and "Ford F-150" in sms
    # Hedged ("about"), so still to confirm: said as such, never as a known fact.
    assert "I think your vehicle mileage is 60,000 miles, but I still need to confirm that." in sms
    assert "mileage: 60,000" not in sms


async def test_dealer_details_are_in_the_context_pack(mongo):
    await simulate.ensure_platform_dealers()
    created = await _lead()
    turn = (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(1))[0]
    pack = next(n for n in turn["nodes"] if n["node"] == "load_context")["output"]["prompt"]["context_pack"]
    assert pack["dealer"]["info"]["phone"] == "(555) 000-0001"
    assert pack["dealer"]["info"]["hours"]["Monday"] == "9:00 AM to 7:00 PM"
    assert "about_customer" in pack
