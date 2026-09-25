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

from upsell_agent.config import get_settings

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
_HUMAN = re.compile(r"\b(real person|human|someone call|call me|talk to (?:a|someone|somebody)|manager|salesperson)\b", re.IGNORECASE)
_PREFERENCE = re.compile(r"\b(best|works?|work for me|prefer|good for me|available|free|reach me|call me)\b", re.IGNORECASE)
_UPSET = re.compile(r"\b(angry|annoyed|ridiculous|stop texting|terrible|waste of time|leave me alone|frustrat\w*)\b", re.IGNORECASE)

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
            desired = " ".join(filter(None, [year.group(0) if year else None, make, model]))
            _add(values, allowed, "interest.model", desired, text[span.start():span.end()])
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

    # Money: payoff, monthly payment, budget
    if m := _PAID_OFF.search(text):
        _add(values, allowed, "trade_in.payoff", 0, m.group(0))
    for money in _MONEY.finditer(text):
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

    if "#reject" in lower:
        values.append({"path": "trade_in.payoff", "value": 12000, "quote": "I owe 12k", "confidence": 0.8})

    return {
        "values": values,
        "customer_questions": [q.strip() for q in re.findall(r"[^.?!\n]*\?", text) if q.strip()],
        "wants_human": bool(_HUMAN.search(text)),
        "negative_sentiment": bool(_UPSET.search(text)),
    }


def _join(hints: list[str]) -> str:
    return hints[0] if len(hints) == 1 else ", and ".join([", ".join(hints[:-1]), hints[-1]])


def compose(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    name = payload.get("customer_first_name") or "there"
    campaign = payload.get("campaign")
    questions = payload.get("answer_questions") or []
    text = (payload.get("customer_text") or "").lower()
    attempt = int(payload.get("attempt", 1))

    opener = f"Thanks for replying to our {campaign['name']}! " if campaign else "Thanks! "
    if questions:
        opener += "Good question - our team will confirm that for you. "

    if action == "ask":
        hints = [a["hint"] for a in payload.get("asks", [])]
        body = f"{opener}So we can help, could you tell me {_join(hints)}?"
        why = f"Asking for {len(hints)} missing detail(s), highest priority first."
    elif action == "confirm":
        confirm = payload.get("confirm") or {}
        body = f"{opener}Just to confirm, your {confirm.get('label', 'detail').lower()} is {confirm.get('value')}, right?"
        why = "A value came in uncertain, so it is confirmed before it's relied on."
    elif action == "handoff":
        body = "No problem - I'm passing this to a member of our team, who will reach out to you shortly."
        why = "The customer asked for a person or seems upset, so the AI steps back."
    elif action == "qualified":
        body = f"{opener}That's everything we need, {name}. A member of our team will reach out shortly with next steps."
        why = "All required details are collected, so the reply wraps up without asking more."
    else:
        body = f"{opener}A member of our team will follow up shortly."
        why = "No specific next step."

    if "#fallback" in text or ("#retry" in text and attempt == 1):
        body += " Plus $500 off, guaranteed!"
        why += " (Dev hint: an invented offer was added on purpose to exercise the guard.)"

    sms = body if len(body) <= SMS_MAX else body[: SMS_MAX - 1].rsplit(" ", 1)[0] + "…"
    subject = f"Re: {campaign['name']}" if campaign else "Your inquiry"
    return {"sms_text": sms, "email_subject": subject,
            "email_body": f"Hi {name},\n\n{body}\n\nThanks,\nThe Team", "why": why}


async def _respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    payload = _payload(messages)
    tool = info.output_tools[0]
    if "#slow" in (payload.get("customer_text") or "").lower():
        await asyncio.sleep(30)
    elif latency_ms := get_settings().offline_model_latency_ms:
        await asyncio.sleep(latency_ms / 1000)
    args = compose(payload) if "action" in payload else extract(payload)
    return ModelResponse(parts=[ToolCallPart(tool_name=tool.name, args=args)])


def offline_model() -> FunctionModel:
    return FunctionModel(_respond, model_name="offline")
