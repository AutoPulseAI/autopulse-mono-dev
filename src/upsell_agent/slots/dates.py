"""Dates the customer says in words, worked out in code (MASTER_PLAN_2 Phase 8).

"tomorrow", "Friday", "next Tuesday at 3", "in two weeks", "the 15th",
"Oct 3" → a real date (and a time, if they gave one), relative to the dealer's
local now (clock.now() in the dealer's timezone, so the Debug UI's clock moves
it too). The model never does the arithmetic: Extract returns the customer's
words, this turns them into a date.

Each result says whether it needs checking with the customer:
- `ambiguous`: "next Friday" (this coming one, or the one after?), "next
  weekend", a bare weekday said on that same day, "tomorrow" said between
  midnight and 4am (they may mean later today). Saved as needs-confirming and
  confirmed with the actual date.
- `approximate`: "next week", "in a few weeks", "end of the month": a rough
  target, fine for the timeline.

Past dates are returned as they are; Validate rejects them with a reason. No
external library: every rule is below and tested, and nothing depends on the
machine's locale or timezone.
"""

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
          "november", "december"]
_NUMBER_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
                 "a couple of": 2, "a couple": 2, "couple of": 2, "a few": 3, "few": 3}
_LATE_NIGHT_UNTIL = time(4)

_DAY = r"(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?"
_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
# Like _MONTH but without "may": alone (no day number after it) it's too often an
# ordinary word ("may I", "I may") to safely read as the month.
_MONTH_ONLY = r"(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_TIME = re.compile(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?!\w)|\bat\s+(\d{1,2})(?::(\d{2}))?\b|\b(noon)\b",
                   re.IGNORECASE)

# Words that name a date, for finding one in a message (agent/offline_model.py).
DATE_PHRASE = re.compile(
    rf"\b(?:the\s+)?day after tomorrow\b|\btomorrow\b|\btmrw\b|\btoday\b|\btonight\b|\byesterday\b"
    rf"|\b(?:this|next)\s+weekend\b|\bnext\s+week\b|\blast\s+week\b|\bend of (?:the|this) month\b"
    rf"|\b(?:next|this|last|on|coming)\s+{_DAY}\b|\b{_DAY}\b"
    rf"|\bin\s+(?:a couple of|a couple|a few|an|a|one|two|three|four|five|six|\d+)\s+(?:days?|weeks?|months?)\b"
    rf"|\b{_MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?\b|\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:of\s+)?{_MONTH}(?![a-z])"
    rf"|\bthe\s+\d{{1,2}}(?:st|nd|rd|th)\b|\b\d{{1,2}}/\d{{1,2}}\b|\b{_MONTH_ONLY}\b",
    re.IGNORECASE)


@dataclass(frozen=True)
class DateResolution:
    value: date | datetime
    ambiguous: bool = False
    approximate: bool = False
    note: str = ""

    @property
    def day(self) -> date:
        return self.value.date() if isinstance(self.value, datetime) else self.value

    def iso(self) -> str:
        return self.value.strftime("%Y-%m-%dT%H:%M") if isinstance(self.value, datetime) else self.value.isoformat()


def _weekday_index(word: str) -> int:
    word = word.lower()
    return next(i for i, name in enumerate(WEEKDAYS) if name.startswith(word[:3]))


def _month_index(word: str) -> int:
    word = word.lower().rstrip(".")
    return next(i for i, name in enumerate(MONTHS) if name.startswith(word[:3])) + 1


def _count(word: str) -> int:
    word = word.lower().strip()
    return int(word) if word.isdigit() else _NUMBER_WORDS.get(word, 1)


def _add_months(day: date, months: int) -> date:
    month = day.month - 1 + months
    year, month = day.year + month // 12, month % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def _time_of(text: str) -> time | None:
    match = _TIME.search(text)
    if not match:
        return None
    if match.group(6):
        return time(12)
    hour_raw, minute_raw, meridiem = (match.group(1), match.group(2), match.group(3)) if match.group(1) else (
        match.group(4), match.group(5), None)
    hour, minute = int(hour_raw), int(minute_raw or 0)
    if minute > 59:
        return None
    if meridiem:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if meridiem.lower().startswith("p") else 0)
    elif 1 <= hour <= 7:
        hour += 12  # "at 3" means 3 in the afternoon at a dealership
    elif hour > 23:
        return None
    return time(hour, minute)


def _day_of(text: str, today: date, now: datetime) -> DateResolution | None:
    """The day a phrase names, most specific phrases first."""
    t = text.lower()
    if re.search(r"\bday after tomorrow\b", t):
        return DateResolution(today + timedelta(days=2), note="day after tomorrow")
    if re.search(r"\b(tomorrow|tmrw)\b", t):
        late = now.time() < _LATE_NIGHT_UNTIL
        return DateResolution(today + timedelta(days=1), ambiguous=late,
                              note="tomorrow" + (" (said after midnight: they may mean later today)" if late else ""))
    if re.search(r"\b(today|tonight|asap|right away|right now)\b", t):
        return DateResolution(today, note="today")
    if re.search(r"\byesterday\b", t):
        return DateResolution(today - timedelta(days=1), note="yesterday")
    if re.search(r"\blast\s+week\b", t):
        return DateResolution(today - timedelta(days=7), approximate=True, note="last week")
    if m := re.search(rf"\blast\s+({_DAY})\b", t):
        back = (today.weekday() - _weekday_index(m.group(1))) % 7 or 7
        return DateResolution(today - timedelta(days=back), note=f"last {m.group(1)}")
    if re.search(r"\bthis\s+weekend\b", t):
        return DateResolution(today if today.weekday() >= 5 else today + timedelta(days=5 - today.weekday()),
                              approximate=True, note="this weekend (from Saturday)")
    if re.search(r"\bnext\s+weekend\b", t):
        return DateResolution(today + timedelta(days=(5 - today.weekday()) % 7 + 7), ambiguous=True,
                              note="next weekend (the one after this coming weekend)")
    if re.search(r"\bnext\s+week\b", t):
        return DateResolution(today + timedelta(days=7 - today.weekday()), approximate=True,
                              note="next week (from its Monday)")
    if re.search(r"\bend of (?:the|this) month\b", t):
        last = calendar.monthrange(today.year, today.month)[1]
        return DateResolution(today.replace(day=last), approximate=True, note="end of the month")
    if m := re.search(r"\bin\s+(a couple of|a couple|a few|an|a|one|two|three|four|five|six|\d+)\s+(day|week|month)s?\b", t):
        n, unit = _count(m.group(1)), m.group(2)
        rough = m.group(1) in ("a few", "a couple", "a couple of")
        if unit == "month":
            return DateResolution(_add_months(today, n), approximate=True, note=f"in {n} month(s)")
        return DateResolution(today + timedelta(days=n * (7 if unit == "week" else 1)),
                              approximate=rough or unit == "week", note=f"in {n} {unit}(s)")
    if m := re.search(rf"\bnext\s+({_DAY})\b", t):
        next_monday = today + timedelta(days=7 - today.weekday())
        return DateResolution(next_monday + timedelta(days=_weekday_index(m.group(1))), ambiguous=True,
                              note=f"next {m.group(1)}: taken as next week's, to be confirmed")
    if m := re.search(rf"\b(?:this\s+|on\s+|coming\s+)?({_DAY})\b", t):
        ahead = (_weekday_index(m.group(1)) - today.weekday()) % 7
        return DateResolution(today + timedelta(days=ahead), ambiguous=ahead == 0,
                              note=f"{m.group(1)}" + (": today, or a week from today?" if ahead == 0 else ""))
    if m := re.search(rf"\b({_MONTH})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b|\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({_MONTH})(?![a-z])", t):
        month = _month_index(m.group(1) or m.group(4))
        day_number = int(m.group(2) or m.group(3))
        if day_number > calendar.monthrange(today.year, month)[1]:
            return None
        return DateResolution(date(today.year, month, day_number), note=f"{MONTHS[month - 1]} {day_number}")
    if m := re.search(r"\b(\d{1,2})/(\d{1,2})\b", t):
        month, day_number = int(m.group(1)), int(m.group(2))
        if not 1 <= month <= 12 or not 1 <= day_number <= calendar.monthrange(today.year, month)[1]:
            return None
        return DateResolution(date(today.year, month, day_number), note=f"{month}/{day_number} (month/day)")
    if m := re.search(rf"\b{_MONTH_ONLY}\b", t):
        month = _month_index(m.group(0))
        if month == today.month:
            return DateResolution(today, approximate=True, note=f"{MONTHS[month - 1]} (this month, no day given)")
        year = today.year if month > today.month else today.year + 1
        return DateResolution(date(year, month, 1), approximate=True,
                              note=f"{MONTHS[month - 1]} (no day given)")
    if m := re.search(r"\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b|^\s*(\d{1,2})(?:st|nd|rd|th)\s*$", t):
        day_number = int(m.group(1) or m.group(2))
        month_start = today.replace(day=1) if day_number >= today.day else _add_months(today.replace(day=1), 1)
        if day_number > calendar.monthrange(month_start.year, month_start.month)[1]:
            return None
        return DateResolution(month_start.replace(day=day_number), note=f"the {day_number} (next one to come)")
    return None


def resolve(text: str, now: datetime) -> DateResolution | None:
    """The date (and time) `text` names, relative to `now` in the dealer's
    timezone; None when it names none."""
    found = _day_of(text or "", now.date(), now)
    if found is None:
        return None
    at = _time_of(text)
    if at is None:
        return found
    return DateResolution(datetime.combine(found.day, at), ambiguous=found.ambiguous, approximate=found.approximate,
                          note=f"{found.note}, {at:%H:%M}")


def timeline_for(day: date, today: date) -> str:
    """The timeline slot's bucket for a date the customer gave."""
    days = (day - today).days
    if days <= 0:
        return "now"
    if days <= 7:
        return "this_week"
    if (day.year, day.month) == (today.year, today.month) or days <= 31:
        return "this_month"
    if days <= 92:
        return "1_3_months"
    return "3_plus_months"
