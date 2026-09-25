"""Checks and normalises one slot value (Validate step, check 2 of 4).

A value either comes back normalised ("60k" -> 60000, "yep" -> True,
"asap" -> "now") or is rejected with a reason. The AI's raw output never
reaches the database without passing through here.
"""

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from upsell_agent import clock
from upsell_agent.slots.schema import SlotDef

MAX_TEXT = 80
MAX_MILEAGE = 500_000
MAX_MONEY = 500_000
MIN_YEAR = 1980

_TRUE = {"true", "yes", "y", "yeah", "yep", "sure", "i do", "have one"}
_FALSE = {"false", "no", "n", "nope", "none", "no trade", "don't", "do not"}

# Synonyms per enum slot, on top of the literal choices.
_ENUM_SYNONYMS: dict[str, dict[str, str]] = {
    "interest.new_or_used": {"brand new": "new", "pre-owned": "used", "preowned": "used", "certified": "used",
                             "cpo": "used", "either": "either", "both": "either", "doesn't matter": "either"},
    "interest.timeline": {"asap": "now", "right away": "now", "today": "now", "immediately": "now",
                          "this weekend": "this_week", "this week": "this_week", "this month": "this_month",
                          "next month": "1_3_months", "a couple months": "1_3_months",
                          "in a few months": "1_3_months", "1-3 months": "1_3_months",
                          "later this year": "3_plus_months", "next year": "3_plus_months",
                          "6 months": "3_plus_months", "just browsing": "just_browsing",
                          "just looking": "just_browsing", "not sure": "just_browsing"},
    "interest.lead_type": {"buy": "sales", "buying": "sales", "shopping": "sales", "purchase": "sales",
                           "trade": "trade_in", "trade-in": "trade_in", "sell": "trade_in", "selling": "trade_in",
                           "repair": "service", "maintenance": "service", "oil change": "service"},
    "trade_in.condition": {"great": "excellent", "like new": "excellent", "mint": "excellent",
                           "very good": "good", "ok": "fair", "okay": "fair", "average": "fair",
                           "rough": "poor", "bad": "poor", "needs work": "poor"},
    "contact.best_time": {"mornings": "morning", "am": "morning", "afternoons": "afternoon",
                          "evenings": "evening", "night": "evening", "after work": "evening",
                          "weekends": "weekend", "saturday": "weekend", "sunday": "weekend",
                          "any time": "anytime", "whenever": "anytime"},
    "contact.preferred_channel": {"text": "sms", "texting": "sms", "phone": "sms", "e-mail": "email", "mail": "email"},
}


@dataclass(frozen=True)
class Validated:
    ok: bool
    value: Any = None
    reason: str = ""


def _number(raw: Any) -> float | None:
    """'60k', '60,000 miles', '$35.5k', 60000 -> float."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip().lower().replace(",", "").replace("$", "")
    match = re.search(r"(\d+(?:\.\d+)?)\s*(k|thousand)?\b", text)
    if not match:
        return None
    value = float(match.group(1))
    return value * 1000 if match.group(2) else value


def validate(defn: SlotDef, raw: Any) -> Validated:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return Validated(False, reason="empty value")

    if defn.kind == "year":
        number = _number(raw)
        max_year = clock.now().year + 1
        if number is None or not number.is_integer():
            return Validated(False, reason=f"{raw!r} is not a year")
        if not MIN_YEAR <= number <= max_year:
            return Validated(False, reason=f"year {int(number)} outside {MIN_YEAR}-{max_year}")
        return Validated(True, int(number))

    if defn.kind in ("mileage", "money"):
        number = _number(raw)
        limit = MAX_MILEAGE if defn.kind == "mileage" else MAX_MONEY
        if number is None:
            return Validated(False, reason=f"{raw!r} is not a number")
        if not 0 <= number <= limit:
            return Validated(False, reason=f"{int(number)} outside 0-{limit:,}")
        return Validated(True, round(number))

    if defn.kind == "bool":
        if isinstance(raw, bool):
            return Validated(True, raw)
        text = str(raw).strip().lower()
        if text in _TRUE:
            return Validated(True, True)
        if text in _FALSE:
            return Validated(True, False)
        return Validated(False, reason=f"{raw!r} is not yes/no")

    if defn.kind == "enum":
        text = str(raw).strip().lower().replace("_", " ")
        for choice in defn.choices:
            if text == choice.replace("_", " "):
                return Validated(True, choice)
        synonyms = _ENUM_SYNONYMS.get(defn.path, {})
        if text in synonyms:
            return Validated(True, synonyms[text])
        return Validated(False, reason=f"{raw!r} is not one of {', '.join(defn.choices)}")

    if defn.kind == "date":
        if isinstance(raw, datetime):
            return Validated(True, raw.date().isoformat())
        if isinstance(raw, date):
            return Validated(True, raw.isoformat())
        try:
            return Validated(True, datetime.fromisoformat(str(raw).strip()).date().isoformat())
        except ValueError:
            return Validated(False, reason=f"{raw!r} is not a date")

    text = re.sub(r"\s+", " ", str(raw)).strip()
    if len(text) > MAX_TEXT:
        return Validated(False, reason=f"longer than {MAX_TEXT} characters")
    return Validated(True, text)
