"""A dealer's name, timezone and opening hours, from the platform's own dealer
record (architecture §15, decisions 8-10): the `User` document of type
dealer, `dealer_account_information`, which the dealer fills in at
registration and in the admin dealer form.

Opening hours are `weekly_availability`: per weekday `{active, start, end}`,
with times as the form saves them ("9:00 AM"), in the dealer's timezone. A
dealer with no usable hours gets Monday-Saturday 9:00-18:00 for the rules
that need hours (the handoff timeout), but those default hours are never told
to a customer.

`public_info()` is what the AI may tell a customer (MASTER_PLAN_2 Phase 6,
architecture §15 decision 8): store name, address, phone, website and opening
hours, each only if the dealer entered it. Staff contact details are never
included. A field that's empty is listed in `missing`, and the answer is "the
team will confirm".

Read unscoped, like integrations/dealer_mode.py: the record is keyed by the
dealer id itself. Cached for 60 seconds.
"""

import re
import time as monotonic_time
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from upsell_agent.integrations.mongodb import PLATFORM_USERS_COLLECTION, as_object_id, get_db

DEFAULT_TIMEZONE = "America/New_York"
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
DEFAULT_OPEN, DEFAULT_CLOSE = time(9), time(18)
DEFAULT_HOURS: dict[int, tuple[time, time] | None] = {
    day: (DEFAULT_OPEN, DEFAULT_CLOSE) if day < 6 else None for day in range(7)
}
CACHE_TTL_S = 60.0

_TIME = re.compile(r"^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*$", re.IGNORECASE)


def format_phone(raw: Any) -> str | None:
    """US numbers as customers write them: "(555) 000-0001". Anything else as given."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return str(raw).strip() or None


def format_time(value: time) -> str:
    """9:00 AM, 12:30 PM."""
    return value.strftime("%I:%M %p").lstrip("0")


@dataclass(frozen=True)
class DealerProfile:
    dealer_id: str
    name: str | None
    timezone: str
    # Weekday (Monday = 0) to (open, close) in the dealer's timezone; None = closed.
    hours: dict[int, tuple[time, time] | None]
    hours_from_record: bool
    # Customer-facing fields from the record (never staff contacts).
    address: str | None = None
    phone: str | None = None
    website: str | None = None
    # MASTER_PLAN_3 C4: Touch 1's required opening names the city and state, and the agent the
    # message comes from (Omnichannel PDF §3). The dealer record has no agent/persona name today,
    # so `agent_name` is usually None and the opening simply doesn't claim one (decision 150).
    city: str | None = None
    state: str | None = None
    agent_name: str | None = None
    # Sales appointment slots (client, 5 Oct 2026): one hour, up to 10 bookings each, unless the dealer record
    # says otherwise (`booking_capacity.sales`, the same setting the CRM's booking check reads,
    # aidmvcs-be-dev app/lib/bookingService.js). The AI books sales visits only; service visits are requests.
    sales_slot_minutes: int = 60
    sales_per_slot: int = 10

    def hours_text(self) -> dict[str, str]:
        """Opening hours as a customer reads them: {"Monday": "9:00 AM to 7:00 PM", "Sunday": "closed"}."""
        return {WEEKDAYS[d].capitalize(): (f"{format_time(w[0])} to {format_time(w[1])}" if w else "closed")
                for d, w in sorted(self.hours.items())}

    def hours_summary(self) -> str:
        """One line: consecutive days with the same hours grouped, e.g.
        "Monday to Friday 9:00 AM to 7:00 PM; Saturday 9:00 AM to 5:00 PM; Sunday closed"."""
        groups: list[tuple[list[str], str]] = []
        for day, text in self.hours_text().items():
            if groups and groups[-1][1] == text:
                groups[-1][0].append(day)
            else:
                groups.append(([day], text))
        return "; ".join(f"{days[0]}{' to ' + days[-1] if len(days) > 1 else ''} {text}" for days, text in groups)

    def public_info(self) -> dict[str, Any]:
        """What the AI may tell a customer; `missing` lists what the team must confirm."""
        info = {"name": self.name, "address": self.address, "phone": self.phone, "website": self.website,
                "hours": self.hours_text() if self.hours_from_record else None,
                "hours_summary": self.hours_summary() if self.hours_from_record else None}
        info["missing"] = [k for k in ("name", "address", "phone", "website", "hours") if not info[k]]
        return info

    @property
    def place(self) -> str | None:
        """"Springfield, NJ" for Touch 1's opening, or None when the record has neither."""
        return ", ".join(x for x in (self.city, self.state) if x) or None

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    def is_open(self, at: datetime) -> bool:
        """Inside opening hours at `at` (MASTER_PLAN_3 B0.1: the default hours when none are on record)."""
        local = at.astimezone(self.tz)
        hours = self.hours.get(local.weekday())
        return bool(hours) and hours[0] <= local.time() < hours[1]

    def next_opening(self, at: datetime) -> datetime | None:
        """The next time the dealership opens after `at` (None: never open)."""
        local = at.astimezone(self.tz)
        for offset in range(8):
            day = local.date() + timedelta(days=offset)
            hours = self.hours.get(day.weekday())
            if hours:
                opens = datetime.combine(day, hours[0], tzinfo=self.tz)
                if opens > local:
                    return opens.astimezone(at.tzinfo)
        return None

    def opening_text(self, opens: datetime, now: datetime) -> str:
        """When the dealership opens again as a customer reads it: "9:00 AM today",
        "9:00 AM tomorrow", "9:00 AM Monday"."""
        local, today = opens.astimezone(self.tz), now.astimezone(self.tz).date()
        days = (local.date() - today).days
        day = "today" if days == 0 else "tomorrow" if days == 1 else WEEKDAYS[local.weekday()].capitalize()
        return f"{format_time(local.time())} {day}"

    def hours_view(self) -> dict[str, str]:
        """Readable opening hours, for traces and the Debug UI."""
        return {WEEKDAYS[d].capitalize(): (f"{w[0]:%H:%M}-{w[1]:%H:%M}" if w else "closed")
                for d, w in self.hours.items()}


def resolve_timezone(name: Any) -> str:
    if isinstance(name, str) and name.strip():
        try:
            ZoneInfo(name.strip())
            return name.strip()
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return DEFAULT_TIMEZONE


def parse_time(value: Any) -> time | None:
    """"9:00 AM", "9 am", "09:00" or "18:30" → time; anything else → None."""
    if not isinstance(value, str):
        return None
    match = _TIME.match(value)
    if not match:
        return None
    hour, minute, meridiem = int(match.group(1)), int(match.group(2) or 0), (match.group(3) or "").lower()
    if minute > 59:
        return None
    if meridiem:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if meridiem == "p" else 0)
    elif hour > 23:
        return None
    return time(hour, minute)


def parse_hours(weekly: Any) -> tuple[dict[int, tuple[time, time] | None], bool]:
    """The dealer's opening hours and whether they came from the record.

    A day marked open with missing or unreadable times gets the default
    hours for that day rather than being treated as closed. A record with no
    open day at all is treated as not set."""
    if not isinstance(weekly, dict):
        return dict(DEFAULT_HOURS), False
    hours: dict[int, tuple[time, time] | None] = {}
    for index, day in enumerate(WEEKDAYS):
        info = weekly.get(day)
        if not isinstance(info, dict) or not info.get("active"):
            hours[index] = None
            continue
        start, end = parse_time(info.get("start")), parse_time(info.get("end"))
        hours[index] = (start, end) if start and end and start < end else (DEFAULT_OPEN, DEFAULT_CLOSE)
    if not any(hours.values()):
        return dict(DEFAULT_HOURS), False
    return hours, True


def _address(info: dict) -> str | None:
    street = str(info.get("store_address") or "").strip()
    city = str(info.get("store_city") or "").strip()
    region = " ".join(x for x in (str(info.get("store_state") or "").strip(),
                                  str(info.get("store_postal") or "").strip()) if x)
    parts = [x for x in (street, city, region) if x]
    return ", ".join(parts) if street else None


def profile_from_record(dealer_id: str, record: dict | None) -> DealerProfile:
    info = (record or {}).get("dealer_account_information") or {}
    hours, from_record = parse_hours(info.get("weekly_availability"))
    return DealerProfile(
        dealer_id=dealer_id,
        name=info.get("store_name") or (record or {}).get("name"),
        timezone=resolve_timezone(info.get("time_zone")),
        hours=hours,
        hours_from_record=from_record,
        address=_address(info),
        # The store's own number first; the texting number customers already have otherwise.
        phone=format_phone(info.get("store_contact_number") or info.get("alternative_contact_number")
                           or info.get("sms_conversion_phone")),
        website=str(info.get("store_website") or "").strip() or None,
        city=str(info.get("store_city") or "").strip() or None,
        state=str(info.get("store_state") or "").strip() or None,
        # Set by the dealer when they give their AI assistant a name; never invented (decision 150).
        # The CRM's Dealer Setup form saves the AI's name as `ai_bot_name` ("Bot Name"); `ai_agent_name` is
        # the older field our dev seed used.
        agent_name=str(info.get("ai_bot_name") or info.get("ai_agent_name") or "").strip() or None,
        **_sales_capacity(info),
    )


def _sales_capacity(info: dict[str, Any]) -> dict[str, int]:
    """The dealer's sales slot length and capacity, read like the CRM's capacitySettings(dealer, "sales"):
    `booking_capacity.sales` first, then the older single `booking_max_per_slot` / `booking_slot_minutes`."""
    own = (info.get("booking_capacity") or {}).get("sales") or {}

    def number(value: Any) -> int | None:
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return None

    per_slot = number(own.get("max_per_slot", info.get("booking_max_per_slot")))
    minutes = number(own.get("slot_minutes", info.get("booking_slot_minutes")))
    return {
        "sales_per_slot": per_slot if per_slot and per_slot > 0 else 10,
        "sales_slot_minutes": minutes if minutes and 5 <= minutes <= 240 else 60,
    }


_cache: dict[str, tuple[float, DealerProfile]] = {}


async def dealer_profile(dealer_id: str) -> DealerProfile:
    cached = _cache.get(dealer_id)
    if cached and cached[0] > monotonic_time.monotonic():
        return cached[1]
    record = await get_db()[PLATFORM_USERS_COLLECTION].find_one(
        {"_id": as_object_id(dealer_id)}, {"name": 1, "dealer_account_information": 1})
    profile = profile_from_record(dealer_id, record)
    _cache[dealer_id] = (monotonic_time.monotonic() + CACHE_TTL_S, profile)
    return profile


def clear_cache() -> None:
    _cache.clear()
