"""The Short-Term and extended follow-up cadence (MASTER_PLAN_3 C4;
Omnichannel PDF §3-§4; diagrams: docs/architecture/STATE_MACHINE_DIAGRAMS.md §6, §9).

The client's schedule for a lead nobody has converted yet:

    Touch 1  immediately          the first quality response (agent/turn.py's
                                  `lead_created` turn, not scheduled here)
    Touch 2  3 hours later        the name nudge, exactly "{FirstName}?"
    Touch 3  Day 2               vehicle visual
    Touch 4  Day 3               financing help
    Touch 5  Day 4               trade-in / appraisal
    Touch 6  Day 5               a verified feature or vehicle fact
    Touch 7  Day 6               why a visit is worth it
    Touch 8  Day 7               direct close
    Days 8-30                    one touch a week   (days 14, 21, 28)
    Days 31-90                   one touch a month  (days 58, 88)
    Day 91                       the opportunity closes (agent/lifecycle.py)

**Every touch is text + email together** (Omnichannel PDF p.10, "all follow-up
= CALL + TEXT + EMAIL"). The call task is C2, skipped for now, so a touch goes
out on both message channels at once - not the 24h one-channel switch Plan 1
shipped, which this replaces (decision 147).

**The day counter** runs from the Short-Term instance's start
(`cadence.started_at`), so re-entry (after a no-show, say) starts a fresh
schedule without resetting the Day 91 opportunity clock (§12).

**Themes advance only when a touch actually fires.** A customer reply doesn't
use one up: the AI's own reply covers that day, and the next unused theme is
scheduled for the next cadence day (§4: "choose the most relevant unused angle
instead of blindly rotating templates").

Nothing here touches the database or the clock: `plan_touch()` is a pure
function of the stored cadence state and `now`. scheduler/followups.py owns
the scheduling and firing, agent/turn.py the sending.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, time, timedelta
from typing import Any

# Touch 2's wait (Omnichannel PDF §3: "3 hours later; next eligible window if blocked").
NAME_NUDGE_AFTER = timedelta(hours=3)
# A day-N touch goes out at this dealer-local hour. Our default: the client's spec gives days,
# not times (decision 148). The send check moves it when the dealer is shut or the customer's
# own window is closed.
TOUCH_HOUR = 10
LAST_DAY = 90
MAX_THEMES_REMEMBERED = 20


@dataclass(frozen=True)
class Theme:
    """What a touch is about. `instruction` is written for Compose (and the
    offline model follows the same ids), never shown to the customer."""
    id: str
    label: str
    instruction: str
    # Days 8-90 pick from the themes marked `extended` (§4's list of fresh angles).
    extended: bool = False


# Days 2-7, in the client's own order (Omnichannel PDF §3).
DAY_THEMES: list[Theme] = [
    Theme("vehicle_visual", "Vehicle visual",
          "Show them the vehicle they asked about and ask one simple question about it (color, trim, "
          "whether they want to see it in person). Use only what the inventory records say.", extended=True),
    Theme("financing_help", "Financing help",
          "Ask whether they'd like help with financing or payment options. Never state a rate, a term, a "
          "payment or an approval - the team confirms all of that.", extended=True),
    Theme("trade_in", "Trade-in",
          "Ask about a trade-in using what they've already told us: if we know their current vehicle, ask "
          "whether they want it appraised; if not, ask what they're driving now. Never a value or an estimate.",
          extended=True),
    Theme("vehicle_value", "Vehicle value or feature",
          "Highlight one verified feature, trim detail or fact about the vehicle from the inventory records, "
          "and why it fits what they told us. Nothing invented.", extended=True),
    Theme("appointment_value", "Why a visit is worth it",
          "Give one truthful reason to come in that fits their own situation - an appraisal, comparing it with "
          "another vehicle, a financing review, meeting the right person - and ask for the visit.", extended=True),
    Theme("direct_close", "Direct close",
          "Ask whether they're still considering the vehicle, and offer to set a time - ask what day suits them.",
          extended=True),
]
# Days 8-90 also use "verified price change / OEM offer" (§4). Only when the record really shows one;
# with nothing verified, Compose falls back to the theme's own angle without a price (decision 151).
PRICE_CHANGE = Theme("price_or_offer", "Verified price change or offer",
                     "Only if the inventory record for their vehicle shows a verified price change or a "
                     "manufacturer offer, mention it plainly. If there is none, talk about what else is on the "
                     "lot that fits them instead - never invent a price, a discount or an offer.", extended=True)
NAME_NUDGE = Theme("name_nudge", "Name nudge",
                   "Send exactly the customer's first name followed by a question mark, and nothing else.")

EXTENDED_THEMES: list[Theme] = [*(t for t in DAY_THEMES if t.extended), PRICE_CHANGE]
BY_ID: dict[str, Theme] = {t.id: t for t in (*DAY_THEMES, PRICE_CHANGE, NAME_NUDGE)}

# Touch number -> the day it goes out on, for the fixed part of the schedule (§3).
# Touch 1 is the first reply itself; touch 2 is timed in hours, not days.
FIXED_DAYS: dict[int, int] = {3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7}
LAST_FIXED_TOUCH = 8


@dataclass
class CadenceState:
    """`ai_lead_state.cadence`. `touch_number` is the touch this lead will send
    next (1 = the first reply)."""
    started_at: datetime | None = None
    touch_number: int = 1
    last_touch_at: datetime | None = None
    last_touch_day: int = 0
    themes_used: list[str] = field(default_factory=list)
    # A re-entry (after a no-show, say) skips Touch 1's introduction and Touch 2's name nudge:
    # the customer has heard from us already (decision 149).
    reentered: bool = False

    @classmethod
    def load(cls, lead_state: dict | None) -> "CadenceState":
        raw = (lead_state or {}).get("cadence") or {}
        return cls(
            started_at=raw.get("started_at"),
            touch_number=int(raw.get("touch_number") or 1),
            last_touch_at=raw.get("last_touch_at"),
            last_touch_day=int(raw.get("last_touch_day") or 0),
            themes_used=list(raw.get("themes_used") or []),
            reentered=bool(raw.get("reentered")),
        )

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PlannedTouch:
    """What scheduler/followups.py should schedule next, or why it shouldn't."""
    touch_number: int = 0
    theme: Theme | None = None
    day: int = 0
    due_at: datetime | None = None
    why: str = ""

    @property
    def scheduled(self) -> bool:
        return self.due_at is not None

    def as_dict(self) -> dict[str, Any]:
        return {"touch_number": self.touch_number, "theme": self.theme.id if self.theme else None,
                "theme_label": self.theme.label if self.theme else None,
                "instruction": self.theme.instruction if self.theme else None,
                "day": self.day, "due_at": self.due_at.isoformat() if self.due_at else None, "why": self.why}


def _aware(value: Any, tz) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value.astimezone(tz) if value.tzinfo else value.replace(tzinfo=tz)


def cadence_day(state: CadenceState, now: datetime, tz) -> int:
    """Which day of this Short-Term instance `now` is. Day 1 is the day it started."""
    started = _aware(state.started_at, tz)
    if started is None:
        return 1
    return (now.astimezone(tz).date() - started.astimezone(tz).date()).days + 1


# After Day 7 the schedule sits on this grid of cadence days (Omnichannel PDF §4): weekly in Days 8-30,
# monthly in Days 31-90. A customer who keeps talking through a grid day doesn't get it late: the next one
# on the grid is used instead.
EXTENDED_GRID: tuple[int, ...] = (14, 21, 28, 58, 88)


def next_day_after(day: int) -> int | None:
    """The next day in the client's schedule after cadence day `day`
    (§3 daily to Day 7, §4 weekly to Day 30, then monthly to Day 90)."""
    if day < 7:
        return day + 1
    return next((d for d in EXTENDED_GRID if d > day), None)


def pick_theme(touch_number: int, used: list[str]) -> Theme:
    """Days 2-7 follow the client's fixed order; Days 8-90 take the
    least-recently-used angle, so nothing repeats while others are unused (§4)."""
    if touch_number in FIXED_DAYS:
        return DAY_THEMES[touch_number - 3]
    unused = [t for t in EXTENDED_THEMES if t.id not in used]
    if unused:
        return unused[0]
    oldest = {t.id: used.index(t.id) for t in EXTENDED_THEMES if t.id in used}
    return BY_ID[min(oldest, key=lambda k: oldest[k])]


def plan_touch(state: CadenceState, *, now: datetime, tz, first_contact_done: bool) -> PlannedTouch:
    """The next touch to schedule for this lead, or a PlannedTouch saying why
    there is none. `first_contact_done`: the first reply (Touch 1) has gone out."""
    if not first_contact_done:
        return PlannedTouch(why="The first reply hasn't gone out yet.")
    local_now = now.astimezone(tz)
    touch = max(state.touch_number, 3 if state.reentered else 2)

    if touch == 2:
        due = now + NAME_NUDGE_AFTER
        # Day 1 in the client's schedule even when 3 hours later is past midnight (§3: "Day 1 has Touch 1 plus
        # the mandatory three-hour Touch 2"), so it never uses up Day 2.
        return PlannedTouch(touch_number=2, theme=NAME_NUDGE, day=1, due_at=due,
                            why="Touch 2, the name nudge, 3 hours after the first reply.")

    started = _aware(state.started_at, tz) or local_now
    today = cadence_day(state, now, tz)

    def due_on(day: int) -> datetime:
        return datetime.combine(started.date() + timedelta(days=day - 1), time(TOUCH_HOUR), tzinfo=tz)

    # The touch's own day (Days 2-7 are fixed by touch number, §3), or the next grid day after the last touch
    # (§4). A day whose time has already passed (the customer kept talking through it), that already had a
    # touch, or that falls on the calendar day of the last one actually sent (a hold - a closed dealership on
    # a Sunday - can push a touch into the next day's) moves on: "prevent duplicate same-day touches" (§15).
    # A fixed touch moves to the next day; a grid touch to the next grid day.
    last_sent = _aware(state.last_touch_at, tz)
    # Touch 3 follows the name nudge, which belongs to Day 1 even when it went out after midnight (§3), so
    # it never counts as a touch on Day 2.
    last_date = last_sent.date() if last_sent and touch != 3 else None

    def advance(day: int) -> int | None:
        return day + 1 if touch in FIXED_DAYS and day < 13 else next_day_after(day)

    day = FIXED_DAYS.get(touch) if touch in FIXED_DAYS else next_day_after(max(state.last_touch_day, 7))
    while day is not None and (due_on(day) <= now or day == state.last_touch_day
                               or (last_date is not None and due_on(day).date() <= last_date)):
        day = advance(day)
    if day is None:
        return PlannedTouch(touch_number=touch, day=0,
                            why=f"Day {today}: past the end of the {LAST_DAY}-day cadence.")
    due = due_on(day)
    theme = pick_theme(touch, state.themes_used)
    return PlannedTouch(touch_number=touch, theme=theme, day=day, due_at=due,
                        why=f"Touch {touch} on day {day} of the cadence: {theme.label.lower()}.")


def after_touch(state: CadenceState, planned: PlannedTouch, *, at: datetime) -> CadenceState:
    """The cadence state once `planned` has gone out."""
    used = list(state.themes_used)
    if planned.theme and planned.theme is not NAME_NUDGE:
        used = [t for t in used if t != planned.theme.id] + [planned.theme.id]
    return CadenceState(
        started_at=state.started_at, touch_number=planned.touch_number + 1, last_touch_at=at,
        last_touch_day=planned.day or state.last_touch_day, themes_used=used[-MAX_THEMES_REMEMBERED:],
        reentered=state.reentered,
    )


def after_reply(state: CadenceState) -> CadenceState:
    """The customer wrote back. The name nudge is for silence (Omnichannel PDF §3: "if there is no response
    after three hours"), so a customer who has answered never gets "Maria?" - the next touch is Touch 3.
    Nothing else changes: later themes still wait their turn (§4: "the most relevant unused angle")."""
    if state.touch_number > 2:
        return state
    return CadenceState(started_at=state.started_at, touch_number=3, last_touch_at=state.last_touch_at,
                        last_touch_day=state.last_touch_day, themes_used=list(state.themes_used),
                        reentered=state.reentered)


def started(state: CadenceState, *, at: datetime, reentered: bool = False) -> CadenceState:
    """A fresh Short-Term instance. Re-entry skips the introduction and the name nudge."""
    return CadenceState(started_at=at, touch_number=3 if reentered else 2, themes_used=list(state.themes_used),
                        reentered=reentered)


def days_left(state: CadenceState, now: datetime, tz) -> int:
    return max(0, LAST_DAY - cadence_day(state, now, tz))


def describe(state: CadenceState, now: datetime, tz) -> dict[str, Any]:
    """For the lead profile API and the Debug UI."""
    return {"day": cadence_day(state, now, tz), "touch_number": state.touch_number,
            "last_touch_at": state.last_touch_at.isoformat() if isinstance(state.last_touch_at, datetime) else None,
            "themes_used": list(state.themes_used), "days_left": days_left(state, now, tz),
            "started_at": state.started_at.isoformat() if isinstance(state.started_at, datetime) else None}


def touch1_ending(trade_in_known: bool, *, service: bool = False) -> str | None:
    """Touch 1's mandatory closing question (Omnichannel PDF §3, "ALWAYS end"),
    unless the customer has already told us about a trade-in (client, 1 Oct
    2026: "it will always ask 'What are you driving now' (or a variation of
    that question) EXCEPT when a trade-in is already indicated"). It is a sales
    question: a service lead (stream Q) is asked about the car they want serviced instead, by Decide's own asks."""
    return None if trade_in_known or service else "Tell me, what are you driving now?"


def touch1_intro(*, customer_first_name: str | None, agent_name: str | None, dealership: str | None,
                 city: str | None, state_code: str | None, vehicle: str | None, service: bool = False) -> str:
    """The client's required opening (Omnichannel PDF §3). Anything the dealer
    record doesn't have is left out rather than invented: with no agent name
    the message doesn't claim one, and with no vehicle on the lead it thanks
    them for getting in touch instead.

    `service` (PLAN_4 stream Q): the Omnichannel PDF is the SALES lead workflow, so its "Thank you for your
    interest in our {vehicle}. I am excited to help you with your purchase." doesn't fit a customer asking for
    service (seen: an oil-change request got "...help you with your purchase ... what are you driving now?").
    A service lead gets the same greeting with a service sentence, and no closing question (touch1_ending)."""
    who = f"Hello {customer_first_name}" if customer_first_name else "Hello"
    speaker = f", this is {agent_name}" if agent_name else ""
    place = ""
    if dealership:
        where = ", ".join(x for x in (city, state_code) if x)
        place = f" from {dealership}" + (f" in {where}" if where else "")
        if customer_first_name and not agent_name:
            # Stream G (grammar): "Hello Maria from ABC Toyota." reads as if Maria were from ABC Toyota.
            place = f", greetings{place}"
    if service:
        care = f"your {vehicle}" if vehicle else "your vehicle"
        return (f"{who}{speaker}{place}. Thank you for contacting our service team. "
                f"I am happy to help you take care of {care}.")
    thanks = (f" Thank you for your interest in our {vehicle}." if vehicle
              else " Thank you for getting in touch.")
    return f"{who}{speaker}{place}.{thanks} I am excited to help you with your purchase."
