"""The owner life cycle for every DealerVault sale (client, 8 Oct 2026 meeting: "we are going to touch them at
every point in the life cycle" - the Sales Life Cycle page of the dealer deck).

The SOLD - DELIVERED lifecycle (scheduler/sold_lifecycles.py) covers a car sold on a CRM lead. This covers every
car in the dealer's DMS: DealerVault's sales file (the platform's `deals`) gives the delivery date, the deal type,
the term and the buyer's birth date, and these touches follow from it:

    touch            when                                        source field(s)
    birthday         every year on the month/day (never the year) Birth Date
    anniversary      years 1-10 after delivery                    Delivery Date
    first_30         Day 30: features, Bluetooth, apps            Delivery Date
    review_referral  Day 14: a review, and who's next             Delivery Date
    first_90         Day 85: first 90 days check-in               Delivery Date
    lease_end        90 days before the lease ends                Deal Type (lease), Term, First Pay / Contract Date
    payoff           the month the finance contract ends          Deal Type (finance), Term, Amount Financed
    tip              every 60 days in year 1, then every 90       Delivery Date
    declined_service 14 days after a repair order closed with      the RO's Recommendations (DealerVault service
                     recommendations the customer didn't do       file), quoted word for word

Day counts are AutoPulse's defaults until the client sets their own (OWNER_TOUCH_DAYS); tell Betsy.

Every message is fixed wording, never written by the AI, and never states a birth year, an age, a price, a
payoff amount or an open recall (recalls are service-only: agent/recalls.py). Nothing here touches the database
or the clock.
"""

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from upsell_agent.agent import sold_delivered
from upsell_agent.integrations.customer360 import parse_loose_date

TOUCH_BIRTHDAY = "birthday"
TOUCH_ANNIVERSARY = "anniversary"
TOUCH_FIRST_30 = "first_30"
TOUCH_REVIEW = "review_referral"
TOUCH_FIRST_90 = "first_90"
TOUCH_LEASE_END = "lease_end"
TOUCH_PAYOFF = "payoff"
TOUCH_TIP = "tip"
TOUCH_DECLINED = "declined_service"  # service not sold: the technicians' recommendations on a repair order
VEHICLE_TOUCHES = (TOUCH_ANNIVERSARY, TOUCH_FIRST_30, TOUCH_REVIEW, TOUCH_FIRST_90, TOUCH_LEASE_END, TOUCH_PAYOFF,
                   TOUCH_TIP)
ALL_TOUCHES = (TOUCH_BIRTHDAY, *VEHICLE_TOUCHES, TOUCH_DECLINED)

# Defaults (client to confirm): days after delivery, and days before the lease ends.
OWNER_TOUCH_DAYS = {TOUCH_REVIEW: 14, TOUCH_FIRST_30: 30, TOUCH_FIRST_90: 85}
LEASE_END_LEAD_DAYS = 90
DECLINED_FOLLOWUP_DAYS = 14  # after the repair order closed
DECLINED_MAX_ITEMS = 3
TIP_EVERY_DAYS_YEAR_1 = 60
TIP_EVERY_DAYS_AFTER = 90
TIPS_FOR_YEARS = 5
# A touch more than this late (the import arrived late, the AI was off) is skipped, never sent late.
LATE_GRACE = timedelta(days=21)

DEAL_LEASE, DEAL_FINANCE, DEAL_CASH, DEAL_UNKNOWN = "lease", "finance", "cash", "unknown"


def _date(raw: Any) -> date | None:
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    parsed = parse_loose_date(raw) if isinstance(raw, str) else None
    return parsed.date() if parsed else None


def _number(raw: Any) -> float | None:
    if isinstance(raw, int | float):
        return float(raw)
    if isinstance(raw, str):
        cleaned = re.sub(r"[^0-9.\-]", "", raw)
        try:
            return float(cleaned) if cleaned else None
        except ValueError:
            return None
    return None


def add_months(day: date, months: int) -> date:
    year, month = divmod(day.month - 1 + months, 12)
    return sold_delivered._on(day.year + year, month + 1, day.day)


@dataclass(frozen=True)
class OwnerDeal:
    """What the touches need from one DealerVault deal."""
    deal_number: str
    vin: str | None
    year: str | None
    make: str | None
    model: str | None
    delivery_date: date | None
    deal_type: str
    term_months: int | None
    contract_start: date | None

    @property
    def contract_end(self) -> date | None:
        if self.deal_type not in (DEAL_LEASE, DEAL_FINANCE) or not self.term_months or not self.contract_start:
            return None
        return add_months(self.contract_start, self.term_months)

    def vehicle(self) -> dict[str, Any]:
        return {"vin": self.vin, "year": self.year, "make": self.make, "model": self.model}


def classify(deal_type: Any, sale_type: Any, amount_financed: Any, term: Any) -> str:
    words = f"{deal_type or ''} {sale_type or ''}".lower()
    if "lease" in words:
        return DEAL_LEASE
    if "cash" in words:
        return DEAL_CASH
    financed = _number(amount_financed) or 0
    if financed > 0 and (_number(term) or 0) > 0:
        return DEAL_FINANCE
    if "financ" in words or "retail" in words and (_number(term) or 0) > 0:
        return DEAL_FINANCE
    return DEAL_UNKNOWN


def read_deal(row: dict[str, Any]) -> OwnerDeal:
    term = _number(row.get("Term"))
    first_pay = _date(row.get("First Pay Date"))
    # The contract runs from a month before the first payment; else from the contract / delivery date.
    start = add_months(first_pay, -1) if first_pay else _date(row.get("Contract Date")) or _date(
        row.get("Delivery Date"))
    return OwnerDeal(
        deal_number=str(row.get("deal_number") or row.get("Deal Number") or ""),
        vin=(row.get("vin") or row.get("VIN") or None),
        year=str(row.get("Year") or row.get("VIN Explosion Year") or "").strip() or None,
        make=str(row.get("Make") or row.get("VIN Explosion Make") or "").strip().title() or None,
        model=str(row.get("Model") or row.get("VIN Explosion Model") or "").strip() or None,
        delivery_date=_date(row.get("Delivery Date")) or _date(row.get("Contract Date")),
        deal_type=classify(row.get("Deal Type"), row.get("Sale Type"), row.get("Amount Financed"), row.get("Term")),
        term_months=int(term) if term and term > 0 else None,
        contract_start=start)


def is_delivered(row: dict[str, Any]) -> bool:
    """A deal that went through: a delivery date, and no unwound / cancelled status."""
    status = str(row.get("Deal Status") or "").lower()
    if any(word in status for word in ("unwind", "unwound", "cancel", "void", "dead", "backed out")):
        return False
    return _date(row.get("Delivery Date")) is not None


def vehicle_touch_dates(deal: OwnerDeal, tz) -> list[tuple[str, str, datetime]]:
    """Every vehicle touch this deal will ever have: (touch, dedupe key, due at the touch hour)."""
    out: list[tuple[str, str, datetime]] = []
    delivered = deal.delivery_date
    if delivered is None:
        return out
    at = lambda d: sold_delivered.at_touch_hour(d, tz)
    for touch, days in OWNER_TOUCH_DAYS.items():
        out.append((touch, touch, at(delivered + timedelta(days=days))))
    for year in range(1, sold_delivered.ANNIVERSARY_YEARS + 1):
        out.append((TOUCH_ANNIVERSARY, f"{TOUCH_ANNIVERSARY}:{year}",
                    at(sold_delivered._on(delivered.year + year, delivered.month, delivered.day))))
    day, n = delivered + timedelta(days=TIP_EVERY_DAYS_YEAR_1 + 45), 0  # the first tip after the first 90 days
    while day < sold_delivered._on(delivered.year + TIPS_FOR_YEARS, delivered.month, delivered.day):
        out.append((TOUCH_TIP, f"{TOUCH_TIP}:{n}", at(day)))
        n += 1
        day += timedelta(days=TIP_EVERY_DAYS_YEAR_1 if day < delivered + timedelta(days=365)
                         else TIP_EVERY_DAYS_AFTER)
    end = deal.contract_end
    if end and deal.deal_type == DEAL_LEASE:
        out.append((TOUCH_LEASE_END, f"{TOUCH_LEASE_END}:{end.isoformat()}",
                    at(end - timedelta(days=LEASE_END_LEAD_DAYS))))
    if end and deal.deal_type == DEAL_FINANCE:
        out.append((TOUCH_PAYOFF, f"{TOUCH_PAYOFF}:{end.isoformat()}", at(end)))
    return sorted(out, key=lambda t: t[2])


def next_vehicle_touch(deal: OwnerDeal, *, sent: set[str], now: datetime, tz,
                       skip: frozenset[str] = frozenset()) -> tuple[str, str, datetime] | None:
    """The next touch not yet sent and not too late; touches in `skip` are covered elsewhere (a CRM-sold car's
    anniversary is the SOLD - DELIVERED lifecycle's)."""
    for touch, key, due in vehicle_touch_dates(deal, tz):
        if touch in skip or key in sent or due + LATE_GRACE < now:
            continue
        return touch, key, due
    return None


_NOTHING = re.compile(r"^\s*(none|n/?a|no|-+|\.+|0)?\s*$", re.IGNORECASE)


def recommendations(ro: dict[str, Any]) -> list[str]:
    """The technicians' recommendations on a repair order, word for word (never invented or reworded): the parsed
    `service_operations[].recommendations`, else DealerVault's raw `Recommendations` column (| and ^ separated)."""
    found: list[str] = []
    for op in ro.get("service_operations") or []:
        found += [str(v) for v in (op.get("recommendations") or []) if isinstance(v, str)]
    if not found and isinstance(ro.get("Recommendations"), str):
        found = [v for group in ro["Recommendations"].split("|") for v in group.split("^")]
    out: list[str] = []
    for item in found:
        clean = " ".join(item.split()).strip(" .;,")
        if clean and not _NOTHING.match(clean) and clean.lower() not in (o.lower() for o in out):
            out.append(clean[:90])
    return out[:DECLINED_MAX_ITEMS]


def declined_due(ro: dict[str, Any], tz) -> datetime | None:
    closed = _date(ro.get("Close Date"))
    if closed is None:
        return None
    return sold_delivered.at_touch_hour(closed + timedelta(days=DECLINED_FOLLOWUP_DAYS), tz)


# --- The messages ----------------------------------------------------------------------------------------------------

# Every first message the AI sends a DMS customer says it is the AI (FTC; client, 8 Oct 2026).
def _sign(dealership: str | None) -> str:
    place = dealership or "the dealership"
    return f"\n\nThank you,\nNicole, the AI assistant at {place}"


def _sms_sign(dealership: str | None) -> str:
    return f" - Nicole, the AI assistant at {dealership}" if dealership else " - Nicole, the AI assistant"


TIPS = (
    ("Service tip", ("Check your tire pressure once a month - the right pressure is on the sticker inside the "
                    "driver's door. It saves fuel and your tires.")),
    ("Ownership tip", ("Keep your registration, insurance card and roadside assistance number in the glovebox, "
                      "and a photo of each on your phone.")),
    ("Safety tip", ("Kids' car seats should be checked every time they grow - most fire stations will check the "
                   "fit for free.")),
    ("Service tip", ("Wiper blades usually last 6 to 12 months. If they streak or squeak, it's time - we can swap "
                    "them in minutes.")),
    ("Ownership tip", "A wash and wax before winter protects the paint from road salt."),
    ("Safety tip", "Keep a small kit in the trunk: phone charger, flashlight, jumper cables, water and a blanket."),
)


def render(touch: str, *, first_name: str | None, dealership: str | None, vehicle: dict | None,
           tip_number: int = 0, year: int = 1, items: list[str] | None = None) -> dict[str, str]:
    hi = f"Hi {first_name}! " if first_name else "Hi! "
    place = dealership or "our dealership"
    label = sold_delivered.vehicle_label(vehicle) or "vehicle"
    model = sold_delivered.model_label(vehicle) or "vehicle"
    if touch == TOUCH_BIRTHDAY:
        body = f"Happy Birthday{', ' + first_name if first_name else ''}! Everyone at {place} wishes you a " \
               f"fantastic day!"
        subject = "Happy Birthday!"
    elif touch == TOUCH_ANNIVERSARY:
        body = (f"{hi}Can you believe it's been {year} year{'s' if year > 1 else ''} with your {label}? Happy "
                f"anniversary from all of us at {place}! If you're ever thinking about a second car or trading "
                f"up, just reply here.")
        subject = f"Happy {sold_delivered._ordinal(year)} anniversary with your {label}!"
    elif touch == TOUCH_FIRST_30:
        body = (f"{hi}How are you enjoying your {model}? Did someone show you how to connect your phone, Bluetooth "
                f"and the car's app? If not, reply and we'll set up a quick visit with your salesperson to go "
                f"over everything.")
        subject = f"Getting the most out of your {model}"
    elif touch == TOUCH_REVIEW:
        body = (f"{hi}Thank you for choosing {place} for your {model}. Would you share a quick review of your "
                f"experience? And when you think of family and friends - who's next in line for a car? We'd love "
                f"to take care of them too.")
        subject = f"How did we do, {first_name}?" if first_name else "How did we do?"
    elif touch == TOUCH_FIRST_90:
        body = (f"{hi}It's almost 90 days with your {model}! Any questions about features, settings or your first "
                f"service? Just reply - we're here to help.")
        subject = f"Your first 90 days with your {model}"
    elif touch == TOUCH_LEASE_END:
        body = (f"{hi}Your {model} lease ends in about 3 months. Let's look at your options together - a new "
                f"lease, buying it out, or something new. Reply and we'll set a time that works for you.")
        subject = f"Your {model} lease ends soon - let's plan ahead"
    elif touch == TOUCH_PAYOFF:
        body = (f"{hi}Your {model} should be paid off around now - congratulations! If you're curious what it's "
                f"worth or thinking about what's next, just reply.")
        subject = "Congratulations - you paid off your car!"
    elif touch == TOUCH_TIP:
        title, tip = TIPS[tip_number % len(TIPS)]
        body = f"{hi}{title} from {place}: {tip}"
        subject = f"{title} for your {model}"
    elif touch == TOUCH_DECLINED:
        if not items:
            raise ValueError("a declined-service message needs the repair order's own recommendations")
        listed = "; ".join(items)
        body = (f"{hi}At your last service visit, our technicians recommended: {listed}. Would you like us to take "
                f"care of that? Reply and our service team will find a time that works for you.")
        subject = f"Recommended service for your {model}"
    else:
        raise ValueError(f"unknown owner touch {touch!r}")
    if BIRTH_YEAR.search(body):  # a guard against anything that would state an age or a birth year
        raise ValueError("an owner touch must never state a birth year or an age")
    return {"sms_text": body + _sms_sign(dealership), "email_subject": subject,
            "email_body": body + _sign(dealership)}


# A birth year or age in an outbound message ("born in 1980", "turning 45", "45th birthday"): never (client, 8 Oct
# 2026: "we don't need to discuss birth year ever"). Also used by guardrails/draft_guard.py on AI-written drafts.
BIRTH_YEAR = re.compile(r"\b(born\s+(in\s+)?(19|20)\d{2}|turn(ing|s)?\s+\d{1,3}\b|\d{1,3}(st|nd|rd|th)\s+birthday"
                        r"|\d{1,3}\s+years?\s+(old|young)|birth\s*year)", re.IGNORECASE)


def as_utc(day: date) -> datetime:
    return datetime.combine(day, datetime.min.time(), tzinfo=UTC)
