"""The "offline" model: a deterministic, rule-based stand-in for Extract and
Compose, served through Pydantic AI's FunctionModel (MODEL_EXTRACT=offline /
MODEL_COMPOSE=offline).

What it is for: running the whole pipeline - Debug UI, scenarios, tests -
on a machine with no model key, with the same code path, typed outputs,
usage accounting and timeouts as a real model. What it is not: AI. It
understands only the patterns below. Use a real model to judge reply quality.

Dev hints, only honoured here (a real model ignores them):
  #retry     the first draft contains an invented offer, so the guard sends it back once
  #fallback  every draft contains an invented offer, so the template is used
  #reject    extract returns one value whose quote isn't in the message (rejected by Validate)
  #slow      the model takes 30s, so the turn deadline sends the template
"""

import asyncio
import json
import re
from typing import Any

from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from upsell_agent.agent.question_topics import is_price_question, is_stock_question
from upsell_agent.config import get_settings
from upsell_agent.slots.dates import DATE_PHRASE

SMS_MAX = 320

MAKES = {
    "toyota": "Toyota", "honda": "Honda", "ford": "Ford", "chevrolet": "Chevrolet", "chevy": "Chevrolet",
    "nissan": "Nissan", "hyundai": "Hyundai", "kia": "Kia", "bmw": "BMW", "tesla": "Tesla", "jeep": "Jeep",
    "subaru": "Subaru", "mazda": "Mazda", "volkswagen": "Volkswagen", "vw": "Volkswagen", "audi": "Audi",
    "lexus": "Lexus", "gmc": "GMC", "ram": "Ram", "dodge": "Dodge",
}
MODELS = {
    "rav4": ("Toyota", "RAV4"), "camry": ("Toyota", "Camry"), "corolla": ("Toyota", "Corolla"),
    "tacoma": ("Toyota", "Tacoma"), "highlander": ("Toyota", "Highlander"), "civic": ("Honda", "Civic"),
    "accord": ("Honda", "Accord"), "cr-v": ("Honda", "CR-V"), "crv": ("Honda", "CR-V"),
    "pilot": ("Honda", "Pilot"), "f-150": ("Ford", "F-150"), "f150": ("Ford", "F-150"),
    "explorer": ("Ford", "Explorer"), "mustang": ("Ford", "Mustang"), "silverado": ("Chevrolet", "Silverado"),
    "equinox": ("Chevrolet", "Equinox"), "altima": ("Nissan", "Altima"), "rogue": ("Nissan", "Rogue"),
    "wrangler": ("Jeep", "Wrangler"), "grand cherokee": ("Jeep", "Grand Cherokee"), "outback": ("Subaru", "Outback"),
    "forester": ("Subaru", "Forester"), "cx-5": ("Mazda", "CX-5"), "a4": ("Audi", "A4"),
    "model y": ("Tesla", "Model Y"), "model 3": ("Tesla", "Model 3"), "tucson": ("Hyundai", "Tucson"),
}
SERVICES = ["oil change", "brakes", "brake pads", "tires", "tire rotation", "alignment", "inspection",
            "check engine light", "battery", "transmission", "30k service", "60k service", "90k service",
            "maintenance", "recall", "ac repair", "a/c", "detail"]

_HEDGE = re.compile(r"\b(about|around|roughly|maybe|i think|approximately|ish|or so|give or take)\b", re.IGNORECASE)
_YEAR = re.compile(r"\b(19[89]\d|20[0-3]\d)\b")
_MILES = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k\b|thousand\b)?\s*(miles|mi\b|on it)", re.IGNORECASE)
_MONEY = re.compile(r"\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k\b|thousand\b)?", re.IGNORECASE)
_TRADE = re.compile(r"\btrad(?:e|ed|es|ing)(?:-in)?\b", re.IGNORECASE)
_NO_TRADE = re.compile(r"\b(no trade(?:-in)?|nothing to trade|don'?t have a trade|not trading|no,? no trade)\b", re.IGNORECASE)
_PAID_OFF = re.compile(r"\b(paid off|own it outright|no loan|don'?t owe|owe nothing|nothing owed)\b", re.IGNORECASE)
_BODY = re.compile(r"\b(suvs?|crossover|pickup|trucks?|sedans?|coupes?|minivans?|vans?|hatchback|wagons?|convertible)\b",
                   re.IGNORECASE)
_COLOR = re.compile(r"\b(white|black|silver|gr[ae]y|red|blue|green|orange|yellow|brown|beige|gold|purple|maroon|tan)\b",
                    re.IGNORECASE)
# Trim words said right after the model ("RAV4 XLE Hybrid").
_TRIM_AFTER = re.compile(r"\s+((?:(?:le|xle|se|xse|limited|platinum|sport|touring|ex-l|ex|lx|sr5|trd|adventure|hybrid|"
                         r"premium|lariat|xlt|lt|ltz|sv|sl|sel|long range|standard)\b\s*)+)", re.IGNORECASE)
_HUMAN = re.compile(r"\b(real person|human|someone call|call me|talk to (?:a|someone|somebody)|manager|salesperson)\b", re.IGNORECASE)
_PREFERENCE = re.compile(r"\b(best|works?|work for me|prefer|good for me|available|free|reach me|call me)\b", re.IGNORECASE)
# Upset with the dealer or the situation: clear (a handoff signal) or mild (not enough on its own).
_UPSET_CLEAR = re.compile(r"\b(angry|furious|ridiculous|unacceptable|terrible|worst|scam|rip-?off|waste of (?:my )?time|"
                          r"leave me alone|stop (?:texting|messaging|contacting))\b", re.IGNORECASE)
_UPSET_MILD = re.compile(r"\b(annoyed|frustrat\w*|disappointed|upset|not happy|irritat\w*)\b", re.IGNORECASE)
# Frustrated with this conversation itself: change approach, don't hand off.
_AT_BOT = re.compile(r"(you keep asking|keep asking (?:me )?the same|same question|already (?:told|said|answered)|"
                     r"(?:that'?s )?not what i (?:asked|said)|stop asking|answer my question|just answer|"
                     r"you'?re not listening|not listening|are you (?:a )?(?:bot|robot))", re.IGNORECASE)
# "What do you mean?" - asking what our last message meant, with or without a question mark.
_CLARIFY = re.compile(r"(what do you mean|what does that mean|what'?s that mean|what is that|what'?s that|"
                      r"i don'?t understand|not sure what you mean|meaning\?)", re.IGNORECASE)
_ABOUT_ME = re.compile(r"((?:know|have|got) (?:so far )?about me|on file (?:for|about) me|what do you know|my (?:details|info|information|profile))",
                       re.IGNORECASE)
_OFF_TOPIC = re.compile(r"\b(weather|joke|politic\w*|sports?|recipe|movie|football|cricket|bitcoin|stock market|"
                        r"homework)\b", re.IGNORECASE)
_SHORT_YES = re.compile(r"^\s*(yes|yeah|yep|yup|sure|i do|correct)\b[\s.!]*$", re.IGNORECASE)
_SHORT_NO = re.compile(r"^\s*(no|nope|nah|i don'?t)\b[\s.!]*$", re.IGNORECASE)
_SHORT_NUMBER = re.compile(r"^\s*((?:about|around|maybe|roughly)\s+)?\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand\b)?"
                           r"\s*(miles|mi)?[\s.!]*$", re.IGNORECASE)
# Words in quotes are something the customer wants said, not their own date:
# "reply 'the car is ready today'". Apostrophes inside words aren't quotes.
_QUOTED = re.compile(r"\"[^\"]*\"|[“][^”]*[”]|(?:(?<=\s)|^)'[^']{3,}'(?=[\s.,!?]|$)")
_BOOL_SLOTS = ("trade_in.has_trade",)
_MILEAGE_SLOTS = ("trade_in.mileage", "vehicle.mileage")
_MONEY_SLOTS = ("interest.budget", "interest.monthly_payment", "trade_in.payoff")
_YEAR_SLOTS = ("trade_in.year", "vehicle.year")

TIMELINES = [
    (r"\b(asap|right away|today|immediately|right now)\b", "now"),
    (r"\bthis week(?:end)?\b", "this_week"),
    (r"\bthis month\b", "this_month"),
    (r"\b(next month|couple (?:of )?months|few months|1-3 months|within 3 months)\b", "1_3_months"),
    (r"\b(later this year|next year|6 months|six months|in the fall|in the spring)\b", "3_plus_months"),
    (r"\b(just browsing|just looking|not sure yet)\b", "just_browsing"),
]
CONDITIONS = [(r"\b(excellent|like new|mint|great)\b", "excellent"), (r"\b(good|very good|clean)\b", "good"),
              (r"\b(fair|ok|okay|average|some wear)\b", "fair"), (r"\b(poor|rough|bad|needs work)\b", "poor")]
BEST_TIMES = [(r"\bmornings?\b", "morning"), (r"\bafternoons?\b", "afternoon"),
              (r"\b(evenings?|after work|tonight)\b", "evening"), (r"\b(weekends?|saturday|sunday)\b", "weekend"),
              (r"\b(any ?time|whenever)\b", "anytime")]


def _payload(messages: list[ModelMessage]) -> dict[str, Any]:
    for part in reversed(messages[-1].parts):
        if isinstance(part, UserPromptPart) and isinstance(part.content, str):
            return json.loads(part.content)
    return {}


def _add(values: list[dict], allowed: set[str], path: str, value: Any, quote: str, confidence: float = 0.92) -> None:
    if path in allowed and not any(v["path"] == path for v in values):
        values.append({"path": path, "value": value, "quote": quote.strip(), "confidence": confidence})


def _hedged(text: str, match: re.Match) -> bool:
    window = text[max(0, match.start() - 20):match.start()]
    return bool(_HEDGE.search(window))


def extract(payload: dict[str, Any]) -> dict[str, Any]:
    text: str = payload.get("customer_text", "")
    lower = text.lower()
    lead_type = payload.get("lead_type", "general")
    allowed = {s["path"] for s in payload.get("allowed_slots", [])}
    asked = set(payload.get("recently_asked", []))
    values: list[dict] = []

    trade_context = bool(_TRADE.search(text)) or lead_type == "trade_in" or bool(asked & {
        "trade_in.year", "trade_in.make", "trade_in.model", "trade_in.mileage", "trade_in.payoff"})
    owned = "trade_in" if trade_context else ("vehicle" if lead_type == "service" else "interest")

    # Trade-in yes/no
    if m := _NO_TRADE.search(text):
        _add(values, allowed, "trade_in.has_trade", False, m.group(0))
    elif m := _TRADE.search(text):
        _add(values, allowed, "trade_in.has_trade", True, m.group(0))

    # Year / make / model
    year = _YEAR.search(text)
    make_match = next(((m, MAKES[k]) for k in MAKES if (m := re.search(rf"\b{re.escape(k)}\b", lower))), None)
    model_match = next(((m, MODELS[k]) for k in sorted(MODELS, key=len, reverse=True)
                        if (m := re.search(rf"\b{re.escape(k)}\b", lower))), None)
    make = model_match[1][0] if model_match else (make_match[1] if make_match else None)
    model = model_match[1][1] if model_match else None
    if owned == "interest":
        if model_match or make_match:
            span = (model_match or make_match)[0]
            trim = _TRIM_AFTER.match(text[span.end():]) if model_match else None
            desired = " ".join(filter(None, [year.group(0) if year else None, make, model,
                                             trim.group(1).strip() if trim else None]))
            _add(values, allowed, "interest.model", desired, text[span.start():span.end()])
        # Shopping criteria (MASTER_PLAN_3 Phase 2): only about what they want, never their trade.
        if m := _BODY.search(text):
            _add(values, allowed, "interest.body_type", m.group(1).lower(), m.group(0), 0.9)
        if m := _COLOR.search(text):
            _add(values, allowed, "interest.color", m.group(1).lower(), m.group(0), 0.9)
    else:
        if year:
            _add(values, allowed, f"{owned}.year", int(year.group(0)), year.group(0), 0.6 if _hedged(text, year) else 0.93)
        if make:
            _add(values, allowed, f"{owned}.make", make, (make_match or model_match)[0].group(0))
        if model:
            _add(values, allowed, f"{owned}.model", model, model_match[0].group(0))

    # Mileage
    if m := _MILES.search(text):
        miles = float(m.group(1).replace(",", "")) * (1000 if m.group(2) else 1)
        target = "trade_in.mileage" if trade_context else "vehicle.mileage"
        _add(values, allowed, target, int(miles), m.group(0), 0.6 if _hedged(text, m) else 0.9)

    # New / used
    if m := re.search(r"\b(brand new|new|used|pre-?owned|certified)\b", lower):
        word = m.group(1)
        _add(values, allowed, "interest.new_or_used", "new" if "new" in word else "used", m.group(0), 0.88)

    # Money: payoff, monthly payment, budget. A bare number answering a number
    # we just asked for is left to _short_reply (it may be mileage or a year).
    bare_answer = bool(_SHORT_NUMBER.match(text)) and bool(asked & {*_MILEAGE_SLOTS, *_MONEY_SLOTS, *_YEAR_SLOTS})
    if m := _PAID_OFF.search(text):
        _add(values, allowed, "trade_in.payoff", 0, m.group(0))
    for money in ([] if bare_answer else _MONEY.finditer(text)):
        raw, kilo = money.group(1), money.group(2)
        before = lower[max(0, money.start() - 25):money.start()]
        after = lower[money.end():money.end() + 15]
        amount = float(raw.replace(",", "")) * (1000 if kilo else 1)
        if "$" not in money.group(0) and not kilo and amount < 1000:
            continue
        if re.search(r"(miles|mi\b)", after) or _YEAR.fullmatch(raw.replace(",", "")):
            continue
        if re.search(r"\b(owe|payoff|pay off|left on|loan)\b", before + after):
            _add(values, allowed, "trade_in.payoff", int(amount), money.group(0), 0.9)
        elif re.search(r"(/\s?mo|per month|a month|monthly)", after + before):
            _add(values, allowed, "interest.monthly_payment", int(amount), money.group(0), 0.9)
        elif re.search(r"\b(budget|under|up to|max|around|about|spend|afford|price range|below)\b", before) or "$" in money.group(0):
            _add(values, allowed, "interest.budget", int(amount), money.group(0), 0.9)

    # Enums. A buying timeline only means something on a sales conversation.
    if lead_type in ("sales", "general"):
        for pattern, value in TIMELINES:
            if m := re.search(pattern, lower):
                _add(values, allowed, "interest.timeline", value, text[m.start():m.end()])
                break
    if trade_context:
        for pattern, value in CONDITIONS:
            if m := re.search(pattern, lower):
                _add(values, allowed, "trade_in.condition", value, text[m.start():m.end()], 0.85)
                break
    # "Saturday" in "what are your hours on Saturday?" is not a preference:
    # only take a time when they state one, or we just asked for it.
    if _PREFERENCE.search(text) or "contact.best_time" in asked:
        for pattern, value in BEST_TIMES:
            if m := re.search(pattern, lower):
                _add(values, allowed, "contact.best_time", value, text[m.start():m.end()])
                break
    for service in SERVICES:
        if m := re.search(rf"\b{re.escape(service)}\b", lower):
            _add(values, allowed, "interest.service_needed", service, text[m.start():m.end()])
            break
    if lead_type == "general":
        for pattern, value in [(r"\b(buy|buying|shopping|looking for a (?:new|used)?\s?(?:car|truck|suv))\b", "sales"),
                               (r"\b(trade|trading|sell my)\b", "trade_in"),
                               (r"\b(service|repair|oil change|maintenance)\b", "service")]:
            if m := re.search(pattern, lower):
                _add(values, allowed, "interest.lead_type", value, text[m.start():m.end()], 0.85)
                break

    _short_reply(text, asked, allowed, values)
    # "What are your hours on Saturday?" asks about the dealer, it isn't their date:
    # the first date not in a sentence about opening hours.
    about_hours = [s.span() for s in re.finditer(r"[^.?!\n]+[.?!]?", text) if _HOURS_Q.search(s.group(0))]
    m = next((d for d in DATE_PHRASE.finditer(_QUOTED.sub(lambda q: " " * len(q.group(0)), text))
              if not any(a <= d.start() < b for a, b in about_hours)), None)
    if m:
        # The words only; the date is worked out in code (slots/dates.py).
        end = m.end()
        if t := re.match(r"\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b|\s+at\s+noon\b", text[end:], re.IGNORECASE):
            end += t.end()
        _add(values, allowed, "interest.needed_by", text[m.start():end], text[m.start():end], 0.9)

    if "#reject" in lower:
        values.append({"path": "trade_in.payoff", "value": 12000, "quote": "I owe 12k", "confidence": 0.8})

    if payload.get("awaiting_contact_choice") and (preference := _contact_preference(text)):
        # Like a real model: the answer as a value of the contact_preference slot (agent/nodes/extract.py).
        values.append({"path": "contact_preference", "value": preference, "quote": text.strip(), "confidence": 0.9})
    return {
        "values": values,
        "questions": _questions(text),
        "wants_human": bool(_HUMAN.search(text)),
        **_sentiment(text),
        **_possible_opt_out(text),
        **_wants_visit(text),
        **_declines_visit(text, payload),
        **_urgent(text),
    }


# Answers to "help you now, or have the team pick this up when we open?" (MASTER_PLAN_3 B1).
_PREFER_NOW = re.compile(r"\b(now|right now|now is (?:fine|good)|let'?s do it|go ahead|here is fine|here'?s fine)\b",
                         re.IGNORECASE)
_PREFER_LATER = re.compile(r"\b(later|tomorrow|morning|when you open|when (?:you'?re|you are) open|business hours|"
                           r"have the team|team can|wait)\b", re.IGNORECASE)
_VISIT = re.compile(r"\b(come (?:in|by|see|look)|stop by|swing by|test ?drive|see it in person|visit|"
                    r"book (?:a|an) (?:time|appointment|visit)|schedule (?:a|an) (?:time|appointment|visit))\b",
                    re.IGNORECASE)
# Turning down a visit offer (MASTER_PLAN_3 B4 item 4). Only read when our last message
# offered specific times (payload's context.conversation.awaiting_visit_pick).
_DECLINE_VISIT = re.compile(
    r"\b(not yet|not right now|not today|maybe later|can'?t make it|can'?t come in|i'?m just looking|"
    r"just browsing|not ready|no thanks|not this week|can'?t this week|rather not|skip that|"
    r"not interested in (?:coming|visiting)|no,? not now)\b", re.IGNORECASE)
_OBJECTION_PATTERNS = [
    (r"\b(busy|don'?t have time|no time|tight schedule|hard to get away)\b", "time_convenience"),
    (r"\b(just looking|just browsing|not ready|window shopping)\b", "just_looking"),
    (r"\b(price|numbers|cost|how much|what'?s it going to cost)\b", "wants_numbers"),
    (r"\b(credit|approv\w*|financ\w*)\b", "credit_worry"),
    (r"\b(trade|worth|trade-?in value)\b", "trade_value_unsure"),
]
# Urgent-need signals (MASTER_PLAN_3 B0.13 decision 26, built in B4 item 8).
_URGENT_PATTERNS = [
    (r"\b(car broke down|no (?:working )?car|without a car|stranded|no transportation|can'?t get around)\b",
     "no_transportation"),
    ((r"\b(need (?:it|a car|a vehicle) (?:by|within|in) (?:tomorrow|today|\d+\s*(?:hours?|hrs?|days?))|"
      r"need something (?:asap|right away|immediately))\b"), "needed_within_48h"),
    (r"\b(not safe to drive|unsafe|brakes? (?:are |is )?(?:going|gone|failing)|dangerous to drive)\b",
     "safety_problem"),
    ((r"\b(lease (?:is )?ending|other offer expir\w*|deal (?:falls?|falling) through|losing (?:my|the) "
      r"(?:offer|deal))\b"), "external_deadline"),
]


def _contact_preference(text: str) -> str | None:
    later, now = _PREFER_LATER.search(text), _PREFER_NOW.search(text)
    if later and not now:
        return "later"
    if now and not later:
        return "now"
    return None


def _wants_visit(text: str) -> dict[str, Any]:
    if _VISIT.search(text):
        return {"wants_visit": True, "wants_visit_confidence": 0.9}
    return {"wants_visit": False, "wants_visit_confidence": 0.0}


def _declines_visit(text: str, payload: dict[str, Any]) -> dict[str, Any]:
    """MASTER_PLAN_3 B4 item 4: only read as a decline when our last message
    offered specific visit times (agent/conversation.py's
    `awaiting_visit_pick`, mirroring how B1's contact_preference is only
    read while awaiting_contact_choice)."""
    awaiting = bool(((payload.get("context") or {}).get("conversation") or {}).get("awaiting_visit_pick"))
    if not awaiting or not _DECLINE_VISIT.search(text):
        return {"declines_visit": False, "declines_visit_confidence": 0.0, "visit_objection": "none",
                "visit_later_when": None}
    objection = next((label for pattern, label in _OBJECTION_PATTERNS if re.search(pattern, text, re.IGNORECASE)),
                     "none")
    later = m.group(0) if (m := DATE_PHRASE.search(text)) else None
    return {"declines_visit": True, "declines_visit_confidence": 0.85, "visit_objection": objection,
            "visit_later_when": later}


def _urgent(text: str) -> dict[str, Any]:
    for pattern, reason in _URGENT_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return {"urgent": True, "urgent_confidence": 0.9, "urgent_reason": reason}
    return {"urgent": False, "urgent_confidence": 0.0, "urgent_reason": "none"}


# Unclear opt-outs; the clear ones are caught in code first (compliance/opt_out.py).
_MAYBE_OPT_OUT = re.compile(
    r"why do you keep (?:texting|messaging|emailing|contacting)|too many (?:texts|messages|emails)|"
    r"(?:getting|get) (?:a lot of|so many) (?:texts|messages|emails)|please stop\b|how do i (?:stop|unsubscribe)|"
    r"who gave you my (?:number|email)|enough with the (?:texts|messages|emails)", re.IGNORECASE)


def _possible_opt_out(text: str) -> dict[str, Any]:
    if _MAYBE_OPT_OUT.search(text):
        return {"possible_opt_out": True, "opt_out_confidence": 0.7}
    return {"possible_opt_out": False, "opt_out_confidence": 0.0}


def _label(question: str) -> str:
    if _CLARIFY.search(question):
        return "clarify"
    if _ABOUT_ME.search(question):
        return "about_me"
    # Two separate rules (agent/question_topics.py); stock stays restricted until Phase 3.
    if is_price_question(question) or is_stock_question(question):
        return "restricted"
    if _OFF_TOPIC.search(question):
        return "off_topic"
    return "answerable"


def _questions(text: str) -> list[dict[str, str]]:
    found = [q.strip() for q in re.findall(r"[^.?!\n]*\?", text) if q.strip()]
    if (m := _CLARIFY.search(text)) and not any(_CLARIFY.search(q) for q in found):
        found.append(m.group(0).strip())  # "what do you mean" without a question mark
    return [{"text": q, "label": _label(q)} for q in found]


def _sentiment(text: str) -> dict[str, Any]:
    at_bot = bool(_AT_BOT.search(text))
    if _UPSET_CLEAR.search(text):
        return {"upset": True, "upset_confidence": 0.9, "annoyed_at_bot": at_bot}
    if _UPSET_MILD.search(text) and not at_bot:
        return {"upset": True, "upset_confidence": 0.6, "annoyed_at_bot": False}
    return {"upset": False, "upset_confidence": 0.0, "annoyed_at_bot": at_bot}


def _short_reply(text: str, asked: set[str], allowed: set[str], values: list[dict]) -> None:
    """A bare "yes", "no" or number answers the slot our last message asked for."""
    open_asks = [p for p in asked if p in allowed and not any(v["path"] == p for v in values)]
    if not open_asks:
        return
    if (m := _SHORT_YES.match(text)) or (n := _SHORT_NO.match(text)):
        slot = next((p for p in open_asks if p in _BOOL_SLOTS), None)
        if slot:
            _add(values, allowed, slot, bool(m), (m or n).group(1))
        return
    if m := _SHORT_NUMBER.match(text):
        amount = float(m.group(2).replace(",", "")) * (1000 if m.group(3) else 1)
        confidence = 0.6 if m.group(1) else 0.88
        quote = text.strip().rstrip(".!").strip()
        kinds = [(_MILEAGE_SLOTS, 0 <= amount <= 500_000), (_MONEY_SLOTS, amount >= 50),
                 (_YEAR_SLOTS, 1980 <= amount <= 2035 and not m.group(3))]
        if m.group(4):  # "miles" said outright
            kinds = kinds[:1]
        for slots, fits in kinds:
            slot = next((p for p in open_asks if p in slots), None)
            if slot and fits:
                _add(values, allowed, slot, int(amount), quote, confidence)
                return


def _question_for(ask: dict[str, Any]) -> str:
    """The detail's plain customer question; an older payload with only a hint still works."""
    return ask.get("question") or f"So we can help, could you tell me {ask.get('hint') or ask.get('label', '').lower()}?"


def _about_me(payload: dict[str, Any]) -> str:
    """Only what we know: confirmed values, and what's still to confirm said as such."""
    about = (payload.get("context") or {}).get("about_customer") or {}
    known = [f"{k['label'].lower()}: {k['value']}" for k in about.get("known", [])]
    unsure = [f"{u['label'].lower()} is {u['value']}" for u in about.get("unconfirmed", [])]
    if not known and not unsure:
        return "I don't have any details from you yet."
    text = f"Here's what I have so far - {'; '.join(known)}." if known else ""
    if unsure:
        text += f" I think your {' and your '.join(unsure)}, but I still need to confirm that."
    return text.strip()


_HOURS_Q = re.compile(r"\b(open|close[sd]?|closing|hours|opening)\b", re.IGNORECASE)
_ADDRESS_Q = re.compile(r"\b(where are you|located|location|address|directions|find you)\b", re.IGNORECASE)
_PHONE_Q = re.compile(r"\b(phone|number|call you)\b", re.IGNORECASE)
_WEBSITE_Q = re.compile(r"\b(website|web site|site|online)\b", re.IGNORECASE)
_DAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def _dealer_answer(question: str, info: dict[str, Any]) -> str | None:
    """An answer from the dealer's own details, or None when the question isn't
    about them. A detail the dealer never entered gets "the team will confirm"."""
    if _HOURS_Q.search(question):
        hours = info.get("hours")
        if not hours:
            return ""
        day = next((d for d in _DAY_NAMES if d in question.lower()), None)
        if day:
            text = hours[day.capitalize()]
            return f"On {day.capitalize()} we're closed." if text == "closed" else f"On {day.capitalize()} we're open {text}."
        return f"Our hours are {info['hours_summary']}."
    for pattern, field, template in ((_ADDRESS_Q, "address", "We're at {}."), (_PHONE_Q, "phone", "You can reach us at {}."),
                                     (_WEBSITE_Q, "website", "Our website is {}.")):
        if pattern.search(question):
            return template.format(info[field]) if info.get(field) else ""
    return None


def _answers(questions: list[dict[str, str]], payload: dict[str, Any]) -> tuple[str, list[str]]:
    """One short sentence per kind of question, and the promises they make."""
    sentences: list[str] = []
    promises: list[str] = []
    info = ((payload.get("context") or {}).get("dealer") or {}).get("info") or {}
    team = [q for q in questions if q["label"] == "restricted"]
    for q in (q for q in questions if q["label"] == "answerable"):
        answer = _dealer_answer(q["text"], info)
        if answer:
            sentences.append(answer)
        else:  # not about the dealer's details, or a detail they never entered
            team.append(q)
    if team:
        sentences.append("Good question - our team will confirm that for you.")
        promises += [f"The team will confirm: {q['text']}" for q in team]
    if any(q["label"] == "about_me" for q in questions):
        sentences.append(_about_me(payload))
    if any(q["label"] == "off_topic" for q in questions):
        sentences.append("I can only help with your vehicle here, but I'm glad to do that.")
    if any(q["label"] == "clarify" for q in questions):
        sentences.append("Sorry for not being clear - I'm here to help you find the right vehicle.")
    return " ".join(sentences), promises


def _confirm_text(confirm: dict[str, Any]) -> str:
    shown = confirm.get("display") or confirm.get("value")
    if confirm.get("kind") == "date":
        return f"Just to check, is that {shown}?"
    return f"Just to confirm, your {confirm.get('label', 'detail').lower()} is {shown}, right?"


def _visit_offer_text(visit_offer: dict[str, Any]) -> str:
    """MASTER_PLAN_3 B4 item 3: 2-3 concrete times, grounded in the offer's
    own value_proposition, never a vague "when would you like to come in?".
    Exactly one "?" (it counts as one question, MASTER_PLAN_3 Bq/B4 decision
    107): the lead-in is a statement, not its own question."""
    times = [t["display"] for t in visit_offer.get("times") or []]
    choices = (", or ".join(times) if len(times) <= 1
              else ", ".join(times[:-1]) + f", or {times[-1]}")
    reason = visit_offer.get("value_proposition") or ""
    lead_in = f"Want to come by {reason}" if reason else "Want to come by"
    return f"{lead_in} - I've got {choices}. Which one works?" if choices else f"{lead_in}?"


def compose(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    name = payload.get("customer_first_name") or "there"
    campaign = payload.get("campaign")
    questions = [q if isinstance(q, dict) else {"text": q, "label": "answerable"}
                 for q in payload.get("answer_questions") or []]
    text = (payload.get("customer_text") or "").lower()
    attempt = int(payload.get("attempt", 1))
    asks = payload.get("asks") or []
    confirm = payload.get("confirm")
    visit_offer = payload.get("visit_offer")
    visit = payload.get("visit") or {}

    opener = f"Thanks for replying to our {campaign['name']}! " if campaign else "Thanks! "
    dates = [c["display"] for c in payload.get("just_captured") or [] if c.get("kind") == "date"]
    if dates and action not in ("handoff", "confirm"):
        opener += f"Got it - {dates[0]}. "
    answered, promises = _answers(questions, payload)
    # At most two questions (MASTER_PLAN_3 Bq): the confirmation first, then the asks. A visit offer
    # takes the confirmation's bonus-question slot when it's given (MASTER_PLAN_3 B4, decision 107).
    follow_ups = ([_visit_offer_text(visit_offer)] if visit_offer else
                 [_confirm_text(confirm)] if confirm else []) + [_question_for(a) for a in asks]
    follow_up = "".join(f" {q}" for q in follow_ups[:2])

    if action == "answer":
        body = f"{opener}{answered}{follow_up}"
        why = f"Answering {len(questions)} question(s) first" + (
            f", then {len(follow_ups[:2])} follow-up(s)." if follow_up else ".")
        if visit_offer:
            why += f" A visit offer (attempt {visit_offer.get('attempt')}) is the bonus question."
    elif action == "offer_visit":
        taken = f"Sorry, {visit['slot_taken']} was just taken. " if visit.get("slot_taken") else ""
        body = f"{opener}{taken}{follow_up.strip()}"
        why = f"Offering a visit (attempt {visit_offer.get('attempt') if visit_offer else '?'} of 3, " \
              f"angle: {visit_offer.get('angle') if visit_offer else '?'})."
    elif action == "clarify":
        items = (payload.get("clarify") or {}).get("items", [])
        explained = " ".join(i["explanation"] for i in items if i.get("explanation"))
        again = " ".join(i["question"] for i in items if i.get("question"))
        body = f"Sorry, I should have been clearer. {explained} {again}".strip()
        others = [q for q in questions if q["label"] != "clarify"]
        if others:
            extra, promises = _answers(others, payload)
            body += f" {extra}"
        why = "The customer asked what we meant, so the last question is explained and asked again, nothing new."
    elif action == "ask":
        body = f"{opener}{follow_up.strip()}"
        why = f"Asking for the {len(asks)} most important missing detail(s)."
    elif action == "confirm":
        body = f"{opener}{follow_up.strip()}"
        why = "A value came in uncertain, so it is confirmed before it's relied on" + (
            ", then one more detail is asked." if asks else ".")
    elif action == "handoff":
        body = "No problem - I'm passing this to a member of our team, who will reach out to you shortly."
        why = "The customer asked for a person or is clearly upset, so the AI steps back."
        promises.append("A member of the team will reach out shortly.")
    elif action == "qualified":
        if visit.get("stopped"):
            body = f"{opener}Thanks, {name}!"
            why = "All required details are collected, but the visit offer was already declined 3 times: just acknowledge."
        else:
            body = f"{opener}That's everything we need, {name}. A member of our team will reach out shortly with next steps."
            why = "All required details are collected, so the reply wraps up without asking more."
            promises.append("A member of the team will reach out with next steps.")
    elif action == "partly_qualified":
        if visit.get("stopped"):
            body = f"Thanks, {name}. I've passed what we have to the team."
            why = "Everything still missing was asked twice, and the visit offer was already declined 3 times."
        else:
            body = (f"Thanks, {name}. I've passed what we have to the team, and someone will reach out shortly "
                    "with next steps.")
            why = "Everything still missing was asked twice, so the lead goes to the team with what we have."
            promises.append("A member of the team will reach out with next steps.")
    elif payload.get("annoyed_at_bot"):
        body = f"Sorry about that, {name} - I won't keep asking. Just tell me whatever you need and I'll help."
        why = "The customer is frustrated with the conversation: apologise, ask nothing."
    else:
        body = f"Thanks, {name} - noted!"
        why = "Nothing to ask right now, so the reply just acknowledges the message."
    after_hours = payload.get("after_hours") or {}
    opens = after_hours.get("opens_at")
    if after_hours.get("mode") == "offer":
        body = (f"{answered} " if action in ("answer", "clarify") and answered else "Thanks for reaching out! ") + (
            f"We're closed right now and open again at {opens}. " if opens else "We're closed right now. ") + (
            "I can help you here now, or the team can pick this up when we open. Which would you like?")
        why = "The dealership is closed: answer, then offer to help now or have the team pick it up at opening."
    elif after_hours.get("mode") == "later":
        body = (f"{answered} " if answered else "") + f"Thanks, {name}! The team will pick this up when we open" + (
            f" at {opens}." if opens else ".")
        why = "The customer chose to wait for the team: a short thank-you, nothing asked."
    elif after_hours.get("mode") == "resume":
        hour = int(str(((payload.get("context") or {}).get("now") or {}).get("time", "09:00")).split(":")[0])
        greeting = "Good morning" if hour < 12 else "Good afternoon" if hour < 17 else "Good evening"
        rest = "Just reply here whenever you're ready." if action == "acknowledge" else body.removeprefix(opener)
        body = f"{greeting}, {name}! The team is in now. {rest}"
        why = "The dealership has opened: the conversation picks up where it stopped. " + why
    if visit.get("just_booked"):
        # A booking was created (or moved) this turn (MASTER_PLAN_3 B5 item 7, architecture §15
        # decision 60): wording matches the booking's real status, never "booked" for a pending one.
        wording = "confirmed" if visit.get("status") == "confirmed" else "requested"
        verb = "moved" if visit.get("moved_this_turn") else wording
        lead_in = f"{answered} " if answered else ""
        body = (f"{lead_in}Great - I've {verb} {visit.get('display')} for you." +
               (" The team will confirm shortly." if wording == "requested" else " See you then!"))
        why = f"A booking was {verb} this turn ({wording}, matching its real status)."
        if wording == "requested":
            promises = [*promises, "The team will confirm the visit shortly."]
    elif visit.get("cancelled_this_turn"):
        body = f"{f'{answered} ' if answered else ''}No problem, {name} - I've cancelled that. Happy to find another time whenever works."
        why = "The customer cancelled their booking this turn."
    elif visit.get("ask_contact"):
        field_question = ("What's the best email for your confirmation?" if visit["ask_contact"] == "email"
                          else "What's a good phone number for the visit?")
        body = f"{f'{answered} ' if answered else ''}Got it - {visit.get('display')} works. {field_question}"
        why = f"The customer picked a time, but we're missing their {visit['ask_contact']} before it can be booked."
    if payload.get("quiet_hours"):
        body += " The team will pick this up at 8:00 AM."
        why += " Outside 8:00-21:00 customer time in an outbound conversation: no questions, the team picks up at 8."
    elif payload.get("hold_questions"):
        why += " Possible opt-out under review: a plain reply, nothing asked or offered."

    if "#fallback" in text or ("#retry" in text and attempt == 1):
        body += " Plus $500 off, guaranteed!"
        why += " (Dev hint: an invented offer was added on purpose to exercise the guard.)"

    sms = body if len(body) <= SMS_MAX else body[: SMS_MAX - 1].rsplit(" ", 1)[0] + "…"
    subject = f"Re: {campaign['name']}" if campaign else "Your inquiry"
    return {"sms_text": sms, "email_subject": subject,
            "email_body": f"Hi {name},\n\n{body}\n\nThanks,\nThe Team", "why": why, "promises": promises,
            "answered_questions": [q["text"] for q in questions] if action in ("answer", "clarify") else []}


def summarize(payload: dict[str, Any]) -> dict[str, Any]:
    """The previous summary plus one quoted line per new message: the customer's
    own words kept verbatim (in quotes, so they read as what was said, never as
    instructions). Over the limit, our lines go first, then the oldest."""
    max_chars = int(payload.get("max_chars") or 1500)
    previous = [line for line in (payload.get("previous_summary") or "").splitlines() if line.strip()]
    new = []
    for message in payload.get("messages", []):
        text = " ".join(str(message.get("text") or "").split())[:200]
        if text:
            new.append(f'{"The customer" if message.get("from") == "customer" else "We"} said: "{text}"')
    lines = previous + new

    def size(rows: list[str]) -> int:
        return len("\n".join(rows))

    while size(lines) > max_chars and any(line.startswith("We said") for line in lines):
        lines.remove(next(line for line in lines if line.startswith("We said")))
    while size(lines) > max_chars and len(lines) > 1:
        lines.pop(0)
    summary = "\n".join(lines)[:max_chars]
    return {"summary": summary, "why": f"Added {len(new)} message(s) to the summary."}


async def _respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    payload = _payload(messages)
    tool = info.output_tools[0]
    if "#slow" in (payload.get("customer_text") or "").lower():
        await asyncio.sleep(30)
    elif latency_ms := get_settings().offline_model_latency_ms:
        await asyncio.sleep(latency_ms / 1000)
    if "previous_summary" in payload:
        args = summarize(payload)
    else:
        args = compose(payload) if "action" in payload else extract(payload)
    return ModelResponse(parts=[ToolCallPart(tool_name=tool.name, args=args)])


def offline_model() -> FunctionModel:
    return FunctionModel(_respond, model_name="offline")
