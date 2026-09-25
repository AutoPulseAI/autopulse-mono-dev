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
- `ask_hint`   what to ask for, in plain words (internal: traces, templates)
- `customer_question` / `explanation`  (MASTER_PLAN_2 Phase 7) how to ask it
               in plain English, and one line on why we ask and what it means,
               with an example. Compose uses these; "what do you mean?" gets the
               explanation. No digits in them: the guard would call any number
               the customer never gave an invention.

The repeating groups in §8.1 (several vehicles, many service visits) are
collapsed to the customer's primary vehicle and their latest service visit
and appointment: that is what a conversation asks about. The full history
stays in Customer 360.
"""

from dataclasses import dataclass, field, replace
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
    customer_question: str = ""
    explanation: str = ""
    # Taken from what the customer says even though it's never asked for
    # directly (priority None): the date they need the vehicle (MASTER_PLAN_2 Phase 8).
    volunteered: bool = False

    @property
    def extractable(self) -> bool:
        return self.priority is not None or self.volunteered


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
    # The customer's words ("tomorrow", "next Friday at 3") resolved to a date in
    # code (slots/dates.py); it also sets the timeline.
    SlotDef("interest.needed_by", "When they need it", "interest", "date", "lead", None, 30 * DAYS,
            volunteered=True),
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

# How each detail we ask for is put to a customer (MASTER_PLAN_2 Phase 7).
# Plain English, one question, no dealership jargon, no digits.
CUSTOMER_WORDING: dict[str, tuple[str, str]] = {
    "interest.lead_type": (
        "Are you looking to buy a vehicle, trade one in, or book a service?",
        ("This tells me who on our team can help you best, like our sales team for buying or our service team "
         "for repairs.")),
    "interest.new_or_used": (
        "Are you looking for a new or a used vehicle?",
        ("New means nobody has owned it before. Used means it had an owner before and usually costs less. "
         "Either is fine too.")),
    "interest.model": (
        "Which vehicle do you have in mind?",
        "Just the kind of car you'd like, for example a Toyota RAV4 or a small SUV. It helps us find good options."),
    "interest.budget": (
        "Roughly how much would you like to spend? A monthly amount is fine too.",
        "A rough price, or a monthly amount you're comfortable with, helps us show you vehicles that fit."),
    "interest.monthly_payment": (
        "What monthly payment would work for you?",
        "That's the amount you'd be happy to pay each month if you finance or lease."),
    "interest.timeline": (
        "When are you hoping to get your next vehicle?",
        "Just a rough idea, for example this week, next month, or you're only looking for now."),
    "interest.service_needed": (
        "What does your vehicle need done?",
        "For example an oil change, new tires, or a noise you'd like us to check."),
    "trade_in.has_trade": (
        "Do you have a vehicle you'd like to trade in?",
        "A trade-in means you give us your current car as part of the payment for the next one."),
    "trade_in.year": (
        "What year, make and model is your trade-in?",
        "For example a Honda Civic and the year it was made. It helps us work out what your car is worth."),
    "trade_in.make": (
        "What year, make and model is your trade-in?",
        "For example a Honda Civic and the year it was made. It helps us work out what your car is worth."),
    "trade_in.model": (
        "What year, make and model is your trade-in?",
        "For example a Honda Civic and the year it was made. It helps us work out what your car is worth."),
    "trade_in.mileage": (
        "About how many miles are on your trade-in?",
        "You can see it on the dashboard, and a rough number is fine. It helps us work out what your car is worth."),
    "trade_in.condition": (
        "How would you describe its condition: excellent, good, fair or poor?",
        ("Excellent means it looks and runs like new. Good means small signs of use. Fair means some dents or "
         "repairs. Poor means it needs a lot of work.")),
    "trade_in.payoff": (
        "Do you still owe money on it, and if so, about how much?",
        "If you still have a car loan, what's left to pay changes how the trade-in works. It's fine to say no."),
    "vehicle.year": (
        "What year, make and model is your vehicle?",
        "For example a Toyota Camry and the year it was made, so we get the right parts and service."),
    "vehicle.make": (
        "What year, make and model is your vehicle?",
        "For example a Toyota Camry and the year it was made, so we get the right parts and service."),
    "vehicle.model": (
        "What year, make and model is your vehicle?",
        "For example a Toyota Camry and the year it was made, so we get the right parts and service."),
    "vehicle.mileage": (
        "About how many miles are on your vehicle?",
        "You can see it on the dashboard, and a rough number is fine. What your car needs depends on it."),
    "contact.best_time": (
        "What time of day is best to reach you?",
        "For example mornings, evenings or weekends. Then we can reach you when it suits you."),
}
SLOTS = [replace(s, customer_question=CUSTOMER_WORDING[s.path][0], explanation=CUSTOMER_WORDING[s.path][1])
         if s.path in CUSTOMER_WORDING else s for s in SLOTS]

SCHEMA: dict[str, SlotDef] = {slot.path: slot for slot in SLOTS}
GROUP_ORDER: list[str] = ["interest", "trade_in", "vehicle", "service", "appointment", "contact"]
GROUP_LABELS: dict[str, str] = {
    "interest": "What they want now", "trade_in": "Trade-in", "vehicle": "Vehicle owned",
    "service": "Service history", "appointment": "Appointments", "contact": "Contact",
}
