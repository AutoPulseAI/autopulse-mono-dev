"""Booking the visit (MASTER_PLAN_3 B5): the available times to offer,
matching the customer's pick to one of them, and creating / moving /
cancelling the booking through integrations/platform_client.py's
`POST`/`PUT /api/booking`.

Availability is read straight from the platform's `bookings` collection
(architecture §15 decision 103) - not through PlatformClient, and never
cached, since a stale read here could double-book a slot. Booking rules are
B0.10's defaults, hard-coded (decision 104): no per-dealer settings store
exists without a platform change in this plan.

Times are always built and shown in the dealership's own timezone (decision
61: the customer is coming to the dealership, and the platform's own
confirmation uses dealer time); the zone name is added to the display only
when the customer's own zone is known and differs from the dealer's.
"""

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from upsell_agent.integrations.dealer_profile import DealerProfile
from upsell_agent.integrations.mongodb import PLATFORM_BOOKINGS_COLLECTION, as_object_id, get_db
from upsell_agent.integrations.platform_client import PlatformClient

# B0.10 defaults (architecture §15 decision 104). Slot length and capacity now come from the dealer
# (DealerProfile.sales_slot_minutes / sales_per_slot; client, 5 Oct 2026: one-hour slots, 10 sales bookings
# each). These are only the fallbacks for a profile built without them.
SLOT_MINUTES = 60
BOOKINGS_PER_SLOT = 10
EARLIEST_HOURS_OUT = 2
LAST_SLOT_BEFORE_CLOSE = timedelta(minutes=30)
DAYS_AHEAD = 7
MAX_OFFERED = 3

# A Booking counts against a slot's capacity unless it was cancelled.
ACTIVE_BOOKING_STATUSES = ("pending", "confirmed", "completed")

_ZONE_LABELS = {
    "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain",
    "America/Los_Angeles": "Pacific", "America/Phoenix": "Arizona", "America/Anchorage": "Alaska",
    "Pacific/Honolulu": "Hawaii",
}


def _zone_label(tz_name: str) -> str:
    return _ZONE_LABELS.get(tz_name, tz_name)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


# --- Candidate slots and availability ----------------------------------------------

def candidate_slots(dealer: DealerProfile, now: datetime, *, days_ahead: int = DAYS_AHEAD) -> list[datetime]:
    """Every SLOT_MINUTES-aligned start time inside the dealer's opening
    hours over the next `days_ahead` days, dealer-local: at least
    EARLIEST_HOURS_OUT from now, and ending LAST_SLOT_BEFORE_CLOSE before
    closing (B0.10)."""
    local_now = now.astimezone(dealer.tz)
    earliest = local_now + timedelta(hours=EARLIEST_HOURS_OUT)
    slots: list[datetime] = []
    for offset in range(days_ahead + 1):
        day = local_now.date() + timedelta(days=offset)
        hours = dealer.hours.get(day.weekday())
        if not hours:
            continue
        opens, closes = hours
        cursor = datetime.combine(day, opens, tzinfo=dealer.tz)
        last_start = datetime.combine(day, closes, tzinfo=dealer.tz) - LAST_SLOT_BEFORE_CLOSE
        while cursor <= last_start:
            if cursor >= earliest:
                slots.append(cursor)
            cursor += timedelta(minutes=_slot_minutes(dealer))
    return slots


def _slot_minutes(dealer: DealerProfile) -> int:
    return getattr(dealer, "sales_slot_minutes", None) or SLOT_MINUTES


def _per_slot(dealer: DealerProfile) -> int:
    return getattr(dealer, "sales_per_slot", None) or BOOKINGS_PER_SLOT


def _slot_key(row: dict[str, Any], dealer: DealerProfile) -> tuple[str, str] | None:
    """The (date, slot start) a booking falls in: a 10:30 booking is in the 10:00 one-hour slot. Bookings at
    a time that can't be read are skipped."""
    local_date = _aware(row["bookingDate"]).astimezone(dealer.tz).date()
    match = re.match(r"^\s*(\d{1,2}):(\d{2})", str(row.get("bookingTime") or ""))
    if not match:
        return None
    minutes = int(match.group(1)) * 60 + int(match.group(2))
    start = minutes // _slot_minutes(dealer) * _slot_minutes(dealer)
    return local_date.strftime("%Y-%m-%d"), f"{start // 60:02d}:{start % 60:02d}"


async def existing_bookings(dealer_id: str, dealer: DealerProfile, now: datetime,
                            *, days_ahead: int = DAYS_AHEAD) -> list[dict[str, Any]]:
    """Every Booking for this dealer that could overlap the offered window,
    read fresh (architecture §15 decision 103): not cancelled, and not so old
    it predates today. Widened by a day on each side since `bookingDate` is
    stored as dealer-local midnight in UTC, not a plain calendar date."""
    local_now = now.astimezone(dealer.tz)
    start = datetime.combine(local_now.date(), time(0), tzinfo=dealer.tz).astimezone(UTC) - timedelta(days=1)
    end = (datetime.combine(local_now.date() + timedelta(days=days_ahead + 1), time(0), tzinfo=dealer.tz)
          .astimezone(UTC) + timedelta(days=1))
    rows = await get_db()[PLATFORM_BOOKINGS_COLLECTION].find({
        "dealer_id": dealer_id, "booking_status": {"$in": list(ACTIVE_BOOKING_STATUSES)},
        "bookingDate": {"$gte": start, "$lt": end},
    }).to_list(None)
    return rows


def available_times(dealer: DealerProfile, existing: list[dict[str, Any]], now: datetime,
                    *, exclude_lead_id: str | None = None, days_ahead: int = DAYS_AHEAD) -> list[datetime]:
    """Candidate slots with fewer than the dealer's sales capacity already booked against them. Only sales
    bookings count: service appointments have their own one-per-hour slots in the CRM (client, 5 Oct
    2026), and the AI books sales visits only. `exclude_lead_id`: don't let this lead's own existing
    booking count against itself (rescheduling)."""
    counts: dict[tuple[str, str], int] = {}
    for row in existing:
        if exclude_lead_id and str(row.get("lead_id")) == str(exclude_lead_id):
            continue
        if str(row.get("appointment_type") or "sales").lower() == "service":
            continue
        key = _slot_key(row, dealer)
        if key:
            counts[key] = counts.get(key, 0) + 1
    return [slot for slot in candidate_slots(dealer, now, days_ahead=days_ahead)
            if counts.get((slot.strftime("%Y-%m-%d"), slot.strftime("%H:%M")), 0) < _per_slot(dealer)]


def offer_times(available: list[datetime], *, count: int = MAX_OFFERED) -> list[datetime]:
    """The 2-3 times actually offered to the customer: the earliest ones
    available (B5 item 1)."""
    return available[:count]


# --- The customer asks for a day ("not Wednesday, what about Monday?") ------------------------------------

# A day the customer turns down: "not Wednesday", "can't do Wed", "Wednesday doesn't work".
_DAY_NAME = r"(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?"
_REJECTED_DAY = re.compile(
    rf"\b(?:not|no|can'?t do|cannot do|can'?t make|can'?t come)\s+(?:on\s+)?(?:this\s+|next\s+)?{_DAY_NAME}\b"
    rf"|\b{_DAY_NAME}\s+(?:doesn'?t|does not|won'?t|will not)\s+work\b|\b{_DAY_NAME}\s+is\s+(?:no good|bad|out)\b",
    re.IGNORECASE)
# Parts of the day, in the dealer's own time.
_PARTS = {"morning": (time(0), time(12)), "afternoon": (time(12), time(17)), "evening": (time(17), time(23, 59))}
_AFTER = re.compile(r"\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", re.IGNORECASE)
_BEFORE = re.compile(r"\bbefore\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", re.IGNORECASE)


@dataclass
class DayRequest:
    day: Any  # datetime.date the customer asked for
    part: tuple[time, time] | None  # a part of the day they named, or None for any time
    part_words: str | None


def _clock(hour: str, minute: str | None, meridiem: str | None) -> time:
    h = int(hour) % 12 if meridiem else int(hour)
    if meridiem and meridiem.lower() == "pm":
        h += 12
    elif not meridiem and 1 <= h <= 7:
        h += 12  # "after 5" at a dealership means the evening
    return time(min(h, 23), int(minute or 0))


def part_of_day(text: str) -> tuple[tuple[time, time] | None, str | None]:
    lowered = (text or "").lower()
    for word, span in _PARTS.items():
        if re.search(rf"\b{word}\b", lowered):
            return span, word
    if m := _AFTER.search(lowered):
        return (_clock(*m.groups()), time(23, 59)), m.group(0)
    if m := _BEFORE.search(lowered):
        return (time(0), _clock(*m.groups())), m.group(0)
    return None, None


def preferred_day(text: str, dealer: DealerProfile, now: datetime) -> DayRequest | None:
    """The day the customer asks to come in when they name a day but no time ("what about Monday?",
    "Monday afternoon?"); a day they turn down in the same message is ignored. None when the message names
    no day, names an exact time (match_pick handles that), or a day already past."""
    day = day_without_time(text, now.astimezone(dealer.tz))
    if day is None:
        return None
    part, words = part_of_day(text)
    return DayRequest(day=day, part=part, part_words=words)


def day_without_time(text: str, local_now: datetime) -> Any:
    """The date a message names when it names a day and no time, ignoring a day it turns down; else None."""
    from upsell_agent.slots.dates import resolve as resolve_date

    resolved = resolve_date(_REJECTED_DAY.sub(" ", text or ""), local_now)
    if resolved is None or isinstance(resolved.value, datetime) or resolved.day < local_now.date():
        return None
    return resolved.day


def times_on_day(available: list[datetime], request: DayRequest, dealer: DealerProfile,
                 *, count: int = MAX_OFFERED) -> tuple[list[datetime], Any, bool]:
    """Up to `count` open times on the day asked for (and in the part of the day asked for), spread across
    it rather than the first ones in a row. When that day has none (closed, full, or past what we book), the
    next day that does. Returns (times, the day they're on, whether it's the day asked for)."""
    def fits(slot: datetime) -> bool:
        if request.part is None:
            return True
        start, end = request.part
        return start <= slot.astimezone(dealer.tz).time() < end

    def spread(slots: list[datetime]) -> list[datetime]:
        if len(slots) <= count:
            return slots
        step = (len(slots) - 1) / (count - 1)
        return [slots[round(i * step)] for i in range(count)]

    by_day: dict[Any, list[datetime]] = {}
    for slot in available:
        by_day.setdefault(slot.astimezone(dealer.tz).date(), []).append(slot)
    wanted = [s for s in by_day.get(request.day, []) if fits(s)]
    if wanted:
        return spread(wanted), request.day, True
    for day in sorted(d for d in by_day if d > request.day):
        later = [s for s in by_day[day] if fits(s)] or by_day[day]
        if later:
            return spread(later), day, False
    return [], None, False


def format_offer(times: list[datetime], dealer: DealerProfile,
                 *, customer_zones: tuple[str, ...] = ()) -> list[dict[str, str]]:
    """Each offered time as {iso, date, time, display}. `display` is plain
    words in the dealer's own timezone ("Saturday at 10:00 AM"); the
    dealer's zone name is appended only when the customer's own zone is
    known (exactly one candidate) and differs from the dealer's (B5 item 1)."""
    show_zone = len(customer_zones) == 1 and customer_zones[0] != dealer.timezone
    label = f" {_zone_label(dealer.timezone)}" if show_zone else ""
    formatted = []
    for slot in times:
        local = slot.astimezone(dealer.tz)
        display = f"{local.strftime('%A')} at {local.strftime('%I:%M %p').lstrip('0')}{label}"
        formatted.append({"iso": local.isoformat(), "date": local.strftime("%Y-%m-%d"),
                          "time": local.strftime("%H:%M"), "display": display})
    return formatted


# --- Matching the customer's pick ---------------------------------------------------

_ORDINALS = {"first": 0, "1st": 0, "second": 1, "2nd": 1, "third": 2, "3rd": 2}
_ORDINAL_RE = re.compile(r"\b(?:the\s+)?(first|1st|second|2nd|third|3rd)\b(?:\s+one|\s+option)?", re.IGNORECASE)
_OPTION_RE = re.compile(r"\boption\s*([123])\b", re.IGNORECASE)


@dataclass
class PickResult:
    matched: dict[str, str] | None = None  # one of the `format_offer` dicts, or a freshly built one
    ambiguous: bool = False
    note: str = ""
    # PLAN_4 stream Q: the exact time they asked for (dealer-local) when it isn't open - Decide then offers the
    # open times nearest to it (nearest_times) instead of dropping the booking.
    wanted: datetime | None = None


# A time with no day ("3pm", "10 works", "at 4:30"), answering times we offered (stream Q: seen with gpt-5-mini,
# "3pm" after "Thursday at 12:00 PM, 2:00 PM or 4:00 PM" matched nothing and the booking was dropped).
_BARE_TIME = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])"
                        r"|\b(\d{1,2}):(\d{2})\b"
                        r"|^\s*(?:at\s+|around\s+|maybe\s+|how about\s+)?(\d{1,2})"
                        r"(?:\s+(?:works|is good|is fine|would work|please|o'?clock|then))?\s*[.!?]?\s*$", re.IGNORECASE)


def bare_time(text: str) -> time | None:
    """The clock time a message names without a day, or None."""
    m = _BARE_TIME.search(text or "")
    if not m:
        return None
    if m.group(1):
        hour, minute, meridiem = m.group(1), m.group(2), m.group(3).replace(".", "").lower()
    elif m.group(4):
        hour, minute, meridiem = m.group(4), m.group(5), None
    else:
        hour, minute, meridiem = m.group(6), None, None
    if int(hour) > (12 if meridiem else 23) or int(minute or 0) > 59:
        return None
    return _clock(hour, minute, meridiem)


def nearest_times(available: list[datetime], wanted: datetime, dealer: DealerProfile,
                  *, count: int = MAX_OFFERED) -> list[datetime]:
    """The open times closest to the one they asked for: on that day when it has any (else the next day that
    does), in time order."""
    day = wanted.astimezone(dealer.tz).date()
    pool = [a for a in available if a.astimezone(dealer.tz).date() == day]
    if not pool:
        later = sorted({a.astimezone(dealer.tz).date() for a in available if a.astimezone(dealer.tz).date() > day})
        pool = [a for a in available if later and a.astimezone(dealer.tz).date() == later[0]]
        if pool:
            wanted = datetime.combine(later[0], wanted.astimezone(dealer.tz).time(), tzinfo=dealer.tz)
    return sorted(sorted(pool, key=lambda a: abs((a - wanted).total_seconds()))[:count])


def _fresh_pick(candidate: datetime, dealer: DealerProfile, available: list[datetime] | None) -> dict[str, str] | None:
    """A real, free time that wasn't offered (B5 item 2), as a `format_offer` dict; None when it isn't open."""
    if available is None or not any(a == candidate for a in available):
        return None
    local = candidate.astimezone(dealer.tz)
    display = f"{local.strftime('%A')} at {local.strftime('%I:%M %p').lstrip('0')}"
    return {"iso": local.isoformat(), "date": local.strftime("%Y-%m-%d"), "time": local.strftime("%H:%M"),
            "display": display}


def match_pick(text: str, offered: list[dict[str, str]], dealer: DealerProfile, now: datetime,
               *, available: list[datetime] | None = None, prefer_day: str | None = None) -> PickResult:
    """"the second one", "Saturday 10 works", "after 5 tomorrow" -> one of
    `offered`, or (when it names a real, free time that wasn't offered) a
    freshly built entry for it (B5 item 2). Uses Plan 2's date resolver
    (slots/dates.py) for anything that isn't an ordinal; the model never
    does this matching. `prefer_day` (ISO date): the day the customer asked for
    (PLAN_4 stream X3 item 3) - a time with no day ("10 works") is read on it first."""
    from upsell_agent.slots.dates import resolve as resolve_date

    if m := _ORDINAL_RE.search(text):
        idx = _ORDINALS[m.group(1).lower()]
        if idx < len(offered):
            return PickResult(matched=offered[idx])
    if m := _OPTION_RE.search(text):
        idx = int(m.group(1)) - 1
        if idx < len(offered):
            return PickResult(matched=offered[idx])

    resolved = resolve_date(text, now.astimezone(dealer.tz))
    if resolved is None:
        # A time with no day answers the times we offered: the first offered day that has it open (else the
        # first offered day, for the nearest open times).
        at = bare_time(text) if offered or prefer_day else None
        if at is None:
            return PickResult()
        days = list(dict.fromkeys([*([prefer_day] if prefer_day else []), *(o["date"] for o in offered)]))
        for day_iso in days:
            exact = next((o for o in offered if o["date"] == day_iso and o["time"] == at.strftime("%H:%M")), None)
            if exact:
                return PickResult(matched=exact)
            fresh = _fresh_pick(datetime.combine(date.fromisoformat(day_iso), at, tzinfo=dealer.tz), dealer, available)
            if fresh:
                return PickResult(matched=fresh)
        wanted = datetime.combine(date.fromisoformat(days[0]), at, tzinfo=dealer.tz)
        return PickResult(ambiguous=True, note=f"{days[0]} at {at.strftime('%H:%M')} isn't an open time", wanted=wanted)
    day = resolved.day
    same_day = [o for o in offered if o["date"] == day.isoformat()]
    if isinstance(resolved.value, datetime):
        target = resolved.value.time().strftime("%H:%M")
        exact = next((o for o in same_day if o["time"] == target), None)
        if exact:
            return PickResult(matched=exact)
        candidate = datetime.combine(day, resolved.value.time(), tzinfo=dealer.tz)
        if fresh := _fresh_pick(candidate, dealer, available):
            return PickResult(matched=fresh)
        return PickResult(ambiguous=True, note=f"{day.isoformat()} at {target} isn't an open time", wanted=candidate)
    if len(same_day) == 1:
        return PickResult(matched=same_day[0])
    if len(same_day) > 1:
        return PickResult(ambiguous=True, note="more than one time was offered that day; which one?")
    return PickResult(ambiguous=True, note=f"{day.isoformat()} wasn't one of the times offered")


# --- Reading and writing bookings ----------------------------------------------------

async def find_active_booking(dealer_id: str, lead: dict | None) -> dict[str, Any] | None:
    """Read fresh from the platform every turn (B5 item 7, architecture §15
    decision 60): the lead's own `data.bookingId`, or None when there is
    none or it's cancelled. Never cached, so "what time am I booked for?"
    the next day, or right after a cancel, always sees the real state."""
    booking_id = ((lead or {}).get("data") or {}).get("bookingId")
    if not booking_id:
        return None
    row = await get_db()[PLATFORM_BOOKINGS_COLLECTION].find_one(
        {"_id": as_object_id(str(booking_id)), "dealer_id": dealer_id})
    if not row or row.get("booking_status") == "cancelled":
        return None
    return row


async def booking_cancelled(dealer_id: str, lead: dict | None) -> bool:
    """The lead's own booking (`data.bookingId`) exists and is cancelled on the platform. The lead keeps its
    booking date/time fields after a cancel on the CRM's booking screen (PUT /api/booking, which tells the AI
    nothing), so those must not be read as a standing appointment (stream F)."""
    booking_id = ((lead or {}).get("data") or {}).get("bookingId")
    if not booking_id:
        return False
    row = await get_db()[PLATFORM_BOOKINGS_COLLECTION].find_one(
        {"_id": as_object_id(str(booking_id)), "dealer_id": dealer_id})
    return bool(row) and row.get("booking_status") == "cancelled"


async def ensure_booking(platform: PlatformClient, *, dealer_id: str, dealer: DealerProfile, lead: dict | None,
                         lead_id: str, customer_name: str, email: str, phone: str, when: datetime,
                         notes: str | None) -> dict[str, Any]:
    """Creates the booking, unless this lead already has an active one for
    this exact date and time (B5 item 3: `POST /api/booking` has no
    idempotency of its own, so a retried turn must never double-book)."""
    local = when.astimezone(dealer.tz)
    existing = await find_active_booking(dealer_id, lead)
    if existing:
        existing_local = _aware(existing["bookingDate"]).astimezone(dealer.tz)
        if existing_local.date() == local.date() and existing.get("bookingTime") == local.strftime("%H:%M"):
            return {"booking_id": str(existing["_id"]), "booking_status": existing.get("booking_status", "pending"),
                    "already_existed": True}
    result = await platform.create_booking(dealer_id, {
        "lead_id": lead_id, "customerName": customer_name, "email": email, "phone": phone,
        "bookingDate": local.strftime("%Y-%m-%d"), "bookingTime": local.strftime("%H:%M"),
        "notes": notes, "dealer_timezone": dealer.timezone,
        # The AI books sales visits only (service visits are requests, MASTER_PLAN_4 F2).
        "appointment_type": "sales",
    })
    return {**result, "already_existed": False}


async def move_booking(platform: PlatformClient, *, dealer_id: str, dealer: DealerProfile, booking_id: str,
                       current_status: str, when: datetime) -> dict[str, Any]:
    """`booking_status` must always be sent on a `PUT`, even unchanged -
    without it the platform silently ignores the new date/time (route.js,
    checked against the running code; B5 item 3)."""
    local = when.astimezone(dealer.tz)
    return await platform.update_booking(dealer_id, {
        "booking_id": booking_id, "booking_status": current_status,
        "booking_date": local.strftime("%Y-%m-%d"), "booking_time": local.strftime("%H:%M"),
        "dealer_timezone": dealer.timezone,
    })


async def cancel_booking(platform: PlatformClient, *, dealer_id: str, dealer: DealerProfile,
                         booking_id: str) -> dict[str, Any]:
    return await platform.update_booking(dealer_id, {
        "booking_id": booking_id, "booking_status": "cancelled", "dealer_timezone": dealer.timezone,
    })


def wording_for_status(booking_status: str | None) -> str | None:
    """What Compose/Guard may say about an active booking (B5 item 7,
    architecture §15 decision 60): "requested" while pending, "booked" /
    "confirmed" once the team confirms it. None with no active booking."""
    if booking_status == "pending":
        return "requested"
    if booking_status == "confirmed":
        return "confirmed"
    return None
