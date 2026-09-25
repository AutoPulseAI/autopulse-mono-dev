"""Every slot the AI collects, in one list (architecture §8.1, MASTER_PLAN_1
Stage 7). Adding a slot is adding a line here; nothing else hard-codes paths.

Each slot has:
- `kind`       how values are validated and normalised (slots/validators.py)
- `scope`      "customer" slots describe the person (their car, their trade)
               and carry over between leads; "lead" slots describe what they
               want this time
- `priority`   ask order, lowest first; None = never asked (only pre-filled
               from the platform or volunteered)
- `staleness`  how long a value stays current before it must be re-confirmed
               (stale counts as missing); None = never goes stale
- `ask_hint`   what to ask for, in plain words; Compose phrases the question

The repeating groups in §8.1 (several vehicles, many service visits) are
collapsed to the customer's primary vehicle and their latest service visit
and appointment: that is what a conversation asks about. The full history
stays in Customer 360.
"""

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Literal

Kind = Literal["year", "mileage", "money", "bool", "enum", "text", "date"]
Scope = Literal["customer", "lead"]
Group = Literal["interest", "trade_in", "vehicle", "service", "appointment", "contact"]


@dataclass(frozen=True)
class SlotDef:
    path: str
    label: str
    group: Group
    kind: Kind
    scope: Scope
    priority: int | None
    staleness: timedelta | None
    ask_hint: str = ""
    choices: tuple[str, ...] = field(default=())


DAYS = timedelta(days=1)

SLOTS: list[SlotDef] = [
    # --- What they want now (this lead) ---
    SlotDef("interest.lead_type", "What they're here for", "interest", "enum", "lead", 5, None,
            "whether you're shopping for a vehicle, trading one in, or booking service",
            ("sales", "trade_in", "service")),
    SlotDef("interest.new_or_used", "New or used", "interest", "enum", "lead", 10, 60 * DAYS,
            "whether you're looking at new or used", ("new", "used", "either")),
    SlotDef("interest.model", "Vehicle they want", "interest", "text", "lead", 20, 60 * DAYS,
            "which model you have in mind"),
    SlotDef("interest.budget", "Budget", "interest", "money", "lead", 30, 30 * DAYS,
            "roughly what budget you're working with (or a monthly payment)"),
    SlotDef("interest.monthly_payment", "Monthly payment", "interest", "money", "lead", 31, 30 * DAYS,
            "what monthly payment would work for you"),
    SlotDef("interest.timeline", "Timeline", "interest", "enum", "lead", 40, 30 * DAYS,
            "when you're hoping to be in a new vehicle",
            ("now", "this_week", "this_month", "1_3_months", "3_plus_months", "just_browsing")),
    SlotDef("interest.service_needed", "Service needed", "interest", "text", "lead", 45, 30 * DAYS,
            "what service the vehicle needs"),
    # --- Trade-in ---
    SlotDef("trade_in.has_trade", "Has a trade-in", "trade_in", "bool", "lead", 50, 90 * DAYS,
            "whether you have a vehicle to trade in"),
    SlotDef("trade_in.year", "Trade-in year", "trade_in", "year", "customer", 60, None,
            "the year, make and model of your trade-in"),
    SlotDef("trade_in.make", "Trade-in make", "trade_in", "text", "customer", 61, None,
            "the year, make and model of your trade-in"),
    SlotDef("trade_in.model", "Trade-in model", "trade_in", "text", "customer", 62, None,
            "the year, make and model of your trade-in"),
    SlotDef("trade_in.mileage", "Trade-in mileage", "trade_in", "mileage", "customer", 63, 30 * DAYS,
            "about how many miles are on it"),
    SlotDef("trade_in.condition", "Trade-in condition", "trade_in", "enum", "customer", 64, 90 * DAYS,
            "how you'd describe its condition (excellent, good, fair or poor)",
            ("excellent", "good", "fair", "poor")),
    SlotDef("trade_in.payoff", "Payoff owed", "trade_in", "money", "customer", 65, 14 * DAYS,
            "whether you still owe anything on it, and roughly how much"),
    # --- Vehicle they own (primary) ---
    SlotDef("vehicle.year", "Vehicle year", "vehicle", "year", "customer", 70, None,
            "the year, make and model of your vehicle"),
    SlotDef("vehicle.make", "Vehicle make", "vehicle", "text", "customer", 71, None,
            "the year, make and model of your vehicle"),
    SlotDef("vehicle.model", "Vehicle model", "vehicle", "text", "customer", 72, None,
            "the year, make and model of your vehicle"),
    SlotDef("vehicle.mileage", "Vehicle mileage", "vehicle", "mileage", "customer", 73, 30 * DAYS,
            "roughly how many miles are on it"),
    SlotDef("vehicle.trim", "Vehicle trim", "vehicle", "text", "customer", None, None),
    SlotDef("vehicle.purchase_date", "Bought on", "vehicle", "date", "customer", None, None),
    SlotDef("vehicle.purchased_from", "Bought from", "vehicle", "text", "customer", None, None),
    # --- Service history and appointments (from the platform) ---
    SlotDef("service.last_visit", "Last service visit", "service", "date", "customer", None, None),
    SlotDef("appointment.next_date", "Next appointment", "appointment", "date", "customer", None, None),
    # --- Contact ---
    SlotDef("contact.best_time", "Best time to reach", "contact", "enum", "customer", 90, 180 * DAYS,
            "what time of day works best for you",
            ("morning", "afternoon", "evening", "weekend", "anytime")),
    SlotDef("contact.preferred_channel", "Preferred channel", "contact", "enum", "customer", None, 180 * DAYS,
            choices=("sms", "email")),
]

SCHEMA: dict[str, SlotDef] = {slot.path: slot for slot in SLOTS}
GROUP_ORDER: list[str] = ["interest", "trade_in", "vehicle", "service", "appointment", "contact"]
GROUP_LABELS: dict[str, str] = {
    "interest": "What they want now", "trade_in": "Trade-in", "vehicle": "Vehicle owned",
    "service": "Service history", "appointment": "Appointments", "contact": "Contact",
}
