"""Staff work schedules: who is working when a call task opens (client, 7 Oct 2026: "each user should also have a
schedule, so we don't assign them any task on their off day").

A staff member's schedule is `work_schedule` on their CRM `User` record, in the dealer hours' format
(`{monday: {active, start: "9:00 AM", end: "6:00 PM"}, ...}`, set on the employee form). No schedule means they
work the dealership's opening hours.

`agent_for` keeps a task with the lead's assigned salesperson when they are working at that time. When they are
off, it goes to a colleague who is working then (the one with the fewest open tasks), and says so; when nobody is
working, it stays with the assigned salesperson. A lead with nobody assigned stays unassigned, as before.
"""

from datetime import datetime, time
from typing import Any

from upsell_agent.integrations.dealer_profile import WEEKDAYS, dealer_profile, parse_time
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    get_db,
)


def parse_schedule(weekly: Any) -> dict[int, tuple[time, time] | None] | None:
    """{weekday: (start, end) or None (off)}, or None when the record has no usable schedule (dealer hours apply)."""
    if not isinstance(weekly, dict):
        return None
    days: dict[int, tuple[time, time] | None] = {}
    for index, day in enumerate(WEEKDAYS):
        info = weekly.get(day)
        if not isinstance(info, dict) or not info.get("active"):
            days[index] = None
            continue
        start, end = parse_time(info.get("start")), parse_time(info.get("end"))
        days[index] = (start, end) if start and end and start < end else None
    return days if any(day in weekly for day in WEEKDAYS) else None


def working(schedule: dict[int, tuple[time, time] | None], local: datetime) -> bool:
    hours = schedule.get(local.weekday())
    return bool(hours) and hours[0] <= local.time() < hours[1]


async def on_duty(dealer_id: str, user: dict[str, Any] | None, at: datetime) -> bool:
    profile = await dealer_profile(dealer_id)
    schedule = parse_schedule((user or {}).get("work_schedule"))
    if schedule is None:
        return profile.is_open(at)
    return working(schedule, at.astimezone(profile.tz))


async def _staff(dealer_id: str) -> list[dict[str, Any]]:
    """The dealership's staff accounts (CRM users whose parent is the dealer)."""
    rows = get_db()[PLATFORM_USERS_COLLECTION].find(
        {"parent_id": as_object_id(dealer_id), "type": "dealer"}, projection={"name": 1, "work_schedule": 1})
    return await rows.to_list(None)


async def agent_for(db: DealerScopedDatabase, assigned: str | None, at: datetime) -> tuple[str | None, str | None]:
    """(who gets the task, why it isn't the assigned salesperson or None)."""
    if not assigned:
        return None, None  # unassigned stays unassigned, as before
    staff = await _staff(db.dealer_id)
    by_id = {str(s["_id"]): s for s in staff}
    if assigned not in by_id:
        return assigned, None  # not a staff account we know (e.g. the dealer's main login): leave it as it is
    if await on_duty(db.dealer_id, by_id[assigned], at):
        return assigned, None
    working_now = [s for s in staff if str(s["_id"]) != assigned and await on_duty(db.dealer_id, s, at)]
    if not working_now:
        return assigned, None
    rows = await db.collection(AI_CALL_TASKS_COLLECTION).find(
        {"status": "open"}, projection={"assigned_to": 1}).to_list(None)
    open_counts: dict[str, int] = {}
    for row in rows:
        key = str(row.get("assigned_to"))
        open_counts[key] = open_counts.get(key, 0) + 1
    pick = min(working_now, key=lambda s: (open_counts.get(str(s["_id"]), 0), str(s.get("name") or "")))
    why = (f"{by_id[assigned].get('name') or 'The assigned salesperson'} is off now, "
           f"so {pick.get('name') or 'a colleague'} has it")
    return str(pick["_id"]), why
