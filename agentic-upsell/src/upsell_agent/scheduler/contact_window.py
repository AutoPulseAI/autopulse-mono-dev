"""When the AI may message on its own (architecture §15, decisions 10-11).

- **Contact window.** A message the AI starts on its own (the 24h channel
  switch, the handoff-timeout holding reply) goes out by SMS only between
  8:00 and 20:00 local time. The strictest common US rule: the federal TCPA
  allows 8:00-21:00, several states 8:00-20:00. The customer's timezone isn't
  known, so the dealer's is used. Email has no time-of-day rule. A reply to a
  message the customer just sent isn't held.
- **Business minutes.** The handoff timeout counts only minutes inside the
  dealer's opening hours (integrations/dealer_profile.py).

Everything takes and returns UTC-aware datetimes; local times are only used
inside.
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

CONTACT_START, CONTACT_END = time(8), time(20)
# Opening hours are searched this far ahead; a dealer open on no day at all
# can't happen (dealer_profile falls back to default hours).
MAX_DAYS_AHEAD = 14


def is_proactive_sms_allowed(at: datetime, tz: ZoneInfo) -> bool:
    local = at.astimezone(tz).time()
    return CONTACT_START <= local < CONTACT_END


def next_contact_time(at: datetime, tz: ZoneInfo) -> datetime:
    """`at` if a proactive SMS may go out then, otherwise the next 8:00 local."""
    if is_proactive_sms_allowed(at, tz):
        return at
    local = at.astimezone(tz)
    day = local.date() if local.time() < CONTACT_START else local.date() + timedelta(days=1)
    return _local(day, CONTACT_START, tz).astimezone(at.tzinfo)


def proactive_send_time(at: datetime, channel: str, tz: ZoneInfo) -> datetime:
    """When a proactive message due at `at` may go out on `channel`."""
    return next_contact_time(at, tz) if channel == "sms" else at


def add_business_minutes(start: datetime, minutes: float, hours: dict[int, tuple[time, time] | None],
                         tz: ZoneInfo) -> datetime:
    """The time `minutes` of opening hours after `start`. Starting outside
    opening hours, the count begins at the next opening."""
    remaining = timedelta(minutes=minutes)
    cursor = start.astimezone(tz)
    for _ in range(MAX_DAYS_AHEAD + 1):
        window = hours.get(cursor.weekday())
        if window:
            opens, closes = _local(cursor.date(), window[0], tz), _local(cursor.date(), window[1], tz)
            begin = max(cursor, opens)
            if begin < closes:
                if begin + remaining <= closes:
                    return (begin + remaining).astimezone(start.tzinfo)
                remaining -= closes - begin
        cursor = _local(cursor.date() + timedelta(days=1), time(0), tz)
    return start + timedelta(minutes=minutes)


def _local(day: date, at: time, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, at, tzinfo=tz)
