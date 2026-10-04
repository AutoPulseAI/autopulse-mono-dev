"""The SOLD - DELIVERED ownership lifecycle's own rules (MASTER_PLAN_4 D4, D7;
client spec docs/data/4/AutoPulse_SOLD_DELIVERED_Ownership_Retention_Workflow_FINAL (1).pdf).

    Day 3            post-delivery check-in + first service offer (§4)
    yearly           birthday, only with a verified month/day (§7)
    years 1-10       ownership anniversary: "Do you still have your [Model]?" (§8)
    on demand        maintenance / recall outreach from stream A4 (§5, §6; agent/ownership.py)

A service "yes" is a **request with notes for the service team, never a
booking** (client, 1 Oct 2026, scope Q16: "service appointments are offered in
this sow and notes taken in, but in the next sow availability will be able to
be read"). Trade / equity / repurchase is NEXT SOW (§13): the replacement-vehicle
answers are collected, never acted on.

Every message is fixed wording (the client's own intent lines), never written
by the AI: nothing here can invent a maintenance interval, a mileage, a recall
or an appointment time (§12).

Nothing here touches the database or the clock.
"""

import re
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from upsell_agent.agent.cadence import TOUCH_HOUR
from upsell_agent.integrations.customer360 import parse_loose_date

CHECKIN_AFTER_DAYS = 3
ANNIVERSARY_YEARS = 10

# --- Dates ----------------------------------------------------------------------------------------------------------


def _on(year: int, month: int, day: int) -> date:
    """`month/day` in `year`; Feb 29 falls on Feb 28 in a common year."""
    try:
        return date(year, month, day)
    except ValueError:
        return date(year, month, 28)


def at_touch_hour(day: date, tz) -> datetime:
    return datetime.combine(day, time(TOUCH_HOUR), tzinfo=tz)


def checkin_due(delivered_at: datetime, tz) -> datetime:
    """§4: "approximately 3 days after delivery", at the touch hour."""
    local = delivered_at.astimezone(tz)
    return at_touch_hour(local.date() + timedelta(days=CHECKIN_AFTER_DAYS), tz)


def anniversary_due(delivery_date: date, year: int, tz) -> datetime:
    """§8: "Using each vehicle's original delivery date", year 1-10."""
    return at_touch_hour(_on(delivery_date.year + year, delivery_date.month, delivery_date.day), tz)


def next_birthday(month: int, day: int, *, now: datetime, tz) -> datetime:
    """The next time the birthday message is due: this year's if its hour hasn't passed, else next year's."""
    local = now.astimezone(tz)
    due = at_touch_hour(_on(local.year, month, day), tz)
    if due <= now:
        due = at_touch_hour(_on(local.year + 1, month, day), tz)
    return due


# --- Birthday: verified month/day only (§7) --------------------------------------------------------------------------

# DealerVault's own column (aidmvcs-be-dev app/worker/dealervault/common/salesFields.js, serviceFields.js,
# appointmentFields.js: "Birth Date"), and the names a customer record may carry it under.
BIRTH_FIELDS = ("Birth Date", "birth_date", "birthDate", "date_of_birth", "dob", "DOB")


def _birth_value(record: dict | None) -> tuple[int, int] | None:
    for key in BIRTH_FIELDS:
        raw = (record or {}).get(key)
        parsed = raw if isinstance(raw, datetime) else parse_loose_date(raw) if isinstance(raw, str) else None
        if parsed is None:
            continue
        parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        # A DMS placeholder ("1/1/1900"), not a birthday.
        if parsed.month == 1 and parsed.day == 1 and parsed.year <= 1901:
            continue
        if parsed.year < 1900 or parsed.year > 2100:
            continue
        return parsed.month, parsed.day
    return None


def verified_birthday(customer: dict | None, records: list[dict]) -> dict[str, Any] | None:
    """The customer's birth month/day when an authorized source says so (§7: "Never infer/manufacture DOB").
    Source: DealerVault's `Birth Date` on the platform customer and its deals / repair orders / service
    appointments (client, 1 Oct 2026: "Birthdays come from dealer vault"). Two sources that disagree are not
    verified: no birthday message rather than the wrong day."""
    found: dict[tuple[int, int], list[str]] = {}
    for label, record in [("customer", customer), *[(r.get("_source") or "dealervault", r) for r in records]]:
        value = _birth_value(record)
        if value:
            found.setdefault(value, []).append(label)
    if len(found) != 1:
        return None
    (month, day), sources = next(iter(found.items()))
    return {"month": month, "day": day, "sources": sorted(set(sources))}


# --- The messages ----------------------------------------------------------------------------------------------------

def _hi(first_name: str | None) -> str:
    return f"Hi {first_name}" if first_name else "Hi there"


def _sign(dealership: str | None) -> str:
    return f"\n\nThank you,\n{dealership}" if dealership else "\n\nThank you"


def vehicle_label(vehicle: dict | None) -> str | None:
    """"2024 Toyota RAV4" from what the record has; None when it has nothing."""
    parts = [str((vehicle or {}).get(k)).strip() for k in ("year", "make", "model") if (vehicle or {}).get(k)]
    return " ".join(parts) or None


def model_label(vehicle: dict | None) -> str | None:
    return str((vehicle or {}).get("model") or "").strip() or None


def render_checkin(*, first_name: str | None, dealership: str | None, vehicle: dict | None,
                   first_service: dict | None, offer_service: bool) -> dict[str, str]:
    """The Day-3 check-in (§4's intent). The first service is named only when the maintenance data (stream A4,
    Vehicle Databases) gave it; otherwise it is offered in words, with no interval or mileage (§5: "Never invent
    maintenance requirements"). An existing appointment means no service offer (§4)."""
    label = vehicle_label(vehicle)
    car = f"your new {label}" if label else "your new vehicle"
    body = (f"{_hi(first_name)}, we hope you are enjoying {car}! Do you have any questions about your vehicle or "
            "anything we can help with?")
    if offer_service:
        service = (first_service or {}).get("name")
        what = f"your first recommended service ({service})" if service else "your first recommended service"
        body += (f" I can also get a request in for {what} now so it is already taken care of - just reply YES "
                 "with a day and time that suit you, and our service team will confirm it.")
    subject = f"How are you enjoying {car}?"
    return {"sms_text": body, "email_subject": subject[0].upper() + subject[1:], "email_body": body + _sign(dealership)}


def render_birthday(*, first_name: str | None, dealership: str | None) -> dict[str, str]:
    """§7's intent, word for word: a relationship message, never a sales solicitation."""
    who = f", {first_name}" if first_name else ""
    place = dealership or "our dealership"
    body = f"Happy Birthday{who}! Everyone at {place} wishes you a fantastic day!"
    return {"sms_text": body, "email_subject": "Happy Birthday!", "email_body": body + _sign(dealership)}


def render_anniversary(*, first_name: str | None, dealership: str | None, vehicle: dict | None,
                       year: int) -> dict[str, str]:
    """§8's core question, word for word."""
    label = vehicle_label(vehicle) or "vehicle"
    model = model_label(vehicle) or "vehicle"
    hi = f"Hi {first_name}! " if first_name else ""
    body = f"{hi}Happy anniversary with your {label}! Do you still have your {model}? Reply YES or NO."
    subject = f"Happy {_ordinal(year)} anniversary with your {label}!"
    return {"sms_text": body, "email_subject": subject, "email_body": body + _sign(dealership)}


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _pick(facts: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = facts.get(key)
        if isinstance(value, dict):
            value = value.get("name") or value.get("description")
        if isinstance(value, list):
            value = ", ".join(str(v.get("name") if isinstance(v, dict) else v) for v in value if v) or None
        if value not in (None, ""):
            return value
    return None


def normalize_service_facts(kind: str, facts: dict[str, Any]) -> dict[str, Any]:
    """Stream A4's facts (NHTSA's and Vehicle Databases' field names) read into the few things the message may
    say. A recall from A4 is VIN-specific NHTSA data by construction (its RECALL_DETECTED event), so the source
    defaults to NHTSA; nothing else is filled in."""
    out = {k: facts[k] for k in ("sms_text", "email_subject", "email_body") if facts.get(k)}
    if kind == "recall":
        out.update(recall_id=_pick(facts, "recall_id", "campaign_number", "nhtsa_campaign_number",
                                   "NHTSACampaignNumber", "campaign"),
                   source=_pick(facts, "source") or "NHTSA",
                   component=_pick(facts, "component", "Component"),
                   summary=_pick(facts, "summary", "Summary"))
    else:
        out.update(service=_pick(facts, "service", "service_name", "next_service", "services", "name"),
                   due=_pick(facts, "due", "due_date", "due_by", "due_at"))
    return {k: v for k, v in out.items() if v not in (None, "")}


def render_service_outreach(kind: str, facts: dict[str, Any], *, first_name: str | None, dealership: str | None,
                            vehicle: dict | None) -> dict[str, str] | None:
    """A maintenance or recall message (stream A4, §5-§6), built only from the facts it was given. The caller may
    pass its own approved wording (`sms_text`, `email_subject`, `email_body`). None when the facts are too thin to
    say anything true."""
    if facts.get("sms_text"):
        body = str(facts["sms_text"])
        return {"sms_text": body, "email_subject": str(facts.get("email_subject") or "A note about your vehicle"),
                "email_body": str(facts.get("email_body") or body + _sign(dealership))}
    car = vehicle_label(vehicle) or "your vehicle"
    car = f"your {car}" if vehicle_label(vehicle) else car
    if kind == "recall":
        # Never a recall without VIN-specific authoritative support (§6): the caller says which one and where from.
        if not facts.get("recall_id") or not facts.get("source"):
            return None
        what = facts.get("component") or facts.get("summary") or "a safety recall"
        body = (f"{_hi(first_name)}, {facts['source']} shows an open safety recall ({facts['recall_id']}) for "
                f"{car}: {what}. Would you like us to get a service request in for it? Reply YES with a day and "
                "time that suit you, and our service team will confirm it.")
        subject = "An open safety recall for your vehicle"
    else:
        service = facts.get("service")
        if not service:
            return None
        when = f" (due {facts['due']})" if facts.get("due") else ""
        body = (f"{_hi(first_name)}, {car} is coming up on its {service}{when}. Would you like us to get a "
                "service request in? Reply YES with a day and time that suit you, and our service team will "
                "confirm it.")
        subject = "Your vehicle's next service"
    return {"sms_text": body, "email_subject": subject, "email_body": body + _sign(dealership)}


# --- Reading the customer's answers ---------------------------------------------------------------------------------

_YES = re.compile(r"^\s*(y|yes|yep|yeah|yup|still do|i do|sure|of course|absolutely|still have (?:it|her|him))\b",
                  re.IGNORECASE)
_NO = re.compile(r"^\s*(n|no|nope|nah|not anymore|no longer|i don'?t|sold it|traded it|got rid of it|"
                 r"we sold|i sold|we traded|i traded)\b|\b(sold it|traded it in|no longer (?:have|own)|"
                 r"don'?t have it|totaled|totalled)\b", re.IGNORECASE)


def classify_ownership_answer(text: str) -> str:
    """"yes" / "no" / "other" to "Do you still have your [Model]?" (§8). Anything that isn't clearly one or the
    other changes nothing ("Do not change ownership ... solely because the customer did not respond")."""
    body = (text or "").strip()
    if _NO.search(body):
        return "no"
    if _YES.search(body):
        return "yes"
    return "other"


_SERVICE_LATER = re.compile(r"\b(later|not (?:yet|now|right now)|no thanks|no thank you|maybe (?:later|another)|"
                            r"i'?ll let you know|not at the moment|nah|^no\b)", re.IGNORECASE)
_SERVICE_YES = re.compile(r"^\s*(y|yes|yep|yeah|sure|please|ok(?:ay)?|sounds good|let'?s do it|book it|"
                          r"schedule it)\b|\b(set (?:it|that) up|get (?:it|me) (?:in|scheduled|booked))\b",
                          re.IGNORECASE)


def classify_service_answer(text: str) -> str:
    """"yes" / "later" / "other" to a service offer (§4: "LATER/NOT YET -> do not pressure")."""
    body = (text or "").strip()
    if _SERVICE_LATER.search(body):
        return "later"
    if _SERVICE_YES.search(body):
        return "yes"
    return "other"


_YEAR = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")
_NOTHING = re.compile(r"\b(nothing|no car|don'?t (?:drive|have (?:one|a car))|not driving|none|n/a)\b",
                      re.IGNORECASE)
# Words after a make that aren't part of the model ("a Honda Civic now", "a Ford and ...").
_FILLER = {"now", "these", "today", "and", "for", "about", "since", "right", "that", "which", "with", "but", "i",
           "it", "lol", "thanks", "currently", "nowadays", "at", "from", "in", "days"}
KNOWN_MAKES = ("acura", "alfa romeo", "audi", "bmw", "buick", "cadillac", "chevrolet", "chevy", "chrysler", "dodge",
               "fiat", "ford", "genesis", "gmc", "honda", "hyundai", "infiniti", "jaguar", "jeep", "kia",
               "land rover", "lexus", "lincoln", "mazda", "mercedes-benz", "mercedes", "mini", "mitsubishi", "nissan",
               "polestar", "porsche", "ram", "rivian", "subaru", "tesla", "toyota", "volkswagen", "vw", "volvo")


def parse_current_vehicle(text: str) -> dict[str, Any] | None:
    """Year / Make / Model from "What are you driving now?" (§8: "Capture Year / Make / Model when provided").
    Only what the customer wrote: a part that isn't there stays None. `{}` means "nothing" (they don't drive
    one now); None means we couldn't read a vehicle at all (their words are still kept as `reported_text`)."""
    body = (text or "").strip()
    if _NOTHING.search(body):
        return {}
    year_match = _YEAR.search(body)
    lower = body.lower()
    make = next((m for m in sorted(KNOWN_MAKES, key=len, reverse=True) if re.search(rf"\b{re.escape(m)}\b", lower)),
                None)
    if not make and not year_match:
        return None
    model = None
    if make:
        after = re.split(rf"\b{re.escape(make)}\b", body, maxsplit=1, flags=re.IGNORECASE)[1]
        words = []
        for word in re.findall(r"[A-Za-z0-9-]+", after)[:2]:
            if word.lower() in _FILLER:
                break
            words.append(word)
        model = " ".join(words) or None
    pretty = {"chevy": "Chevrolet", "vw": "Volkswagen", "bmw": "BMW", "gmc": "GMC", "mini": "MINI", "ram": "RAM",
              "mercedes": "Mercedes-Benz"}
    return {"year": int(year_match.group(1)) if year_match else None,
            "make": pretty.get(make, make.title()) if make else None, "model": model}


_DURATION = re.compile(r"\b(\d+|a|an|one|two|three|four|five|six|a few|few|couple(?: of)?)\s+"
                       r"(day|week|month|year)s?\b", re.IGNORECASE)
_WORD_NUMBERS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "a few": 3,
                 "few": 3, "couple": 2, "couple of": 2}


def parse_ownership_duration(text: str, *, now: datetime) -> dict[str, Any]:
    """"About how long have you had your [Model]?" (§8): the customer's own words, and an approximate
    acquisition date when they gave a number we can read."""
    out: dict[str, Any] = {"reported_ownership_duration": (text or "").strip()[:200] or None,
                           "approx_acquisition_date": None}
    m = _DURATION.search(text or "")
    if m:
        raw = m.group(1).lower()
        n = int(raw) if raw.isdigit() else _WORD_NUMBERS.get(raw, 1)
        days = {"day": 1, "week": 7, "month": 30, "year": 365}[m.group(2).lower()] * n
        out["approx_acquisition_date"] = (now - timedelta(days=days)).date().isoformat()
    return out
