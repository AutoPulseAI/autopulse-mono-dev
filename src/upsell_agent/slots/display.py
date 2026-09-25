"""Slot values as a customer reads them (MASTER_PLAN_2 Phases 6 and 8):
"$35,000", "60,000 miles", "used", "Saturday, September 27 (tomorrow)" -
never internal codes like "this_week" or "2026-09-27".

Used for what the AI tells a customer it knows about them, for confirmations,
and by the guard, which accepts the numbers in these texts.
"""

from datetime import date, datetime
from typing import Any

from upsell_agent.slots.schema import SCHEMA, SlotDef

_ENUM_WORDS = {
    "interest.timeline": {"now": "right away", "this_week": "this week", "this_month": "this month",
                          "1_3_months": "in 1 to 3 months", "3_plus_months": "in more than 3 months",
                          "just_browsing": "just browsing"},
    "interest.lead_type": {"sales": "shopping for a vehicle", "trade_in": "trading in a vehicle",
                           "service": "booking service"},
    "contact.preferred_channel": {"sms": "text message", "email": "email"},
}


def plain_date(value: str | date | datetime, today: date | None = None) -> str:
    """"Saturday, September 27" (+ " at 3:00 PM"), with "(today)" / "(tomorrow)"
    when `today` is given and it applies."""
    if isinstance(value, str):
        value = datetime.fromisoformat(value) if "T" in value else date.fromisoformat(value)
    day = value.date() if isinstance(value, datetime) else value
    text = f"{day:%A}, {day:%B} {day.day}"
    if isinstance(value, datetime):
        text += f" at {value:%I:%M %p}".replace(" 0", " ")
    if today is not None:
        delta = (day - today).days
        if delta == 0:
            text += " (today)"
        elif delta == 1:
            text += " (tomorrow)"
    return text


def display_value(defn: SlotDef | None, value: Any, today: date | None = None) -> str:
    if value is None:
        return ""
    if defn is None:
        return str(value)
    if defn.kind == "bool":
        return "yes" if value else "no"
    if defn.kind == "money":
        return f"${float(value):,.0f}"
    if defn.kind == "mileage":
        return f"{float(value):,.0f} miles"
    if defn.kind == "date":
        try:
            return plain_date(str(value), today)
        except ValueError:
            return str(value)
    if defn.kind == "enum":
        return _ENUM_WORDS.get(defn.path, {}).get(str(value), str(value).replace("_", " "))
    return str(value)


def about_customer(slots: list[dict[str, Any]], today: date | None = None) -> dict[str, list[dict[str, str]]]:
    """What we may say we know about the customer: confirmed values (theirs, or
    from the dealership's records) and, separately, values still to confirm.
    Nothing guessed, nothing stale."""
    known, unconfirmed = [], []
    for slot in slots:
        if slot.get("value") in (None, ""):
            continue
        entry = {"label": slot["label"], "value": display_value(SCHEMA.get(slot["path"]), slot["value"], today),
                 "from": "our records" if slot.get("source") == "platform" else "you told us"}
        if slot.get("state") == "filled":
            known.append(entry)
        elif slot.get("state") == "needs_confirming":
            unconfirmed.append(entry)
    return {"known": known, "unconfirmed": unconfirmed}
