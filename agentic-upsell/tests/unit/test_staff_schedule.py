"""Staff work schedules (client, 7 Oct 2026): a call task never goes to someone on their day off."""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from upsell_agent.agent.staff_schedule import agent_for, parse_schedule
from upsell_agent.devtools import simulate
from upsell_agent.integrations.mongodb import AI_CALL_TASKS_COLLECTION, PLATFORM_USERS_COLLECTION, dealer_scoped_db

DEALER = simulate.DEV_DEALERS[0]["_id"]
NY = ZoneInfo("America/New_York")
ALEX, BLAKE, CASEY = "66f00000000000000000b001", "66f00000000000000000b002", "66f00000000000000000b003"
WEEKDAYS_9_5 = {d: {"active": True, "start": "9:00 AM", "end": "5:00 PM"}
                for d in ("monday", "tuesday", "wednesday", "thursday", "friday")}
WEEKENDS_ONLY = {"saturday": {"active": True, "start": "10:00 AM", "end": "6:00 PM"},
                 "sunday": {"active": True, "start": "11:00 AM", "end": "5:00 PM"},
                 "tuesday": {"active": False}}


def ny(day: int, hour: int) -> datetime:
    """September 2026 in New York: the 22nd is a Tuesday, the 26th a Saturday."""
    return datetime(2026, 9, day, hour, tzinfo=NY).astimezone(UTC)


def _staff(user_id, name, schedule=None):
    doc = {"_id": ObjectId(user_id), "type": "dealer", "parent_id": ObjectId(DEALER), "name": name}
    if schedule is not None:
        doc["work_schedule"] = schedule
    return doc


@pytest.fixture
async def team(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_many([
        {"_id": ObjectId(DEALER), "type": "dealer", "dealer_account_information": {
            "time_zone": "America/New_York", "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}},
        _staff(ALEX, "Alex", WEEKDAYS_9_5),
        _staff(BLAKE, "Blake", WEEKENDS_ONLY),
        _staff(CASEY, "Casey", WEEKENDS_ONLY),
    ])


def test_parse_schedule():
    assert parse_schedule(None) is None and parse_schedule({}) is None  # no schedule: dealer hours apply
    days = parse_schedule(WEEKENDS_ONLY)
    assert days[1] is None and days[5] is not None and days[0] is None  # Tuesday off, Saturday on, Monday unset


async def test_working_salesperson_keeps_the_task(team):
    assert await agent_for(dealer_scoped_db(DEALER), ALEX, ny(22, 11)) == (ALEX, None)  # Tuesday 11 AM


async def test_off_day_goes_to_the_colleague_working_with_fewest_open_tasks(team, mongo):
    await mongo[AI_CALL_TASKS_COLLECTION].insert_one({"dealer_id": DEALER, "status": "open", "assigned_to": BLAKE})
    agent, why = await agent_for(dealer_scoped_db(DEALER), ALEX, ny(26, 12))  # Saturday noon: Alex is off
    assert agent == CASEY and "Alex is off now, so Casey has it" in why


async def test_nobody_working_leaves_it_with_the_salesperson(team):
    assert await agent_for(dealer_scoped_db(DEALER), ALEX, ny(22, 22)) == (ALEX, None)  # Tuesday 10 PM


async def test_unassigned_stays_unassigned(team):
    assert await agent_for(dealer_scoped_db(DEALER), None, ny(26, 12)) == (None, None)


async def test_no_schedule_follows_dealer_hours(team, mongo):
    await mongo[PLATFORM_USERS_COLLECTION].update_one({"_id": ObjectId(ALEX)}, {"$unset": {"work_schedule": ""}})
    open_hour = ny(26, 12)  # the dev dealer is open Saturday noon
    assert await agent_for(dealer_scoped_db(DEALER), ALEX, open_hour) == (ALEX, None)
