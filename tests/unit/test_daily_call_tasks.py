"""PLAN_4 stream T: the Days 1-7 morning + afternoon human call tasks (scheduler/daily_call_tasks.py) and missed
call tasks (agent/call_tasks.py mark_missed). The dealer is in New York, open Monday-Friday 9:00-19:00 and
Saturday 9:00-17:00 (the dev hours). The clock is moved; nothing waits."""

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent import call_tasks, lifecycle
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.api.staff_view import get_missed_by_agent, list_call_tasks
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.integrations.dealer_profile import profile_from_record
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.scheduler import daily_call_tasks, followups

DEALER = simulate.DEV_DEALERS[0]["_id"]
NY = ZoneInfo("America/New_York")
AGENT = "66f00000000000000000a9e1"
pytestmark = pytest.mark.usefixtures("ny_customer")


def ny(day: int, hour: int, minute: int = 0) -> datetime:
    """September 2026 in New York: the 22nd is a Tuesday."""
    return datetime(2026, 9, day, hour, minute, tzinfo=NY).astimezone(UTC)


START = ny(22, 8)


@pytest.fixture(autouse=True)
def early_start():
    set_clock(START)


def _record(setting: str | None = None) -> dict:
    info = {"time_zone": "America/New_York", "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}
    if setting is not None:
        info["ai_daily_call_tasks"] = setting
    return {"_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True},
            "dealer_account_information": info}


@pytest.fixture
async def dealer(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one(_record())


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(mongo, *, started=START, stage="new_lead", assigned=True):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Dana Daily",
                                         comments="Looking at a Camry")
    if assigned:
        await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                          {"$set": {"assigned_to": ObjectId(AGENT)}})
    await mongo[AI_LEAD_STATE_COLLECTION].update_one(
        {"lead_id": created["lead_id"]},
        {"$set": {"dealer_id": DEALER, "lead_id": created["lead_id"], "customer_id": created["customer_id"],
                  "status": "active", "stage": stage, "cadence": {"started_at": started, "touch_number": 3}}},
        upsert=True)
    return created


async def _plan(created):
    return await daily_call_tasks.plan(dealer_scoped_db(DEALER), lead_id=created["lead_id"],
                                       customer_id=created["customer_id"])


async def _fire():
    return (await followups.fire_due(_deps()))["results"]


async def _docs(mongo, created, status=None):
    flt = {"lead_id": created["lead_id"], "kind": "daily_call_task", **({"status": status} if status else {})}
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(flt).sort("due_at", 1).to_list(None)


async def _tasks(mongo, created, status=None):
    flt = {"lead_id": created["lead_id"], **({"status": status} if status else {})}
    return await mongo[AI_CALL_TASKS_COLLECTION].find(flt).sort("opened_at", 1).to_list(None)


def _utc(value):
    return value if value.tzinfo else value.replace(tzinfo=UTC)


# --- The windows ------------------------------------------------------------------------------------

def test_morning_is_opening_to_noon_and_afternoon_noon_to_closing_on_working_days_only():
    profile = profile_from_record(DEALER, _record())
    [(m, m_start, m_end), (a, a_start, a_end)] = daily_call_tasks.windows(profile, date(2026, 9, 22))
    assert (m, m_start.time(), m_end.time()) == ("morning", time(9), time(12))
    assert (a, a_start.time(), a_end.time()) == ("afternoon", time(12), time(19))
    assert daily_call_tasks.windows(profile, date(2026, 9, 27)) == []  # Sunday: closed
    # Started on a Friday: Days 1-7 are Fri..Thu, Sunday has no calls -> 6 working days, 12 half-days.
    slots = daily_call_tasks.slots(profile, ny(25, 10))
    assert len(slots) == 12 and {s.day for s in slots} == {1, 2, 4, 5, 6, 7}
    assert slots[-1].start.date() == date(2026, 10, 1)


def test_the_setting_defaults_to_on_and_reads_off():
    assert profile_from_record(DEALER, _record()).daily_call_tasks is True
    assert profile_from_record(DEALER, _record("off")).daily_call_tasks is False
    assert profile_from_record(DEALER, _record("on")).daily_call_tasks is True


# --- Opening, assignment and the chain ---------------------------------------------------------------

async def test_the_morning_task_opens_at_opening_for_the_assigned_agent(mongo, dealer):
    created = await _lead(mongo)
    planned = await _plan(created)
    assert planned["created"] and planned["slot"] == "morning" and planned["day"] == 1
    assert (await _plan(created))["created"] is False  # one waiting record per lead

    set_clock(ny(22, 9, 1))
    assert (await _fire())["activated"] == 1
    [task] = await _tasks(mongo, created)
    assert task["status"] == "open" and task["source"] == "daily" and task["slot"] == "morning"
    assert task["assigned_to"] == AGENT and task["phone"]
    assert _utc(task["due_by"]) == ny(22, 12)
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["staff_notice"]["kind"] == "call_task" and "Day 1 morning" in state["staff_notice"]["text"]
    # The chain: the afternoon is planned next, due at noon.
    [nxt] = await _docs(mongo, created, "pending")
    assert nxt["slot"] == "afternoon" and _utc(nxt["due_at"]) == ny(22, 12)


async def test_an_unfinished_task_is_missed_and_the_afternoon_one_opens(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    set_clock(ny(22, 9, 1))
    await _fire()
    set_clock(ny(22, 12, 1))
    assert (await _fire())["activated"] == 1
    morning, afternoon = await _tasks(mongo, created)
    assert morning["status"] == "missed" and morning["missed_at"] and morning["assigned_to"] == AGENT
    assert afternoon["status"] == "open" and afternoon["slot"] == "afternoon" and _utc(afternoon["due_by"]) == ny(22, 19)
    # Done tab shows it as missed; the per-agent count counts it.
    done = await list_call_tasks(DEALER, "done")
    assert [t["status"] for t in done] == ["missed"]
    assert (await get_missed_by_agent(DEALER, days=30))["agents"] == [{"assigned_to": AGENT, "missed": 1}]
    # Staff can still record the late call; it stays counted as missed.
    resolved = await call_tasks.resolve(dealer_scoped_db(DEALER), str(morning["_id"]), status="completed",
                                        outcome="no_answer", by="Sam")
    assert resolved["status"] == "completed" and resolved["missed_at"]
    assert (await get_missed_by_agent(DEALER, days=30))["agents"][0]["missed"] == 1


async def test_a_completed_task_is_not_missed(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    set_clock(ny(22, 9, 1))
    await _fire()
    [task] = await _tasks(mongo, created)
    await call_tasks.resolve(dealer_scoped_db(DEALER), str(task["_id"]), status="completed", outcome="connected")
    assert await call_tasks.mark_missed(ny(22, 23)) == 0


async def test_the_60_minute_task_is_missed_at_the_end_of_the_agents_day(mongo, dealer):
    created = await _lead(mongo)
    set_clock(ny(22, 15))
    db = dealer_scoped_db(DEALER)
    task = await call_tasks.open_task(db, lead_id=created["lead_id"], customer_id=created["customer_id"],
                                      phone="+15550001111", customer_name="Dana", reason="no contact",
                                      source_turn_id=None, followup_id=None, created_at=clock.now())
    assert task["source"] == "connection_timer" and _utc(task["due_by"]) == ny(22, 19)
    assert task["assigned_to"] == AGENT
    assert await call_tasks.mark_missed(ny(22, 18, 59)) == 0
    assert await call_tasks.mark_missed(ny(22, 19, 1)) == 1


async def test_no_tasks_after_day_7_or_on_closed_days(mongo, dealer):
    created = await _lead(mongo)
    set_clock(ny(27, 10))  # Sunday, Day 6: closed -> Monday (Day 7) morning
    planned = await _plan(created)
    assert planned["day"] == 7 and planned["slot"] == "morning" and planned["due_at"] == ny(28, 9).isoformat()
    set_clock(ny(29, 9))  # Day 8
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].delete_many({"lead_id": created["lead_id"]})
    assert (await _plan(created))["reason"] == "no Days 1-7 half-day left"


# --- Dedupe --------------------------------------------------------------------------------------------

async def test_an_open_60_minute_task_covers_the_half_day(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    set_clock(ny(22, 9, 1))
    db = dealer_scoped_db(DEALER)
    await call_tasks.open_task(db, lead_id=created["lead_id"], customer_id=created["customer_id"],
                               phone="+15550001111", customer_name="Dana", reason="no contact",
                               source_turn_id=None, followup_id=None, created_at=clock.now())
    assert (await _fire())["skipped"] == 1
    [doc] = await _docs(mongo, created, "skipped")
    assert "already open" in doc["reason"]
    assert len(await _tasks(mongo, created)) == 1


async def test_a_waiting_60_minute_timer_inside_the_half_day_covers_it(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    set_clock(ny(22, 9, 1))
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].insert_one({
        "dealer_id": DEALER, "kind": "call_task", "lead_id": created["lead_id"], "customer_id": created["customer_id"],
        "status": "pending", "due_at": ny(22, 10), "created_at": clock.now(), "to": "+15550001111"})
    assert (await _fire())["skipped"] == 1
    [doc] = await _docs(mongo, created, "skipped")
    assert "60-minute" in doc["reason"]


async def test_at_most_two_call_tasks_per_lead_per_workday(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    set_clock(ny(22, 9, 1))
    for _ in range(2):
        await mongo[AI_CALL_TASKS_COLLECTION].insert_one({
            "dealer_id": DEALER, "lead_id": created["lead_id"], "status": "completed", "opened_at": ny(22, 8, 30)})
    assert (await _fire())["skipped"] == 1
    [doc] = await _docs(mongo, created, "skipped")
    assert "at most 2" in doc["reason"]
    # The 60-minute task's own re-check sees the same cap.
    check = await daily_call_tasks.workday_cap_check(dealer_scoped_db(DEALER), created["lead_id"])
    assert check[0] == "workday_cap" and check[1] is False


# --- Cancelling ------------------------------------------------------------------------------------------

async def test_a_reply_cancels_this_half_days_call_but_not_the_next(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    set_clock(ny(22, 9, 1))
    await _fire()
    set_clock(ny(22, 9, 30))
    await followups.cancel_call_task(dealer_scoped_db(DEALER), created["lead_id"], reason="the customer replied",
                                     include_open=True, keep_requested=True)
    [task] = await _tasks(mongo, created)
    assert task["status"] == "cancelled"
    [nxt] = await _docs(mongo, created, "pending")
    assert nxt["slot"] == "afternoon"


async def test_a_reply_before_a_held_task_opens_cancels_it(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    set_clock(ny(22, 9, 1))
    await mongo[AI_MESSAGES_COLLECTION].insert_one({
        "dealer_id": DEALER, "lead_id": created["lead_id"], "direction": "inbound",
        "text": "Yes still interested in the Camry, can I come Saturday?", "created_at": ny(22, 9)})
    assert (await _fire())["cancelled"] == 1
    assert await _tasks(mongo, created) == []


@pytest.mark.parametrize("stage", [lifecycle.Stage.APPOINTMENT_SET, lifecycle.Stage.SALES_VISIT,
                                   lifecycle.Stage.OPTED_OUT, lifecycle.Stage.SPECIFIC_FOLLOWUP])
async def test_leaving_short_term_cancels_the_open_and_the_waiting_task(mongo, dealer, stage):
    created = await _lead(mongo)
    await _plan(created)
    set_clock(ny(22, 9, 1))
    await _fire()
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]}, {"$set": {"stage": stage.value}})
    await lifecycle.cancel_stale_work(dealer_scoped_db(DEALER), created["lead_id"], stage, reason="stage moved")
    assert [t["status"] for t in await _tasks(mongo, created)] == ["cancelled"]
    assert await _docs(mongo, created, "pending") == []
    assert (await _plan(created))["created"] is False


async def test_a_stage_change_the_scheduler_missed_is_caught_before_opening(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]},
                                                     {"$set": {"stage": "appointment_set"}})
    set_clock(ny(22, 9, 1))
    assert (await _fire())["cancelled"] == 1
    assert await _tasks(mongo, created) == []


async def test_the_setting_off_plans_nothing_and_stops_a_waiting_one(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one(_record("off"))
    created = await _lead(mongo)
    assert (await _plan(created))["created"] is False
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].insert_one({
        "dealer_id": DEALER, "kind": "daily_call_task", "lead_id": created["lead_id"],
        "customer_id": created["customer_id"], "status": "pending", "due_at": ny(22, 9), "created_at": START,
        "slot": "morning", "slot_key": "2026-09-22:morning", "day": 1, "window_start": ny(22, 9),
        "window_end": ny(22, 12), "claim_count": 0})
    set_clock(ny(22, 9, 1))
    assert (await _fire())["cancelled"] == 1
    assert await _tasks(mongo, created) == []


# --- Call rules ------------------------------------------------------------------------------------------

async def test_a_dnd_lead_gets_no_call(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                      {"$set": {"fe_lead_status": "DND"}})
    set_clock(ny(22, 9, 1))
    assert (await _fire())["suppressed"] == 1
    assert await _tasks(mongo, created) == []


async def test_no_valid_phone_no_call(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": ObjectId(created["lead_id"])},
                                                      {"$set": {"phone": None}})
    await mongo["customers"].update_many({}, {"$set": {"phone": None, "phones": []}})
    set_clock(ny(22, 9, 1))
    assert (await _fire())["suppressed"] == 1


async def test_the_first_touch_starts_the_chain_and_its_60_minute_timer_covers_day_1(mongo, dealer):
    from upsell_agent.events import handlers
    from upsell_agent.events.models import LeadCreatedEvent

    set_clock(ny(22, 10))
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Fay First",
                                         comments="Hi, I want a new Toyota RAV4")
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    [doc] = await _docs(mongo, created, "pending")
    assert doc["day"] == 1 and doc["slot"] == "morning"
    set_clock(ny(22, 10, 1))
    await _fire()
    [skipped] = await _docs(mongo, created, "skipped")
    assert "60-minute" in skipped["reason"]
    [nxt] = await _docs(mongo, created, "pending")
    assert nxt["slot"] == "afternoon"


async def test_upcoming_lists_the_next_daily_task(mongo, dealer):
    created = await _lead(mongo)
    await _plan(created)
    [row] = await list_call_tasks(DEALER, "upcoming")
    assert row["source"] == "daily" and row["slot"] == "morning" and row["lead_id"] == created["lead_id"]
