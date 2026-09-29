"""MASTER_PLAN_2 Phase 2, never silent: the SMS contact window, business
minutes, holding replies on a handed-off lead, the staff check 30 business
minutes after a handoff, and a recorded reason for every message the AI
doesn't answer.

Times are fixed: the dev dealer A is in New York, open Monday-Friday
9:00-19:00 and Saturday 9:00-17:00 (devtools/simulate.py). In September New
York is UTC-4."""

from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent.templates import HOLDING_REPLIES
from upsell_agent.agent.turn import TurnDeps, run_turn
from upsell_agent.api.leads import lead_profile
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import (
    InboundMessageEvent,
    LeadCreatedEvent,
    LeadPausedEvent,
    LeadResumedEvent,
)
from upsell_agent.integrations.dealer_profile import DEFAULT_HOURS
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.rollout import rollout_check
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import followups
from upsell_agent.scheduler.contact_window import (
    add_business_minutes,
    is_proactive_sms_allowed,
    next_contact_time,
    proactive_send_time,
)

NY = ZoneInfo("America/New_York")
DEALER = simulate.DEV_DEALERS[0]["_id"]
# The send check needs the customer's zone; dev customers have none (conftest.py).
pytestmark = pytest.mark.usefixtures("ny_customer")


def ny(day: int, hour: int, minute: int = 0) -> datetime:
    """September `day`, 2026 at hour:minute New York time, as UTC. Sept 22 is a Tuesday."""
    return datetime(2026, 9, day, hour, minute, tzinfo=NY).astimezone(UTC)


# --- Contact window and business minutes ------------------------------------------

@pytest.mark.parametrize(("hour", "minute", "allowed"), [
    (7, 59, False), (8, 0, True), (13, 0, True), (19, 59, True), (20, 0, False), (23, 30, False)])
def test_contact_window_edges(hour, minute, allowed):
    assert is_proactive_sms_allowed(ny(22, hour, minute), NY) is allowed


def test_next_contact_time():
    assert next_contact_time(ny(22, 13), NY) == ny(22, 13)
    assert next_contact_time(ny(22, 6, 15), NY) == ny(22, 8)
    assert next_contact_time(ny(22, 21), NY) == ny(23, 8)
    assert next_contact_time(ny(22, 21), NY).tzinfo == UTC


def test_email_is_never_held():
    assert proactive_send_time(ny(22, 23), "email", NY) == ny(22, 23)
    assert proactive_send_time(ny(22, 23), "sms", NY) == ny(23, 8)


@pytest.mark.parametrize(("start", "expected"), [
    (ny(22, 10), ny(22, 10, 30)),       # Tuesday morning: straight 30 minutes
    (ny(22, 17, 45), ny(23, 9, 15)),    # 15 before closing (default 18:00), 15 next morning
    (ny(22, 7), ny(22, 9, 30)),         # before opening: counted from 9:00
    (ny(26, 17, 50), ny(28, 9, 20)),    # Saturday 17:50 after closing, Sunday closed → Monday
    (ny(27, 12), ny(28, 9, 30)),        # Sunday (closed) → Monday
])
def test_business_minutes(start, expected):
    assert add_business_minutes(start, 30, DEFAULT_HOURS, NY) == expected


def test_business_minutes_with_the_dealers_own_hours():
    hours = {0: (time(8), time(20)), **{d: None for d in range(1, 7)}}  # Mondays only
    assert add_business_minutes(ny(22, 10), 30, hours, NY) == ny(28, 8, 30)


# --- Wiring -----------------------------------------------------------------------------

@pytest.fixture
async def dealers(mongo):
    await simulate.ensure_platform_dealers()


def _deps() -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(), store_prompts=True,
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(channel="sms", comments="Looking at a used Honda CR-V", shadow=False):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel=channel, name="Hana Holding",
                                         comments=comments)
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel=channel, shadow=shadow), _deps())
    return created


async def _say(created, text, channel="sms", shadow=False):
    message_id = str(ObjectId())
    return await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel=channel, message_id=message_id, text=text, received_at=clock.now(), shadow=shadow), _deps())


async def _state(mongo, created):
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})


async def _scheduled(mongo, created, kind):
    rows = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find({"lead_id": created["lead_id"]}).to_list(None)
    return [r for r in rows if (r.get("kind") or followups.KIND_CHANNEL_SWITCH) == kind]


async def _outbox(mongo, created, channel="sms"):
    return await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"], "channel": channel}).to_list(None)


async def _handed_off(mongo, when=None):
    set_clock(when or ny(22, 10))
    created = await _lead()
    result = await _say(created, "Can a real person call me instead?")
    assert result["outcome"] == "handoff"
    return created


def _move(minutes: float) -> None:
    clock.set_offset(clock.offset_s() + minutes * 60)


async def test_handoff_schedules_a_staff_check_in_business_minutes(mongo, dealers):
    created = await _handed_off(mongo)
    state = await _state(mongo, created)
    assert state["status"] == "handoff" and state["handoff_id"] and state["last_handoff_notice_at"]
    [check] = await _scheduled(mongo, created, followups.KIND_HANDOFF_CHECK)
    assert check["status"] == "pending" and check["handoff_id"] == state["handoff_id"]
    assert abs((check["due_at"].replace(tzinfo=UTC) - ny(22, 10, 30)).total_seconds()) < 5
    # The handoff reply itself never schedules a channel switch.
    assert [f["status"] for f in await _scheduled(mongo, created, followups.KIND_CHANNEL_SWITCH)] == ["cancelled"]


async def test_one_holding_reply_every_two_hours(mongo, dealers):
    created = await _handed_off(mongo)
    handoff_messages = len(await _outbox(mongo, created))

    _move(5)
    early = await _say(created, "Also I'm free after 5")
    assert early["status"] == "saved_only" and "at most one holding reply" in early["reason"]
    assert len(await _outbox(mongo, created)) == handoff_messages

    _move(125)
    later = await _say(created, "Hello? Still waiting")
    assert later["status"] == "holding_reply" and later["send_status"] == "sent"
    sent = await _outbox(mongo, created)
    assert len(sent) == handoff_messages + 1
    assert sent[-1]["text"] == HOLDING_REPLIES["holding"].sms.format(name="Hana")

    turns = await mongo[AI_TURN_LOG_COLLECTION].find(
        {"lead_id": created["lead_id"], "trigger": "inbound_held"}).sort("created_at", 1).to_list(None)
    assert [t["outcome"] for t in turns] == ["saved_only", "holding_reply"]
    unanswered = await mongo[AI_MESSAGES_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "direction": "inbound", "answered_turn_id": None})
    assert unanswered == 0
    # A holding reply never schedules a channel switch.
    assert [f["status"] for f in await _scheduled(mongo, created, followups.KIND_CHANNEL_SWITCH)] == ["cancelled"]


async def test_holding_reply_by_email_uses_the_email_version(mongo, dealers):
    set_clock(ny(22, 10))
    created = await _lead(channel="email")
    await _say(created, "Please have a manager call me", channel="email")
    _move(150)
    assert (await _say(created, "Any update?", channel="email"))["status"] == "holding_reply"
    last = (await _outbox(mongo, created, "email"))[-1]
    assert last["subject"] == HOLDING_REPLIES["holding"].email_subject and "passed it to the team" in last["text"]


async def test_customer_message_does_not_cancel_the_staff_check(mongo, dealers):
    created = await _handed_off(mongo)
    await _say(created, "ok")
    [check] = await _scheduled(mongo, created, followups.KIND_HANDOFF_CHECK)
    assert check["status"] == "pending"


async def test_staff_check_fires_once_with_a_holding_reply_and_an_alert(mongo, dealers):
    created = await _handed_off(mongo)
    before = len(await _outbox(mongo, created))
    _move(31)
    await followups.fire_due(_deps())

    [check] = await _scheduled(mongo, created, followups.KIND_HANDOFF_CHECK)
    assert check["status"] == "sent"
    sent = await _outbox(mongo, created)
    assert len(sent) == before + 1 and sent[-1]["text"] == HOLDING_REPLIES["still_waiting"].sms.format(name="Hana")
    state = await _state(mongo, created)
    assert state["status"] == "handoff"  # stays with staff
    assert state["staff_alert"]["customer_notified"] and "30 business minutes" in state["staff_alert"]["reason"]
    turn = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"], "trigger": "handoff_check"})
    assert turn["outcome"] == "handoff_check_sent"

    profile = await lead_profile(DEALER, created["lead_id"])
    assert profile["staff_alert"]["reason"] and profile["pending_staff_check"] is None
    report = await rollout_check(DEALER, days=1)
    assert [a["lead_id"] for a in report["staff_alerts"]] == [created["lead_id"]]

    _move(120)
    await followups.fire_due(_deps())
    assert len(await _outbox(mongo, created)) == before + 1  # once per handoff


async def test_staff_pausing_the_lead_cancels_the_check(mongo, dealers):
    created = await _handed_off(mongo)
    await handlers.handle_lead_paused(LeadPausedEvent(event_id="p", dealer_id=DEALER, lead_id=created["lead_id"],
                                                      reason="Staff replied"))
    [check] = await _scheduled(mongo, created, followups.KIND_HANDOFF_CHECK)
    assert check["status"] == "cancelled"


async def test_resumed_lead_cancels_the_check_when_it_comes_due(mongo, dealers):
    created = await _handed_off(mongo)
    before = len(await _outbox(mongo, created))
    await handlers.handle_lead_resumed(LeadResumedEvent(event_id="r", dealer_id=DEALER, lead_id=created["lead_id"]))
    _move(31)
    await followups.fire_due(_deps())
    [check] = await _scheduled(mongo, created, followups.KIND_HANDOFF_CHECK)
    assert check["status"] == "cancelled" and "lead is active" in check["reason"]
    assert len(await _outbox(mongo, created)) == before
    assert "staff_alert" not in (await _state(mongo, created)) or not (await _state(mongo, created))["staff_alert"]


async def test_a_new_handoff_replaces_the_old_check(mongo, dealers):
    created = await _handed_off(mongo)
    await handlers.handle_lead_resumed(LeadResumedEvent(event_id="r", dealer_id=DEALER, lead_id=created["lead_id"]))
    await _say(created, "Actually can someone call me please?")
    checks = await _scheduled(mongo, created, followups.KIND_HANDOFF_CHECK)
    assert sorted(c["status"] for c in checks) == ["pending", "superseded"]


async def test_handoff_after_closing_waits_for_opening_hours(mongo, dealers):
    created = await _handed_off(mongo, when=ny(22, 19, 30))  # after the dev dealer's 19:00 close
    [check] = await _scheduled(mongo, created, followups.KIND_HANDOFF_CHECK)
    assert abs((check["due_at"].replace(tzinfo=UTC) - ny(23, 9, 30)).total_seconds()) < 5


async def test_guard_failing_twice_also_gets_a_staff_check(mongo, dealers):
    set_clock(ny(22, 10))
    created = await _lead()
    await _say(created, "What's the best price? #fallback")
    state = await _state(mongo, created)
    assert state["status"] == "handoff" and state["status_reason"] == "AI couldn't write a safe reply"
    [check] = await _scheduled(mongo, created, followups.KIND_HANDOFF_CHECK)
    assert check["handoff_reason"] == "AI couldn't write a safe reply"


async def test_shadow_handoff_schedules_no_check(mongo, dealers):
    set_clock(ny(22, 10))
    created = await _lead(shadow=True)
    await _say(created, "Can a real person call me?", shadow=True)
    assert await _scheduled(mongo, created, followups.KIND_HANDOFF_CHECK) == []


# --- The 24h channel switch and the contact window ---------------------------------

async def test_switch_to_sms_planned_after_dark_waits_for_8am(mongo, dealers):
    set_clock(ny(22, 21))
    created = await _lead(channel="email")
    [switch] = await _scheduled(mongo, created, followups.KIND_CHANNEL_SWITCH)
    assert switch["to_channel"] == "sms"
    # The send check: 8:00 customer time and the dealer open (9:00), architecture decision 24.
    assert abs((switch["due_at"].replace(tzinfo=UTC) - ny(24, 9)).total_seconds()) < 5
    assert "send check" in switch["reason"] and "dealer closed" in switch["reason"]


async def test_switch_to_email_is_never_held(mongo, dealers):
    set_clock(ny(22, 21))
    created = await _lead(channel="sms")
    [switch] = await _scheduled(mongo, created, followups.KIND_CHANNEL_SWITCH)
    assert abs((switch["due_at"].replace(tzinfo=UTC) - ny(23, 21)).total_seconds()) < 5


async def test_sms_switch_due_after_dark_is_deferred_when_it_fires(mongo, dealers):
    set_clock(ny(22, 10))
    created = await _lead(channel="email")
    [switch] = await _scheduled(mongo, created, followups.KIND_CHANNEL_SWITCH)
    set_clock(ny(22, 22))  # due "now", but at 22:00 (e.g. a retry or a stuck claim)
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].update_one({"_id": switch["_id"]}, {"$set": {"due_at": clock.now()}})
    await followups.fire_due(_deps())

    doc = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"_id": switch["_id"]})
    assert doc["status"] == "pending" and "send check" in doc["reason"]
    assert abs((doc["due_at"].replace(tzinfo=UTC) - ny(23, 9)).total_seconds()) < 5
    assert await _outbox(mongo, created, "sms") == []
    turn = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"], "trigger": "followup"})
    assert turn["outcome"] == "followup_deferred"

    set_clock(ny(23, 9, 1))
    await followups.fire_due(_deps())
    assert len(await _outbox(mongo, created, "sms")) == 1


async def test_failed_email_switches_to_sms_only_inside_the_window(mongo, dealers):
    set_clock(ny(22, 22))
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="email", name="Night Owl",
                                         comments="hi")
    driver = FakeChannelDriver(fail_first=1, permanent_failure=True)
    deps = TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(driver, StubPlatformClient(), retry_base_s=0))
    await run_turn(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                   trigger="lead_created", channel="email", inbound_text="hi", shadow=False, deps=deps)
    [switch] = await _scheduled(mongo, created, followups.KIND_CHANNEL_SWITCH)
    assert abs((switch["due_at"].replace(tzinfo=UTC) - ny(23, 9)).total_seconds()) < 5


async def test_debug_conversation_shows_each_sent_message_once(mongo, dealers):
    from upsell_agent.api.dev import conversation

    created = await _handed_off(mongo)
    _move(31)
    await followups.fire_due(_deps())
    items = await conversation(created["lead_id"], DEALER)
    waiting = [i for i in items if "Sorry for the wait" in (i.get("text") or "")]
    assert [(i["kind"], i["status"]) for i in waiting] == [("message", "sent")]


async def test_fired_channel_switch_is_not_shown_twice(mongo, dealers):
    from upsell_agent.api.dev import conversation

    set_clock(ny(22, 10))
    created = await _lead()
    _move(24 * 60 + 1)
    await followups.fire_due(_deps())
    items = await conversation(created["lead_id"], DEALER)
    assert [i for i in items if i["kind"] == "draft"] == []
    assert len([i for i in items if i["direction"] == "outbound"]) == 2  # the reply + its email re-send
