"""Waits as the super admin writes them in AI Studio (client, 13 Oct 2026): any number of minutes, hours, days,
weeks, months or years, after the previous touch or after the start, optionally at a time of day.

    {"amount": 3, "unit": "hours", "after": "previous"}
    {"amount": 1, "unit": "days", "after": "start", "at": "10:00"}
"""

import calendar
import re
from datetime import datetime, time, timedelta
from typing import Any

UNITS = ("minutes", "hours", "days", "weeks", "months", "years")
_SMALL = {"minutes": "minutes", "minute": "minutes", "mins": "minutes", "min": "minutes", "hours": "hours",
          "hour": "hours", "hrs": "hours", "days": "days", "day": "days", "weeks": "weeks", "week": "weeks",
          "months": "months", "month": "months", "years": "years", "year": "years"}


def unit_of(value: Any) -> str:
    return _SMALL.get(str(value or "").strip().lower(), "days")


def add(at: datetime, amount: float, unit: str) -> datetime:
    """`at` plus the wait. Months and years are calendar ones (Jan 31 + 1 month = Feb 28/29)."""
    unit = unit_of(unit)
    if unit in ("months", "years"):
        months = round(amount * (12 if unit == "years" else 1))
        index = at.month - 1 + months
        year, month = at.year + index // 12, index % 12 + 1
        return at.replace(year=year, month=month, day=min(at.day, calendar.monthrange(year, month)[1]))
    return at + timedelta(**{unit: float(amount)})


def parse_at(value: Any) -> time | None:
    """"10:00", "2:30 PM", "14:30" -> a time of day; None when not given or unreadable."""
    m = re.match(r"^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*$", str(value or ""), re.IGNORECASE)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2) or 0)
    if m.group(3):
        hour = hour % 12 + (12 if m.group(3).lower().startswith("p") else 0)
    return time(hour, minute) if hour < 24 and minute < 60 else None


def due(anchor: datetime, wait: dict[str, Any] | None, tz) -> datetime:
    """When a touch with this wait is due, counted from `anchor` (dealer-local `at` when given)."""
    wait = wait or {}
    when = add(anchor.astimezone(tz), float(wait.get("amount") or 0), wait.get("unit"))
    at = parse_at(wait.get("at"))
    if at is not None:
        when = datetime.combine(when.date(), at, tzinfo=tz)
        if when <= anchor.astimezone(tz) and unit_of(wait.get("unit")) in ("minutes", "hours"):
            when += timedelta(days=1)
    return when


def describe(wait: dict[str, Any] | None) -> str:
    wait = wait or {}
    amount, unit = wait.get("amount") or 0, unit_of(wait.get("unit"))
    text = "immediately" if not amount else f"{amount:g} {unit[:-1] if amount == 1 else unit}"
    return text + ("" if not amount else " after " + ("the start" if wait.get("after") == "start"
                                                      else "the previous touch")) + (
        f" at {wait['at']}" if wait.get("at") else "")



def calendar_unit(wait: dict[str, Any] | None) -> bool:
    """A wait counted in days or longer (or sent at a time of day): one touch per calendar day at most."""
    wait = wait or {}
    return bool(wait.get("at")) or unit_of(wait.get("unit")) not in ("minutes", "hours")
