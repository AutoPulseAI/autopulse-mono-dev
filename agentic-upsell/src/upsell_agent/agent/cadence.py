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

import re
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
# A name nudge sent on a later calendar day at or after this local hour was held into that day's business
# hours, so it counts as that day's touch (stream X2).
NUDGE_HELD_FROM_HOUR = 6
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

# The client's own angles per phase (sales deck "Text & Email Cadences", 8 Oct 2026 meeting). Days 8-30 "nurture &
# re-engage": new offers, price-drop alerts, similar new arrivals, and surfacing the objection for the manager.
# Days 31-90 "time to dig deeper": deeper questions ("what did we miss?"), credit tips, trade-in market trends, new
# incentives, a "did you purchase?" check-in - the goal now is a yes or a no before Day 91.
SIMILAR_ARRIVALS = Theme("similar_arrivals", "Similar new arrivals",
                         "Mention one or two vehicles from context.inventory that are similar to what they wanted "
                         "(same type, size or budget), and ask if they'd like to see them. Only vehicles in the "
                         "inventory records, never invented ones.", extended=True)
OBJECTION_CHECK = Theme("objection_check", "What's holding you back",
                        "Ask, warmly and briefly, whether something is holding them back - price, the vehicle, timing, "
                        "financing - so the right person can help. One question, no pressure.", extended=True)
WHAT_DID_WE_MISS = Theme("what_did_we_miss", "What did we miss?",
                         "Ask what we could have done better or what we missed in what they need, and whether "
                         "they're still looking. Short and honest.", extended=True)
CREDIT_TIPS = Theme("credit_tips", "Credit tips",
                    "Share one general, practical tip about getting ready to finance a car (checking your credit "
                    "report, having proof of income, a down payment helps) and offer the team's help. Never a "
                    "rate, an approval, a payment or a promise about their credit.", extended=True)
TRADE_MARKET = Theme("trade_market", "Trade-in market",
                     "Note, in general terms, that trade-in values change with the market and offer a free "
                     "appraisal at the dealership. Never a value, an estimate or a claim about their car.",
                     extended=True)
STILL_SHOPPING = Theme("still_shopping", "Still shopping?",
                       "Ask plainly whether they're still in the market or have already bought a vehicle, so we "
                       "know whether to keep in touch. Friendly, one question.", extended=True)

# A verified price drop comes first in both phases - the most relevant, time-sensitive reason to write; without one
# it isn't a candidate at all (learning/optimizer.py excludes it), so the phase's own angles follow in order.
NURTURE_THEMES: list[Theme] = [PRICE_CHANGE, SIMILAR_ARRIVALS, OBJECTION_CHECK, DAY_THEMES[4], DAY_THEMES[0]]
DEEPER_THEMES: list[Theme] = [PRICE_CHANGE, WHAT_DID_WE_MISS, CREDIT_TIPS, TRADE_MARKET, STILL_SHOPPING]
NURTURE_LAST_DAY = 30


def themes_for_day(day: int | None) -> list[Theme]:
    """The angles a Days 8-90 touch picks from: the nurture set to Day 30, the dig-deeper set after."""
    return DEEPER_THEMES if day and day > NURTURE_LAST_DAY else NURTURE_THEMES


# Every Days 8-90 angle (the learning layer's catalogue, learning/optimizer.py).
EXTENDED_THEMES: list[Theme] = list(dict.fromkeys([*NURTURE_THEMES, *DEEPER_THEMES]))
BY_ID: dict[str, Theme] = {t.id: t for t in (*DAY_THEMES, *EXTENDED_THEMES, NAME_NUDGE)}

# Client, 20-21 Oct 2026 (Betsy: "email subject lines are not effective ones" - the AI-written touches had none set):
# each follow-up's email subject; AI Studio's subject for the step wins when one is set there. (with a vehicle,
# without one)
SUBJECTS: dict[str, tuple[str, str]] = {
    "vehicle_visual": ("A closer look at your {vehicle}", "A closer look at the car you asked about"),
    "financing_help": ("Making the numbers work on the {vehicle}", "Making the numbers work for you"),
    "trade_in": ("Your current car could help with the {vehicle}", "What's your current car worth?"),
    "vehicle_value": ("Why the {vehicle} stands out", "Why this one stands out"),
    "appointment_value": ("Let's get you behind the wheel of the {vehicle}", "Let's get you behind the wheel"),
    "direct_close": ("Still thinking about the {vehicle}?", "Still thinking it over?"),
    "price_or_offer": ("Good news on the {vehicle}", "Good news on the car you asked about"),
    "similar_arrivals": ("New arrivals like the {vehicle}", "New arrivals you might like"),
    "objection_check": ("Anything holding you back, {first_name}?", "Anything holding you back?"),
    "what_did_we_miss": ("Did we miss something, {first_name}?", "Did we miss something?"),
    "credit_tips": ("A quick tip before you finance", "A quick tip before you finance"),
    "trade_market": ("What your trade could be worth now", "What your trade could be worth now"),
    "still_shopping": ("Still shopping for a {vehicle}?", "Still shopping for a car?"),
    "unsold_followup": ("Thanks for stopping by, {first_name}", "Thanks for stopping by"),
}


def subject_for(theme_id: str | None, *, vehicle: str | None, first_name: str | None,
                edited: str | None = None) -> str | None:
    """The touch's email subject, filled in; None for a theme without one (the AI writes it)."""
    with_car, without = SUBJECTS.get(str(theme_id or ""), (None, None))
    text = (edited or "").strip() or (with_car if vehicle else without)
    if not text:
        return None
    if "{vehicle}" in text and not vehicle:
        text = without or text
    if "{first_name}" in text and not first_name:
        text = re.sub(r",?\s*\{first_name\}", "", text)
    out = text.replace("{vehicle}", vehicle or "").replace("{first_name}", first_name or "")
    return re.sub(r"\s{2,}", " ", out).strip() or None


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
    channels: list[str] | None = None  # the channels ticked for the touch in AI Studio (None: every channel)

    @property
    def scheduled(self) -> bool:
        return self.due_at is not None

    def as_dict(self) -> dict[str, Any]:
        return {"touch_number": self.touch_number, "theme": self.theme.id if self.theme else None,
                "theme_label": self.theme.label if self.theme else None,
                "instruction": self.theme.instruction if self.theme else None,
                "day": self.day, "due_at": self.due_at.isoformat() if self.due_at else None, "why": self.why,
                **({"channels": self.channels} if self.channels else {})}


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


# After Day 7 the schedule sits on this grid of cadence days: weekly in Days 8-30, then monthly in Days 31-90
# (Omnichannel PDF §4; client, 9 Oct 2026: "follow the workflow PDF", not the meeting's every two weeks).
# A customer who keeps talking through a grid day doesn't get it late: the next one on the grid is used instead.
EXTENDED_GRID: tuple[int, ...] = (14, 21, 28, 58, 88)


def next_day_after(day: int) -> int | None:
    """The next day in the client's schedule after cadence day `day`
    (§3 daily to Day 7, §4 weekly to Day 30, then monthly to Day 90)."""
    if day < 7:
        return day + 1
    return next((d for d in EXTENDED_GRID if d > day), None)


def pick_theme(touch_number: int, used: list[str], exclude: frozenset[str] = frozenset(),
               day: int | None = None) -> Theme:
    """Days 2-7 follow the client's fixed order; Days 8-90 take the
    least-recently-used angle, so nothing repeats while others are unused (§4).
    `exclude` (PLAN_4 stream L): angles whose facts aren't available (no verified price drop)."""
    if touch_number in FIXED_DAYS:
        return DAY_THEMES[touch_number - 3]
    phase = themes_for_day(day)
    themes = [t for t in phase if t.id not in exclude] or phase
    unused = [t for t in themes if t.id not in used]
    if unused:
        return unused[0]
    oldest = {t.id: used.index(t.id) for t in themes if t.id in used}
    return BY_ID[min(oldest, key=lambda k: oldest[k])]


def plan_touch(state: CadenceState, *, now: datetime, tz, first_contact_done: bool,
               customer_replied: bool = False) -> PlannedTouch:
    """The next touch to schedule for this lead, or a PlannedTouch saying why
    there is none. `first_contact_done`: the first reply (Touch 1) has gone out. `customer_replied`: the customer
    has written to us - the name nudge is only for one who never answered (client, 20 Oct 2026, Nadina Singh)."""
    if not first_contact_done:
        return PlannedTouch(why="The first reply hasn't gone out yet.")
    local_now = now.astimezone(tz)
    touch = max(state.touch_number, 3 if state.reentered or customer_replied else 2)
    if SCHEDULE is not None:
        return _plan_from_schedule(state, now=now, tz=tz, touch=touch)

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
    # it never counts as a touch on Day 2 - unless a hold pushed it into the next day's daytime (an evening
    # lead's nudge held to 09:00): then Touch 3 waits for the next day (PLAN_4 stream X2, audit probe P1).
    last_date = last_sent.date() if last_sent else None
    if touch == 3 and last_sent is not None and (last_sent.date() <= started.date()
                                                 or last_sent.hour < NUDGE_HELD_FROM_HOUR):
        last_date = None

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
    theme = pick_theme(touch, state.themes_used, day=day)
    return PlannedTouch(touch_number=touch, theme=theme, day=day, due_at=due,
                        why=f"Touch {touch} on day {day} of the cadence: {theme.label.lower()}.")


# --- The timing set in AI Studio (client, 13 Oct 2026: "give them the option of the timing") ---------------------
#
# None: the client's schedule above. Set (upsell_agent/ai_studio.py) when the sales cadence was edited there:
#   {"steps": [touch 1, the name nudge (or None when removed), the touches after it ...],
#    "phases": [{"first": wait, "every": wait, "until": wait, "themes": [Theme, ...]}, ...]}
# each step {"theme": Theme, "wait": {...}, "channels": [...]}; a wait as agent/timing.py reads it.
SCHEDULE: dict[str, Any] | None = None


@dataclass
class _Slot:
    touch_number: int
    due_at: datetime
    theme: Theme | None
    phase_themes: list[Theme] | None
    channels: list[str] | None
    calendar: bool


def _slots(started: datetime, tz, last_sent: datetime | None, touch: int) -> list[_Slot]:
    from upsell_agent.agent import timing
    out: list[_Slot] = []
    previous = started
    for i, step in enumerate(SCHEDULE["steps"]):
        if step is None:  # the name nudge was removed: its place is kept so touch numbers stay put
            out.append(_Slot(i + 1, started, None, None, None, False))
            continue
        wait = step.get("wait") or {}
        anchor = started if wait.get("after") == "start" else (
            last_sent if last_sent is not None and i + 1 == touch else previous)
        due = timing.due(anchor, wait, tz) if i else started
        out.append(_Slot(i + 1, due, step.get("theme"), None, step.get("channels"), timing.calendar_unit(wait)))
        previous = due
    for phase in SCHEDULE.get("phases") or []:
        first, every, until = phase.get("first") or {}, phase.get("every") or {}, phase.get("until") or {}
        if not every.get("amount") or not phase.get("themes"):
            continue
        due = timing.due(started if first.get("after") == "start" else previous, first, tz)
        end = timing.due(started, {**until, "at": None}, tz) if until.get("amount") else due
        by_date = timing.calendar_unit(every)
        for _ in range(500):
            if (due.date() > end.date()) if by_date else (due > end + timedelta(minutes=1)):
                break
            out.append(_Slot(len(out) + 1, due, None, phase["themes"], phase.get("channels"),
                             timing.calendar_unit(every)))
            due = timing.due(due, {**every, "at": every.get("at") or first.get("at")}, tz)
        previous = out[-1].due_at if out else previous
    return out


def _plan_from_schedule(state: CadenceState, *, now: datetime, tz, touch: int) -> PlannedTouch:
    started = _aware(state.started_at, tz) or now.astimezone(tz)
    last_sent = _aware(state.last_touch_at, tz)
    last_date = last_sent.date() if last_sent else None
    if touch == 3 and last_sent is not None and (last_sent.date() <= started.date()
                                                 or last_sent.hour < NUDGE_HELD_FROM_HOUR):
        last_date = None  # the name nudge belongs to Day 1 (as in the client's schedule)
    for slot in _slots(started, tz, last_sent, touch)[touch - 1:]:
        if slot.theme is None and slot.phase_themes is None:
            continue

        def taken(at: datetime, calendar: bool = slot.calendar) -> bool:
            return at <= now or (calendar and last_date is not None and at.date() <= last_date)

        if slot.theme is not None and taken(slot.due_at):
            # A touch of its own (not a rotating phase) is never dropped: as in the client's schedule, a day already
            # used moves it to the next day; a wait in minutes / hours that has passed sends it now.
            if slot.calendar:
                for _ in range(14):
                    if not taken(slot.due_at):
                        break
                    slot.due_at += timedelta(days=1)
            else:
                slot.due_at = max(slot.due_at, now + timedelta(minutes=1))
        if taken(slot.due_at):
            continue
        day = (slot.due_at.astimezone(tz).date() - started.date()).days + 1
        theme = slot.theme or _least_used(slot.phase_themes, state.themes_used)
        planned = PlannedTouch(touch_number=slot.touch_number, theme=theme, day=day, due_at=slot.due_at,
                               why=f"Touch {slot.touch_number} on day {day} (the timing set in AI Studio): "
                                   f"{theme.label.lower()}.")
        planned.channels = slot.channels
        return planned
    return PlannedTouch(touch_number=touch, day=0, why="Past the last touch of the cadence (timing set in AI Studio).")


def _least_used(themes: list[Theme], used: list[str]) -> Theme:
    unused = [t for t in themes if t.id not in used]
    if unused:
        return unused[0]
    return min(themes, key=lambda t: used.index(t.id) if t.id in used else -1)


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


# Betsy, 27 Oct 2026 meeting: "if I start a new client and take all their leads from the last 90 days ... it needs to use
# that lead date to put the customer in the right cadence". A first instance for a lead older than this counts its days
# from the lead's own date: the steps already past are skipped (the next one is the next grid day, never a burst), and
# so is the name nudge.
BACKDATE_AFTER = timedelta(days=1)


def started(state: CadenceState, *, at: datetime, reentered: bool = False,
            lead_since: datetime | None = None) -> CadenceState:
    """A fresh Short-Term instance. Re-entry skips the introduction and the name nudge. `lead_since`: when the lead
    itself came in - a first instance for an older lead is placed on its own day of the cadence."""
    if not reentered and lead_since is not None:
        since = lead_since if lead_since.tzinfo else lead_since.replace(tzinfo=at.tzinfo)
        if at - since > BACKDATE_AFTER and at - since <= timedelta(days=LAST_DAY):
            return CadenceState(started_at=since, touch_number=3, themes_used=list(state.themes_used))
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


# Client email, 7 Oct 2026: the AI introduces itself as the dealership's AI Sales Manager (FTC: never poses as a person).
AI_SALES_ROLE = "AI Sales Manager"
AI_SERVICE_ROLE = "AI Service Manager"
AI_DISCLOSURE = AI_SALES_ROLE


def touch1_ending(trade_in_known: bool, *, service: bool = False) -> str | None:
    """Touch 1's mandatory closing question (Omnichannel PDF §3, "ALWAYS end"),
    unless the customer has already told us about a trade-in (client, 1 Oct
    2026: "it will always ask 'What are you driving now' (or a variation of
    that question) EXCEPT when a trade-in is already indicated"). It is a sales
    question: a service lead (stream Q) is asked about the car they want serviced instead, by Decide's own asks."""
    return None if trade_in_known or service else "Tell me, what are you driving now?"


# Live, 23 Oct 2026 (an Edmunds trade lead: "following up on your interest in the 1900 None None"): a feed's stand-ins
# for "no vehicle" are not a vehicle.
_NO_VALUE = {"none", "null", "nil", "n/a", "na", "undefined", "unknown", "0", "-", "--", "other", "tbd"}


def clean_vehicle(text: str | None) -> str | None:
    """A vehicle's name without placeholder words or an impossible year; None when nothing real is left."""
    words = []
    for word in str(text or "").split():
        bare = word.strip(".,;:()").lower()
        if bare in _NO_VALUE:
            continue
        if bare.isdigit() and len(bare) == 4 and not 1950 <= int(bare) <= 2100:
            continue
        words.append(word)
    cleaned = " ".join(words).strip()
    # A year alone ("2019") is no vehicle to name.
    return cleaned if cleaned and not (cleaned.isdigit() and len(cleaned) == 4) else None


def touch1_intro(*, customer_first_name: str | None, agent_name: str | None, dealership: str | None,
                 city: str | None, state_code: str | None, vehicle: str | None, service: bool = False,
                 origin: str | None = None) -> str:
    """The client's required opening (Omnichannel PDF §3). Anything the dealer
    record doesn't have is left out rather than invented: with no agent name
    the message doesn't claim one, and with no vehicle on the lead it thanks
    them for getting in touch instead.

    `service` (PLAN_4 stream Q): the Omnichannel PDF is the SALES lead workflow, so its "Thank you for your
    interest in our {vehicle}. I am excited to help you with your purchase." doesn't fit a customer asking for
    service (seen: an oil-change request got "...help you with your purchase ... what are you driving now?").
    A service lead gets the same greeting with a service sentence, and no closing question (touch1_ending).

    `origin` (compliance/origin.py: "inbound" or "outbound", MASTER_PLAN_3 B2; fixed 6 Oct 2026): the client's
    required text above is itself written for an inbound lead - a customer who contacted the dealer first. An
    "outbound" lead (a DealerVault contact, a platform campaign, an unmapped source) never did, so "thank you
    for getting in touch" / "for your interest" would be claiming something that didn't happen (TruthMode,
    the blueprint's core principle: "every interaction is honest, transparent"), and reads like a reply to a
    message the customer never sent. Only this one line changes; the required closing question, and every
    other part of the structure, stay exactly as specified regardless of origin."""
    # FTC (client email, 7 Oct 2026, "this basically needs to be said BEFORE ANYTHING"): "Hi [First Name], this is
    # Angela, [Dealership Name]'s AI Sales Manager, following up on your interest in the [Year Make Model]. Tell me,
    # what are you driving now?" - the AI says it is AI in its very first words. City / state are no longer part of it.
    vehicle = clean_vehicle(vehicle)
    who = f"Hi {customer_first_name}" if customer_first_name else "Hi"
    role = AI_SERVICE_ROLE if service else AI_SALES_ROLE
    owner = (f"{dealership}'" if dealership.endswith("s") else f"{dealership}'s") if dealership else None
    title = f"{owner} {role}" if owner else f"the {role}"
    speaker = f", this is {agent_name}, {title}" if agent_name else f", this is {title}"
    if service:
        care = f"your {vehicle}" if vehicle else "your vehicle"
        return f"{who}{speaker}. I am happy to help you with service for {care}."
    if origin == "outbound":
        about = f", reaching out about the {vehicle}." if vehicle else ", reaching out to see how I can help."
    else:
        about = (f", following up on your interest in the {vehicle}." if vehicle
                 else ", following up on your interest.")
    return f"{who}{speaker}{about}"
