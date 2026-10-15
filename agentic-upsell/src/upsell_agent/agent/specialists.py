"""The multi-agent setup (client, 8 Oct 2026 meeting: "we have different agents ... that become experts at those
jobs. Whether the customer is talking about price / payment, that price / payment agent chimes in. Credit, the
credit agent. Trade, and so on"; dealer deck: Sales, Service, Credit, Trade, Price & Payment agents).

Every turn, a router picks the specialist for what the customer is talking about right now:

    service         a service lead, or the customer is asking about maintenance / repairs / a recall
    credit          credit, approval, financing with bad / no credit, down payment worries
    trade           their trade-in, selling their car, what it's worth, payoff
    price_payment   price, monthly payment, OTD, discounts, lease vs finance
    sales           everything else: the vehicle, availability, features, test drives (the default)

The specialist is the voice and expertise of that turn's reply: its own playbook goes to Compose with what it
must lean on and what it must never do. The workflow is the same for all of them (Decide still picks the action,
the asks and the visit offer; the guard still blocks any invented rate, payment, approval or trade value): every
specialist works toward the same outcome, an appointment. Pure: nothing here touches the database or the clock.
"""

import re
from dataclasses import dataclass

SALES, SERVICE, CREDIT, TRADE, PRICE = "sales", "service", "credit", "trade", "price_payment"


@dataclass(frozen=True)
class Specialist:
    id: str
    name: str
    playbook: str
    never: str


SPECIALISTS = {
    SALES: Specialist(
        SALES, "Sales specialist",
        "Know the vehicle: say plainly when the car they asked about is here, and answer about the model, features, "
        "trims and stock from the loaded records. Qualify needs (new or used, budget range, timeline) one question "
        "at a time, and always move to an appointment to see and drive it in the next 2-3 days.",
        "Never claim stock, features or prices that aren't in the loaded records."),
    PRICE: Specialist(
        PRICE, "Price & payment specialist",
        "Price and payment questions: acknowledge them directly, quote only a listed price from the records, and "
        "explain that the exact payment depends on term, down payment and approval - which we work out together "
        "in person in a few minutes. Lease vs finance: explain the difference in plain words. Ask their target "
        "payment or budget, then invite them in to see real numbers: always end with the appointment.",
        "Never state a monthly payment, a rate, an out-the-door price or a discount; never promise a number."),
    CREDIT: Specialist(
        CREDIT, "Credit specialist",
        "Credit worries: be warm and judgement-free, say the dealership works with many lenders and all kinds of "
        "credit situations, and that our finance manager can go over real options with them at the dealership. "
        "Helpful general tips are fine (bring proof of income and residence; a larger down payment can help). "
        "Always end by inviting them in to sit down with the finance manager - the appointment is the goal.",
        "Never say they are approved or pre-approved, never quote a rate or a credit score requirement, never "
        "imply a guarantee."),
    TRADE: Specialist(
        TRADE, "Trade-in specialist",
        "Trade-in questions: collect the trade's year, make, model, mileage (and VIN when they have it), and "
        "explain we give a real number after a quick look at the car - it takes about 15 minutes at the visit. "
        "Payoff is fine to ask about. Always end by inviting them in for the appraisal - the appointment is the goal.",
        "Never state a trade value, a range, or what the car is 'worth'."),
    SERVICE: Specialist(
        SERVICE, "Service specialist",
        "Service questions: get the vehicle, current mileage and what it needs (or what it's doing), and offer a "
        "service visit - always end by asking what day works to bring it in; the service department confirms the "
        "exact time. Maintenance or recall details only from the facts given.",
        "Never invent a maintenance interval, a price, a diagnosis, or a recall; never book a service time."),
}

_PATTERNS = (
    (SERVICE, (r"\b(oil change|service (appointment|visit|department)|maintenance|brakes?|tires?|rotation|"
              r"check engine|warning light|recall|repair|inspection|alignment|battery|noise|leak)\b")),
    (CREDIT, (r"\b(credit|approv\w*|bad credit|no credit|repo\w*|bankrupt\w*|co-?signer|first time buyer|"
             r"credit score|denied|financ\w* (with|for) (bad|low|no))\b")),
    (TRADE, (r"\b(trade[- ]?in|trade (it|my|in)|my (current |old )?car (is )?worth|sell (you )?my (car|truck|"
            r"vehicle)|what('s| is) my (car|truck) worth|payoff|kbb|kelley|"
            # Client, 12 Oct 2026 (Jean Castro: "the value of you home to my civic"): what their own car is worth.
            r"(value|valuation|worth) (of|for|on) (\w+ ){0,3}?(my|our) \w+|(my|our) \w+('s)? (value|worth)|"
            r"(give|offer|pay) me for (my|our) \w+|appraise (my|our) \w+)\b")),
    (PRICE, (r"\b(price|pricing|cost|how much|monthly|per month|payment|apr|rate|interest|out the door|otd|"
            r"discount|best deal|lease|financ\w*|down payment|msrp|incentives?|rebates?)\b")),
)
_COMPILED = tuple((sid, re.compile(p, re.IGNORECASE)) for sid, p in _PATTERNS)

# The lead's bucket (agent/lead_bucket.py) when the message itself says nothing specific.
_BUCKET_DEFAULT = {"credit": CREDIT, "trade_in": TRADE}


def route(text: str | None, *, lead_type: str | None = None, bucket: str | None = None) -> tuple[Specialist, str]:
    """(the specialist, why). The customer's own words this turn win; then a service lead; then the bucket."""
    said = text or ""
    for sid, pattern in _COMPILED:
        if sid == SERVICE and lead_type != "service" and not re.search(
                r"\b(recall|service|oil change|maintenance|repair|check engine|warning light)\b", said, re.IGNORECASE):
            continue  # "tires" / "noise" on a sales lead is about the car they're buying
        if match := pattern.search(said):
            return SPECIALISTS[sid], f"the customer said {match.group(0)!r}"
    if lead_type == "service":
        return SPECIALISTS[SERVICE], "a service lead"
    if bucket in _BUCKET_DEFAULT:
        return SPECIALISTS[_BUCKET_DEFAULT[bucket]], f"a {bucket} lead"
    return SPECIALISTS[SALES], "the default"


def for_compose(specialist: Specialist, why: str) -> dict[str, str]:
    return {"id": specialist.id, "name": specialist.name, "playbook": specialist.playbook,
            "never": specialist.never, "why": why}
