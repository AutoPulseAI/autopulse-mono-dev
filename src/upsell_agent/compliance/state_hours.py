"""Per-state contact hours for marketing texts (MASTER_PLAN_4 F1; fixes
MASTER_PLAN_3 B0.6 / B3's single 8:00-20:00 window).

The client sent two state tables on 1 Oct 2026 with the note "PLEASE USE
BOTH TABLES" (docs/data/6/tcpa_7.md). Both are merged into one row per
state below: the window for each weekday, the Sunday rule, the holiday rule
and the per-state frequency cap. Where the two tables differ, the stricter
one wins. The table is config, not prompt text (TCPA PDF §7, §13), and it
carries a version (RULES_VERSION) that every send-check decision logs.

How it's applied (compliance/engine.py rule 8, compliance/call_check.py):

- The customer's state comes from compliance/customer_zone.py (ZIP, else
  DealerVault state, else area code). When the ZIP state and the area-code
  state differ, BOTH rows apply, so the stricter one wins at every moment.
- No state, or a state that isn't in the table: the STRICTEST row, built by
  intersecting every row (latest start, earliest end, Saturday as the
  strictest Saturday, no Sundays, no holidays, the tightest cap).
- Every applicable row is checked in every one of the customer's possible
  time zones (the same "legal in all of them" rule as customer_zone.py).
- A HOLD gives the first moment every row allows (next_allowed).

Rows the client marks with an asterisk ("federal default", not individually
verified) are kept as `verified=False`: research status, not a legal
conclusion. Counsel confirms (the client's own note under Table 1).

The hours are the "live-call window" column. PLAN_4 stream X1 item 10 adds, as configurable rules in this
same versioned table (counsel must confirm each, docs/plans/PLAN_4/stream_X1.md):

- **State holidays** besides the federal calendar for the holiday-ban states: Rhode Island's Victory Day,
  Louisiana's Mardi Gras, Good Friday and All Saints' Day, Alabama's Mardi Gras, Confederate Memorial Day and
  Jefferson Davis' Birthday (STATE_HOLIDAYS).
- **Automated-device rows** (`automated`): Indiana's ADAD 9:00-20:00 and Maine's automated-device weekdays
  9:00-17:00 with at most 1 per 8 hours. Every AI text is automated, so the engine applies them to texts
  (`rules_for(..., automated=True)`); a person's call keeps the live row. Off with
  TCPA_AUTOMATED_DEVICE_ROWS=false.
- **New Jersey's ban on unsolicited sales calls to cell phones** (N.J.S.A. 56:8-130, `unsolicited_sales_ban`):
  the engine blocks a marketing text to a New Jersey customer unless it follows up their own inquiry or they
  gave express consent. Off with TCPA_NJ_CELL_SALES_BAN=false.

Replies to the customer's own message are not marketing and keep their
current exemption (engine.py rule 5): nothing here touches them.
"""

import os
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

# Bump when any row changes. Logged with every decision (ai_compliance_log.jurisdiction.rules_version).
RULES_VERSION = "tcpa_7/2026-10-04-x1"


def _flag(name: str) -> bool:
    return os.environ.get(name, "true").strip().lower() not in ("0", "false", "no", "off")


# PLAN_4 stream X1 item 10: configurable, on by default (the stricter reading) until counsel says otherwise.
def automated_rows_on() -> bool:
    return _flag("TCPA_AUTOMATED_DEVICE_ROWS")


def nj_cell_sales_ban_on() -> bool:
    return _flag("TCPA_NJ_CELL_SALES_BAN")
SEARCH_DAYS = 14

Window = tuple[time, time]  # (start, end), end exclusive, customer-local


@dataclass(frozen=True)
class StateRule:
    state: str
    weekday: Window             # Monday-Friday
    saturday: Window | None     # None: no marketing texts on Saturday
    sunday: Window | None       # None: no marketing texts on Sunday
    holidays_banned: bool = False
    # (texts, period): at most this many marketing texts in any period (Table 1 / Table 2 "3 per 24 hours").
    cap: tuple[int, timedelta] | None = None
    # False for the client's asterisk rows: "federal default", not individually verified.
    verified: bool = True
    cite: str = ""
    note: str = ""
    # PLAN_4 stream X1 item 10: automated-device rules {"weekday": Window, "saturday": Window | None,
    # "sunday": Window | None, "cap": (count, period) | None, "cite": str} - applied to AI texts.
    automated: dict[str, Any] | None = None
    # N.J.S.A. 56:8-130: no unsolicited sales calls (texts) to cell phones.
    unsolicited_sales_ban: bool = False

    def window_on(self, day: date) -> Window | None:
        """The window on that customer-local day (None: no texts that day)."""
        if self.holidays_banned and (is_federal_holiday(day) or is_state_holiday(day, self.state)):
            return None
        weekday = day.weekday()
        if weekday == 5:
            return self.saturday
        if weekday == 6:
            return self.sunday
        return self.weekday

    def allows(self, local: datetime) -> bool:
        window = self.window_on(local.date())
        return bool(window) and window[0] <= local.time() < window[1]

    def describe(self) -> str:
        def fmt(w: Window | None) -> str:
            return "none" if w is None else f"{w[0]:%H:%M}-{w[1]:%H:%M}"
        parts = [f"{self.state}: Mon-Fri {fmt(self.weekday)}"]
        if self.saturday != self.weekday:
            parts.append(f"Sat {fmt(self.saturday)}")
        if self.sunday != self.weekday:
            parts.append(f"Sun {fmt(self.sunday)}")
        if self.holidays_banned:
            parts.append("no holidays")
        if self.cap:
            parts.append(f"max {self.cap[0]} per {int(self.cap[1].total_seconds() // 3600)}h")
        return ", ".join(parts)


_DAY = timedelta(hours=24)
_FEDERAL: Window = (time(8), time(21))      # 16 C.F.R. § 310.4(c)
_EIGHT_TO_EIGHT: Window = (time(8), time(20))
_THREE_A_DAY = (3, _DAY)


_SAME: Any = "same"  # Saturday / Sunday use the weekday window


def _row(state: str, weekday: Window = _FEDERAL, *, saturday: Any = _SAME, sunday: Any = _SAME,
         holidays_banned: bool = False, cap: tuple[int, timedelta] | None = None, verified: bool = True,
         cite: str = "", note: str = "", automated: dict[str, Any] | None = None,
         unsolicited_sales_ban: bool = False) -> StateRule:
    return StateRule(state, weekday, weekday if saturday is _SAME else saturday,
                     weekday if sunday is _SAME else sunday, holidays_banned, cap, verified, cite, note,
                     automated, unsolicited_sales_ban)


def _federal_default(state: str, *, verified: bool = False, note: str = "") -> StateRule:
    return _row(state, verified=verified, cite="16 C.F.R. § 310.4(c)", note=note)


# The client's Table 1 (live-call window, Sundays & holidays) merged with Table 2 (hours & frequency).
STATE_RULES: dict[str, StateRule] = {r.state: r for r in [
    _row("AL", _EIGHT_TO_EIGHT, sunday=None, holidays_banned=True, cite="Ala. Admin. Code r. 770-X-5-.17"),
    _federal_default("AK"),
    _federal_default("AZ", note="Table 2: registration + bond state; hours are the federal default"),
    _federal_default("AR"),
    _federal_default("CA"),
    _federal_default("CO"),
    _row("CT", (time(9), time(20)), cite="Conn. Gen. Stat. § 42-288a(c) (PA 23-98)",
         note="Table 2: PEWC default for telephonic sales calls, with carve-outs for consumer inquiries"),
    _federal_default("DE"),
    _row("FL", _EIGHT_TO_EIGHT, cap=_THREE_A_DAY, cite="Fla. Stat. § 501.616(6)",
         note="Table 2: PEWC for automated selection and dialing (FTSA, § 501.059)"),
    _federal_default("GA"),
    _federal_default("HI"),
    _federal_default("ID"),
    _federal_default("IL"),
    _row("IN", cite="Ind. Code § 24-5-14-8",
         note="Live calls: federal default. Autodialed (ADAD) calls 9:00-20:00 - applied to AI texts (X1 item 10)",
         automated={"weekday": (time(9), time(20)), "saturday": (time(9), time(20)), "sunday": (time(9), time(20)),
                    "cap": None, "cite": "Ind. Code § 24-5-14-8 (ADAD)"}),
    _federal_default("IA"),
    _federal_default("KS"),
    _row("KY", (time(10), time(21)), cite="KRS 367.46955(16)", note="Latest start in the country"),
    _row("LA", _EIGHT_TO_EIGHT, sunday=None, holidays_banned=True,
         cite="LPSC DNC General Order R-29617 § V(A)(2); La. R.S. 45:811"),
    _row("ME", cite="10 M.R.S. § 1498(3)",
         note="Live calls: federal default. Automated devices: weekdays 9:00-17:00, 1 per 8h - applied to AI texts "
              "(X1 item 10)",
         automated={"weekday": (time(9), time(17)), "saturday": None, "sunday": None,
                    "cap": (1, timedelta(hours=8)), "cite": "10 M.R.S. § 1498(3) (automated devices)"}),
    _row("MD", _EIGHT_TO_EIGHT, cap=_THREE_A_DAY, cite="Md. Com. Law § 14-4502(c)",
         note="Table 2: PEWC for automated selection or dialing (calls, texts, voicemail)"),
    _row("MA", _EIGHT_TO_EIGHT, cite="201 CMR 12.02(2)"),
    _federal_default("MI"),
    _federal_default("MN"),
    _row("MS", _EIGHT_TO_EIGHT, sunday=None, cite="Miss. Code §§ 77-3-603, 77-3-723"),
    _federal_default("MO"),
    _federal_default("MT"),
    _row("NE", cite="Neb. Rev. Stat. § 86-248(1)(a)"),
    _row("NV", (time(9), time(20)), cite="NRS 598.0918(3)"),
    _federal_default("NH", verified=True, note="State telemarketing law has no hours rule"),
    _row("NJ", verified=False, cite="16 C.F.R. § 310.4(c); N.J.S.A. 56:8-130",
         note="Table 2: no calls 21:00-8:00; outright ban on unsolicited sales calls to cell phones (N.J.S.A. "
              "56:8-130) - applied to marketing texts without the customer's own inquiry or express consent "
              "(X1 item 10), for counsel", unsolicited_sales_ban=True),
    _row("NM", (time(9), time(21)), cite="NMSA § 57-12-22(B)(5)"),
    _row("NY", cite="N.Y. Gen. Bus. Law § 399-z(2), (5-a)"),
    _federal_default("NC"),
    _row("ND", cite="N.D.C.C. § 51-28-05"),
    _federal_default("OH"),
    _row("OK", _EIGHT_TO_EIGHT, cap=_THREE_A_DAY, cite="15 O.S. § 775C.4(A)",
         note="Table 2: PEWC for automated selection or dialing"),
    _federal_default("OR"),
    _row("PA", cite="73 P.S. § 2245(a)(1)"),
    _row("RI", (time(9), time(18)), saturday=(time(10), time(17)), sunday=None, holidays_banned=True,
         cite="R.I. Gen. Laws §§ 5-61-2(2), 5-61-3.6",
         note="State holidays as well as federal (Victory Day, X1 item 10)"),
    _row("SC", cite="S.C. Code § 37-21-30"),
    _row("SD", (time(9), time(21)), sunday=None, cite="SDCL 37-30A-3(2)"),
    _federal_default("TN"),
    _row("TX", (time(9), time(21)), sunday=(time(12), time(21)), cite="Tex. Bus. & Com. Code § 301.051"),
    _row("UT", cite="Utah Code § 13-25a-103"),
    _federal_default("VT"),
    _row("VA", cite="Va. Code § 59.1-511"),
    _row("WA", _EIGHT_TO_EIGHT, cite="RCW 80.36.390(8)"),
    _federal_default("WV"),
    _row("WI", cite="Wis. Admin. Code ATCP 127.16(3)"),
    _row("WY", _EIGHT_TO_EIGHT, cite="Wyo. Stat. § 40-12-302(d)"),
    _federal_default("DC"),
]}


def _intersect(windows: list[Window | None]) -> Window | None:
    if any(w is None for w in windows):
        return None
    start = max(w[0] for w in windows)  # type: ignore[index]
    end = min(w[1] for w in windows)  # type: ignore[index]
    return (start, end) if start < end else None


def _strictest(rows: list[StateRule]) -> StateRule:
    caps = [r.cap for r in rows if r.cap]
    return StateRule(
        state="STRICTEST",
        weekday=_intersect([r.weekday for r in rows]) or (time(0), time(0)),
        saturday=_intersect([r.saturday for r in rows]),
        sunday=_intersect([r.sunday for r in rows]),
        holidays_banned=any(r.holidays_banned for r in rows),
        # The tightest cap: fewest texts per hour of period.
        cap=min(caps, key=lambda c: c[0] / c[1].total_seconds()) if caps else None,
        verified=False,
        note="No known state (or one not in the table): the strictest row, every state's rules at once",
    )


# MASTER_PLAN_4 F1 item 2: an unknown state gets the strictest row. With today's table that is
# Mon-Fri 10:00-18:00 (Kentucky's start, Rhode Island's end), Saturday 10:00-17:00, no Sundays,
# no holidays, and 3 per 24 hours.
STRICTEST = _strictest(list(STATE_RULES.values()))


def as_automated(rule: StateRule) -> StateRule:
    """The row with its automated-device rules applied on top (PLAN_4 stream X1 item 10): each day's window is
    the overlap of the live and the automated windows, and the tighter cap wins."""
    auto = rule.automated
    if not auto:
        return rule
    caps = [c for c in (rule.cap, auto.get("cap")) if c]
    return replace(rule, weekday=_intersect([rule.weekday, auto["weekday"]]) or (time(0), time(0)),
                   saturday=_intersect([rule.saturday, auto.get("saturday")]),
                   sunday=_intersect([rule.sunday, auto.get("sunday")]),
                   cap=min(caps, key=lambda c: c[0] / c[1].total_seconds()) if caps else None,
                   cite=f"{rule.cite}; {auto.get('cite', '')}".strip("; "))


def rules_for(states: tuple[str, ...] | list[str], *, automated: bool = False) -> list[StateRule]:
    """Every row that applies: one per known state; the strictest row when
    there's no state, or a state the table doesn't have. `automated`: an AI
    text (an automated message), so the automated-device rows apply too
    (PLAN_4 stream X1 item 10) while TCPA_AUTOMATED_DEVICE_ROWS is on."""
    automated = automated and automated_rows_on()
    known = [s.upper() for s in states if s]
    if not known or any(s not in STATE_RULES for s in known):
        return [STRICTEST_AUTOMATED if automated else STRICTEST]
    rows = [STATE_RULES[s] for s in dict.fromkeys(known)]
    return [as_automated(r) for r in rows] if automated else rows


def unsolicited_sales_banned(rules: list[StateRule]) -> list[str]:
    """States among `rules` that ban unsolicited sales messages to cell phones (NJ), while the switch is on."""
    return [r.state for r in rules if r.unsolicited_sales_ban] if nj_cell_sales_ban_on() else []

# PLAN_4 stream X1 item 10: for an AI text to a customer in no known state, the automated-device rows count too.
STRICTEST_AUTOMATED = replace(_strictest([as_automated(r) for r in STATE_RULES.values()]),
                              note="No known state: every state's rules at once, automated-device rows included")


def zone_states(zone: dict | object) -> tuple[str, ...]:
    """The states a CustomerZone (or its as_dict()) puts the customer in:
    the ZIP / DealerVault state and, when it differs, the area-code state.
    An unknown zone has none."""
    get = zone.get if isinstance(zone, dict) else (lambda k, d=None: getattr(zone, k, d))
    if get("method") == "unknown":
        return ()
    states = tuple(get("states") or ())
    if not states and get("state"):
        states = (get("state"),)
    return states


def allowed(at: datetime, zones: tuple[str, ...] | list[str], rules: list[StateRule]) -> bool:
    """`at` is allowed by every row, in every one of the customer's zones."""
    return all(rule.allows(at.astimezone(ZoneInfo(z))) for rule in rules for z in zones)


def _candidates(start: datetime, zones: tuple[str, ...] | list[str], rules: list[StateRule],
                profile) -> list[datetime]:
    """Every moment from `start` on when an allowed stretch can begin: each
    row's window start on each day in each zone, and each dealer opening."""
    points = {start}
    for offset in range(SEARCH_DAYS + 1):
        for zone in zones:
            tz = ZoneInfo(zone)
            day = (start.astimezone(tz) + timedelta(days=offset)).date()
            for rule in rules:
                if window := rule.window_on(day):
                    points.add(datetime.combine(day, window[0], tzinfo=tz).astimezone(start.tzinfo))
        if profile is not None:
            day = (start.astimezone(profile.tz) + timedelta(days=offset)).date()
            if hours := profile.hours.get(day.weekday()):
                points.add(datetime.combine(day, hours[0], tzinfo=profile.tz).astimezone(start.tzinfo))
    return sorted(p for p in points if p >= start)


def next_allowed(start: datetime, zones: tuple[str, ...] | list[str], rules: list[StateRule],
                 profile=None, *, extra_window: Window | None = None) -> datetime | None:
    """The first moment from `start` every row allows in every zone, inside
    the dealer's opening hours (with `profile`) and, with `extra_window`,
    inside that customer-local window too (a human call's 8:00-21:00).
    None when there's none in the next SEARCH_DAYS days."""
    for point in _candidates(start, zones, rules, profile):
        if not allowed(point, zones, rules):
            continue
        if extra_window and not all(extra_window[0] <= point.astimezone(ZoneInfo(z)).time() < extra_window[1]
                                    for z in zones):
            continue
        if profile is not None and not profile.is_open(point):
            continue
        return point
    return None


def describe(rules: list[StateRule]) -> str:
    return "; ".join(r.describe() for r in rules) + f" (rules {RULES_VERSION})"


def caps(rules: list[StateRule]) -> list[tuple[int, timedelta]]:
    return [r.cap for r in rules if r.cap]


# --- US federal holidays (5 U.S.C. § 6103) ---------------------------------------------
#
# Fixed-date holidays also count on their observed day (Saturday → Friday, Sunday → Monday):
# both days are treated as holidays, the stricter reading.

def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    last = (date(year, month + 1, 1) if month < 12 else date(year + 1, 1, 1)) - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


@lru_cache(maxsize=32)
def federal_holidays(year: int) -> dict[date, str]:
    fixed = {date(year, 1, 1): "New Year's Day", date(year, 6, 19): "Juneteenth",
             date(year, 7, 4): "Independence Day", date(year, 11, 11): "Veterans Day",
             date(year, 12, 25): "Christmas Day"}
    days: dict[date, str] = dict(fixed)
    for day, name in fixed.items():
        if day.weekday() == 5:
            days.setdefault(day - timedelta(days=1), f"{name} (observed)")
        elif day.weekday() == 6:
            days.setdefault(day + timedelta(days=1), f"{name} (observed)")
    # Next year's New Year's Day on a Saturday is observed on 31 December of this year.
    if date(year + 1, 1, 1).weekday() == 5:
        days.setdefault(date(year, 12, 31), "New Year's Day (observed)")
    days.update({
        _nth_weekday(year, 1, 0, 3): "Martin Luther King Jr. Day",
        _nth_weekday(year, 2, 0, 3): "Washington's Birthday",
        _last_weekday(year, 5, 0): "Memorial Day",
        _nth_weekday(year, 9, 0, 1): "Labor Day",
        _nth_weekday(year, 10, 0, 2): "Columbus Day",
        _nth_weekday(year, 11, 3, 4): "Thanksgiving Day",
    })
    return days


def is_federal_holiday(day: date) -> bool:
    return day in federal_holidays(day.year)


# --- State holidays (PLAN_4 stream X1 item 10; counsel to confirm the lists) -----------------------------

def _easter(year: int) -> date:
    """Western Easter Sunday (anonymous Gregorian algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month, day = divmod(h + m - 7 * n + 114, 31)
    return date(year, month, day + 1)


@lru_cache(maxsize=64)
def state_holidays(state: str, year: int) -> dict[date, str]:
    """The state's own legal holidays that its no-holiday rule adds to the federal calendar.

    - RI (R.I. Gen. Laws § 25-1-1): Victory Day, the second Monday in August.
    - LA (La. R.S. 1:55): Mardi Gras, Good Friday, All Saints' Day (1 Nov). Mardi Gras is a legal holiday in
      some parishes only; applied statewide, the stricter reading.
    - AL (Ala. Code § 1-3-8): Mardi Gras (Baldwin and Mobile counties; applied statewide), Confederate Memorial
      Day (fourth Monday in April), Jefferson Davis' Birthday (first Monday in June). Robert E. Lee Day and
      Washington / Jefferson Day fall on federal holidays already.
    STRICTEST (an unknown state) uses every one of them."""
    easter = _easter(year)
    days: dict[str, dict[date, str]] = {
        "RI": {_nth_weekday(year, 8, 0, 2): "Victory Day"},
        "LA": {easter - timedelta(days=47): "Mardi Gras", easter - timedelta(days=2): "Good Friday",
               date(year, 11, 1): "All Saints' Day"},
        "AL": {easter - timedelta(days=47): "Mardi Gras", _nth_weekday(year, 4, 0, 4): "Confederate Memorial Day",
               _nth_weekday(year, 6, 0, 1): "Jefferson Davis' Birthday"},
    }
    if state == "STRICTEST":
        return {d: n for rows in days.values() for d, n in rows.items()}
    return days.get(state, {})


def is_state_holiday(day: date, state: str) -> bool:
    return day in state_holidays(state, day.year)
