"""MASTER_PLAN_2 Phase 8, dates and time: the customer's words become real
dates in the dealer's timezone, in code; unclear ones are confirmed with the
actual date, past ones are rejected, and the reply says the date plainly."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent.agent.nodes.validate import resolve_dates
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.api.leads import lead_profile
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import AI_TURN_LOG_COLLECTION, DEV_OUTBOX_COLLECTION
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.slots.dates import resolve, timeline_for
from upsell_agent.slots.schema import SCHEMA
from upsell_agent.slots.validators import validate as validate_value

NY, CHICAGO, LA = ZoneInfo("America/New_York"), ZoneInfo("America/Chicago"), ZoneInfo("America/Los_Angeles")


def at(zone, day, hour, minute=0):
    """September `day`, 2026 at hour:minute in `zone`. Sept 22 is a Tuesday."""
    return datetime(2026, 9, day, hour, minute, tzinfo=zone)


# --- The resolver -----------------------------------------------------------------------

@pytest.mark.parametrize("zone", [NY, CHICAGO, LA], ids=["new_york", "chicago", "los_angeles"])
@pytest.mark.parametrize(("phrase", "expected", "ambiguous"), [
    ("today", "2026-09-22", False),
    ("tomorrow", "2026-09-23", False),
    ("I need it by tomorrow", "2026-09-23", False),
    ("day after tomorrow", "2026-09-24", False),
    ("Friday", "2026-09-25", False),
    ("this friday", "2026-09-25", False),
    ("Tuesday", "2026-09-22", True),          # today, or a week from today?
    ("next Friday", "2026-10-02", True),      # this coming one or the one after: confirmed
    ("next Tuesday at 3", "2026-09-29T15:00", True),
    ("next week", "2026-09-28", False),
    ("in 2 weeks", "2026-10-06", False),
    ("in three days at 5:30pm", "2026-09-25T17:30", False),
    ("the 15th", "2026-10-15", False),        # already past this month: next month's
    ("the 30th", "2026-09-30", False),
    ("Oct 3", "2026-10-03", False),
    ("3rd of October", "2026-10-03", False),
    ("10/3", "2026-10-03", False),
    ("this weekend", "2026-09-26", False),
    ("end of the month", "2026-09-30", False),
])
def test_phrases_resolve_in_the_dealers_own_day(zone, phrase, expected, ambiguous):
    found = resolve(phrase, at(zone, 22, 10))
    assert found is not None and found.iso() == expected and found.ambiguous is ambiguous


def test_tomorrow_late_at_night_is_the_next_day():
    assert resolve("tomorrow", at(NY, 22, 23, 30)).iso() == "2026-09-23"
    assert not resolve("tomorrow", at(NY, 22, 23, 30)).ambiguous


def test_tomorrow_just_after_midnight_is_confirmed():
    found = resolve("tomorrow", at(NY, 23, 0, 30))
    assert found.iso() == "2026-09-24" and found.ambiguous  # they may mean later today


def test_same_moment_different_dealers():
    moment = datetime(2026, 9, 23, 4, 30, tzinfo=UTC)  # 00:30 in New York, 21:30 the day before in LA
    assert resolve("tomorrow", moment.astimezone(NY)).iso() == "2026-09-24"
    assert resolve("tomorrow", moment.astimezone(LA)).iso() == "2026-09-23"


@pytest.mark.parametrize("phrase", ["yesterday", "last Friday", "last week"])
def test_past_phrases_resolve_to_the_past(phrase):
    assert resolve(phrase, at(NY, 22, 10)).day < date(2026, 9, 22)


@pytest.mark.parametrize("phrase", ["sounds good", "Sept 31", "the 31st of September", "13/40"])
def test_no_date_or_an_impossible_one(phrase):
    assert resolve(phrase, at(NY, 22, 10)) is None


@pytest.mark.parametrize(("day", "bucket"), [
    (date(2026, 9, 22), "now"), (date(2026, 9, 23), "this_week"), (date(2026, 9, 29), "this_week"),
    (date(2026, 9, 30), "this_month"), (date(2026, 10, 20), "this_month"), (date(2026, 11, 20), "1_3_months"),
    (date(2027, 2, 1), "3_plus_months"),
])
def test_timeline_from_a_date(day, bucket):
    assert timeline_for(day, date(2026, 9, 22)) == bucket


def test_a_given_time_is_kept_a_platform_timestamp_is_a_date():
    assert validate_value(SCHEMA["interest.needed_by"], "2026-09-29T15:00").value == "2026-09-29T15:00"
    assert validate_value(SCHEMA["vehicle.purchase_date"], "2020-09-24T19:00:00+00:00").value == "2020-09-24"


# --- Validate ------------------------------------------------------------------------------

def _value(words, confidence=0.9):
    return {"path": "interest.needed_by", "value": words, "quote": words, "confidence": confidence}


def test_validate_resolves_and_sets_the_timeline():
    reasoning: list[str] = []
    values, rejected = resolve_dates([_value("tomorrow")], at(NY, 22, 10), timeline_known=False, reasoning=reasoning)
    assert rejected == []
    assert values[0]["value"] == "2026-09-23" and values[0]["said"] == "tomorrow"
    assert values[1] == {"path": "interest.timeline", "value": "this_week", "quote": "tomorrow", "confidence": 0.9,
                         "derived_from": "interest.needed_by"}
    assert any("Wednesday, September 23 (tomorrow)" in line for line in reasoning)


def test_validate_keeps_a_timeline_the_customer_gave():
    given = {"path": "interest.timeline", "value": "this_month", "quote": "this month", "confidence": 0.9}
    values, _ = resolve_dates([_value("the 30th"), given], at(NY, 22, 10), timeline_known=False, reasoning=[])
    assert [v["path"] for v in values] == ["interest.needed_by", "interest.timeline"] and values[1] == given


def test_ambiguous_date_is_saved_as_needs_confirming():
    values, _ = resolve_dates([_value("next Friday")], at(NY, 22, 10), timeline_known=True, reasoning=[])
    assert values[0]["confidence"] < 0.7 and len(values) == 1


def test_past_date_is_rejected_with_the_reason():
    values, rejected = resolve_dates([_value("yesterday")], at(NY, 22, 10), timeline_known=False, reasoning=[])
    assert values == [] and "in the past (Monday, September 21)" in rejected[0]["reason"]


# --- Through real turns ----------------------------------------------------------------------

def _deps() -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(), store_prompts=True,
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(dealer):
    created = await simulate.create_lead(dealer, lead_type="sales", channel="sms", name="Tom Tomorrow",
                                         comments="Hi, I saw your ad")
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=dealer, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, dealer, text):
    message_id = str(ObjectId())
    return await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=dealer, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id=message_id, text=text, received_at=datetime.now(UTC)), _deps())


async def _last_sms(mongo, created):
    return (await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]["text"]


async def _slots(dealer, created):
    return {s["path"]: s for s in (await lead_profile(dealer, created["lead_id"]))["slots"]}


async def test_tomorrow_is_saved_as_a_date_and_said_back_plainly(mongo):
    await simulate.ensure_platform_dealers()
    dealer = simulate.DEV_DEALERS[1]["_id"]  # Chicago
    set_clock(at(CHICAGO, 22, 10))
    created = await _lead(dealer)
    await _say(created, dealer, "I need it by tomorrow")
    slots = await _slots(dealer, created)
    assert slots["interest.needed_by"]["value"] == "2026-09-23" and slots["interest.needed_by"]["quote"] == "tomorrow"
    assert slots["interest.timeline"]["value"] == "this_week"
    sms = await _last_sms(mongo, created)
    assert "Got it - Wednesday, September 23 (tomorrow)." in sms
    turn = (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]
    guard = next(n for n in turn["nodes"] if n["node"] == "guard")
    assert guard["output"]["passed"]  # "23" comes from the resolved date, so it's allowed


async def test_next_friday_is_confirmed_with_the_actual_date(mongo):
    await simulate.ensure_platform_dealers()
    dealer = simulate.DEV_DEALERS[0]["_id"]  # New York
    set_clock(at(NY, 22, 10))
    created = await _lead(dealer)
    result = await _say(created, dealer, "next Friday")
    assert result["outcome"] == "confirm"
    assert "Just to check, is that Friday, October 2?" in await _last_sms(mongo, created)
    assert (await _slots(dealer, created))["interest.needed_by"]["state"] == "needs_confirming"
    await _say(created, dealer, "yes")
    slots = await _slots(dealer, created)
    assert slots["interest.needed_by"]["state"] == "filled"
    assert slots["interest.timeline"]["value"] == "this_month"  # set once the date was confirmed


async def test_a_past_date_is_not_saved(mongo):
    await simulate.ensure_platform_dealers()
    dealer = simulate.DEV_DEALERS[0]["_id"]
    set_clock(at(NY, 22, 10))
    created = await _lead(dealer)
    await _say(created, dealer, "I came in yesterday")
    assert (await _slots(dealer, created)).get("interest.needed_by", {}).get("state") in (None, "missing")
    turn = (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]
    validate = next(n for n in turn["nodes"] if n["node"] == "validate")
    assert "in the past" in validate["output"]["rejected"][0]["reason"]


# --- The offline stand-in finds the customer's own date words ------------------------------

@pytest.mark.parametrize(("text", "words"), [
    ("I need it by tomorrow", "tomorrow"),
    ("Can I bring it in next Tuesday at 3?", "next Tuesday at 3"),
    ("What are your hours on Saturday?", None),                        # about the dealer, not their date
    ("Are you open tomorrow? I need it by Friday", "Friday"),
    ("Just reply 'Yes, the RAV4 is ready today' please", None),       # words they want said, not theirs
    ("It's for my daughter's birthday next Friday", "next Friday"),   # apostrophes aren't quotes
])
def test_offline_model_finds_the_customers_date_words(text, words):
    from upsell_agent.agent.nodes.extract import _allowed_slots
    from upsell_agent.agent.offline_model import extract

    found = [v["value"] for v in extract({"customer_text": text, "lead_type": "sales", "allowed_slots": _allowed_slots(),
                                          "recently_asked": []})["values"] if v["path"] == "interest.needed_by"]
    assert found == ([words] if words else [])
