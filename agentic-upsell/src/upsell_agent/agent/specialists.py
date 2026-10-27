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
        "at a time, and once you know enough (or they're ready) move to an appointment to see and drive it in the "
        "next 2-3 days.",
        "Never claim stock, features or prices that aren't in the loaded records."),
    PRICE: Specialist(
        PRICE, "Price & payment specialist",
        "Price and payment questions: acknowledge them directly, quote only a listed price from the records, and "
        "explain that the exact payment depends on term, down payment and approval - which we work out together "
        "in person in a few minutes. Lease vs finance: explain the difference in plain words. Ask their target "
        "payment or budget; once you have it, invite them in to see real numbers.",
        "Never state a monthly payment, a rate, an out-the-door price or a discount; never promise a number."),
    CREDIT: Specialist(
        CREDIT, "Credit specialist",
        # Betsy's credit example (21 Sep 2026) - her failed version says "We work with all types of credit".
        "Credit worries: be warm and judgement-free, never generic (never \"we work with all kinds of credit\"). Find "
        "out what decides their real options - a trade (mileage, payoff) and any money down - one question at a time. "
        "Then use what they told you: their trade, payoff and down payment need to be looked at together to see what "
        "can be done, instead of guessing from a credit score - and offer two specific times to sit down with the "
        "finance manager (\"I can reserve 5:15 today or 10:30 tomorrow - which is better?\"). If they worry about "
        "wasting their time, that is exactly why: real numbers, not a guess.",
        "Never say they are approved or pre-approved, never quote a rate or a credit score requirement, never "
        "imply a guarantee."),
    TRADE: Specialist(
        TRADE, "Trade-in specialist",
        # Betsy's trade-in example (21 Sep 2026).
        "Trade-in questions: collect the trade's mileage, payoff and condition (and whether they'd sell or trade), one "
        "question at a time, never asking what they already told you. Then use it: a real appraisal, compared with "
        "their payoff and the replacement options, against what they told you matters (a newer car, a payment that "
        "doesn't jump) - and offer two specific times for the appraisal. An estimate is never an offer: the real "
        "number comes from seeing the car.",
        "Never state a trade value, a range, or what the car is 'worth'."),
    SERVICE: Specialist(
        SERVICE, "Service specialist",
        "Service questions: get the vehicle, current mileage and what it needs (or what it's doing), and offer a "
        "service visit - once you know what it needs, ask what day works to bring it in; the service department "
        "confirms the "
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

# The user, 28 Oct 2026: "there must be a lot, lot of words that can be a sales one, a trade-in, or other ... but it must
# not break the system". AI Studio's own words (_PATTERNS, edited there by Betsy) are checked first and keep their
# place; these built-in words are checked only when none of hers matched. Most specific first.
_MORE_WORDS = (
    (TRADE, r"\b(trad(e|ing) (it )?in|swap my|part[- ]?exchange|my (current|old|own) (car|truck|suv|van|vehicle|ride)|"
            r"what (would|will|can|could) you (give|offer|pay)|how much (would|will|can|could) you (give|pay|offer)|"
            r"(sell|selling) (my|our|the) (car|truck|suv|van|vehicle|\w+)|buy (my|our) (car|truck|vehicle)|"
            r"(still )?owe (on|about|around)?|upside[- ]down|negative equity|lien|loan balance|pay ?off|appraisal|"
            r"apprais\w*|blue book|edmunds value|carmax (offer|quote)|carvana (offer|quote)|instant offer)\b"),
    (CREDIT, r"\b(my credit|credit (is|isn'?t|was|history|issues?|problems?|check|app(lication)?|union)|"
             r"bad credit|poor credit|low credit|no credit|fair credit|rebuild\w* credit|(soft|hard) (pull|check)|"
             r"pre-?qualif\w*|pre-?approv\w*|get approved|will i (get|be) approved|can i get financ\w*|"
             r"first[- ]time (buyer|car)|cosign\w*|co-?sign\w*|repossess\w*|bankrupt\w*|chapter (7|13)|collections|"
             r"itin|no ssn|no social|self[- ]employed|1099|proof of income|pay ?stubs?|buy here pay here|bhph)\b"),
    (PRICE, r"\b(price|priced|pricing|cost|costs|how much|what('s| is) the (price|number|best)|budget|afford|"
            r"monthly|a month|per month|/mo|payments?|apr|interest|rate|term|\d{2} months|out[- ]the[- ]door|otd|"
            r"all[- ]in|taxes|fees|doc fee|dealer fees?|discount|deal|best (price|deal|offer)|negotiat\w*|"
            r"lowest|cheaper|too (high|expensive)|lease|leasing|financ\w*|cash (price|deal|buyer)|down payment|"
            r"money down|\$\s?\d|\d+k\b|msrp|incentives?|rebates?|specials?|promo\w*)\b"),
    (SERVICE, r"\b(oil change|service (appointment|visit|department|center)|maintenance|recall|repair|check engine|"
              r"warning light|inspection|warranty (work|claim|repair)|diagnos\w*|my car (is )?(making|shaking|leaking))\b"),
    (SALES, r"\b(interested|interest(ed)? in|still available|available|in stock|is it (there|still)|"
            r"want (to|it)|looking (for|at|to buy)|shopping|need a (car|truck|suv|van|vehicle)|"
            r"test[- ]?drive|see (it|the car)|come (in|by|see)|visit|photos?|pictures?|pics|video|"
            r"miles|mileage|color|colour|trim|features?|options|packages?|carfax|history|accident|condition|"
            r"warranty|certified|cpo|new or used|awd|4x4|4wd|seats|third row|towing|mpg|hybrid|electric|ev)\b"),
)
_MORE_COMPILED = tuple((sid, re.compile(p, re.IGNORECASE)) for sid, p in _MORE_WORDS)

# What every specialist does, whatever its playbook says (AI Studio's or the built-in) - from the conversations read
# on 27-28 Oct 2026. Added to the playbook Compose gets; it never replaces Betsy's words.
EVERY_SPECIALIST = (
    "Always, whichever specialist you are:\n"
    "- Answer what the customer actually asked first, in one or two plain sentences; then one question at most.\n"
    "- \"I'm interested\" / \"yes\" / \"still available?\" is a buyer: confirm the car and ask the next qualifying "
    "question - never \"we can go over that when you come in\".\n"
    "- Never repeat what they already told you or what we already sent (the time, the address, the car).\n"
    "- A visit is booked: answer only what they asked; no more questions about the car, budget or options.\n"
    "- \"Maybe\" / \"might not make it\" / \"not sure\" is not a no: keep the appointment, say so kindly, ask nothing.\n"
    "- \"No\" / \"not interested\" / \"I'll call you\": accept it, thank them, and stop - no times, no promises.\n"
    "- Never promise what nobody will do (options later, a call, a price check, a manager getting back) unless "
    "the decision says a person was asked to.\n"
    "- Too far / out of state: say what we can do (the car's details, a call) without pushing visit times.\n"
    "- A price offer (\"I can give 19k\"): never accept or refuse it; say a manager will look at it.\n"
    "- They're on the way: confirm, give the address, nothing else.\n"
    "- Short, warm, human; no lists, no jargon; in the customer's language."
)

_MORE_BY_SPECIALIST = {
    SALES: "- Name the exact car (year, make, model) and whether it's here; if it isn't, the closest ones in stock.\n"
           "- Qualify in this order, one at a time, skipping what you know: new or used, the car, timeline, budget, "
           "trade.",
    PRICE: "- They push for a number: the listed price is the only number; the rest is worked out in person in a "
           "few minutes.\n- \"Too expensive\": ask what monthly payment or total works for them.",
    CREDIT: "- Never make them feel judged; never say \"all types of credit\".\n- Ask about money down or a trade, "
            "one at a time.",
    TRADE: "- Collect year, make, model, miles, payoff - one at a time, only what's missing.\n- Never a value or a "
           "range; the appraisal gives the number.",
    SERVICE: "- Get the vehicle, mileage and the problem; the service department confirms the time.",
}

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
    for sid, pattern in _MORE_COMPILED:
        if sid == SERVICE and lead_type != "service":
            continue
        if sid == SALES:
            break  # sales is the default anyway; a service lead / the bucket decides below
        if match := pattern.search(said):
            return SPECIALISTS[sid], f"the customer said {match.group(0)!r}"
    if lead_type == "service":
        return SPECIALISTS[SERVICE], "a service lead"
    if (match := dict(_MORE_COMPILED)[SALES].search(said)) and bucket in _BUCKET_DEFAULT:
        # A credit or trade-in lead talking about the car itself ("is it still available?", "I'm interested").
        return SPECIALISTS[SALES], f"the customer said {match.group(0)!r}"
    if bucket in _BUCKET_DEFAULT:
        return SPECIALISTS[_BUCKET_DEFAULT[bucket]], f"a {bucket} lead"
    return SPECIALISTS[SALES], "the default"


def for_compose(specialist: Specialist, why: str) -> dict[str, str]:
    extra = _MORE_BY_SPECIALIST.get(specialist.id, "")
    playbook = f"{specialist.playbook}\n\n{EVERY_SPECIALIST}" + (f"\n{extra}" if extra else "")
    return {"id": specialist.id, "name": specialist.name, "playbook": playbook,
            "never": specialist.never, "why": why}
